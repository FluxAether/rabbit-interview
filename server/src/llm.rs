use std::{
    convert::Infallible,
    sync::{atomic::Ordering, Arc},
};

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
    providers::{
        anthropic::AnthropicClient,
        gemini::GeminiClient,
        groq::GroqClient,
        llm::{LlmAdapter, LlmEvent, LlmInput, ProviderError, Usage},
        openai::OpenAiClient,
    },
    routing::{RouteKind, RouteSnapshot},
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
    let route = state.routing().current(RouteKind::Llm).await?;
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
            provider: route.provider.to_ascii_uppercase(),
            model: route.model.clone(),
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
            session_id,
            reservation_id,
            system,
            prompt,
            json_response,
            max_output_tokens,
            estimated_input,
            cancellation,
            route,
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
    session_id: String,
    reservation_id: String,
    system: String,
    prompt: String,
    json_response: bool,
    max_output_tokens: i64,
    estimated_input: i64,
    cancellation: CancellationToken,
    route: RouteSnapshot,
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
                json!({"request_id":request_id,"seq":0,"code":"RATE_LIMITED","provider":route.provider,"model":route.model}),
            )
            .await;
            state.remove_cancellation(&request_id).await;
            return;
        }
    };
    state.metrics().llm_active.fetch_add(1, Ordering::Relaxed);
    state.metrics().llm_started.fetch_add(1, Ordering::Relaxed);
    let client = match adapter_for(&state, &route) {
        Ok(client) => client,
        Err(error) => {
            finish_failed(
                &state,
                &sender,
                &request_id,
                &reservation_id,
                "provider_unconfigured",
                error,
                &route,
            )
            .await;
            return;
        }
    };
    let provider = client
        .stream(LlmInput {
            system,
            prompt,
            json_response,
            max_output_tokens,
        })
        .await;
    let mut stream = match provider {
        Ok(stream) => stream,
        Err(error) => {
            finish_failed(
                &state,
                &sender,
                &request_id,
                &reservation_id,
                "provider_connect_failed",
                error,
                &route,
            )
            .await;
            return;
        }
    };
    let _ = state.entitlement().mark_active(&session_id, None).await;
    let mut usage: Option<Usage> = None;
    let mut output_ascii_chars = 0_i64;
    let mut output_non_ascii_chars = 0_i64;
    let mut completed = false;
    let mut cancelled = false;
    let mut stream_error: Option<ProviderError> = None;
    let mut finish_reason = "connection_lost".to_owned();
    let mut seq = 0_u64;

    if !send_event_cancellable(
        &sender,
        "answer.started",
        json!({"request_id":request_id,"seq":0,"provider":route.provider,"model":route.model}),
        &cancellation,
        state.shutdown(),
    )
    .await
    {
        cancelled = true;
    }

    while !completed && !cancelled {
        tokio::select! {
            _ = cancellation.cancelled() => {
                cancelled = true;
                break;
            }
            _ = state.shutdown().cancelled() => {
                cancelled = true;
                break;
            }
            event = stream.next() => {
                let Some(event) = event else { break };
                match event {
                    Ok(LlmEvent::Created(provider_id)) => {
                        let _ = state.entitlement().mark_active(&session_id, Some(&provider_id)).await;
                    }
                    Ok(LlmEvent::Delta(delta)) => {
                        for character in delta.chars() {
                            if character.is_ascii() {
                                output_ascii_chars += 1;
                            } else {
                                output_non_ascii_chars += 1;
                            }
                        }
                        seq += 1;
                        if !send_event_cancellable(
                            &sender,
                            "answer.delta",
                            json!({"request_id":request_id,"seq":seq,"delta":delta}),
                            &cancellation,
                            state.shutdown(),
                        ).await {
                            cancelled = true;
                        }
                    }
                    Ok(LlmEvent::Usage(final_usage)) => usage = Some(final_usage),
                    Ok(LlmEvent::Completed { finish_reason: provider_reason, truncated }) => {
                        completed = true;
                        finish_reason = if truncated { "length".to_owned() } else { provider_reason };
                    }
                    Err(error) => {
                        stream_error = Some(error);
                        break;
                    }
                }
            }
        }
    }
    let usage_status = provider_usage_status(completed, usage.as_ref());
    let final_usage = settled_usage(
        usage,
        completed,
        estimated_input,
        output_ascii_chars,
        output_non_ascii_chars,
    );
    let actual_units = billable_units(
        &final_usage,
        usage_status,
        &finish_reason,
        estimated_input,
        max_output_tokens,
    );
    if cancelled {
        finish_reason = "cancelled".to_owned();
    }
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
                terminate_reason: finish_reason.clone(),
            },
        )
        .await;
    if settle.is_err() {
        seq += 1;
        let _ = send_event_cancellable(
            &sender,
            "answer.error",
            json!({"request_id":request_id,"seq":seq,"code":"INTERNAL_ERROR","provider":route.provider,"model":route.model}),
            &cancellation,
            state.shutdown(),
        )
        .await;
    } else if let Some(error) =
        stream_error.or_else(|| (!completed && !cancelled).then_some(ProviderError::Unavailable))
    {
        seq += 1;
        let _ = send_event_cancellable(
            &sender,
            "answer.error",
            json!({"request_id":request_id,"seq":seq,"code":provider_error_code(error),"provider":route.provider,"model":route.model}),
            &cancellation,
            state.shutdown(),
        )
        .await;
    } else {
        seq += 1;
        let _ = send_event_cancellable(
            &sender,
            "answer.completed",
            json!({"request_id":request_id,"seq":seq,"finish_reason":finish_reason,"usage_status":usage_status.to_ascii_lowercase(),"provider":route.provider,"model":route.model}),
            &cancellation,
            state.shutdown(),
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
    error: ProviderError,
    route: &RouteSnapshot,
) {
    let _ = state
        .entitlement()
        .release(reservation_id, reason, false)
        .await;
    let _ = send_event(
        sender,
        "answer.error",
        json!({"request_id":request_id,"seq":0,"code":provider_error_code(error),"provider":route.provider,"model":route.model}),
    )
    .await;
    state.remove_cancellation(request_id).await;
    state.metrics().llm_active.fetch_sub(1, Ordering::Relaxed);
}

fn adapter_for(
    state: &AppState,
    route: &RouteSnapshot,
) -> Result<Arc<dyn LlmAdapter>, ProviderError> {
    let config = state.config();
    let client = state.http().clone();
    match route.provider.as_str() {
        "gemini" => Ok(Arc::new(GeminiClient::new(
            client,
            config
                .gemini_api_key
                .clone()
                .ok_or(ProviderError::Unavailable)?,
            config.gemini_llm_url.clone(),
            route.model.clone(),
        ))),
        "openai" => Ok(Arc::new(OpenAiClient::new(
            client,
            config
                .openai_api_key
                .clone()
                .ok_or(ProviderError::Unavailable)?,
            config.openai_llm_url.clone(),
            route.model.clone(),
        ))),
        "anthropic" => Ok(Arc::new(AnthropicClient::new(
            client,
            config
                .anthropic_api_key
                .clone()
                .ok_or(ProviderError::Unavailable)?,
            config.anthropic_llm_url.clone(),
            route.model.clone(),
        ))),
        "groq" => Ok(Arc::new(GroqClient::new(
            client,
            config
                .groq_api_key
                .clone()
                .ok_or(ProviderError::Unavailable)?,
            config.groq_llm_url.clone(),
            route.model.clone(),
        ))),
        _ => Err(ProviderError::Unavailable),
    }
}

fn provider_error_code(error: ProviderError) -> &'static str {
    match error {
        ProviderError::Unavailable => "PROVIDER_UNAVAILABLE",
        ProviderError::RateLimited => "RATE_LIMITED",
        ProviderError::Rejected => "PROVIDER_REJECTED",
        ProviderError::Protocol => "PROVIDER_PROTOCOL_ERROR",
    }
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
    sender.send(encoded_event(event, payload)).await.is_ok()
}

