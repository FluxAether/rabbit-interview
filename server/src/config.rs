use std::{env, net::SocketAddr, path::PathBuf, str::FromStr, time::Duration};

use anyhow::{anyhow, Context, Result};
use ipnet::IpNet;

#[derive(Clone, Debug)]
pub struct Config {
    pub listen_addr: SocketAddr,
    pub database_url: String,
    pub gateway_public_url: String,
    pub landing_public_url: String,
    pub allowed_origins: Vec<String>,
    pub oidc_client_id: String,
    pub oidc_redirect_uri: String,
    pub oidc_post_logout_redirect_uri: String,
    pub oidc_signing_keyset_file: PathBuf,
    pub oidc_data_keyring_file: PathBuf,
    pub resend_api_key: String,
    pub resend_from: String,
    pub resend_api_url: String,
    pub trusted_proxy_cidrs: Vec<IpNet>,
    pub hosted_stt_enabled: bool,
    pub hosted_llm_enabled: bool,
    pub payments_enabled: bool,
    pub admin_token: Option<String>,
    pub volcengine_api_key: Option<String>,
    pub volcengine_resource_id: String,
    pub volcengine_url: String,
    pub gemini_api_key: Option<String>,
    pub gemini_model: String,
    pub initial_stt_hold_ms: i64,
    pub stt_top_up_ms: i64,
    pub stt_top_up_threshold_ms: i64,
    pub reservation_ttl: Duration,
    pub ticket_ttl: Duration,
    pub max_json_bytes: usize,
    pub max_ws_frame_bytes: usize,
    pub max_ws_frames_per_second: u32,
    pub max_stt_session: Duration,
    pub global_concurrency_limit: usize,
    pub pricing_policy_version: String,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let landing_public_url = required("LANDING_PUBLIC_URL")?
            .trim_end_matches('/')
            .to_owned();
        let mut allowed_origins = list(
            "GATEWAY_ALLOWED_ORIGINS",
            "tauri://localhost,http://tauri.localhost,http://localhost:1420",
        );
        if !allowed_origins.contains(&landing_public_url) {
            allowed_origins.push(landing_public_url.clone());
        }
        include_loopback_aliases(&mut allowed_origins, &landing_public_url);
        Ok(Self {
            listen_addr: parse("GATEWAY_LISTEN_ADDR", "127.0.0.1:8787")?,
            database_url: required("DATABASE_URL")?,
            gateway_public_url: required("GATEWAY_PUBLIC_URL")?
                .trim_end_matches('/')
                .to_owned(),
            landing_public_url,
            allowed_origins,
            oidc_client_id: required("OIDC_CLIENT_ID")?,
            oidc_redirect_uri: env::var("OIDC_REDIRECT_URI")
                .unwrap_or_else(|_| "rabbitinterview://auth/callback".to_owned()),
            oidc_post_logout_redirect_uri: env::var("OIDC_POST_LOGOUT_REDIRECT_URI")
                .unwrap_or_else(|_| "rabbitinterview://auth/logout".to_owned()),
            oidc_signing_keyset_file: PathBuf::from(required("OIDC_SIGNING_KEYSET_FILE")?),
            oidc_data_keyring_file: PathBuf::from(required("OIDC_DATA_KEYRING_FILE")?),
            resend_api_key: required("RESEND_API_KEY")?,
            resend_from: required("RESEND_FROM")?,
            resend_api_url: env::var("RESEND_API_URL")
                .unwrap_or_else(|_| "https://api.resend.com".to_owned())
                .trim_end_matches('/')
                .to_owned(),
            trusted_proxy_cidrs: list("GATEWAY_TRUSTED_PROXY_CIDRS", "")
                .into_iter()
                .map(|value| {
                    value
                        .parse()
                        .with_context(|| format!("invalid trusted proxy CIDR {value}"))
                })
                .collect::<Result<Vec<IpNet>>>()?,
            hosted_stt_enabled: flag("HOSTED_STT_ENABLED", false)?,
            hosted_llm_enabled: flag("HOSTED_LLM_ENABLED", false)?,
            payments_enabled: flag("PAYMENTS_ENABLED", false)?,
            admin_token: optional("GATEWAY_ADMIN_TOKEN"),
            volcengine_api_key: optional("VOLCENGINE_API_KEY"),
            volcengine_resource_id: env::var("VOLCENGINE_RESOURCE_ID")
                .unwrap_or_else(|_| "volc.bigasr.sauc.duration".to_owned()),
            volcengine_url: env::var("VOLCENGINE_STT_URL").unwrap_or_else(|_| {
                "wss://openspeech.bytedance.com/api/v3/sauc/bigmodel".to_owned()
            }),
            gemini_api_key: optional("GEMINI_API_KEY"),
            gemini_model: env::var("GEMINI_HOSTED_MODEL")
                .unwrap_or_else(|_| "gemini-3.7-flash".to_owned()),
            initial_stt_hold_ms: parse("STT_INITIAL_HOLD_MS", "60000")?,
            stt_top_up_ms: parse("STT_TOP_UP_MS", "60000")?,
            stt_top_up_threshold_ms: parse("STT_TOP_UP_THRESHOLD_MS", "15000")?,
            reservation_ttl: Duration::from_secs(parse("RESERVATION_TTL_SECONDS", "120")?),
            ticket_ttl: Duration::from_secs(parse("WS_TICKET_TTL_SECONDS", "30")?),
            max_json_bytes: parse("MAX_JSON_BYTES", "131072")?,
            max_ws_frame_bytes: parse("MAX_WS_FRAME_BYTES", "65536")?,
            max_ws_frames_per_second: parse("MAX_WS_FRAMES_PER_SECOND", "100")?,
            max_stt_session: Duration::from_secs(parse("MAX_STT_SESSION_SECONDS", "3600")?),
            global_concurrency_limit: parse("GLOBAL_CONCURRENCY_LIMIT", "100")?,
            pricing_policy_version: env::var("PRICING_POLICY_VERSION")
                .unwrap_or_else(|_| "2026-08-source-duration-v1".to_owned()),
        })
    }

    pub fn validate(&self) -> Result<()> {
        validate_secure_url(
            "GATEWAY_PUBLIC_URL",
            &self.gateway_public_url,
            "https",
            "http",
            true,
        )?;
        validate_secure_url(
            "LANDING_PUBLIC_URL",
            &self.landing_public_url,
            "https",
            "http",
            true,
        )?;
        validate_secure_url(
            "RESEND_API_URL",
            &self.resend_api_url,
            "https",
            "http",
            true,
        )?;
        if self.allowed_origins.iter().any(|origin| origin == "*") {
            return Err(anyhow!("GATEWAY_ALLOWED_ORIGINS cannot contain *"));
        }
        validate_redirect_uri("OIDC_REDIRECT_URI", &self.oidc_redirect_uri, "/callback")?;
        validate_redirect_uri(
            "OIDC_POST_LOGOUT_REDIRECT_URI",
            &self.oidc_post_logout_redirect_uri,
            "/logout",
        )?;
        if self.oidc_client_id != "rabbit-desktop" {
            return Err(anyhow!("OIDC_CLIENT_ID must be rabbit-desktop"));
        }
        validate_from_mailbox(&self.resend_from)?;
        if !self.resend_api_key.starts_with("re_") {
            return Err(anyhow!("RESEND_API_KEY must start with re_"));
        }
        validate_secure_url(
            "VOLCENGINE_STT_URL",
            &self.volcengine_url,
            "wss",
            "ws",
            false,
        )?;
        if self.hosted_stt_enabled && self.volcengine_api_key.is_none() {
            return Err(anyhow!("HOSTED_STT_ENABLED requires VOLCENGINE_API_KEY"));
        }
        if self.hosted_llm_enabled && self.gemini_api_key.is_none() {
            return Err(anyhow!("HOSTED_LLM_ENABLED requires GEMINI_API_KEY"));
        }
        if self.payments_enabled {
            return Err(anyhow!("PAYMENTS_ENABLED cannot be enabled before a payment adapter and verified webhook are configured"));
        }
        if self.initial_stt_hold_ms <= 0
            || self.stt_top_up_ms <= 0
            || self.stt_top_up_threshold_ms < 0
        {
            return Err(anyhow!("STT hold values must be positive"));
        }
        if self.global_concurrency_limit == 0 {
            return Err(anyhow!("GLOBAL_CONCURRENCY_LIMIT must be positive"));
        }
        Ok(())
    }
}

