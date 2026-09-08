use super::realtime::{RealtimeSttConfig, TranscriptEvent};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;

const GEMINI_LIVE_ENDPOINT: &str = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";
const TRANSCRIBE_MODEL: &str = "gemini-3.5-transcribe-live";
const TRANSLATE_MODEL: &str = "gemini-3.5-live-translate-preview";

pub(super) fn build_request(config: &RealtimeSttConfig) -> Result<Request, String> {
    let api_key = config.api_key.as_deref().filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "No Gemini API key is configured".to_string())?;
    let url = format!("{GEMINI_LIVE_ENDPOINT}?key={api_key}");
    url.into_client_request().map_err(|error| error.to_string())
}

fn target_language(app_language: &str) -> &'static str {
    match app_language {
        "zh-CN" => "zh-Hans",
        "zh-TW" => "zh-Hant",
        _ => "en",
    }
}

pub(super) fn setup_message(config: &RealtimeSttConfig) -> String {
    let model = if config.model.as_deref() == Some(TRANSLATE_MODEL) { TRANSLATE_MODEL } else { TRANSCRIBE_MODEL };
    let mut generation = json!({ "responseModalities": ["TEXT"] });
    if model == TRANSLATE_MODEL {
        generation = json!({
            "responseModalities": ["AUDIO"],
            "translationConfig": {
                "targetLanguageCode": target_language(config.app_language.as_deref().unwrap_or("en-US")),
                "echoTargetLanguage": true,
            },
        });
    }
    let input = if config.language == "multi" {
        json!({})
    } else {
        json!({ "languageCodes": [config.language] })
    };
    json!({
        "setup": {
            "model": format!("models/{model}"),
            "generationConfig": generation,
            "inputAudioTranscription": input,
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "disabled": false,
                    "prefixPaddingMs": 20,
                    "endOfSpeechSensitivity": "END_SENSITIVITY_LOW",
                    "silenceDurationMs": config.utterance_end_ms.unwrap_or(1_500),
                }
            }
        }
    }).to_string()
}

pub(super) fn audio_message(pcm16: &[u8]) -> String {
    json!({
        "realtimeInput": {
            "audio": {
                "data": BASE64.encode(pcm16),
                "mimeType": "audio/pcm;rate=16000",
            }
        }
    }).to_string()
}

pub(super) enum GeminiEvent {
    SetupComplete,
    Transcript(TranscriptEvent),
    GoAway,
}

pub(super) fn parse_message(source: &str, session_id: u64, generation: u64, sequence: u64, payload: &str) -> Result<Option<GeminiEvent>, String> {
    let data: Value = serde_json::from_str(payload).map_err(|error| error.to_string())?;
    if data.get("error").is_some() {
        let message = data.get("error").and_then(|value| value.get("message")).and_then(Value::as_str).unwrap_or("Gemini Live connection failed");
        return Err(message.to_string());
    }
    if data.get("setupComplete").is_some() {
        return Ok(Some(GeminiEvent::SetupComplete));
    }
    if data.get("goAway").is_some() {
        return Ok(Some(GeminiEvent::GoAway));
    }
    let content = data.get("serverContent").unwrap_or(&data);
    let interim = content.get("interimInputTranscription").and_then(|value| value.get("text")).and_then(Value::as_str).unwrap_or("").trim();
    let final_text = content.get("inputTranscription").and_then(|value| value.get("text")).and_then(Value::as_str).unwrap_or("").trim();
    if !interim.is_empty() {
        return Ok(Some(GeminiEvent::Transcript(TranscriptEvent {
            session_id, generation, source: source.to_string(), text: interim.to_string(),
            is_final: false, boundary: "interim".into(), sequence,
        })));
    }
    if !final_text.is_empty() {
        return Ok(Some(GeminiEvent::Transcript(TranscriptEvent {
            session_id, generation, source: source.to_string(), text: final_text.to_string(),
            is_final: true, boundary: "final".into(), sequence,
        })));
    }
    Ok(None)
}