async fn send_event_cancellable(
    sender: &mpsc::Sender<Result<Bytes, Infallible>>,
    event: &str,
    payload: serde_json::Value,
    cancellation: &CancellationToken,
    shutdown: &CancellationToken,
) -> bool {
    tokio::select! {
        biased;
        _ = cancellation.cancelled() => false,
        _ = shutdown.cancelled() => false,
        result = sender.send(encoded_event(event, payload)) => result.is_ok(),
    }
}

fn encoded_event(event: &str, payload: serde_json::Value) -> Result<Bytes, Infallible> {
    Ok(Bytes::from(format!("event: {event}\ndata: {payload}\n\n")))
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

fn settled_usage(
    provider_usage: Option<Usage>,
    completed: bool,
    estimated_input: i64,
    output_ascii_chars: i64,
    output_non_ascii_chars: i64,
) -> Usage {
    let estimated_output = (output_ascii_chars + 3) / 4 + output_non_ascii_chars;
    let mut usage = provider_usage
        .filter(valid_provider_usage)
        .unwrap_or_else(|| Usage {
            input_tokens: estimated_input,
            output_tokens: estimated_output,
            reasoning_tokens: 0,
            total_tokens: estimated_input + estimated_output,
        });
    if !completed {
        usage.input_tokens = usage.input_tokens.max(estimated_input);
        usage.output_tokens = usage.output_tokens.max(estimated_output);
        usage.total_tokens = usage
            .total_tokens
            .max(usage.input_tokens + usage.output_tokens + usage.reasoning_tokens);
    }
    usage
}

fn provider_usage_status(completed: bool, usage: Option<&Usage>) -> &'static str {
    if completed && usage.is_some_and(valid_provider_usage) {
        "FINAL"
    } else {
        "ESTIMATED"
    }
}

