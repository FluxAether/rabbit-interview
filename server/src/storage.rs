use sqlx::{mysql::MySqlPoolOptions, MySqlPool};

pub async fn connect(database_url: &str) -> Result<MySqlPool, sqlx::Error> {
    let pool = MySqlPoolOptions::new()
        .max_connections(20)
        .after_connect(|connection, _| {
            Box::pin(async move {
                sqlx::query("SET time_zone = '+00:00'")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
                    .execute(&mut *connection)
                    .await?;
                sqlx::query("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
                    .execute(&mut *connection)
                    .await?;
                Ok(())
            })
        })
        .connect(database_url)
        .await?;
    sqlx::migrate!().run(&pool).await?;
    Ok(pool)
}

pub async fn ready(pool: &MySqlPool) -> bool {
    sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(pool)
        .await
        .is_ok()
}
