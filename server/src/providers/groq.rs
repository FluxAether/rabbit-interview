use serde_json::{json, Value};

use super::llm::{
    checked_response, data, number, optional_number, provider_error, sse_stream, LlmAdapter,
    LlmEvent, LlmFuture, LlmInput, ProviderError, Usage,
};

#[derive(Clone)]
pub struct GroqClient {
    client: reqwest::Client,
    api_key: String,
    endpoint: String,
    model: String,
}

impl GroqClient {
    pub fn new(client: reqwest::Client, api_key: String, endpoint: String, model: String) -> Self {
        Self {
            client,
            api_key,
            endpoint,
            model,
        }
    }
}

impl LlmAdapter for GroqClient {
    fn stream(&self, input: LlmInput) -> LlmFuture {
        let client = self.client.clone();
        let api_key = self.api_key.clone();
        let endpoint = self.endpoint.clone();
        let model = self.model.clone();
        Box::pin(async move {
            let mut body = json!({
                "model": model,
                "messages": [
                    {"role": "system", "content": input.system},
                    {"role": "user", "content": input.prompt}
                ],
                "stream": true,
                "stream_options": {"include_usage": true},
                "max_completion_tokens": input.max_output_tokens,
            });
            if input.json_response {
                body["response_format"] = json!({"type": "json_object"});
            }
            let response =
                checked_response(client.post(endpoint).bearer_auth(api_key).json(&body)).await?;
            let mut parser = GroqParser::default();
            Ok(sse_stream(response, move |raw| parser.parse(raw)))
        })
    }
}

#[derive(Default)]
struct GroqParser {
    created: bool,
    finish_reason: Option<String>,
}

impl GroqParser {
    fn parse(&mut self, raw: &str) -> Result<Vec<LlmEvent>, ProviderError> {
        let Some(data) = data(raw)? else {
            return Ok(Vec::new());
        };
        if data == "[DONE]" {
            let reason = self
                .finish_reason
                .as_deref()
                .ok_or(ProviderError::Protocol)?;
            let truncated = reason == "length";
            return Ok(vec![LlmEvent::Completed {
                finish_reason: if truncated { "length" } else { "stop" }.to_owned(),
                truncated,
            }]);
        }
        let value: Value = serde_json::from_str(&data).map_err(|_| ProviderError::Protocol)?;
        if value.get("error").is_some() {
            return Err(provider_error(&value));
        }
        let mut events = Vec::new();
        if !self.created {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                self.created = true;
                events.push(LlmEvent::Created(id.to_owned()));
            }
        }
        if let Some(choice) = value
            .get("choices")
            .and_then(Value::as_array)
            .and_then(|choices| choices.first())
        {
            if let Some(delta) = choice.pointer("/delta/content").and_then(Value::as_str) {
                if !delta.is_empty() {
                    events.push(LlmEvent::Delta(delta.to_owned()));
                }
            }
            if let Some(reason) = choice.get("finish_reason").and_then(Value::as_str) {
                self.finish_reason = Some(reason.to_owned());
            }
        }
        if let Some(usage) = value.get("usage").filter(|usage| usage.is_object()) {
            let input = number(usage, &["prompt_tokens"]);
            let reported_output = number(usage, &["completion_tokens"]);
            let reasoning = usage
                .pointer("/completion_tokens_details/reasoning_tokens")
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
        Ok(events)
    }
}

#[cfg(test)]
mod tests {
    use super::GroqParser;
    use crate::providers::llm::{LlmEvent, Usage};

    #[test]
    fn waits_for_done_after_groq_finish_and_usage_chunks() {
        let mut parser = GroqParser::default();
        assert_eq!(
            parser.parse("data: {\"id\":\"chat_1\",\"choices\":[{\"delta\":{\"content\":\"hi\"},\"finish_reason\":null}]}").unwrap(),
            vec![
                LlmEvent::Created("chat_1".into()),
                LlmEvent::Delta("hi".into()),
            ]
        );
        assert!(parser
            .parse(
                "data: {\"id\":\"chat_1\",\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}"
            )
            .unwrap()
            .is_empty());
        assert_eq!(
            parser.parse("data: {\"choices\":[],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":4,\"completion_tokens_details\":{\"reasoning_tokens\":2},\"total_tokens\":8}}").unwrap(),
            vec![LlmEvent::Usage(Usage {
                input_tokens: 4,
                output_tokens: 2,
                reasoning_tokens: 2,
                total_tokens: 8,
            })]
        );
        assert!(parser
            .parse("data: {\"choices\":[],\"usage\":null}")
            .unwrap()
            .is_empty());
        assert_eq!(
            parser.parse("data: [DONE]").unwrap(),
            vec![LlmEvent::Completed {
                finish_reason: "stop".into(),
                truncated: false,
            }]
        );
    }
}