fn billable_units(
    usage: &Usage,
    usage_status: &str,
    finish_reason: &str,
    estimated_input: i64,
    max_output_tokens: i64,
) -> i64 {
    let reported = usage
        .total_tokens
        .max(usage.input_tokens + usage.output_tokens + usage.reasoning_tokens);
    if usage_status == "ESTIMATED" && finish_reason == "length" {
        reported.max(estimated_input.saturating_add(max_output_tokens))
    } else {
        reported
    }
}

fn valid_provider_usage(usage: &Usage) -> bool {
    usage.input_tokens > 0
        || usage.output_tokens > 0
        || usage.reasoning_tokens > 0
        || usage.total_tokens > 0
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
    use super::{
        billable_units, estimate_tokens, provider_usage_status, send_event_cancellable,
        settled_usage, tail,
    };
    use crate::providers::llm::Usage;
    use serde_json::json;
    use tokio::sync::mpsc;
    use tokio_util::sync::CancellationToken;

    #[test]
    fn token_estimate_is_conservative_for_cjk_and_tail_is_unicode_safe() {
        assert_eq!(estimate_tokens("面试问题"), 4);
        assert_eq!(tail("甲乙丙丁", 2), "丙丁");
    }

    #[test]
    fn anthropic_partial_usage_then_eof_keeps_local_estimate_floor() {
        let usage = settled_usage(
            Some(Usage {
                input_tokens: 1,
                output_tokens: 1,
                reasoning_tokens: 0,
                total_tokens: 2,
            }),
            false,
            10,
            20,
            0,
        );
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 5);
        assert_eq!(usage.total_tokens, 15);
    }

    #[test]
    fn completed_stream_without_usage_uses_conservative_estimate() {
        let usage = settled_usage(Some(Usage::default()), true, 10, 20, 0);
        assert_eq!(usage.input_tokens, 10);
        assert_eq!(usage.output_tokens, 5);
        assert_eq!(usage.total_tokens, 15);
        assert_eq!(provider_usage_status(true, None), "ESTIMATED");
        assert_eq!(
            provider_usage_status(true, Some(&Usage::default())),
            "ESTIMATED"
        );
    }

    #[test]
    fn missing_usage_estimate_is_conservative_for_cjk_output() {
        let usage = settled_usage(None, false, 1, 0, 4);
        assert_eq!(usage.output_tokens, 4);
        assert_eq!(usage.total_tokens, 5);
    }

    #[test]
    fn truncated_stream_without_usage_charges_the_reserved_output_budget() {
        let usage = settled_usage(None, true, 10, 4, 0);
        assert_eq!(
            billable_units(&usage, "ESTIMATED", "length", 10, 2_400),
            2_410
        );
    }

    #[tokio::test]
    async fn full_client_queue_does_not_block_cancellation() {
        let (sender, _receiver) = mpsc::channel(1);
        sender
            .try_send(Ok(bytes::Bytes::from_static(b"full")))
            .unwrap();
        let cancellation = CancellationToken::new();
        let task_cancellation = cancellation.clone();
        let task = tokio::spawn(async move {
            send_event_cancellable(
                &sender,
                "answer.delta",
                json!({"delta":"blocked"}),
                &task_cancellation,
                &CancellationToken::new(),
            )
            .await
        });
        tokio::task::yield_now().await;
        cancellation.cancel();
        assert!(
            !tokio::time::timeout(std::time::Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap()
        );
    }
}
