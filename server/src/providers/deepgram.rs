use std::time::Duration;

use futures_util::{future::BoxFuture, SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::time::{interval, MissedTickBehavior};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

use crate::{
    error::AppError,
    providers::stt::{
        command_channel, event_channel, map_websocket_error, SttAdapter, SttCommand, SttConnect,
        SttConnection, SttEvent,
    },
};

type DeepgramSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

#[derive(Clone)]
pub struct DeepgramClient {
    url: String,
    api_key: String,
}

impl DeepgramClient {
    pub fn new(url: String, api_key: Option<String>) -> Result<Self, AppError> {
        Ok(Self {
            url,
            api_key: api_key.ok_or(AppError::ProviderUnavailable)?,
        })
    }

    async fn open(
        &self,
        request: &SttConnect,
    ) -> Result<(DeepgramSocket, Option<String>), AppError> {
        let url = build_url(&self.url, request)?;
        let mut ws_request = url
            .as_str()
            .into_client_request()
            .map_err(|_| AppError::ProviderUnavailable)?;
        ws_request.headers_mut().insert(
            "Authorization",
            HeaderValue::from_str(&format!("Token {}", self.api_key))
                .map_err(|_| AppError::ProviderUnavailable)?,
        );
        let (socket, response) = connect_async(ws_request)
            .await
            .map_err(map_websocket_error)?;
        let provider_request_id = response
            .headers()
            .get("dg-request-id")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        Ok((socket, provider_request_id))
    }
}

impl SttAdapter for DeepgramClient {
    fn connect(&self, request: SttConnect) -> BoxFuture<'static, Result<SttConnection, AppError>> {
        let provider = self.clone();
        Box::pin(async move {
            let (socket, provider_request_id) = provider.open(&request).await?;
            let (mut provider_tx, mut provider_rx) = socket.split();
            let (sink, mut commands) = command_channel();
            let (event_tx, events) = event_channel();
            tokio::spawn(async move {
                let mut keepalive = interval(Duration::from_secs(8));
                keepalive.set_missed_tick_behavior(MissedTickBehavior::Skip);
                keepalive.tick().await;
                loop {
                    tokio::select! {
                        command = commands.recv() => match command {
                            Some(SttCommand::Audio(pcm)) => {
                                if provider_tx.send(Message::Binary(pcm)).await.is_err() {
                                    let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                    break;
                                }
                            }
                            Some(SttCommand::Finish) => {
                                if provider_tx.send(Message::Text(json!({"type":"Finalize"}).to_string().into())).await.is_err() {
                                    let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                    break;
                                }
                            }
                            Some(SttCommand::Close) | None => {
                                let _ = provider_tx.send(Message::Text(json!({"type":"CloseStream"}).to_string().into())).await;
                                let _ = provider_tx.close().await;
                                break;
                            }
                        },
                        _ = keepalive.tick() => {
                            if provider_tx.send(Message::Text(json!({"type":"KeepAlive"}).to_string().into())).await.is_err() {
                                let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                break;
                            }
                        }
                        message = provider_rx.next() => match message {
                            Some(Ok(Message::Text(payload))) => match parse_response(payload.as_str()) {
                                Ok((event, finalized)) => {
                                    if let Some(event) = event {
                                        if event_tx.send(Ok(event)).await.is_err() {
                                            break;
                                        }
                                    }
                                    if finalized {
                                        let _ = provider_tx.send(Message::Text(json!({"type":"CloseStream"}).to_string().into())).await;
                                        let _ = provider_tx.close().await;
                                        break;
                                    }
                                }
                                Err(error) => {
                                    let _ = event_tx.send(Err(error)).await;
                                    break;
                                }
                            },
                            Some(Ok(Message::Ping(payload))) => {
                                if provider_tx.send(Message::Pong(payload)).await.is_err() {
                                    let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                    break;
                                }
                            }
                            Some(Ok(Message::Close(_))) | None => break,
                            Some(Err(error)) => {
                                let _ = event_tx.send(Err(map_websocket_error(error))).await;
                                break;
                            }
                            _ => {}
                        },
                    }
                }
            });
            Ok(SttConnection {
                provider_request_id,
                sink,
                events,
            })
        })
    }
}

