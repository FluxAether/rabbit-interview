use std::{collections::BTreeMap, sync::Arc, time::Duration};

use anyhow::{anyhow, Context};
use axum::{
    extract::{Form, Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use axum_extra::extract::cookie::CookieJar;
use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Duration as ChronoDuration, NaiveDateTime, SecondsFormat, Utc};
use rsa::{
    pkcs1::{DecodeRsaPrivateKey, DecodeRsaPublicKey},
    pkcs1v15::{Signature, SigningKey, VerifyingKey},
    pkcs8::{DecodePrivateKey, DecodePublicKey},
    signature::{SignatureEncoding, Signer, Verifier},
    RsaPrivateKey, RsaPublicKey,
};
use serde::{Deserialize, Serialize};
use serde_json::{value::RawValue, Value};
use sha2::{Digest, Sha256};
use sqlx::{mysql::MySqlRow, MySqlPool, Row, Transaction};
use url::Url;
use uuid::Uuid;

use crate::{
    config::Config,
    entitlement::{hash_json, insert_idempotency, load_idempotency, lock_account},
    error::AppError,
    oidc::load_browser_session,
    protocol::{PaymentProduct, SubscriptionSummary},
    AppState,
};

const CHANNEL: &str = "ALIPAY";
const CURRENCY: &str = "CNY";
const ORDER_TTL_MINUTES: i64 = 30;

#[derive(Clone, Copy)]
struct Product {
    code: &'static str,
    subject: &'static str,
    price_minor: i64,
    duration_days: i64,
    stt_ms: i64,
    llm_units: i64,
}

const PRODUCTS: [Product; 2] = [
    Product {
        code: "PRO_MONTH",
        subject: "OnCue Pro - 30 days",
        price_minor: 8_900,
        duration_days: 30,
        stt_ms: 54_000_000,
        llm_units: 2_000_000,
    },
    Product {
        code: "PRO_QUARTER",
        subject: "OnCue Pro - 90 days",
        price_minor: 19_900,
        duration_days: 90,
        stt_ms: 180_000_000,
        llm_units: 8_000_000,
    },
];

#[derive(Clone)]
pub struct PaymentService {
    pool: MySqlPool,
    http: reqwest::Client,
    provider: Arc<dyn PaymentProvider>,
}

trait PaymentProvider: Send + Sync {
    fn checkout_url(&self, order: &CheckoutOrder<'_>) -> Result<String, AppError>;
    fn query_url(&self, merchant_order_no: &str) -> Result<String, AppError>;
    fn verify_notification(&self, fields: &BTreeMap<String, String>) -> bool;
    fn notification_trade(
        &self,
        fields: &BTreeMap<String, String>,
    ) -> Result<ProviderTrade, AppError>;
    fn query_trade(&self, body: &str) -> Result<Option<ProviderTrade>, AppError>;
}

struct CheckoutOrder<'a> {
    merchant_order_no: &'a str,
    subject: &'a str,
    amount_minor: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TradeStatus {
    Pending,
    Paid,
    Closed,
}

struct ProviderTrade {
    merchant_order_no: String,
    trade_no: Option<String>,
    amount_minor: i64,
    status: TradeStatus,
    event_id: String,
    payload: Value,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct CreateOrderRequest {
    product_code: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PaymentOrderResponse {
    pub merchant_order_no: String,
    pub product_code: String,
    pub status: String,
    pub checkout_url: Option<String>,
    pub expires_at: String,
    pub paid_at: Option<String>,
    pub paid_through: Option<String>,
}

struct OrderRow {
    id: String,
    merchant_order_no: String,
    account_id: String,
    product_code: String,
    channel: String,
    provider_trade_no: Option<String>,
    amount_minor: i64,
    currency: String,
    duration_days: i64,
    stt_units: i64,
    llm_units: i64,
    status: String,
    expires_at: NaiveDateTime,
    paid_at: Option<NaiveDateTime>,
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/account/payment-orders", post(create_order))
        .route(
            "/account/payment-orders/{merchant_order_no}",
            get(get_order),
        )
        .route(
            "/account/payment-orders/{merchant_order_no}/refresh",
            post(refresh_order),
        )
        .route("/webhooks/alipay", post(alipay_webhook))
}

impl PaymentService {
    pub fn from_config(
        pool: MySqlPool,
        http: reqwest::Client,
        config: &Config,
    ) -> anyhow::Result<Option<Self>> {
        if !config.payments_enabled {
            return Ok(None);
        }
        let provider = AlipayProvider::from_config(config)?;
        Ok(Some(Self {
            pool,
            http,
            provider: Arc::new(provider),
        }))
    }

    pub fn products(&self) -> Vec<PaymentProduct> {
        PRODUCTS
            .iter()
            .map(|product| PaymentProduct {
                code: product.code,
                price_minor: product.price_minor,
                currency: CURRENCY,
                duration_days: product.duration_days,
                stt_ms: product.stt_ms,
                llm_units: product.llm_units,
            })
            .collect()
    }

    pub async fn subscription(
        &self,
        account_id: &str,
    ) -> Result<Option<SubscriptionSummary>, AppError> {
        let row = sqlx::query(
            "SELECT product_code, starts_at, ends_at FROM subscriptions \
             WHERE account_id = ? AND ends_at > UTC_TIMESTAMP(6) \
             ORDER BY ends_at DESC LIMIT 1",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            let starts_at: NaiveDateTime = row.try_get("starts_at")?;
            let ends_at: NaiveDateTime = row.try_get("ends_at")?;
            Ok(SubscriptionSummary {
                product_code: row.try_get("product_code")?,
                starts_at: timestamp(starts_at),
                paid_through: timestamp(ends_at),
            })
        })
        .transpose()
        .map_err(AppError::Database)
    }

    async fn create(
        &self,
        account_id: &str,
        request: &CreateOrderRequest,
        idempotency_key: &str,
    ) -> Result<PaymentOrderResponse, AppError> {
        let product = product(&request.product_code)
            .ok_or(AppError::BadRequest("Unknown subscription product."))?;
        let request_hash = hash_json(request)?;
        let now = Utc::now();
        let expires_at = now + ChronoDuration::minutes(ORDER_TTL_MINUTES);
        let mut tx = self.pool.begin().await?;
        if lock_account(&mut tx, account_id).await? != "ACTIVE" {
            return Err(AppError::AccountSuspended);
        }
        if let Some((operation, stored_hash, response)) =
            load_idempotency(&mut tx, account_id, idempotency_key).await?
        {
            if operation != "payment_order" || stored_hash != request_hash {
                return Err(AppError::IdempotencyConflict);
            }
            return serde_json::from_value(response).map_err(|_| AppError::Internal);
        }

        let id = Uuid::new_v4().to_string();
        let merchant_order_no = format!("RI{}", Uuid::new_v4().simple());
        let checkout_url = self.provider.checkout_url(&CheckoutOrder {
            merchant_order_no: &merchant_order_no,
            subject: product.subject,
            amount_minor: product.price_minor,
        })?;
        sqlx::query(
            "INSERT INTO payment_orders \
             (id, merchant_order_no, account_id, product_code, channel, amount_minor, currency, duration_days, stt_units, llm_units, expires_at) \
             VALUES (?, ?, ?, ?, 'ALIPAY', ?, 'CNY', ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&merchant_order_no)
        .bind(account_id)
        .bind(product.code)
        .bind(product.price_minor)
        .bind(product.duration_days)
        .bind(product.stt_ms)
        .bind(product.llm_units)
        .bind(expires_at.naive_utc())
        .execute(&mut *tx)
        .await?;
        let response = PaymentOrderResponse {
            merchant_order_no,
            product_code: product.code.to_owned(),
            status: "PENDING".to_owned(),
            checkout_url: Some(checkout_url),
            expires_at: timestamp(expires_at.naive_utc()),
            paid_at: None,
            paid_through: None,
        };
        let response_json = serde_json::to_value(&response).map_err(|_| AppError::Internal)?;
        insert_idempotency(
            &mut tx,
            account_id,
            idempotency_key,
            "payment_order",
            &request_hash,
            &response_json,
        )
        .await?;
        tx.commit().await?;
        Ok(response)
    }

    async fn order(
        &self,
        account_id: &str,
        merchant_order_no: &str,
    ) -> Result<PaymentOrderResponse, AppError> {
        validate_order_no(merchant_order_no)?;
        let row = sqlx::query(
            "SELECT o.id, o.merchant_order_no, o.account_id, o.product_code, o.channel, o.provider_trade_no, \
                    o.amount_minor, o.currency, o.duration_days, o.stt_units, o.llm_units, o.status, o.expires_at, o.paid_at, s.ends_at \
             FROM payment_orders o LEFT JOIN subscriptions s ON s.payment_order_id = o.id \
             WHERE o.account_id = ? AND o.merchant_order_no = ?",
        )
        .bind(account_id)
        .bind(merchant_order_no)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        payment_order_response(&row)
    }

    async fn refresh(
        &self,
        account_id: &str,
        merchant_order_no: &str,
    ) -> Result<PaymentOrderResponse, AppError> {
        let current = self.order(account_id, merchant_order_no).await?;
        if current.status != "PENDING" {
            return Ok(current);
        }
        let url = self.provider.query_url(merchant_order_no)?;
        let response = self
            .http
            .get(url)
            .send()
            .await
            .map_err(|_| AppError::ProviderUnavailable)?;
        if !response.status().is_success() {
            return Err(AppError::ProviderUnavailable);
        }
        let body = response
            .text()
            .await
            .map_err(|_| AppError::ProviderUnavailable)?;
        if body.len() > 1_048_576 {
            return Err(AppError::ProviderProtocol);
        }
        if let Some(trade) = self.provider.query_trade(&body)? {
            if trade.merchant_order_no != merchant_order_no {
                return Err(AppError::ProviderProtocol);
            }
            if !self.apply_trade(trade).await? {
                return Err(AppError::ProviderProtocol);
            }
        }
        self.order(account_id, merchant_order_no).await
    }

    async fn process_notification(&self, fields: BTreeMap<String, String>) -> bool {
        if !self.provider.verify_notification(&fields) {
            self.record_rejected(&fields, false).await;
            return false;
        }
        let trade = match self.provider.notification_trade(&fields) {
            Ok(value) => value,
            Err(_) => {
                self.record_rejected(&fields, true).await;
                return false;
            }
        };
        match self.apply_trade(trade).await {
            Ok(value) => value,
            Err(error) => {
                tracing::error!(error_code = %error, "payment notification failed");
                false
            }
        }
    }

    async fn record_rejected(&self, fields: &BTreeMap<String, String>, signature_valid: bool) {
        let canonical = canonical_notification(fields);
        let payload_hash = digest_hex(canonical.as_bytes());
        let event_id = fields
            .get("notify_id")
            .filter(|value| valid_provider_id(value, 191))
            .cloned()
            .unwrap_or_else(|| format!("rejected:{payload_hash}"));
        let merchant_order_no = fields
            .get("out_trade_no")
            .filter(|value| valid_provider_id(value, 64));
        let _ = sqlx::query(
            "INSERT IGNORE INTO payment_events \
             (id, channel, event_id, merchant_order_no, signature_valid, payload_hash, payload, processing_status, processed_at) \
             VALUES (?, 'ALIPAY', ?, ?, ?, ?, ?, 'REJECTED', UTC_TIMESTAMP(6))",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(event_id)
        .bind(merchant_order_no)
        .bind(signature_valid)
        .bind(payload_hash)
        .bind(allowlisted_notification(fields, "webhook"))
        .execute(&self.pool)
        .await;
    }

    async fn apply_trade(&self, trade: ProviderTrade) -> Result<bool, AppError> {
        let payload_hash =
            digest_hex(&serde_json::to_vec(&trade.payload).map_err(|_| AppError::Internal)?);
        let mut tx = self.pool.begin().await?;
        let row = sqlx::query(
            "SELECT id, merchant_order_no, account_id, product_code, channel, provider_trade_no, \
                    amount_minor, currency, duration_days, stt_units, llm_units, status, expires_at, paid_at \
             FROM payment_orders WHERE merchant_order_no = ? FOR UPDATE",
        )
        .bind(&trade.merchant_order_no)
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            insert_event(&mut tx, &trade, &payload_hash, "REJECTED").await?;
            tx.commit().await?;
            return Ok(false);
        };
        let order = order_row(&row)?;
        if let Some(event) = sqlx::query(
            "SELECT merchant_order_no, processing_status FROM payment_events \
             WHERE channel = 'ALIPAY' AND event_id = ? FOR UPDATE",
        )
        .bind(&trade.event_id)
        .fetch_optional(&mut *tx)
        .await?
        {
            let event_order: Option<String> = event.try_get("merchant_order_no")?;
            let status: String = event.try_get("processing_status")?;
            tx.commit().await?;
            return Ok(
                event_order.as_deref() == Some(trade.merchant_order_no.as_str())
                    && status == "PROCESSED",
            );
        }

        let trade_number_matches = match (&order.provider_trade_no, &trade.trade_no) {
            (Some(expected), Some(actual)) => expected == actual,
            (Some(_), None) => false,
            _ => true,
        };
        let valid = order.channel == CHANNEL
            && order.currency == CURRENCY
            && order.amount_minor == trade.amount_minor
            && trade_number_matches;
        insert_event(
            &mut tx,
            &trade,
            &payload_hash,
            if valid { "RECEIVED" } else { "REJECTED" },
        )
        .await?;
        if !valid {
            tx.commit().await?;
            return Ok(false);
        }

        match trade.status {
            TradeStatus::Pending => {}
            TradeStatus::Closed if order.status != "PAID" => {
                sqlx::query("UPDATE payment_orders SET status = 'CLOSED' WHERE id = ?")
                    .bind(&order.id)
                    .execute(&mut *tx)
                    .await?;
            }
            TradeStatus::Closed => {}
            TradeStatus::Paid if order.status == "PAID" => {}
            TradeStatus::Paid => {
                let trade_no = trade
                    .trade_no
                    .as_deref()
                    .ok_or(AppError::ProviderProtocol)?;
                lock_account(&mut tx, &order.account_id).await?;
                let now = Utc::now().naive_utc();
                let previous_end = sqlx::query_scalar::<_, Option<NaiveDateTime>>(
                    "SELECT MAX(ends_at) FROM subscriptions WHERE account_id = ?",
                )
                .bind(&order.account_id)
                .fetch_one(&mut *tx)
                .await?;
                let starts_at = previous_end.filter(|value| *value > now).unwrap_or(now);
                let ends_at = starts_at + ChronoDuration::days(order.duration_days);
                let subscription_id = Uuid::new_v4().to_string();
                sqlx::query(
                    "INSERT INTO subscriptions \
                     (id, account_id, payment_order_id, product_code, starts_at, ends_at) \
                     VALUES (?, ?, ?, ?, ?, ?)",
                )
                .bind(&subscription_id)
                .bind(&order.account_id)
                .bind(&order.id)
                .bind(&order.product_code)
                .bind(starts_at)
                .bind(ends_at)
                .execute(&mut *tx)
                .await?;
                for (metric, units) in [
                    ("STT_AUDIO_MS", order.stt_units),
                    ("LLM_TOKEN_UNITS", order.llm_units),
                ] {
                    sqlx::query(
                        "INSERT INTO quota_buckets \
                         (id, account_id, metric, source_type, source_ref, granted_units, remaining_units, valid_from, valid_until, priority) \
                         VALUES (?, ?, ?, 'SUBSCRIPTION', ?, ?, ?, ?, ?, 100)",
                    )
                    .bind(Uuid::new_v4().to_string())
                    .bind(&order.account_id)
                    .bind(metric)
                    .bind(&subscription_id)
                    .bind(units)
                    .bind(units)
                    .bind(starts_at)
                    .bind(ends_at)
                    .execute(&mut *tx)
                    .await?;
                }
                sqlx::query(
                    "UPDATE payment_orders SET status = 'PAID', provider_trade_no = ?, paid_at = ? WHERE id = ?",
                )
                .bind(trade_no)
                .bind(now)
                .bind(&order.id)
                .execute(&mut *tx)
                .await?;
            }
        }
        sqlx::query(
            "UPDATE payment_events SET processing_status = 'PROCESSED', processed_at = UTC_TIMESTAMP(6) \
             WHERE channel = 'ALIPAY' AND event_id = ?",
        )
        .bind(&trade.event_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }
}

async fn create_order(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Json(request): Json<CreateOrderRequest>,
) -> Result<Json<PaymentOrderResponse>, AppError> {
    let session = payment_session(&state, &jar, &headers, true).await?;
    let idempotency_key = required_header(&headers, "idempotency-key", 191)?;
    let payments = state.payments().ok_or(AppError::NotFound)?;
    Ok(Json(
        payments
            .create(&session.account_id, &request, idempotency_key)
            .await?,
    ))
}

async fn get_order(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(merchant_order_no): Path<String>,
) -> Result<Json<PaymentOrderResponse>, AppError> {
    let session = payment_session(&state, &jar, &HeaderMap::new(), false).await?;
    let payments = state.payments().ok_or(AppError::NotFound)?;
    Ok(Json(
        payments
            .order(&session.account_id, &merchant_order_no)
            .await?,
    ))
}

async fn refresh_order(
    State(state): State<AppState>,
    jar: CookieJar,
    headers: HeaderMap,
    Path(merchant_order_no): Path<String>,
) -> Result<Json<PaymentOrderResponse>, AppError> {
    let session = payment_session(&state, &jar, &headers, true).await?;
    state
        .auth()
        .check_rate_limit(
            format!("payment-refresh:{}:{merchant_order_no}", session.account_id),
            6,
            Duration::from_secs(60),
        )
        .await?;
    let payments = state.payments().ok_or(AppError::NotFound)?;
    Ok(Json(
        payments
            .refresh(&session.account_id, &merchant_order_no)
            .await?,
    ))
}

async fn alipay_webhook(
    State(state): State<AppState>,
    Form(fields): Form<BTreeMap<String, String>>,
) -> Response {
    let accepted = match state.payments() {
        Some(payments) if fields.len() <= 64 => payments.process_notification(fields).await,
        _ => false,
    };
    (
        StatusCode::OK,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        if accepted { "success" } else { "failure" },
    )
        .into_response()
}

async fn payment_session(
    state: &AppState,
    jar: &CookieJar,
    headers: &HeaderMap,
    require_csrf: bool,
) -> Result<crate::oidc::BrowserSession, AppError> {
    let session = load_browser_session(state.auth(), jar)
        .await?
        .ok_or(AppError::Unauthorized)?;
    if require_csrf {
        let supplied = required_header(headers, "x-csrf-token", 128)?;
        if !state
            .auth()
            .verify_csrf(&session.raw_token, "payment", supplied)
        {
            return Err(AppError::Unauthorized);
        }
    }
    Ok(session)
}

fn required_header<'a>(
    headers: &'a HeaderMap,
    name: &'static str,
    max_len: usize,
) -> Result<&'a str, AppError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= max_len)
        .ok_or(AppError::BadRequest(
            "A required request header is missing or invalid.",
        ))
}

fn product(code: &str) -> Option<&'static Product> {
    PRODUCTS.iter().find(|product| product.code == code)
}

fn validate_order_no(value: &str) -> Result<(), AppError> {
    if value.len() == 34
        && value.starts_with("RI")
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
    {
        Ok(())
    } else {
        Err(AppError::NotFound)
    }
}

fn timestamp(value: NaiveDateTime) -> String {
    value.and_utc().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn order_row(row: &MySqlRow) -> Result<OrderRow, AppError> {
    Ok(OrderRow {
        id: row.try_get("id")?,
        merchant_order_no: row.try_get("merchant_order_no")?,
        account_id: row.try_get("account_id")?,
        product_code: row.try_get("product_code")?,
        channel: row.try_get("channel")?,
        provider_trade_no: row.try_get("provider_trade_no")?,
        amount_minor: row.try_get("amount_minor")?,
        currency: row.try_get("currency")?,
        duration_days: row.try_get("duration_days")?,
        stt_units: row.try_get("stt_units")?,
        llm_units: row.try_get("llm_units")?,
        status: row.try_get("status")?,
        expires_at: row.try_get("expires_at")?,
        paid_at: row.try_get("paid_at")?,
    })
}

fn payment_order_response(row: &MySqlRow) -> Result<PaymentOrderResponse, AppError> {
    let order = order_row(row)?;
    let paid_through = row
        .try_get::<Option<NaiveDateTime>, _>("ends_at")?
        .map(timestamp);
    Ok(PaymentOrderResponse {
        merchant_order_no: order.merchant_order_no,
        product_code: order.product_code,
        status: order.status,
        checkout_url: None,
        expires_at: timestamp(order.expires_at),
        paid_at: order.paid_at.map(timestamp),
        paid_through,
    })
}

async fn insert_event(
    tx: &mut Transaction<'_, sqlx::MySql>,
    trade: &ProviderTrade,
    payload_hash: &str,
    status: &str,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO payment_events \
         (id, channel, event_id, merchant_order_no, signature_valid, payload_hash, payload, processing_status, processed_at) \
         VALUES (?, 'ALIPAY', ?, ?, TRUE, ?, ?, ?, IF(? = 'REJECTED', UTC_TIMESTAMP(6), NULL))",
    )
    .bind(Uuid::new_v4().to_string())
    .bind(&trade.event_id)
    .bind(&trade.merchant_order_no)
    .bind(payload_hash)
    .bind(&trade.payload)
    .bind(status)
    .bind(status)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

struct AlipayProvider {
    app_id: String,
    seller_id: String,
    gateway: Url,
    notify_url: String,
    return_url: String,
    signing_key: SigningKey<Sha256>,
    verifying_key: VerifyingKey<Sha256>,
}

impl AlipayProvider {
    fn from_config(config: &Config) -> anyhow::Result<Self> {
        let private_der = STANDARD
            .decode(
                config
                    .alipay_private_key
                    .as_deref()
                    .context("missing ALIPAY_PRIVATE_KEY")?
                    .trim(),
            )
            .context("invalid Base64 in ALIPAY_PRIVATE_KEY")?;
        let public_der = STANDARD
            .decode(
                config
                    .alipay_public_key
                    .as_deref()
                    .context("missing ALIPAY_PUBLIC_KEY")?
                    .trim(),
            )
            .context("invalid Base64 in ALIPAY_PUBLIC_KEY")?;
        let private_key = RsaPrivateKey::from_pkcs8_der(&private_der)
            .or_else(|_| RsaPrivateKey::from_pkcs1_der(&private_der))
            .context("invalid Alipay application private key")?;
        let public_key = RsaPublicKey::from_public_key_der(&public_der)
            .or_else(|_| RsaPublicKey::from_pkcs1_der(&public_der))
            .context("invalid Alipay public key")?;
        let gateway = Url::parse(&config.alipay_gateway_url)?;
        if gateway.query().is_some() || gateway.fragment().is_some() {
            return Err(anyhow!(
                "ALIPAY_GATEWAY_URL cannot contain a query or fragment"
            ));
        }
        Ok(Self {
            app_id: config
                .alipay_app_id
                .clone()
                .context("missing ALIPAY_APP_ID")?,
            seller_id: config
                .alipay_seller_id
                .clone()
                .context("missing ALIPAY_SELLER_ID")?,
            gateway,
            notify_url: format!("{}/webhooks/alipay", config.gateway_public_url),
            return_url: format!("{}/subscribe", config.landing_public_url),
            signing_key: SigningKey::new(private_key),
            verifying_key: VerifyingKey::new(public_key),
        })
    }

    fn signed_url(
        &self,
        method: &str,
        biz_content: String,
        checkout: bool,
    ) -> Result<String, AppError> {
        let mut params = BTreeMap::from([
            ("app_id".to_owned(), self.app_id.clone()),
            ("biz_content".to_owned(), biz_content),
            ("charset".to_owned(), "utf-8".to_owned()),
            ("method".to_owned(), method.to_owned()),
            ("sign_type".to_owned(), "RSA2".to_owned()),
            (
                "timestamp".to_owned(),
                Utc::now().format("%Y-%m-%d %H:%M:%S").to_string(),
            ),
            ("version".to_owned(), "1.0".to_owned()),
        ]);
        if checkout {
            params.insert("notify_url".to_owned(), self.notify_url.clone());
            params.insert("return_url".to_owned(), self.return_url.clone());
        }
        let canonical = canonical_pairs(&params);
        let signature = self.signing_key.sign(canonical.as_bytes());
        params.insert("sign".to_owned(), STANDARD.encode(signature.to_vec()));
        let mut url = self.gateway.clone();
        url.query_pairs_mut().extend_pairs(params.iter());
        Ok(url.into())
    }

    fn verify(&self, content: &[u8], encoded_signature: &str) -> bool {
        let Ok(bytes) = STANDARD.decode(encoded_signature) else {
            return false;
        };
        let Ok(signature) = Signature::try_from(bytes.as_slice()) else {
            return false;
        };
        self.verifying_key.verify(content, &signature).is_ok()
    }
}

impl PaymentProvider for AlipayProvider {
    fn checkout_url(&self, order: &CheckoutOrder<'_>) -> Result<String, AppError> {
        let biz_content = serde_json::to_string(&serde_json::json!({
            "out_trade_no": order.merchant_order_no,
            "product_code": "FAST_INSTANT_TRADE_PAY",
            "subject": order.subject,
            "timeout_express": format!("{}m", ORDER_TTL_MINUTES),
            "total_amount": format_amount(order.amount_minor),
        }))
        .map_err(|_| AppError::Internal)?;
        self.signed_url("alipay.trade.page.pay", biz_content, true)
    }

    fn query_url(&self, merchant_order_no: &str) -> Result<String, AppError> {
        validate_order_no(merchant_order_no)?;
        let biz_content = serde_json::to_string(&serde_json::json!({
            "out_trade_no": merchant_order_no,
        }))
        .map_err(|_| AppError::Internal)?;
        self.signed_url("alipay.trade.query", biz_content, false)
    }

    fn verify_notification(&self, fields: &BTreeMap<String, String>) -> bool {
        if fields.get("sign_type").map(String::as_str) != Some("RSA2") {
            return false;
        }
        let Some(signature) = fields.get("sign") else {
            return false;
        };
        self.verify(canonical_notification(fields).as_bytes(), signature)
    }

    fn notification_trade(
        &self,
        fields: &BTreeMap<String, String>,
    ) -> Result<ProviderTrade, AppError> {
        if field(fields, "app_id", 64)? != self.app_id
            || field(fields, "seller_id", 64)? != self.seller_id
        {
            return Err(AppError::ProviderProtocol);
        }
        let merchant_order_no = field(fields, "out_trade_no", 64)?.to_owned();
        validate_order_no(&merchant_order_no)?;
        let status = parse_trade_status(field(fields, "trade_status", 32)?)?;
        let trade_no = fields
            .get("trade_no")
            .filter(|value| valid_provider_id(value, 128))
            .cloned();
        if status == TradeStatus::Paid && trade_no.is_none() {
            return Err(AppError::ProviderProtocol);
        }
        let amount_minor = parse_amount_minor(field(fields, "total_amount", 32)?)?;
        let payload_hash = digest_hex(canonical_notification(fields).as_bytes());
        let event_id = fields
            .get("notify_id")
            .filter(|value| valid_provider_id(value, 191))
            .cloned()
            .unwrap_or_else(|| format!("notify:{payload_hash}"));
        Ok(ProviderTrade {
            merchant_order_no,
            trade_no,
            amount_minor,
            status,
            event_id,
            payload: allowlisted_notification(fields, "webhook"),
        })
    }

    fn query_trade(&self, body: &str) -> Result<Option<ProviderTrade>, AppError> {
        let envelope: AlipayQueryEnvelope =
            serde_json::from_str(body).map_err(|_| AppError::ProviderProtocol)?;
        let raw = envelope
            .response
            .as_deref()
            .or(envelope.error_response.as_deref())
            .ok_or(AppError::ProviderProtocol)?;
        if !self.verify(raw.get().as_bytes(), &envelope.sign) {
            return Err(AppError::ProviderProtocol);
        }
        let response: AlipayQueryResponse =
            serde_json::from_str(raw.get()).map_err(|_| AppError::ProviderProtocol)?;
        if response.code != "10000" {
            return if response.sub_code.as_deref() == Some("ACQ.TRADE_NOT_EXIST") {
                Ok(None)
            } else {
                Err(AppError::ProviderProtocol)
            };
        }
        let merchant_order_no = response
            .out_trade_no
            .filter(|value| valid_provider_id(value, 64))
            .ok_or(AppError::ProviderProtocol)?;
        validate_order_no(&merchant_order_no)?;
        let trade_status = response.trade_status.ok_or(AppError::ProviderProtocol)?;
        let status = parse_trade_status(&trade_status)?;
        let trade_no = response
            .trade_no
            .filter(|value| valid_provider_id(value, 128));
        if status == TradeStatus::Paid && trade_no.is_none() {
            return Err(AppError::ProviderProtocol);
        }
        let total_amount = response.total_amount.ok_or(AppError::ProviderProtocol)?;
        let amount_minor = parse_amount_minor(&total_amount)?;
        let raw_hash = digest_hex(raw.get().as_bytes());
        Ok(Some(ProviderTrade {
            merchant_order_no: merchant_order_no.clone(),
            trade_no: trade_no.clone(),
            amount_minor,
            status,
            event_id: format!("query:{raw_hash}"),
            payload: serde_json::json!({
                "source": "query",
                "out_trade_no": merchant_order_no,
                "trade_no": trade_no,
                "trade_status": trade_status,
                "total_amount": total_amount,
            }),
        }))
    }
}

#[derive(Deserialize)]
struct AlipayQueryEnvelope {
    #[serde(rename = "alipay_trade_query_response")]
    response: Option<Box<RawValue>>,
    error_response: Option<Box<RawValue>>,
    sign: String,
}

#[derive(Deserialize)]
struct AlipayQueryResponse {
    code: String,
    sub_code: Option<String>,
    out_trade_no: Option<String>,
    trade_no: Option<String>,
    trade_status: Option<String>,
    total_amount: Option<String>,
}

fn canonical_pairs(fields: &BTreeMap<String, String>) -> String {
    fields
        .iter()
        .filter(|(_, value)| !value.is_empty())
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&")
}

fn canonical_notification(fields: &BTreeMap<String, String>) -> String {
    canonical_pairs(
        &fields
            .iter()
            .filter(|(key, _)| key.as_str() != "sign" && key.as_str() != "sign_type")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    )
}

fn field<'a>(
    fields: &'a BTreeMap<String, String>,
    name: &'static str,
    max_len: usize,
) -> Result<&'a str, AppError> {
    fields
        .get(name)
        .filter(|value| valid_provider_id(value, max_len))
        .map(String::as_str)
        .ok_or(AppError::ProviderProtocol)
}

fn valid_provider_id(value: &str, max_len: usize) -> bool {
    !value.is_empty() && value.len() <= max_len && !value.chars().any(char::is_control)
}

fn parse_trade_status(value: &str) -> Result<TradeStatus, AppError> {
    match value {
        "WAIT_BUYER_PAY" => Ok(TradeStatus::Pending),
        "TRADE_SUCCESS" | "TRADE_FINISHED" => Ok(TradeStatus::Paid),
        "TRADE_CLOSED" => Ok(TradeStatus::Closed),
        _ => Err(AppError::ProviderProtocol),
    }
}

fn parse_amount_minor(value: &str) -> Result<i64, AppError> {
    let (whole, fractional) = value.split_once('.').unwrap_or((value, ""));
    if whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || fractional.len() > 2
        || !fractional.bytes().all(|byte| byte.is_ascii_digit())
    {
        return Err(AppError::ProviderProtocol);
    }
    let whole = whole
        .parse::<i64>()
        .map_err(|_| AppError::ProviderProtocol)?;
    let fractional = match fractional.len() {
        0 => 0,
        1 => {
            fractional
                .parse::<i64>()
                .map_err(|_| AppError::ProviderProtocol)?
                * 10
        }
        2 => fractional
            .parse::<i64>()
            .map_err(|_| AppError::ProviderProtocol)?,
        _ => unreachable!(),
    };
    whole
        .checked_mul(100)
        .and_then(|value| value.checked_add(fractional))
        .filter(|value| *value > 0)
        .ok_or(AppError::ProviderProtocol)
}

fn format_amount(minor: i64) -> String {
    format!("{}.{:02}", minor / 100, minor % 100)
}

fn digest_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn allowlisted_notification(fields: &BTreeMap<String, String>, source: &str) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("source".to_owned(), Value::String(source.to_owned()));
    for key in [
        "notify_id",
        "notify_type",
        "app_id",
        "seller_id",
        "out_trade_no",
        "trade_no",
        "trade_status",
        "total_amount",
        "gmt_payment",
    ] {
        if let Some(value) = fields.get(key) {
            payload.insert(
                key.to_owned(),
                Value::String(if value.len() <= 512 {
                    value.clone()
                } else {
                    "[oversized]".to_owned()
                }),
            );
        }
    }
    Value::Object(payload)
}

