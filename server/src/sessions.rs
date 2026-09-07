use std::{collections::HashMap, future::Future, time::{Duration, Instant}};

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State, WebSocketUpgrade,
    },
    http::HeaderMap,
    response::{IntoResponse, Response},
    Json,
};
use futures_util::{future::BoxFuture, SinkExt, StreamExt};
use serde::Deserialize;
use serde_json::json;
use tokio::time::{interval, sleep, timeout, MissedTickBehavior};
use tracing::Instrument;
use url::Url;
use uuid::Uuid;

use crate::{
    entitlement::{hash_json, ReserveInput, ReserveOutcome, UsageInput, STT_METRIC},
    error::AppError,
    protocol::{CreateSttSession, CreateSttSessionResponse},
    providers::{
        deepgram::DeepgramClient,
        gemini_live::GeminiLiveClient,
        stt::{timed, SttAdapter, SttConnect, SttEvent, SttSink, STT_IO_TIMEOUT},
        volcengine::VolcengineClient,
    },
    routing::RouteKind,
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
    let route = state.routing().current(RouteKind::Stt).await?;
    tracing::info!(
        account_id = %account.id,
        client_request_id = %request.client_request_id,
        source = %request.source,
        language = %request.language,
        provider = %route.provider,
        model = %route.model,
        "stt request"
    );
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
            route.clone(),
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
            account_id: account.id.clone(),
            session_id,
            reservation_id,
            client_request_id: request.client_request_id.clone(),
            interview_id: request.interview_id.clone(),
            kind: "STT",
            audio_source: Some(source),
            provider: route.provider.to_ascii_uppercase(),
            model: route.model.clone(),
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
        Ok(ReserveOutcome::Created) => {
            tracing::info!(
                account_id = %account.id,
                session_id = %response.session_id,
                reserved_ms = response.reserved_ms,
                provider = %route.provider,
                model = %route.model,
                "stt response"
            );
            Ok(Json(response))
        }
        Ok(ReserveOutcome::Existing(existing)) => {
            state.tickets().revoke(&ticket).await;
            tracing::info!(
                account_id = %account.id,
                client_request_id = %request.client_request_id,
                "stt response replayed"
            );
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
    tracing::info!(
        session_id = %claim.session_id,
        account_id = %claim.account_id,
        source = %claim.source,
        language = %claim.language,
        provider = %claim.route.provider,
        model = %claim.route.model,
        "stt stream request"
    );
    let tracker = state.tracker().clone();
    let max_frame = state.config().max_ws_frame_bytes;
    Ok(upgrade
        .max_frame_size(max_frame)
        .max_message_size(max_frame)
        .on_upgrade(move |socket| async move {
            let span = tracing::info_span!("stt_session", session_id = %claim.session_id, provider = %claim.route.provider);
            let handle = tracker.spawn(run_session(state, socket, claim).instrument(span));
            let _ = handle.await;
        })
        .into_response())
}

async fn run_session(state: AppState, socket: WebSocket, claim: crate::tickets::TicketClaim) {
    let _permit = match state.concurrency().clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            release_stt(&state, &claim, "gateway_concurrency_limit").await;
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
        tracing::warn!(session_id = %claim.session_id, error_code = %error, error = ?error, "STT session ended with an error");
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
    let deadline = sleep(state.config().max_stt_session);
    tokio::pin!(deadline);
    let provider = match stt_adapter(state, &claim.route.provider) {
        Ok(provider) => provider,
        Err(error) => {
            release_stt(state, claim, "provider_unconfigured").await;
            return Err(error);
        }
    };
    let connection = tokio::select! {
        _ = state.shutdown().cancelled() => Err(AppError::ProviderUnavailable),
        _ = &mut deadline => Err(AppError::ProviderUnavailable),
        result = timed("provider_connect", Duration::from_secs(30), provider.connect(SttConnect {
            session_id: claim.session_id.clone(),
            language: claim.language.clone(),
            model: claim.route.model.clone(),
        })) => result,
    };
    let mut connection = match connection {
        Ok(connection) => connection,
        Err(error) => {
            release_stt(state, claim, "provider_connect_failed").await;
            return Err(error);
        }
    };
    let activation = tokio::select! {
        _ = state.shutdown().cancelled() => Err(AppError::ProviderUnavailable),
        _ = &mut deadline => Err(AppError::ProviderUnavailable),
        result = timed("activation", STT_IO_TIMEOUT, state.entitlement().mark_active(
            &claim.session_id, connection.provider_request_id.as_deref(),
        )) => result,
    };
    if let Err(error) = activation {
        connection.worker.abort();
        let _ = timeout(Duration::from_secs(1), &mut connection.worker).await;
        release_stt(state, claim, "activation_failed").await;
        return Err(error);
    }

    let (client_tx, mut client_rx) = socket.split();
    let mut client_tx = Some(client_tx);
    let mut provider_tx = connection.sink;
    let mut provider_rx = connection.events;
    let mut worker = connection.worker;
    let mut seq = 1_u64;
    let mut received_samples = 0_i64;
    let mut held_ms = state.config().initial_stt_hold_ms;
    let mut top_up_index = 0_u64;
    let mut terminate_reason = "client_disconnected";
    let mut usage_status = "FINAL";
    let mut lease = interval(state.config().reservation_ttl / 2);
    lease.set_missed_tick_behavior(MissedTickBehavior::Skip);
    let mut frame_window = Instant::now();
    let mut frame_count = 0_u32;
    let mut audio: Option<BoxFuture<'static, Result<(i64, u64, i64), AppError>>> = None;
    let mut heartbeat: Option<BoxFuture<'static, Result<bool, AppError>>> = None;
    let mut writing = Some(write_client(client_tx.take().expect("initial client writer"), vec![json_message(json!({
        "type":"stt.ready", "seq":seq, "session_id":claim.session_id,
        "source":claim.source, "provider":claim.route.provider, "model":claim.route.model
    }))]));
    let mut quota_notice = None;

    // Keep in-flight operations alive while polling both directions and lifecycle signals.
    let proxy_result = loop {
        tokio::select! {
            _ = state.shutdown().cancelled() => {
                terminate_reason = "gateway_shutdown";
                usage_status = "ESTIMATED";
                break Ok(());
            }
            _ = &mut deadline => {
                terminate_reason = "session_limit";
                break Ok(());
            }
            result = async { writing.as_mut().expect("guarded write").await }, if writing.is_some() => {
                writing = None;
                match result {
                    Ok(sink) => client_tx = Some(sink),
                    Err(error) => break Err(error),
                }
            }
            result = async { audio.as_mut().expect("guarded audio").await }, if audio.is_some() => {
                audio = None;
                match result {
                    Ok((held, index, samples)) => {
                        held_ms = held;
                        top_up_index = index;
                        received_samples += samples;
                    }
                    Err(AppError::QuotaInsufficient) => {
                        seq += 1;
                        let warning = json_message(json!({"type":"quota.warning","seq":seq,"remaining_ms":(held_ms - received_samples * 1000 / 16_000).max(0)}));
                        seq += 1;
                        quota_notice = Some(vec![warning, json_message(json!({"type":"session.ending","seq":seq,"reason":"quota_exhausted"}))]);
                        terminate_reason = "quota_exhausted";
                        break Ok(());
                    }
                    Err(error) => break Err(error),
                }
            }
            result = async { heartbeat.as_mut().expect("guarded heartbeat").await }, if heartbeat.is_some() => {
                heartbeat = None;
                match result {
                    Ok(true) => {}
                    Ok(false) => break Err(AppError::AlreadyExists),
                    Err(AppError::AccountSuspended) => {
                        terminate_reason = "account_suspended";
                        break Ok(());
                    }
                    Err(error) => break Err(error),
                }
            }
            _ = lease.tick(), if heartbeat.is_none() => {
                let entitlement = state.entitlement().clone();
                let session_id = claim.session_id.clone();
                let account_id = claim.account_id.clone();
                let ttl = state.config().reservation_ttl;
                heartbeat = Some(Box::pin(timed("heartbeat", STT_IO_TIMEOUT, async move {
                    if !entitlement.account_is_active(&account_id).await? {
                        return Err(AppError::AccountSuspended);
                    }
                    entitlement.touch_lease(&session_id, ttl).await
                })));
            }
            message = provider_rx.next(), if writing.is_none() => {
                match message {
                    Some(Ok(transcript)) => {
                        seq += 1;
                        writing = Some(write_client(client_tx.take().expect("idle client writer"), vec![transcript_message(seq, claim, transcript)]));
                    }
                    Some(Err(error)) => break Err(error),
                    None => {
                        terminate_reason = "provider_disconnected";
                        usage_status = "ESTIMATED";
                        break Ok(());
                    }
                }
            }
            message = client_rx.next(), if audio.is_none() && writing.is_none() => {
                match message {
                    Some(Ok(Message::Binary(pcm))) => {
                        if pcm.len() > state.config().max_ws_frame_bytes || pcm.len() % 2 != 0 {
                            terminate_reason = "invalid_audio_format";
                            break Ok(());
                        }
                        if frame_window.elapsed().as_secs_f32() >= 1.0 {
                            frame_window = Instant::now();
                            frame_count = 0;
                        }
                        frame_count += 1;
                        if frame_count > state.config().max_ws_frames_per_second {
                            continue;
                        }
                        let samples = (pcm.len() / 2) as i64;
                        let next_ms = (received_samples + samples) * 1000 / 16_000;
                        let needs_top_up = held_ms - next_ms < state.config().stt_top_up_threshold_ms;
                        let entitlement = state.entitlement().clone();
                        let reservation_id = claim.reservation_id.clone();
                        let key = format!("stt:{}:hold:{}", claim.session_id, top_up_index);
                        let units = state.config().stt_top_up_ms;
                        let send = provider_tx.send_pcm(pcm);
                        audio = Some(Box::pin(timed("audio_accept", STT_IO_TIMEOUT, async move {
                            let held = if needs_top_up {
                                entitlement.top_up(&reservation_id, units, &key).await?
                            } else { held_ms };
                            send.await?;
                            Ok((held, top_up_index + u64::from(needs_top_up), samples))
                        })));
                    }
                    Some(Ok(Message::Text(text))) => {
                        let stop = serde_json::from_str::<HashMap<String, String>>(text.as_str())
                            .ok().and_then(|value| value.get("type").cloned())
                            .is_some_and(|kind| kind == "stt.stop");
                        if stop {
                            terminate_reason = "user_stop";
                            break Ok(());
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        writing = Some(write_client(client_tx.take().expect("idle client writer"), vec![Message::Pong(payload)]));
                    }
                    Some(Ok(Message::Close(_))) | None => break Ok(()),
                    Some(Err(_)) => {
                        usage_status = "ESTIMATED";
                        break Ok(());
                    }
                    _ => {}
                }
            }
        }
    };
    drop(audio);
    drop(heartbeat);
    if proxy_result.is_err() {
        terminate_reason = "gateway_error";
        usage_status = "ESTIMATED";
    }

    let drain = async {
        if let Some(write) = writing.take() {
            client_tx = Some(write.await?);
        }
        if let Some(messages) = quota_notice {
            if let Some(sink) = client_tx.take() {
                client_tx = Some(write_client(sink, messages).await?);
            }
        }
        while let Some(event) = provider_rx.next().await {
            let transcript = event?;
            let terminal = transcript.terminal;
            seq += 1;
            if let Some(sink) = client_tx.take() {
                client_tx = Some(write_client(sink, vec![transcript_message(seq, claim, transcript)]).await?);
            }
            if terminal { break; }
        }
        Ok::<(), AppError>(())
    };
    if !matches!(timeout(Duration::from_secs(2), finish_while_draining(provider_tx.as_mut(), drain)).await, Ok(Ok(()))) {
        usage_status = "ESTIMATED";
    }
    drop(provider_rx);
    let closed = timeout(Duration::from_millis(500), async {
        let _ = provider_tx.close().await;
        (&mut worker).await
    }).await;
    if closed.is_err() {
        tracing::warn!(phase = "provider_cleanup", elapsed_ms = 500, "aborting STT provider after graceful cleanup budget");
        worker.abort();
        let _ = timeout(Duration::from_millis(500), &mut worker).await;
    } else if let Ok(Err(error)) = closed {
        tracing::warn!(phase = "provider_cleanup", error = ?error, "STT provider task failed");
    }
    drop(provider_tx);
    drop(client_rx);
    let accepted_ms = received_samples * 1000 / 16_000;
    let settle_result = timed("settlement", STT_IO_TIMEOUT, state.entitlement().settle(
        &claim.reservation_id,
        UsageInput {
            event_key: "final".to_owned(), usage_status,
            received_audio_ms: accepted_ms, forwarded_audio_ms: accepted_ms,
            provider_audio_ms: Some(accepted_ms), input_tokens: 0, output_tokens: 0,
            cache_hit_tokens: 0, reasoning_tokens: 0, charged_metric: STT_METRIC,
            actual_units: accepted_ms, pricing_policy_version: state.config().pricing_policy_version.clone(),
            terminate_reason: terminate_reason.to_owned(),
        },
    )).await;
    tracing::info!(session_id = %claim.session_id, provider = %claim.route.provider, terminate_reason,
        accepted_audio_ms = accepted_ms, usage_status, settle_outcome = if settle_result.is_ok() { "settled" } else { "failed_or_unknown" },
        "STT session finished");
    seq += 1;
    if let Some(mut sink) = client_tx {
        let _ = timeout(Duration::from_secs(1), async {
            sink.send(json_message(json!({
                "type":"session.ended","seq":seq,"reason":terminate_reason,
                "accepted_audio_ms":accepted_ms,"usage_status":usage_status.to_ascii_lowercase()
            }))).await?;
            sink.close().await
        }).await;
    }
    settle_result?;
    proxy_result
}

async fn release_stt(state: &AppState, claim: &crate::tickets::TicketClaim, reason: &'static str) {
    if let Err(error) = timed("release", STT_IO_TIMEOUT, state.entitlement().release(&claim.reservation_id, reason, false)).await {
        tracing::warn!(session_id = %claim.session_id, reservation_id = %claim.reservation_id, error = ?error, "STT reservation release failed");
    }
}

async fn finish_while_draining<F>(provider: &mut dyn SttSink, drain: F) -> Result<(), AppError>
where
    F: Future<Output = Result<(), AppError>>,
{
    let (finish, drain) = tokio::join!(provider.finish(), drain);
    finish?;
    drain
}

fn stt_adapter(state: &AppState, provider: &str) -> Result<Box<dyn SttAdapter>, AppError> {
    match provider {
        "volcengine" => Ok(Box::new(VolcengineClient::new(
            state.config().volcengine_url.clone(),
            state.config().volcengine_api_key.clone(),
            state.config().volcengine_resource_id.clone(),
        )?)),
        "deepgram" => Ok(Box::new(DeepgramClient::new(
            state.config().deepgram_stt_url.clone(),
            state.config().deepgram_api_key.clone(),
        )?)),
        "gemini_live" => Ok(Box::new(GeminiLiveClient::new(
            state.config().gemini_live_url.clone(),
            state.config().gemini_api_key.clone(),
        )?)),
        _ => Err(AppError::ProviderUnavailable),
    }
}

type ClientSink = futures_util::stream::SplitSink<WebSocket, Message>;

fn write_client(mut sink: ClientSink, messages: Vec<Message>) -> BoxFuture<'static, Result<ClientSink, AppError>> {
    Box::pin(timed("client_write", STT_IO_TIMEOUT, async move {
        for message in messages {
            sink.send(message).await.map_err(|_| AppError::ProviderUnavailable)?;
        }
        Ok(sink)
    }))
}

fn transcript_message(seq: u64, claim: &crate::tickets::TicketClaim, transcript: SttEvent) -> Message {
    tracing::info!(
        session_id = %claim.session_id,
        provider = %claim.route.provider,
        seq,
        boundary = transcript.boundary,
        terminal = transcript.terminal,
        text = %crate::access::truncate(&transcript.text),
        "stt response"
    );
    json_message(json!({
        "type":"transcript", "seq":seq, "session_id":claim.session_id, "source":claim.source,
        "boundary":transcript.boundary, "text":transcript.text, "provider_offset_ms":transcript.provider_offset_ms
    }))
}

fn json_message(value: serde_json::Value) -> Message {
    Message::Text(value.to_string().into())
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
    use bytes::Bytes;
    use futures_util::future::BoxFuture;
    use tokio::sync::oneshot;

    use super::{finish_while_draining, ws_url};
    use crate::{error::AppError, providers::stt::SttSink};

    struct BackpressuredSink {
        finish_gate: Option<oneshot::Receiver<()>>,
    }

    impl SttSink for BackpressuredSink {
        fn send_pcm(&mut self, _pcm: Bytes) -> BoxFuture<'static, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }

        fn finish(&mut self) -> BoxFuture<'static, Result<(), AppError>> {
            let gate = self.finish_gate.take().unwrap();
            Box::pin(async move {
                gate.await.map_err(|_| AppError::ProviderUnavailable)?;
                Ok(())
            })
        }

        fn close(&mut self) -> BoxFuture<'static, Result<(), AppError>> {
            Box::pin(async { Ok(()) })
        }
    }

    #[tokio::test]
    async fn finish_and_drain_advance_concurrently_under_backpressure() {
        let (release_finish, finish_gate) = oneshot::channel();
        let mut provider = BackpressuredSink {
            finish_gate: Some(finish_gate),
        };
        tokio::time::timeout(
            std::time::Duration::from_millis(100),
            finish_while_draining(&mut provider, async move {
                release_finish.send(()).unwrap();
                Ok(())
            }),
        )
        .await
        .expect("finish and drain deadlocked")
        .unwrap();
    }

    #[test]
    fn websocket_url_never_contains_credentials() {
        assert_eq!(
            ws_url("https://gateway.example.com", "session").unwrap(),
            "wss://gateway.example.com/v1/stt/sessions/session/stream"
        );
    }
}
