mod common;

use std::net::SocketAddr;

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use http_body_util::BodyExt;
use rabbit_gateway::{auth::hash_password, router};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
async fn authorization_code_refresh_reuse_and_logout_flow() -> anyhow::Result<()> {
    let fixture = common::TestConfig::new()?;
    let state = fixture.state().await?;
    let account_id = Uuid::new_v4().to_string();
    let email = format!("{account_id}@example.test");
    sqlx::query(
        "INSERT INTO accounts \
         (id, email, normalized_email, display_name, password_hash, email_verified_at, status) \
         VALUES (?, ?, ?, 'Integration User', ?, UTC_TIMESTAMP(6), 'ACTIVE')",
    )
    .bind(&account_id)
    .bind(&email)
    .bind(&email)
    .bind(hash_password("correct horse battery staple")?)
    .execute(state.auth().pool())
    .await?;
    sqlx::query(
        "INSERT INTO oidc_consents (account_id, client_id, scope, granted_at) \
         VALUES (?, 'rabbit-desktop', 'openid profile email offline_access', UTC_TIMESTAMP(6))",
    )
    .bind(&account_id)
    .execute(state.auth().pool())
    .await?;
    let app = router(state.clone());

    let discovery = send(&app, Method::GET, "/.well-known/openid-configuration", None).await?;
    assert_eq!(discovery.0, StatusCode::OK);
    let discovery: Value = serde_json::from_slice(&discovery.1)?;
    assert_eq!(discovery["issuer"], "http://127.0.0.1:8787");
    assert_eq!(
        discovery["response_types_supported"],
        serde_json::json!(["code"])
    );

    let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let authorize_query = form(&[
        ("response_type", "code"),
        ("client_id", "rabbit-desktop"),
        ("redirect_uri", "rabbitinterview://auth/callback"),
        ("scope", "openid profile email offline_access"),
        ("state", "integration-state"),
        ("nonce", "integration-nonce"),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ]);
    let login_redirect = send(
        &app,
        Method::GET,
        &format!("/oauth2/authorize?{authorize_query}"),
        None,
    )
    .await?;
    assert_eq!(login_redirect.0, StatusCode::SEE_OTHER);
    let landing = url::Url::parse(login_redirect.2.as_deref().expect("landing redirect"))?;
    assert_eq!(landing.path(), "/auth/login");
    assert!(landing.query().is_none());
    let request_secret = landing
        .fragment()
        .into_iter()
        .flat_map(|fragment| url::form_urlencoded::parse(fragment.as_bytes()))
        .find(|(key, _)| key == "request")
        .expect("authorization request fragment")
        .1
        .into_owned();
    let interaction = send(
        &app,
        Method::POST,
        "/oauth2/interaction",
        Some(form(&[("request", &request_secret)])),
    )
    .await?;
    assert_eq!(interaction.0, StatusCode::OK);
    let interaction: Value = serde_json::from_slice(&interaction.1)?;
    assert_eq!(interaction["step"], "login");
    let csrf = interaction["csrf"].as_str().expect("login csrf");
    let mut credential_error = None;
    for address in [&email, "unknown@example.test", "unknown@example.test"] {
        let failed = send(&app, Method::POST, "/oauth2/login", Some(form(&[
            ("request", &request_secret), ("csrf", csrf), ("email", address),
            ("password", "an incorrect test password"),
        ]))).await?;
        assert_eq!(failed.0, StatusCode::UNAUTHORIZED);
        let mut body: Value = serde_json::from_slice(&failed.1)?;
        body.as_object_mut().unwrap().remove("request_id");
        if let Some(previous) = &credential_error { assert_eq!(&body, previous); }
        credential_error = Some(body);
    }
    assert_eq!(state.auth().identity_by_id(&account_id).await?.failed_login_count, 1);
    let login_form = form(&[
        ("request", &request_secret),
        ("csrf", &csrf),
        ("email", &email),
        ("password", "correct horse battery staple"),
    ]);
    let login = send(&app, Method::POST, "/oauth2/login", Some(login_form)).await?;
    assert_eq!(login.0, StatusCode::OK);
    let cookie = login
        .3
        .as_deref()
        .and_then(|header| header.split(';').next())
        .expect("browser session cookie")
        .to_owned();
    let login: Value = serde_json::from_slice(&login.1)?;
    assert_eq!(login["step"], "complete");
    let callback = url::Url::parse(
        login["redirect_to"]
            .as_str()
            .expect("authorization redirect"),
    )?;
    assert_eq!(callback.scheme(), "rabbitinterview");
    assert_eq!(
        callback
            .query_pairs()
            .find(|(key, _)| key == "state")
            .unwrap()
            .1,
        "integration-state"
    );
    let code = callback
        .query_pairs()
        .find(|(key, _)| key == "code")
        .expect("authorization code")
        .1
        .into_owned();

    let code_form = form(&[
        ("grant_type", "authorization_code"),
        ("client_id", "rabbit-desktop"),
        ("code", &code),
        ("code_verifier", verifier),
        ("redirect_uri", "rabbitinterview://auth/callback"),
    ]);
    let token = send(&app, Method::POST, "/oauth2/token", Some(code_form.clone())).await?;
    assert_eq!(token.0, StatusCode::OK);
    let token: Value = serde_json::from_slice(&token.1)?;
    let access = token["access_token"].as_str().unwrap();
    let id_token = token["id_token"].as_str().unwrap();
    let refresh = token["refresh_token"].as_str().unwrap();
    assert_ne!(access, id_token);

    let replay = send(&app, Method::POST, "/oauth2/token", Some(code_form)).await?;
    assert_eq!(replay.0, StatusCode::BAD_REQUEST);
    let userinfo = bearer(&app, "/oauth2/userinfo", access).await?;
    assert_eq!(userinfo.0, StatusCode::OK);
    let rejected_id_token = bearer(&app, "/oauth2/userinfo", id_token).await?;
    assert_eq!(rejected_id_token.0, StatusCode::UNAUTHORIZED);

    let unauthenticated_subscription = send(
        &app,
        Method::GET,
        "/account/subscription/context",
        None,
    )
    .await?;
    assert_eq!(unauthenticated_subscription.0, StatusCode::UNAUTHORIZED);
    let signed_in_subscription = send_cookie(
        &app,
        Method::GET,
        "/account/subscription/context",
        &cookie,
        None,
    )
    .await?;
    assert_eq!(signed_in_subscription.0, StatusCode::OK);
    let subscription: Value = serde_json::from_slice(&signed_in_subscription.1)?;
    assert_eq!(subscription["email"], email);
    assert_eq!(subscription["status"], "ACTIVE");
    assert_eq!(subscription["balances"]["STT_AUDIO_MS"], 0);
    assert_eq!(subscription["payments_enabled"], false);

    let security = send_cookie(&app, Method::GET, "/account/security/context", &cookie, None).await?;
    let security: Value = serde_json::from_slice(&security.1)?;
    let csrf = security["csrf"].as_str().unwrap();
    let started = send_cookie(&app, Method::POST, "/account/security/totp/start", &cookie,
        Some(form(&[("csrf", csrf)]))).await?;
    assert_eq!(started.0, StatusCode::OK);
    let started: Value = serde_json::from_slice(&started.1)?;
    let totp = totp_rs::TOTP::new(totp_rs::Algorithm::SHA1, 6, 1, 30,
        totp_rs::Secret::Encoded(started["secret"].as_str().unwrap().into()).to_bytes()?,
        Some("OnCue".into()), email.clone())?;
    let confirmed = send_cookie(&app, Method::POST, "/account/security/totp/confirm", &cookie,
        Some(form(&[("csrf", csrf), ("code", &totp.generate_current()?)]))).await?;
    assert_eq!(confirmed.0, StatusCode::OK);
    let confirmed: Value = serde_json::from_slice(&confirmed.1)?;
    let recovery = confirmed["recovery_codes"][0].as_str().unwrap();
    for password in ["wrong test password", "correct horse battery staple"] {
        let disabled = send_cookie(&app, Method::POST, "/account/security/totp/disable", &cookie,
            Some(form(&[("csrf", csrf), ("password", password), ("code", recovery)]))).await?;
        assert_eq!(disabled.0, if password.starts_with("wrong") { StatusCode::UNAUTHORIZED } else { StatusCode::OK });
        assert_eq!(state.auth().identity_by_id(&account_id).await?.totp_enabled_at.is_some(), password.starts_with("wrong"));
    }

    let missing_admin = send_json(
        &app,
        "/internal/accounts/lookup",
        serde_json::json!({"email": email}),
        None,
        Some("operator@example.test"),
    )
    .await?;
    assert_eq!(missing_admin.0, StatusCode::UNAUTHORIZED);
    let unknown_account = send_json(
        &app,
        "/internal/accounts/lookup",
        serde_json::json!({"email": "missing@example.test"}),
        Some("integration-admin"),
        Some("operator@example.test"),
    )
    .await?;
    assert_eq!(unknown_account.0, StatusCode::NOT_FOUND);
    let lookup = send_json(
        &app,
        "/internal/accounts/lookup",
        serde_json::json!({"email": email}),
        Some("integration-admin"),
        Some("operator@example.test"),
    )
    .await?;
    assert_eq!(lookup.0, StatusCode::OK);
    let lookup: Value = serde_json::from_slice(&lookup.1)?;
    assert_eq!(lookup["account_id"], account_id);
    assert_eq!(lookup["email"], email);
    let granted = send_json(
        &app,
        &format!("/internal/accounts/{account_id}/quota-adjustments"),
        serde_json::json!({
            "metric": "STT_AUDIO_MS",
            "units": 3_600_000,
            "reason": "pilot grant"
        }),
        Some("integration-admin"),
        Some("operator@example.test"),
    )
    .await?;
    assert_eq!(granted.0, StatusCode::OK);
    let refreshed = send_json(
        &app,
        "/internal/accounts/lookup",
        serde_json::json!({"email": email}),
        Some("integration-admin"),
        Some("operator@example.test"),
    )
    .await?;
    assert_eq!(refreshed.0, StatusCode::OK);
    let refreshed: Value = serde_json::from_slice(&refreshed.1)?;
    assert_eq!(refreshed["balances"]["STT_AUDIO_MS"], 3_600_000);

    let refresh_form = form(&[
        ("grant_type", "refresh_token"),
        ("client_id", "rabbit-desktop"),
        ("refresh_token", refresh),
    ]);
    let rotated = send(
        &app,
        Method::POST,
        "/oauth2/token",
        Some(refresh_form.clone()),
    )
    .await?;
    assert_eq!(rotated.0, StatusCode::OK);
    let rotated: Value = serde_json::from_slice(&rotated.1)?;
    let rotated_refresh = rotated["refresh_token"].as_str().unwrap();
    assert_ne!(refresh, rotated_refresh);

    let reuse = send(&app, Method::POST, "/oauth2/token", Some(refresh_form)).await?;
    assert_eq!(reuse.0, StatusCode::BAD_REQUEST);
    let revoked_family = form(&[
        ("grant_type", "refresh_token"),
        ("client_id", "rabbit-desktop"),
        ("refresh_token", rotated_refresh),
    ]);
    assert_eq!(
        send(&app, Method::POST, "/oauth2/token", Some(revoked_family))
            .await?
            .0,
        StatusCode::BAD_REQUEST
    );

    let logout_query = form(&[
        ("id_token_hint", rotated["id_token"].as_str().unwrap()),
        ("post_logout_redirect_uri", "rabbitinterview://auth/logout"),
        ("state", "logout-state"),
    ]);
    let logout = send(
        &app,
        Method::GET,
        &format!("/oauth2/logout?{logout_query}"),
        None,
    )
    .await?;
    assert_eq!(logout.0, StatusCode::SEE_OTHER);
    assert_eq!(
        logout.2.as_deref(),
        Some("rabbitinterview://auth/logout?state=logout-state")
    );

    Ok(())
}