#[cfg(test)]
mod tests {
    use super::{
        canonical_notification, format_amount, parse_amount_minor, AlipayProvider, CheckoutOrder,
        CreateOrderRequest, PaymentProvider, PaymentService,
    };
    use crate::config::Config;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use rsa::{
        pkcs8::{EncodePrivateKey, EncodePublicKey},
        pkcs1v15::SigningKey,
        rand_core::OsRng,
        signature::{SignatureEncoding, Signer},
        RsaPrivateKey, RsaPublicKey,
    };
    use sha2::Sha256;
    use sqlx::Row;
    use std::{collections::BTreeMap, path::PathBuf, sync::Arc, time::Duration};
    use url::Url;

    fn payment_config(private_key: String, public_key: String) -> Config {
        Config {
            listen_addr: "127.0.0.1:8787".parse().unwrap(),
            database_url: "mysql://root@localhost/rabbit_gateway".to_owned(),
            gateway_public_url: "https://gateway.test".to_owned(),
            landing_public_url: "https://landing.test".to_owned(),
            allowed_origins: vec!["https://landing.test".to_owned()],
            oidc_client_id: "rabbit-desktop".to_owned(),
            oidc_redirect_uri: "rabbitinterview://auth/callback".to_owned(),
            oidc_post_logout_redirect_uri: "rabbitinterview://auth/logout".to_owned(),
            oidc_signing_keyset_file: PathBuf::from("unused-signing-keyset.json"),
            oidc_data_keyring_file: PathBuf::from("unused-data-keyring.json"),
            resend_api_key: "re_test_gateway".to_owned(),
            resend_from: "OnCue <no-reply@example.test>".to_owned(),
            resend_api_url: "https://api.resend.com".to_owned(),
            trusted_proxy_cidrs: Vec::new(),
            hosted_stt_enabled: false,
            hosted_llm_enabled: false,
            payments_enabled: true,
            alipay_app_id: Some("test-app".to_owned()),
            alipay_seller_id: Some("test-seller".to_owned()),
            alipay_private_key: Some(private_key),
            alipay_public_key: Some(public_key),
            alipay_gateway_url: "https://openapi.alipay.test/gateway.do".to_owned(),
            admin_token: None,
            volcengine_api_key: None,
            volcengine_resource_id: "volc.bigasr.sauc.duration".to_owned(),
            volcengine_url: "wss://openspeech.example.test/stt".to_owned(),
            gemini_api_key: None,
            gemini_model: "test-model".to_owned(),
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
            pricing_policy_version: "test-v1".to_owned(),
        }
    }

