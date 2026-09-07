use serde_json::{json, Value};

use super::llm::{
    checked_response, json_data, number, optional_number, provider_error, sse_stream, LlmAdapter,
    LlmEvent, LlmFuture, LlmInput, ProviderError, Usage,
};

#[derive(Clone)]
pub struct GeminiClient {
    client: reqwest::Client,
    api_key: String,
    endpoint: String,
    model: String,
}

impl GeminiClient {
    pub fn new(client: reqwest::Client, api_key: String, endpoint: String, model: String) -> Self {
        Self {
            client,
            api_key,
            endpoint,
            model,
        }
    }
}

impl LlmAdapter for GeminiClient {
    fn stream(&self, input: LlmInput) -> LlmFuture {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let endpoint = self.endpoint.clone();
        let model = self.model.clone();
        Box::pin(async move {
            let body = request_body(&model, input);
            let response = checked_response(
                client
                    .post(endpoint)
                    .query(&[("alt", "sse")])
                    .header("x-goog-api-key", api_key)
                    .json(&body),
            )
            .await?;
            Ok(sse_stream(response, parse_event))
        })
    }
}

fn request_body(model: &str, input: LlmInput) -> Value {
    let mut generation_config = json!({"max_output_tokens": input.max_output_tokens});
    if input.json_response {
        generation_config["thinking_level"] = json!("low");
    }
    let mut body = json!({
        "model": model,
        "input": format!(
            "System instructions:\n{}\n\nUser input:\n{}",
            input.system, input.prompt
        ),
        "stream": true,
        "store": false,
        "generation_config": generation_config
    });
    if input.json_response {
        body["response_format"] = json!({"type": "text", "mime_type": "application/json"});
    }
    body
}

fn parse_event(raw: &str) -> Result<Vec<LlmEvent>, ProviderError> {
    let Some(value) = json_data(raw)? else {
        return Ok(Vec::new());
    };
    let event_type = value
        .get("event_type")
        .or_else(|| value.get("type"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    match event_type {
        "interaction.created" => Ok(value
            .pointer("/interaction/id")
            .and_then(Value::as_str)
            .map(|id| vec![LlmEvent::Created(id.to_owned())])
            .unwrap_or_default()),
        "step.delta" if value.pointer("/delta/type").and_then(Value::as_str) == Some("text") => {
            Ok(value
                .pointer("/delta/text")
                .and_then(Value::as_str)
                .filter(|text| !text.is_empty())
                .map(|text| vec![LlmEvent::Delta(text.to_owned())])
                .unwrap_or_default())
        }
        "interaction.completed" => {
            let truncated =
                value.pointer("/interaction/status").and_then(Value::as_str) == Some("incomplete");
            let mut events = Vec::new();
            if let Some(usage) = value
                .pointer("/interaction/usage")
                .filter(|usage| usage.is_object())
            {
                let input = number(usage, &["total_input_tokens", "prompt_tokens"]);
                let output = number(usage, &["total_output_tokens", "completion_tokens"]);
                let reasoning = number(usage, &["total_thought_tokens", "reasoning_tokens"]);
                let total =
                    optional_number(usage, &["total_tokens"]).unwrap_or(input + output + reasoning);
                if input > 0 || output > 0 || reasoning > 0 || total > 0 {
                    events.push(LlmEvent::Usage(Usage {
                        input_tokens: input,
                        output_tokens: output,
                        reasoning_tokens: reasoning,
                        total_tokens: total,
                    }));
                }
            }
            events.push(LlmEvent::Completed {
                finish_reason: if truncated { "length" } else { "stop" }.to_owned(),
                truncated,
            });
            Ok(events)
        }
        "interaction.failed" | "error" => Err(provider_error(&value)),
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_event, request_body};
    use crate::providers::llm::{LlmEvent, LlmInput, Usage};

    #[test]
    fn decodes_text_and_completed_usage_without_thought_leakage() {
        assert_eq!(
            parse_event("data: {\"event_type\":\"step.delta\",\"delta\":{\"type\":\"text\",\"text\":\"hello\"}}")
                .unwrap(),
            vec![LlmEvent::Delta("hello".into())]
        );
        assert_eq!(
            parse_event("data: {\"event_type\":\"interaction.completed\",\"interaction\":{\"status\":\"incomplete\",\"usage\":{\"total_input_tokens\":3,\"total_output_tokens\":2,\"total_thought_tokens\":1,\"total_tokens\":6}}}")
                .unwrap(),
            vec![
                LlmEvent::Usage(Usage {
                    input_tokens: 3,
                    output_tokens: 2,
                    reasoning_tokens: 1,
                    total_tokens: 6,
                }),
                LlmEvent::Completed {
                    finish_reason: "length".into(),
                    truncated: true,
                },
            ]
        );
        assert_eq!(
            parse_event("data: {\"event_type\":\"interaction.completed\",\"interaction\":{\"status\":\"completed\",\"usage\":null}}")
                .unwrap(),
            vec![LlmEvent::Completed {
                finish_reason: "stop".into(),
                truncated: false,
            }]
        );
    }

    #[test]
    fn interactions_requests_disable_storage() {
        let body = request_body(
            "gemini-test",
            LlmInput {
                system: "system".into(),
                prompt: "prompt".into(),
                json_response: true,
                max_output_tokens: 128,
            },
        );
        assert_eq!(body["store"], false);
        assert_eq!(
            body.pointer("/response_format/mime_type").unwrap(),
            "application/json"
        );
        assert_eq!(body.pointer("/generation_config/thinking_level").unwrap(), "low");
        let answer = request_body(
            "gemini-test",
            LlmInput {
                system: "system".into(),
                prompt: "prompt".into(),
                json_response: false,
                max_output_tokens: 128,
            },
        );
        assert_eq!(answer.pointer("/generation_config/thinking_level"), None);
    }
}
