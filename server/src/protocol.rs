use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct AudioFormat {
    pub encoding: String,
    pub sample_rate: u32,
    pub channels: u8,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct CreateSttSession {
    pub client_request_id: String,
    pub interview_id: Option<String>,
    pub source: String,
    pub language: String,
    pub audio: AudioFormat,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CreateSttSessionResponse {
    pub session_id: String,
    pub protocol_version: u8,
    pub ws_url: String,
    pub ws_ticket: String,
    pub ticket_expires_at: String,
    pub reserved_ms: i64,
}

#[derive(Debug, Deserialize)]
pub struct LlmAnswerRequest {
    pub request_id: String,
    pub request_type: String,
    pub question: Option<String>,
    #[serde(default)]
    pub context: serde_json::Value,
    pub continuation_text: Option<String>,
    pub system: Option<String>,
    pub prompt: Option<String>,
    pub response_format: Option<String>,
    pub max_output_tokens: Option<i64>,
}

#[derive(Debug, Serialize)]
pub struct EntitlementResponse {
    pub account_id: String,
    pub eligible: bool,
    pub status: String,
    pub balances: BTreeMap<String, i64>,
    pub hosted_stt_enabled: bool,
    pub hosted_llm_enabled: bool,
    pub payments_enabled: bool,
}

#[derive(Debug, Deserialize)]
pub struct AdjustmentRequest {
    pub metric: String,
    pub units: i64,
    pub reason: String,
    pub valid_until: Option<String>,
}