    fn provider() -> (AlipayProvider, SigningKey<Sha256>) {
        let app_key = RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let alipay_key = RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let notification_signer = SigningKey::new(alipay_key.clone());
        (
            AlipayProvider {
                app_id: "test-app".to_owned(),
                seller_id: "test-seller".to_owned(),
                gateway: Url::parse("https://openapi.alipay.test/gateway.do").unwrap(),
                notify_url: "https://gateway.test/webhooks/alipay".to_owned(),
                return_url: "https://landing.test/subscribe".to_owned(),
                signing_key: SigningKey::new(app_key),
                verifying_key: rsa::pkcs1v15::VerifyingKey::new(RsaPublicKey::from(alipay_key)),
            },
            notification_signer,
        )
    }

    #[test]
    fn payment_service_accepts_unarmored_base64_keys() {
        let app_key = RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let alipay_key = RsaPrivateKey::new(&mut OsRng, 2048).unwrap();
        let private_key = STANDARD.encode(app_key.to_pkcs8_der().unwrap().as_bytes());
        let public_key = STANDARD.encode(
            RsaPublicKey::from(alipay_key)
                .to_public_key_der()
                .unwrap()
                .as_bytes(),
        );
        let config = payment_config(private_key, public_key);
        assert!(AlipayProvider::from_config(&config).is_ok());
    }

