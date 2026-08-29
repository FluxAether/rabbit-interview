use std::{collections::HashMap, time::Instant};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::time::{interval, sleep, timeout, MissedTickBehavior};
use tokio_tungstenite::tungstenite::Message as ProviderMessage;
use url::Url;
use uuid::Uuid;

use crate::{
    entitlement::{hash_json, ReserveInput, ReserveOutcome, UsageInput, STT_METRIC},
    error::AppError,
    protocol::{CreateSttSession, CreateSttSessionResponse},
    providers::volcengine::{audio_frame, parse_response, VolcengineClient},
    AppState,
};

#[derive(Deserialize)]
pub struct WsTicketQuery {
    ticket: String,
}

pub async fn create_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<CreateSttSession>,
) -> Result<Json<CreateSttSessionResponse>, AppError> {
    if !state.config().hosted_stt_enabled {
        return Err(AppError::ProviderUnavailable);
    }
    let account = state.authenticated_account(&headers).await?;
    state.require_eligible(&account)?;
    validate_request(&request)?;
    let idempotency_key = idempotency_key(&headers)?;
    let request_hash = hash_json(&request)?;
    let session_id = Uuid::new_v4().to_string();
    let reservation_id = Uuid::new_v4().to_string();
    let (ticket, ticket_expires_at) = state
        .tickets()
        .issue(
            state.config().ticket_ttl,
            account.id.clone(),
            session_id.clone(),
            reservation_id.clone(),
            request.source.clone(),
            request.language.clone(),
        )
        .await;
    let response = CreateSttSessionResponse {
        session_id: session_id.clone(),
        protocol_version: 1,
        ws_url: ws_url(state.config().gateway_public_url.as_str(), &session_id)?,
        ws_ticket: ticket.clone(),
        ticket_expires_at: ticket_expires_at.to_rfc3339(),
        reserved_ms: state.config().initial_stt_hold_ms,
    };
    let source = request.source.to_ascii_uppercase();
    let reserve = state
        .entitlement()
        .reserve(ReserveInput {
            account_id: account.id,
            session_id,
            reservation_id,
            client_request_id: request.client_request_id.clone(),
            interview_id: request.interview_id.clone(),
            kind: "STT",
            audio_source: Some(source),
            provider: "VOLCENGINE",
            model: "bigmodel".to_owned(),
            metric: STT_METRIC,
            units: state.config().initial_stt_hold_ms,
            idempotency_key,
            request_hash,
            response_json: serde_json::to_value(&response).map_err(|_| AppError::Internal)?,
            pricing_policy_version: state.config().pricing_policy_version.clone(),
            lease_ttl: state.config().reservation_ttl,
        })
        .await;
    match reserve {
        Ok(ReserveOutcome::Created) => Ok(Json(response)),
        Ok(ReserveOutcome::Existing(existing)) => {
            state.tickets().revoke(&ticket).await;
            serde_json::from_value(existing)
                .map(Json)
                .map_err(|_| AppError::Internal)
        }
        Err(error) => {
            state.tickets().revoke(&ticket).await;
            Err(error)
        }
    }
}

pub async fn stream_session(
    State(state): State<AppState>,
    Path(session_id): Path<String>,
    Query(query): Query<WsTicketQuery>,
    upgrade: WebSocketUpgrade,
) -> Result<Response, AppError> {
    let claim = state.tickets().consume(&query.ticket, &session_id).await?;
    let tracker = state.tracker().clone();
    let max_frame = state.config().max_ws_frame_bytes;
    Ok(upgrade
        .max_frame_size(max_frame)
        .max_message_size(max_frame)
        .on_upgrade(move |socket| async move {
            let handle = tracker.spawn(run_session(state, socket, claim));
            let _ = handle.await;
        })
        .into_response())
}

async fn run_session(state: AppState, socket: WebSocket, claim: crate::tickets::TicketClaim) {
    let _permit = match state.concurrency().clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            let _ = state
                .entitlement()
                .release(&claim.reservation_id, "gateway_concurrency_limit", false)
                .await;
            return;
        }
    };
    state
        .metrics()
        .stt_active
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    state
        .metrics()
        .stt_started
        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let result = proxy_stt(&state, socket, &claim).await;
    if let Err(error) = result {
        tracing::warn!(session_id = %claim.session_id, error_code = %error, "STT session ended with an error");
    }
    state
        .metrics()
        .stt_active
        .fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
}

