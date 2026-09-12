use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::Path,
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use anyhow::{anyhow, Context};
use argon2::{
    password_hash::{
        rand_core::{OsRng, RngCore},
        PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
    },
    Algorithm as ArgonAlgorithm, Argon2, Params as ArgonParams, Version as ArgonVersion,
};
use axum::http::{header::AUTHORIZATION, HeaderMap};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use chrono::{DateTime, Utc};
use hmac::{Hmac, Mac};
use jsonwebtoken::{
    decode, decode_header, encode, jwk::Jwk, Algorithm, DecodingKey, EncodingKey, Header,
    Validation,
};
use rsa::{
    pkcs1::DecodeRsaPrivateKey, pkcs8::DecodePrivateKey, traits::PublicKeyParts, RsaPrivateKey,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{MySql, MySqlPool, Row, Transaction};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;

use crate::{config::Config, error::AppError};

pub const ACCESS_TOKEN_TTL_SECONDS: i64 = 300;
pub const AUTHORIZATION_TTL_SECONDS: i64 = 300;
pub const REFRESH_TOKEN_TTL_DAYS: i64 = 30;
pub const REFRESH_FAMILY_TTL_DAYS: i64 = 90;
pub const BROWSER_SESSION_IDLE_MINUTES: i64 = 60;
pub const BROWSER_SESSION_TTL_HOURS: i64 = 12;
pub const INVITATION_TTL_HOURS: i64 = 24;
pub const RESET_TTL_MINUTES: i64 = 30;
pub const GATEWAY_AUDIENCE: &str = "oncue-gateway";

type HmacSha256 = Hmac<Sha256>;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Claims {
    pub sub: String,
    pub iss: String,
    pub aud: String,
    pub exp: usize,
    pub iat: usize,
    pub jti: String,
    pub client_id: String,
    pub scope: String,
    pub token_use: String,
    pub sid: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct IdTokenClaims {
    sub: String,
    iss: String,
    aud: String,
    exp: usize,
    iat: usize,
    auth_time: usize,
    nonce: Option<String>,
    at_hash: String,
    sid: Option<String>,
    email: String,
    email_verified: bool,
    name: Option<String>,
}

#[derive(Clone, Debug)]
pub struct Identity {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub status: String,
    pub password_hash: Option<String>,
    pub failed_login_count: u16,
    pub locked_until: Option<DateTime<Utc>>,
    pub totp_secret_ciphertext: Option<Vec<u8>>,
    pub totp_secret_nonce: Option<Vec<u8>>,
    pub totp_key_id: Option<String>,
    pub totp_enabled_at: Option<DateTime<Utc>>,
    pub totp_last_used_step: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct TokenPair {
    pub access_token: String,
    pub id_token: String,
    pub expires_in: u64,
    pub token_type: &'static str,
    pub scope: String,
}

#[derive(Debug, Deserialize)]
struct SigningKeySetFile {
    active_kid: String,
    keys: Vec<SigningKeyFile>,
}

#[derive(Debug, Deserialize)]
struct SigningKeyFile {
    kid: String,
    private_key_file: Option<String>,
    public_jwk: Option<serde_json::Value>,
}

struct SigningKeys {
    active_kid: String,
    encoding: EncodingKey,
    jwks: serde_json::Value,
}

#[derive(Debug, Deserialize)]
struct DataKeyRingFile {
    active_kid: String,
    keys: HashMap<String, String>,
}

struct DataKeyRing {
    active_kid: String,
    keys: HashMap<String, [u8; 32]>,
}

#[derive(Clone)]
pub struct AuthService {
    pool: MySqlPool,
    config: Arc<Config>,
    signing: Arc<SigningKeys>,
    data_keys: Arc<DataKeyRing>,
    http: reqwest::Client,
    rate_limits: Arc<Mutex<HashMap<String, VecDeque<Instant>>>>,
    password_slots: Arc<Semaphore>,
}

impl AuthService {
    pub fn new(
        pool: MySqlPool,
        config: Arc<Config>,
        http: reqwest::Client,
    ) -> anyhow::Result<Self> {
        let signing = SigningKeys::load(&config.oidc_signing_keyset_file)?;
        let data_keys = DataKeyRing::load(&config.oidc_data_keyring_file)?;
        Ok(Self {
            pool,
            config,
            signing: Arc::new(signing),
            data_keys: Arc::new(data_keys),
            http,
            rate_limits: Arc::new(Mutex::new(HashMap::new())),
            password_slots: Arc::new(Semaphore::new(std::thread::available_parallelism()
                .map_or(1, |cpus| cpus.get().saturating_sub(1).clamp(1, 2)))),
        })
    }

    pub fn pool(&self) -> &MySqlPool {
        &self.pool
    }

    pub async fn hash_password(&self, password: &str) -> Result<String, AppError> {
        validate_password(password)?;
        let password = password.to_owned();
        password_job(self.password_slots.clone(), move || hash_password(&password)).await?
    }

    pub async fn verify_password(&self, password: &str, encoded: Option<&str>) -> Result<bool, AppError> {
        let password = password.to_owned();
        let encoded = encoded.map(ToOwned::to_owned);
        password_job(self.password_slots.clone(), move || match encoded {
            Some(encoded) => verify_password(&password, &encoded),
            None => {
                static DUMMY_HASH: OnceLock<String> = OnceLock::new();
                let hash = DUMMY_HASH.get_or_init(|| hash_password("dummy password value").expect("valid dummy password"));
                let _ = verify_password(&password, hash);
                false
            }
        }).await
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    pub fn issuer(&self) -> &str {
        &self.config.gateway_public_url
    }

    pub fn jwks(&self) -> serde_json::Value {
        self.signing.jwks.clone()
    }

    pub async fn authenticate(&self, headers: &HeaderMap) -> Result<Claims, AppError> {
        let header = headers
            .get(AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .ok_or(AppError::Unauthorized)?;
        let token = header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;
        self.verify_access_token(token)
    }

    pub fn verify_access_token(&self, token: &str) -> Result<Claims, AppError> {
        let key = self.decoding_key(token)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[GATEWAY_AUDIENCE, "rabbit-gateway"]);
        validation.set_issuer(&[self.issuer()]);
        validation.set_required_spec_claims(&["exp", "aud", "iss", "sub"]);
        validation.leeway = 60;
        let claims = decode::<Claims>(token, &key, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims;
        if claims.token_use != "access" || claims.client_id != self.config.oidc_client_id {
            return Err(AppError::Unauthorized);
        }
        Ok(claims)
    }

    pub fn verify_id_token_hint(&self, token: &str) -> Result<(String, Option<String>), AppError> {
        let key = self.decoding_key(token)?;
        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[self.config.oidc_client_id.as_str()]);
        validation.set_issuer(&[self.issuer()]);
        validation.set_required_spec_claims(&["aud", "iss", "sub", "iat"]);
        validation.validate_exp = false;
        let claims = decode::<IdTokenClaims>(token, &key, &validation)
            .map_err(|_| AppError::Unauthorized)?
            .claims;
        let now = Utc::now().timestamp();
        if (claims.iat as i64) > now + 60
            || (claims.iat as i64) < now - BROWSER_SESSION_TTL_HOURS * 60 * 60 - 60
        {
            return Err(AppError::Unauthorized);
        }
        Ok((claims.sub, claims.sid))
    }

    fn decoding_key(&self, token: &str) -> Result<DecodingKey, AppError> {
        if token.len() > 16_384 {
            return Err(AppError::Unauthorized);
        }
        let header = decode_header(token).map_err(|_| AppError::Unauthorized)?;
        if header.alg != Algorithm::RS256 {
            return Err(AppError::Unauthorized);
        }
        let kid = header.kid.as_deref().ok_or(AppError::Unauthorized)?;
        let jwk = self
            .signing
            .jwks
            .get("keys")
            .and_then(serde_json::Value::as_array)
            .and_then(|keys| {
                keys.iter()
                    .find(|key| key.get("kid").and_then(serde_json::Value::as_str) == Some(kid))
            })
            .cloned()
            .ok_or(AppError::Unauthorized)?;
        let jwk: Jwk = serde_json::from_value(jwk).map_err(|_| AppError::Unauthorized)?;
        DecodingKey::from_jwk(&jwk).map_err(|_| AppError::Unauthorized)
    }

    pub fn issue_token_pair(
        &self,
        identity: &Identity,
        scope: &str,
        nonce: Option<String>,
        auth_time: DateTime<Utc>,
        sid: Option<String>,
    ) -> Result<TokenPair, AppError> {
        let issued_at = Utc::now().timestamp();
        let expires_at = issued_at + ACCESS_TOKEN_TTL_SECONDS;
        let header = self.signing_header();
        let access_token = encode(
            &header,
            &Claims {
                sub: identity.id.clone(),
                iss: self.issuer().to_owned(),
                aud: GATEWAY_AUDIENCE.to_owned(),
                exp: expires_at as usize,
                iat: issued_at as usize,
                jti: Uuid::new_v4().to_string(),
                client_id: self.config.oidc_client_id.clone(),
                scope: scope.to_owned(),
                token_use: "access".to_owned(),
                sid: sid.clone(),
            },
            &self.signing.encoding,
        )
        .map_err(|_| AppError::Internal)?;
        let id_token = encode(
            &header,
            &IdTokenClaims {
                sub: identity.id.clone(),
                iss: self.issuer().to_owned(),
                aud: self.config.oidc_client_id.clone(),
                exp: expires_at as usize,
                iat: issued_at as usize,
                auth_time: auth_time.timestamp() as usize,
                nonce,
                at_hash: access_token_hash(&access_token),
                sid,
                email: identity.email.clone(),
                email_verified: true,
                name: identity.display_name.clone(),
            },
            &self.signing.encoding,
        )
        .map_err(|_| AppError::Internal)?;
        Ok(TokenPair {
            access_token,
            id_token,
            expires_in: ACCESS_TOKEN_TTL_SECONDS as u64,
            token_type: "Bearer",
            scope: scope.to_owned(),
        })
    }

    fn signing_header(&self) -> Header {
        let mut header = Header::new(Algorithm::RS256);
        header.kid = Some(self.signing.active_kid.clone());
        header.typ = Some("JWT".to_owned());
        header
    }

    pub async fn identity_by_id(&self, account_id: &str) -> Result<Identity, AppError> {
        let row = sqlx::query(
            "SELECT id, email, display_name, status, password_hash, failed_login_count, locked_until, \
                    totp_secret_ciphertext, totp_secret_nonce, totp_key_id, totp_enabled_at, totp_last_used_step \
             FROM accounts WHERE id = ?",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::Unauthorized)?;
        identity_from_row(&row)
    }

    pub(crate) async fn identity_by_id_for_update(
        &self,
        tx: &mut Transaction<'_, MySql>,
        account_id: &str,
    ) -> Result<Identity, AppError> {
        let row = sqlx::query(
            "SELECT id, email, display_name, status, password_hash, failed_login_count, locked_until, \
                    totp_secret_ciphertext, totp_secret_nonce, totp_key_id, totp_enabled_at, totp_last_used_step \
             FROM accounts WHERE id = ? FOR UPDATE",
        )
        .bind(account_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::Unauthorized)?;
        identity_from_row(&row)
    }

    pub async fn identity_by_email(&self, email: &str) -> Result<Option<Identity>, AppError> {
        let normalized = normalize_email(email)?;
        let row = sqlx::query(
            "SELECT id, email, display_name, status, password_hash, failed_login_count, locked_until, \
                    totp_secret_ciphertext, totp_secret_nonce, totp_key_id, totp_enabled_at, totp_last_used_step \
             FROM accounts WHERE normalized_email = ?",
        )
        .bind(normalized)
        .fetch_optional(&self.pool)
        .await?;
        row.as_ref().map(identity_from_row).transpose()
    }

    pub fn encrypt_secret(
        &self,
        account_id: &str,
        plaintext: &[u8],
    ) -> Result<(String, [u8; 12], Vec<u8>), AppError> {
        self.data_keys.encrypt(account_id.as_bytes(), plaintext)
    }

    pub fn decrypt_secret(
        &self,
        account_id: &str,
        kid: &str,
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, AppError> {
        self.data_keys
            .decrypt(account_id.as_bytes(), kid, nonce, ciphertext)
    }

    pub fn csrf_token(&self, binding: &str, purpose: &str) -> String {
        self.data_keys
            .hmac(format!("csrf:{purpose}:{binding}").as_bytes())
    }

    pub fn verify_csrf(&self, binding: &str, purpose: &str, supplied: &str) -> bool {
        let expected = self.csrf_token(binding, purpose);
        expected.len() == supplied.len()
            && expected.as_bytes().ct_eq(supplied.as_bytes()).unwrap_u8() == 1
    }

    pub async fn check_rate_limit(
        &self,
        key: String,
        limit: usize,
        window: Duration,
    ) -> Result<(), AppError> {
        let now = Instant::now();
        let mut limits = self.rate_limits.lock().await;
        let entries = limits.entry(key).or_default();
        while entries
            .front()
            .is_some_and(|instant| now.duration_since(*instant) >= window)
        {
            entries.pop_front();
        }
        if entries.len() >= limit {
            return Err(AppError::RateLimited);
        }
        entries.push_back(now);
        if limits.len() > 10_000 {
            limits.retain(|_, entries| {
                entries
                    .back()
                    .is_some_and(|instant| now.duration_since(*instant) < window)
            });
        }
        Ok(())
    }

    pub async fn send_invitation(
        &self,
        email: &str,
        display_name: Option<&str>,
        token: &str,
    ) -> Result<(), AppError> {
        let link = action_url(&self.config.landing_public_url, "/auth/setup", token)?;
        let greeting = display_name.unwrap_or(email);
        self.send_mail(
            email,
            "OnCue account invitation",
            format!(
                "Hello {greeting},\n\nSet your OnCue password within 24 hours:\n{link}\n\nIf you did not expect this invitation, ignore this email."
            ),
            format!(
                "<p>Hello {},</p><p>Set your OnCue password within 24 hours:</p><p><a href=\"{}\">Set password</a></p><p>If you did not expect this invitation, ignore this email.</p>",
                html_escape::encode_text(greeting),
                html_escape::encode_double_quoted_attribute(&link),
            ),
        )
        .await
    }

    pub async fn send_registration(
        &self,
        email: &str,
        display_name: Option<&str>,
        token: &str,
    ) -> Result<(), AppError> {
        let link = action_url(&self.config.landing_public_url, "/auth/setup", token)?;
        let greeting = display_name.unwrap_or(email);
        self.send_mail(
            email,
            "Verify your OnCue email",
            format!(
                "Hello {greeting},\n\nVerify your email and set your OnCue password within 24 hours:\n{link}\n\nIf you did not create this account, ignore this email."
            ),
            format!(
                "<p>Hello {},</p><p>Verify your email and set your OnCue password within 24 hours:</p><p><a href=\"{}\">Verify email</a></p><p>If you did not create this account, ignore this email.</p>",
                html_escape::encode_text(greeting),
                html_escape::encode_double_quoted_attribute(&link),
            ),
        )
        .await
    }

    pub async fn send_password_reset(
        &self,
        email: &str,
        display_name: Option<&str>,
        token: &str,
    ) -> Result<(), AppError> {
        let link = action_url(
            &self.config.landing_public_url,
            "/auth/reset-password",
            token,
        )?;
        let greeting = display_name.unwrap_or(email);
        self.send_mail(
            email,
            "Reset your OnCue password",
            format!(
                "Hello {greeting},\n\nReset your password within 30 minutes:\n{link}\n\nIf you did not request this, ignore this email."
            ),
            format!(
                "<p>Hello {},</p><p>Reset your password within 30 minutes:</p><p><a href=\"{}\">Reset password</a></p><p>If you did not request this, ignore this email.</p>",
                html_escape::encode_text(greeting),
                html_escape::encode_double_quoted_attribute(&link),
            ),
        )
        .await
    }

    async fn send_mail(
        &self,
        recipient: &str,
        subject: &str,
        plain: String,
        html: String,
    ) -> Result<(), AppError> {
        let response = self
            .http
            .post(format!("{}/emails", self.config.resend_api_url))
            .bearer_auth(&self.config.resend_api_key)
            .json(&serde_json::json!({
                "from": self.config.resend_from,
                "to": [recipient],
                "subject": subject,
                "text": plain,
                "html": html,
            }))
            .send()
            .await
            .map_err(|error| {
                tracing::error!(error_category = %error, "authentication email delivery failed");
                AppError::ProviderUnavailable
            })?;
        if !response.status().is_success() {
            tracing::error!(status = %response.status(), "authentication email delivery failed");
            return Err(AppError::ProviderUnavailable);
        }
        Ok(())
    }
}

impl SigningKeys {
    fn load(path: &Path) -> anyhow::Result<Self> {
        let bytes = fs::read(path)
            .with_context(|| format!("failed to read OIDC signing keyset {}", path.display()))?;
        let definition: SigningKeySetFile = serde_json::from_slice(&bytes)
            .with_context(|| format!("invalid OIDC signing keyset {}", path.display()))?;
        let mut active_encoding = None;
        let mut jwks = Vec::new();
        for key in definition.keys {
            if key.kid.is_empty() {
                return Err(anyhow!("OIDC signing key kid cannot be empty"));
            }
            let public_jwk = if let Some(private_key_file) = key.private_key_file {
                let pem = fs::read(&private_key_file).with_context(|| {
                    format!("failed to read OIDC private key {private_key_file}")
                })?;
                let private = parse_rsa_private_key(&pem)?;
                if key.kid == definition.active_kid {
                    active_encoding = Some(
                        EncodingKey::from_rsa_pem(&pem)
                            .context("failed to load active OIDC RSA private key")?,
                    );
                }
                rsa_public_jwk(&key.kid, &private)
            } else {
                let mut public = key
                    .public_jwk
                    .ok_or_else(|| anyhow!("OIDC public-only key {} has no public_jwk", key.kid))?;
                if public.get("kid").and_then(serde_json::Value::as_str) != Some(&key.kid) {
                    return Err(anyhow!("OIDC public JWK kid mismatch for {}", key.kid));
                }
                public["alg"] = serde_json::Value::String("RS256".to_owned());
                public["use"] = serde_json::Value::String("sig".to_owned());
                public
            };
            let parsed: Jwk = serde_json::from_value(public_jwk.clone())
                .with_context(|| format!("invalid OIDC public JWK {}", key.kid))?;
            DecodingKey::from_jwk(&parsed)
                .with_context(|| format!("unusable OIDC public JWK {}", key.kid))?;
            jwks.push(public_jwk);
        }
        let encoding = active_encoding
            .ok_or_else(|| anyhow!("active OIDC signing key must include private_key_file"))?;
        Ok(Self {
            active_kid: definition.active_kid,
            encoding,
            jwks: serde_json::json!({ "keys": jwks }),
        })
    }
}

impl DataKeyRing {
    fn load(path: &Path) -> anyhow::Result<Self> {
        let bytes = fs::read(path)
            .with_context(|| format!("failed to read OIDC data keyring {}", path.display()))?;
        let definition: DataKeyRingFile = serde_json::from_slice(&bytes)
            .with_context(|| format!("invalid OIDC data keyring {}", path.display()))?;
        let mut keys = HashMap::new();
        for (kid, encoded) in definition.keys {
            let decoded = URL_SAFE_NO_PAD
                .decode(encoded)
                .with_context(|| format!("invalid OIDC data key {kid}"))?;
            let key: [u8; 32] = decoded
                .try_into()
                .map_err(|_| anyhow!("OIDC data key {kid} must be exactly 32 bytes"))?;
            keys.insert(kid, key);
        }
        if !keys.contains_key(&definition.active_kid) {
            return Err(anyhow!("active OIDC data key is missing"));
        }
        Ok(Self {
            active_kid: definition.active_kid,
            keys,
        })
    }

    fn encrypt(
        &self,
        aad: &[u8],
        plaintext: &[u8],
    ) -> Result<(String, [u8; 12], Vec<u8>), AppError> {
        let key = self.keys.get(&self.active_kid).ok_or(AppError::Internal)?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::Internal)?;
        let mut nonce = [0_u8; 12];
        OsRng.fill_bytes(&mut nonce);
        let nonce_value = Nonce::from(nonce);
        let ciphertext = cipher
            .encrypt(
                &nonce_value,
                Payload {
                    msg: plaintext,
                    aad,
                },
            )
            .map_err(|_| AppError::Internal)?;
        Ok((self.active_kid.clone(), nonce, ciphertext))
    }

    fn decrypt(
        &self,
        aad: &[u8],
        kid: &str,
        nonce: &[u8],
        ciphertext: &[u8],
    ) -> Result<Vec<u8>, AppError> {
        let nonce: [u8; 12] = nonce.try_into().map_err(|_| AppError::Internal)?;
        let key = self.keys.get(kid).ok_or(AppError::Internal)?;
        let cipher = Aes256Gcm::new_from_slice(key).map_err(|_| AppError::Internal)?;
        let nonce = Nonce::from(nonce);
        cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: ciphertext,
                    aad,
                },
            )
            .map_err(|_| AppError::Internal)
    }

    fn hmac(&self, value: &[u8]) -> String {
        let key = &self.keys[&self.active_kid];
        let mut mac = <HmacSha256 as Mac>::new_from_slice(key).expect("fixed HMAC key length");
        mac.update(value);
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }
}

fn parse_rsa_private_key(pem: &[u8]) -> anyhow::Result<RsaPrivateKey> {
    let value = std::str::from_utf8(pem).context("OIDC private key is not UTF-8 PEM")?;
    RsaPrivateKey::from_pkcs8_pem(value)
        .or_else(|_| RsaPrivateKey::from_pkcs1_pem(value))
        .context("OIDC private key must be PKCS#8 or PKCS#1 RSA PEM")
}

fn rsa_public_jwk(kid: &str, private: &RsaPrivateKey) -> serde_json::Value {
    let public = private.to_public_key();
    serde_json::json!({
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "kid": kid,
        "n": URL_SAFE_NO_PAD.encode(public.n().to_bytes_be()),
        "e": URL_SAFE_NO_PAD.encode(public.e().to_bytes_be()),
    })
}

fn identity_from_row(row: &sqlx::mysql::MySqlRow) -> Result<Identity, AppError> {
    let email: Option<String> = row.try_get("email")?;
    Ok(Identity {
        id: row.try_get("id")?,
        email: email.ok_or(AppError::Unauthorized)?,
        display_name: row.try_get("display_name")?,
        status: row.try_get("status")?,
        password_hash: row.try_get("password_hash")?,
        failed_login_count: row.try_get::<u16, _>("failed_login_count")?,
        locked_until: row
            .try_get::<Option<chrono::NaiveDateTime>, _>("locked_until")?
            .map(|value| value.and_utc()),
        totp_secret_ciphertext: row.try_get("totp_secret_ciphertext")?,
        totp_secret_nonce: row.try_get("totp_secret_nonce")?,
        totp_key_id: row.try_get("totp_key_id")?,
        totp_enabled_at: row
            .try_get::<Option<chrono::NaiveDateTime>, _>("totp_enabled_at")?
            .map(|value| value.and_utc()),
        totp_last_used_step: row.try_get("totp_last_used_step")?,
    })
}

pub fn normalize_email(email: &str) -> Result<String, AppError> {
    let trimmed = email.trim();
    if trimmed.len() > 320 || !looks_like_email(trimmed) {
        return Err(AppError::BadRequest("Enter a valid email address."));
    }
    Ok(trimmed.to_lowercase())
}

fn looks_like_email(value: &str) -> bool {
    let mut parts = value.split('@');
    matches!((parts.next(), parts.next(), parts.next()), (Some(local), Some(domain), None)
        if !local.is_empty()
            && domain.contains('.')
            && !domain.starts_with('.')
            && !domain.ends_with('.')
            && !value.contains(' '))
}

pub fn validate_password(password: &str) -> Result<(), AppError> {
    let chars = password.chars().count();
    if !(12..=128).contains(&chars) || password.len() > 512 {
        return Err(AppError::BadRequest(
            "Password must contain between 12 and 128 characters.",
        ));
    }
    Ok(())
}

async fn password_job<T: Send + 'static>(slots: Arc<Semaphore>, job: impl FnOnce() -> T + Send + 'static) -> Result<T, AppError> {
    let permit = slots.try_acquire_owned().map_err(|_| {
        tracing::warn!(phase = "password_work", "password CPU capacity exhausted");
        AppError::RateLimited
    })?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        job()
    }).await.map_err(|error| {
        tracing::error!(%error, "password worker failed");
        AppError::Internal
    })
}

