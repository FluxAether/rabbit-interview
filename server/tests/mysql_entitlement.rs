use std::{sync::Arc, time::Duration};

use chrono::{Duration as ChronoDuration, Utc};
use rabbit_gateway::{
    entitlement::{
        hash_json, Entitlement, ReserveInput, ReserveOutcome, UsageInput, LLM_METRIC, STT_METRIC,
    },
    error::AppError,
};
use serde_json::json;
use sqlx::{mysql::MySqlPoolOptions, Row};
use tokio::{sync::Barrier, task::JoinSet};
use uuid::Uuid;

async fn active_stt(entitlement: &Entitlement) -> anyhow::Result<ReserveInput> {
    let account = Uuid::new_v4().to_string();
    let email = format!("{account}@example.test");
    sqlx::query("INSERT INTO accounts (id, email, normalized_email, status) VALUES (?, ?, ?, 'ACTIVE')")
        .bind(&account).bind(&email).bind(&email).execute(entitlement.pool()).await?;
    entitlement.grant_adjustment(&account, STT_METRIC, 120_000, "lease regression", None, "integration-test").await?;
    let input = ReserveInput {
        account_id: account, session_id: Uuid::new_v4().to_string(), reservation_id: Uuid::new_v4().to_string(),
        client_request_id: Uuid::new_v4().to_string(), interview_id: None, kind: "STT", audio_source: Some("SYSTEM".into()),
        provider: "DEEPGRAM".into(), model: "integration-test".into(), metric: STT_METRIC, units: 60_000,
        idempotency_key: Uuid::new_v4().to_string(), request_hash: hash_json(&json!({"test":true}))?,
        response_json: json!({"test":true}), pricing_policy_version: "integration-v1".into(), lease_ttl: Duration::from_secs(120),
    };
    entitlement.reserve(input.clone()).await?;
    entitlement.mark_active(&input.session_id, None).await?;
    Ok(input)
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
async fn renewed_leases_survive_stale_candidates_and_terminal_sessions_stay_terminal() -> anyhow::Result<()> {
    let pool = rabbit_gateway::storage::connect(&std::env::var("TEST_DATABASE_URL")?).await?;
    let entitlement = Entitlement::new(pool.clone());
    let input = active_stt(&entitlement).await?;
    sqlx::query("UPDATE quota_reservations SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?")
        .bind(&input.reservation_id).execute(&pool).await?;
    let candidate: String = sqlx::query_scalar("SELECT id FROM quota_reservations WHERE id = ? AND expires_at <= UTC_TIMESTAMP(6)")
        .bind(&input.reservation_id).fetch_one(&pool).await?;
    assert!(entitlement.touch_lease(&input.session_id, Duration::from_secs(120)).await?);
    entitlement.release(&candidate, "lease_expired", true).await?;
    assert_eq!(entitlement.balances(&input.account_id).await?[STT_METRIC], 60_000, "stale candidate refunded a renewed reservation");
    assert_eq!(entitlement.reap_expired().await?, 0);
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT state FROM ai_sessions WHERE id = ?").bind(&input.session_id).fetch_one(&pool).await?, "ACTIVE");

    sqlx::query("UPDATE quota_reservations SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?")
        .bind(&input.reservation_id).execute(&pool).await?;
    assert_eq!(entitlement.reap_expired().await?, 1);
    assert_eq!(entitlement.reap_expired().await?, 0);
    assert!(!entitlement.touch_lease(&input.session_id, Duration::from_secs(120)).await?);
    assert!(entitlement.mark_active(&input.session_id, None).await.is_err());
    entitlement.release(&candidate, "repeat", false).await?;
    assert_eq!(entitlement.balances(&input.account_id).await?[STT_METRIC], 120_000);
    assert_eq!(sqlx::query_scalar::<_, String>("SELECT state FROM ai_sessions WHERE id = ?").bind(&input.session_id).fetch_one(&pool).await?, "ABANDONED");

    let manual = active_stt(&entitlement).await?;
    entitlement.release(&manual.reservation_id, "connect_failed", false).await?;
    entitlement.release(&manual.reservation_id, "repeat", false).await?;
    assert_eq!(entitlement.balances(&manual.account_id).await?[STT_METRIC], 120_000);
    pool.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4 and performance_schema lock visibility"]
async fn lock_timeout_retries_the_transaction_without_duplicate_top_up() -> anyhow::Result<()> {
    let url = std::env::var("TEST_DATABASE_URL")?;
    let pool = rabbit_gateway::storage::connect(&url).await?;
    let entitlement = Entitlement::new(pool.clone());
    let input = active_stt(&entitlement).await?;
    let worker_pool = MySqlPoolOptions::new().max_connections(1).after_connect(|connection, _| Box::pin(async move {
        sqlx::query("SET SESSION innodb_lock_wait_timeout = 1").execute(connection).await?;
        Ok(())
    })).connect(&url).await?;
    let connection_id: u64 = sqlx::query_scalar("SELECT CONNECTION_ID()").fetch_one(&worker_pool).await?;
    let mut guard = pool.begin().await?;
    sqlx::query("SELECT id FROM accounts WHERE id = ? FOR UPDATE").bind(&input.account_id).fetch_one(&mut *guard).await?;
    let worker = Entitlement::new(worker_pool.clone());
    let reservation_id = input.reservation_id.clone();
    let task = tokio::spawn(async move { worker.top_up(&reservation_id, 60_000, "retry-top-up").await });
    let mut attempts = std::collections::HashSet::new();
    tokio::time::timeout(Duration::from_secs(5), async {
        while attempts.len() < 2 {
            let events: Vec<u64> = sqlx::query_scalar("SELECT REQUESTING_EVENT_ID FROM performance_schema.data_lock_waits WHERE REQUESTING_THREAD_ID = (SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID = ?)")
                .bind(connection_id).fetch_all(&pool).await?;
            attempts.extend(events);
            assert!(!task.is_finished(), "top_up stopped after the first lock timeout instead of retrying");
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        Ok::<_, anyhow::Error>(())
    }).await??;
    guard.rollback().await?;
    assert_eq!(tokio::time::timeout(Duration::from_secs(3), task).await??? , 120_000);
    assert_eq!(entitlement.top_up(&input.reservation_id, 60_000, "retry-top-up").await?, 120_000);
    assert_eq!(entitlement.balances(&input.account_id).await?[STT_METRIC], 0);
    let blocked = active_stt(&entitlement).await?;
    let mut guard = pool.begin().await?;
    sqlx::query("SELECT id FROM accounts WHERE id = ? FOR UPDATE").bind(&blocked.account_id).fetch_one(&mut *guard).await?;
    let worker = Entitlement::new(worker_pool.clone());
    let id = blocked.reservation_id.clone();
    let task = tokio_util::task::AbortOnDropHandle::new(tokio::spawn(async move {
        worker.top_up(&id, 60_000, "retry-exhaustion").await
    }));
    let mut attempts = std::collections::HashSet::new();
    tokio::time::timeout(Duration::from_secs(6), async {
        while !task.is_finished() {
            let events: Vec<u64> = sqlx::query_scalar("SELECT REQUESTING_EVENT_ID FROM performance_schema.data_lock_waits WHERE REQUESTING_THREAD_ID = (SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID = ?)")
                .bind(connection_id).fetch_all(&pool).await?;
            attempts.extend(events);
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        Ok::<_, anyhow::Error>(())
    }).await??;
    assert_eq!(attempts.len(), 3, "retry count must remain bounded");
    assert!(matches!(task.await?, Err(AppError::Database(_))));
    guard.rollback().await?;
    assert_eq!(entitlement.balances(&blocked.account_id).await?[STT_METRIC], 60_000);
    worker_pool.close().await;
    pool.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn concurrent_settle_release_and_reap_have_only_one_financial_effect() -> anyhow::Result<()> {
    let pool = rabbit_gateway::storage::connect(&std::env::var("TEST_DATABASE_URL")?).await?;
    let entitlement = Entitlement::new(pool.clone());
    for _ in 0..10 {
        let input = active_stt(&entitlement).await?;
        sqlx::query("UPDATE quota_reservations SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?")
            .bind(&input.reservation_id).execute(&pool).await?;
        let gate = Arc::new(Barrier::new(3));
        let mut tasks = JoinSet::new();
        for operation in 0..3 {
            let (entitlement, input, gate) = (entitlement.clone(), input.clone(), gate.clone());
            tasks.spawn(async move {
                gate.wait().await;
                match operation {
                    0 => { entitlement.settle(&input.reservation_id, UsageInput {
                        event_key: "final".into(), usage_status: "FINAL", received_audio_ms: 20_000,
                        forwarded_audio_ms: 20_000, provider_audio_ms: Some(20_000), input_tokens: 0,
                        output_tokens: 0, cache_hit_tokens: 0, reasoning_tokens: 0, charged_metric: STT_METRIC,
                        actual_units: 20_000, pricing_policy_version: "integration-v1".into(), terminate_reason: "user_stop".into(),
                    }).await?; }
                    1 => entitlement.release(&input.reservation_id, "lease_expired", true).await?,
                    _ => { entitlement.reap_expired().await?; }
                }
                Ok::<_, AppError>(())
            });
        }
        tokio::time::timeout(Duration::from_secs(5), async {
            while let Some(result) = tasks.join_next().await { result??; }
            Ok::<_, anyhow::Error>(())
        }).await??;
        entitlement.release(&input.reservation_id, "repeat", false).await?;
        let (count, charged): (i64, i64) = sqlx::query_as("SELECT COUNT(*), CAST(COALESCE(SUM(charged_units), 0) AS SIGNED) FROM usage_events WHERE session_id = ?")
            .bind(&input.session_id).fetch_one(&pool).await?;
        assert!(count <= 1);
        assert!(charged == 0 || charged == 20_000);
        assert_eq!(entitlement.balances(&input.account_id).await?[STT_METRIC], 120_000 - charged);
        assert!(!entitlement.touch_lease(&input.session_id, Duration::from_secs(120)).await?);
        assert!(entitlement.mark_active(&input.session_id, None).await.is_err());
        let (reservation, session): (String, String) = sqlx::query_as("SELECT r.state, s.state FROM quota_reservations r JOIN ai_sessions s ON s.id = r.session_id WHERE r.id = ?")
            .bind(&input.reservation_id).fetch_one(&pool).await?;
        assert_eq!((reservation.as_str(), session.as_str()), if count == 1 { ("SETTLED", "ENDED") } else { ("EXPIRED", "ABANDONED") });
    }
    pool.close().await;
    Ok(())
}

#[tokio::test]
#[ignore = "requires TEST_DATABASE_URL pointing to MySQL 8.4"]
async fn additional_holds_top_up_stt_and_settle_llm_without_double_charging() -> anyhow::Result<()>
{
    let pool = rabbit_gateway::storage::connect(&std::env::var("TEST_DATABASE_URL")?).await?;
    let entitlement = Entitlement::new(pool.clone());
    let account_id = Uuid::new_v4().to_string();
    let email = format!("{account_id}@example.test");
    sqlx::query(
        "INSERT INTO accounts (id, email, normalized_email, status, email_verified_at) \
         VALUES (?, ?, ?, 'ACTIVE', UTC_TIMESTAMP(6))",
    )
    .bind(&account_id)
    .bind(&email)
    .bind(&email)
    .execute(&pool)
    .await?;

    for (kind, metric, actual_units) in [("STT", STT_METRIC, 75_000), ("LLM", LLM_METRIC, 135_000)]
    {
        for (units, days) in [(90_000, 1), (180_000, 2)] {
            entitlement
                .grant_adjustment(
                    &account_id,
                    metric,
                    units,
                    "additional hold regression",
                    Some(Utc::now() + ChronoDuration::days(days)),
                    "integration-test",
                )
                .await?;
        }
        let session_id = Uuid::new_v4().to_string();
        let reservation_id = Uuid::new_v4().to_string();
        assert!(matches!(
            entitlement
                .reserve(ReserveInput {
                    account_id: account_id.clone(),
                    session_id: session_id.clone(),
                    reservation_id: reservation_id.clone(),
                    client_request_id: Uuid::new_v4().to_string(),
                    interview_id: None,
                    kind,
                    audio_source: (kind == "STT").then(|| "SYSTEM".to_owned()),
                    provider: "GEMINI".to_owned(),
                    model: "integration-test".to_owned(),
                    metric,
                    units: 60_000,
                    idempotency_key: Uuid::new_v4().to_string(),
                    request_hash: hash_json(&json!({"session_id": session_id}))?,
                    response_json: json!({"session_id": session_id}),
                    pricing_policy_version: "integration-v1".to_owned(),
                    lease_ttl: Duration::from_secs(120),
                })
                .await?,
            ReserveOutcome::Created
        ));

        if kind == "STT" {
            let key = format!("stt:{session_id}:hold:0");
            for _ in 0..2 {
                assert_eq!(
                    entitlement.top_up(&reservation_id, 60_000, &key).await?,
                    120_000
                );
                assert_eq!(entitlement.balances(&account_id).await?[metric], 150_000);
            }
        }

        let usage = UsageInput {
            event_key: "final".to_owned(),
            usage_status: "FINAL",
            received_audio_ms: if kind == "STT" { actual_units } else { 0 },
            forwarded_audio_ms: if kind == "STT" { actual_units } else { 0 },
            provider_audio_ms: (kind == "STT").then_some(actual_units),
            input_tokens: if kind == "LLM" { actual_units } else { 0 },
            output_tokens: 0,
            cache_hit_tokens: 0,
            reasoning_tokens: 0,
            charged_metric: metric,
            actual_units,
            pricing_policy_version: "integration-v1".to_owned(),
            terminate_reason: "user_stop".to_owned(),
        };
        for _ in 0..2 {
            assert_eq!(
                entitlement.settle(&reservation_id, usage.clone()).await?,
                actual_units
            );
            assert_eq!(
                entitlement.balances(&account_id).await?[metric],
                270_000 - actual_units
            );
        }
        let allocations: Vec<(u16, i64)> = sqlx::query_as(
            "SELECT allocation_order, consumed_units FROM quota_reservation_allocations \
             WHERE reservation_id = ? ORDER BY allocation_order",
        )
        .bind(&reservation_id)
        .fetch_all(&pool)
        .await?;
        assert_eq!(
            allocations,
            vec![
                (0, actual_units.min(90_000)),
                (1, (actual_units - 90_000).max(0))
            ]
        );
        let events: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM usage_events WHERE session_id = ?")
                .bind(&session_id)
                .fetch_one(&pool)
                .await?;
        assert_eq!(events, 1);
    }
    pool.close().await;
    Ok(())
}

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
