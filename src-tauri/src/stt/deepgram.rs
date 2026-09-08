use super::realtime::{RealtimeSttConfig, TranscriptEvent};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::AUTHORIZATION;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::handshake::client::Request;

pub(super) fn build_request(config: &RealtimeSttConfig) -> Result<Request, String> {
    let api_key = config
        .api_key
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "No Deepgram API key is configured".to_string())?;
    let endpointing = config.endpointing_ms.unwrap_or(500);
    let utterance_end_ms = config.utterance_end_ms.unwrap_or(1_500);
    let mut url = url::Url::parse("wss://api.deepgram.com/v1/listen")
        .map_err(|error| error.to_string())?;
    url.query_pairs_mut()
        .append_pair("encoding", "linear16")
        .append_pair("sample_rate", &config.sample_rate.to_string())
        .append_pair("channels", "1")
        .append_pair("model", config.model.as_deref().unwrap_or("nova-3"))
        .append_pair("interim_results", "true")
        .append_pair("smart_format", "true")
        .append_pair("punctuate", "true")
        .append_pair("utterance_end_ms", &utterance_end_ms.to_string())
        .append_pair("vad_events", "true")
        .append_pair("language", &config.language)
        .append_pair("endpointing", &endpointing.to_string());
    let mut request = url.as_str().into_client_request().map_err(|error| error.to_string())?;
    request.headers_mut().insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Token {api_key}"))
            .map_err(|error| error.to_string())?,
    );
    Ok(request)
}

pub(super) fn parse_message(
    source: &str,
    session_id: u64,
    generation: u64,
    sequence: u64,
    payload: &str,
) -> Result<Option<TranscriptEvent>, String> {
    let data: serde_json::Value = serde_json::from_str(payload).map_err(|error| error.to_string())?;
    if data.get("type").and_then(|value| value.as_str()) == Some("UtteranceEnd")
        && data.get("last_word_end").and_then(|value| value.as_i64()) == Some(-1)
    {
        return Ok(None);
    }
    if let Some(message) = data
        .get("error")
        .and_then(|value| value.get("message"))
        .and_then(|value| value.as_str())
    {
        return Err(message.to_string());
    }

    let transcript = data
        .get("channel")
        .and_then(|value| value.get("alternatives"))
        .and_then(|value| value.get(0))
        .and_then(|value| value.get("transcript"))
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let message_type = data.get("type").and_then(|value| value.as_str());
    let is_final = data
        .get("is_final")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let speech_final = data
        .get("speech_final")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let boundary = if message_type == Some("UtteranceEnd") {
        "utterance-end"
    } else if speech_final {
        "speech-final"
    } else if is_final {
        "final"
    } else {
        "interim"
    };

    if transcript.is_empty() && !matches!(boundary, "speech-final" | "utterance-end") {
        return Ok(None);
    }
    Ok(Some(TranscriptEvent {
        session_id,
        generation,
        source: source.to_string(),
        text: transcript,
        is_final,
        boundary: boundary.to_string(),
        sequence,
    }))
}

#[cfg(test)]
mod tests {
    use super::parse_message;

    #[test]
    fn parses_speech_final_transcript() {
        let event = parse_message(
            "system",
            1,
            2,
            7,
            r#"{"type":"Results","is_final":true,"speech_final":true,"channel":{"alternatives":[{"transcript":"Tell me about yourself"}]}}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(event.source, "system");
        assert_eq!(event.boundary, "speech-final");
        assert_eq!(event.sequence, 7);
    }

    #[test]
    fn keeps_empty_utterance_end_boundary() {
        let event = parse_message(
            "microphone",
            1,
            2,
            9,
            r#"{"type":"UtteranceEnd","last_word_end":1.2}"#,
        )
        .unwrap()
        .unwrap();
        assert_eq!(event.boundary, "utterance-end");
        assert!(event.text.is_empty());
    }
}