fn build_url(base: &str, request: &SttConnect) -> Result<Url, AppError> {
    let mut url = Url::parse(base).map_err(|_| AppError::ProviderUnavailable)?;
    let endpointing = if request.language == "multi" {
        "100"
    } else {
        "300"
    };
    url.query_pairs_mut()
        .append_pair("encoding", "linear16")
        .append_pair("sample_rate", "16000")
        .append_pair("channels", "1")
        .append_pair("model", &request.model)
        .append_pair("interim_results", "true")
        .append_pair("smart_format", "true")
        .append_pair("punctuate", "true")
        .append_pair("utterance_end_ms", "1000")
        .append_pair("vad_events", "true")
        .append_pair("language", &request.language)
        .append_pair("endpointing", endpointing);
    Ok(url)
}

fn parse_response(payload: &str) -> Result<(Option<SttEvent>, bool), AppError> {
    let value: Value = serde_json::from_str(payload).map_err(|_| AppError::ProviderProtocol)?;
    let finalized = value
        .get("from_finalize")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let event = match value.get("type").and_then(Value::as_str) {
        Some("Results") => {
            let text = value
                .pointer("/channel/alternatives/0/transcript")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .trim()
                .to_owned();
            let boundary = if value
                .get("speech_final")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                "speech-final"
            } else if value
                .get("is_final")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                "final"
            } else {
                "interim"
            };
            if text.is_empty() && boundary != "speech-final" {
                None
            } else {
                let provider_offset_ms = match (
                    value.get("start").and_then(Value::as_f64),
                    value.get("duration").and_then(Value::as_f64),
                ) {
                    (Some(start), Some(duration)) => seconds_to_ms(start + duration),
                    _ => None,
                };
                Some(SttEvent {
                    text,
                    boundary,
                    provider_offset_ms,
                    terminal: finalized,
                })
            }
        }
        Some("UtteranceEnd") => {
            let end = value.get("last_word_end").and_then(Value::as_f64);
            if end == Some(-1.0) {
                None
            } else {
                Some(SttEvent {
                    text: String::new(),
                    boundary: "utterance-end",
                    provider_offset_ms: end.and_then(seconds_to_ms),
                    terminal: false,
                })
            }
        }
        Some("Error") => return Err(AppError::ProviderRejected),
        _ => None,
    };
    Ok((event, finalized))
}

fn seconds_to_ms(seconds: f64) -> Option<i64> {
    (seconds.is_finite() && seconds >= 0.0).then(|| (seconds * 1000.0).round() as i64)
}

#[cfg(test)]
mod tests {
    use super::{build_url, parse_response};
    use crate::providers::stt::SttConnect;

    #[test]
    fn url_and_boundaries_follow_the_hosted_audio_contract() {
        let request = SttConnect {
            session_id: "session".into(),
            language: "zh-CN".into(),
            model: "nova-3".into(),
        };
        let url = build_url("wss://api.deepgram.com/v1/listen", &request).unwrap();
        assert!(url.as_str().contains("encoding=linear16"));
        assert!(url.as_str().contains("sample_rate=16000"));
        assert!(url.as_str().contains("model=nova-3"));

        let final_event = parse_response(
            r#"{"type":"Results","start":1.0,"duration":0.5,"is_final":true,"speech_final":true,"channel":{"alternatives":[{"transcript":" hello "}]}}"#,
        )
        .unwrap()
        .0
        .unwrap();
        assert_eq!(final_event.boundary, "speech-final");
        assert_eq!(final_event.text, "hello");
        assert_eq!(final_event.provider_offset_ms, Some(1500));

        let utterance = parse_response(r#"{"type":"UtteranceEnd","last_word_end":2.25}"#)
            .unwrap()
            .0
            .unwrap();
        assert_eq!(utterance.boundary, "utterance-end");
        assert_eq!(utterance.provider_offset_ms, Some(2250));
        assert!(parse_response(r#"{"from_finalize":true}"#).unwrap().1);
    }
}
