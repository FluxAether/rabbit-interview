use serde_json::{json, Value};

use super::llm::{
    checked_response, json_data, number, optional_number, provider_error, sse_stream, LlmAdapter,
    LlmEvent, LlmFuture, LlmInput, ProviderError, Usage,
};

#[derive(Clone)]
pub struct OpenAiClient {
    client: reqwest::Client,
    api_key: String,
    endpoint: String,
    model: String,
}

impl OpenAiClient {
    pub fn new(client: reqwest::Client, api_key: String, endpoint: String, model: String) -> Self {
        Self {
            client,
            api_key,
            endpoint,
            model,
        }
    }
}

impl LlmAdapter for OpenAiClient {
    fn stream(&self, input: LlmInput) -> LlmFuture {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let endpoint = self.endpoint.clone();
        let model = self.model.clone();
        Box::pin(async move {
            let body = request_body(&model, input);
            let response =
                checked_response(client.post(endpoint).bearer_auth(api_key).json(&body)).await?;
            Ok(sse_stream(response, parse_event))
        })
    }
}

fn request_body(model: &str, input: LlmInput) -> Value {
    let mut body = json!({
        "model": model,
        "instructions": input.system,
        "input": input.prompt,
        "stream": true,
        "store": false,
        "max_output_tokens": input.max_output_tokens,
    });
    if input.json_response {
        body["text"] = json!({"format": {"type": "json_object"}});
    }
    body
}

fn parse_event(raw: &str) -> Result<Vec<LlmEvent>, ProviderError> {
    let Some(value) = json_data(raw)? else {
        return Ok(Vec::new());
    };
    match value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "response.created" => Ok(value
            .pointer("/response/id")
            .and_then(Value::as_str)
            .map(|id| vec![LlmEvent::Created(id.to_owned())])
            .unwrap_or_default()),
        "response.output_text.delta" | "response.refusal.delta" => Ok(value
            .get("delta")
            .and_then(Value::as_str)
            .filter(|delta| !delta.is_empty())
            .map(|delta| vec![LlmEvent::Delta(delta.to_owned())])
            .unwrap_or_default()),
        "response.completed" | "response.incomplete" => {
            let response = value.get("response").unwrap_or(&Value::Null);
            let incomplete_reason = response
                .pointer("/incomplete_details/reason")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let truncated = matches!(incomplete_reason, "max_tokens" | "max_output_tokens");
            let mut events = Vec::new();
            if let Some(usage) = response.get("usage").filter(|usage| usage.is_object()) {
                let input = number(usage, &["input_tokens"]);
                let reported_output = number(usage, &["output_tokens"]);
                let reasoning = usage
                    .pointer("/output_tokens_details/reasoning_tokens")
                    .and_then(Value::as_i64)
                    .unwrap_or(0)
                    .max(0);
                let output = reported_output.saturating_sub(reasoning);
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
                finish_reason: if truncated {
                    "length"
                } else if value.get("type").and_then(Value::as_str) == Some("response.completed") {
                    "stop"
                } else {
                    "incomplete"
                }
                .to_owned(),
                truncated,
            });
            Ok(events)
        }
        "response.failed" | "error" => Err(provider_error(&value)),
        _ => Ok(Vec::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_event, request_body};
    use crate::providers::llm::{LlmEvent, LlmInput, Usage};

    #[test]
    fn decodes_openai_delta_and_incomplete_usage() {
        assert_eq!(
            parse_event("data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}")
                .unwrap(),
            vec![LlmEvent::Delta("hi".into())]
        );
        assert_eq!(
            parse_event("data: {\"type\":\"response.refusal.delta\",\"delta\":\"cannot comply\"}")
                .unwrap(),
            vec![LlmEvent::Delta("cannot comply".into())]
        );
        assert_eq!(
            parse_event("data: {\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reason\":\"max_tokens\"},\"usage\":{\"input_tokens\":4,\"output_tokens\":3,\"total_tokens\":7,\"output_tokens_details\":{\"reasoning_tokens\":2}}}}")
                .unwrap(),
            vec![
                LlmEvent::Usage(Usage {
                    input_tokens: 4,
                    output_tokens: 1,
                    reasoning_tokens: 2,
                    total_tokens: 7,
                }),
                LlmEvent::Completed {
                    finish_reason: "length".into(),
                    truncated: true,
                },
            ]
        );
        assert_eq!(
            parse_event("data: {\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"usage\":null}}")
                .unwrap(),
            vec![LlmEvent::Completed {
                finish_reason: "length".into(),
                truncated: true,
            }]
        );
    }

    #[test]
    fn responses_requests_disable_storage_and_enable_json_mode() {
        let body = request_body(
            "gpt-test",
            LlmInput {
                system: "system".into(),
                prompt: "prompt".into(),
                json_response: true,
                max_output_tokens: 128,
            },
        );
        assert_eq!(body["store"], false);
        assert_eq!(body.pointer("/text/format/type").unwrap(), "json_object");
    }
}
