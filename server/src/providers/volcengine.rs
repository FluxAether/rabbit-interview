use std::io::{Read, Write};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures_util::{future::BoxFuture, SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, http::HeaderValue, Message},
    MaybeTlsStream, WebSocketStream,
};
use uuid::Uuid;

use crate::{
    error::AppError,
    providers::stt::{
        command_channel, event_channel, map_websocket_error, SttAdapter, SttCommand, SttConnect,
        SttConnection, SttEvent,
    },
};

pub type VolcSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[derive(Clone)]
pub struct VolcengineClient {
    url: String,
    api_key: String,
    resource_id: String,
}

impl VolcengineClient {
    pub fn new(
        url: String,
        api_key: Option<String>,
        resource_id: String,
    ) -> Result<Self, AppError> {
        Ok(Self {
            url,
            api_key: api_key.ok_or(AppError::ProviderUnavailable)?,
            resource_id,
        })
    }

    async fn open(&self, request: SttConnect) -> Result<(VolcSocket, Option<String>), AppError> {
        let connect_id = Uuid::new_v4().to_string();
        let mut ws_request = self
            .url
            .clone()
            .into_client_request()
            .map_err(|_| AppError::ProviderUnavailable)?;
        ws_request.headers_mut().insert(
            "X-Api-Key",
            HeaderValue::from_str(&self.api_key).map_err(|_| AppError::ProviderUnavailable)?,
        );
        ws_request.headers_mut().insert(
            "X-Api-Resource-Id",
            HeaderValue::from_str(&self.resource_id).map_err(|_| AppError::ProviderUnavailable)?,
        );
        ws_request.headers_mut().insert(
            "X-Api-Connect-Id",
            HeaderValue::from_str(&connect_id).map_err(|_| AppError::ProviderUnavailable)?,
        );
        let (mut socket, response) = connect_async(ws_request)
            .await
            .map_err(map_websocket_error)?;
        let provider_request_id = response
            .headers()
            .get("X-Tt-Logid")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        socket
            .send(Message::Binary(
                initial_request(&request.session_id, &request.language, &request.model)?.into(),
            ))
            .await
            .map_err(|_| AppError::ProviderUnavailable)?;
        Ok((socket, provider_request_id))
    }
}