async fn send(
    app: &axum::Router,
    method: Method,
    uri: &str,
    form_body: Option<String>,
) -> anyhow::Result<(StatusCode, Vec<u8>, Option<String>, Option<String>)> {
    send_cookie(app, method, uri, "", form_body).await
}

async fn send_cookie(
    app: &axum::Router,
    method: Method,
    uri: &str,
    cookie: &str,
    form_body: Option<String>,
) -> anyhow::Result<(StatusCode, Vec<u8>, Option<String>, Option<String>)> {
    let mut request = Request::builder().method(method).uri(uri);
    if form_body.is_some() {
        request = request.header(header::CONTENT_TYPE, "application/x-www-form-urlencoded");
    }
    if !cookie.is_empty() {
        request = request.header(header::COOKIE, cookie);
    }
    let mut request = request.body(Body::from(form_body.unwrap_or_default()))?;
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:43210".parse::<SocketAddr>()?));
    let response = app.clone().oneshot(request).await?;
    let status = response.status();
    let location = response
        .headers()
        .get(header::LOCATION)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let set_cookie = response
        .headers()
        .get(header::SET_COOKIE)
        .and_then(|value| value.to_str().ok())
        .map(ToOwned::to_owned);
    let body = response.into_body().collect().await?.to_bytes().to_vec();
    Ok((status, body, location, set_cookie))
}

