use std::{collections::VecDeque, pin::Pin, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use futures_util::{
    future::BoxFuture,
    stream::{SplitSink, SplitStream},
    StreamExt,
};
use serde_json::{json, Value};
use tokio::time::{sleep, timeout, Instant, Sleep};
use tokio_tungstenite::{
    tungstenite::{client::IntoClientRequest, Message},
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

use crate::{
    error::AppError,
    providers::stt::{
        command_channel, connect_provider, event_channel, map_websocket_error, SttAdapter, SttCommand,
        SttConnect, SttConnection, SttEvent, SttSocketExt, SttEventSender,
    },
};

type GeminiSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;
type GeminiWriter = SplitSink<GeminiSocket, Message>;
type GeminiReader = SplitStream<GeminiSocket>;

struct SocketParts {
    tx: GeminiWriter,
    rx: GeminiReader,
}

impl SocketParts {
    fn new(socket: GeminiSocket) -> Self {
        let (tx, rx) = socket.split();
        Self { tx, rx }
    }
}

#[derive(Clone)]
pub struct GeminiLiveClient {
    url: String,
    api_key: String,
}

impl GeminiLiveClient {
    pub fn new(url: String, api_key: Option<String>) -> Result<Self, AppError> {
        Ok(Self {
            url,
            api_key: api_key.ok_or(AppError::ProviderUnavailable)?,
        })
    }

    async fn open(
        &self,
        request: &SttConnect,
        resume_handle: Option<&str>,
    ) -> Result<(GeminiSocket, Option<String>), AppError> {
        let mut url = Url::parse(&self.url).map_err(|_| AppError::ProviderUnavailable)?;
        url.query_pairs_mut().append_pair("key", &self.api_key);
        let ws_request = url
            .as_str()
            .into_client_request()
            .map_err(|_| AppError::ProviderUnavailable)?;
        let (mut socket, response) = timeout(Duration::from_secs(10), connect_provider(ws_request))
            .await
            .map_err(|_| AppError::ProviderUnavailable)??;
        let provider_request_id = response
            .headers()
            .get("x-request-id")
            .and_then(|value| value.to_str().ok())
            .map(ToOwned::to_owned);
        let setup_payload = setup(request, resume_handle);
        tracing::info!(
            session_id = %request.session_id,
            body = %setup_payload,
            "stt provider start"
        );
        socket
            .send_stt(Message::Text(setup_payload.to_string().into()))
            .await
            .map_err(|_| AppError::ProviderUnavailable)?;

        timeout(Duration::from_secs(10), async {
            loop {
                match socket.next().await {
                    Some(Ok(Message::Text(payload))) => match parse_response(payload.as_str())? {
                        GeminiResponse::SetupComplete => return Ok(()),
                        GeminiResponse::Events(_)
                        | GeminiResponse::ResumptionUpdate { .. }
                        | GeminiResponse::GoAway { .. }
                        | GeminiResponse::Ignore => {}
                    },
                    Some(Ok(Message::Binary(payload))) => {
                        let payload = std::str::from_utf8(&payload)
                            .map_err(|_| AppError::ProviderProtocol)?;
                        match parse_response(payload)? {
                            GeminiResponse::SetupComplete => return Ok(()),
                            GeminiResponse::Events(_)
                            | GeminiResponse::ResumptionUpdate { .. }
                            | GeminiResponse::GoAway { .. }
                            | GeminiResponse::Ignore => {}
                        }
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        socket
                            .send_stt(Message::Pong(payload))
                            .await
                            .map_err(|_| AppError::ProviderUnavailable)?
                    }
                    Some(Ok(Message::Close(_))) | None => {
                        return Err(AppError::ProviderUnavailable)
                    }
                    Some(Err(error)) => return Err(map_websocket_error(error)),
                    _ => {}
                }
            }
        })
        .await
        .map_err(|_| AppError::ProviderUnavailable)??;
        Ok((socket, provider_request_id))
    }
}

impl SttAdapter for GeminiLiveClient {
    fn connect(&self, request: SttConnect) -> BoxFuture<'static, Result<SttConnection, AppError>> {
        let provider = self.clone();
        Box::pin(async move {
            let (socket, provider_request_id) = provider.open(&request, None).await?;
            let mut active = SocketParts::new(socket);
            let mut retiring: Option<SocketParts> = None;
            let (sink, mut commands) = command_channel();
            let (event_tx, events) = event_channel();
            Ok(SttConnection::spawn(provider_request_id, sink, events, async move {
                let mut rotation = RotationState::default();
                let mut transcript_gate = TranscriptGate::default();
                rotation.connected(Instant::now());
                let mut active_live = true;
                let utterance_timer = sleep(Duration::from_secs(24 * 60 * 60));
                tokio::pin!(utterance_timer);
                let reconnect_timer = sleep(Duration::from_secs(24 * 60 * 60));
                tokio::pin!(reconnect_timer);
                let mut reconnect_scheduled = false;
                let retiring_timer = sleep(Duration::from_secs(24 * 60 * 60));
                tokio::pin!(retiring_timer);
                let mut retiring_scheduled = false;
                let mut deferred_active_error = None;
                let mut utterance_pending = false;
                let mut pending_open = None::<
                    BoxFuture<'static, Result<(GeminiSocket, Option<String>), AppError>>,
                >;
                let mut pending_deadline = None;
                loop {
                    let mut retirement_finished = false;
                    tokio::select! {
                        command = commands.recv(), if deferred_active_error.is_none() => match command {
                            Some(SttCommand::Audio(pcm)) => {
                                // ponytail: drop PCM during provider reconnect; buffer if gaps show up in transcripts
                                if active_live {
                                    let payload = json!({
                                        "realtimeInput": {
                                            "audio": {
                                                "data": BASE64.encode(pcm),
                                                "mimeType": "audio/pcm;rate=16000"
                                            }
                                        }
                                    });
                                    if active.tx.send_stt(Message::Text(payload.to_string().into())).await.is_err() {
                                        if !rotation.note_close(Instant::now()) {
                                            let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                            break;
                                        }
                                        active_live = false;
                                    }
                                }
                            }
                            Some(SttCommand::Finish) => {
                                if !active_live {
                                    break;
                                }
                                let payload = json!({"realtimeInput":{"audioStreamEnd":true}});
                                if active.tx.send_stt(Message::Text(payload.to_string().into())).await.is_err() {
                                    let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                    break;
                                }
                            }
                            Some(SttCommand::Close) | None => {
                                let _ = active.tx.close_stt().await;
                                if let Some(mut old) = retiring.take() {
                                    let _ = old.tx.close_stt().await;
                                }
                                drop(pending_open.take());
                                break;
                            }
                        },
                        _ = &mut utterance_timer, if utterance_pending => {
                            utterance_pending = false;
                            if event_tx.send(Ok(SttEvent {
                                text: String::new(),
                                boundary: "utterance-end",
                                provider_offset_ms: None,
                                terminal: false,
                            })).await.is_err() {
                                break;
                            }
                        }
                        _ = &mut reconnect_timer, if reconnect_scheduled => {
                            reconnect_scheduled = false;
                        }
                        opened = async {
                            pending_open
                                .as_mut()
                                .expect("pending open branch is guarded")
                                .await
                        }, if pending_open.is_some() => {
                            pending_open = None;
                            match opened {
                                Ok((replacement, _)) => {
                                    rotation.connected(Instant::now());
                                    transcript_gate.begin_rotation();
                                    let old = std::mem::replace(
                                        &mut active,
                                        SocketParts::new(replacement),
                                    );
                                    active_live = true;
                                    retiring = Some(old);
                                    retiring_timer.as_mut().reset(retirement_deadline(
                                        pending_deadline.take(),
                                        Instant::now(),
                                    ));
                                    retiring_scheduled = true;
                                }
                                Err(_) => {
                                    tracing::warn!(
                                        session_id = %request.session_id,
                                        "Gemini Live reconnect failed"
                                    );
                                    if let Some(retry_at) = rotation
                                        .retry_after(Instant::now(), Duration::from_millis(250))
                                    {
                                        reconnect_timer.as_mut().reset(retry_at);
                                        reconnect_scheduled = true;
                                    } else if !active_live {
                                        let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                        break;
                                    }
                                }
                            }
                        }
                        _ = &mut retiring_timer, if retiring_scheduled => {
                            retirement_finished = true;
                        }
                        message = async {
                            retiring
                                .as_mut()
                                .expect("retiring socket branch is guarded")
                                .rx
                                .next()
                                .await
                        }, if retiring.is_some() => {
                            let mut drained = false;
                            match message {
                                Some(Ok(Message::Text(payload))) => {
                                    if let Ok(GeminiResponse::Events(old_events)) =
                                        parse_response(payload.as_str())
                                    {
                                        if !forward_events(
                                            old_events,
                                            &event_tx,
                                            &mut utterance_pending,
                                            utterance_timer.as_mut(),
                                        ).await {
                                            break;
                                        }
                                    }
                                }
                                Some(Ok(Message::Binary(payload))) => {
                                    let parsed = std::str::from_utf8(&payload)
                                        .map_err(|_| AppError::ProviderProtocol)
                                        .and_then(parse_response);
                                    if let Ok(GeminiResponse::Events(old_events)) = parsed {
                                        if !forward_events(
                                            old_events,
                                            &event_tx,
                                            &mut utterance_pending,
                                            utterance_timer.as_mut(),
                                        ).await {
                                            break;
                                        }
                                    }
                                }
                                Some(Ok(Message::Ping(payload))) => {
                                    if retiring
                                        .as_mut()
                                        .expect("retiring socket branch is guarded")
                                        .tx
                                        .send_stt(Message::Pong(payload))
                                        .await
                                        .is_err()
                                    {
                                        drained = true;
                                    }
                                }
                                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => {
                                    drained = true;
                                }
                                _ => {}
                            }
                            if drained {
                                retirement_finished = true;
                            }
                        }
                        message = active.rx.next(), if transcript_gate.can_read_active() && deferred_active_error.is_none() && active_live => {
                            let parsed = match message {
                                Some(Ok(Message::Text(payload))) => parse_response(payload.as_str()),
                                Some(Ok(Message::Binary(payload))) => std::str::from_utf8(&payload)
                                    .map_err(|_| AppError::ProviderProtocol)
                                    .and_then(parse_response),
                                Some(Ok(Message::Ping(payload))) => {
                                    if active.tx.send_stt(Message::Pong(payload)).await.is_err() {
                                        let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                        break;
                                    }
                                    continue;
                                }
                                Some(Ok(Message::Close(_))) | None => {
                                    let error = AppError::ProviderUnavailable;
                                    if transcript_gate.defer_active_failure() {
                                        deferred_active_error = Some(error);
                                        continue;
                                    }
                                    if !rotation.note_close(Instant::now()) {
                                        let _ = event_tx.send(Err(error)).await;
                                        break;
                                    }
                                    active_live = false;
                                    Ok(GeminiResponse::Ignore)
                                }
                                Some(Err(error)) => {
                                    let error = map_websocket_error(error);
                                    if transcript_gate.defer_active_failure() {
                                        deferred_active_error = Some(error);
                                        continue;
                                    }
                                    if matches!(&error, AppError::ProviderUnavailable)
                                        && rotation.note_close(Instant::now())
                                    {
                                        active_live = false;
                                        Ok(GeminiResponse::Ignore)
                                    } else {
                                        Err(error)
                                    }
                                }
                                _ => continue,
                            };
                            match parsed {
                                Ok(GeminiResponse::Events(next_events)) => {
                                    if let Some(next_events) = transcript_gate.active_events(next_events) {
                                        if !forward_events(
                                            next_events,
                                            &event_tx,
                                            &mut utterance_pending,
                                            utterance_timer.as_mut(),
                                        ).await {
                                            break;
                                        }
                                    }
                                }
                                Ok(GeminiResponse::ResumptionUpdate { resumable, new_handle }) => {
                                    rotation.update(resumable, new_handle);
                                }
                                Ok(GeminiResponse::GoAway { time_left }) => {
                                    rotation.note_go_away(time_left, Instant::now());
                                }
                                Ok(GeminiResponse::SetupComplete | GeminiResponse::Ignore) => {}
                                Err(error) => {
                                    let _ = event_tx.send(Err(error)).await;
                                    break;
                                }
                            }
                        }
                    }

                    if retirement_finished {
                        retiring = None;
                        retiring_scheduled = false;
                        let (buffered_events, active_failed) = transcript_gate.finish_rotation();
                        for buffered in buffered_events {
                            if !forward_events(
                                buffered,
                                &event_tx,
                                &mut utterance_pending,
                                utterance_timer.as_mut(),
                            )
                            .await
                            {
                                return;
                            }
                        }
                        if active_failed {
                            let error = deferred_active_error
                                .take()
                                .unwrap_or(AppError::ProviderUnavailable);
                            let _ = event_tx.send(Err(error)).await;
                            break;
                        }
                    }

                    if retiring.is_none() && !reconnect_scheduled && deferred_active_error.is_none()
                    {
                        if pending_open.is_none() {
                            if let Some(handle) = rotation.take_reconnect(Instant::now()) {
                                pending_deadline = rotation.deadline();
                                let opener = provider.clone();
                                let connect = request.clone();
                                pending_open = Some(Box::pin(async move {
                                    opener.open(&connect, handle.as_deref()).await
                                }));
                            } else if !active_live {
                                let _ = event_tx.send(Err(AppError::ProviderUnavailable)).await;
                                break;
                            }
                        }
                    }
                }
            }))
        })
    }
}

async fn forward_events(
    events: Vec<SttEvent>,
    sender: &SttEventSender,
    utterance_pending: &mut bool,
    mut utterance_timer: Pin<&mut Sleep>,
) -> bool {
    for event in events {
        if event.boundary == "final" {
            *utterance_pending = true;
            utterance_timer
                .as_mut()
                .reset(Instant::now() + Duration::from_millis(1_500));
        } else if event.boundary == "utterance-end" {
            *utterance_pending = false;
        }
        if sender.send(Ok(event)).await.is_err() {
            return false;
        }
    }
    true
}

fn retirement_deadline(go_away_deadline: Option<Instant>, now: Instant) -> Instant {
    go_away_deadline
        .unwrap_or(now + Duration::from_secs(10))
        .max(now + Duration::from_secs(1))
}

fn setup(request: &SttConnect, resume_handle: Option<&str>) -> Value {
    let model = if request.model.starts_with("models/") {
        request.model.clone()
    } else {
        format!("models/{}", request.model)
    };
    let language_codes: &[&str] = match request.language.as_str() {
        "zh-CN" => &["cmn-Hans-CN"],
        "en-US" => &["en-US"],
        // Gemini Transcribe Live does not list a Mandarin Traditional hint;
        // automatic detection is safer than biasing Traditional Chinese to Cantonese.
        "zh-TW" | "multi" => &[],
        _ => &[],
    };
    let session_resumption = resume_handle
        .map(|handle| json!({"handle":handle}))
        .unwrap_or_else(|| json!({}));
    json!({
        "setup": {
            "model": model,
            "generationConfig": {"responseModalities":["TEXT"]},
            "inputAudioTranscription": {"languageCodes":language_codes},
            "sessionResumption": session_resumption,
            "contextWindowCompression": {"slidingWindow":{}},
            "realtimeInputConfig": {
                "automaticActivityDetection": {
                    "disabled": false,
                    "prefixPaddingMs": 20,
                    "endOfSpeechSensitivity": "END_SENSITIVITY_LOW",
                    "silenceDurationMs": 1500
                }
            }
        }
    })
}

enum GeminiResponse {
    SetupComplete,
    Events(Vec<SttEvent>),
    ResumptionUpdate {
        resumable: bool,
        new_handle: Option<String>,
    },
    GoAway {
        time_left: Option<Duration>,
    },
    Ignore,
}

#[derive(Default)]
struct RotationState {
    handle: Option<String>,
    go_away: bool,
    deadline: Option<Instant>,
    retry_not_before: Option<Instant>,
    last_connected: Option<Instant>,
    failures: u8,
}

impl RotationState {
    fn update(&mut self, resumable: bool, new_handle: Option<String>) {
        if resumable
            && new_handle
                .as_deref()
                .is_some_and(|handle| !handle.is_empty())
        {
            self.handle = new_handle;
        }
    }

    fn note_go_away(&mut self, time_left: Option<Duration>, now: Instant) {
        self.go_away = true;
        self.deadline = Some(now + time_left.unwrap_or(Duration::from_secs(10)));
        self.retry_not_before = None;
    }

    fn note_close(&mut self, now: Instant) -> bool {
        let short = self.last_connected.is_some_and(|connected| {
            now.saturating_duration_since(connected) < Duration::from_secs(2)
        });
        if short {
            self.failures = self.failures.saturating_add(1);
        } else {
            self.failures = 0;
        }
        if self.failures >= 3 {
            return false;
        }
        self.handle = None;
        self.go_away = true;
        self.deadline = Some(now + Duration::from_secs(10));
        self.retry_not_before = None;
        true
    }

    fn take_reconnect(&mut self, now: Instant) -> Option<Option<String>> {
        if !self.go_away {
            return None;
        }
        if self.deadline.is_some_and(|deadline| now >= deadline) {
            self.go_away = false;
            return None;
        }
        if self
            .retry_not_before
            .is_some_and(|retry_not_before| now < retry_not_before)
        {
            return None;
        }
        self.go_away = false;
        self.retry_not_before = None;
        Some(self.handle.clone())
    }

    fn retry_after(&mut self, now: Instant, delay: Duration) -> Option<Instant> {
        self.failures = self.failures.saturating_add(1);
        if self.failures >= 3 {
            return None;
        }
        let deadline = self.deadline?;
        if now >= deadline {
            return None;
        }
        self.go_away = true;
        let retry_at = (now + delay).min(deadline);
        self.retry_not_before = Some(retry_at);
        Some(retry_at)
    }

    fn connected(&mut self, now: Instant) {
        self.deadline = None;
        self.retry_not_before = None;
        self.go_away = false;
        self.last_connected = Some(now);
    }

    fn deadline(&self) -> Option<Instant> {
        self.deadline
    }
}

const TRANSITION_EVENT_CAPACITY: usize = 16;

#[derive(Default)]
struct TranscriptGate {
    retiring: bool,
    buffered_active: VecDeque<Vec<SttEvent>>,
    active_failed: bool,
}

impl TranscriptGate {
    fn begin_rotation(&mut self) {
        debug_assert!(!self.retiring);
        self.retiring = true;
    }

    fn can_read_active(&self) -> bool {
        !self.retiring || self.buffered_active.len() < TRANSITION_EVENT_CAPACITY
    }

    fn active_events(&mut self, events: Vec<SttEvent>) -> Option<Vec<SttEvent>> {
        if self.retiring {
            debug_assert!(self.buffered_active.len() < TRANSITION_EVENT_CAPACITY);
            self.buffered_active.push_back(events);
            None
        } else {
            Some(events)
        }
    }

    fn defer_active_failure(&mut self) -> bool {
        if !self.retiring {
            return false;
        }
        self.active_failed = true;
        true
    }

    fn finish_rotation(&mut self) -> (VecDeque<Vec<SttEvent>>, bool) {
        self.retiring = false;
        (
            std::mem::take(&mut self.buffered_active),
            std::mem::take(&mut self.active_failed),
        )
    }
}

fn parse_response(payload: &str) -> Result<GeminiResponse, AppError> {
    let value: Value = serde_json::from_str(payload).map_err(|_| AppError::ProviderProtocol)?;
    if let Some(error) = value.get("error") {
        return Err(if error.get("code").and_then(Value::as_i64) == Some(429) {
            AppError::RateLimited
        } else {
            AppError::ProviderRejected
        });
    }
    if value.get("setupComplete").is_some() {
        return Ok(GeminiResponse::SetupComplete);
    }
    if let Some(update) = value.get("sessionResumptionUpdate") {
        return Ok(GeminiResponse::ResumptionUpdate {
            resumable: update
                .get("resumable")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            new_handle: update
                .get("newHandle")
                .and_then(Value::as_str)
                .filter(|handle| !handle.is_empty())
                .map(ToOwned::to_owned),
        });
    }
    if let Some(go_away) = value.get("goAway") {
        return Ok(GeminiResponse::GoAway {
            time_left: go_away
                .get("timeLeft")
                .and_then(Value::as_str)
                .and_then(parse_duration),
        });
    }
    let content = value.get("serverContent").unwrap_or(&value);
    let mut events = Vec::with_capacity(2);
    if let Some(text) = content
        .pointer("/interimInputTranscription/text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        events.push(SttEvent {
            text: text.to_owned(),
            boundary: "interim",
            provider_offset_ms: None,
            terminal: false,
        });
    }
    if let Some(text) = content
        .pointer("/inputTranscription/text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
    {
        events.push(SttEvent {
            text: text.to_owned(),
            boundary: "final",
            provider_offset_ms: None,
            terminal: false,
        });
    }
    if events.is_empty() {
        Ok(GeminiResponse::Ignore)
    } else {
        Ok(GeminiResponse::Events(events))
    }
}