async fn proxy_stt(
    state: &AppState,
    socket: WebSocket,
    claim: &crate::tickets::TicketClaim,
) -> Result<(), AppError> {
    let provider = match VolcengineClient::new(
        state.config().volcengine_url.clone(),
        state.config().volcengine_api_key.clone(),
        state.config().volcengine_resource_id.clone(),
    ) {
        Ok(provider) => provider,
        Err(error) => {
            let _ = state
                .entitlement()
                .release(&claim.reservation_id, "provider_unconfigured", false)
                .await;
            return Err(error);
        }
    };
    let connection = provider.connect(&claim.session_id, &claim.language).await;
    let (provider_socket, provider_request_id) = match connection {
        Ok(value) => value,
        Err(error) => {
            let _ = state
                .entitlement()
                .release(&claim.reservation_id, "provider_connect_failed", false)
                .await;
            return Err(error);
        }
    };
    if let Err(error) = state
        .entitlement()
        .mark_active(&claim.session_id, provider_request_id.as_deref())
        .await
    {
        let _ = state
            .entitlement()
            .release(&claim.reservation_id, "activation_failed", false)
            .await;
        return Err(error);
    }
    let (mut client_tx, mut client_rx) = socket.split();
    let (mut provider_tx, mut provider_rx) = provider_socket.split();
    let mut seq = 1_u64;
    let mut received_samples = 0_i64;
    let mut forwarded_samples = 0_i64;
    let mut held_ms = state.config().initial_stt_hold_ms;
    let mut top_up_index = 0_u64;
    let mut terminate_reason = "client_disconnected";
    let mut usage_status = "FINAL";
    let mut lease = interval(state.config().reservation_ttl / 2);
    lease.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let deadline = sleep(state.config().max_stt_session);
    tokio::pin!(deadline);
    let mut frame_window = Instant::now();
    let mut frame_count = 0_u32;

    let proxy_result = async {
        send_json(
            &mut client_tx,
            json!({"type":"stt.ready","seq":seq,"session_id":claim.session_id,"source":claim.source}),
        )
        .await?;
        loop {
            tokio::select! {
            _ = state.shutdown().cancelled() => {
                terminate_reason = "gateway_shutdown";
                usage_status = "ESTIMATED";
                break;
            }
            _ = &mut deadline => {
                terminate_reason = "session_limit";
                break;
            }
            _ = lease.tick() => {
                if !state.entitlement().account_is_active(&claim.account_id).await? {
                    terminate_reason = "account_suspended";
                    break;
                }
                state.entitlement().touch_lease(&claim.session_id, state.config().reservation_ttl).await?;
            }
            message = client_rx.next() => {
                match message {
                    Some(Ok(Message::Binary(pcm))) => {
                        if pcm.len() > state.config().max_ws_frame_bytes || pcm.len() % 2 != 0 {
                            terminate_reason = "invalid_audio_format";
                            break;
                        }
                        if frame_window.elapsed().as_secs_f32() >= 1.0 {
                            frame_window = Instant::now();
                            frame_count = 0;
                        }
                        frame_count += 1;
                        if frame_count > state.config().max_ws_frames_per_second {
                            terminate_reason = "frame_rate_limited";
                            break;
                        }
                        let samples = (pcm.len() / 2) as i64;
                        let next_ms = (received_samples + samples) * 1000 / 16_000;
                        if held_ms - next_ms < state.config().stt_top_up_threshold_ms {
                            let key = format!("stt:{}:hold:{}", claim.session_id, top_up_index);
                            match state.entitlement().top_up(&claim.reservation_id, state.config().stt_top_up_ms, &key).await {
                                Ok(new_held) => {
                                    held_ms = new_held;
                                    top_up_index += 1;
                                }
                                Err(AppError::QuotaInsufficient) => {
                                    seq += 1;
                                    send_json(&mut client_tx, json!({"type":"quota.warning","seq":seq,"remaining_ms":(held_ms - received_samples * 1000 / 16_000).max(0)})).await?;
                                    seq += 1;
                                    send_json(&mut client_tx, json!({"type":"session.ending","seq":seq,"reason":"quota_exhausted"})).await?;
                                    terminate_reason = "quota_exhausted";
                                    break;
                                }
                                Err(error) => return Err(error),
                            }
                        }
                        provider_tx.send(ProviderMessage::Binary(audio_frame(&pcm, false)?.into())).await.map_err(|_| AppError::ProviderUnavailable)?;
                        received_samples += samples;
                        forwarded_samples += samples;
                    }
                    Some(Ok(Message::Text(text))) => {
                        let stop = serde_json::from_str::<HashMap<String, String>>(text.as_str())
                            .ok()
                            .and_then(|value| value.get("type").cloned())
                            .is_some_and(|kind| kind == "stt.stop");
                        if stop {
                            terminate_reason = "user_stop";
                            break;
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        client_tx.send(Message::Pong(payload)).await.map_err(|_| AppError::ProviderUnavailable)?;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => {
                        usage_status = "ESTIMATED";
                        break;
                    }
                    _ => {}
                }
            }
            message = provider_rx.next() => {
                match message {
                    Some(Ok(ProviderMessage::Binary(frame))) => {
                        if let Some(transcript) = parse_response(&frame)? {
                            seq += 1;
                            send_json(&mut client_tx, json!({
                                "type":"transcript",
                                "seq":seq,
                                "session_id":claim.session_id,
                                "source":claim.source,
                                "boundary":transcript.boundary,
                                "text":transcript.text,
                                "provider_offset_ms":transcript.provider_offset_ms
                            })).await?;
                        }
                    }
                    Some(Ok(ProviderMessage::Ping(payload))) => {
                        provider_tx.send(ProviderMessage::Pong(payload)).await.map_err(|_| AppError::ProviderUnavailable)?;
                    }
                    Some(Ok(ProviderMessage::Close(_))) | None => {
                        terminate_reason = "provider_disconnected";
                        usage_status = "ESTIMATED";
                        break;
                    }
                    Some(Err(_)) => {
                        terminate_reason = "provider_error";
                        usage_status = "ESTIMATED";
                        break;
                    }
                    _ => {}
                }
            }
            }
        }
        Ok::<(), AppError>(())
    }
    .await;
    if proxy_result.is_err() {
        terminate_reason = "gateway_error";
        usage_status = "ESTIMATED";
    }

    if let Ok(frame) = audio_frame(&[], true) {
        let _ = provider_tx
            .send(ProviderMessage::Binary(frame.into()))
            .await;
    }
    let drain = async {
        while let Some(Ok(message)) = provider_rx.next().await {
            if let ProviderMessage::Binary(frame) = message {
                if let Some(transcript) = parse_response(&frame)? {
                    seq += 1;
                    send_json(&mut client_tx, json!({
                        "type":"transcript","seq":seq,"session_id":claim.session_id,
                        "source":claim.source,"boundary":transcript.boundary,"text":transcript.text,
                        "provider_offset_ms":transcript.provider_offset_ms
                    })).await?;
                    if transcript.final_packet {
                        break;
                    }
                }
            }
        }
        Ok::<(), AppError>(())
    };
    let _ = timeout(std::time::Duration::from_secs(2), drain).await;
    let accepted_ms = received_samples * 1000 / 16_000;
    let forwarded_ms = forwarded_samples * 1000 / 16_000;
    let settle_result = state
        .entitlement()
        .settle(
            &claim.reservation_id,
            UsageInput {
                event_key: "final".to_owned(),
                usage_status,
                received_audio_ms: accepted_ms,
                forwarded_audio_ms: forwarded_ms,
                provider_audio_ms: Some(forwarded_ms),
                input_tokens: 0,
                output_tokens: 0,
                cache_hit_tokens: 0,
                reasoning_tokens: 0,
                charged_metric: STT_METRIC,
                actual_units: accepted_ms,
                pricing_policy_version: state.config().pricing_policy_version.clone(),
                terminate_reason: terminate_reason.to_owned(),
            },
        )
        .await;
    seq += 1;
    let _ = send_json(
        &mut client_tx,
        json!({
            "type":"session.ended","seq":seq,"reason":terminate_reason,
            "accepted_audio_ms":accepted_ms,"usage_status":usage_status.to_ascii_lowercase()
        }),
    )
    .await;
    let _ = provider_tx.close().await;
    let _ = client_tx.close().await;
    settle_result?;
    proxy_result
}

async fn send_json(
    sink: &mut futures_util::stream::SplitSink<WebSocket, Message>,
    value: serde_json::Value,
) -> Result<(), AppError> {
    sink.send(Message::Text(value.to_string().into()))
        .await
        .map_err(|_| AppError::ProviderUnavailable)
}

fn validate_request(request: &CreateSttSession) -> Result<(), AppError> {
    if Uuid::parse_str(&request.client_request_id).is_err()
        || request
            .interview_id
            .as_deref()
            .is_some_and(|id| Uuid::parse_str(id).is_err())
        || !matches!(request.source.as_str(), "system" | "microphone")
        || !matches!(
            request.language.as_str(),
            "zh-CN" | "zh-TW" | "en-US" | "multi"
        )
        || request.audio.encoding != "pcm_s16le"
        || request.audio.sample_rate != 16_000
        || request.audio.channels != 1
    {
        return Err(AppError::BadRequest(
            "Hosted STT v1 requires UUID ids and PCM S16LE, 16 kHz, mono audio.",
        ));
    }
    Ok(())
}

fn idempotency_key(headers: &HeaderMap) -> Result<String, AppError> {
    let value = headers
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 191)
        .ok_or(AppError::BadRequest("Idempotency-Key is required."))?;
    Ok(value.to_owned())
}

fn ws_url(public_url: &str, session_id: &str) -> Result<String, AppError> {
    let mut url = Url::parse(public_url).map_err(|_| AppError::Internal)?;
    let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
    url.set_scheme(scheme).map_err(|_| AppError::Internal)?;
    url.set_path(&format!("/v1/stt/sessions/{session_id}/stream"));
    url.set_query(None);
    Ok(url.to_string())
}

#[cfg(test)]
mod tests {
    use super::ws_url;

    #[test]
    fn websocket_url_never_contains_credentials() {
        assert_eq!(
            ws_url("https://gateway.example.com", "session").unwrap(),
            "wss://gateway.example.com/v1/stt/sessions/session/stream"
        );
    }
}
