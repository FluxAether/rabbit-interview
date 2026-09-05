use std::{collections::HashMap, sync::Arc, time::Duration};

use chrono::{DateTime, Utc};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::{error::AppError, routing::RouteSnapshot};

#[derive(Clone, Debug)]
pub struct TicketClaim {
    pub account_id: String,
    pub session_id: String,
    pub reservation_id: String,
    pub source: String,
    pub language: String,
    pub route: RouteSnapshot,
    pub expires_at: DateTime<Utc>,
}

#[derive(Clone, Default)]
pub struct Tickets {
    // ponytail: process-local tickets are correct for the single gateway replica MVP;
    // move them to a shared atomic store before enabling multiple replicas.
    inner: Arc<Mutex<HashMap<String, TicketClaim>>>,
}

impl Tickets {
    #[allow(clippy::too_many_arguments)]
    pub async fn issue(
        &self,
        ttl: Duration,
        account_id: String,
        session_id: String,
        reservation_id: String,
        source: String,
        language: String,
        route: RouteSnapshot,
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
                route,
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

#[derive(Clone, Debug)]
pub struct PortalClaim {
    pub account_id: String,
    pub expires_at: DateTime<Utc>,
    pub uses_left: u8,
}

#[derive(Clone, Default)]
pub struct PortalTickets {
    inner: Arc<Mutex<HashMap<String, PortalClaim>>>,
}

impl PortalTickets {
    pub async fn issue(&self, account_id: String, ttl: Duration) -> String {
        let now = Utc::now();
        let expires_at =
            now + chrono::Duration::from_std(ttl).unwrap_or_else(|_| chrono::Duration::seconds(60));
        let ticket = Uuid::new_v4().to_string();
        let mut tickets = self.inner.lock().await;
        tickets.retain(|_, claim| claim.expires_at > now && claim.uses_left > 0);
        tickets.insert(
            ticket.clone(),
            PortalClaim {
                account_id,
                expires_at,
                uses_left: 2,
            },
        );
        ticket
    }

    pub async fn consume(&self, ticket: &str) -> Result<String, AppError> {
        let mut tickets = self.inner.lock().await;
        let claim = tickets.get_mut(ticket).ok_or(AppError::Unauthorized)?;
        if claim.expires_at <= Utc::now() || claim.uses_left == 0 {
            tickets.remove(ticket);
            return Err(AppError::Unauthorized);
        }
        claim.uses_left -= 1;
        let account_id = claim.account_id.clone();
        if claim.uses_left == 0 {
            tickets.remove(ticket);
        }
        Ok(account_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::routing::RouteKind;

    #[tokio::test]
    async fn stt_ticket_keeps_the_route_selected_at_creation() {
        let tickets = Tickets::default();
        let route = RouteSnapshot {
            kind: RouteKind::Stt,
            provider: "deepgram".into(),
            model: "nova-3".into(),
        };
        let (ticket, _) = tickets
            .issue(
                Duration::from_secs(60),
                "acct-1".into(),
                "session-1".into(),
                "reservation-1".into(),
                "microphone".into(),
                "en-US".into(),
                route.clone(),
            )
            .await;
        assert_eq!(
            tickets.consume(&ticket, "session-1").await.unwrap().route,
            route
        );
    }

    #[tokio::test]
    async fn portal_ticket_allows_two_consumes() {
        let tickets = PortalTickets::default();
        let ticket = tickets
            .issue("acct-1".into(), Duration::from_secs(60))
            .await;
        assert_eq!(tickets.consume(&ticket).await.unwrap(), "acct-1");
        assert_eq!(tickets.consume(&ticket).await.unwrap(), "acct-1");
        assert!(matches!(
            tickets.consume(&ticket).await,
            Err(AppError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn portal_ticket_unknown_is_unauthorized() {
        let tickets = PortalTickets::default();
        assert!(matches!(
            tickets.consume("missing").await,
            Err(AppError::Unauthorized)
        ));
    }

    #[tokio::test]
    async fn portal_ticket_expired_is_unauthorized() {
        let tickets = PortalTickets::default();
        let ticket = tickets.issue("acct-1".into(), Duration::ZERO).await;
        tokio::time::sleep(Duration::from_millis(5)).await;
        assert!(matches!(
            tickets.consume(&ticket).await,
            Err(AppError::Unauthorized)
        ));
    }
}
