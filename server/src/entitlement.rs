use std::{collections::BTreeMap, time::Duration};

use chrono::{DateTime, Utc};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{MySql, MySqlPool, Row, Transaction};
use tokio::time::sleep;
use uuid::Uuid;

use crate::error::AppError;

pub const STT_METRIC: &str = "STT_AUDIO_MS";
pub const LLM_METRIC: &str = "LLM_TOKEN_UNITS";

#[derive(Clone, Debug)]
pub struct Account {
    pub id: String,
    pub status: String,
}

#[derive(Clone, Debug)]
pub struct ReserveInput {
    pub account_id: String,
    pub session_id: String,
    pub reservation_id: String,
    pub client_request_id: String,
    pub interview_id: Option<String>,
    pub kind: &'static str,
    pub audio_source: Option<String>,
    pub provider: String,
    pub model: String,
    pub metric: &'static str,
    pub units: i64,
    pub idempotency_key: String,
    pub request_hash: String,
    pub response_json: Value,
    pub pricing_policy_version: String,
    pub lease_ttl: Duration,
}

pub enum ReserveOutcome {
    Created,
    Existing(Value),
}

#[derive(Clone, Debug)]
pub struct UsageInput {
    pub event_key: String,
    pub usage_status: &'static str,
    pub received_audio_ms: i64,
    pub forwarded_audio_ms: i64,
    pub provider_audio_ms: Option<i64>,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_hit_tokens: i64,
    pub reasoning_tokens: i64,
    pub charged_metric: &'static str,
    pub actual_units: i64,
    pub pricing_policy_version: String,
    pub terminate_reason: String,
}

#[derive(Clone)]
pub struct Entitlement {
    pool: MySqlPool,
}

