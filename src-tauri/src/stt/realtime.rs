use super::{apple, deepgram, gemini, hosted};
use crate::realtime_metrics;
use futures_util::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};
use tokio::sync::{oneshot, watch};
use tokio_tungstenite::tungstenite::Message;

const TRANSCRIPT_EVENT: &str = "stt-transcript";
const ERROR_EVENT: &str = "stt-error";
const MAX_STT_QUEUE_MS: u64 = 750;
const MAX_FRAME_AGE_MS: u128 = 1_000;
const SEND_TICK_MS: u64 = 8;
const KEEPALIVE_SECONDS: u64 = 5;
const CONNECT_TIMEOUT_SECONDS: u64 = 8;
const RECONNECT_BASE_MS: u64 = 250;
const RECONNECT_MAX_MS: u64 = 4_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AudioRoute {
    Native,
    Apple,
    Webview,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeSttConfig {
    pub provider: String,
    pub source: String,
    pub capture_id: u64,
    pub sources: Option<Vec<String>>,
    pub sample_rate: u32,
    pub session_id: Option<u64>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub language: String,
    pub app_language: Option<String>,
    pub endpointing_ms: Option<u64>,
    pub utterance_end_ms: Option<u64>,
    pub ws_url: Option<String>,
    pub ws_ticket: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeSttStatus {
    pub provider: String,
    pub source: String,
    pub session_id: u64,
    pub generation: u64,
    pub state: String,
    pub queue_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptEvent {
    pub session_id: u64,
    pub generation: u64,
    pub source: String,
    pub text: String,
    pub is_final: bool,
    pub boundary: String,
    pub sequence: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeSttErrorEvent {
    pub session_id: u64,
    pub generation: u64,
    pub source: String,
    pub message: String,
    pub retryable: bool,
}

pub struct AudioFrame {
    pub sequence: u64,
    pub captured_at: Instant,
    pub sample_rate: u32,
    pub samples: Box<[f32]>,
}

struct AudioFrameQueue {
    source: String,
    sample_rate: u32,
    frames: Mutex<VecDeque<AudioFrame>>,
    queued_samples: AtomicU64,
    next_sequence: AtomicU64,
}

impl AudioFrameQueue {
    fn new(source: String, sample_rate: u32) -> Self {
        Self {
            source,
            sample_rate,
            frames: Mutex::new(VecDeque::new()),
            queued_samples: AtomicU64::new(0),
            next_sequence: AtomicU64::new(1),
        }
    }

    fn max_samples(&self) -> u64 {
        u64::from(self.sample_rate)
            .saturating_mul(MAX_STT_QUEUE_MS)
            .saturating_div(1_000)
            .max(1)
    }

    fn queue_ms(&self) -> f64 {
        self.queued_samples.load(Ordering::Relaxed) as f64 * 1_000.0
            / f64::from(self.sample_rate.max(1))
    }

    fn try_push(&self, samples: &[f32], accept: &AtomicBool) {
        if samples.is_empty() {
            return;
        }
        let max_samples = self.max_samples() as usize;
        let samples = if samples.len() > max_samples {
            realtime_metrics::record_stt_drop(&self.source, samples.len() - max_samples, false);
            &samples[samples.len() - max_samples..]
        } else {
            samples
        };

        let Ok(mut frames) = self.frames.try_lock() else {
            realtime_metrics::record_stt_drop(&self.source, samples.len(), false);
            return;
        };

        if !accept.load(Ordering::SeqCst) {
            return;
        }
        let mut queued = self.queued_samples.load(Ordering::Relaxed);
        while queued.saturating_add(samples.len() as u64) > self.max_samples() {
            let Some(dropped) = frames.pop_front() else {
                break;
            };
            queued = queued.saturating_sub(dropped.samples.len() as u64);
            realtime_metrics::record_stt_drop(&self.source, dropped.samples.len(), false);
        }

        let frame = AudioFrame {
            sequence: self.next_sequence.fetch_add(1, Ordering::Relaxed),
            captured_at: Instant::now(),
            sample_rate: self.sample_rate,
            samples: samples.to_vec().into_boxed_slice(),
        };
        queued = queued.saturating_add(frame.samples.len() as u64);
        frames.push_back(frame);
        self.queued_samples.store(queued, Ordering::Relaxed);
        realtime_metrics::record_stt_queue(&self.source, queued as usize);
    }

    fn clear(&self) {
        let mut frames = self.frames.lock().unwrap_or_else(|e| e.into_inner());
        frames.clear();
        self.queued_samples.store(0, Ordering::Relaxed);
        realtime_metrics::record_stt_queue(&self.source, 0);
    }

    fn pop(&self) -> Option<AudioFrame> {
        let mut frames = self
            .frames
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let frame = frames.pop_front()?;
        let queued = self
            .queued_samples
            .fetch_sub(frame.samples.len() as u64, Ordering::Relaxed)
            .saturating_sub(frame.samples.len() as u64);
        realtime_metrics::record_stt_queue(&self.source, queued as usize);
        Some(frame)
    }
}

struct SessionHandle {
    capture_id: u64,
    generation: u64,
    session_id: u64,
    provider: String,
    accept_audio: Arc<AtomicBool>,
    queue: Arc<AudioFrameQueue>,
    stop: watch::Sender<bool>,
}

static SESSIONS: Lazy<Mutex<HashMap<String, SessionHandle>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
static APPLE_START: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static GENERATION: AtomicU64 = AtomicU64::new(1);
static SESSION_ID: AtomicU64 = AtomicU64::new(1);

pub struct RealtimeSttSession;

impl RealtimeSttSession {
    pub async fn start(
        config: RealtimeSttConfig,
        app: AppHandle,
    ) -> Result<RealtimeSttStatus, String> {
        validate_config(&config)?;
        let _apple_start = if config.provider == "apple" {
            Some(APPLE_START.lock().await)
        } else {
            None
        };
        let sources = if config.provider == "apple" {
            config
                .sources
                .clone()
                .unwrap_or_else(|| vec![config.source.clone()])
        } else {
            vec![config.source.clone()]
        };
        if !sources.contains(&config.source) {
            return Err("STT source is missing from source set".into());
        }
        let generation = GENERATION.fetch_add(1, Ordering::Relaxed);
        let session_id = config
            .session_id
            .filter(|value| *value > 0)
            .unwrap_or_else(|| SESSION_ID.fetch_add(1, Ordering::Relaxed));
        let queue = Arc::new(AudioFrameQueue::new(
            config.source.clone(),
            config.sample_rate,
        ));
        // The frontend enables forwarding only after accepting this acquisition.
        let accept_audio = Arc::new(AtomicBool::new(false));
        let (stop_tx, stop_rx) = watch::channel(false);
        let existing = crate::audio::with_capture_lease(config.capture_id, &sources, || {
            let mut sessions = SESSIONS.lock().unwrap_or_else(|error| error.into_inner());
            if config.provider == "apple"
                && sources.iter().all(|source| {
                    sessions
                        .get(source)
                        .is_some_and(|s| s.capture_id == config.capture_id && s.provider == "apple")
                })
            {
                return Ok(sessions
                    .get(&config.source)
                    .map(|session| session.generation));
            }
            if sources.iter().any(|source| sessions.contains_key(source)) {
                return Err(
                    "STT source is already owned; stop the matching generation first".into(),
                );
            }
            for source in &sources {
                sessions.insert(
                    source.clone(),
                    SessionHandle {
                        capture_id: config.capture_id,
                        generation,
                        session_id,
                        provider: config.provider.clone(),
                        accept_audio: if source == &config.source {
                            Arc::clone(&accept_audio)
                        } else {
                            Arc::new(AtomicBool::new(false))
                        },
                        queue: if source == &config.source {
                            Arc::clone(&queue)
                        } else {
                            Arc::new(AudioFrameQueue::new(source.clone(), config.sample_rate))
                        },
                        stop: stop_tx.clone(),
                    },
                );
            }
            Ok(None)
        })?;
        if let Some(existing) = existing {
            return status_for(&config.source, existing);
        }

        if config.provider == "apple" {
            let language = config.language.clone();
            let apple_sources = sources.clone();
            let result = tokio::task::spawn_blocking(move || {
                apple::start_owned(&apple_sources, &language, generation)
            })
            .await
            .map_err(|error| error.to_string())
            .and_then(|result| result);
            if result.is_err() || !is_generation(&config.source, generation) {
                for source in &sources {
                    stop_source(source, config.capture_id, generation);
                }
                return Err(result
                    .err()
                    .unwrap_or_else(|| "Apple STT startup was cancelled".into()));
            }
            return status_for(&config.source, generation);
        }

        let (ready_tx, ready_rx) = oneshot::channel();
        let capture_id = config.capture_id;
        let worker_source = config.source.clone();
        let cleanup_source = worker_source.clone();
        tauri::async_runtime::spawn(async move {
            let mut cancellation = stop_rx.clone();
            if !*cancellation.borrow() {
                tokio::select! {
                    biased;
                    _ = cancellation.changed() => {}
                    _ = run_session(config, session_id, generation, queue, accept_audio, stop_rx, ready_tx, app) => {}
                }
            }
            remove_if_generation(&cleanup_source, generation);
        });

        wait_ready(
            &worker_source,
            capture_id,
            generation,
            ready_rx,
            Duration::from_secs(CONNECT_TIMEOUT_SECONDS + 1),
        )
        .await?;
        status_for(&worker_source, generation)
    }

    pub fn try_push(source: &str, samples: &[f32]) -> bool {
        let session = SESSIONS
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .get(source)
            .map(|session| {
                (
                    session.provider.clone(),
                    Arc::clone(&session.accept_audio),
                    Arc::clone(&session.queue),
                )
            });
        let Some((provider, accept, queue)) = session else {
            return false;
        };
        if !accept.load(Ordering::Relaxed) {
            return true;
        }
        if provider == "apple" {
            apple::push_samples(source, samples);
            return true;
        }
        queue.try_push(samples, &accept);
        true
    }

    pub fn set_accept_audio(source: &str, capture_id: u64, generation: u64, accept: bool) {
        let sessions = SESSIONS.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(session) = sessions
            .get(source)
            .filter(|s| s.capture_id == capture_id && s.generation == generation)
        {
            session.accept_audio.store(accept, Ordering::SeqCst);
            if !accept {
                session.queue.clear();
            }
        }
    }

    pub fn stop_all() {
        let sessions = {
            let mut sessions = SESSIONS.lock().unwrap_or_else(|error| error.into_inner());
            sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        for session in sessions {
            session.accept_audio.store(false, Ordering::SeqCst);
            session.queue.clear();
            let _ = session.stop.send(true);
        }
        apple::stop();
        realtime_metrics::record_stt_queue("all", 0);
    }
}

async fn wait_ready(
    source: &str,
    capture_id: u64,
    generation: u64,
    ready_rx: oneshot::Receiver<Result<(), String>>,
    timeout: Duration,
) -> Result<(), String> {
    let result = tokio::time::timeout(timeout, ready_rx)
        .await
        .map_err(|_| "Realtime STT connection timed out".to_string())
        .and_then(|result| {
            result.map_err(|_| "Realtime STT worker stopped during startup".to_string())
        })
        .and_then(|result| result);
    if result.is_err() {
        stop_source(source, capture_id, generation);
    }
    result
}

fn validate_config(config: &RealtimeSttConfig) -> Result<(), String> {
    if !matches!(config.source.as_str(), "system" | "microphone") {
        return Err("Realtime STT source must be system or microphone".into());
    }
    if config.sample_rate == 0 {
        return Err("Realtime STT sample rate must be greater than zero".into());
    }
    match config.provider.as_str() {
        "deepgram" | "gemini" => {
            if config.api_key.as_deref().unwrap_or("").trim().is_empty() {
                return Err(format!("No {} API key is configured", config.provider));
            }
        }
        "hosted" => {
            if config.ws_url.as_deref().unwrap_or("").trim().is_empty()
                || config.ws_ticket.as_deref().unwrap_or("").trim().is_empty()
            {
                return Err("Hosted STT session is missing".into());
            }
        }
        "apple" => {}
        other => {
            return Err(format!(
                "Native realtime STT does not support provider {other}"
            ))
        }
    }
    Ok(())
}

fn status_for(source: &str, generation: u64) -> Result<RealtimeSttStatus, String> {
    let sessions = SESSIONS.lock().unwrap_or_else(|error| error.into_inner());
    let session = sessions
        .get(source)
        .filter(|s| s.generation == generation)
        .ok_or_else(|| "Realtime STT startup was cancelled".to_string())?;
    Ok(RealtimeSttStatus {
        provider: session.provider.clone(),
        source: source.to_string(),
        session_id: session.session_id,
        generation: session.generation,
        state: "ready".into(),
        queue_ms: session.queue.queue_ms(),
    })
}

pub(crate) fn is_generation(source: &str, generation: u64) -> bool {
    SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(source)
        .is_some_and(|session| session.generation == generation)
}

fn stop_source(source: &str, capture_id: u64, generation: u64) {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|e| e.into_inner());
    if !sessions
        .get(source)
        .is_some_and(|s| s.capture_id == capture_id && s.generation == generation)
    {
        return;
    }
    if let Some(session) = sessions.remove(source) {
        session.accept_audio.store(false, Ordering::SeqCst);
        session.queue.clear();
        let _ = session.stop.send(true);
        realtime_metrics::record_stt_queue(source, 0);
        if session.provider == "apple" && !sessions.values().any(|s| s.provider == "apple") {
            drop(sessions);
            apple::stop();
        }
    }
}

fn remove_if_generation(source: &str, generation: u64) {
    let mut sessions = SESSIONS.lock().unwrap_or_else(|error| error.into_inner());
    if sessions
        .get(source)
        .is_some_and(|session| session.generation == generation)
    {
        sessions.remove(source);
        realtime_metrics::record_stt_queue(source, 0);
    }
}

pub(crate) fn apple_identity(source: &str) -> Option<(u64, u64)> {
    SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(source)
        .filter(|s| s.provider == "apple")
        .map(|s| (s.session_id, s.generation))
}

pub(crate) fn has_apple_sessions() -> bool {
    SESSIONS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .values()
        .any(|s| s.provider == "apple")
}

pub fn route_audio(source: &str, samples: &[f32]) -> AudioRoute {
    let provider = SESSIONS
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .get(source)
        .map(|session| session.provider.clone());
    match provider.as_deref() {
        Some("apple") => {
            RealtimeSttSession::try_push(source, samples);
            AudioRoute::Apple
        }
        Some(_) => {
            RealtimeSttSession::try_push(source, samples);
            AudioRoute::Native
        }
        None if apple::is_active() && !has_apple_sessions() => {
            apple::push_samples(source, samples);
            AudioRoute::Apple
        }
        None => AudioRoute::Webview,
    }
}

async fn run_session(
    config: RealtimeSttConfig,
    session_id: u64,
    generation: u64,
    queue: Arc<AudioFrameQueue>,
    accept_audio: Arc<AtomicBool>,
    mut stop_rx: watch::Receiver<bool>,
    ready_tx: oneshot::Sender<Result<(), String>>,
    app: AppHandle,
) {
    let mut ready_tx = Some(ready_tx);
    let mut reconnect_attempt = 0_u32;
    let mut ever_connected = false;
    let mut gemini_final_seen = false;
    let mut gemini_utterance_ended = false;

    loop {
        if *stop_rx.borrow() {
            if let Some(ready) = ready_tx.take() {
                let _ = ready.send(Err("Realtime STT stopped during startup".into()));
            }
            return;
        }

        let request = match config.provider.as_str() {
            "deepgram" => deepgram::build_request(&config),
            "gemini" => gemini::build_request(&config),
            "hosted" => hosted::build_request(&config),
            other => Err(format!(
                "Native realtime STT does not support provider {other}"
            )),
        };
        let request = match request {
            Ok(request) => request,
            Err(error) => {
                if let Some(ready) = ready_tx.take() {
                    let _ = ready.send(Err(error));
                }
                return;
            }
        };
        let connection = tokio::select! {
            _ = stop_rx.changed() => return,
            connection = tokio::time::timeout(
            Duration::from_secs(CONNECT_TIMEOUT_SECONDS),
            tokio_tungstenite::connect_async(request),
        ) => connection,
        };
        let socket = match connection {
            Ok(Ok((socket, _response))) => socket,
            Ok(Err(error)) => {
                let message = format!(
                    "{} connection failed: {error}",
                    display_name(&config.provider)
                );
                emit_error(&app, session_id, generation, &config.source, &message);
                if !ever_connected {
                    if let Some(ready) = ready_tx.take() {
                        let _ = ready.send(Err(message));
                    }
                    return;
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                wait_before_reconnect(reconnect_attempt, &mut stop_rx).await;
                continue;
            }
            Err(_) => {
                let message = format!("{} connection timed out", display_name(&config.provider));
                emit_error(&app, session_id, generation, &config.source, &message);
                if !ever_connected {
                    if let Some(ready) = ready_tx.take() {
                        let _ = ready.send(Err(message));
                    }
                    return;
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                wait_before_reconnect(reconnect_attempt, &mut stop_rx).await;
                continue;
            }
        };

        let outcome = run_connected_socket(
            socket,
            &config,
            session_id,
            generation,
            Arc::clone(&queue),
            Arc::clone(&accept_audio),
            &mut stop_rx,
            &app,
            ready_tx.take(),
            &mut gemini_final_seen,
            &mut gemini_utterance_ended,
        )
        .await;
        match outcome {
            SocketOutcome::Stopped => return,
            SocketOutcome::ReadyFailed(error) => {
                emit_error(&app, session_id, generation, &config.source, &error);
                return;
            }
            SocketOutcome::Ended { reconnect, message } => {
                if ever_connected {
                    realtime_metrics::record_stt_reconnect(&config.source);
                }
                ever_connected = true;
                if !reconnect || config.provider == "hosted" {
                    emit_error_with_retry(
                        &app,
                        session_id,
                        generation,
                        &config.source,
                        &message,
                        reconnect,
                    );
                    return;
                }
                reconnect_attempt = reconnect_attempt.saturating_add(1);
                emit_error(&app, session_id, generation, &config.source, &message);
                wait_before_reconnect(reconnect_attempt, &mut stop_rx).await;
            }
        }
    }
}

enum SocketOutcome {
    Stopped,
    ReadyFailed(String),
    Ended { reconnect: bool, message: String },
}

async fn run_connected_socket<S>(
    socket: tokio_tungstenite::WebSocketStream<S>,
    config: &RealtimeSttConfig,
    session_id: u64,
    generation: u64,
    queue: Arc<AudioFrameQueue>,
    accept_audio: Arc<AtomicBool>,
    stop_rx: &mut watch::Receiver<bool>,
    app: &AppHandle,
    mut ready_tx: Option<oneshot::Sender<Result<(), String>>>,
    gemini_final_seen: &mut bool,
    gemini_utterance_ended: &mut bool,
) -> SocketOutcome
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    let (mut writer, mut reader) = socket.split();
    let mut send_tick = tokio::time::interval(Duration::from_millis(SEND_TICK_MS));
    send_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut keepalive = tokio::time::interval(Duration::from_secs(KEEPALIVE_SECONDS));
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_sequence = 0_u64;
    let mut pcm_scratch = Vec::new();
    let mut gemini_timer: Option<tokio::time::Instant> = None;
    let utterance_end = Duration::from_millis(config.utterance_end_ms.unwrap_or(1_500));
    let mut ready = config.provider != "gemini" && config.provider != "hosted";
    if ready {
        if let Some(ready_tx) = ready_tx.take() {
            let _ = ready_tx.send(Ok(()));
        }
    }
    if config.provider == "gemini"
        && writer
            .send(Message::Text(gemini::setup_message(config).into()))
            .await
            .is_err()
    {
        return fail_or_end(ready_tx, ready, "Gemini Live setup failed");
    }

    loop {
        tokio::select! {
            changed = stop_rx.changed() => {
                if changed.is_err() || *stop_rx.borrow() {
                    let _ = match config.provider.as_str() {
                        "hosted" => writer.send(Message::Text(hosted::stop_message().into())).await,
                        "deepgram" => writer.send(Message::Text(r#"{"type":"CloseStream"}"#.into())).await,
                        _ => writer.send(Message::Close(None)).await,
                    };
                    return SocketOutcome::Stopped;
                }
            }
            _ = send_tick.tick() => {
                if !ready || !accept_audio.load(Ordering::Relaxed) {
                    continue;
                }
                for _ in 0..8 {
                    if *stop_rx.borrow() || !accept_audio.load(Ordering::SeqCst) { break; }
                    let Some(frame) = queue.pop() else { break; };
                    realtime_metrics::record_dispatch(frame.captured_at);
                    if frame.captured_at.elapsed().as_millis() > MAX_FRAME_AGE_MS {
                        realtime_metrics::record_stt_drop(&config.source, frame.samples.len(), true);
                        continue;
                    }
                    last_sequence = frame.sequence;
                    fill_pcm16(&mut pcm_scratch, &frame.samples);
                    let send = if config.provider == "gemini" {
                        writer.send(Message::Text(gemini::audio_message(&pcm_scratch).into())).await
                    } else {
                        writer.send(Message::Binary(pcm_scratch.clone())).await
                    };
                    if send.is_err() {
                        return SocketOutcome::Ended {
                            reconnect: true,
                            message: format!("{} disconnected; reconnecting", display_name(&config.provider)),
                        };
                    }
                }
            }
            _ = keepalive.tick(), if config.provider == "deepgram" => {
                if writer.send(Message::Text(r#"{"type":"KeepAlive"}"#.into())).await.is_err() {
                    return SocketOutcome::Ended { reconnect: true, message: "Deepgram disconnected; reconnecting".into() };
                }
            }
            _ = sleep_until_optional(gemini_timer), if gemini_timer.is_some() => {
                gemini_timer = None;
                if *gemini_final_seen && !*gemini_utterance_ended {
                    *gemini_utterance_ended = true;
                    let _ = app.emit(TRANSCRIPT_EVENT, TranscriptEvent {
                        session_id,
                        generation,
                        source: config.source.clone(),
                        text: String::new(),
                        is_final: true,
                        boundary: "utterance-end".into(),
                        sequence: last_sequence,
                    });
                }
            }
            message = reader.next() => {
                match incoming_text(message) {
                    Incoming::Text(payload) => {
                        match handle_provider_message(
                            config, session_id, generation, last_sequence, &payload,
                            gemini_final_seen, gemini_utterance_ended, &mut gemini_timer, utterance_end,
                        ) {
                            Ok(ProviderAction::None) => {}
                            Ok(ProviderAction::Ready) => {
                                ready = true;
                                if let Some(ready_tx) = ready_tx.take() { let _ = ready_tx.send(Ok(())); }
                            }
                            Ok(ProviderAction::Transcript(event)) => { let _ = app.emit(TRANSCRIPT_EVENT, event); }
                            Ok(ProviderAction::Error(message)) => emit_error(app, session_id, generation, &config.source, &message),
                            Ok(ProviderAction::End { reconnect, message }) => {
                                return if !ready {
                                    fail_or_end(ready_tx, ready, &message)
                                } else {
                                    SocketOutcome::Ended { reconnect, message }
                                };
                            }
                            Err(error) => {
                                if !ready { return fail_or_end(ready_tx, ready, &error); }
                                emit_error(app, session_id, generation, &config.source, &error);
                            }
                        }
                    }
                    Incoming::Closed => {
                        return if !ready {
                            fail_or_end(ready_tx, ready, &format!("{} closed before it was ready", display_name(&config.provider)))
                        } else {
                            SocketOutcome::Ended {
                                reconnect: true,
                                message: format!("{} disconnected; reconnecting", display_name(&config.provider)),
                            }
                        };
                    }
                    Incoming::Ignore => {}
                    Incoming::Failed(message) => {
                        emit_error(app, session_id, generation, &config.source, &message);
                        return if !ready {
                            fail_or_end(ready_tx, ready, &message)
                        } else {
                            SocketOutcome::Ended { reconnect: true, message }
                        };
                    }
                }
            }
        }
    }
}

enum Incoming {
    Text(String),
    Closed,
    Ignore,
    Failed(String),
}

fn incoming_text(
    message: Option<Result<Message, tokio_tungstenite::tungstenite::Error>>,
) -> Incoming {
    match message {
        Some(Ok(Message::Text(payload))) => Incoming::Text(payload),
        Some(Ok(Message::Binary(bytes))) => {
            Incoming::Text(String::from_utf8_lossy(&bytes).into_owned())
        }
        Some(Ok(Message::Close(_))) | None => Incoming::Closed,
        Some(Ok(_)) => Incoming::Ignore,
        Some(Err(error)) => Incoming::Failed(error.to_string()),
    }
}

async fn sleep_until_optional(deadline: Option<tokio::time::Instant>) {
    if let Some(deadline) = deadline {
        tokio::time::sleep_until(deadline).await;
    } else {
        std::future::pending::<()>().await;
    }
}

enum ProviderAction {
    None,
    Ready,
    Transcript(TranscriptEvent),
    Error(String),
    End { reconnect: bool, message: String },
}

fn handle_provider_message(
    config: &RealtimeSttConfig,
    session_id: u64,
    generation: u64,
    sequence: u64,
    payload: &str,
    gemini_final_seen: &mut bool,
    gemini_utterance_ended: &mut bool,
    gemini_timer: &mut Option<tokio::time::Instant>,
    utterance_end: Duration,
) -> Result<ProviderAction, String> {
    match config.provider.as_str() {
        "deepgram" => {
            Ok(
                deepgram::parse_message(&config.source, session_id, generation, sequence, payload)?
                    .map(ProviderAction::Transcript)
                    .unwrap_or(ProviderAction::None),
            )
        }
        "gemini" => {
            match gemini::parse_message(&config.source, session_id, generation, sequence, payload)?
            {
                Some(gemini::GeminiEvent::SetupComplete) => Ok(ProviderAction::Ready),
                Some(gemini::GeminiEvent::GoAway) => Ok(ProviderAction::End {
                    reconnect: true,
                    message: "Gemini Live rotating after goAway".into(),
                }),
                Some(gemini::GeminiEvent::Transcript(event)) => {
                    if event.boundary == "interim" || event.boundary == "final" {
                        if *gemini_utterance_ended {
                            *gemini_final_seen = false;
                            *gemini_utterance_ended = false;
                        }
                    }
                    if event.boundary == "final" {
                        *gemini_final_seen = true;
                        *gemini_timer = Some(tokio::time::Instant::now() + utterance_end);
                    }
                    Ok(ProviderAction::Transcript(event))
                }
                None => Ok(ProviderAction::None),
            }
        }
        "hosted" => {
            match hosted::parse_message(&config.source, session_id, generation, sequence, payload)?
            {
                Some(hosted::HostedEvent::Ready) => Ok(ProviderAction::Ready),
                Some(hosted::HostedEvent::Transcript(event)) => {
                    Ok(ProviderAction::Transcript(event))
                }
                Some(hosted::HostedEvent::QuotaWarning(message)) => {
                    Ok(ProviderAction::Error(message))
                }
                Some(hosted::HostedEvent::Ended { reason, reconnect }) => Ok(ProviderAction::End {
                    reconnect,
                    message: format!(
                        "Hosted STT ended ({reason}){}",
                        if reconnect { ", reconnecting." } else { "" }
                    ),
                }),
                None => Ok(ProviderAction::None),
            }
        }
        _ => Ok(ProviderAction::None),
    }
}

fn fail_or_end(
    ready_tx: Option<oneshot::Sender<Result<(), String>>>,
    ready: bool,
    message: &str,
) -> SocketOutcome {
    if !ready {
        if let Some(ready_tx) = ready_tx {
            let _ = ready_tx.send(Err(message.to_string()));
        }
        SocketOutcome::ReadyFailed(message.to_string())
    } else {
        SocketOutcome::Ended {
            reconnect: true,
            message: message.to_string(),
        }
    }
}

fn display_name(provider: &str) -> &str {
    match provider {
        "gemini" => "Gemini Live",
        "hosted" => "Hosted STT",
        "deepgram" => "Deepgram",
        other => other,
    }
}

fn fill_pcm16(buffer: &mut Vec<u8>, samples: &[f32]) {
    buffer.clear();
    buffer.reserve(samples.len().saturating_mul(2));
    for sample in samples {
        let normalized = sample.clamp(-1.0, 1.0);
        let value = if normalized < 0.0 {
            (normalized * 32768.0) as i16
        } else {
            (normalized * 32767.0) as i16
        };
        buffer.extend_from_slice(&value.to_le_bytes());
    }
}

async fn wait_before_reconnect(attempt: u32, stop_rx: &mut watch::Receiver<bool>) {
    let exponent = attempt.saturating_sub(1).min(4);
    let delay = RECONNECT_BASE_MS
        .saturating_mul(2_u64.saturating_pow(exponent))
        .min(RECONNECT_MAX_MS);
    tokio::select! {
        _ = tokio::time::sleep(Duration::from_millis(delay)) => {}
        _ = stop_rx.changed() => {}
    }
}

fn emit_error(app: &AppHandle, session_id: u64, generation: u64, source: &str, message: &str) {
    emit_error_with_retry(app, session_id, generation, source, message, false);
}

fn emit_error_with_retry(
    app: &AppHandle,
    session_id: u64,
    generation: u64,
    source: &str,
    message: &str,
    retryable: bool,
) {
    let _ = app.emit(
        ERROR_EVENT,
        RealtimeSttErrorEvent {
            session_id,
            generation,
            source: source.to_string(),
            message: message.to_string(),
            retryable,
        },
    );
}

pub fn try_push(source: &str, samples: &[f32]) -> bool {
    RealtimeSttSession::try_push(source, samples)
}

pub fn stop_all() {
    RealtimeSttSession::stop_all();
}

#[tauri::command]
pub async fn start_realtime_stt(
    app: AppHandle,
    config: RealtimeSttConfig,
) -> Result<RealtimeSttStatus, String> {
    RealtimeSttSession::start(config, app).await
}

#[tauri::command]
pub async fn stop_realtime_stt(
    source: String,
    capture_id: u64,
    generation: u64,
) -> Result<(), String> {
    stop_source(&source, capture_id, generation);
    Ok(())
}

#[tauri::command]
pub fn set_realtime_stt_accept_audio(
    source: String,
    capture_id: u64,
    generation: u64,
    accept: bool,
) {
    RealtimeSttSession::set_accept_audio(&source, capture_id, generation, accept);
}

#[cfg(test)]
mod tests {
    use super::*;
    static TEST_SESSIONS: Mutex<()> = Mutex::new(());
    use std::sync::atomic::Ordering;

    fn test_session(generation: u64) -> watch::Receiver<bool> {
        let (stop, receiver) = watch::channel(false);
        SESSIONS.lock().unwrap().insert(
            "test".into(),
            SessionHandle {
                capture_id: 10,
                generation,
                session_id: 1,
                provider: "hosted".into(),
                accept_audio: Arc::new(AtomicBool::new(true)),
                queue: Arc::new(AudioFrameQueue::new("test".into(), 16_000)),
                stop,
            },
        );
        receiver
    }

    #[test]
    fn stale_owners_cannot_stop_or_pause_successors() {
        let _lock = TEST_SESSIONS.lock().unwrap();
        let stopped = test_session(2);
        stop_source("test", 9, 2);
        stop_source("test", 10, 1);
        RealtimeSttSession::set_accept_audio("test", 10, 1, false);
        assert!(SESSIONS.lock().unwrap()["test"]
            .accept_audio
            .load(Ordering::Relaxed));
        assert!(!*stopped.borrow());
        RealtimeSttSession::set_accept_audio("test", 10, 2, false);
        assert!(!SESSIONS.lock().unwrap()["test"]
            .accept_audio
            .load(Ordering::Relaxed));
        stop_source("test", 10, 2);
        assert!(*stopped.borrow());
        assert!(!is_generation("test", 2));
    }

    #[test]
    fn readiness_failure_stops_only_its_worker() {
        let _lock = TEST_SESSIONS.lock().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .build()
            .unwrap();
        runtime.block_on(async {
            for failure in 0..3 {
                let stopped = test_session(3);
                let (ready, rx) = oneshot::channel();
                match failure {
                    0 => {
                        drop(ready);
                    }
                    1 => {
                        let _ = ready.send(Err("provider failed".into()));
                    }
                    _ => {
                        // Keep a late readiness sender alive across the timeout.
                        assert!(wait_ready("test", 10, 3, rx, Duration::from_millis(1))
                            .await
                            .is_err());
                        assert!(ready.send(Ok(())).is_err());
                        assert!(*stopped.borrow());
                        continue;
                    }
                }
                assert!(wait_ready("test", 10, 3, rx, Duration::from_millis(1))
                    .await
                    .is_err());
                assert!(*stopped.borrow());
                assert!(!is_generation("test", 3));
            }
            let stopped = test_session(5);
            let (ready, rx) = oneshot::channel();
            drop(ready);
            assert!(wait_ready("test", 10, 4, rx, Duration::from_millis(1))
                .await
                .is_err());
            assert!(!*stopped.borrow());
            stop_source("test", 10, 5);
        });
    }

    #[test]
    fn pause_discards_queued_audio_and_rejects_late_enqueue() {
        let queue = AudioFrameQueue::new("test".into(), 16_000);
        let accept = AtomicBool::new(true);
        queue.try_push(&[0.1; 160], &accept);
        accept.store(false, Ordering::SeqCst);
        queue.clear();
        queue.try_push(&[0.2; 160], &accept);
        assert!(queue.pop().is_none());
        accept.store(true, Ordering::SeqCst);
        queue.try_push(&[0.3; 160], &accept);
        assert_eq!(queue.pop().unwrap().samples[0], 0.3);
    }

    #[test]
    fn pcm_conversion_clamps_and_scales() {
        let mut bytes = Vec::new();
        fill_pcm16(&mut bytes, &[-2.0, 0.0, 1.0]);
        let values = bytes
            .chunks_exact(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();
        assert_eq!(values, vec![i16::MIN, 0, i16::MAX]);
    }

    #[test]
    fn pre_roll_queue_drops_oldest_audio_and_stays_bounded() {
        let queue = AudioFrameQueue::new("system".into(), 1_000);
        queue.try_push(&vec![0.1; 500], &std::sync::atomic::AtomicBool::new(true));
        queue.try_push(&vec![0.2; 500], &std::sync::atomic::AtomicBool::new(true));
        assert!(queue.queued_samples.load(Ordering::Relaxed) <= 750);
        let first = queue.pop().unwrap();
        assert!(first
            .samples
            .iter()
            .all(|sample| (*sample - 0.2).abs() < f32::EPSILON));
    }
}
