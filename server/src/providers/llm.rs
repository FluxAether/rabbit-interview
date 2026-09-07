use std::{collections::VecDeque, future::Future, pin::Pin};

use bytes::Bytes;
use futures_util::{stream, Stream, StreamExt};
use serde_json::Value;

pub type LlmFuture = Pin<Box<dyn Future<Output = Result<LlmEventStream, ProviderError>> + Send>>;
pub type LlmEventStream = Pin<Box<dyn Stream<Item = Result<LlmEvent, ProviderError>> + Send>>;

#[derive(Clone, Debug)]
pub struct LlmInput {
    pub system: String,
    pub prompt: String,
    pub json_response: bool,
    pub max_output_tokens: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LlmEvent {
    Created(String),
    Delta(String),
    Usage(Usage),
    Completed {
        finish_reason: String,
        truncated: bool,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderError {
    Unavailable,
    RateLimited,
    Rejected,
    Protocol,
}

pub trait LlmAdapter: Send + Sync {
    fn stream(&self, input: LlmInput) -> LlmFuture;
}

pub(crate) async fn checked_response(
    request: reqwest::RequestBuilder,
) -> Result<reqwest::Response, ProviderError> {
    let started = std::time::Instant::now();
    if let Some(cloned) = request.try_clone() {
        if let Ok(built) = cloned.build() {
            tracing::info!(
                method = %built.method(),
                url = %crate::access::redact_uri(built.url().as_str()),
                body = %crate::access::preview_body(
                    built.body().and_then(|body| body.as_bytes()).unwrap_or(&[]),
                    Some("application/json"),
                ),
                "llm provider request"
            );
        }
    }
    let response = match request.send().await {
        Ok(response) => response,
        Err(_) => {
            tracing::warn!(
                duration_ms = started.elapsed().as_millis() as u64,
                "llm provider request failed"
            );
            return Err(ProviderError::Unavailable);
        }
    };
    let status = response.status().as_u16();
    let duration_ms = started.elapsed().as_millis() as u64;
    if (200..=299).contains(&status) {
        tracing::info!(status, duration_ms, "llm provider response");
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    tracing::warn!(
        status,
        duration_ms,
        body = %crate::access::truncate(&body),
        "llm provider response"
    );
    Err(match status {
        429 => ProviderError::RateLimited,
        500..=599 => ProviderError::Unavailable,
        _ => ProviderError::Rejected,
    })
}

pub(crate) fn sse_stream<P>(response: reqwest::Response, parser: P) -> LlmEventStream
where
    P: FnMut(&str) -> Result<Vec<LlmEvent>, ProviderError> + Send + 'static,
{
    struct State<S, P> {
        chunks: S,
        decoder: SseDecoder,
        parser: P,
        pending: VecDeque<Result<LlmEvent, ProviderError>>,
        finished: bool,
    }

    let state = State {
        chunks: Box::pin(response.bytes_stream()),
        decoder: SseDecoder::default(),
        parser,
        pending: VecDeque::new(),
        finished: false,
    };

    Box::pin(stream::unfold(state, |mut state| async move {
        loop {
            if let Some(event) = state.pending.pop_front() {
                return Some((event, state));
            }
            if state.finished {
                return None;
            }
            match state.chunks.next().await {
                Some(Ok(chunk)) => match state.decoder.push(chunk) {
                    Ok(raw_events) => {
                        if enqueue(&mut state.pending, &mut state.parser, raw_events).is_err() {
                            state.finished = true;
                        }
                    }
                    Err(error) => {
                        state.pending.push_back(Err(error));
                        state.finished = true;
                    }
                },
                Some(Err(_)) => {
                    state.pending.push_back(Err(ProviderError::Unavailable));
                    state.finished = true;
                }
                None => {
                    match state.decoder.finish() {
                        Ok(raw_events) => {
                            let _ = enqueue(&mut state.pending, &mut state.parser, raw_events);
                        }
                        Err(error) => state.pending.push_back(Err(error)),
                    }
                    state.finished = true;
                }
            }
        }
    }))
}

fn enqueue<P>(
    pending: &mut VecDeque<Result<LlmEvent, ProviderError>>,
    parser: &mut P,
    raw_events: Vec<String>,
) -> Result<(), ProviderError>
where
    P: FnMut(&str) -> Result<Vec<LlmEvent>, ProviderError>,
{
    for raw in raw_events {
        match parser(&raw) {
            Ok(events) => pending.extend(events.into_iter().map(Ok)),
            Err(error) => {
                pending.push_back(Err(error));
                return Err(error);
            }
        }
    }
    Ok(())
}

const MAX_SSE_EVENT_BYTES: usize = 1024 * 1024;

#[derive(Default)]
struct SseDecoder {
    buffer: Vec<u8>,
}

impl SseDecoder {
    fn push(&mut self, chunk: Bytes) -> Result<Vec<String>, ProviderError> {
        self.buffer.extend_from_slice(&chunk);
        if self.buffer.len() > MAX_SSE_EVENT_BYTES && find_event_end(&self.buffer).is_none() {
            return Err(ProviderError::Protocol);
        }
        self.drain(false)
    }

    fn finish(&mut self) -> Result<Vec<String>, ProviderError> {
        self.drain(true)
    }

    fn drain(&mut self, finish: bool) -> Result<Vec<String>, ProviderError> {
        let mut events = Vec::new();
        while let Some((index, delimiter_len)) = find_event_end(&self.buffer) {
            if index > MAX_SSE_EVENT_BYTES {
                return Err(ProviderError::Protocol);
            }
            let raw = self.buffer[..index].to_vec();
            self.buffer.drain(..index + delimiter_len);
            events.push(
                String::from_utf8(raw)
                    .map_err(|_| ProviderError::Protocol)?
                    .replace("\r\n", "\n"),
            );
        }
        if self.buffer.len() > MAX_SSE_EVENT_BYTES {
            return Err(ProviderError::Protocol);
        }
        if finish && !self.buffer.iter().all(u8::is_ascii_whitespace) {
            let raw = std::mem::take(&mut self.buffer);
            events.push(String::from_utf8(raw).map_err(|_| ProviderError::Protocol)?);
        }
        Ok(events)
    }
}

fn find_event_end(bytes: &[u8]) -> Option<(usize, usize)> {
    let lf = bytes
        .windows(2)
        .position(|window| window == b"\n\n")
        .map(|index| (index, 2));
    let crlf = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4));
    match (lf, crlf) {
        (Some(left), Some(right)) => Some(if left.0 < right.0 { left } else { right }),
        (Some(value), None) | (None, Some(value)) => Some(value),
        (None, None) => None,
    }
}

pub(crate) fn data(raw: &str) -> Result<Option<String>, ProviderError> {
    let data = raw
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() {
        Ok(None)
    } else {
        Ok(Some(data))
    }
}

pub(crate) fn json_data(raw: &str) -> Result<Option<Value>, ProviderError> {
    let Some(data) = data(raw)? else {
        return Ok(None);
    };
    if data == "[DONE]" {
        return Ok(None);
    }
    serde_json::from_str(&data)
        .map(Some)
        .map_err(|_| ProviderError::Protocol)
}

pub(crate) fn number(value: &Value, names: &[&str]) -> i64 {
    optional_number(value, names).unwrap_or(0)
}

pub(crate) fn optional_number(value: &Value, names: &[&str]) -> Option<i64> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_i64))
        .map(|value| value.max(0))
}

