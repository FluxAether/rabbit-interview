use std::{collections::HashMap, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::AppError;

#[derive(Clone, Debug)]
pub struct TicketClaim {
    pub account_id: String,
    pub session_id: String,
    pub reservation_id: String,
    pub source: String,
    pub language: String,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Default)]
pub struct Tickets {
    // ponytail: process-local tickets are correct for the single gateway replica MVP;
    // move them to a shared atomic store before enabling multiple replicas.
    inner: Arc<Mutex<HashMap<String, TicketClaim>>>,
}

impl Tickets {
    pub async fn issue(
        &self,
        ttl: Duration,
        account_id: String,
        session_id: String,
        reservation_id: String,
        source: String,
        language: String,
    ) -> (String, DateTime<Utc>) {
        let now = Utc::now();
        let expires_at =
            now + chrono::Duration::from_std(ttl).unwrap_or_else(|_| chrono::Duration::seconds(30));
        let ticket = Uuid::new_v4().to_string();
        let mut tickets = self.inner.lock().await;
        tickets.retain(|_, claim| claim.expires_at > now);
        tickets.insert(
            ticket.clone(),
            TicketClaim {
                account_id,
                session_id,
                reservation_id,
                source,
                language,
                expires_at,
            },
        );
        (ticket, expires_at)
    }

    pub async fn consume(&self, ticket: &str, session_id: &str) -> Result<TicketClaim, AppError> {
        let claim = self
            .inner
            .lock()
            .await
            .remove(ticket)
            .ok_or(AppError::Unauthorized)?;
        if claim.expires_at <= Utc::now() || claim.session_id != session_id {
            return Err(AppError::Unauthorized);
        }
        Ok(claim)
    }

    pub async fn revoke(&self, ticket: &str) {
        self.inner.lock().await.remove(ticket);
    }
}
