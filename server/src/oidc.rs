use std::{
    collections::BTreeSet,
    net::{IpAddr, SocketAddr},
    sync::OnceLock,
    time::Duration as StdDuration,
};

use axum::{
    extract::{ConnectInfo, Form, Query, State},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Redirect, Response},
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{MySql, Row, Transaction};
use subtle::ConstantTimeEq;
use totp_rs::{Algorithm as TotpAlgorithm, Secret as TotpSecret, TOTP};
use uuid::Uuid;

use crate::{
    auth::{
        hash_password, normalize_email, random_secret, secret_hash, verify_password, AuthService,
        Identity, AUTHORIZATION_TTL_SECONDS, BROWSER_SESSION_TTL_HOURS, INVITATION_TTL_HOURS,
        REFRESH_FAMILY_TTL_DAYS, REFRESH_TOKEN_TTL_DAYS, RESET_TTL_MINUTES,
    },
    error::AppError,
    require_admin, AppState,
};

const COOKIE_PRODUCTION: &str = "__Host-rabbit_oidc";
const COOKIE_DEVELOPMENT: &str = "rabbit_oidc_dev";
const ALLOWED_SCOPES: [&str; 4] = ["openid", "profile", "email", "offline_access"];

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/.well-known/openid-configuration", get(discovery))
        .route("/oauth2/authorize", get(authorize))
        .route("/oauth2/interaction", post(interaction))
        .route("/oauth2/login", post(login))
        .route("/oauth2/mfa", post(login_mfa))
        .route("/oauth2/consent", post(consent))
        .route("/oauth2/token", post(token))
        .route("/oauth2/jwks", get(jwks))
        .route("/oauth2/userinfo", get(userinfo).post(userinfo))
        .route("/oauth2/revoke", post(revoke))
        .route("/oauth2/logout", get(logout).post(logout_post))
        .route(
            "/account/register",
            get(register_page).post(register_account),
        )
        .route("/account/register/context", get(register_context))
        .route("/account/setup", get(setup_page).post(setup_account))
        .route("/account/setup/context", post(setup_context))
        .route(
            "/account/forgot-password",
            get(forgot_page).post(request_password_reset),
        )
        .route("/account/forgot-password/context", get(forgot_context))
        .route(
            "/account/reset-password",
            get(reset_page).post(reset_password),
        )
        .route("/account/reset-password/context", post(reset_context))
        .route("/account/security", get(security_page))
        .route("/account/security/context", get(security_context))
        .route("/account/security/totp/start", post(start_totp))
        .route("/account/security/totp/confirm", post(confirm_totp))
        .route("/account/security/totp/disable", post(disable_totp))
        .route(
            "/account/security/revoke-others",
            post(revoke_other_sessions),
        )
        .route("/internal/accounts/invitations", post(invite_account))
        .route(
            "/internal/accounts/{account_id}/suspend",
            post(suspend_account),
        )
        .route(
            "/internal/accounts/{account_id}/activate",
            post(activate_account),
        )
        .route(
            "/internal/accounts/{account_id}/revoke-sessions",
            post(revoke_account_sessions),
        )
}

#[derive(Debug, Deserialize)]
struct AuthorizeQuery {
    response_type: String,
    client_id: String,
    redirect_uri: String,
    scope: String,
    state: String,
    nonce: Option<String>,
    code_challenge: String,
    code_challenge_method: String,
    prompt: Option<String>,
    ui_locales: Option<String>,
}

#[derive(Debug)]
struct Authorization {
    id: String,
    request_secret: String,
    client_id: String,
    redirect_uri: String,
    scope: String,
    client_state: String,
    prompt: Option<String>,
    account_id: Option<String>,
    auth_time: Option<DateTime<Utc>>,
}

#[derive(Debug)]
struct BrowserSession {
    id: String,
    account_id: String,
    auth_time: DateTime<Utc>,
    raw_token: String,
}

#[derive(Debug, Deserialize)]
struct LoginForm {
    request: String,
    csrf: String,
    email: String,
    password: String,
}

#[derive(Debug, Deserialize)]
struct InteractionForm {
    request: String,
}

#[derive(Debug, Deserialize)]
struct MfaForm {
    request: String,
    csrf: String,
    code: String,
}

#[derive(Debug, Deserialize)]
struct ConsentForm {
    request: String,
    csrf: String,
    decision: String,
}

#[derive(Debug, Deserialize)]
struct TokenForm {
    grant_type: String,
    client_id: Option<String>,
    code: Option<String>,
    code_verifier: Option<String>,
    redirect_uri: Option<String>,
    refresh_token: Option<String>,
}

#[derive(Debug, Serialize)]
struct TokenResponse {
    access_token: String,
    id_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
    token_type: &'static str,
    scope: String,
}

#[derive(Debug, Deserialize)]
struct RevokeForm {
    token: String,
    client_id: Option<String>,
    token_type_hint: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
struct LogoutQuery {
    id_token_hint: Option<String>,
    post_logout_redirect_uri: Option<String>,
    state: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ActionQuery {
    token: String,
}

#[derive(Debug, Deserialize)]
struct PasswordActionForm {
    token: String,
    csrf: String,
    password: String,
    confirm_password: String,
}

#[derive(Debug, Deserialize)]
struct ForgotForm {
    binding: String,
    csrf: String,
    email: String,
}

#[derive(Debug, Deserialize)]
struct RegisterForm {
    binding: String,
    csrf: String,
    email: String,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InviteRequest {
    email: String,
    display_name: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SecurityForm {
    csrf: String,
    code: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "step", rename_all = "snake_case")]
enum InteractionResponse {
    Login { csrf: String },
    Mfa { csrf: String },
    Consent { csrf: String, scopes: Vec<String> },
    Complete { redirect_to: String },
}

#[derive(Debug, Serialize)]
struct PublicFormContext {
    binding: String,
    csrf: String,
}

#[derive(Debug, Serialize)]
struct TokenFormContext {
    csrf: String,
}

#[derive(Debug, Serialize)]
struct SecurityContext {
    email: String,
    totp_enabled: bool,
    csrf: String,
}

async fn discovery(State(state): State<AppState>) -> Response {
    let auth = state.auth();
    Json(serde_json::json!({
        "issuer": auth.issuer(),
        "authorization_endpoint": endpoint(auth, "/oauth2/authorize"),
        "token_endpoint": endpoint(auth, "/oauth2/token"),
        "userinfo_endpoint": endpoint(auth, "/oauth2/userinfo"),
        "jwks_uri": endpoint(auth, "/oauth2/jwks"),
        "revocation_endpoint": endpoint(auth, "/oauth2/revoke"),
        "end_session_endpoint": endpoint(auth, "/oauth2/logout"),
        "scopes_supported": ALLOWED_SCOPES,
        "response_types_supported": ["code"],
        "response_modes_supported": ["query"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "subject_types_supported": ["public"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "token_endpoint_auth_methods_supported": ["none"],
        "code_challenge_methods_supported": ["S256"],
        "claims_supported": ["sub", "iss", "aud", "exp", "iat", "auth_time", "nonce", "at_hash", "sid", "email", "email_verified", "name"],
        "authorization_response_iss_parameter_supported": true,
    }))
    .into_response()
}

async fn jwks(State(state): State<AppState>) -> Response {
    let mut response = Json(state.auth().jwks()).into_response();
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("public, max-age=300"),
    );
    response
}

async fn authorize(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<AuthorizeQuery>,
) -> Response {
    let auth = state.auth();
    let scope = match validate_authorize(auth, &query) {
        Ok(scope) => scope,
        Err(error) => return error,
    };
    let request_secret = random_secret();
    let expires_at = Utc::now() + ChronoDuration::seconds(AUTHORIZATION_TTL_SECONDS);
    if sqlx::query(
        "INSERT INTO oidc_authorizations \
         (id, request_secret_hash, client_id, redirect_uri, scope, client_state, nonce, code_challenge, prompt, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(secret_hash(&request_secret))
    .bind(&query.client_id)
    .bind(&query.redirect_uri)
    .bind(&scope)
    .bind(&query.state)
    .bind(&query.nonce)
    .bind(&query.code_challenge)
    .bind(&query.prompt)
    .bind(expires_at.naive_utc())
    .execute(auth.pool())
    .await
    .is_err()
    {
        return landing_error(auth, "INTERNAL_ERROR", query.ui_locales.as_deref());
    }

    let force_login = prompt_contains(query.prompt.as_deref(), "login");
    let prompt_none = prompt_contains(query.prompt.as_deref(), "none");
    let session = if force_login {
        None
    } else {
        load_browser_session(auth, &jar).await.ok().flatten()
    };
    if let Some(session) = session {
        let authorization = match load_authorization(auth, &request_secret).await {
            Ok(value) => value,
            Err(_) => return landing_error(auth, "INTERNAL_ERROR", query.ui_locales.as_deref()),
        };
        let needs_consent = prompt_contains(query.prompt.as_deref(), "consent")
            || !has_consent(auth, &session.account_id, &scope)
                .await
                .unwrap_or(false);
        if needs_consent {
            if prompt_none {
                return authorization_error(auth, &authorization, "consent_required");
            }
            return landing_auth(auth, &request_secret, query.ui_locales.as_deref());
        }
        return issue_authorization_code(auth, &authorization, &session).await;
    }
    if prompt_none {
        let authorization = match load_authorization(auth, &request_secret).await {
            Ok(value) => value,
            Err(_) => return landing_error(auth, "INTERNAL_ERROR", query.ui_locales.as_deref()),
        };
        return authorization_error(auth, &authorization, "login_required");
    }
    landing_auth(auth, &request_secret, query.ui_locales.as_deref())
}

async fn interaction(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(form): Form<InteractionForm>,
) -> Response {
    let auth = state.auth();
    let authorization = match load_authorization(auth, &form.request).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::BAD_REQUEST, "REQUEST_EXPIRED", false),
    };
    let session = load_browser_session(auth, &jar).await.ok().flatten();
    auth_response(interaction_for(auth, &authorization, session.as_ref()))
}

async fn login(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Form(form): Form<LoginForm>,
) -> Response {
    let auth = state.auth();
    let ip = request_ip(auth, peer, &headers);
    if let Err(error) = auth
        .check_rate_limit(format!("login:{ip}"), 10, StdDuration::from_secs(60))
        .await
    {
        return error.into_response();
    }
    if !auth.verify_csrf(&form.request, "login", &form.csrf) {
        return auth_error(StatusCode::BAD_REQUEST, "REQUEST_EXPIRED", false);
    }
    let authorization = match load_authorization(auth, &form.request).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::BAD_REQUEST, "REQUEST_EXPIRED", false),
    };
    let identity = match auth.identity_by_email(&form.email).await {
        Ok(Some(identity)) => identity,
        Ok(None) | Err(AppError::BadRequest(_)) => {
            dummy_password_check(&form.password);
            return auth_error(StatusCode::UNAUTHORIZED, "BAD_CREDENTIALS", false);
        }
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let locked = identity
        .locked_until
        .is_some_and(|until| until > Utc::now());
    let valid = !locked
        && identity.status == "ACTIVE"
        && identity
            .password_hash
            .as_deref()
            .is_some_and(|hash| verify_password(&form.password, hash));
    if !valid {
        if !locked {
            let _ = record_login_failure(auth, &identity.id).await;
        }
        return auth_error(StatusCode::UNAUTHORIZED, "BAD_CREDENTIALS", false);
    }
    if reset_login_failures(auth, &identity.id).await.is_err() {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    let auth_time = Utc::now();
    if identity.totp_enabled_at.is_some() {
        if sqlx::query(
            "UPDATE oidc_authorizations SET account_id = ?, auth_time = ? \
             WHERE id = ? AND status = 'PENDING'",
        )
        .bind(&identity.id)
        .bind(auth_time.naive_utc())
        .bind(&authorization.id)
        .execute(auth.pool())
        .await
        .is_err()
        {
            return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
        }
        return auth_response(InteractionResponse::Mfa {
            csrf: auth.csrf_token(&form.request, "mfa-login"),
        });
    }
    finish_browser_login(auth, jar, authorization, identity, auth_time).await
}

async fn login_mfa(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    jar: CookieJar,
    Form(form): Form<MfaForm>,
) -> Response {
    let auth = state.auth();
    let ip = request_ip(auth, peer, &headers);
    if let Err(error) = auth
        .check_rate_limit(format!("mfa:{ip}"), 10, StdDuration::from_secs(60))
        .await
    {
        return error.into_response();
    }
    if !auth.verify_csrf(&form.request, "mfa-login", &form.csrf) {
        return auth_error(StatusCode::BAD_REQUEST, "VERIFICATION_EXPIRED", false);
    }
    let authorization = match load_authorization(auth, &form.request).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::BAD_REQUEST, "VERIFICATION_EXPIRED", false),
    };
    let Some(account_id) = authorization.account_id.as_deref() else {
        return auth_error(StatusCode::BAD_REQUEST, "PASSWORD_REQUIRED", false);
    };
    let identity = match auth.identity_by_id(account_id).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::BAD_REQUEST, "ACCOUNT_UNAVAILABLE", false),
    };
    match verify_second_factor(auth, &identity, &form.code).await {
        Ok(true) => {}
        Ok(false) => {
            let _ = record_login_failure(auth, &identity.id).await;
            return auth_error(StatusCode::UNAUTHORIZED, "MFA_INCORRECT", false);
        }
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    }
    if reset_login_failures(auth, &identity.id).await.is_err() {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    let auth_time = authorization.auth_time.unwrap_or_else(Utc::now);
    finish_browser_login(auth, jar, authorization, identity, auth_time).await
}