pub(crate) fn provider_error(value: &Value) -> ProviderError {
    let code = value
        .pointer("/error/code")
        .or_else(|| value.pointer("/error/type"))
        .or_else(|| value.pointer("/response/error/code"))
        .or_else(|| value.get("code"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if code.contains("rate") || code.contains("quota") {
        ProviderError::RateLimited
    } else if code.contains("server") || code.contains("overloaded") || code.contains("unavailable")
    {
        ProviderError::Unavailable
    } else {
        ProviderError::Rejected
    }
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;
    use serde_json::json;

    use super::{provider_error, ProviderError, SseDecoder};

    #[test]
    fn sse_decoder_preserves_split_utf8_and_crlf_events() {
        let mut decoder = SseDecoder::default();
        assert!(decoder
            .push(Bytes::from_static(&[
                b'd', b'a', b't', b'a', b':', b' ', 0xe9
            ]))
            .unwrap()
            .is_empty());
        assert_eq!(
            decoder
                .push(Bytes::from_static(&[
                    0x9d, 0xa2, b'\r', b'\n', b'\r', b'\n'
                ]))
                .unwrap(),
            vec!["data: 面"]
        );
        assert_eq!(
            decoder
                .push(Bytes::from_static(b"data: first\r\n\r\ndata: second\n\n"))
                .unwrap(),
            vec!["data: first", "data: second"]
        );
    }

    #[test]
    fn provider_errors_are_classified_without_exposing_messages() {
        assert_eq!(
            provider_error(&json!({"error":{"type":"overloaded_error","message":"secret"}})),
            ProviderError::Unavailable
        );
        assert_eq!(
            provider_error(&json!({"error":{"code":"rate_limit_exceeded"}})),
            ProviderError::RateLimited
        );
    }
}