#[derive(Clone, Debug)]
struct Bucket {
    id: String,
    remaining: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct PlannedAllocation {
    bucket_id: String,
    units: i64,
}

impl Entitlement {
    pub fn new(pool: MySqlPool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &MySqlPool {
        &self.pool
    }

    pub async fn account(&self, account_id: &str) -> Result<Account, AppError> {
        if account_id.is_empty() || account_id.len() > 36 {
            return Err(AppError::Unauthorized);
        }
        let row = sqlx::query("SELECT id, status FROM accounts WHERE id = ?")
            .bind(account_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::Unauthorized)?;
        Ok(Account {
            id: row.try_get("id")?,
            status: row.try_get("status")?,
        })
    }

    pub async fn balances(&self, account_id: &str) -> Result<BTreeMap<String, i64>, AppError> {
        let rows = sqlx::query(
            "SELECT metric, CAST(COALESCE(SUM(remaining_units), 0) AS SIGNED) AS units \
             FROM quota_buckets \
             WHERE account_id = ? AND remaining_units > 0 \
               AND valid_from <= UTC_TIMESTAMP(6) \
               AND (valid_until IS NULL OR valid_until > UTC_TIMESTAMP(6)) \
             GROUP BY metric",
        )
        .bind(account_id)
        .fetch_all(&self.pool)
        .await?;
        let mut balances = BTreeMap::from([(STT_METRIC.to_owned(), 0), (LLM_METRIC.to_owned(), 0)]);
        for row in rows {
            balances.insert(row.try_get("metric")?, row.try_get("units")?);
        }
        Ok(balances)
    }

    pub async fn account_is_active(&self, account_id: &str) -> Result<bool, AppError> {
        Ok(
            sqlx::query_scalar::<_, String>("SELECT status FROM accounts WHERE id = ?")
                .bind(account_id)
                .fetch_optional(&self.pool)
                .await?
                .is_some_and(|status| status == "ACTIVE"),
        )
    }

    pub async fn reserve(&self, input: ReserveInput) -> Result<ReserveOutcome, AppError> {
        let started = std::time::Instant::now();
        for attempt in 0..3 {
            match self.reserve_once(&input).await {
                Err(AppError::Database(error)) if retryable_mysql(&error) => {
                    log_mysql_retry(&error, "reserve", attempt, started);
                    if attempt == 2 { return Err(AppError::Database(error)); }
                    sleep(Duration::from_millis(20 * (attempt + 1) as u64)).await;
                }
                result => return result,
            }
        }
        Err(AppError::Internal)
    }

    async fn reserve_once(&self, input: &ReserveInput) -> Result<ReserveOutcome, AppError> {
        if input.units <= 0 {
            return Err(AppError::BadRequest("Reservation units must be positive."));
        }
        let now = Utc::now().naive_utc();
        let expires_at =
            now + chrono::Duration::from_std(input.lease_ttl).map_err(|_| AppError::Internal)?;
        let mut tx = self.pool.begin().await?;
        lock_active_account(&mut tx, &input.account_id).await?;

        if let Some(existing) =
            load_idempotency(&mut tx, &input.account_id, &input.idempotency_key).await?
        {
            if existing.0 != "reserve" || existing.1 != input.request_hash {
                return Err(AppError::IdempotencyConflict);
            }
            tx.commit().await?;
            return Ok(ReserveOutcome::Existing(existing.2));
        }

        let buckets = lock_buckets(&mut tx, &input.account_id, input.metric).await?;
        let allocations =
            plan_allocations(&buckets, input.units).ok_or(AppError::QuotaInsufficient)?;

        sqlx::query(
            "INSERT INTO ai_sessions \
             (id, account_id, client_request_id, interview_id, kind, audio_source, provider, model, state, pricing_policy_version, lease_expires_at) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RESERVED', ?, ?)",
        )
        .bind(&input.session_id)
        .bind(&input.account_id)
        .bind(&input.client_request_id)
        .bind(&input.interview_id)
        .bind(input.kind)
        .bind(&input.audio_source)
        .bind(&input.provider)
        .bind(&input.model)
        .bind(&input.pricing_policy_version)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            "INSERT INTO quota_reservations \
             (id, account_id, session_id, metric, held_units, expires_at) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&input.reservation_id)
        .bind(&input.account_id)
        .bind(&input.session_id)
        .bind(input.metric)
        .bind(input.units)
        .bind(expires_at)
        .execute(&mut *tx)
        .await?;

        for (order, allocation) in allocations.iter().enumerate() {
            sqlx::query(
                "UPDATE quota_buckets SET remaining_units = remaining_units - ? WHERE id = ?",
            )
            .bind(allocation.units)
            .bind(&allocation.bucket_id)
            .execute(&mut *tx)
            .await?;
            sqlx::query(
                "INSERT INTO quota_reservation_allocations \
                 (reservation_id, bucket_id, allocation_order, reserved_units) VALUES (?, ?, ?, ?)",
            )
            .bind(&input.reservation_id)
            .bind(&allocation.bucket_id)
            .bind(order as i32)
            .bind(allocation.units)
            .execute(&mut *tx)
            .await?;
        }

        insert_idempotency(
            &mut tx,
            &input.account_id,
            &input.idempotency_key,
            "reserve",
            &input.request_hash,
            &input.response_json,
        )
        .await?;
        tx.commit().await?;
        Ok(ReserveOutcome::Created)
    }

    pub async fn top_up(
        &self,
        reservation_id: &str,
        units: i64,
        idempotency_key: &str,
    ) -> Result<i64, AppError> {
        let request_hash = hash_bytes(format!("{reservation_id}:{units}").as_bytes());
        let started = std::time::Instant::now();
        for attempt in 0..3 {
            match self
                .top_up_once(reservation_id, units, idempotency_key, &request_hash)
                .await
            {
                Err(AppError::Database(error)) if retryable_mysql(&error) => {
                    log_mysql_retry(&error, "top_up", attempt, started);
                    if attempt == 2 { return Err(AppError::Database(error)); }
                    sleep(Duration::from_millis(20 * (attempt + 1) as u64)).await;
                }
                result => return result,
            }
        }
        Err(AppError::Internal)
    }

    async fn top_up_once(
        &self,
        reservation_id: &str,
        units: i64,
        idempotency_key: &str,
        request_hash: &str,
    ) -> Result<i64, AppError> {
        if units <= 0 {
            return Err(AppError::BadRequest("Top-up units must be positive."));
        }
        let account_id = reservation_account(&self.pool, reservation_id).await?;
        let mut tx = self.pool.begin().await?;
        lock_active_account(&mut tx, &account_id).await?;
        if let Some(existing) = load_idempotency(&mut tx, &account_id, idempotency_key).await? {
            if existing.0 != "top_up" || existing.1 != request_hash {
                return Err(AppError::IdempotencyConflict);
            }
            let held = existing
                .2
                .get("held_units")
                .and_then(Value::as_i64)
                .ok_or(AppError::Internal)?;
            tx.commit().await?;
            return Ok(held);
        }
        let row = sqlx::query(
            "SELECT metric, held_units, state FROM quota_reservations WHERE id = ? FOR UPDATE",
        )
        .bind(reservation_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
        let state: String = row.try_get("state")?;
        if state != "ACTIVE" {
            return Err(AppError::AlreadyExists);
        }
        let metric: String = row.try_get("metric")?;
        let held: i64 = row.try_get("held_units")?;
        add_hold_locked(&mut tx, &account_id, reservation_id, &metric, units).await?;
        let new_held = held + units;
        sqlx::query("UPDATE quota_reservations SET held_units = ? WHERE id = ?")
            .bind(new_held)
            .bind(reservation_id)
            .execute(&mut *tx)
            .await?;
        let response = serde_json::json!({"held_units": new_held});
        insert_idempotency(
            &mut tx,
            &account_id,
            idempotency_key,
            "top_up",
            request_hash,
            &response,
        )
        .await?;
        tx.commit().await?;
        Ok(new_held)
    }

    pub async fn settle(&self, reservation_id: &str, usage: UsageInput) -> Result<i64, AppError> {
        let started = std::time::Instant::now();
        for attempt in 0..3 {
            match self.settle_once(reservation_id, &usage).await {
                Err(AppError::Database(error)) if retryable_mysql(&error) => {
                    log_mysql_retry(&error, "settle", attempt, started);
                    if attempt == 2 { return Err(AppError::Database(error)); }
                    sleep(Duration::from_millis(20 * (attempt + 1) as u64)).await;
                }
                result => return result,
            }
        }
        Err(AppError::Internal)
    }

    async fn settle_once(&self, reservation_id: &str, usage: &UsageInput) -> Result<i64, AppError> {
        let account_id = reservation_account(&self.pool, reservation_id).await?;
        let mut tx = self.pool.begin().await?;
        lock_account(&mut tx, &account_id).await?;
        let row = sqlx::query(
            "SELECT session_id, metric, held_units, settled_units, state \
             FROM quota_reservations WHERE id = ? FOR UPDATE",
        )
        .bind(reservation_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
        let state: String = row.try_get("state")?;
        if state != "ACTIVE" {
            let settled: i64 = row.try_get("settled_units")?;
            tx.commit().await?;
            return Ok(settled);
        }
        let session_id: String = row.try_get("session_id")?;
        let metric: String = row.try_get("metric")?;
        let mut held: i64 = row.try_get("held_units")?;
        let requested = usage.actual_units.max(0);
        let mut status = usage.usage_status;
        if requested > held {
            let extra = requested - held;
            match add_hold_locked(&mut tx, &account_id, reservation_id, &metric, extra).await {
                Ok(()) => held = requested,
                Err(AppError::QuotaInsufficient) => status = "DISPUTED",
                Err(error) => return Err(error),
            }
        }
        let charged = requested.min(held);
        let allocations = sqlx::query(
            "SELECT bucket_id, reserved_units, consumed_units \
             FROM quota_reservation_allocations \
             WHERE reservation_id = ? ORDER BY allocation_order FOR UPDATE",
        )
        .bind(reservation_id)
        .fetch_all(&mut *tx)
        .await?;
        let mut remaining = charged;
        for allocation in allocations {
            let bucket_id: String = allocation.try_get("bucket_id")?;
            let reserved: i64 = allocation.try_get("reserved_units")?;
            let already_consumed: i64 = allocation.try_get("consumed_units")?;
            let consume = remaining.min(reserved).max(0);
            remaining -= consume;
            let release = reserved - consume;
            sqlx::query(
                "UPDATE quota_reservation_allocations SET consumed_units = ? \
                 WHERE reservation_id = ? AND bucket_id = ?",
            )
            .bind(consume.max(already_consumed))
            .bind(reservation_id)
            .bind(&bucket_id)
            .execute(&mut *tx)
            .await?;
            if release > 0 {
                sqlx::query(
                    "UPDATE quota_buckets SET remaining_units = remaining_units + ? WHERE id = ?",
                )
                .bind(release)
                .bind(bucket_id)
                .execute(&mut *tx)
                .await?;
            }
        }

        let now = Utc::now().naive_utc();
        let retention_until = now + chrono::Duration::days(730);
        sqlx::query(
            "INSERT INTO usage_events \
             (id, account_id, session_id, event_key, usage_status, received_audio_ms, forwarded_audio_ms, provider_audio_ms, \
              input_tokens, output_tokens, cache_hit_tokens, reasoning_tokens, charged_metric, charged_units, pricing_policy_version, occurred_at, retention_until) \
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(&account_id)
        .bind(&session_id)
        .bind(&usage.event_key)
        .bind(status)
        .bind(usage.received_audio_ms.max(0))
        .bind(usage.forwarded_audio_ms.max(0))
        .bind(usage.provider_audio_ms.map(|value| value.max(0)))
        .bind(usage.input_tokens.max(0))
        .bind(usage.output_tokens.max(0))
        .bind(usage.cache_hit_tokens.max(0))
        .bind(usage.reasoning_tokens.max(0))
        .bind(usage.charged_metric)
        .bind(charged)
        .bind(&usage.pricing_policy_version)
        .bind(now)
        .bind(retention_until)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE quota_reservations SET held_units = ?, settled_units = ?, state = 'SETTLED' WHERE id = ?",
        )
        .bind(held)
        .bind(charged)
        .bind(reservation_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE ai_sessions SET state = 'ENDED', terminate_reason = ?, ended_at = UTC_TIMESTAMP(6) WHERE id = ?",
        )
        .bind(&usage.terminate_reason)
        .bind(&session_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(charged)
    }

    pub async fn release(
        &self,
        reservation_id: &str,
        reason: &str,
        expired: bool,
    ) -> Result<(), AppError> {
        self.release_if_active(reservation_id, reason, expired).await.map(|_| ())
    }

    async fn release_if_active(&self, reservation_id: &str, reason: &str, expired: bool) -> Result<bool, AppError> {
        let account_id = reservation_account(&self.pool, reservation_id).await?;
        let mut tx = self.pool.begin().await?;
        lock_account(&mut tx, &account_id).await?;
        let row =
            sqlx::query("SELECT session_id, state, expires_at FROM quota_reservations WHERE id = ? FOR UPDATE")
                .bind(reservation_id)
                .fetch_optional(&mut *tx)
                .await?
                .ok_or(AppError::NotFound)?;
        let state: String = row.try_get("state")?;
        if state != "ACTIVE" {
            tx.commit().await?;
            return Ok(false);
        }
        if expired {
            let now: chrono::NaiveDateTime = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)").fetch_one(&mut *tx).await?;
            if row.try_get::<chrono::NaiveDateTime, _>("expires_at")? > now {
                tx.commit().await?;
                return Ok(false);
            }
        }
        let session_id: String = row.try_get("session_id")?;
        let allocations = sqlx::query(
            "SELECT bucket_id, reserved_units, consumed_units \
             FROM quota_reservation_allocations WHERE reservation_id = ? FOR UPDATE",
        )
        .bind(reservation_id)
        .fetch_all(&mut *tx)
        .await?;
        for allocation in allocations {
            let reserved: i64 = allocation.try_get("reserved_units")?;
            let consumed: i64 = allocation.try_get("consumed_units")?;
            let release = reserved - consumed;
            if release > 0 {
                sqlx::query(
                    "UPDATE quota_buckets SET remaining_units = remaining_units + ? WHERE id = ?",
                )
                .bind(release)
                .bind(allocation.try_get::<String, _>("bucket_id")?)
                .execute(&mut *tx)
                .await?;
            }
        }
        sqlx::query("UPDATE quota_reservations SET state = ? WHERE id = ?")
            .bind(if expired { "EXPIRED" } else { "RELEASED" })
            .bind(reservation_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query(
            "UPDATE ai_sessions SET state = ?, terminate_reason = ?, ended_at = UTC_TIMESTAMP(6) WHERE id = ?",
        )
        .bind(if expired { "ABANDONED" } else { "FAILED" })
        .bind(reason)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn mark_active(
        &self,
        session_id: &str,
        provider_request_id: Option<&str>,
    ) -> Result<(), AppError> {
        let account_id: String = sqlx::query_scalar("SELECT account_id FROM ai_sessions WHERE id = ?")
            .bind(session_id).fetch_optional(&self.pool).await?.ok_or(AppError::NotFound)?;
        let mut tx = self.pool.begin().await?;
        lock_active_account(&mut tx, &account_id).await?;
        let reservations = sqlx::query("SELECT state, expires_at FROM quota_reservations WHERE session_id = ? ORDER BY id FOR UPDATE")
            .bind(session_id).fetch_all(&mut *tx).await?;
        let now: chrono::NaiveDateTime = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)").fetch_one(&mut *tx).await?;
        if reservations.is_empty() { return Err(AppError::AlreadyExists); }
        for row in reservations {
            if row.try_get::<String, _>("state")? != "ACTIVE" || row.try_get::<chrono::NaiveDateTime, _>("expires_at")? <= now {
                return Err(AppError::AlreadyExists);
            }
        }
        let state: String = sqlx::query_scalar("SELECT state FROM ai_sessions WHERE id = ? FOR UPDATE")
            .bind(session_id).fetch_one(&mut *tx).await?;
        if !matches!(state.as_str(), "RESERVED" | "CONNECTING" | "ACTIVE") { return Err(AppError::AlreadyExists); }
        sqlx::query(
            "UPDATE ai_sessions SET state = 'ACTIVE', started_at = COALESCE(started_at, UTC_TIMESTAMP(6)), provider_request_id = COALESCE(?, provider_request_id) WHERE id = ?",
        )
        .bind(provider_request_id)
        .bind(session_id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }

    pub async fn touch_lease(&self, session_id: &str, ttl: Duration) -> Result<bool, AppError> {
        let account_id: String = sqlx::query_scalar("SELECT account_id FROM ai_sessions WHERE id = ?")
            .bind(session_id).fetch_optional(&self.pool).await?.ok_or(AppError::NotFound)?;
        let mut tx = self.pool.begin().await?;
        if lock_account(&mut tx, &account_id).await? != "ACTIVE" { return Ok(false); }
        let states: Vec<String> = sqlx::query_scalar("SELECT state FROM quota_reservations WHERE session_id = ? ORDER BY id FOR UPDATE")
            .bind(session_id).fetch_all(&mut *tx).await?;
        if states.is_empty() || states.iter().any(|state| state != "ACTIVE") { return Ok(false); }
        let state: String = sqlx::query_scalar("SELECT state FROM ai_sessions WHERE id = ? FOR UPDATE")
            .bind(session_id).fetch_one(&mut *tx).await?;
        if !matches!(state.as_str(), "CONNECTING" | "ACTIVE" | "ENDING") { return Ok(false); }
        let now: chrono::NaiveDateTime = sqlx::query_scalar("SELECT UTC_TIMESTAMP(6)").fetch_one(&mut *tx).await?;
        let expires = now + chrono::Duration::from_std(ttl).map_err(|_| AppError::Internal)?;
        sqlx::query("UPDATE quota_reservations SET expires_at = ? WHERE session_id = ? AND state = 'ACTIVE'")
            .bind(expires)
            .bind(session_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE ai_sessions SET lease_expires_at = ? WHERE id = ?")
            .bind(expires).bind(session_id).execute(&mut *tx).await?;
        tx.commit().await?;
        Ok(true)
    }

    pub async fn reap_expired(&self) -> Result<u64, AppError> {
        let rows = sqlx::query(
            "SELECT id FROM quota_reservations \
             WHERE state = 'ACTIVE' AND expires_at <= UTC_TIMESTAMP(6) ORDER BY expires_at LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await?;
        let mut released = 0;
        for row in rows {
            let id: String = row.try_get("id")?;
            match self.release_if_active(&id, "lease_expired", true).await {
                Ok(true) => released += 1,
                Ok(false) => tracing::debug!(reservation_id = %id, "skipped stale reservation candidate"),
                Err(error) => tracing::warn!(reservation_id = %id, error = ?error, "reservation release failed"),
            }
        }
        sqlx::query(
            "DELETE FROM idempotency_records WHERE expires_at <= UTC_TIMESTAMP(6) LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query("DELETE FROM security_events WHERE expires_at <= UTC_TIMESTAMP(6) LIMIT 1000")
            .execute(&self.pool)
            .await?;
        sqlx::query(
            "DELETE FROM usage_events WHERE retention_until <= UTC_TIMESTAMP(6) LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "DELETE FROM oidc_authorizations WHERE expires_at <= UTC_TIMESTAMP(6) LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "DELETE FROM oidc_action_tokens \
             WHERE expires_at <= UTC_TIMESTAMP(6) OR used_at <= UTC_TIMESTAMP(6) - INTERVAL 1 DAY \
             LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE oidc_refresh_tokens SET replaced_by_id = NULL \
             WHERE family_expires_at <= UTC_TIMESTAMP(6) AND replaced_by_id IS NOT NULL",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "DELETE FROM oidc_refresh_tokens \
             WHERE family_expires_at <= UTC_TIMESTAMP(6) AND replaced_by_id IS NULL LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "DELETE FROM oidc_browser_sessions \
             WHERE expires_at <= UTC_TIMESTAMP(6) \
               AND NOT EXISTS (SELECT 1 FROM oidc_authorizations a WHERE a.browser_session_id = oidc_browser_sessions.id) \
               AND NOT EXISTS (SELECT 1 FROM oidc_refresh_tokens r WHERE r.browser_session_id = oidc_browser_sessions.id) \
             LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "DELETE FROM oidc_recovery_codes \
             WHERE used_at <= UTC_TIMESTAMP(6) - INTERVAL 30 DAY LIMIT 1000",
        )
        .execute(&self.pool)
        .await?;
        Ok(released)
    }

    pub async fn grant_adjustment(
        &self,
        account_id: &str,
        metric: &str,
        units: i64,
        reason: &str,
        valid_until: Option<DateTime<Utc>>,
        operator: &str,
    ) -> Result<String, AppError> {
        if !matches!(metric, STT_METRIC | LLM_METRIC)
            || units <= 0
            || reason.is_empty()
            || reason.len() > 512
        {
            return Err(AppError::BadRequest("Invalid quota adjustment."));
        }
        let bucket_id = Uuid::new_v4().to_string();
        let source_ref = format!("manual:{}", Uuid::new_v4());
        let now = Utc::now().naive_utc();
        let mut tx = self.pool.begin().await?;
        lock_active_account(&mut tx, account_id).await?;
        sqlx::query(
            "INSERT INTO quota_buckets \
             (id, account_id, metric, source_type, source_ref, granted_units, remaining_units, valid_until, priority) \
             VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?, 50)",
        )
        .bind(&bucket_id)
        .bind(account_id)
        .bind(metric)
        .bind(&source_ref)
        .bind(units)
        .bind(units)
        .bind(valid_until.map(|value| value.naive_utc()))
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO security_events (id, account_id, event_type, metadata, occurred_at, expires_at) \
             VALUES (?, ?, 'quota_adjustment', ?, ?, ?)",
        )
        .bind(Uuid::new_v4().to_string())
        .bind(account_id)
        .bind(serde_json::json!({"bucket_id": bucket_id, "metric": metric, "units": units, "reason": reason, "operator": operator}))
        .bind(now)
        .bind(now + chrono::Duration::days(30))
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(bucket_id)
    }

    pub async fn session_state(
        &self,
        account_id: &str,
        request_id: &str,
    ) -> Result<Option<String>, AppError> {
        Ok(sqlx::query_scalar(
            "SELECT state FROM ai_sessions WHERE account_id = ? AND client_request_id = ?",
        )
        .bind(account_id)
        .bind(request_id)
        .fetch_optional(&self.pool)
        .await?)
    }
}

pub fn hash_json<T: serde::Serialize>(value: &T) -> Result<String, AppError> {
    serde_json::to_vec(value)
        .map(|bytes| hash_bytes(&bytes))
        .map_err(|_| AppError::Internal)
}

fn hash_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

async fn reservation_account(pool: &MySqlPool, reservation_id: &str) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT account_id FROM quota_reservations WHERE id = ?")
        .bind(reservation_id)
        .fetch_optional(pool)
        .await?
        .ok_or(AppError::NotFound)
}

pub(crate) async fn lock_account(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
) -> Result<String, AppError> {
    sqlx::query_scalar("SELECT status FROM accounts WHERE id = ? FOR UPDATE")
        .bind(account_id)
        .fetch_optional(&mut **tx)
        .await?
        .ok_or(AppError::NotFound)
}

async fn lock_active_account(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
) -> Result<(), AppError> {
    let status = lock_account(tx, account_id).await?;
    if status != "ACTIVE" {
        return Err(AppError::AccountSuspended);
    }
    Ok(())
}

async fn lock_buckets(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
    metric: &str,
) -> Result<Vec<Bucket>, AppError> {
    let rows = sqlx::query(
        "SELECT id, remaining_units FROM quota_buckets \
         WHERE account_id = ? AND metric = ? AND remaining_units > 0 \
           AND valid_from <= UTC_TIMESTAMP(6) \
           AND (valid_until IS NULL OR valid_until > UTC_TIMESTAMP(6)) \
         ORDER BY (valid_until IS NULL), valid_until, priority, id FOR UPDATE",
    )
    .bind(account_id)
    .bind(metric)
    .fetch_all(&mut **tx)
    .await?;
    rows.into_iter()
        .map(|row| {
            Ok(Bucket {
                id: row.try_get("id")?,
                remaining: row.try_get("remaining_units")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()
        .map_err(AppError::Database)
}

fn plan_allocations(buckets: &[Bucket], units: i64) -> Option<Vec<PlannedAllocation>> {
    let mut needed = units;
    let mut plan = Vec::new();
    for bucket in buckets {
        if needed <= 0 {
            break;
        }
        let take = needed.min(bucket.remaining);
        if take > 0 {
            plan.push(PlannedAllocation {
                bucket_id: bucket.id.clone(),
                units: take,
            });
            needed -= take;
        }
    }
    (needed == 0).then_some(plan)
}

async fn add_hold_locked(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
    reservation_id: &str,
    metric: &str,
    units: i64,
) -> Result<(), AppError> {
    let buckets = lock_buckets(tx, account_id, metric).await?;
    let plan = plan_allocations(&buckets, units).ok_or(AppError::QuotaInsufficient)?;
    let max_order: Option<u16> = sqlx::query_scalar(
        "SELECT MAX(allocation_order) FROM quota_reservation_allocations WHERE reservation_id = ?",
    )
    .bind(reservation_id)
    .fetch_one(&mut **tx)
    .await?;
    let mut next_order = max_order.map_or(0, |order| i32::from(order) + 1);
    for allocation in plan {
        sqlx::query("UPDATE quota_buckets SET remaining_units = remaining_units - ? WHERE id = ?")
            .bind(allocation.units)
            .bind(&allocation.bucket_id)
            .execute(&mut **tx)
            .await?;
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM quota_reservation_allocations WHERE reservation_id = ? AND bucket_id = ?)",
        )
        .bind(reservation_id)
        .bind(&allocation.bucket_id)
        .fetch_one(&mut **tx)
        .await?;
        if exists {
            sqlx::query(
                "UPDATE quota_reservation_allocations SET reserved_units = reserved_units + ? \
                 WHERE reservation_id = ? AND bucket_id = ?",
            )
            .bind(allocation.units)
            .bind(reservation_id)
            .bind(&allocation.bucket_id)
            .execute(&mut **tx)
            .await?;
        } else {
            sqlx::query(
                "INSERT INTO quota_reservation_allocations \
                 (reservation_id, bucket_id, allocation_order, reserved_units) VALUES (?, ?, ?, ?)",
            )
            .bind(reservation_id)
            .bind(&allocation.bucket_id)
            .bind(next_order)
            .bind(allocation.units)
            .execute(&mut **tx)
            .await?;
            next_order += 1;
        }
    }
    Ok(())
}

pub(crate) async fn load_idempotency(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
    key: &str,
) -> Result<Option<(String, String, Value)>, AppError> {
    let row = sqlx::query(
        "SELECT operation, request_hash, response_json FROM idempotency_records \
         WHERE account_id = ? AND idempotency_key = ? AND expires_at > UTC_TIMESTAMP(6) FOR UPDATE",
    )
    .bind(account_id)
    .bind(key)
    .fetch_optional(&mut **tx)
    .await?;
    row.map(|row| {
        Ok((
            row.try_get("operation")?,
            row.try_get("request_hash")?,
            row.try_get("response_json")?,
        ))
    })
    .transpose()
    .map_err(AppError::Database)
}

pub(crate) async fn insert_idempotency(
    tx: &mut Transaction<'_, MySql>,
    account_id: &str,
    key: &str,
    operation: &str,
    request_hash: &str,
    response: &Value,
) -> Result<(), AppError> {
    sqlx::query(
        "INSERT INTO idempotency_records \
         (account_id, idempotency_key, operation, request_hash, response_json, expires_at) \
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6) + INTERVAL 24 HOUR)",
    )
    .bind(account_id)
    .bind(key)
    .bind(operation)
    .bind(request_hash)
    .bind(response)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn retryable_mysql(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>())
        .is_some_and(|database| matches!(database.number(), 1213 | 1205))
}

fn log_mysql_retry(error: &sqlx::Error, operation: &str, attempt: usize, started: std::time::Instant) {
    if let Some(database) = error.as_database_error().and_then(|error| error.try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>()) {
        tracing::warn!(operation, attempt = attempt + 1, mysql_number = database.number(), sqlstate = database.code(), elapsed_ms = started.elapsed().as_millis() as u64, exhausted = attempt == 2, "quota transaction lock conflict");
    }
}

#[cfg(test)]
mod tests {
    use super::{plan_allocations, Bucket, PlannedAllocation};

    #[tokio::test]
    #[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
    async fn mysql_retry_classification_uses_error_numbers() -> anyhow::Result<()> {
        let pool = crate::storage::connect(&std::env::var("TEST_DATABASE_URL")?).await?;
        for (number, state, retry) in [(1213, "40001", true), (1205, "HY000", true), (1062, "23000", false)] {
            let error = sqlx::raw_sql(&format!("SIGNAL SQLSTATE '{state}' SET MYSQL_ERRNO = {number}, MESSAGE_TEXT = 'retry classification test'"))
                .execute(&pool).await.unwrap_err();
            assert_eq!(error.as_database_error().unwrap().try_downcast_ref::<sqlx::mysql::MySqlDatabaseError>().unwrap().number(), number);
            assert_eq!(super::retryable_mysql(&error), retry, "MySQL {number}, SQLSTATE {state}");
        }
        assert!(!super::retryable_mysql(&sqlx::Error::RowNotFound));
        pool.close().await;
        Ok(())
    }

    #[test]
    fn allocation_uses_ordered_buckets_without_overdraft() {
        let buckets = vec![
            Bucket {
                id: "expires-first".into(),
                remaining: 30,
            },
            Bucket {
                id: "permanent".into(),
                remaining: 100,
            },
        ];
        assert_eq!(
            plan_allocations(&buckets, 80),
            Some(vec![
                PlannedAllocation {
                    bucket_id: "expires-first".into(),
                    units: 30
                },
                PlannedAllocation {
                    bucket_id: "permanent".into(),
                    units: 50
                },
            ])
        );
        assert!(plan_allocations(&buckets, 131).is_none());
    }
}