async fn finish_browser_login(
    auth: &AuthService,
    jar: CookieJar,
    authorization: Authorization,
    identity: Identity,
    auth_time: DateTime<Utc>,
) -> Response {
    let (session, cookie) = match create_browser_session(auth, &identity.id, auth_time).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let jar = jar.add(cookie);
    let needs_consent = prompt_contains(authorization.prompt.as_deref(), "consent")
        || !has_consent(auth, &identity.id, &authorization.scope)
            .await
            .unwrap_or(false);
    let response = if needs_consent {
        auth_response(interaction_for(auth, &authorization, Some(&session)))
    } else {
        match issue_authorization_code_url(auth, &authorization, &session).await {
            Ok(redirect_to) => auth_response(InteractionResponse::Complete { redirect_to }),
            Err(code) => auth_error(StatusCode::BAD_REQUEST, code, false),
        }
    };
    (jar, response).into_response()
}

async fn consent(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(form): Form<ConsentForm>,
) -> Response {
    let auth = state.auth();
    if !auth.verify_csrf(&form.request, "consent", &form.csrf) {
        return auth_error(StatusCode::BAD_REQUEST, "AUTHORIZATION_EXPIRED", false);
    }
    let authorization = match load_authorization(auth, &form.request).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::BAD_REQUEST, "AUTHORIZATION_EXPIRED", false),
    };
    let session = match load_browser_session(auth, &jar).await {
        Ok(Some(value)) => value,
        _ => return auth_error(StatusCode::UNAUTHORIZED, "AUTH_REQUIRED", false),
    };
    if form.decision != "allow" {
        let _ = sqlx::query("UPDATE oidc_authorizations SET status = 'DENIED' WHERE id = ?")
            .bind(&authorization.id)
            .execute(auth.pool())
            .await;
        return match authorization_error_url(auth, &authorization, "access_denied") {
            Ok(redirect_to) => auth_response(InteractionResponse::Complete { redirect_to }),
            Err(_) => auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
        };
    }
    if sqlx::query(
        "INSERT INTO oidc_consents (account_id, client_id, scope, granted_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6)) \
         ON DUPLICATE KEY UPDATE scope = VALUES(scope), granted_at = VALUES(granted_at), revoked_at = NULL",
    )
    .bind(&session.account_id)
    .bind(&authorization.client_id)
    .bind(&authorization.scope)
    .execute(auth.pool())
    .await
    .is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    match issue_authorization_code_url(auth, &authorization, &session).await {
        Ok(redirect_to) => auth_response(InteractionResponse::Complete { redirect_to }),
        Err(code) => auth_error(StatusCode::BAD_REQUEST, code, false),
    }
}

async fn token(State(state): State<AppState>, Form(form): Form<TokenForm>) -> Response {
    let auth = state.auth();
    if form.client_id.as_deref() != Some(auth.config().oidc_client_id.as_str()) {
        return oauth_token_error(StatusCode::UNAUTHORIZED, "invalid_client");
    }
    let result = match form.grant_type.as_str() {
        "authorization_code" => exchange_authorization_code(auth, &form).await,
        "refresh_token" => exchange_refresh_token(auth, &form).await,
        _ => Err(TokenExchangeError::UnsupportedGrant),
    };
    match result {
        Ok(token) => token_response(token),
        Err(TokenExchangeError::InvalidRequest) => {
            oauth_token_error(StatusCode::BAD_REQUEST, "invalid_request")
        }
        Err(TokenExchangeError::InvalidGrant) => {
            oauth_token_error(StatusCode::BAD_REQUEST, "invalid_grant")
        }
        Err(TokenExchangeError::UnsupportedGrant) => {
            oauth_token_error(StatusCode::BAD_REQUEST, "unsupported_grant_type")
        }
        Err(TokenExchangeError::Server) => {
            oauth_token_error(StatusCode::INTERNAL_SERVER_ERROR, "server_error")
        }
    }
}

#[derive(Debug)]
enum TokenExchangeError {
    InvalidRequest,
    InvalidGrant,
    UnsupportedGrant,
    Server,
}