fn validate_redirect_uri(name: &str, value: &str, path: &str) -> Result<()> {
    let url = url::Url::parse(value).with_context(|| format!("invalid {name}"))?;
    if url.scheme() != "rabbitinterview"
        || url.host_str() != Some("auth")
        || url.path() != path
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(anyhow!("invalid {name}"));
    }
    Ok(())
}

fn validate_from_mailbox(value: &str) -> Result<()> {
    let value = value.trim();
    if value.len() > 320 {
        return Err(anyhow!("invalid RESEND_FROM"));
    }
    let address = if let (Some(start), Some(end)) = (value.rfind('<'), value.rfind('>')) {
        if start == 0 || end != value.len() - 1 || start + 1 >= end {
            return Err(anyhow!("invalid RESEND_FROM"));
        }
        value[start + 1..end].trim()
    } else {
        value
    };
    if address.split('@').count() != 2
        || address.starts_with('@')
        || address.ends_with('@')
        || address.contains(' ')
        || !address.contains('.')
    {
        return Err(anyhow!("invalid RESEND_FROM"));
    }
    Ok(())
}

pub(crate) fn validate_secure_url(
    name: &str,
    value: &str,
    secure_scheme: &str,
    local_scheme: &str,
    origin_only: bool,
) -> Result<()> {
    let url = url::Url::parse(value).with_context(|| format!("invalid {name}"))?;
    let local = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    if url.scheme() != secure_scheme && !(local && url.scheme() == local_scheme) {
        return Err(anyhow!("{name} must use {secure_scheme} outside localhost"));
    }
    if !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || (origin_only && url.path() != "/")
    {
        return Err(anyhow!("invalid {name}"));
    }
    Ok(())
}

