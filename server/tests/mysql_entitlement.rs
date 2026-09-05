use std::{sync::Arc, time::Duration};

use chrono::{Duration as ChronoDuration, Utc};
use rabbit_gateway::{
    entitlement::{hash_json, Entitlement, ReserveInput, ReserveOutcome, LLM_METRIC},
    error::AppError,
};
use serde_json::json;
use sqlx::{mysql::MySqlPoolOptions, Row};
use tokio::{sync::Barrier, task::JoinSet};
use uuid::Uuid;

#[tokio::test(flavor = "multi_thread", worker_threads = 8)]
#[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
async fn concurrent_reservations_never_overspend_and_use_earliest_expiry() -> anyhow::Result<()> {
    let database_url = std::env::var("TEST_DATABASE_URL")?;
    let pool = MySqlPoolOptions::new()
        .max_connections(24)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET SESSION time_zone = '+00:00'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query(
                    "SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'",
                )
                .execute(&mut *connection)
                .await?;
                Ok(())
            })
        })
        .connect(&database_url)
        .await?;
    sqlx::migrate!().run(&pool).await?;

    let entitlement = Entitlement::new(pool.clone());
    let account_id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO accounts (id, email, normalized_email, status, email_verified_at) \
         VALUES (?, ?, ?, 'ACTIVE', UTC_TIMESTAMP(6))",
    )
    .bind(&account_id)
    .bind(format!("{account_id}@example.test"))
    .bind(format!("{account_id}@example.test"))
    .execute(&pool)
    .await?;
    let account = entitlement.account(&account_id).await?;
    let early_bucket = Uuid::new_v4().to_string();
    let late_bucket = Uuid::new_v4().to_string();
    for (id, units, valid_until, source_ref) in [
        (
            &early_bucket,
            200_i64,
            Utc::now() + ChronoDuration::days(1),
            "integration-early",
        ),
        (
            &late_bucket,
            455_i64,
            Utc::now() + ChronoDuration::days(2),
            "integration-late",
        ),
    ] {
        sqlx::query(
            "INSERT INTO quota_buckets \
             (id, account_id, metric, source_type, source_ref, granted_units, remaining_units, valid_until) \
             VALUES (?, ?, ?, 'ADJUSTMENT', ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(&account.id)
        .bind(LLM_METRIC)
        .bind(format!("{source_ref}-{}", Uuid::new_v4()))
        .bind(units)
        .bind(units)
        .bind(valid_until.naive_utc())
        .execute(&pool)
        .await?;
    }

    assert_eq!(entitlement.balances(&account.id).await?[LLM_METRIC], 655);

    let barrier = Arc::new(Barrier::new(100));
    let mut tasks = JoinSet::new();
    for _ in 0..100 {
        let entitlement = entitlement.clone();
        let account_id = account.id.clone();
        let barrier = barrier.clone();
        tasks.spawn(async move {
            barrier.wait().await;
            let client_request_id = Uuid::new_v4().to_string();
            entitlement
                .reserve(ReserveInput {
                    account_id,
                    session_id: Uuid::new_v4().to_string(),
                    reservation_id: Uuid::new_v4().to_string(),
                    client_request_id: client_request_id.clone(),
                    interview_id: None,
                    kind: "LLM",
                    audio_source: None,
                    provider: "GEMINI".to_owned(),
                    model: "gemini-3.7-flash".to_owned(),
                    metric: LLM_METRIC,
                    units: 10,
                    idempotency_key: Uuid::new_v4().to_string(),
                    request_hash: hash_json(&json!({ "request_id": &client_request_id }))?,
                    response_json: json!({ "request_id": &client_request_id }),
                    pricing_policy_version: "integration-v1".to_owned(),
                    lease_ttl: Duration::from_secs(120),
                })
                .await
        });
    }

    let mut created = 0;
    let mut denied = 0;
    while let Some(result) = tasks.join_next().await {
        match result? {
            Ok(ReserveOutcome::Created) => created += 1,
            Err(AppError::QuotaInsufficient) => denied += 1,
            Ok(ReserveOutcome::Existing(_)) => anyhow::bail!("unexpected idempotent replay"),
            Err(error) => anyhow::bail!("unexpected reservation error: {error}"),
        }
    }

    let early_remaining: i64 =
        sqlx::query_scalar("SELECT remaining_units FROM quota_buckets WHERE id = ?")
            .bind(&early_bucket)
            .fetch_one(&pool)
            .await?;
    let late_remaining: i64 =
        sqlx::query_scalar("SELECT remaining_units FROM quota_buckets WHERE id = ?")
            .bind(&late_bucket)
            .fetch_one(&pool)
            .await?;
    let totals = sqlx::query(
        "SELECT CAST(COALESCE(SUM(held_units), 0) AS SIGNED) AS held, MIN(held_units) AS minimum \
         FROM quota_reservations WHERE account_id = ? AND state = 'ACTIVE'",
    )
    .bind(&account.id)
    .fetch_one(&pool)
    .await?;

    assert_eq!((created, denied), (65, 35));
    assert_eq!(totals.try_get::<i64, _>("held")?, 650);
    assert!(
        totals
            .try_get::<Option<i64>, _>("minimum")?
            .unwrap_or_default()
            >= 0
    );
    assert_eq!((early_remaining, late_remaining), (0, 5));
    Ok(())
}