fn parse_duration(value: &str) -> Option<Duration> {
    let seconds = value.strip_suffix('s')?.parse::<f64>().ok()?;
    (seconds.is_finite() && seconds > 0.0).then(|| Duration::from_secs_f64(seconds))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        parse_response, retirement_deadline, setup, GeminiResponse, RotationState, TranscriptGate,
    };
    use crate::providers::stt::{SttConnect, SttEvent};

    fn request() -> SttConnect {
        SttConnect {
            session_id: "session".into(),
            language: "zh-CN".into(),
            model: "gemini-live".into(),
        }
    }

    #[test]
    fn setup_enables_transcription_resumption_and_context_compression() {
        let initial = setup(&request(), None);
        assert_eq!(
            initial.pointer("/setup/model").unwrap(),
            "models/gemini-live"
        );
        assert_eq!(
            initial
                .pointer("/setup/inputAudioTranscription/languageCodes/0")
                .unwrap(),
            "cmn-Hans-CN"
        );
        assert_eq!(
            initial.pointer("/setup/sessionResumption").unwrap(),
            &json!({})
        );
        assert_eq!(
            initial
                .pointer("/setup/contextWindowCompression/slidingWindow")
                .unwrap(),
            &json!({})
        );
        assert_eq!(
            setup(&request(), Some("resume-2"))
                .pointer("/setup/sessionResumption/handle")
                .unwrap(),
            "resume-2"
        );
    }

    #[test]
    fn transcript_events_ignore_turn_complete_ordering() {
        let GeminiResponse::Events(events) = parse_response(
            r#"{"serverContent":{"interimInputTranscription":{"text":" hel "},"inputTranscription":{"text":"hello"},"turnComplete":true}}"#,
        )
        .unwrap()
        else {
            panic!("expected transcript events");
        };
        assert_eq!(events[0].boundary, "interim");
        assert_eq!(events[1].boundary, "final");
        assert_eq!(events.len(), 2);
        assert!(matches!(
            parse_response(r#"{"serverContent":{"turnComplete":true}}"#).unwrap(),
            GeminiResponse::Ignore
        ));
    }

    #[test]
    fn rotation_uses_latest_handle_and_keeps_old_final_parseable() {
        let now = tokio::time::Instant::now();
        let mut rotation = RotationState::default();
        for payload in [
            r#"{"sessionResumptionUpdate":{"resumable":true,"newHandle":"resume-1"}}"#,
            r#"{"sessionResumptionUpdate":{"resumable":true,"newHandle":"resume-2"}}"#,
            r#"{"sessionResumptionUpdate":{"resumable":false}}"#,
        ] {
            let GeminiResponse::ResumptionUpdate {
                resumable,
                new_handle,
            } = parse_response(payload).unwrap()
            else {
                panic!("expected resumption update");
            };
            rotation.update(resumable, new_handle);
        }
        assert!(matches!(
            parse_response(r#"{"goAway":{"timeLeft":"5s"}}"#).unwrap(),
            GeminiResponse::GoAway {
                time_left: Some(time_left)
            } if time_left == std::time::Duration::from_secs(5)
        ));
        rotation.note_go_away(Some(std::time::Duration::from_secs(5)), now);
        assert_eq!(
            rotation.take_reconnect(now),
            Some(Some("resume-2".into()))
        );
        assert!(rotation.take_reconnect(now).is_none());

        let GeminiResponse::Events(old_events) =
            parse_response(r#"{"serverContent":{"inputTranscription":{"text":"old final"}}}"#)
                .unwrap()
        else {
            panic!("expected old connection transcript");
        };
        assert_eq!(old_events[0].text, "old final");
        assert_eq!(old_events[0].boundary, "final");
    }

    #[test]
    fn rotation_rearms_after_failed_connect_until_go_away_deadline() {
        let now = tokio::time::Instant::now();
        let mut rotation = RotationState::default();
        rotation.update(true, Some("resume".into()));
        rotation.note_go_away(Some(std::time::Duration::from_secs(1)), now);

        assert_eq!(
            rotation.take_reconnect(now),
            Some(Some("resume".into()))
        );
        let retry_at = rotation
            .retry_after(now, std::time::Duration::from_millis(250))
            .unwrap();
        assert!(rotation
            .take_reconnect(now + std::time::Duration::from_millis(249))
            .is_none());
        assert_eq!(
            rotation.take_reconnect(retry_at),
            Some(Some("resume".into()))
        );
        rotation.connected(retry_at);
        assert!(rotation.take_reconnect(retry_at).is_none());
    }

    #[test]
    fn go_away_without_handle_opens_fresh_connection() {
        let now = tokio::time::Instant::now();
        let mut rotation = RotationState::default();
        rotation.connected(now);
        rotation.note_go_away(Some(std::time::Duration::from_secs(5)), now);
        assert_eq!(rotation.take_reconnect(now), Some(None));
        assert!(rotation.take_reconnect(now).is_none());
    }

    #[test]
    fn unexpected_close_opens_fresh_connection() {
        let now = tokio::time::Instant::now();
        let mut rotation = RotationState::default();
        rotation.connected(now);
        assert!(rotation.note_close(now + std::time::Duration::from_secs(10)));
        assert_eq!(
            rotation.take_reconnect(now + std::time::Duration::from_secs(10)),
            Some(None)
        );
    }

    #[test]
    fn rapid_close_after_connect_gives_up() {
        let now = tokio::time::Instant::now();
        let mut rotation = RotationState::default();
        rotation.connected(now);
        assert!(rotation.note_close(now + std::time::Duration::from_millis(100)));
        assert_eq!(
            rotation.take_reconnect(now + std::time::Duration::from_millis(100)),
            Some(None)
        );
        rotation.connected(now + std::time::Duration::from_millis(200));
        assert!(rotation.note_close(now + std::time::Duration::from_millis(300)));
        rotation.connected(now + std::time::Duration::from_millis(400));
        assert!(!rotation.note_close(now + std::time::Duration::from_millis(500)));
    }

    #[test]
    fn failed_opens_give_up_after_three_retries() {
        let now = tokio::time::Instant::now();
        let mut rotation = RotationState::default();
        rotation.note_go_away(Some(std::time::Duration::from_secs(5)), now);
        assert_eq!(rotation.take_reconnect(now), Some(None));
        assert!(rotation
            .retry_after(now, std::time::Duration::from_millis(250))
            .is_some());
        assert!(rotation
            .retry_after(now, std::time::Duration::from_millis(250))
            .is_some());
        assert!(rotation
            .retry_after(now, std::time::Duration::from_millis(250))
            .is_none());
    }

    #[test]
    fn transition_gate_orders_old_final_before_new_events_exactly_once() {
        fn event(text: &'static str) -> SttEvent {
            SttEvent {
                text: text.into(),
                boundary: "final",
                provider_offset_ms: None,
                terminal: false,
            }
        }

        let mut gate = TranscriptGate::default();
        let mut delivered = Vec::new();
        gate.begin_rotation();

        let active = gate.active_events(vec![event("new")]);
        assert!(
            active.is_none(),
            "replacement events must wait for old drain"
        );
        delivered.push(event("old"));
        let (buffered, active_failed) = gate.finish_rotation();
        assert!(!active_failed);
        for batch in buffered {
            delivered.extend(batch);
        }

        assert_eq!(
            delivered
                .into_iter()
                .map(|event| event.text)
                .collect::<Vec<_>>(),
            ["old", "new"]
        );
    }

    #[test]
    fn active_close_waits_for_old_drain_and_deadline_unlocks_gate() {
        let now = tokio::time::Instant::now();
        assert_eq!(
            retirement_deadline(Some(now), now),
            now + std::time::Duration::from_secs(1)
        );

        let mut gate = TranscriptGate::default();
        let mut delivered = vec!["old final".to_owned()];
        gate.begin_rotation();
        assert!(gate
            .active_events(vec![SttEvent {
                text: "new final".into(),
                boundary: "final",
                provider_offset_ms: None,
                terminal: false,
            }])
            .is_none());
        assert!(gate.defer_active_failure());

        let (buffered, active_failed) = gate.finish_rotation();
        for batch in buffered {
            delivered.extend(batch.into_iter().map(|event| event.text));
        }
        assert_eq!(delivered, ["old final", "new final"]);
        assert!(
            active_failed,
            "provider error must be reported after transcripts"
        );
        assert!(
            gate.can_read_active(),
            "deadline must release the bounded gate"
        );
    }
}
