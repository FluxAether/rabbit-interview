use once_cell::sync::Lazy;
use serde::Serialize;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Instant;

const SAMPLE_RATE: f64 = 16_000.0;
const BUCKETS_MS: [u64; 14] = [
    1, 2, 5, 10, 20, 40, 80, 160, 320, 640, 1000, 2000, 5000, 10000,
];
static CLOCK: Lazy<Instant> = Lazy::new(Instant::now);
pub fn clock_ms() -> f64 {
    CLOCK.elapsed().as_secs_f64() * 1000.0
}

#[derive(Default)]
struct SourceMetrics {
    callbacks: AtomicU64,
    samples: AtomicU64,
    queued: AtomicU64,
    dropped: AtomicU64,
    expired: AtomicU64,
    reconnects: AtomicU64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeMetricsSnapshot {
    pub last_turn_e2e_ms: Option<f64>,
    pub llm_ttft_ms: Option<f64>,
    pub last_events: BTreeMap<String, f64>,
    pub clock_ms: f64,
    pub elapsed_ms: u64,
    pub audio_callbacks: u64,
    pub captured_samples: u64,
    pub audio_ipc_events: u64,
    pub audio_ipc_bytes: u64,
    pub audio_callbacks_per_second: f64,
    pub captured_samples_per_second: f64,
    pub audio_ipc_events_per_second: f64,
    pub audio_ipc_kb_per_second: f64,
    pub stt_queue_ms: f64,
    pub system_stt_queue_ms: f64,
    pub microphone_stt_queue_ms: f64,
    pub recorder_queue_ms: f64,
    pub dropped_audio_ms: f64,
    pub recorder_dropped_ms: f64,
    pub expired_audio_ms: f64,
    pub capture_backlog_dropped_ms: f64,
    pub stt_reconnects: u64,
    pub system_capture_callbacks: u64,
    pub microphone_capture_callbacks: u64,
    pub mixer_pending_frames: u64,
    pub capture_dispatch_p95_ms: Option<u64>,
}
struct RealtimeMetrics {
    started_at: Mutex<Instant>,
    sources: [SourceMetrics; 2],
    audio_ipc_events: AtomicU64,
    audio_ipc_bytes: AtomicU64,
    recorder_queued: AtomicU64,
    recorder_dropped: AtomicU64,
    capture_dropped: AtomicU64,
    mixer_pending: AtomicU64,
    dispatch: [AtomicU64; 15],
    turn: Mutex<TurnMetrics>,
}
impl Default for RealtimeMetrics {
    fn default() -> Self {
        Self {
            started_at: Mutex::new(Instant::now()),
            sources: std::array::from_fn(|_| SourceMetrics::default()),
            audio_ipc_events: AtomicU64::new(0),
            audio_ipc_bytes: AtomicU64::new(0),
            recorder_queued: AtomicU64::new(0),
            recorder_dropped: AtomicU64::new(0),
            capture_dropped: AtomicU64::new(0),
            mixer_pending: AtomicU64::new(0),
            dispatch: std::array::from_fn(|_| AtomicU64::new(0)),
            turn: Mutex::new(TurnMetrics::default()),
        }
    }
}
fn index(source: &str) -> usize {
    usize::from(source == "microphone")
}
fn read(counter: &AtomicU64) -> u64 {
    counter.load(Ordering::Relaxed)
}
static METRICS: Lazy<RealtimeMetrics> = Lazy::new(RealtimeMetrics::default);
pub fn record_capture(source: &str, samples: usize, _captured_at: Instant) {
    let source = &METRICS.sources[index(source)];
    source.callbacks.fetch_add(1, Ordering::Relaxed);
    source.samples.fetch_add(samples as u64, Ordering::Relaxed);
}
pub fn record_dispatch(captured_at: Instant) {
    let ms = captured_at.elapsed().as_millis() as u64;
    let bucket = BUCKETS_MS
        .iter()
        .position(|bound| ms <= *bound)
        .unwrap_or(14);
    METRICS.dispatch[bucket].fetch_add(1, Ordering::Relaxed);
}
pub fn record_audio_ipc(_source: &str, bytes: usize) {
    METRICS.audio_ipc_events.fetch_add(1, Ordering::Relaxed);
    METRICS
        .audio_ipc_bytes
        .fetch_add(bytes as u64, Ordering::Relaxed);
}
pub fn record_stt_queue(source: &str, samples: usize) {
    if source == "all" {
        for source in &METRICS.sources {
            source.queued.store(0, Ordering::Relaxed);
        }
    } else {
        METRICS.sources[index(source)]
            .queued
            .store(samples as u64, Ordering::Relaxed);
    }
}
pub fn record_recorder_queue(samples: usize) {
    METRICS
        .recorder_queued
        .store(samples as u64, Ordering::Relaxed);
}
pub fn record_stt_drop(source: &str, samples: usize, expired: bool) {
    let source = &METRICS.sources[index(source)];
    source.dropped.fetch_add(samples as u64, Ordering::Relaxed);
    if expired {
        source.expired.fetch_add(samples as u64, Ordering::Relaxed);
    }
}
pub fn record_recorder_drop(samples: usize) {
    METRICS
        .recorder_dropped
        .fetch_add(samples as u64, Ordering::Relaxed);
}
pub fn record_capture_drop(samples: usize) {
    METRICS
        .capture_dropped
        .fetch_add(samples as u64, Ordering::Relaxed);
}
pub fn record_stt_reconnect(source: &str) {
    METRICS.sources[index(source)]
        .reconnects
        .fetch_add(1, Ordering::Relaxed);
}
pub fn record_mixer_pending(frames: usize) {
    METRICS
        .mixer_pending
        .store(frames as u64, Ordering::Relaxed);
}
impl RealtimeMetrics {
    fn snapshot(&self) -> RealtimeMetricsSnapshot {
        let elapsed = self
            .started_at
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .elapsed();
        let seconds = elapsed.as_secs_f64().max(0.001);
        let sum = |select: fn(&SourceMetrics) -> &AtomicU64| {
            self.sources.iter().map(|s| read(select(s))).sum::<u64>()
        };
        let callbacks = sum(|s| &s.callbacks);
        let samples = sum(|s| &s.samples);
        let total = self.dispatch.iter().map(read).sum::<u64>();
        let mut accumulated = 0;
        let p95 = if total == 0 {
            None
        } else {
            self.dispatch.iter().enumerate().find_map(|(i, counter)| {
                accumulated += read(counter);
                (accumulated >= (total * 95).div_ceil(100))
                    .then_some(BUCKETS_MS.get(i).copied().unwrap_or(u64::MAX))
            })
        };
        let turn = self.turn.lock().unwrap_or_else(|e| e.into_inner());
        let delta = |end: &str, start: &str| {
            turn.events
                .get(end)
                .zip(turn.events.get(start))
                .map(|(end, start)| (end - start).max(0.0))
        };
        RealtimeMetricsSnapshot {
            last_turn_e2e_ms: turn
                .events
                .get("ui.firstPaint")
                .zip(turn.answer_sealed.as_ref())
                .map(|(paint, sealed)| (paint - sealed).max(0.0)),
            llm_ttft_ms: delta("llm.firstDelta", "llm.requestStart"),
            last_events: turn.events.clone(),
            clock_ms: clock_ms(),
            elapsed_ms: elapsed.as_millis().min(u128::from(u64::MAX)) as u64,
            audio_callbacks: callbacks,
            captured_samples: samples,
            audio_ipc_events: read(&self.audio_ipc_events),
            audio_ipc_bytes: read(&self.audio_ipc_bytes),
            audio_callbacks_per_second: callbacks as f64 / seconds,
            captured_samples_per_second: samples as f64 / seconds,
            audio_ipc_events_per_second: read(&self.audio_ipc_events) as f64 / seconds,
            audio_ipc_kb_per_second: read(&self.audio_ipc_bytes) as f64 / 1024.0 / seconds,
            stt_queue_ms: sum(|s| &s.queued) as f64 * 1000.0 / SAMPLE_RATE,
            system_stt_queue_ms: read(&self.sources[0].queued) as f64 * 1000.0 / SAMPLE_RATE,
            microphone_stt_queue_ms: read(&self.sources[1].queued) as f64 * 1000.0 / SAMPLE_RATE,
            recorder_queue_ms: read(&self.recorder_queued) as f64 * 1000.0 / SAMPLE_RATE,
            dropped_audio_ms: sum(|s| &s.dropped) as f64 * 1000.0 / SAMPLE_RATE,
            recorder_dropped_ms: read(&self.recorder_dropped) as f64 * 1000.0 / SAMPLE_RATE,
            expired_audio_ms: sum(|s| &s.expired) as f64 * 1000.0 / SAMPLE_RATE,
            capture_backlog_dropped_ms: read(&self.capture_dropped) as f64 * 1000.0 / SAMPLE_RATE,
            stt_reconnects: sum(|s| &s.reconnects),
            system_capture_callbacks: read(&self.sources[0].callbacks),
            microphone_capture_callbacks: read(&self.sources[1].callbacks),
            mixer_pending_frames: read(&self.mixer_pending),
            capture_dispatch_p95_ms: p95,
        }
    }
    fn reset(&self) {
        *self.turn.lock().unwrap_or_else(|e| e.into_inner()) = TurnMetrics::default();
        *self.started_at.lock().unwrap_or_else(|e| e.into_inner()) = Instant::now();
        for source in &self.sources {
            for counter in [
                &source.callbacks,
                &source.samples,
                &source.dropped,
                &source.expired,
                &source.reconnects,
            ] {
                counter.store(0, Ordering::Relaxed);
            }
        }
        // Queue gauges belong to active workers and survive a metrics reset.
        for counter in [
            &self.audio_ipc_events,
            &self.audio_ipc_bytes,
            &self.recorder_dropped,
            &self.capture_dropped,
        ] {
            counter.store(0, Ordering::Relaxed);
        }
        for counter in &self.dispatch {
            counter.store(0, Ordering::Relaxed);
        }
    }
}
pub fn snapshot() -> RealtimeMetricsSnapshot {
    METRICS.snapshot()
}
pub fn reset() {
    METRICS.reset();
}
#[derive(Default)]
struct TurnMetrics {
    answer_id: Option<u64>,
    answer_sealed: Option<f64>,
    sealed_questions: BTreeMap<u64, f64>,
    events: BTreeMap<String, f64>,
}
impl TurnMetrics {
    fn record(&mut self, event: &str, answer_id: Option<u64>, question_id: Option<u64>, now: f64) {
        match event {
            "reset" => {
                *self = Self::default();
                return;
            }
            "llm.requestStart" => {
                self.answer_id = answer_id;
                self.answer_sealed =
                    question_id.and_then(|id| self.sealed_questions.get(&id).copied());
                self.events.remove("llm.firstDelta");
                self.events.remove("ui.firstPaint");
            }
            "llm.firstDelta" | "ui.firstPaint" => {
                if answer_id.is_none()
                    || answer_id != self.answer_id
                    || self.events.contains_key(event)
                {
                    return;
                }
            }
            "turn.sealed" => {
                if let Some(id) = question_id {
                    self.sealed_questions.insert(id, now);
                    // Metrics retain only recent questions; an evicted question has no E2E sample.
                    if self.sealed_questions.len() > 256 {
                        self.sealed_questions.pop_first();
                    }
                }
            }
            "stt.firstInterim" if self.events.contains_key(event) => return,
            "stt.connected" | "stt.firstInterim" | "stt.speechFinal" => {}
            _ => return,
        }
        self.events.insert(event.to_string(), now);
    }
}
#[tauri::command]
pub fn record_realtime_event(event: String, answer_id: Option<u64>, question_id: Option<u64>) {
    METRICS
        .turn
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .record(&event, answer_id, question_id, clock_ms());
}

#[tauri::command]
pub fn get_realtime_metrics() -> RealtimeMetricsSnapshot {
    snapshot()
}
#[tauri::command]
pub fn reset_realtime_metrics() {
    reset();
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn first_paint_is_owned_and_recorded_once() {
        let mut turn = TurnMetrics::default();
        turn.record("turn.sealed", None, Some(10), 10.0);
        turn.record("llm.requestStart", Some(1), Some(10), 20.0);
        turn.record("ui.firstPaint", Some(99), None, 25.0);
        assert!(!turn.events.contains_key("ui.firstPaint"));
        turn.record("ui.firstPaint", Some(1), None, 30.0);
        turn.record("ui.firstPaint", Some(1), None, 90.0);
        turn.record("turn.sealed", None, Some(20), 100.0);
        assert_eq!(turn.events["ui.firstPaint"], 30.0);
        assert_eq!(turn.answer_sealed, Some(10.0));
        turn.record("llm.requestStart", Some(2), Some(20), 110.0);
        turn.record("ui.firstPaint", Some(1), None, 120.0);
        assert!(!turn.events.contains_key("ui.firstPaint"));
        turn.record("ui.firstPaint", Some(2), None, 130.0);
        assert_eq!(turn.events["ui.firstPaint"], 130.0);
        turn.record("llm.requestStart", Some(3), Some(10), 140.0);
        assert_eq!(turn.answer_sealed, Some(10.0));
    }

    #[test]
    fn independent_sources_sum_and_reset_preserves_live_gauges() {
        let metrics = RealtimeMetrics::default();
        metrics.sources[0].queued.store(320, Ordering::Relaxed);
        metrics.sources[1].queued.store(160, Ordering::Relaxed);
        metrics.recorder_dropped.store(160, Ordering::Relaxed);
        let value = metrics.snapshot();
        assert_eq!(value.stt_queue_ms, 30.0);
        assert_eq!(value.system_stt_queue_ms, 20.0);
        assert_eq!(value.microphone_stt_queue_ms, 10.0);
        assert_eq!(value.recorder_dropped_ms, 10.0);
        assert_eq!(value.dropped_audio_ms, 0.0);
        metrics.reset();
        assert_eq!(metrics.snapshot().stt_queue_ms, 30.0);
        assert_eq!(metrics.snapshot().recorder_dropped_ms, 0.0);
    }
}