async fn exchange_authorization_code(
    auth: &AuthService,
    form: &TokenForm,
) -> Result<TokenResponse, TokenExchangeError> {
    let code = form
        .code
        .as_deref()
        .ok_or(TokenExchangeError::InvalidRequest)?;
    let verifier = form
        .code_verifier
        .as_deref()
        .ok_or(TokenExchangeError::InvalidRequest)?;
    let redirect_uri = form
        .redirect_uri
        .as_deref()
        .ok_or(TokenExchangeError::InvalidRequest)?;
    if code.len() > 256 || !valid_pkce_verifier(verifier) {
        return Err(TokenExchangeError::InvalidRequest);
    }
    let mut tx = auth
        .pool()
        .begin()
        .await
        .map_err(|_| TokenExchangeError::Server)?;
    let row = sqlx::query(
        "SELECT id, account_id, browser_session_id, client_id, redirect_uri, scope, nonce, code_challenge, status, auth_time, expires_at \
         FROM oidc_authorizations WHERE code_hash = ? FOR UPDATE",
    )
    .bind(secret_hash(code))
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?
    .ok_or(TokenExchangeError::InvalidGrant)?;
    let status: String = row
        .try_get("status")
        .map_err(|_| TokenExchangeError::Server)?;
    let expires_at = row
        .try_get::<chrono::NaiveDateTime, _>("expires_at")
        .map_err(|_| TokenExchangeError::Server)?
        .and_utc();
    let client_id: String = row
        .try_get("client_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let saved_redirect: String = row
        .try_get("redirect_uri")
        .map_err(|_| TokenExchangeError::Server)?;
    let challenge: String = row
        .try_get("code_challenge")
        .map_err(|_| TokenExchangeError::Server)?;
    let calculated = pkce_challenge(verifier);
    let challenge_matches = challenge.len() == calculated.len()
        && challenge
            .as_bytes()
            .ct_eq(calculated.as_bytes())
            .unwrap_u8()
            == 1;
    if status != "CODE_ISSUED"
        || expires_at <= Utc::now()
        || client_id != auth.config().oidc_client_id
        || saved_redirect != redirect_uri
        || !challenge_matches
    {
        return Err(TokenExchangeError::InvalidGrant);
    }
    let authorization_id: String = row.try_get("id").map_err(|_| TokenExchangeError::Server)?;
    let account_id: String = row
        .try_get("account_id")
        .map_err(|_| TokenExchangeError::InvalidGrant)?;
    let browser_session_id: Option<String> = row
        .try_get("browser_session_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let scope: String = row
        .try_get("scope")
        .map_err(|_| TokenExchangeError::Server)?;
    let nonce: Option<String> = row
        .try_get("nonce")
        .map_err(|_| TokenExchangeError::Server)?;
    let auth_time = row
        .try_get::<Option<chrono::NaiveDateTime>, _>("auth_time")
        .map_err(|_| TokenExchangeError::Server)?
        .map(|value| value.and_utc())
        .ok_or(TokenExchangeError::InvalidGrant)?;
    let identity = auth
        .identity_by_id_for_update(&mut tx, &account_id)
        .await
        .map_err(|_| TokenExchangeError::InvalidGrant)?;
    if identity.status != "ACTIVE" {
        return Err(TokenExchangeError::InvalidGrant);
    }
    let pair = auth
        .issue_token_pair(
            &identity,
            &scope,
            nonce,
            auth_time,
            browser_session_id.clone(),
        )
        .map_err(|_| TokenExchangeError::Server)?;
    sqlx::query(
        "UPDATE oidc_authorizations SET status = 'CONSUMED', consumed_at = UTC_TIMESTAMP(6) WHERE id = ?",
    )
    .bind(authorization_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?;
    let refresh_token = if scope_set(&scope).contains("offline_access") {
        Some(
            insert_initial_refresh_token(
                &mut tx,
                &account_id,
                browser_session_id.as_deref(),
                &client_id,
                &scope,
            )
            .await?,
        )
    } else {
        None
    };
    tx.commit().await.map_err(|_| TokenExchangeError::Server)?;
    Ok(TokenResponse {
        access_token: pair.access_token,
        id_token: pair.id_token,
        refresh_token,
        expires_in: pair.expires_in,
        token_type: pair.token_type,
        scope: pair.scope,
    })
}

async fn exchange_refresh_token(
    auth: &AuthService,
    form: &TokenForm,
) -> Result<TokenResponse, TokenExchangeError> {
    let refresh = form
        .refresh_token
        .as_deref()
        .ok_or(TokenExchangeError::InvalidRequest)?;
    if refresh.is_empty() || refresh.len() > 512 {
        return Err(TokenExchangeError::InvalidRequest);
    }
    let mut tx = auth
        .pool()
        .begin()
        .await
        .map_err(|_| TokenExchangeError::Server)?;
    let row = sqlx::query(
        "SELECT id, family_id, account_id, browser_session_id, client_id, scope, replaced_by_id, issued_at, expires_at, family_expires_at, revoked_at \
         FROM oidc_refresh_tokens WHERE token_hash = ? FOR UPDATE",
    )
    .bind(secret_hash(refresh))
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?
    .ok_or(TokenExchangeError::InvalidGrant)?;
    let family_id: String = row
        .try_get("family_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let replaced: Option<String> = row
        .try_get("replaced_by_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let revoked: Option<chrono::NaiveDateTime> = row
        .try_get("revoked_at")
        .map_err(|_| TokenExchangeError::Server)?;
    if replaced.is_some() || revoked.is_some() {
        revoke_refresh_family(&mut tx, &family_id).await?;
        tx.commit().await.map_err(|_| TokenExchangeError::Server)?;
        return Err(TokenExchangeError::InvalidGrant);
    }
    let expires_at = row
        .try_get::<chrono::NaiveDateTime, _>("expires_at")
        .map_err(|_| TokenExchangeError::Server)?
        .and_utc();
    let family_expires_at = row
        .try_get::<chrono::NaiveDateTime, _>("family_expires_at")
        .map_err(|_| TokenExchangeError::Server)?
        .and_utc();
    if expires_at <= Utc::now() || family_expires_at <= Utc::now() {
        revoke_refresh_family(&mut tx, &family_id).await?;
        tx.commit().await.map_err(|_| TokenExchangeError::Server)?;
        return Err(TokenExchangeError::InvalidGrant);
    }
    let account_id: String = row
        .try_get("account_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let identity = auth
        .identity_by_id_for_update(&mut tx, &account_id)
        .await
        .map_err(|_| TokenExchangeError::InvalidGrant)?;
    if identity.status != "ACTIVE" {
        revoke_refresh_family(&mut tx, &family_id).await?;
        tx.commit().await.map_err(|_| TokenExchangeError::Server)?;
        return Err(TokenExchangeError::InvalidGrant);
    }
    let old_id: String = row.try_get("id").map_err(|_| TokenExchangeError::Server)?;
    let browser_session_id: Option<String> = row
        .try_get("browser_session_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let client_id: String = row
        .try_get("client_id")
        .map_err(|_| TokenExchangeError::Server)?;
    let scope: String = row
        .try_get("scope")
        .map_err(|_| TokenExchangeError::Server)?;
    let issued_at = row
        .try_get::<chrono::NaiveDateTime, _>("issued_at")
        .map_err(|_| TokenExchangeError::Server)?
        .and_utc();
    let new_raw = random_secret();
    let new_id = Uuid::new_v4().to_string();
    let new_expires = std::cmp::min(
        Utc::now() + ChronoDuration::days(REFRESH_TOKEN_TTL_DAYS),
        family_expires_at,
    );
    sqlx::query(
        "INSERT INTO oidc_refresh_tokens \
         (id, token_hash, family_id, account_id, browser_session_id, client_id, scope, issued_at, expires_at, family_expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?)",
    )
    .bind(&new_id)
    .bind(secret_hash(&new_raw))
    .bind(&family_id)
    .bind(&account_id)
    .bind(&browser_session_id)
    .bind(&client_id)
    .bind(&scope)
    .bind(new_expires.naive_utc())
    .bind(family_expires_at.naive_utc())
    .execute(&mut *tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?;
    sqlx::query(
        "UPDATE oidc_refresh_tokens SET replaced_by_id = ?, last_used_at = UTC_TIMESTAMP(6), revoked_at = UTC_TIMESTAMP(6) WHERE id = ?",
    )
    .bind(&new_id)
    .bind(old_id)
    .execute(&mut *tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?;
    let auth_time = if let Some(session_id) = browser_session_id.as_deref() {
        sqlx::query_scalar::<_, chrono::NaiveDateTime>(
            "SELECT auth_time FROM oidc_browser_sessions WHERE id = ?",
        )
        .bind(session_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| TokenExchangeError::Server)?
        .map(|value| value.and_utc())
        .unwrap_or(issued_at)
    } else {
        issued_at
    };
    let pair = auth
        .issue_token_pair(
            &identity,
            &scope,
            None,
            auth_time,
            browser_session_id.clone(),
        )
        .map_err(|_| TokenExchangeError::Server)?;
    tx.commit().await.map_err(|_| TokenExchangeError::Server)?;
    Ok(TokenResponse {
        access_token: pair.access_token,
        id_token: pair.id_token,
        refresh_token: Some(new_raw),
        expires_in: pair.expires_in,
        token_type: pair.token_type,
        scope: pair.scope,
    })
}

async fn insert_initial_refresh_token(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
    browser_session_id: Option<&str>,
    client_id: &str,
    scope: &str,
) -> Result<String, TokenExchangeError> {
    let raw = random_secret();
    let now = Utc::now();
    let expires_at = now + ChronoDuration::days(REFRESH_TOKEN_TTL_DAYS);
    let family_expires_at = now + ChronoDuration::days(REFRESH_FAMILY_TTL_DAYS);
    sqlx::query(
        "INSERT INTO oidc_refresh_tokens \
         (id, token_hash, family_id, account_id, browser_session_id, client_id, scope, issued_at, expires_at, family_expires_at) \
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(secret_hash(&raw))
    .bind(Uuid::new_v4().to_string())
    .bind(account_id)
    .bind(browser_session_id)
    .bind(client_id)
    .bind(scope)
    .bind(now.naive_utc())
    .bind(expires_at.naive_utc())
    .bind(family_expires_at.naive_utc())
    .execute(&mut **tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?;
    Ok(raw)
}

async fn revoke_refresh_family(
    tx: &mut Transaction<'_, MySql>,
    family_id: &str,
) -> Result<(), TokenExchangeError> {
    sqlx::query(
        "UPDATE oidc_refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE family_id = ?",
    )
    .bind(family_id)
    .execute(&mut **tx)
    .await
    .map_err(|_| TokenExchangeError::Server)?;
    Ok(())
}

async fn userinfo(State(state): State<AppState>, headers: HeaderMap) -> Response {
    let claims = match state.auth().authenticate(&headers).await {
        Ok(value) => value,
        Err(_) => return bearer_error(),
    };
    let identity = match state.auth().identity_by_id(&claims.sub).await {
        Ok(value) if value.status == "ACTIVE" => value,
        _ => return bearer_error(),
    };
    Json(serde_json::json!({
        "sub": identity.id,
        "email": identity.email,
        "email_verified": true,
        "name": identity.display_name,
    }))
    .into_response()
}

async fn revoke(State(state): State<AppState>, Form(form): Form<RevokeForm>) -> Response {
    let auth = state.auth();
    if form.client_id.as_deref() != Some(auth.config().oidc_client_id.as_str())
        || form.token.is_empty()
        || form.token.len() > 512
    {
        return oauth_token_error(StatusCode::UNAUTHORIZED, "invalid_client");
    }
    let _hint = form.token_type_hint.as_deref();
    if let Ok(mut tx) = auth.pool().begin().await {
        if let Ok(Some(family_id)) = sqlx::query_scalar::<_, String>(
            "SELECT family_id FROM oidc_refresh_tokens WHERE token_hash = ? FOR UPDATE",
        )
        .bind(secret_hash(&form.token))
        .fetch_optional(&mut *tx)
        .await
        {
            let _ = revoke_refresh_family(&mut tx, &family_id).await;
        }
        let _ = tx.commit().await;
    }
    no_store(StatusCode::OK.into_response())
}

async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
    Query(query): Query<LogoutQuery>,
) -> Response {
    complete_logout(state.auth(), jar, query).await
}

async fn logout_post(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(query): Form<LogoutQuery>,
) -> Response {
    complete_logout(state.auth(), jar, query).await
}

async fn complete_logout(auth: &AuthService, jar: CookieJar, query: LogoutQuery) -> Response {
    let (account_id, session_id) = match query
        .id_token_hint
        .as_deref()
        .ok_or(AppError::Unauthorized)
        .and_then(|token| auth.verify_id_token_hint(token))
    {
        Ok((account_id, Some(session_id))) => (account_id, session_id),
        _ => return landing_error(auth, "INVALID_LOGOUT", None),
    };
    if revoke_session(auth, &session_id, &account_id)
        .await
        .is_err()
    {
        return landing_error(auth, "INVALID_LOGOUT", None);
    }
    let jar = jar.remove(removal_cookie(auth));
    let response = if let Some(target) = query.post_logout_redirect_uri {
        if target != auth.config().oidc_post_logout_redirect_uri {
            landing_error(auth, "INVALID_POST_LOGOUT", None)
        } else {
            let mut url = match url::Url::parse(&target) {
                Ok(value) => value,
                Err(_) => return landing_error(auth, "INVALID_POST_LOGOUT", None),
            };
            if let Some(state) = query.state {
                url.query_pairs_mut().append_pair("state", &state);
            }
            Redirect::to(url.as_str()).into_response()
        }
    } else {
        landing_redirect(auth, "/auth/signed-out", &[])
    };
    (jar, response).into_response()
}

async fn register_page(State(state): State<AppState>) -> Response {
    landing_redirect(state.auth(), "/auth/register", &[])
}

async fn register_context(State(state): State<AppState>) -> Response {
    let binding = random_secret();
    auth_response(PublicFormContext {
        csrf: state.auth().csrf_token(&binding, "register"),
        binding,
    })
}

async fn register_account(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Form(form): Form<RegisterForm>,
) -> Response {
    let auth = state.auth();
    let ip = request_ip(auth, peer, &headers);
    if let Err(error) = auth
        .check_rate_limit(format!("register:{ip}"), 3, StdDuration::from_secs(60 * 60))
        .await
    {
        return error.into_response();
    }
    if !auth.verify_csrf(&form.binding, "register", &form.csrf) {
        return auth_error(StatusCode::BAD_REQUEST, "REQUEST_EXPIRED", false);
    }
    let normalized = match normalize_email(&form.email) {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::BAD_REQUEST, "INVALID_EMAIL", false),
    };
    let display_name = form
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if display_name
        .as_deref()
        .is_none_or(|value| value.chars().count() > 128)
    {
        return auth_error(StatusCode::BAD_REQUEST, "INVALID_DISPLAY_NAME", false);
    }

    let mut tx = match auth.pool().begin().await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let account_id = match pending_account_tx(
        &mut tx,
        form.email.trim(),
        &normalized,
        display_name.as_deref(),
    )
    .await
    {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let Some(account_id) = account_id else {
        return auth_response(serde_json::json!({ "status": "check_email" }));
    };
    let recently_sent = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM oidc_action_tokens \
         WHERE account_id = ? AND kind = 'INVITE' AND created_at > UTC_TIMESTAMP(6) - INTERVAL 15 MINUTE",
    )
    .bind(&account_id)
    .fetch_one(&mut *tx)
    .await
    .unwrap_or(1)
        > 0;
    if recently_sent {
        if tx.commit().await.is_err() {
            return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
        }
        return auth_response(serde_json::json!({ "status": "check_email" }));
    }
    let token = match replace_setup_token_tx(&mut tx, &account_id).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    if insert_security_event_tx(
        &mut tx,
        Some(&account_id),
        "ACCOUNT_REGISTRATION_REQUESTED",
        serde_json::json!({}),
    )
    .await
    .is_err()
        || tx.commit().await.is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    let mailer = auth.clone();
    let email = form.email.trim().to_owned();
    state.tracker().spawn(async move {
        let _ = mailer
            .send_registration(&email, display_name.as_deref(), &token)
            .await;
    });
    auth_response(serde_json::json!({ "status": "check_email" }))
}

async fn setup_page(State(state): State<AppState>, Query(query): Query<ActionQuery>) -> Response {
    landing_redirect(state.auth(), "/auth/setup", &[("token", &query.token)])
}

async fn setup_context(State(state): State<AppState>, Form(query): Form<ActionQuery>) -> Response {
    token_context(state.auth(), &query.token, "INVITE").await
}

async fn setup_account(
    State(state): State<AppState>,
    Form(form): Form<PasswordActionForm>,
) -> Response {
    complete_password_action(state.auth(), form, "INVITE").await
}

async fn reset_page(State(state): State<AppState>, Query(query): Query<ActionQuery>) -> Response {
    landing_redirect(
        state.auth(),
        "/auth/reset-password",
        &[("token", &query.token)],
    )
}

async fn reset_context(State(state): State<AppState>, Form(query): Form<ActionQuery>) -> Response {
    token_context(state.auth(), &query.token, "RESET").await
}

async fn reset_password(
    State(state): State<AppState>,
    Form(form): Form<PasswordActionForm>,
) -> Response {
    complete_password_action(state.auth(), form, "RESET").await
}

async fn complete_password_action(
    auth: &AuthService,
    form: PasswordActionForm,
    kind: &'static str,
) -> Response {
    if !auth.verify_csrf(&form.token, kind, &form.csrf) {
        return auth_error(StatusCode::BAD_REQUEST, "INVALID_OR_EXPIRED_LINK", false);
    }
    if form.password != form.confirm_password {
        return auth_error(StatusCode::BAD_REQUEST, "PASSWORD_MISMATCH", false);
    }
    let password_hash = match hash_password(&form.password) {
        Ok(value) => value,
        Err(AppError::BadRequest(_)) => {
            return auth_error(StatusCode::BAD_REQUEST, "INVALID_PASSWORD", false)
        }
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let mut tx = match auth.pool().begin().await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let row = match sqlx::query(
        "SELECT account_id FROM oidc_action_tokens \
         WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(6) FOR UPDATE",
    )
    .bind(secret_hash(&form.token))
    .bind(kind)
    .fetch_optional(&mut *tx)
    .await
    {
        Ok(Some(value)) => value,
        Ok(None) => {
            return auth_error(StatusCode::BAD_REQUEST, "INVALID_OR_EXPIRED_LINK", false)
        }
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let account_id: String = match row.try_get("account_id") {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let account_update = if kind == "INVITE" {
        sqlx::query(
            "UPDATE accounts SET password_hash = ?, email_verified_at = UTC_TIMESTAMP(6), \
                    status = 'ACTIVE', failed_login_count = 0, locked_until = NULL \
             WHERE id = ? AND status = 'PENDING'",
        )
        .bind(&password_hash)
        .bind(&account_id)
        .execute(&mut *tx)
        .await
    } else {
        sqlx::query(
            "UPDATE accounts SET password_hash = ?, failed_login_count = 0, locked_until = NULL \
             WHERE id = ? AND status = 'ACTIVE'",
        )
        .bind(&password_hash)
        .bind(&account_id)
        .execute(&mut *tx)
        .await
    };
    if !matches!(account_update, Ok(ref result) if result.rows_affected() == 1) {
        return auth_error(StatusCode::BAD_REQUEST, "INVALID_OR_EXPIRED_LINK", false);
    }
    if sqlx::query(
        "UPDATE oidc_action_tokens SET used_at = UTC_TIMESTAMP(6) \
             WHERE account_id = ? AND used_at IS NULL",
    )
    .bind(&account_id)
    .execute(&mut *tx)
    .await
    .is_err()
        || revoke_account_credentials_tx(&mut tx, &account_id)
            .await
            .is_err()
        || tx.commit().await.is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    auth_response(serde_json::json!({ "status": "password_saved" }))
}

async fn forgot_page(State(state): State<AppState>) -> Response {
    landing_redirect(state.auth(), "/auth/forgot-password", &[])
}

async fn forgot_context(State(state): State<AppState>) -> Response {
    let binding = random_secret();
    auth_response(PublicFormContext {
        csrf: state.auth().csrf_token(&binding, "forgot-password"),
        binding,
    })
}

async fn request_password_reset(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Form(form): Form<ForgotForm>,
) -> Response {
    let auth = state.auth();
    let ip = request_ip(auth, peer, &headers);
    if let Err(error) = auth
        .check_rate_limit(format!("reset:{ip}"), 3, StdDuration::from_secs(60 * 60))
        .await
    {
        return error.into_response();
    }
    if !auth.verify_csrf(&form.binding, "forgot-password", &form.csrf) {
        return auth_error(StatusCode::BAD_REQUEST, "REQUEST_EXPIRED", false);
    }
    let identity = match auth.identity_by_email(&form.email).await {
        Ok(value) => value,
        Err(AppError::BadRequest(_)) => {
            return auth_error(StatusCode::BAD_REQUEST, "INVALID_EMAIL", false)
        }
        Err(_) => None,
    };
    if let Some(identity) = identity {
        if identity.status == "ACTIVE" {
            let recently_sent = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM oidc_action_tokens \
                 WHERE account_id = ? AND kind = 'RESET' AND created_at > UTC_TIMESTAMP(6) - INTERVAL 15 MINUTE",
            )
            .bind(&identity.id)
            .fetch_one(auth.pool())
            .await
            .unwrap_or(1)
                > 0;
            if !recently_sent {
                let token = random_secret();
                let expires = Utc::now() + ChronoDuration::minutes(RESET_TTL_MINUTES);
                if sqlx::query(
                    "INSERT INTO oidc_action_tokens (id, account_id, kind, token_hash, expires_at) \
                     VALUES (?, ?, 'RESET', ?, ?)",
                )
                .bind(Uuid::new_v4().to_string())
                .bind(&identity.id)
                .bind(secret_hash(&token))
                .bind(expires.naive_utc())
                .execute(auth.pool())
                .await
                .is_ok()
                {
                    let mailer = auth.clone();
                    let email = identity.email;
                    let display_name = identity.display_name;
                    state.tracker().spawn(async move {
                        let _ = mailer
                            .send_password_reset(&email, display_name.as_deref(), &token)
                            .await;
                    });
                }
            }
        }
    }
    auth_response(serde_json::json!({ "status": "check_email" }))
}

async fn invite_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<InviteRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(state.config(), &headers)?;
    let actor = admin_actor(&headers)?;
    let normalized = normalize_email(&request.email)?;
    let display_name = request
        .display_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    if display_name
        .as_deref()
        .is_some_and(|value| value.chars().count() > 128)
    {
        return Err(AppError::BadRequest("Display name is too long."));
    }
    let mut tx = state.auth().pool().begin().await?;
    let account_id = pending_account_tx(
        &mut tx,
        request.email.trim(),
        &normalized,
        display_name.as_deref(),
    )
    .await?
    .ok_or(AppError::AlreadyExists)?;
    let token = replace_setup_token_tx(&mut tx, &account_id).await?;
    insert_security_event_tx(
        &mut tx,
        Some(&account_id),
        "ACCOUNT_INVITED",
        serde_json::json!({ "actor": actor }),
    )
    .await?;
    tx.commit().await?;
    state
        .auth()
        .send_invitation(request.email.trim(), display_name.as_deref(), &token)
        .await?;
    Ok(Json(serde_json::json!({ "account_id": account_id })))
}

async fn pending_account_tx(
    tx: &mut Transaction<'_, MySql>,
    email: &str,
    normalized_email: &str,
    display_name: Option<&str>,
) -> Result<Option<String>, AppError> {
    let existing =
        sqlx::query("SELECT id, status FROM accounts WHERE normalized_email = ? FOR UPDATE")
            .bind(normalized_email)
            .fetch_optional(&mut **tx)
            .await?;
    if let Some(row) = existing {
        let status: String = row.try_get("status")?;
        if status != "PENDING" {
            return Ok(None);
        }
        let id: String = row.try_get("id")?;
        sqlx::query("UPDATE accounts SET email = ?, display_name = ? WHERE id = ?")
            .bind(email)
            .bind(display_name)
            .bind(&id)
            .execute(&mut **tx)
            .await?;
        return Ok(Some(id));
    }

    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO accounts (id, email, normalized_email, display_name, status) \
         VALUES (?, ?, ?, ?, 'PENDING')",
    )
    .bind(&id)
    .bind(email)
    .bind(normalized_email)
    .bind(display_name)
    .execute(&mut **tx)
    .await?;
    Ok(Some(id))
}

async fn replace_setup_token_tx(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
) -> Result<String, AppError> {
    sqlx::query(
        "UPDATE oidc_action_tokens SET used_at = UTC_TIMESTAMP(6) \
         WHERE account_id = ? AND kind = 'INVITE' AND used_at IS NULL",
    )
    .bind(account_id)
    .execute(&mut **tx)
    .await?;
    let token = random_secret();
    let expires = Utc::now() + ChronoDuration::hours(INVITATION_TTL_HOURS);
    sqlx::query(
        "INSERT INTO oidc_action_tokens (id, account_id, kind, token_hash, expires_at) \
         VALUES (?, ?, 'INVITE', ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(account_id)
    .bind(secret_hash(&token))
    .bind(expires.naive_utc())
    .execute(&mut **tx)
    .await?;
    Ok(token)
}

async fn suspend_account(
    State(state): State<AppState>,
    axum::extract::Path(account_id): axum::extract::Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    set_account_status(&state, &headers, &account_id, "SUSPENDED").await
}

async fn activate_account(
    State(state): State<AppState>,
    axum::extract::Path(account_id): axum::extract::Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    set_account_status(&state, &headers, &account_id, "ACTIVE").await
}

async fn set_account_status(
    state: &AppState,
    headers: &HeaderMap,
    account_id: &str,
    status: &'static str,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(state.config(), headers)?;
    let actor = admin_actor(headers)?;
    let mut tx = state.auth().pool().begin().await?;
    let result = sqlx::query(
        "UPDATE accounts SET status = ? WHERE id = ? AND status NOT IN ('PENDING', 'CLOSED')",
    )
    .bind(status)
    .bind(account_id)
    .execute(&mut *tx)
    .await?;
    if result.rows_affected() != 1 {
        return Err(AppError::NotFound);
    }
    if status == "SUSPENDED" {
        revoke_account_credentials_tx(&mut tx, account_id).await?;
    }
    insert_security_event_tx(
        &mut tx,
        Some(account_id),
        if status == "SUSPENDED" {
            "ACCOUNT_SUSPENDED"
        } else {
            "ACCOUNT_ACTIVATED"
        },
        serde_json::json!({ "actor": actor }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        serde_json::json!({ "account_id": account_id, "status": status }),
    ))
}

async fn revoke_account_sessions(
    State(state): State<AppState>,
    axum::extract::Path(account_id): axum::extract::Path<String>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(state.config(), &headers)?;
    let actor = admin_actor(&headers)?;
    state.auth().identity_by_id(&account_id).await?;
    let mut tx = state.auth().pool().begin().await?;
    revoke_account_credentials_tx(&mut tx, &account_id).await?;
    insert_security_event_tx(
        &mut tx,
        Some(&account_id),
        "ACCOUNT_SESSIONS_REVOKED",
        serde_json::json!({ "actor": actor }),
    )
    .await?;
    tx.commit().await?;
    Ok(Json(
        serde_json::json!({ "account_id": account_id, "revoked": true }),
    ))
}

async fn security_page(State(state): State<AppState>) -> Response {
    landing_redirect(state.auth(), "/auth/security", &[])
}

async fn security_context(State(state): State<AppState>, jar: CookieJar) -> Response {
    let auth = state.auth();
    let session = match load_browser_session(auth, &jar).await {
        Ok(Some(value)) => value,
        _ => return auth_error(StatusCode::UNAUTHORIZED, "AUTH_REQUIRED", false),
    };
    let identity = match auth.identity_by_id(&session.account_id).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    auth_response(SecurityContext {
        email: identity.email,
        totp_enabled: identity.totp_enabled_at.is_some(),
        csrf: auth.csrf_token(&session.raw_token, "security"),
    })
}

async fn start_totp(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(form): Form<SecurityForm>,
) -> Response {
    let auth = state.auth();
    let session = match require_security_session(auth, &jar, &form.csrf).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let identity = match auth.identity_by_id(&session.account_id).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    if identity.totp_enabled_at.is_some() {
        return auth_error(StatusCode::CONFLICT, "TOTP_ALREADY_ENABLED", false);
    }
    let secret = TotpSecret::generate_secret();
    let secret_bytes = match secret.to_bytes() {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let (kid, nonce, ciphertext) = match auth.encrypt_secret(&identity.id, &secret_bytes) {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    if sqlx::query(
        "UPDATE oidc_browser_sessions SET pending_totp_ciphertext = ?, pending_totp_nonce = ?, pending_totp_key_id = ? WHERE id = ?",
    )
    .bind(ciphertext)
    .bind(nonce.as_slice())
    .bind(kid)
    .bind(&session.id)
    .execute(auth.pool())
    .await
    .is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    let totp = match build_totp(secret_bytes, &identity.email) {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let qr = match totp.get_qr_base64() {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    auth_response(serde_json::json!({
        "qr_base64": qr,
        "secret": secret.to_encoded().to_string(),
        "csrf": auth.csrf_token(&session.raw_token, "security"),
    }))
}

async fn confirm_totp(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(form): Form<SecurityForm>,
) -> Response {
    let auth = state.auth();
    let session = match require_security_session(auth, &jar, &form.csrf).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let code = form.code.as_deref().unwrap_or("").trim();
    let row = match sqlx::query(
        "SELECT pending_totp_ciphertext, pending_totp_nonce, pending_totp_key_id \
         FROM oidc_browser_sessions WHERE id = ?",
    )
    .bind(&session.id)
    .fetch_optional(auth.pool())
    .await
    {
        Ok(Some(value)) => value,
        _ => return auth_error(StatusCode::BAD_REQUEST, "TOTP_RESTART", false),
    };
    let ciphertext: Option<Vec<u8>> = row.try_get("pending_totp_ciphertext").ok();
    let nonce: Option<Vec<u8>> = row.try_get("pending_totp_nonce").ok();
    let kid: Option<String> = row.try_get("pending_totp_key_id").ok();
    let (Some(ciphertext), Some(nonce), Some(kid)) = (ciphertext, nonce, kid) else {
        return auth_error(StatusCode::BAD_REQUEST, "TOTP_RESTART", false);
    };
    let secret = match auth.decrypt_secret(&session.account_id, &kid, &nonce, &ciphertext) {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let identity = match auth.identity_by_id(&session.account_id).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let now = Utc::now().timestamp().max(0) as u64;
    let step = build_totp(secret, &identity.email)
        .ok()
        .and_then(|totp| matching_totp_step(&totp, code, now));
    let Some(step) = step else {
        return auth_error(StatusCode::BAD_REQUEST, "TOTP_INCORRECT", false);
    };
    let mut tx = match auth.pool().begin().await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    if sqlx::query(
        "UPDATE accounts SET totp_secret_ciphertext = ?, totp_secret_nonce = ?, totp_key_id = ?, \
                totp_enabled_at = UTC_TIMESTAMP(6), totp_last_used_step = ? WHERE id = ?",
    )
    .bind(&ciphertext)
    .bind(&nonce)
    .bind(&kid)
    .bind(step)
    .bind(&session.account_id)
    .execute(&mut *tx)
    .await
    .is_err()
        || sqlx::query("DELETE FROM oidc_recovery_codes WHERE account_id = ?")
            .bind(&session.account_id)
            .execute(&mut *tx)
            .await
            .is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    let recovery_codes = generate_recovery_codes();
    for code in &recovery_codes {
        if sqlx::query(
            "INSERT INTO oidc_recovery_codes (id, account_id, code_hash) VALUES (?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&session.account_id)
        .bind(secret_hash(&normalize_recovery_code(code)))
        .execute(&mut *tx)
        .await
        .is_err()
        {
            return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
        }
    }
    if sqlx::query(
        "UPDATE oidc_browser_sessions SET pending_totp_ciphertext = NULL, pending_totp_nonce = NULL, pending_totp_key_id = NULL WHERE id = ?",
    )
    .bind(&session.id)
    .execute(&mut *tx)
    .await
    .is_err()
        || tx.commit().await.is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    auth_response(serde_json::json!({ "recovery_codes": recovery_codes }))
}

async fn disable_totp(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(form): Form<SecurityForm>,
) -> Response {
    let auth = state.auth();
    let session = match require_security_session(auth, &jar, &form.csrf).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let identity = match auth.identity_by_id(&session.account_id).await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    let password_valid = form
        .password
        .as_deref()
        .zip(identity.password_hash.as_deref())
        .is_some_and(|(password, hash)| verify_password(password, hash));
    if !password_valid {
        return auth_error(StatusCode::UNAUTHORIZED, "DISABLE_MFA_FAILED", false);
    }
    let factor_valid = match form.code.as_deref() {
        Some(code) => verify_second_factor(auth, &identity, code)
            .await
            .unwrap_or(false),
        None => false,
    };
    if !factor_valid {
        return auth_error(StatusCode::UNAUTHORIZED, "DISABLE_MFA_FAILED", false);
    }
    let mut tx = match auth.pool().begin().await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    if sqlx::query(
        "UPDATE accounts SET totp_secret_ciphertext = NULL, totp_secret_nonce = NULL, totp_key_id = NULL, \
                totp_enabled_at = NULL, totp_last_used_step = NULL WHERE id = ?",
    )
    .bind(&session.account_id)
    .execute(&mut *tx)
    .await
    .is_err()
        || sqlx::query("DELETE FROM oidc_recovery_codes WHERE account_id = ?")
            .bind(&session.account_id)
            .execute(&mut *tx)
            .await
            .is_err()
        || tx.commit().await.is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    auth_response(serde_json::json!({ "status": "totp_disabled" }))
}

async fn revoke_other_sessions(
    State(state): State<AppState>,
    jar: CookieJar,
    Form(form): Form<SecurityForm>,
) -> Response {
    let auth = state.auth();
    let session = match require_security_session(auth, &jar, &form.csrf).await {
        Ok(value) => value,
        Err(response) => return response,
    };
    let mut tx = match auth.pool().begin().await {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    if sqlx::query(
        "UPDATE oidc_browser_sessions SET revoked_at = UTC_TIMESTAMP(6) \
         WHERE account_id = ? AND id <> ? AND revoked_at IS NULL",
    )
    .bind(&session.account_id)
    .bind(&session.id)
    .execute(&mut *tx)
    .await
    .is_err()
        || sqlx::query(
            "UPDATE oidc_refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) \
             WHERE account_id = ? AND (browser_session_id IS NULL OR browser_session_id <> ?)",
        )
        .bind(&session.account_id)
        .bind(&session.id)
        .execute(&mut *tx)
        .await
        .is_err()
        || tx.commit().await.is_err()
    {
        return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true);
    }
    auth_response(serde_json::json!({ "status": "other_sessions_revoked" }))
}

fn validate_authorize(auth: &AuthService, query: &AuthorizeQuery) -> Result<String, Response> {
    if query.client_id != auth.config().oidc_client_id
        || query.redirect_uri != auth.config().oidc_redirect_uri
    {
        return Err(landing_error(
            auth,
            "INVALID_CLIENT",
            query.ui_locales.as_deref(),
        ));
    }
    if query.response_type != "code"
        || query.code_challenge_method != "S256"
        || !valid_pkce_challenge(&query.code_challenge)
        || query.state.is_empty()
        || query.state.len() > 512
        || query
            .nonce
            .as_deref()
            .is_some_and(|value| value.len() > 255)
    {
        return Err(authorize_query_error(auth, query, "invalid_request"));
    }
    if let Some(prompt) = query.prompt.as_deref() {
        let values = prompt.split_ascii_whitespace().collect::<BTreeSet<_>>();
        if values.contains("none") && values.len() > 1
            || values
                .iter()
                .any(|value| !matches!(*value, "none" | "login" | "consent"))
        {
            return Err(authorize_query_error(auth, query, "invalid_request"));
        }
    }
    canonical_scope(&query.scope).ok_or_else(|| authorize_query_error(auth, query, "invalid_scope"))
}

fn canonical_scope(value: &str) -> Option<String> {
    let scopes = value.split_ascii_whitespace().collect::<BTreeSet<_>>();
    if !scopes.contains("openid") || scopes.iter().any(|scope| !ALLOWED_SCOPES.contains(scope)) {
        return None;
    }
    Some(
        ALLOWED_SCOPES
            .into_iter()
            .filter(|scope| scopes.contains(scope))
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn scope_set(value: &str) -> BTreeSet<&str> {
    value.split_ascii_whitespace().collect()
}

fn prompt_contains(prompt: Option<&str>, expected: &str) -> bool {
    prompt.is_some_and(|value| value.split_ascii_whitespace().any(|part| part == expected))
}

async fn load_authorization(
    auth: &AuthService,
    request_secret: &str,
) -> Result<Authorization, AppError> {
    if request_secret.is_empty() || request_secret.len() > 256 {
        return Err(AppError::BadRequest("Invalid authorization request."));
    }
    let row = sqlx::query(
        "SELECT id, client_id, redirect_uri, scope, client_state, prompt, account_id, auth_time \
         FROM oidc_authorizations \
         WHERE request_secret_hash = ? AND status = 'PENDING' AND expires_at > UTC_TIMESTAMP(6)",
    )
    .bind(secret_hash(request_secret))
    .fetch_optional(auth.pool())
    .await?
    .ok_or(AppError::BadRequest("Invalid authorization request."))?;
    Ok(Authorization {
        id: row.try_get("id")?,
        request_secret: request_secret.to_owned(),
        client_id: row.try_get("client_id")?,
        redirect_uri: row.try_get("redirect_uri")?,
        scope: row.try_get("scope")?,
        client_state: row.try_get("client_state")?,
        prompt: row.try_get("prompt")?,
        account_id: row.try_get("account_id")?,
        auth_time: row
            .try_get::<Option<chrono::NaiveDateTime>, _>("auth_time")?
            .map(|value| value.and_utc()),
    })
}

async fn has_consent(auth: &AuthService, account_id: &str, scope: &str) -> Result<bool, AppError> {
    let saved = sqlx::query_scalar::<_, String>(
        "SELECT scope FROM oidc_consents \
         WHERE account_id = ? AND client_id = ? AND revoked_at IS NULL",
    )
    .bind(account_id)
    .bind(&auth.config().oidc_client_id)
    .fetch_optional(auth.pool())
    .await?;
    Ok(saved.as_deref() == Some(scope))
}

async fn issue_authorization_code(
    auth: &AuthService,
    authorization: &Authorization,
    session: &BrowserSession,
) -> Response {
    match issue_authorization_code_url(auth, authorization, session).await {
        Ok(redirect_to) => Redirect::to(&redirect_to).into_response(),
        Err(code) => landing_error(auth, code, None),
    }
}

async fn issue_authorization_code_url(
    auth: &AuthService,
    authorization: &Authorization,
    session: &BrowserSession,
) -> Result<String, &'static str> {
    let code = random_secret();
    let result = sqlx::query(
        "UPDATE oidc_authorizations \
         SET code_hash = ?, account_id = ?, browser_session_id = ?, auth_time = ?, status = 'CODE_ISSUED' \
         WHERE id = ? AND status = 'PENDING' AND expires_at > UTC_TIMESTAMP(6)",
    )
    .bind(secret_hash(&code))
    .bind(&session.account_id)
    .bind(&session.id)
    .bind(session.auth_time.naive_utc())
    .bind(&authorization.id)
    .execute(auth.pool())
    .await;
    if !matches!(result, Ok(ref value) if value.rows_affected() == 1) {
        return Err("AUTHORIZATION_USED");
    }
    let mut redirect =
        url::Url::parse(&authorization.redirect_uri).map_err(|_| "INTERNAL_ERROR")?;
    redirect
        .query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", &authorization.client_state)
        .append_pair("iss", auth.issuer());
    Ok(redirect.into())
}

fn authorize_query_error(
    auth: &AuthService,
    query: &AuthorizeQuery,
    error: &'static str,
) -> Response {
    if query.client_id != auth.config().oidc_client_id
        || query.redirect_uri != auth.config().oidc_redirect_uri
    {
        return landing_error(auth, "INVALID_CLIENT", query.ui_locales.as_deref());
    }
    let mut redirect = match url::Url::parse(&query.redirect_uri) {
        Ok(value) => value,
        Err(_) => return landing_error(auth, "INVALID_REQUEST", query.ui_locales.as_deref()),
    };
    redirect
        .query_pairs_mut()
        .append_pair("error", error)
        .append_pair("state", &query.state)
        .append_pair("iss", auth.issuer());
    Redirect::to(redirect.as_str()).into_response()
}

fn authorization_error(
    auth: &AuthService,
    authorization: &Authorization,
    error: &'static str,
) -> Response {
    match authorization_error_url(auth, authorization, error) {
        Ok(redirect_to) => Redirect::to(&redirect_to).into_response(),
        Err(code) => landing_error(auth, code, None),
    }
}

fn authorization_error_url(
    auth: &AuthService,
    authorization: &Authorization,
    error: &'static str,
) -> Result<String, &'static str> {
    let mut redirect =
        url::Url::parse(&authorization.redirect_uri).map_err(|_| "INTERNAL_ERROR")?;
    redirect
        .query_pairs_mut()
        .append_pair("error", error)
        .append_pair("state", &authorization.client_state)
        .append_pair("iss", auth.issuer());
    Ok(redirect.into())
}

async fn create_browser_session(
    auth: &AuthService,
    account_id: &str,
    auth_time: DateTime<Utc>,
) -> Result<(BrowserSession, Cookie<'static>), AppError> {
    let raw_token = random_secret();
    let id = Uuid::new_v4().to_string();
    let expires_at = Utc::now() + ChronoDuration::hours(BROWSER_SESSION_TTL_HOURS);
    sqlx::query(
        "INSERT INTO oidc_browser_sessions \
         (id, token_hash, account_id, auth_time, last_seen_at, expires_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6), ?)",
    )
    .bind(&id)
    .bind(secret_hash(&raw_token))
    .bind(account_id)
    .bind(auth_time.naive_utc())
    .bind(expires_at.naive_utc())
    .execute(auth.pool())
    .await?;
    Ok((
        BrowserSession {
            id,
            account_id: account_id.to_owned(),
            auth_time,
            raw_token: raw_token.clone(),
        },
        session_cookie(auth, raw_token),
    ))
}

async fn load_browser_session(
    auth: &AuthService,
    jar: &CookieJar,
) -> Result<Option<BrowserSession>, AppError> {
    let raw_token = match jar.get(cookie_name(auth)) {
        Some(cookie) => cookie.value().to_owned(),
        None => return Ok(None),
    };
    if raw_token.len() > 256 {
        return Ok(None);
    }
    let row = sqlx::query(
        "SELECT s.id, s.account_id, s.auth_time \
         FROM oidc_browser_sessions s JOIN accounts a ON a.id = s.account_id \
         WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > UTC_TIMESTAMP(6) \
           AND s.last_seen_at > UTC_TIMESTAMP(6) - INTERVAL 60 MINUTE AND a.status = 'ACTIVE'",
    )
    .bind(secret_hash(&raw_token))
    .fetch_optional(auth.pool())
    .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let id: String = row.try_get("id")?;
    sqlx::query("UPDATE oidc_browser_sessions SET last_seen_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(&id)
        .execute(auth.pool())
        .await?;
    Ok(Some(BrowserSession {
        id,
        account_id: row.try_get("account_id")?,
        auth_time: row
            .try_get::<chrono::NaiveDateTime, _>("auth_time")?
            .and_utc(),
        raw_token,
    }))
}

fn session_cookie(auth: &AuthService, value: String) -> Cookie<'static> {
    Cookie::build((cookie_name(auth).to_owned(), value))
        .path("/")
        .http_only(true)
        .secure(auth.issuer().starts_with("https://"))
        .same_site(SameSite::Lax)
        .max_age(time::Duration::hours(BROWSER_SESSION_TTL_HOURS))
        .build()
}

fn removal_cookie(auth: &AuthService) -> Cookie<'static> {
    let mut cookie = Cookie::build((cookie_name(auth).to_owned(), String::new()))
        .path("/")
        .http_only(true)
        .secure(auth.issuer().starts_with("https://"))
        .same_site(SameSite::Lax)
        .build();
    cookie.make_removal();
    cookie
}

fn cookie_name(auth: &AuthService) -> &'static str {
    if auth.issuer().starts_with("https://") {
        COOKIE_PRODUCTION
    } else {
        COOKIE_DEVELOPMENT
    }
}

async fn revoke_session(
    auth: &AuthService,
    session_id: &str,
    account_id: &str,
) -> Result<(), AppError> {
    let mut tx = auth.pool().begin().await?;
    let saved_account = sqlx::query_scalar::<_, String>(
        "SELECT account_id FROM oidc_browser_sessions WHERE id = ? FOR UPDATE",
    )
    .bind(session_id)
    .fetch_optional(&mut *tx)
    .await?;
    if saved_account.as_deref() != Some(account_id) {
        return Err(AppError::Unauthorized);
    }
    sqlx::query(
        "UPDATE oidc_browser_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE id = ?",
    )
    .bind(session_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "UPDATE oidc_refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE browser_session_id = ?",
    )
    .bind(session_id)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

async fn record_login_failure(auth: &AuthService, account_id: &str) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE accounts SET failed_login_count = LEAST(failed_login_count + 1, 65535), \
         locked_until = CASE WHEN failed_login_count >= 4 THEN UTC_TIMESTAMP(6) + INTERVAL 15 MINUTE ELSE locked_until END \
         WHERE id = ?",
    )
    .bind(account_id)
    .execute(auth.pool())
    .await?;
    Ok(())
}

async fn reset_login_failures(auth: &AuthService, account_id: &str) -> Result<(), AppError> {
    sqlx::query("UPDATE accounts SET failed_login_count = 0, locked_until = NULL WHERE id = ?")
        .bind(account_id)
        .execute(auth.pool())
        .await?;
    Ok(())
}

fn dummy_password_check(password: &str) {
    static HASH: OnceLock<String> = OnceLock::new();
    let hash = HASH.get_or_init(|| {
        hash_password("dummy password value").expect("valid constant dummy password")
    });
    let _ = verify_password(password, hash);
}

async fn verify_second_factor(
    auth: &AuthService,
    identity: &Identity,
    supplied: &str,
) -> Result<bool, AppError> {
    let code = supplied.trim();
    if code.len() == 6 && code.bytes().all(|byte| byte.is_ascii_digit()) {
        let (Some(ciphertext), Some(nonce), Some(kid)) = (
            identity.totp_secret_ciphertext.as_deref(),
            identity.totp_secret_nonce.as_deref(),
            identity.totp_key_id.as_deref(),
        ) else {
            return Ok(false);
        };
        let secret = auth.decrypt_secret(&identity.id, kid, nonce, ciphertext)?;
        let totp = build_totp(secret, &identity.email)?;
        let now = Utc::now().timestamp().max(0) as u64;
        let Some(step) = matching_totp_step(&totp, code, now) else {
            return Ok(false);
        };
        let result = sqlx::query(
            "UPDATE accounts SET totp_last_used_step = ? \
             WHERE id = ? AND (totp_last_used_step IS NULL OR totp_last_used_step < ?)",
        )
        .bind(step)
        .bind(&identity.id)
        .bind(step)
        .execute(auth.pool())
        .await?;
        return Ok(result.rows_affected() == 1);
    }
    let normalized = normalize_recovery_code(code);
    if normalized.len() != 16 {
        return Ok(false);
    }
    let mut tx = auth.pool().begin().await?;
    let row = sqlx::query(
        "SELECT id FROM oidc_recovery_codes \
         WHERE account_id = ? AND code_hash = ? AND used_at IS NULL FOR UPDATE",
    )
    .bind(&identity.id)
    .bind(secret_hash(&normalized))
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Ok(false);
    };
    let id: String = row.try_get("id")?;
    sqlx::query("UPDATE oidc_recovery_codes SET used_at = UTC_TIMESTAMP(6) WHERE id = ?")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(true)
}

fn build_totp(secret: Vec<u8>, email: &str) -> Result<TOTP, AppError> {
    TOTP::new(
        TotpAlgorithm::SHA1,
        6,
        1,
        30,
        secret,
        Some("Rabbit Interview".to_owned()),
        email.to_owned(),
    )
    .map_err(|_| AppError::Internal)
}

fn generate_recovery_codes() -> Vec<String> {
    (0..10)
        .map(|_| {
            let secret = secret_hash(&random_secret()).to_uppercase();
            format!("{}-{}", &secret[..8], &secret[8..16])
        })
        .collect()
}

fn matching_totp_step(totp: &TOTP, code: &str, now: u64) -> Option<u64> {
    let current = now / 30;
    (current.saturating_sub(1)..=current + 1).find(|step| {
        let expected = totp.generate(step * 30);
        expected.len() == code.len() && expected.as_bytes().ct_eq(code.as_bytes()).unwrap_u8() == 1
    })
}

fn normalize_recovery_code(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_uppercase)
        .collect()
}

async fn require_security_session(
    auth: &AuthService,
    jar: &CookieJar,
    csrf: &str,
) -> Result<BrowserSession, Response> {
    let session = load_browser_session(auth, jar)
        .await
        .map_err(|_| auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true))?
        .ok_or_else(|| auth_error(StatusCode::UNAUTHORIZED, "AUTH_REQUIRED", false))?;
    if !auth.verify_csrf(&session.raw_token, "security", csrf) {
        return Err(auth_error(
            StatusCode::BAD_REQUEST,
            "REQUEST_EXPIRED",
            false,
        ));
    }
    Ok(session)
}

async fn action_token_valid(auth: &AuthService, token: &str, kind: &str) -> Result<bool, AppError> {
    if token.is_empty() || token.len() > 256 {
        return Ok(false);
    }
    let count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM oidc_action_tokens \
         WHERE token_hash = ? AND kind = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP(6)",
    )
    .bind(secret_hash(token))
    .bind(kind)
    .fetch_one(auth.pool())
    .await?;
    Ok(count == 1)
}

async fn revoke_account_credentials_tx(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "UPDATE oidc_browser_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) \
         WHERE account_id = ?",
    )
    .bind(account_id)
    .execute(&mut **tx)
    .await?;
    sqlx::query(
        "UPDATE oidc_refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) \
         WHERE account_id = ?",
    )
    .bind(account_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_security_event_tx(
    tx: &mut Transaction<'_, MySql>,
    account_id: Option<&str>,
    event_type: &str,
    metadata: serde_json::Value,
) -> Result<(), AppError> {
    let now = Utc::now();
    sqlx::query(
        "INSERT INTO security_events (id, account_id, event_type, metadata, occurred_at, expires_at) \
         VALUES (?, ?, ?, ?, ?, ?)",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(account_id)
    .bind(event_type)
    .bind(metadata)
    .bind(now.naive_utc())
    .bind((now + ChronoDuration::days(30)).naive_utc())
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn admin_actor(headers: &HeaderMap) -> Result<&str, AppError> {
    headers
        .get("X-Admin-Actor")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or(AppError::Unauthorized)
}

fn endpoint(auth: &AuthService, path: &str) -> String {
    format!("{}{path}", auth.issuer())
}

fn pkce_challenge(verifier: &str) -> String {
    use base64::Engine;
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn valid_pkce_challenge(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn valid_pkce_verifier(value: &str) -> bool {
    (43..=128).contains(&value.len())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~'))
}

fn token_response(value: TokenResponse) -> Response {
    no_store(Json(value).into_response())
}

fn oauth_token_error(status: StatusCode, error: &'static str) -> Response {
    no_store((status, Json(serde_json::json!({ "error": error }))).into_response())
}

fn bearer_error() -> Response {
    let mut response = oauth_token_error(StatusCode::UNAUTHORIZED, "invalid_token");
    response.headers_mut().insert(
        header::WWW_AUTHENTICATE,
        HeaderValue::from_static("Bearer error=\"invalid_token\""),
    );
    response
}

fn no_store(mut response: Response) -> Response {
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
        .headers_mut()
        .insert("pragma", HeaderValue::from_static("no-cache"));
    response
}

fn auth_response<T: Serialize>(value: T) -> Response {
    no_store(Json(value).into_response())
}

fn auth_error(status: StatusCode, code: &'static str, retryable: bool) -> Response {
    no_store(
        (
            status,
            Json(serde_json::json!({
                "code": code,
                "request_id": Uuid::new_v4().to_string(),
                "retryable": retryable,
            })),
        )
            .into_response(),
    )
}

fn landing_redirect(auth: &AuthService, path: &str, fragment: &[(&str, &str)]) -> Response {
    let mut target = match url::Url::parse(&auth.config().landing_public_url) {
        Ok(value) => value,
        Err(_) => return auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    };
    target.set_path(path);
    target.set_query(None);
    target.set_fragment(
        (!fragment.is_empty())
            .then(|| {
                let mut serializer = url::form_urlencoded::Serializer::new(String::new());
                for (key, value) in fragment {
                    serializer.append_pair(key, value);
                }
                serializer.finish()
            })
            .as_deref(),
    );
    Redirect::to(target.as_str()).into_response()
}

fn landing_auth(auth: &AuthService, request: &str, ui_locales: Option<&str>) -> Response {
    landing_redirect(
        auth,
        "/auth/login",
        &[("request", request), ("lang", landing_locale(ui_locales))],
    )
}

fn landing_error(auth: &AuthService, code: &'static str, ui_locales: Option<&str>) -> Response {
    landing_redirect(
        auth,
        "/auth/error",
        &[("error", code), ("lang", landing_locale(ui_locales))],
    )
}

fn landing_locale(ui_locales: Option<&str>) -> &'static str {
    ui_locales
        .into_iter()
        .flat_map(str::split_ascii_whitespace)
        .find_map(|value| {
            let tag = value.replace('_', "-").to_ascii_lowercase();
            if tag.starts_with("zh-tw") || tag.starts_with("zh-hk") || tag.starts_with("zh-hant") {
                Some("zh-TW")
            } else if tag == "zh" || tag.starts_with("zh-cn") || tag.starts_with("zh-hans") {
                Some("zh-CN")
            } else if tag.starts_with("en") {
                Some("en")
            } else {
                None
            }
        })
        .unwrap_or("en")
}

fn interaction_for(
    auth: &AuthService,
    authorization: &Authorization,
    session: Option<&BrowserSession>,
) -> InteractionResponse {
    if session.is_some() {
        return InteractionResponse::Consent {
            csrf: auth.csrf_token(&authorization.request_secret, "consent"),
            scopes: authorization
                .scope
                .split_ascii_whitespace()
                .map(ToOwned::to_owned)
                .collect(),
        };
    }
    if authorization.account_id.is_some() {
        return InteractionResponse::Mfa {
            csrf: auth.csrf_token(&authorization.request_secret, "mfa-login"),
        };
    }
    InteractionResponse::Login {
        csrf: auth.csrf_token(&authorization.request_secret, "login"),
    }
}

async fn token_context(auth: &AuthService, token: &str, kind: &'static str) -> Response {
    match action_token_valid(auth, token, kind).await {
        Ok(true) => auth_response(TokenFormContext {
            csrf: auth.csrf_token(token, kind),
        }),
        Ok(false) => auth_error(StatusCode::BAD_REQUEST, "INVALID_OR_EXPIRED_LINK", false),
        Err(_) => auth_error(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", true),
    }
}
fn request_ip(auth: &AuthService, peer: SocketAddr, headers: &HeaderMap) -> IpAddr {
    let peer_ip = peer.ip();
    let trusted = &auth.config().trusted_proxy_cidrs;
    if !trusted.iter().any(|network| network.contains(&peer_ip)) {
        return peer_ip;
    }

    headers
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
        .into_iter()
        .flat_map(|value| value.split(',').rev())
        .filter_map(|value| value.trim().parse::<IpAddr>().ok())
        .find(|ip| !trusted.iter().any(|network| network.contains(ip)))
        .unwrap_or(peer_ip)
}

#[cfg(test)]
mod tests {
    use super::{
        build_totp, canonical_scope, landing_locale, matching_totp_step, normalize_recovery_code,
        pkce_challenge, valid_pkce_challenge, valid_pkce_verifier,
    };

    #[test]
    fn scopes_are_restricted_and_canonical() {
        assert_eq!(
            canonical_scope("email openid offline_access profile").as_deref(),
            Some("openid profile email offline_access")
        );
        assert!(canonical_scope("profile email").is_none());
        assert!(canonical_scope("openid admin").is_none());
    }

    #[test]
    fn pkce_and_recovery_codes_are_stable() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
        assert_eq!(
            normalize_recovery_code("abcd-1234-efgh-5678"),
            "ABCD1234EFGH5678"
        );
        assert!(valid_pkce_challenge(&pkce_challenge(
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        )));
        assert!(valid_pkce_verifier(
            "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        ));
        assert!(!valid_pkce_verifier(&"x".repeat(42)));
    }

    #[test]
    fn totp_validation_returns_the_step_that_matched() {
        let totp = build_totp(vec![7; 20], "person@example.com").unwrap();
        let now = 1_725_000_010;
        let previous_step = now / 30 - 1;
        let code = totp.generate(previous_step * 30);
        assert_eq!(matching_totp_step(&totp, &code, now), Some(previous_step));
        assert_eq!(matching_totp_step(&totp, "0000000", now), None);
    }

    #[test]
    fn ui_locales_prefer_simplified_then_traditional_chinese() {
        assert_eq!(landing_locale(Some("zh-CN")), "zh-CN");
        assert_eq!(landing_locale(Some("zh-TW")), "zh-TW");
        assert_eq!(landing_locale(Some("fr en-US")), "en");
        assert_eq!(landing_locale(Some("fr")), "en");
    }
}
