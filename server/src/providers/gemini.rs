use bytes::Bytes;
use serde_json::{json, Value};

use crate::error::AppError;

#[derive(Clone)]
pub struct GeminiClient {
    client: reqwest::Client,
    api_key: String,
    model: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Usage {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub total_tokens: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Event {
    Created(String),
    Delta(String),
    Completed(Usage, bool),
    Failed,
}

impl GeminiClient {
    pub fn new(
        client: reqwest::Client,
        api_key: Option<String>,
        model: String,
    ) -> Result<Self, AppError> {
        Ok(Self {
            client,
            api_key: api_key.ok_or(AppError::ProviderUnavailable)?,
            model,
        })
    }

    pub async fn stream(
        &self,
        input: String,
        json_response: bool,
        max_output_tokens: i64,
    ) -> Result<reqwest::Response, AppError> {
        let mut body = json!({
            "model": self.model,
            "input": input,
            "stream": true,
            "generation_config": {"max_output_tokens": max_output_tokens}
        });
        if json_response {
            body["response_format"] = json!({"type": "text", "mime_type": "application/json"});
        }
        let response = self
            .client
            .post("https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse")
            .header("x-goog-api-key", &self.api_key)
            .json(&body)
            .send()
            .await
            .map_err(|_| AppError::ProviderUnavailable)?;
        if !response.status().is_success() {
            return Err(if response.status().is_server_error() {
                AppError::ProviderUnavailable
            } else {
                AppError::ProviderProtocol
            });
        }
        Ok(response)
    }
}

#[derive(Default)]
pub struct SseDecoder {
    buffer: String,
}

impl SseDecoder {
    pub fn push(&mut self, chunk: Bytes) -> Result<Vec<Event>, AppError> {
        self.buffer.push_str(&String::from_utf8_lossy(&chunk));
        self.buffer = self.buffer.replace("\r\n", "\n");
        let mut events = Vec::new();
        while let Some(index) = self.buffer.find("\n\n") {
            let raw = self.buffer[..index].to_owned();
            self.buffer.drain(..index + 2);
            if let Some(event) = parse_event(&raw)? {
                events.push(event);
            }
        }
        Ok(events)
    }

    pub fn finish(&mut self) -> Result<Vec<Event>, AppError> {
        if self.buffer.trim().is_empty() {
            return Ok(Vec::new());
        }
        let raw = std::mem::take(&mut self.buffer);
        Ok(parse_event(&raw)?.into_iter().collect())
    }
}

fn parse_event(raw: &str) -> Result<Option<Event>, AppError> {
    let data = raw
        .lines()
        .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
        .collect::<Vec<_>>()
        .join("\n");
    if data.is_empty() || data == "[DONE]" {
        return Ok(None);
    }
    let value: Value = serde_json::from_str(&data).map_err(|_| AppError::ProviderProtocol)?;
    let event_type = value
        .get("event_type")
        .or_else(|| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "interaction.created" => Ok(value
            .pointer("/interaction/id")
            .and_then(Value::as_str)
            .map(|id| Event::Created(id.to_owned()))),
        "step.delta" if value.pointer("/delta/type").and_then(Value::as_str) == Some("text") => {
            Ok(value
                .pointer("/delta/text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(|text| Event::Delta(text.to_owned())))
        }
        "interaction.completed" => {
            let truncated =
                value.pointer("/interaction/status").and_then(Value::as_str) == Some("incomplete");
            let usage = value.pointer("/interaction/usage").unwrap_or(&Value::Null);
            let input = number(usage, &["total_input_tokens", "prompt_tokens"]);
            let output = number(usage, &["total_output_tokens", "completion_tokens"]);
            let reasoning = number(usage, &["total_thought_tokens", "reasoning_tokens"]);
            let total = number(usage, &["total_tokens"]).max(input + output + reasoning);
            Ok(Some(Event::Completed(
                Usage {
                    input_tokens: input,
                    output_tokens: output,
                    reasoning_tokens: reasoning,
                    total_tokens: total,
                },
                truncated,
            )))
        }
        "interaction.failed" | "error" => Ok(Some(Event::Failed)),
        _ => Ok(None),
    }
}

fn number(value: &Value, names: &[&str]) -> i64 {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_i64))
        .unwrap_or(0)
        .max(0)
}

#[cfg(test)]
mod tests {
    use bytes::Bytes;

    use super::{Event, SseDecoder, Usage};

    #[test]
    fn decodes_split_interaction_stream_without_thought_leakage() {
        let mut decoder = SseDecoder::default();
        assert!(decoder
            .push(Bytes::from_static(
                b"event: step.delta\ndata: {\"event_type\":\"step.delta\",\"delta\":{\"type\":\"te"
            ))
            .unwrap()
            .is_empty());
        let events = decoder.push(Bytes::from_static(b"xt\",\"text\":\"hello\"}}\n\nevent: interaction.completed\ndata: {\"event_type\":\"interaction.completed\",\"interaction\":{\"status\":\"incomplete\",\"usage\":{\"total_input_tokens\":3,\"total_output_tokens\":2,\"total_thought_tokens\":1,\"total_tokens\":6}}}\n\n")).unwrap();
        assert_eq!(
            events,
            vec![
                Event::Delta("hello".into()),
                Event::Completed(
                    Usage {
                        input_tokens: 3,
                        output_tokens: 2,
                        reasoning_tokens: 1,
                        total_tokens: 6
                    },
                    true,
                ),
            ]
        );
    }
}