impl SttAdapter for VolcengineClient {
    fn connect(&self, request: SttConnect) -> BoxFuture<'static, Result<SttConnection, AppError>> {
        let provider = self.clone();
        Box::pin(async move {
            let (socket, provider_request_id) = provider.open(request).await?;
            let (mut provider_tx, mut provider_rx) = socket.split();
            let (sink, mut commands) = command_channel();
            let (event_tx, events) = event_channel();
            tokio::spawn(async move {
                loop {
                    tokio::select! {
                        command = commands.recv() => match command {
                            Some(SttCommand::Audio(pcm)) => {
                                let frame = match audio_frame(&pcm, false) {
                                    Ok(frame) => frame,
                                    Err(error) => {
                                        let _ = event_tx.send(Err(error)).await;
                                        break;
                                    }
                                };
                                if provider_tx.send(Message::Binary(frame.into())).await.is_err() {
                                    let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                    break;
                                }
                            }
                            Some(SttCommand::Finish) => {
                                let frame = match audio_frame(&[], true) {
                                    Ok(frame) => frame,
                                    Err(error) => {
                                        let _ = event_tx.send(Err(error)).await;
                                        break;
                                    }
                                };
                                if provider_tx.send(Message::Binary(frame.into())).await.is_err() {
                                    let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                    break;
                                }
                            }
                            Some(SttCommand::Close) | None => {
                                let _ = provider_tx.close().await;
                                break;
                            }
                        },
                        message = provider_rx.next() => match message {
                            Some(Ok(Message::Binary(frame))) => match parse_response(&frame) {
                                Ok(Some(event)) => {
                                    if event_tx.send(Ok(event)).await.is_err() {
                                        break;
                                    }
                                }
                                Ok(None) => {}
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

pub fn initial_request(session_id: &str, language: &str, model: &str) -> Result<Vec<u8>, AppError> {
    let language = match language {
        "zh-CN" => "zh-CN",
        "zh-TW" => "zh-TW",
        "en-US" => "en-US",
        "multi" => "zh-CN",
        _ => return Err(AppError::BadRequest("Unsupported STT language.")),
    };
    let payload = serde_json::to_vec(&json!({
        "user": {"uid": session_id},
        "audio": {
            "format": "pcm",
            "rate": 16000,
            "bits": 16,
            "channel": 1,
            "language": language
        },
        "request": {
            "model_name": model,
            "show_utterances": true,
            "enable_itn": true,
            "enable_punc": true
        }
    }))
    .map_err(|_| AppError::Internal)?;
    encode_frame(0x10, 0x11, &payload)
}

pub fn audio_frame(pcm: &[u8], final_packet: bool) -> Result<Vec<u8>, AppError> {
    if !pcm.len().is_multiple_of(2) {
        return Err(AppError::BadRequest(
            "PCM S16LE frames must contain complete samples.",
        ));
    }
    encode_frame(if final_packet { 0x22 } else { 0x20 }, 0x01, pcm)
}

fn encode_frame(message: u8, encoding: u8, payload: &[u8]) -> Result<Vec<u8>, AppError> {
    let compressed = gzip(payload)?;
    let size = u32::try_from(compressed.len())
        .map_err(|_| AppError::BadRequest("Audio frame is too large."))?;
    let mut frame = Vec::with_capacity(8 + compressed.len());
    frame.extend_from_slice(&[0x11, message, encoding, 0x00]);
    frame.extend_from_slice(&size.to_be_bytes());
    frame.extend_from_slice(&compressed);
    Ok(frame)
}

pub fn parse_response(frame: &[u8]) -> Result<Option<SttEvent>, AppError> {
    if frame.len() < 8 || frame[0] >> 4 != 1 {
        return Err(AppError::ProviderProtocol);
    }
    let header_size = usize::from(frame[0] & 0x0f) * 4;
    if header_size < 4 || frame.len() < header_size + 4 {
        return Err(AppError::ProviderProtocol);
    }
    let message_type = frame[1] >> 4;
    let flags = frame[1] & 0x0f;
    let compression = frame[2] & 0x0f;
    let mut cursor = header_size;
    if message_type == 0x0f {
        if frame.len() < cursor + 8 {
            return Err(AppError::ProviderProtocol);
        }
        let _error_code = read_u32(frame, cursor)?;
        cursor += 4;
        let size = read_u32(frame, cursor)? as usize;
        if frame.len() < cursor + 4 + size {
            return Err(AppError::ProviderProtocol);
        }
        return Err(AppError::ProviderProtocol);
    }
    if message_type != 0x09 {
        return Ok(None);
    }
    if flags & 0x01 != 0 {
        if frame.len() < cursor + 4 {
            return Err(AppError::ProviderProtocol);
        }
        cursor += 4;
    }
    let size = read_u32(frame, cursor)? as usize;
    cursor += 4;
    if frame.len() < cursor + size {
        return Err(AppError::ProviderProtocol);
    }
    let payload = match compression {
        0 => frame[cursor..cursor + size].to_vec(),
        1 => gunzip(&frame[cursor..cursor + size])?,
        _ => return Err(AppError::ProviderProtocol),
    };
    let value: Value = serde_json::from_slice(&payload).map_err(|_| AppError::ProviderProtocol)?;
    let text = value
        .pointer("/result/text")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let utterance = value
        .pointer("/result/utterances")
        .and_then(Value::as_array)
        .and_then(|items| items.last());
    let definite = utterance
        .and_then(|item| item.get("definite"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let provider_offset_ms = utterance
        .and_then(|item| item.get("end_time"))
        .and_then(Value::as_i64);
    let boundary = if flags & 0x02 != 0 {
        "final"
    } else if definite {
        "speech-final"
    } else {
        "interim"
    };
    Ok(Some(SttEvent {
        text,
        boundary,
        provider_offset_ms,
        terminal: flags & 0x02 != 0,
    }))
}

fn gzip(payload: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(payload).map_err(|_| AppError::Internal)?;
    encoder.finish().map_err(|_| AppError::Internal)
}

fn gunzip(payload: &[u8]) -> Result<Vec<u8>, AppError> {
    let mut decoder = GzDecoder::new(payload);
    let mut output = Vec::new();
    decoder
        .read_to_end(&mut output)
        .map_err(|_| AppError::ProviderProtocol)?;
    Ok(output)
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, AppError> {
    let value: [u8; 4] = bytes
        .get(offset..offset + 4)
        .ok_or(AppError::ProviderProtocol)?
        .try_into()
        .map_err(|_| AppError::ProviderProtocol)?;
    Ok(u32::from_be_bytes(value))
}

#[cfg(test)]
mod tests {
    use super::{audio_frame, gzip, parse_response};

    #[test]
    fn audio_frame_uses_v3_header_and_final_flag() {
        let regular = audio_frame(&[0, 1, 2, 3], false).unwrap();
        let final_frame = audio_frame(&[], true).unwrap();
        assert_eq!(&regular[..4], &[0x11, 0x20, 0x01, 0x00]);
        assert_eq!(&final_frame[..4], &[0x11, 0x22, 0x01, 0x00]);
        assert!(audio_frame(&[0], false).is_err());
    }

    #[test]
    fn parses_gzip_server_transcript_fixture() {
        let payload =
            gzip(br#"{"result":{"text":"hello","utterances":[{"end_time":420,"definite":true}]}}"#)
                .unwrap();
        let mut frame = vec![0x11, 0x91, 0x11, 0x00];
        frame.extend_from_slice(&1_i32.to_be_bytes());
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&payload);
        let parsed = parse_response(&frame).unwrap().unwrap();
        assert_eq!(parsed.text, "hello");
        assert_eq!(parsed.boundary, "speech-final");
        assert_eq!(parsed.provider_offset_ms, Some(420));
    }
}