fn required(name: &str) -> Result<String> {
    env::var(name)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| anyhow!("missing required environment variable {name}"))
}

fn optional(name: &str) -> Option<String> {
    env::var(name).ok().filter(|value| !value.trim().is_empty())
}

fn parse<T>(name: &str, default: &str) -> Result<T>
where
    T: FromStr,
    T::Err: std::error::Error + Send + Sync + 'static,
{
    env::var(name)
        .unwrap_or_else(|_| default.to_owned())
        .parse()
        .with_context(|| format!("invalid {name}"))
}

fn flag(name: &str, default: bool) -> Result<bool> {
    match env::var(name) {
        Ok(value) => match value.to_ascii_lowercase().as_str() {
            "1" | "true" | "yes" | "on" => Ok(true),
            "0" | "false" | "no" | "off" => Ok(false),
            _ => Err(anyhow!("invalid boolean {name}")),
        },
        Err(_) => Ok(default),
    }
}

fn list(name: &str, default: &str) -> Vec<String> {
    env::var(name)
        .unwrap_or_else(|_| default.to_owned())
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn include_loopback_aliases(origins: &mut Vec<String>, landing_public_url: &str) {
    for (from, to) in [("localhost", "127.0.0.1"), ("127.0.0.1", "localhost")] {
        if landing_public_url.contains(from) {
            let alias = landing_public_url.replace(from, to);
            if !origins.contains(&alias) {
                origins.push(alias);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::include_loopback_aliases;
    use super::{validate_from_mailbox, validate_redirect_uri, validate_secure_url};

    #[test]
    fn secure_url_validation_does_not_accept_localhost_prefixes() {
        assert!(validate_secure_url("URL", "http://localhost:8787", "https", "http", true).is_ok());
        assert!(
            validate_secure_url("URL", "https://gateway.example.com", "https", "http", true)
                .is_ok()
        );
        assert!(
            validate_secure_url("URL", "http://localhost.evil", "https", "http", true).is_err()
        );
        assert!(validate_secure_url(
            "URL",
            "https://user@gateway.example.com",
            "https",
            "http",
            true
        )
        .is_err());
    }

    #[test]
    fn auth_callbacks_and_resend_from_are_strict() {
        assert!(validate_redirect_uri(
            "OIDC_REDIRECT_URI",
            "rabbitinterview://auth/callback",
            "/callback"
        )
        .is_ok());
        assert!(validate_redirect_uri(
            "OIDC_REDIRECT_URI",
            "rabbitinterview://evil/callback",
            "/callback"
        )
        .is_err());
        assert!(validate_from_mailbox("Rabbit Interview <no-reply@example.com>").is_ok());
        assert!(validate_from_mailbox("no-reply@example.com").is_ok());
        assert!(validate_from_mailbox("not-an-email").is_err());
        assert!(validate_from_mailbox("<no-reply@example.com>").is_err());
    }

    #[test]
    fn landing_loopback_aliases_are_added_once() {
        let mut origins = vec!["http://localhost:4174".to_owned()];
        include_loopback_aliases(&mut origins, "http://localhost:4174");
        include_loopback_aliases(&mut origins, "http://localhost:4174");
        assert_eq!(
            origins,
            vec![
                "http://localhost:4174".to_owned(),
                "http://127.0.0.1:4174".to_owned(),
            ]
        );
    }
}
