pub mod access;
pub mod auth;
pub mod config;
pub mod entitlement;
pub mod error;
pub mod llm;
pub mod oidc;
pub mod payments;
pub mod protocol;
pub mod providers;
pub mod routing;
pub mod sessions;
pub mod storage;
pub mod tickets;

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use auth::AuthService;
use axum::{
    extract::{DefaultBodyLimit, Path, State},
    http::{header, HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    middleware,
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use config::Config;
use entitlement::{Account, Entitlement};
use error::AppError;
use protocol::{AccountLookupResponse, AdjustmentRequest, EntitlementResponse, LookupRequest, PortalSessionResponse};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, Semaphore};
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
};

#[derive(Clone)]
pub struct CancellationEntry {
    pub account_id: String,
    pub token: CancellationToken,
}

pub struct Metrics {
    pub stt_active: AtomicU64,
    pub stt_started: AtomicU64,
    pub llm_active: AtomicU64,
    pub llm_started: AtomicU64,
}

impl Default for Metrics {
    fn default() -> Self {
        Self {
            stt_active: AtomicU64::new(0),
            stt_started: AtomicU64::new(0),
            llm_active: AtomicU64::new(0),
            llm_started: AtomicU64::new(0),
        }
    }
}

struct StateInner {
    config: Arc<Config>,
    entitlement: Entitlement,
    auth: AuthService,
    http: reqwest::Client,
    payments: Option<payments::PaymentService>,
    routing: routing::Routing,
    tickets: tickets::Tickets,
    portal_tickets: tickets::PortalTickets,
    tracker: TaskTracker,
    shutdown: CancellationToken,
    concurrency: Arc<Semaphore>,
    cancellations: Mutex<HashMap<String, CancellationEntry>>,
    metrics: Metrics,
}

#[derive(Clone)]
pub struct AppState(Arc<StateInner>);

#[derive(Clone, Debug)]
pub struct AuthenticatedAccount {
    pub id: String,
    pub status: String,
}

impl AppState {
    pub async fn new(config: Config) -> anyhow::Result<Self> {
        config.validate()?;
        let config = Arc::new(config);
        let pool = storage::connect(&config.database_url).await?;
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(120))
            .user_agent("rabbit-interview-gateway/0.1")
            .build()?;
        let auth = AuthService::new(pool.clone(), config.clone(), http.clone())?;
        let routing = routing::Routing::new(pool.clone(), &config).await?;
        let payments = payments::PaymentService::from_config(
            pool.clone(),
            http.clone(),
            &config,
        )?;
        Ok(Self(Arc::new(StateInner {
            entitlement: Entitlement::new(pool),
            auth,
            http,
            payments,
            routing,
            tickets: tickets::Tickets::default(),
            portal_tickets: tickets::PortalTickets::default(),
            tracker: TaskTracker::new(),
            shutdown: CancellationToken::new(),
            concurrency: Arc::new(Semaphore::new(config.global_concurrency_limit)),
            cancellations: Mutex::new(HashMap::new()),
            metrics: Metrics::default(),
            config,
        })))
    }

    pub fn config(&self) -> &Config {
        &self.0.config
    }

    pub fn entitlement(&self) -> &Entitlement {
        &self.0.entitlement
    }

    pub fn auth(&self) -> &AuthService {
        &self.0.auth
    }

    pub fn http(&self) -> &reqwest::Client {
        &self.0.http
    }

    pub fn payments(&self) -> Option<&payments::PaymentService> {
        self.0.payments.as_ref()
    }

    pub fn routing(&self) -> &routing::Routing {
        &self.0.routing
    }

    pub fn tickets(&self) -> &tickets::Tickets {
        &self.0.tickets
    }

    pub fn portal_tickets(&self) -> &tickets::PortalTickets {
        &self.0.portal_tickets
    }

    pub fn tracker(&self) -> &TaskTracker {
        &self.0.tracker
    }

    pub fn shutdown(&self) -> &CancellationToken {
        &self.0.shutdown
    }

    pub fn concurrency(&self) -> &Arc<Semaphore> {
        &self.0.concurrency
    }

    pub fn metrics(&self) -> &Metrics {
        &self.0.metrics
    }

    pub async fn authenticated_account(
        &self,
        headers: &HeaderMap,
    ) -> Result<AuthenticatedAccount, AppError> {
        let claims = self.0.auth.authenticate(headers).await?;
        let account = self.0.entitlement.account(&claims.sub).await?;
        Ok(AuthenticatedAccount {
            id: account.id,
            status: account.status,
        })
    }

    pub fn require_eligible(&self, account: &AuthenticatedAccount) -> Result<(), AppError> {
        if account.status != "ACTIVE" {
            return Err(AppError::AccountSuspended);
        }
        Ok(())
    }

    pub async fn insert_cancellation(&self, request_id: String, entry: CancellationEntry) {
        self.0.cancellations.lock().await.insert(request_id, entry);
    }

    pub async fn cancellation(&self, request_id: &str) -> Option<CancellationEntry> {
        self.0.cancellations.lock().await.get(request_id).cloned()
    }

    pub async fn remove_cancellation(&self, request_id: &str) {
        self.0.cancellations.lock().await.remove(request_id);
    }

    pub fn start_reaper(&self) {
        let state = self.clone();
        self.tracker().spawn(async move {
            let mut timer = tokio::time::interval(std::time::Duration::from_secs(30));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = state.shutdown().cancelled() => break,
                    _ = timer.tick() => {
                        match state.entitlement().reap_expired().await {
                            Ok(count) if count > 0 => tracing::warn!(released_reservations = count, "reaped expired reservations"),
                            Ok(_) => {}
                            Err(error) => tracing::error!(error_code = %error, "reservation reaper failed"),
                        }
                    }
                }
            }
        });
    }
}