pub fn hash_password(password: &str) -> Result<String, AppError> {
    validate_password(password)?;
    let params = ArgonParams::new(19_456, 2, 1, None).map_err(|_| AppError::Internal)?;
    let argon = Argon2::new(ArgonAlgorithm::Argon2id, ArgonVersion::V0x13, params);
    let salt = SaltString::generate(&mut OsRng);
    argon
        .hash_password(password.as_bytes(), &salt)
        .map(|value| value.to_string())
        .map_err(|_| AppError::Internal)
}

pub fn verify_password(password: &str, encoded: &str) -> bool {
    let Ok(hash) = PasswordHash::new(encoded) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &hash)
        .is_ok()
}

pub fn random_secret() -> String {
    let mut value = [0_u8; 32];
    OsRng.fill_bytes(&mut value);
    URL_SAFE_NO_PAD.encode(value)
}

pub fn secret_hash(secret: &str) -> String {
    let mut hash = Sha256::new();
    hash.update(secret.as_bytes());
    format!("{:x}", hash.finalize())
}

pub fn access_token_hash(access_token: &str) -> String {
    let digest = Sha256::digest(access_token.as_bytes());
    URL_SAFE_NO_PAD.encode(&digest[..digest.len() / 2])
}

fn action_url(base: &str, path: &str, token: &str) -> Result<String, AppError> {
    let mut url = url::Url::parse(base).map_err(|_| AppError::Internal)?;
    url.set_path(path);
    url.set_query(None);
    let fragment = url::form_urlencoded::Serializer::new(String::new())
        .append_pair("token", token)
        .finish();
    url.set_fragment(Some(&fragment));
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn password_workers_keep_permits_after_waiter_cancellation() {
        use std::{sync::Arc, time::Duration};
        let slots = Arc::new(tokio::sync::Semaphore::new(2));
        let mut waiters = Vec::new();
        let mut releases = Vec::new();
        for _ in 0..2 {
            let (started, ready) = tokio::sync::oneshot::channel();
            let (release, gate) = std::sync::mpsc::channel::<()>();
            let slots = slots.clone();
            releases.push(release);
            waiters.push(tokio::spawn(super::password_job(slots, move || {
                let _ = started.send(());
                let _ = gate.recv_timeout(Duration::from_secs(5));
            })));
            tokio::time::timeout(Duration::from_secs(1), ready).await.unwrap().unwrap();
        }
        tokio::time::timeout(Duration::from_secs(1), tokio::time::sleep(Duration::from_millis(10))).await.unwrap();
        assert!(matches!(super::password_job(slots.clone(), || panic!("over-capacity job ran")).await, Err(crate::error::AppError::RateLimited)));
        for waiter in waiters {
            waiter.abort();
            assert!(waiter.await.unwrap_err().is_cancelled());
        }
        assert_eq!(slots.available_permits(), 0, "cancelling a waiter freed a running CPU slot");
        for release in releases { release.send(()).unwrap(); }
        let permits = tokio::time::timeout(Duration::from_secs(1), slots.acquire_many(2)).await.unwrap().unwrap();
        drop(permits);
        assert_eq!(slots.available_permits(), 2);
        let password = "correct horse battery staple";
        let encoded = super::password_job(slots.clone(), move || super::hash_password(password)).await.unwrap().unwrap();
        assert!(super::password_job(slots, move || super::verify_password(password, &encoded)).await.unwrap());
    }

    use super::{
        access_token_hash, action_url, hash_password, normalize_email, secret_hash, verify_password,
    };

    #[test]
    fn password_hashes_are_salted_and_verifiable() {
        let one = hash_password("correct horse battery staple").unwrap();
        let two = hash_password("correct horse battery staple").unwrap();
        assert_ne!(one, two);
        assert!(verify_password("correct horse battery staple", &one));
        assert!(!verify_password("wrong password", &one));
    }

    #[test]
    fn browser_action_tokens_stay_out_of_http_queries() {
        let url = action_url("https://www.example.com", "/auth/setup", "secret+/=").unwrap();
        let parsed = url::Url::parse(&url).unwrap();
        assert_eq!(parsed.path(), "/auth/setup");
        assert!(parsed.query().is_none());
        assert_eq!(parsed.fragment(), Some("token=secret%2B%2F%3D"));
    }

    #[test]
    fn identifiers_are_normalized_and_secrets_are_not_stored_raw() {
        assert_eq!(
            normalize_email(" Alice@Example.COM ").unwrap(),
            "alice@example.com"
        );
        assert!(normalize_email("not-an-email").is_err());
        assert_ne!(secret_hash("secret"), "secret");
        assert_eq!(access_token_hash("token").len(), 22);
    }
}
