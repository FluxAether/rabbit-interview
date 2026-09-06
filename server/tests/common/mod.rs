use std::{path::PathBuf, time::Duration};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rabbit_gateway::{config::Config, AppState};
use rsa::{pkcs8::{EncodePrivateKey, LineEnding}, rand_core::OsRng, RsaPrivateKey};
use uuid::Uuid;

pub struct TestConfig {
    pub config: Config,
    secret_dir: PathBuf,
}

impl TestConfig {
    pub fn new() -> anyhow::Result<Self> {
        let database_url = std::env::var("TEST_DATABASE_URL")?;
    let secret_dir = std::env::temp_dir().join(format!("rabbit-gateway-test-{}", Uuid::new_v4()));
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

        Ok(Self { config: test_config(database_url, signing_keyset_file, data_keyring_file), secret_dir })
    }

    pub async fn state(&self) -> anyhow::Result<AppState> {
        AppState::new(self.config.clone()).await
    }
}

impl Drop for TestConfig {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.secret_dir);
    }
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
        volcengine_stt_models: vec!["bigmodel".to_owned()],
        deepgram_api_key: None,
        deepgram_stt_url: "wss://api.deepgram.com/v1/listen".to_owned(),
        deepgram_stt_models: Vec::new(),
        gemini_api_key: None,
        gemini_model: "gemini-3.7-flash".to_owned(),
        gemini_live_url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent".to_owned(),
        gemini_stt_models: Vec::new(),
        gemini_llm_url: "https://generativelanguage.googleapis.com/v1beta/interactions"
            .to_owned(),
        gemini_llm_models: vec!["gemini-3.7-flash".to_owned()],
        openai_api_key: None,
        openai_llm_url: "https://api.openai.com/v1/responses".to_owned(),
        openai_llm_models: Vec::new(),
        anthropic_api_key: None,
        anthropic_llm_url: "https://api.anthropic.com/v1/messages".to_owned(),
        anthropic_llm_models: Vec::new(),
        groq_api_key: None,
        groq_llm_url: "https://api.groq.com/openai/v1/chat/completions".to_owned(),
        groq_llm_models: Vec::new(),
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