pub fn router(state: AppState) -> Router {
    let origins = state
        .config()
        .allowed_origins
        .iter()
        .filter_map(|origin| HeaderValue::from_str(origin).ok())
        .collect::<Vec<_>>();
    let cors = CorsLayer::new()
        .allow_origin(AllowOrigin::list(origins))
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE])
        .allow_headers([
            header::AUTHORIZATION,
            header::CONTENT_TYPE,
            header::ACCEPT,
            HeaderName::from_static("idempotency-key"),
            HeaderName::from_static("x-csrf-token"),
            HeaderName::from_static("x-admin-token"),
            HeaderName::from_static("x-admin-actor"),
        ]);
    let max_json_bytes = state.config().max_json_bytes;
    Router::new()
        .route("/healthz", get(health))
        .route("/readyz", get(ready))
        .route("/metrics", get(metrics))
        .route("/v1/me/entitlements", get(entitlements))
        .route("/v1/me/portal-session", post(create_portal_session))
        .route("/v1/stt/sessions", post(sessions::create_session))
        .route(
            "/v1/stt/sessions/{session_id}/stream",
            get(sessions::stream_session),
        )
        .route("/v1/llm/answers", post(llm::create_answer))
        .route("/v1/llm/answers/{request_id}", delete(llm::cancel_answer))
        .route("/internal/accounts/lookup", post(lookup_account))
        .route("/internal/ai-routing", get(get_ai_routing))
        .route("/internal/ai-routing/{kind}", post(switch_ai_routing))
        .route(
            "/internal/accounts/{account_id}/quota-adjustments",
            post(adjust_quota),
        )
        .merge(oidc::router())
        .merge(payments::router())
        .layer(DefaultBodyLimit::max(max_json_bytes))
        .layer(cors)
        .layer(middleware::from_fn_with_state(
            state.clone(),
            access::access_log,
        ))
        .with_state(state)
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status":"ok"}))
}

async fn ready(State(state): State<AppState>) -> Response {
    if storage::ready(state.entitlement().pool()).await {
        (StatusCode::OK, Json(serde_json::json!({"status":"ready"}))).into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"status":"not_ready"})),
        )
            .into_response()
    }
}

async fn metrics(State(state): State<AppState>) -> impl IntoResponse {
    let body = format!(
        "# TYPE rabbit_stt_active gauge\nrabbit_stt_active {}\n\
         # TYPE rabbit_stt_started_total counter\nrabbit_stt_started_total {}\n\
         # TYPE rabbit_llm_active gauge\nrabbit_llm_active {}\n\
         # TYPE rabbit_llm_started_total counter\nrabbit_llm_started_total {}\n",
        state.metrics().stt_active.load(Ordering::Relaxed),
        state.metrics().stt_started.load(Ordering::Relaxed),
        state.metrics().llm_active.load(Ordering::Relaxed),
        state.metrics().llm_started.load(Ordering::Relaxed),
    );
    ([(header::CONTENT_TYPE, "text/plain; version=0.0.4")], body)
}

