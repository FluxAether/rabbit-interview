use std::{net::SocketAddr, path::PathBuf, time::Duration};

use axum::{
    body::Body,
    extract::ConnectInfo,
    http::{header, Method, Request, StatusCode},
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use http_body_util::BodyExt;
use rabbit_gateway::{auth::hash_password, config::Config, router, AppState};
use rsa::{
    pkcs8::{EncodePrivateKey, LineEnding},
    rand_core::OsRng,
    RsaPrivateKey,
};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tower::ServiceExt;
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread")]
#[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
async fn authorization_code_refresh_reuse_and_logout_flow() -> anyhow::Result<()> {
    let database_url = std::env::var("TEST_DATABASE_URL")?;
    let secret_dir = std::env::temp_dir().join(format!("rabbit-oidc-test-{}", Uuid::new_v4()));
    std::fs::create_dir_all(&secret_dir)?;
    let private_key_file = secret_dir.join("signing.pem");
    let signing_keyset_file = secret_dir.join("signing.json");
    let data_keyring_file = secret_dir.join("data.json");
    let private_key = RsaPrivateKey::new(&mut OsRng, 2048)?;
    std::fs::write(
        &private_key_file,
        private_key.to_pkcs8_pem(LineEnding::LF)?.as_bytes(),
    )?;
    std::fs::write(
        &signing_keyset_file,
        serde_json::to_vec(&serde_json::json!({
            "active_kid": "integration",
            "keys": [{
                "kid": "integration",
                "private_key_file": private_key_file,
            }],
        }))?,
    )?;
    std::fs::write(
        &data_keyring_file,
        serde_json::to_vec(&serde_json::json!({
            "active_kid": "integration",
            "keys": { "integration": URL_SAFE_NO_PAD.encode([7_u8; 32]) },
        }))?,
    )?;

    let state = AppState::new(test_config(
        database_url,
        signing_keyset_file,
        data_keyring_file,
    ))
    .await?;
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
    let app = router(state);

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

    std::fs::remove_dir_all(secret_dir)?;
    Ok(())
}

fn test_config(
    database_url: String,
    oidc_signing_keyset_file: PathBuf,
    oidc_data_keyring_file: PathBuf,
) -> Config {
    Config {
        listen_addr: "127.0.0.1:8787".parse().unwrap(),
        database_url,
        gateway_public_url: "http://127.0.0.1:8787".to_owned(),
        landing_public_url: "http://localhost:4174".to_owned(),
        allowed_origins: vec!["http://localhost:1420".to_owned()],
        oidc_client_id: "rabbit-desktop".to_owned(),
        oidc_redirect_uri: "rabbitinterview://auth/callback".to_owned(),
        oidc_post_logout_redirect_uri: "rabbitinterview://auth/logout".to_owned(),
        oidc_signing_keyset_file,
        oidc_data_keyring_file,
        resend_api_key: "re_test_gateway".to_owned(),
        resend_from: "OnCue <no-reply@example.test>".to_owned(),
        resend_api_url: "https://api.resend.com".to_owned(),
        trusted_proxy_cidrs: Vec::new(),
        hosted_stt_enabled: false,
        hosted_llm_enabled: false,
        payments_enabled: false,
        alipay_app_id: None,
        alipay_seller_id: None,
        alipay_private_key: None,
        alipay_public_key: None,
        alipay_gateway_url: "https://openapi.alipay.com/gateway.do".to_owned(),
        admin_token: Some("integration-admin".to_owned()),
        volcengine_api_key: None,
        volcengine_resource_id: "volc.bigasr.sauc.duration".to_owned(),
        volcengine_url: "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel".to_owned(),
        gemini_api_key: None,
        gemini_model: "gemini-3.7-flash".to_owned(),
        initial_stt_hold_ms: 60_000,
        stt_top_up_ms: 60_000,
        stt_top_up_threshold_ms: 15_000,
        reservation_ttl: Duration::from_secs(120),
        ticket_ttl: Duration::from_secs(30),
        max_json_bytes: 131_072,
        max_ws_frame_bytes: 65_536,
        max_ws_frames_per_second: 100,
        max_stt_session: Duration::from_secs(3_600),
        global_concurrency_limit: 100,
        pricing_policy_version: "integration-v1".to_owned(),
    }
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