    #[test]
    fn money_parser_is_exact() {
        assert_eq!(parse_amount_minor("89").unwrap(), 8_900);
        assert_eq!(parse_amount_minor("89.0").unwrap(), 8_900);
        assert_eq!(parse_amount_minor("89.00").unwrap(), 8_900);
        assert_eq!(format_amount(19_900), "199.00");
        assert!(parse_amount_minor("89.001").is_err());
        assert!(parse_amount_minor("-1.00").is_err());
        assert!(parse_amount_minor("0.00").is_err());
    }

    #[test]
    fn checkout_and_notification_use_rsa2() {
        let (provider, notification_signer) = provider();
        let checkout = provider
            .checkout_url(&CheckoutOrder {
                merchant_order_no: "RI0123456789abcdef0123456789abcdef",
                subject: "OnCue Pro",
                amount_minor: 8_900,
            })
            .unwrap();
        let url = Url::parse(&checkout).unwrap();
        assert_eq!(
            url.query_pairs()
                .find(|(key, _)| key == "sign_type")
                .unwrap()
                .1,
            "RSA2"
        );

        let mut notification = BTreeMap::from([
            ("app_id".to_owned(), "test-app".to_owned()),
            (
                "out_trade_no".to_owned(),
                "RI0123456789abcdef0123456789abcdef".to_owned(),
            ),
            ("seller_id".to_owned(), "test-seller".to_owned()),
            ("sign_type".to_owned(), "RSA2".to_owned()),
            ("total_amount".to_owned(), "89.00".to_owned()),
            ("trade_no".to_owned(), "provider-trade".to_owned()),
            ("trade_status".to_owned(), "TRADE_SUCCESS".to_owned()),
        ]);
        let signature = notification_signer.sign(canonical_notification(&notification).as_bytes());
        notification.insert("sign".to_owned(), STANDARD.encode(signature.to_vec()));
        assert!(provider.verify_notification(&notification));
        notification.insert("total_amount".to_owned(), "0.01".to_owned());
        assert!(!provider.verify_notification(&notification));
    }

