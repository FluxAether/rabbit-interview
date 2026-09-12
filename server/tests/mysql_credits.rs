use oncue_gateway::entitlement::{Entitlement, CREDIT_METRIC};
use sqlx::Row;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn legacy_balances_convert_once_preserving_gifts_and_releasing_paid_periods(
) -> anyhow::Result<()> {
    let pool = oncue_gateway::storage::connect(&std::env::var("TEST_DATABASE_URL")?).await?;
    let account = Uuid::new_v4().to_string();
    let email = format!("{account}@migration.test");
    sqlx::query(
        "INSERT INTO accounts (id, email, normalized_email, status) VALUES (?, ?, ?, 'ACTIVE')",
    )
    .bind(&account)
    .bind(&email)
    .bind(&email)
    .execute(&pool)
    .await?;
    for (metric, source, remaining, starts, ends) in [
        ("STT_AUDIO_MS", "SUBSCRIPTION", 60_000, -1, 29),
        ("LLM_TOKEN_UNITS", "SUBSCRIPTION", 1_000, 29, 59),
        ("STT_AUDIO_MS", "FREE_TRIAL", 30_000, -1, 5),
        ("LLM_TOKEN_UNITS", "SUBSCRIPTION", 5_000, -60, -30),
        ("LLM_TOKEN_UNITS", "SUBSCRIPTION", 0, -1, 29),
    ] {
        sqlx::query("INSERT INTO quota_buckets (id, account_id, metric, source_type, source_ref, granted_units, remaining_units, valid_from, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?, TIMESTAMPADD(DAY, ?, UTC_TIMESTAMP(6)), TIMESTAMPADD(DAY, ?, UTC_TIMESTAMP(6)))")
            .bind(Uuid::new_v4().to_string()).bind(&account).bind(metric).bind(source).bind(Uuid::new_v4().to_string())
            .bind(remaining.max(1)).bind(remaining).bind(starts).bind(ends).execute(&pool).await?;
    }
    for _ in 0..2 {
        sqlx::raw_sql(include_str!(
            "../migrations/202609110006_credits_balances.sql"
        ))
        .execute(&pool)
        .await?;
        assert_eq!(
            Entitlement::new(pool.clone()).balances(&account).await?[CREDIT_METRIC],
            150_000
        );
        let converted = sqlx::query("SELECT source_type, valid_from <= UTC_TIMESTAMP(6) AS available, valid_until IS NULL AS permanent FROM quota_buckets WHERE account_id = ? AND metric = 'CREDITS'")
            .bind(&account).fetch_all(&pool).await?;
        assert_eq!(converted.len(), 3);
        for row in converted {
            assert_eq!(row.try_get::<i64, _>("available")?, 1);
            assert_eq!(
                row.try_get::<i64, _>("permanent")?,
                i64::from(row.try_get::<String, _>("source_type")? == "SUBSCRIPTION")
            );
        }
    }
    pool.close().await;
    Ok(())
}