async fn entitlements(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<EntitlementResponse>, AppError> {
    let account = state.authenticated_account(&headers).await?;
    let balances = state.entitlement().balances(&account.id).await?;
    Ok(Json(EntitlementResponse {
        account_id: account.id,
        eligible: account.status == "ACTIVE",
        status: account.status,
        balances,
        hosted_stt_enabled: state.config().hosted_stt_enabled,
        hosted_llm_enabled: state.config().hosted_llm_enabled,
        payments_enabled: state.config().payments_enabled,
        subscription_url: format!("{}/subscribe", state.config().landing_public_url),
    }))
}

async fn create_portal_session(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<PortalSessionResponse>, AppError> {
    let account = state.authenticated_account(&headers).await?;
    state.require_eligible(&account)?;
    let ticket = state
        .portal_tickets()
        .issue(account.id, std::time::Duration::from_secs(60))
        .await;
    let portal_url = format!("{}/auth/portal?ticket={}", state.config().gateway_public_url, ticket);
    Ok(Json(PortalSessionResponse {
        portal_url,
        ticket,
        expires_in: 60,
    }))
}

async fn lookup_account(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<LookupRequest>,
) -> Result<Json<AccountLookupResponse>, AppError> {
    require_admin(state.config(), &headers)?;
    let _actor = headers
        .get("X-Admin-Actor")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or(AppError::Unauthorized)?;
    let identity = state
        .auth()
        .identity_by_email(&request.email)
        .await?
        .ok_or(AppError::NotFound)?;
    let balances = state.entitlement().balances(&identity.id).await?;
    Ok(Json(AccountLookupResponse {
        account_id: identity.id,
        email: identity.email,
        status: identity.status,
        balances,
    }))
}

async fn adjust_quota(
    State(state): State<AppState>,
    Path(account_id): Path<String>,
    headers: HeaderMap,
    Json(request): Json<AdjustmentRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    require_admin(state.config(), &headers)?;
    let operator = headers
        .get("X-Admin-Actor")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or(AppError::Unauthorized)?;
    let Account { id, .. } = state.entitlement().account(&account_id).await?;
    let valid_until = request
        .valid_until
        .as_deref()
        .map(DateTime::parse_from_rfc3339)
        .transpose()
        .map_err(|_| AppError::BadRequest("valid_until must be RFC 3339."))?
        .map(|value| value.with_timezone(&Utc));
    let bucket_id = state
        .entitlement()
        .grant_adjustment(
            &id,
            &request.metric,
            request.units,
            &request.reason,
            valid_until,
            operator,
        )
        .await?;
    Ok(Json(serde_json::json!({"bucket_id":bucket_id})))
}

async fn get_ai_routing(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<routing::AdminRoutingResponse>, AppError> {
    require_admin_actor(state.config(), &headers)?;
    Ok(Json(state.routing().admin_response().await?))
}

async fn switch_ai_routing(
    State(state): State<AppState>,
    Path(kind): Path<String>,
    headers: HeaderMap,
    Json(request): Json<routing::SwitchRouteRequest>,
) -> Result<Json<routing::RouteState>, AppError> {
    let actor = require_admin_actor(state.config(), &headers)?;
    let kind = kind.parse::<routing::RouteKind>()?;
    Ok(Json(
        state
            .routing()
            .switch(kind, &request.provider, &request.model, actor)
            .await?,
    ))
}

fn require_admin_actor<'a>(config: &Config, headers: &'a HeaderMap) -> Result<&'a str, AppError> {
    require_admin(config, headers)?;
    headers
        .get("X-Admin-Actor")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or(AppError::Unauthorized)
}

pub(crate) fn require_admin(config: &Config, headers: &HeaderMap) -> Result<(), AppError> {
    let expected = config
        .admin_token
        .as_deref()
        .ok_or(AppError::Unauthorized)?;
    let provided = headers
        .get("X-Admin-Token")
        .and_then(|value| value.to_str().ok())
        .ok_or(AppError::Unauthorized)?;
    if expected.len() != provided.len()
        || expected.as_bytes().ct_eq(provided.as_bytes()).unwrap_u8() != 1
    {
        return Err(AppError::Unauthorized);
    }
    Ok(())
}
