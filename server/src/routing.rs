use std::str::FromStr;

use chrono::{DateTime, NaiveDateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{MySql, MySqlPool, Row, Transaction};
use uuid::Uuid;

use crate::{config::Config, error::AppError};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RouteKind {
    Stt,
    Llm,
}

impl RouteKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Stt => "stt",
            Self::Llm => "llm",
        }
    }

    const fn as_db(self) -> &'static str {
        match self {
            Self::Stt => "STT",
            Self::Llm => "LLM",
        }
    }
}

impl FromStr for RouteKind {
    type Err = AppError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "stt" => Ok(Self::Stt),
            "llm" => Ok(Self::Llm),
            _ => Err(AppError::BadRequest("Route kind must be stt or llm.")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RouteSnapshot {
    pub kind: RouteKind,
    pub provider: String,
    pub model: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RouteState {
    pub provider: String,
    pub model: String,
    pub valid: bool,
    pub updated_by: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ProviderOption {
    pub provider: String,
    pub models: Vec<String>,
    pub selectable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason_code: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct ProviderCatalog {
    pub stt: Vec<ProviderOption>,
    pub llm: Vec<ProviderOption>,
}

impl ProviderCatalog {
    fn from_config(config: &Config) -> Self {
        Self {
            stt: vec![
                option(
                    "volcengine",
                    &config.volcengine_stt_models,
                    config.volcengine_api_key.is_some(),
                    !config.volcengine_resource_id.trim().is_empty(),
                ),
                option(
                    "deepgram",
                    &config.deepgram_stt_models,
                    config.deepgram_api_key.is_some(),
                    true,
                ),
                option(
                    "gemini_live",
                    &config.gemini_stt_models,
                    config.gemini_api_key.is_some(),
                    true,
                ),
            ],
            llm: vec![
                option(
                    "gemini",
                    &config.gemini_llm_models,
                    config.gemini_api_key.is_some(),
                    true,
                ),
                option(
                    "openai",
                    &config.openai_llm_models,
                    config.openai_api_key.is_some(),
                    true,
                ),
                option(
                    "anthropic",
                    &config.anthropic_llm_models,
                    config.anthropic_api_key.is_some(),
                    true,
                ),
                option(
                    "groq",
                    &config.groq_llm_models,
                    config.groq_api_key.is_some(),
                    true,
                ),
            ],
        }
    }

    pub fn option(&self, kind: RouteKind, provider: &str) -> Option<&ProviderOption> {
        let options = match kind {
            RouteKind::Stt => &self.stt,
            RouteKind::Llm => &self.llm,
        };
        options.iter().find(|option| option.provider == provider)
    }

    pub fn supports(&self, kind: RouteKind, provider: &str, model: &str) -> bool {
        self.option(kind, provider).is_some_and(|option| {
            option.selectable && option.models.iter().any(|candidate| candidate == model)
        })
    }

    fn initial_route(
        &self,
        kind: RouteKind,
        fallback_provider: &str,
        fallback_model: &str,
    ) -> (String, String) {
        let options = match kind {
            RouteKind::Stt => &self.stt,
            RouteKind::Llm => &self.llm,
        };
        options
            .iter()
            .find_map(|option| {
                if option.selectable {
                    option
                        .models
                        .first()
                        .map(|model| (option.provider.clone(), model.clone()))
                } else {
                    None
                }
            })
            .unwrap_or_else(|| (fallback_provider.to_owned(), fallback_model.to_owned()))
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct RoutingRoutes {
    pub stt: RouteState,
    pub llm: RouteState,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct AdminRoutingResponse {
    pub routes: RoutingRoutes,
    pub catalog: ProviderCatalog,
}

#[derive(Debug, Deserialize)]
pub struct SwitchRouteRequest {
    pub provider: String,
    pub model: String,
}

#[derive(Clone)]
pub struct Routing {
    pool: MySqlPool,
    catalog: ProviderCatalog,
}

impl Routing {
    pub async fn new(pool: MySqlPool, config: &Config) -> Result<Self, sqlx::Error> {
        let catalog = ProviderCatalog::from_config(config);
        let (stt_provider, stt_model) =
            catalog.initial_route(RouteKind::Stt, "volcengine", "bigmodel");
        let (llm_provider, llm_model) =
            catalog.initial_route(RouteKind::Llm, "gemini", &config.gemini_model);
        seed_route(&pool, RouteKind::Stt, &stt_provider, &stt_model).await?;
        seed_route(&pool, RouteKind::Llm, &llm_provider, &llm_model).await?;
        Ok(Self { pool, catalog })
    }

    pub fn catalog(&self) -> &ProviderCatalog {
        &self.catalog
    }

    pub async fn current(&self, kind: RouteKind) -> Result<RouteSnapshot, AppError> {
        let route = self.load(kind).await?;
        if !route.valid {
            return Err(AppError::ProviderUnavailable);
        }
        Ok(RouteSnapshot {
            kind,
            provider: route.provider,
            model: route.model,
        })
    }

    pub async fn admin_response(&self) -> Result<AdminRoutingResponse, AppError> {
        Ok(AdminRoutingResponse {
            routes: self.load_both().await?,
            catalog: self.catalog.clone(),
        })
    }

    pub async fn switch(
        &self,
        kind: RouteKind,
        provider: &str,
        model: &str,
        actor: &str,
    ) -> Result<RouteState, AppError> {
        if actor.is_empty() || actor.len() > 128 {
            return Err(AppError::Unauthorized);
        }
        if !self.catalog.supports(kind, provider, model) {
            return Err(AppError::BadRequest(
                "Provider and model must be a selectable catalog entry.",
            ));
        }

        let mut tx = self.pool.begin().await?;
        let previous = load_locked(&mut tx, kind).await?;
        if previous.provider == provider && previous.model == model {
            tx.commit().await?;
            return Ok(self.state(previous));
        }

        let now = Utc::now().naive_utc();
        let db_provider = provider.to_ascii_uppercase();
        sqlx::query(
            "UPDATE ai_provider_routes \
             SET provider = ?, model = ?, updated_by = ?, updated_at = ? WHERE kind = ?",
        )
        .bind(db_provider)
        .bind(model)
        .bind(actor)
        .bind(now)
        .bind(kind.as_db())
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO security_events \
             (id, account_id, event_type, metadata, occurred_at, expires_at) \
             VALUES (?, NULL, 'hosted_route_changed', ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(serde_json::json!({
            "kind": kind.as_str(),
            "previous": {"provider": previous.provider, "model": previous.model},
            "new": {"provider": provider, "model": model},
            "operator": actor,
        }))
        .bind(now)
        .bind(now + chrono::Duration::days(30))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;

        Ok(RouteState {
            provider: provider.to_owned(),
            model: model.to_owned(),
            valid: true,
            updated_by: actor.to_owned(),
            updated_at: timestamp(now),
        })
    }

    async fn load(&self, kind: RouteKind) -> Result<RouteState, AppError> {
        let row = sqlx::query(
            "SELECT kind, provider, model, updated_by, updated_at \
             FROM ai_provider_routes WHERE kind = ?",
        )
        .bind(kind.as_db())
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::Internal)?;
        Ok(self.state(route_row(row)?))
    }

    async fn load_both(&self) -> Result<RoutingRoutes, AppError> {
        let rows = sqlx::query(
            "SELECT kind, provider, model, updated_by, updated_at \
             FROM ai_provider_routes WHERE kind IN ('STT', 'LLM')",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut stt = None;
        let mut llm = None;
        for row in rows {
            let kind: String = row.try_get("kind")?;
            let state = self.state(route_row(row)?);
            match kind.as_str() {
                "STT" => stt = Some(state),
                "LLM" => llm = Some(state),
                _ => return Err(AppError::Internal),
            }
        }
        Ok(RoutingRoutes {
            stt: stt.ok_or(AppError::Internal)?,
            llm: llm.ok_or(AppError::Internal)?,
        })
    }

    fn state(&self, row: StoredRoute) -> RouteState {
        RouteState {
            valid: self.catalog.supports(row.kind, &row.provider, &row.model),
            provider: row.provider,
            model: row.model,
            updated_by: row.updated_by,
            updated_at: timestamp(row.updated_at),
        }
    }
}

async fn seed_route(
    pool: &MySqlPool,
    kind: RouteKind,
    provider: &str,
    model: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT IGNORE INTO ai_provider_routes \
         (kind, provider, model, updated_by) VALUES (?, ?, ?, 'system')",
    )
    .bind(kind.as_db())
    .bind(provider.to_ascii_uppercase())
    .bind(model)
    .execute(pool)
    .await?;
    Ok(())
}

#[derive(Debug)]
struct StoredRoute {
    kind: RouteKind,
    provider: String,
    model: String,
    updated_by: String,
    updated_at: NaiveDateTime,
}

fn option(
    provider: &str,
    models: &[String],
    has_key: bool,
    has_provider_config: bool,
) -> ProviderOption {
    let reason_code = if !has_key {
        Some("missing_api_key")
    } else if !has_provider_config {
        Some("missing_provider_config")
    } else if models.is_empty() {
        Some("missing_models")
    } else {
        None
    };
    ProviderOption {
        provider: provider.to_owned(),
        models: models.to_vec(),
        selectable: reason_code.is_none(),
        reason_code: reason_code.map(ToOwned::to_owned),
    }
}

fn route_row(row: sqlx::mysql::MySqlRow) -> Result<StoredRoute, AppError> {
    let kind: String = row.try_get("kind")?;
    Ok(StoredRoute {
        kind: match kind.as_str() {
            "STT" => RouteKind::Stt,
            "LLM" => RouteKind::Llm,
            _ => return Err(AppError::Internal),
        },
        provider: row.try_get::<String, _>("provider")?.to_ascii_lowercase(),
        model: row.try_get("model")?,
        updated_by: row.try_get("updated_by")?,
        updated_at: row.try_get("updated_at")?,
    })
}

async fn load_locked(
    tx: &mut Transaction<'_, MySql>,
    kind: RouteKind,
) -> Result<StoredRoute, AppError> {
    let row = sqlx::query(
        "SELECT kind, provider, model, updated_by, updated_at \
         FROM ai_provider_routes WHERE kind = ? FOR UPDATE",
    )
    .bind(kind.as_db())
    .fetch_optional(&mut **tx)
    .await?
    .ok_or(AppError::Internal)?;
    route_row(row)
}

fn timestamp(value: NaiveDateTime) -> String {
    DateTime::<Utc>::from_naive_utc_and_offset(value, Utc).to_rfc3339()
}

#[cfg(test)]
mod tests {
    use super::{option, ProviderCatalog, RouteKind, Routing};

    #[test]
    fn catalog_only_accepts_selectable_allowlisted_models() {
        let catalog = ProviderCatalog {
            stt: vec![option("deepgram", &["nova-3".to_owned()], true, true)],
            llm: vec![option("openai", &["gpt-5".to_owned()], false, true)],
        };
        assert!(catalog.supports(RouteKind::Stt, "deepgram", "nova-3"));
        assert!(!catalog.supports(RouteKind::Stt, "deepgram", "nova-2"));
        assert!(!catalog.supports(RouteKind::Llm, "openai", "gpt-5"));
        assert_eq!(
            catalog.llm[0].reason_code.as_deref(),
            Some("missing_api_key")
        );
    }

    #[test]
    fn route_kinds_only_accept_canonical_admin_paths() {
        assert!(matches!("stt".parse(), Ok(RouteKind::Stt)));
        assert!(matches!("llm".parse(), Ok(RouteKind::Llm)));
        assert!("STT".parse::<RouteKind>().is_err());
    }

    #[test]
    fn initial_routes_use_the_first_selectable_configured_provider() {
        let catalog = ProviderCatalog {
            stt: vec![
                option("volcengine", &["bigmodel".to_owned()], false, true),
                option("deepgram", &["nova-3".to_owned()], true, true),
            ],
            llm: vec![
                option("gemini", &["gemini-test".to_owned()], false, true),
                option("openai", &["gpt-test".to_owned()], true, true),
            ],
        };
        assert_eq!(
            catalog.initial_route(RouteKind::Stt, "volcengine", "bigmodel"),
            ("deepgram".to_owned(), "nova-3".to_owned())
        );
        assert_eq!(
            catalog.initial_route(RouteKind::Llm, "gemini", "gemini-test"),
            ("openai".to_owned(), "gpt-test".to_owned())
        );
    }

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
    async fn route_switch_is_visible_audited_and_idempotent() -> anyhow::Result<()> {
        let database_url = std::env::var("TEST_DATABASE_URL")?;
        let pool = crate::storage::connect(&database_url).await?;
        let catalog = ProviderCatalog {
            stt: vec![
                option("volcengine", &["bigmodel".to_owned()], true, true),
                option("deepgram", &["test-nova".to_owned()], true, true),
            ],
            llm: vec![option("gemini", &["test-gemini".to_owned()], true, true)],
        };
        sqlx::query(
            "INSERT INTO ai_provider_routes (kind, provider, model, updated_by) \
             VALUES ('STT', 'VOLCENGINE', 'bigmodel', 'test') \
             ON DUPLICATE KEY UPDATE provider = VALUES(provider), model = VALUES(model), updated_by = VALUES(updated_by)",
        )
        .execute(&pool)
        .await?;
        let first = Routing {
            pool: pool.clone(),
            catalog: catalog.clone(),
        };
        let second = Routing {
            pool: pool.clone(),
            catalog,
        };
        let actor = format!("routing-test-{}", uuid::Uuid::new_v4());

        let switched = first
            .switch(RouteKind::Stt, "deepgram", "test-nova", &actor)
            .await?;
        assert_eq!(switched.provider, "deepgram");
        assert_eq!(second.current(RouteKind::Stt).await?.provider, "deepgram");
        let stored: String =
            sqlx::query_scalar("SELECT provider FROM ai_provider_routes WHERE kind = 'STT'")
                .fetch_one(&pool)
                .await?;
        assert_eq!(stored, "DEEPGRAM");
        let audit_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM security_events \
             WHERE event_type = 'hosted_route_changed' \
             AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.operator')) = ?",
        )
        .bind(&actor)
        .fetch_one(&pool)
        .await?;
        assert_eq!(audit_count, 1);

        first
            .switch(RouteKind::Stt, "deepgram", "test-nova", &actor)
            .await?;
        let no_op_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM security_events \
             WHERE event_type = 'hosted_route_changed' \
             AND JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.operator')) = ?",
        )
        .bind(&actor)
        .fetch_one(&pool)
        .await?;
        assert_eq!(no_op_count, 1);
        assert!(first
            .switch(RouteKind::Stt, "deepgram", "not-allowlisted", &actor)
            .await
            .is_err());
        assert_eq!(first.current(RouteKind::Stt).await?.model, "test-nova");
        Ok(())
    }
}