async fn send_json(
    app: &axum::Router,
    uri: &str,
    body: Value,
    admin_token: Option<&str>,
    admin_actor: Option<&str>,
) -> anyhow::Result<(StatusCode, Vec<u8>)> {
    let mut request = Request::builder()
        .method(Method::POST)
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = admin_token {
        request = request.header("x-admin-token", token);
    }
    if let Some(actor) = admin_actor {
        request = request.header("x-admin-actor", actor);
    }
    let mut request = request.body(Body::from(serde_json::to_vec(&body)?))?;
    request
        .extensions_mut()
        .insert(ConnectInfo("127.0.0.1:43210".parse::<SocketAddr>()?));
    let response = app.clone().oneshot(request).await?;
    let status = response.status();
    let bytes = response.into_body().collect().await?.to_bytes().to_vec();
    Ok((status, bytes))
}

async fn bearer(
    app: &axum::Router,
    uri: &str,
    token: &str,
) -> anyhow::Result<(StatusCode, Vec<u8>)> {
    let request = Request::builder()
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())?;
    let response = app.clone().oneshot(request).await?;
    let status = response.status();
    let body = response.into_body().collect().await?.to_bytes().to_vec();
    Ok((status, body))
}

fn form(values: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(values.iter().copied())
        .finish()
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn password_actions_validate_before_consumption_and_preserve_hashes() -> anyhow::Result<()> {
    let fixture = common::TestConfig::new()?;
    let state = fixture.state().await?;
    let app = router(state.clone());
    for (kind, path, initial_status) in [
        ("INVITE", "/account/setup", "PENDING"),
        ("RESET", "/account/reset-password", "ACTIVE"),
    ] {
        let account = Uuid::new_v4().to_string();
        let email = format!("{account}@example.test");
        sqlx::query("INSERT INTO accounts (id, email, normalized_email, status) VALUES (?, ?, ?, ?)")
            .bind(&account).bind(&email).bind(&email).bind(initial_status).execute(state.auth().pool()).await?;
        let token = rabbit_gateway::auth::random_secret();
        sqlx::query("INSERT INTO oidc_action_tokens (id, account_id, kind, token_hash, expires_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6) + INTERVAL 1 HOUR)")
            .bind(Uuid::new_v4().to_string()).bind(&account).bind(kind).bind(rabbit_gateway::auth::secret_hash(&token))
            .execute(state.auth().pool()).await?;
        let csrf = state.auth().csrf_token(&token, kind);
        for password in ["short", "a valid replacement password"] {
            let response = send(&app, Method::POST, path, Some(form(&[
                ("token", &token), ("csrf", &csrf), ("password", password), ("confirm_password", password),
            ]))).await?;
            assert_eq!(response.0, if password == "short" { StatusCode::BAD_REQUEST } else { StatusCode::OK });
            let used: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM oidc_action_tokens WHERE account_id = ? AND used_at IS NOT NULL")
                .bind(&account).fetch_one(state.auth().pool()).await?;
            assert_eq!(used, i64::from(password != "short"));
        }
        let identity = state.auth().identity_by_id(&account).await?;
        assert_eq!(identity.status, "ACTIVE");
        assert!(state.auth().verify_password("a valid replacement password", identity.password_hash.as_deref()).await?);
        assert!(!state.auth().verify_password("wrong password", identity.password_hash.as_deref()).await?);
        let replay = send(&app, Method::POST, path, Some(form(&[
            ("token", &token), ("csrf", &csrf), ("password", "another valid password"),
            ("confirm_password", "another valid password"),
        ]))).await?;
        assert_eq!(replay.0, StatusCode::BAD_REQUEST);
        assert_eq!(state.auth().identity_by_id(&account).await?.password_hash, identity.password_hash);
    }
    state.auth().pool().close().await;
    Ok(())
}
