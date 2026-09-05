use serde_json::{json, Value};

use super::llm::{
    checked_response, json_data, optional_number, provider_error, sse_stream, LlmAdapter, LlmEvent,
    LlmFuture, LlmInput, ProviderError, Usage,
};

#[derive(Clone)]
pub struct AnthropicClient {
    client: reqwest::Client,
    api_key: String,
    endpoint: String,
    model: String,
}

impl AnthropicClient {
    pub fn new(client: reqwest::Client, api_key: String, endpoint: String, model: String) -> Self {
        Self {
            client,
            api_key,
            endpoint,
            model,
        }
    }
}

impl LlmAdapter for AnthropicClient {
    fn stream(&self, input: LlmInput) -> LlmFuture {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let endpoint = self.endpoint.clone();
        let model = self.model.clone();
        Box::pin(async move {
            let mut body = json!({
                "model": model,
                "max_tokens": input.max_output_tokens,
                "system": input.system,
                "messages": [{"role": "user", "content": input.prompt}],
                "stream": true,
            });
            if input.json_response {
                body["tools"] = json!([{
                    "name": "return_json",
                    "description": "Return the final response as one JSON object.",
                    "input_schema": {"type": "object", "additionalProperties": true}
                }]);
                body["tool_choice"] = json!({"type": "tool", "name": "return_json"});
            }
            let response = checked_response(
                client
                    .post(endpoint)
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body),
            )
            .await?;
            let mut parser = AnthropicParser::default();
            Ok(sse_stream(response, move |raw| parser.parse(raw)))
        })
    }
}

#[derive(Default)]
struct AnthropicParser {
    usage: Usage,
    has_input_usage: bool,
    has_output_usage: bool,
    finish_reason: Option<String>,
}

impl AnthropicParser {
    fn parse(&mut self, raw: &str) -> Result<Vec<LlmEvent>, ProviderError> {
        let Some(value) = json_data(raw)? else {
            return Ok(Vec::new());
        };
        match value
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default()
        {
            "message_start" => {
                let message = value.get("message").unwrap_or(&Value::Null);
                let usage = message.get("usage").unwrap_or(&Value::Null);
                if let Some(input) = optional_number(usage, &["input_tokens"]) {
                    self.usage.input_tokens = input;
                    self.has_input_usage = true;
                }
                self.refresh_total();
                Ok(message
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|id| vec![LlmEvent::Created(id.to_owned())])
                    .unwrap_or_default())
            }
            "content_block_delta" => {
                let delta = value.get("delta").unwrap_or(&Value::Null);
                let text = match delta.get("type").and_then(Value::as_str) {
                    Some("text_delta") => delta.get("text").and_then(Value::as_str),
                    Some("input_json_delta") => delta.get("partial_json").and_then(Value::as_str),
                    _ => None,
                };
                Ok(text
                    .filter(|text| !text.is_empty())
                    .map(|text| vec![LlmEvent::Delta(text.to_owned())])
                    .unwrap_or_default())
            }
            "message_delta" => {
                if let Some(reason) = value.pointer("/delta/stop_reason").and_then(Value::as_str) {
                    self.finish_reason = Some(reason.to_owned());
                }
                let usage = value.get("usage").unwrap_or(&Value::Null);
                if let Some(output) = optional_number(usage, &["output_tokens"]) {
                    self.usage.output_tokens = output;
                    self.has_output_usage = true;
                }
                self.refresh_total();
                if self.has_input_usage && self.has_output_usage {
                    Ok(vec![LlmEvent::Usage(self.usage.clone())])
                } else {
                    Ok(Vec::new())
                }
            }
            "message_stop" => {
                let reason = self
                    .finish_reason
                    .as_deref()
                    .ok_or(ProviderError::Protocol)?;
                let truncated = reason == "max_tokens";
                Ok(vec![LlmEvent::Completed {
                    finish_reason: if truncated { "length" } else { "stop" }.to_owned(),
                    truncated,
                }])
            }
            "error" => Err(provider_error(&value)),
            _ => Ok(Vec::new()),
        }
    }

    fn refresh_total(&mut self) {
        self.usage.total_tokens =
            self.usage.input_tokens + self.usage.output_tokens + self.usage.reasoning_tokens;
    }
}

#[cfg(test)]
mod tests {
    use super::AnthropicParser;
    use crate::providers::llm::{LlmEvent, Usage};

    #[test]
    fn combines_anthropic_usage_and_streamed_tool_json() {
        let mut parser = AnthropicParser::default();
        assert_eq!(
            parser.parse("data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"usage\":{\"input_tokens\":5,\"output_tokens\":1}}}").unwrap(),
            vec![LlmEvent::Created("msg_1".into())]
        );
        assert_eq!(
            parser.parse("data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"ok\\\":true}\"}}").unwrap(),
            vec![LlmEvent::Delta("{\"ok\":true}".into())]
        );
        assert_eq!(
            parser.parse("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"},\"usage\":{\"output_tokens\":3}}").unwrap(),
            vec![LlmEvent::Usage(Usage {
                input_tokens: 5,
                output_tokens: 3,
                reasoning_tokens: 0,
                total_tokens: 8,
            })]
        );
        assert_eq!(
            parser.parse("data: {\"type\":\"message_stop\"}").unwrap(),
            vec![LlmEvent::Completed {
                finish_reason: "length".into(),
                truncated: true,
            }]
        );
    }

    #[test]
    fn missing_anthropic_usage_does_not_emit_zero_usage() {
        let mut parser = AnthropicParser::default();
        assert_eq!(
            parser
                .parse("data: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_2\",\"usage\":null}}")
                .unwrap(),
            vec![LlmEvent::Created("msg_2".into())]
        );
        assert!(parser
            .parse("data: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":null}")
            .unwrap()
            .is_empty());
    }
}