    fn paid_notification(
        order_no: &str,
        trade_no: &str,
        amount: &str,
        event: &str,
        signer: &SigningKey<Sha256>,
    ) -> BTreeMap<String, String> {
        let mut fields = BTreeMap::from([
            ("app_id".to_owned(), "test-app".to_owned()),
            ("notify_id".to_owned(), event.to_owned()),
            ("out_trade_no".to_owned(), order_no.to_owned()),
            ("seller_id".to_owned(), "test-seller".to_owned()),
            ("sign_type".to_owned(), "RSA2".to_owned()),
            ("total_amount".to_owned(), amount.to_owned()),
            ("trade_no".to_owned(), trade_no.to_owned()),
            ("trade_status".to_owned(), "TRADE_SUCCESS".to_owned()),
        ]);
        let signature = signer.sign(canonical_notification(&fields).as_bytes());
        fields.insert("sign".to_owned(), STANDARD.encode(signature.to_vec()));
        fields
    }

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
    async fn paid_orders_grant_once_and_early_renewal_starts_later() -> anyhow::Result<()> {
        let pool = crate::storage::connect(&std::env::var("TEST_DATABASE_URL")?).await?;
        let (alipay, notification_signer) = provider();
        let service = PaymentService {
            pool: pool.clone(),
            http: reqwest::Client::new(),
            provider: Arc::new(alipay),
        };
        let account_id = uuid::Uuid::new_v4().to_string();
        let test_suffix = account_id.replace('-', "");
        let email = format!("{account_id}@payment.test");
        sqlx::query(
            "INSERT INTO accounts (id, email, normalized_email, status) VALUES (?, ?, ?, 'ACTIVE')",
        )
        .bind(&account_id)
        .bind(&email)
        .bind(&email)
        .execute(&pool)
        .await?;

        let first = service
            .create(
                &account_id,
                &CreateOrderRequest {
                    product_code: "PRO_MONTH".to_owned(),
                },
                &format!("first-{test_suffix}"),
            )
            .await?;
        let first_notification = paid_notification(
            &first.merchant_order_no,
            &format!("trade-one-{test_suffix}"),
            "89.00",
            &format!("event-one-{test_suffix}"),
            &notification_signer,
        );
        assert!(
            service
                .process_notification(first_notification.clone())
                .await
        );
        assert!(service.process_notification(first_notification).await);
        let first_subscription_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM subscriptions WHERE account_id = ?")
                .bind(&account_id)
                .fetch_one(&pool)
                .await?;
        assert_eq!(first_subscription_count, 1);

        let second = service
            .create(
                &account_id,
                &CreateOrderRequest {
                    product_code: "PRO_QUARTER".to_owned(),
                },
                &format!("second-{test_suffix}"),
            )
            .await?;
        assert!(
            service
                .process_notification(paid_notification(
                    &second.merchant_order_no,
                    &format!("trade-two-{test_suffix}"),
                    "199.00",
                    &format!("event-two-{test_suffix}"),
                    &notification_signer,
                ))
                .await
        );

        let periods = sqlx::query(
            "SELECT starts_at, ends_at FROM subscriptions WHERE account_id = ? ORDER BY starts_at",
        )
        .bind(&account_id)
        .fetch_all(&pool)
        .await?;
        assert_eq!(periods.len(), 2);
        let first_end: chrono::NaiveDateTime = periods[0].try_get("ends_at")?;
        let second_start: chrono::NaiveDateTime = periods[1].try_get("starts_at")?;
        assert_eq!(first_end, second_start);
        let bucket_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM quota_buckets WHERE account_id = ? AND source_type = 'SUBSCRIPTION'",
        )
        .bind(&account_id)
        .fetch_one(&pool)
        .await?;
        assert_eq!(bucket_count, 4);
        Ok(())
    }
}
