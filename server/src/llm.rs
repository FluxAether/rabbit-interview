use std::{convert::Infallible, sync::atomic::Ordering};

use axum::{
    body::Body,
    extract::{Path, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use bytes::Bytes;
use futures_util::StreamExt;
use serde_json::json;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{
    entitlement::{hash_json, ReserveInput, ReserveOutcome, UsageInput, LLM_METRIC},
    error::AppError,
    protocol::LlmAnswerRequest,
    providers::gemini::{Event as GeminiEvent, GeminiClient, SseDecoder, Usage},
    AppState, CancellationEntry,
};

const ANSWER_SYSTEM: &str = "You are an interview copilot. Answer every interviewer question in the prompt. If the interviewer asked more than one question, answer each one in order and do not skip any. Prefer Candidate said over Suggested answer; do not treat Suggested answer or Suggested but not used as something the candidate already said. Respond in the same language as the question. Be accurate, specific, concise, and professional. Give a complete answer of roughly 5 to 8 sentences, use plain paragraphs without Markdown headings, and always finish the final sentence.";
const FOLLOW_UP_SYSTEM: &str = "You are an interview copilot handling a user follow-up. Answer the request directly using recent interview turns and provided context. Prefer Candidate said over Suggested answer. Do not treat the request itself as a new interviewer question. Use plain paragraphs without Markdown headings and always finish the final sentence.";

pub async fn create_answer(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(request): Json<LlmAnswerRequest>,
) -> Result<Response, AppError> {
    if !state.config().hosted_llm_enabled {
        return Err(AppError::ProviderUnavailable);
    }
    let account = state.authenticated_account(&headers).await?;
    state.require_eligible(&account)?;
    if Uuid::parse_str(&request.request_id).is_err() {
        return Err(AppError::BadRequest("request_id must be a UUID."));
    }
    let idempotency_key = headers
        .get("Idempotency-Key")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 191)
        .ok_or(AppError::BadRequest("Idempotency-Key is required."))?
        .to_owned();
    let (system, prompt, json_response) = build_prompt(&request)?;
    if system.chars().count() + prompt.chars().count() > 64_000 {
        return Err(AppError::BadRequest("LLM request context is too large."));
    }
    let max_output_tokens = request.max_output_tokens.unwrap_or(2_400).clamp(128, 2_400);
    let estimated_input = estimate_tokens(&format!("{system}\n\n{prompt}"));
    let held_units = estimated_input + max_output_tokens + 4_000;
    let session_id = Uuid::new_v4().to_string();
    let reservation_id = Uuid::new_v4().to_string();
    let response_stub = json!({"session_id": session_id, "request_id": request.request_id});
    let outcome = state
        .entitlement()
        .reserve(ReserveInput {
            account_id: account.id.clone(),
            session_id: session_id.clone(),
            reservation_id: reservation_id.clone(),
            client_request_id: request.request_id.clone(),
            interview_id: None,
            kind: "LLM",
            audio_source: None,
            provider: "GEMINI",
            model: state.config().gemini_model.clone(),
            metric: LLM_METRIC,
            units: held_units,
            idempotency_key,
            request_hash: hash_json(&request_hash_view(&request))?,
            response_json: response_stub,
            pricing_policy_version: state.config().pricing_policy_version.clone(),
            lease_ttl: state.config().reservation_ttl,
        })
        .await?;
    if matches!(outcome, ReserveOutcome::Existing(_)) {
        return Err(AppError::AlreadyExists);
    }

    let cancellation = CancellationToken::new();
    state
        .insert_cancellation(
            request.request_id.clone(),
            CancellationEntry {
                account_id: account.id.clone(),
                token: cancellation.clone(),
            },
        )
        .await;
    let request_id = request.request_id.clone();
    let (sender, receiver) = mpsc::channel::<Result<Bytes, Infallible>>(16);
    let task_state = state.clone();
    state.tracker().spawn(async move {
        run_answer(
            task_state,
            sender,
            request_id,
            account.id,
            session_id,
            reservation_id,
            system,
            prompt,
            json_response,
            max_output_tokens,
            estimated_input,
            cancellation,
        )
        .await;
    });

    let body = Body::from_stream(ReceiverStream::new(receiver));
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .header(header::CACHE_CONTROL, "no-cache, no-store")
        .header("X-Request-Id", request.request_id)
        .body(body)
        .map_err(|_| AppError::Internal)
}

#[allow(clippy::too_many_arguments)]
async fn run_answer(
    state: AppState,
    sender: mpsc::Sender<Result<Bytes, Infallible>>,
    request_id: String,
    _account_id: String,
    session_id: String,
    reservation_id: String,
    system: String,
    prompt: String,
    json_response: bool,
    max_output_tokens: i64,
    estimated_input: i64,
    cancellation: CancellationToken,
) {
    let _permit = match state.concurrency().clone().try_acquire_owned() {
        Ok(permit) => permit,
        Err(_) => {
            let _ = state
                .entitlement()
                .release(&reservation_id, "gateway_concurrency_limit", false)
                .await;
            let _ = send_event(
                &sender,
                "answer.error",
                json!({"request_id":request_id,"code":"RATE_LIMITED"}),
            )
            .await;
            state.remove_cancellation(&request_id).await;
            return;
        }
    };
    state.metrics().llm_active.fetch_add(1, Ordering::Relaxed);
    state.metrics().llm_started.fetch_add(1, Ordering::Relaxed);
    let client = match GeminiClient::new(
        state.http().clone(),
        state.config().gemini_api_key.clone(),
        state.config().gemini_model.clone(),
    ) {
        Ok(client) => client,
        Err(_) => {
            finish_failed(
                &state,
                &sender,
                &request_id,
                &reservation_id,
                "provider_unconfigured",
            )
            .await;
            return;
        }
    };
    let provider = client
        .stream(
            format!("System instructions:\n{system}\n\nUser input:\n{prompt}"),
            json_response,
            max_output_tokens,
        )
        .await;
    let response = match provider {
        Ok(response) => response,
        Err(_) => {
            finish_failed(
                &state,
                &sender,
                &request_id,
                &reservation_id,
                "provider_connect_failed",
            )
            .await;
            return;
        }
    };
    let _ = state.entitlement().mark_active(&session_id, None).await;
    let mut stream = response.bytes_stream();
    let mut decoder = SseDecoder::default();
    let mut usage: Option<Usage> = None;
    let mut output_chars = 0_i64;
    let mut completed = false;
    let mut truncated = false;
    let mut cancelled = false;
    let mut seq = 0_u64;

    loop {
        tokio::select! {
            _ = cancellation.cancelled() => {
                cancelled = true;
                break;
            }
            _ = state.shutdown().cancelled() => {
                cancelled = true;
                break;
            }
            chunk = stream.next() => {
                let Some(chunk) = chunk else { break };
                let chunk = match chunk {
                    Ok(chunk) => chunk,
                    Err(_) => break,
                };
                let events = match decoder.push(chunk) {
                    Ok(events) => events,
                    Err(_) => break,
                };
                for event in events {
                    match event {
                        GeminiEvent::Created(provider_id) => {
                            let _ = state.entitlement().mark_active(&session_id, Some(&provider_id)).await;
                        }
                        GeminiEvent::Delta(delta) => {
                            output_chars += delta.chars().count() as i64;
                            seq += 1;
                            if !send_event(&sender, "answer.delta", json!({"request_id":request_id,"seq":seq,"delta":delta})).await {
                                cancelled = true;
                                break;
                            }
                        }
                        GeminiEvent::Completed(final_usage, was_truncated) => {
                            usage = Some(final_usage);
                            completed = true;
                            truncated = was_truncated;
                        }
                        GeminiEvent::Failed => break,
                    }
                }
                if completed || cancelled { break; }
            }
        }
    }
    if !completed && !cancelled {
        if let Ok(events) = decoder.finish() {
            for event in events {
                if let GeminiEvent::Completed(final_usage, was_truncated) = event {
                    usage = Some(final_usage);
                    completed = true;
                    truncated = was_truncated;
                }
            }
        }
    }
    let final_usage = usage.unwrap_or_else(|| Usage {
        input_tokens: estimated_input,
        output_tokens: (output_chars + 3) / 4,
        reasoning_tokens: 0,
        total_tokens: estimated_input + (output_chars + 3) / 4,
    });
    let actual_units = final_usage
        .total_tokens
        .max(final_usage.input_tokens + final_usage.output_tokens + final_usage.reasoning_tokens);
    let usage_status = if completed { "FINAL" } else { "ESTIMATED" };
    let finish_reason = if cancelled {
        "cancelled"
    } else if truncated {
        "length"
    } else if completed {
        "stop"
    } else {
        "connection_lost"
    };
    let settle = state
        .entitlement()
        .settle(
            &reservation_id,
            UsageInput {
                event_key: "final".to_owned(),
                usage_status,
                received_audio_ms: 0,
                forwarded_audio_ms: 0,
                provider_audio_ms: None,
                input_tokens: final_usage.input_tokens,
                output_tokens: final_usage.output_tokens,
                cache_hit_tokens: 0,
                reasoning_tokens: final_usage.reasoning_tokens,
                charged_metric: LLM_METRIC,
                actual_units,
                pricing_policy_version: state.config().pricing_policy_version.clone(),
                terminate_reason: finish_reason.to_owned(),
            },
        )
        .await;
    if settle.is_ok() {
        seq += 1;
        let _ = send_event(
            &sender,
            "answer.completed",
            json!({"request_id":request_id,"seq":seq,"finish_reason":finish_reason,"usage_status":usage_status.to_ascii_lowercase()}),
        )
        .await;
    } else {
        let _ = send_event(
            &sender,
            "answer.error",
            json!({"request_id":request_id,"code":"INTERNAL_ERROR"}),
        )
        .await;
    }
    state.remove_cancellation(&request_id).await;
    state.metrics().llm_active.fetch_sub(1, Ordering::Relaxed);
}

async fn finish_failed(
    state: &AppState,
    sender: &mpsc::Sender<Result<Bytes, Infallible>>,
    request_id: &str,
    reservation_id: &str,
    reason: &str,
) {
    let _ = state
        .entitlement()
        .release(reservation_id, reason, false)
        .await;
    let _ = send_event(
        sender,
        "answer.error",
        json!({"request_id":request_id,"code":"PROVIDER_UNAVAILABLE"}),
    )
    .await;
    state.remove_cancellation(request_id).await;
    state.metrics().llm_active.fetch_sub(1, Ordering::Relaxed);
}

pub async fn cancel_answer(
    State(state): State<AppState>,
    Path(request_id): Path<String>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, AppError> {
    let account = state.authenticated_account(&headers).await?;
    if let Some(entry) = state.cancellation(&request_id).await {
        if entry.account_id != account.id {
            return Err(AppError::NotFound);
        }
        entry.token.cancel();
        return Ok(Json(
            json!({"request_id":request_id,"state":"cancel_requested"}),
        ));
    }
    let session_state = state
        .entitlement()
        .session_state(&account.id, &request_id)
        .await?;
    match session_state {
        Some(value) => Ok(Json(
            json!({"request_id":request_id,"state":value.to_ascii_lowercase()}),
        )),
        None => Err(AppError::NotFound),
    }
}

async fn send_event(
    sender: &mpsc::Sender<Result<Bytes, Infallible>>,
    event: &str,
    payload: serde_json::Value,
) -> bool {
    sender
        .send(Ok(Bytes::from(format!(
            "event: {event}\ndata: {}\n\n",
            payload
        ))))
        .await
        .is_ok()
}

fn build_prompt(request: &LlmAnswerRequest) -> Result<(String, String, bool), AppError> {
    match request.request_type.as_str() {
        "interviewer-question" | "follow-up" => {
            let question = request
                .question
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .ok_or(AppError::BadRequest("question is required."))?;
            let context = serde_json::to_string(&request.context)
                .map_err(|_| AppError::BadRequest("context must be valid JSON."))?;
            let follow_up = request.request_type == "follow-up";
            let base = if follow_up {
                format!("Respond in the same language as the user. Apply the request to recent interview turns when relevant.\nUser follow-up: {question}\nRelevant resume, job and recent interview turns: {context}")
            } else {
                format!("Answer every interviewer question in the same language, using the relevant resume, job and recent interview turns. If there are multiple questions, answer each one in order and do not skip any.\nInterviewer question: {question}\nRelevant resume, job and recent interview turns: {context}")
            };
            let prompt = match request.continuation_text.as_deref() {
                Some(previous) if !previous.is_empty() => format!("{base}\n\nThe previous answer was cut off by an output limit. Continue exactly where it stopped. Do not restart, repeat, summarize, add a new heading, or mention that you are continuing. Finish the answer with a complete final sentence.\nPartial answer so far:\n{}", tail(previous, 8_000)),
                _ => base,
            };
            Ok((
                (if follow_up {
                    FOLLOW_UP_SYSTEM
                } else {
                    ANSWER_SYSTEM
                })
                .to_owned(),
                prompt,
                false,
            ))
        }
        "structured-json" => {
            let system = request
                .system
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or(AppError::BadRequest("system is required."))?;
            let prompt = request
                .prompt
                .clone()
                .filter(|value| !value.trim().is_empty())
                .ok_or(AppError::BadRequest("prompt is required."))?;
            Ok((system, prompt, true))
        }
        _ => Err(AppError::BadRequest("Unsupported request_type.")),
    }
}

fn estimate_tokens(text: &str) -> i64 {
    let chars = text.chars().count() as i64;
    // CJK frequently approaches one token per character; using that bound avoids under-reserving.
    chars.max((text.len() as i64 + 3) / 4).max(1)
}

fn tail(text: &str, max_chars: usize) -> String {
    let count = text.chars().count();
    text.chars().skip(count.saturating_sub(max_chars)).collect()
}

fn request_hash_view(request: &LlmAnswerRequest) -> serde_json::Value {
    json!({
        "request_id": request.request_id,
        "request_type": request.request_type,
        "question": request.question,
        "context": request.context,
        "continuation_text": request.continuation_text,
        "system": request.system,
        "prompt": request.prompt,
        "response_format": request.response_format,
        "max_output_tokens": request.max_output_tokens,
    })
}

#[cfg(test)]
mod tests {
    use super::{estimate_tokens, tail};

    #[test]
    fn token_estimate_is_conservative_for_cjk_and_tail_is_unicode_safe() {
        assert_eq!(estimate_tokens("面试问题"), 4);
        assert_eq!(tail("甲乙丙丁", 2), "丙丁");
    }
}
