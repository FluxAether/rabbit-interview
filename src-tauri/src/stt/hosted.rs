use super::realtime::{RealtimeSttConfig, TranscriptEvent};
use serde_json::Value;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;

pub(super) fn build_request(config: &RealtimeSttConfig) -> Result<Request, String> {
    let ws_url = config.ws_url.as_deref().filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hosted STT session URL is missing".to_string())?;
    let ticket = config.ws_ticket.as_deref().filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Hosted STT session ticket is missing".to_string())?;
    let mut url = url::Url::parse(ws_url).map_err(|error| error.to_string())?;
    url.query_pairs_mut().append_pair("ticket", ticket);
    url.as_str().into_client_request().map_err(|error| error.to_string())
}

pub(super) enum HostedEvent {
    Ready,
    Transcript(TranscriptEvent),
    Ended { reason: String, reconnect: bool },
    QuotaWarning(String),
}

const NO_RECONNECT: &[&str] = &["user_stop", "client_stop", "sign_out", "quota_exhausted", "account_suspended"];

pub(super) fn parse_message(source: &str, session_id: u64, generation: u64, sequence: u64, payload: &str) -> Result<Option<HostedEvent>, String> {
    let data: Value = serde_json::from_str(payload).map_err(|error| error.to_string())?;
    match data.get("type").and_then(Value::as_str) {
        Some("stt.ready") => Ok(Some(HostedEvent::Ready)),
        Some("transcript") => {
            let boundary = data.get("boundary").and_then(Value::as_str).unwrap_or("interim");
            let boundary = if matches!(boundary, "interim" | "final" | "speech-final" | "utterance-end") { boundary } else { "interim" };
            Ok(Some(HostedEvent::Transcript(TranscriptEvent {
                session_id,
                generation,
                source: source.to_string(),
                text: data.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
                is_final: boundary != "interim",
                boundary: boundary.to_string(),
                sequence,
            })))
        }
        Some("quota.warning") => {
            let remaining = data.get("remaining_ms").and_then(Value::as_u64).unwrap_or(0);
            Ok(Some(HostedEvent::QuotaWarning(format!("Hosted STT quota is low ({remaining} ms remaining)."))))
        }
        Some("session.ended") => {
            let reason = data.get("reason").and_then(Value::as_str).unwrap_or("ended").to_string();
            Ok(Some(HostedEvent::Ended { reconnect: !NO_RECONNECT.contains(&reason.as_str()), reason }))
        }
        _ => Ok(None),
    }
}

pub(super) fn stop_message() -> String {
    r#"{"type":"stt.stop","reason":"client_stop"}"#.into()
}
