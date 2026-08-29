use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    BadRequest(&'static str),
    #[error("authentication required")]
    Unauthorized,
    #[error("account is not eligible for hosted access")]
    Forbidden,
    #[error("account is suspended")]
    AccountSuspended,
    #[error("insufficient quota")]
    QuotaInsufficient,
    #[error("idempotency key conflicts with another request")]
    IdempotencyConflict,
    #[error("resource not found")]
    NotFound,
    #[error("request is already active or complete")]
    AlreadyExists,
    #[error("provider unavailable")]
    ProviderUnavailable,
    #[error("provider protocol error")]
    ProviderProtocol,
    #[error("rate limited")]
    RateLimited,
    #[error("database error")]
    Database(#[from] sqlx::Error),
    #[error("internal error")]
    Internal,
}

#[derive(Serialize)]
struct ErrorBody {
    code: &'static str,
    message: &'static str,
    request_id: String,
    retryable: bool,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message, retryable) = match self {
            Self::BadRequest(message) => {
                (StatusCode::BAD_REQUEST, "INVALID_REQUEST", message, false)
            }
            Self::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "AUTH_REQUIRED",
                "Authentication is required.",
                false,
            ),
            Self::Forbidden => (
                StatusCode::FORBIDDEN,
                "HOSTED_NOT_ALLOWED",
                "Hosted access is not enabled for this account.",
                false,
            ),
            Self::AccountSuspended => (
                StatusCode::FORBIDDEN,
                "ACCOUNT_SUSPENDED",
                "The account is suspended.",
                false,
            ),
            Self::QuotaInsufficient => (
                StatusCode::PAYMENT_REQUIRED,
                "QUOTA_INSUFFICIENT",
                "Available quota is insufficient.",
                false,
            ),
            Self::IdempotencyConflict => (
                StatusCode::CONFLICT,
                "IDEMPOTENCY_CONFLICT",
                "The idempotency key was reused with a different request.",
                false,
            ),
            Self::AlreadyExists => (
                StatusCode::CONFLICT,
                "REQUEST_ALREADY_EXISTS",
                "This request has already been created.",
                false,
            ),
            Self::NotFound => (
                StatusCode::NOT_FOUND,
                "SESSION_NOT_FOUND",
                "The requested resource was not found.",
                false,
            ),
            Self::ProviderUnavailable => (
                StatusCode::SERVICE_UNAVAILABLE,
                "PROVIDER_UNAVAILABLE",
                "The upstream provider is unavailable.",
                true,
            ),
            Self::ProviderProtocol => (
                StatusCode::BAD_GATEWAY,
                "PROVIDER_PROTOCOL_ERROR",
                "The upstream provider returned an invalid response.",
                false,
            ),
            Self::RateLimited => (
                StatusCode::TOO_MANY_REQUESTS,
                "RATE_LIMITED",
                "Too many requests. Try again later.",
                true,
            ),
            Self::Database(_) | Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                "The request could not be completed.",
                true,
            ),
        };
        (
            status,
            Json(ErrorBody {
                code,
                message,
                request_id: Uuid::new_v4().to_string(),
                retryable,
            }),
        )
            .into_response()
    }
}
