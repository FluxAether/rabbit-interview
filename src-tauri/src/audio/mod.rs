mod audiotee;
mod mixer;

#[cfg(target_os = "macos")]
use audiotee::AudioTeeProcess;
use audiotee::{integration_version, AUDIOTEE_SAMPLE_RATE};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Data, FromSample, Sample, SampleFormat, SampleRate, SizedSample, SupportedStreamConfigRange,
};
use mixer::{AudioSource, TimedAudioMixer};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

const TARGET_SAMPLE_RATE: u32 = AUDIOTEE_SAMPLE_RATE;
const MAX_RECORDING_SECONDS: usize = 120 * 60;
// Sleep/wake can deliver multi-second audio backlog in one callback. Bound work per push.
const MAX_SOURCE_CHUNK_SAMPLES: usize = TARGET_SAMPLE_RATE as usize; // 1s
const MAX_RECORDING_WRITE_SAMPLES: usize = TARGET_SAMPLE_RATE as usize * 2; // 2s
const RECORDING_FLUSH_EVERY_SAMPLES: u64 = TARGET_SAMPLE_RATE as u64 / 2; // ~500ms
const AMPLITUDE_EMIT_MIN_INTERVAL_MS: u128 = 50;
// After wake, device/pipe backlog can arrive faster than realtime. Allow a short
// burst, then drop excess so mixer/IPC/STT cannot spin at full speed.
const CATCHUP_BURST_SAMPLES: u64 = TARGET_SAMPLE_RATE as u64; // 1s

enum AudioCommand {
    Stop,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioConfigPayload {
    pub sample_rate: u32,
    pub device: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize)]
struct AudioSourceChunkPayload {
    source: &'static str,
    samples: Vec<f32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioCapabilities {
    pub system_audio_available: bool,
    pub microphone_available: bool,
    pub system_audio_reason: Option<String>,
    pub microphone_reason: Option<String>,
    pub current_mode: String,
    pub failure_reason: Option<String>,
    pub sample_rate: u32,
    pub audiotee_commit: String,
}

struct LiveRecording {
    path: PathBuf,
    writer: BufWriter<File>,
    sample_count: u64,
    samples_since_flush: u64,
}

struct AudioCapture {
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    tx: Mutex<Option<mpsc::Sender<AudioCommand>>>,
    current_mode: Mutex<String>,
    failure_reason: Mutex<Option<String>>,
    live_recording: Mutex<Option<LiveRecording>>,
    last_recording: Mutex<Option<SavedRecording>>,
    last_amplitude_emit: Mutex<Option<Instant>>,
}

impl Default for AudioCapture {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            tx: Mutex::new(None),
            current_mode: Mutex::new(String::new()),
            failure_reason: Mutex::new(None),
            live_recording: Mutex::new(None),
            last_recording: Mutex::new(None),
            last_amplitude_emit: Mutex::new(None),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SavedRecording {
    pub path: String,
    pub duration_seconds: u64,
    pub sample_rate: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordingStorageUsage {
    pub bytes: u64,
    pub file_count: u64,
}

static AUDIO_STATE: once_cell::sync::Lazy<AudioCapture> =
    once_cell::sync::Lazy::new(AudioCapture::default);

fn remember_audio_state(mode: &str, failure_reason: Option<String>) {
    *AUDIO_STATE.current_mode.lock().unwrap_or_else(|e| e.into_inner()) = mode.into();
    *AUDIO_STATE.failure_reason.lock().unwrap_or_else(|e| e.into_inner()) = failure_reason;
}

fn remember_audio_failure(error: impl Into<String>) {
    remember_audio_state("error", Some(error.into()));
}

fn capture_origin_frame(origin: &AtomicU64, elapsed_frame: u64) -> u64 {
    match origin.compare_exchange(u64::MAX, elapsed_frame, Ordering::SeqCst, Ordering::SeqCst) {
        Ok(_) => elapsed_frame,
        Err(existing) => existing,
    }
}

/// Drops sleep/wake catch-up audio so processing stays near realtime.
///
/// `produced` counts samples already admitted. Budget grows with wall-clock
/// elapsed time from capture start, plus a one-second burst allowance.
fn admit_realtime_samples(
    samples: Vec<f32>,
    produced: &AtomicU64,
    capture_started_at: Instant,
    sample_rate: u32,
    burst_samples: u64,
) -> Vec<f32> {
    if samples.is_empty() {
        return samples;
    }

    let elapsed_frames = (capture_started_at.elapsed().as_secs_f64() * f64::from(sample_rate))
        .ceil()
        .max(0.0) as u64;
    let budget = elapsed_frames.saturating_add(burst_samples);
    let already = produced.load(Ordering::Relaxed);
    if already >= budget {
        return Vec::new();
    }

    let allowed = (budget - already) as usize;
    if samples.len() <= allowed {
        produced.fetch_add(samples.len() as u64, Ordering::Relaxed);
        return samples;
    }

    // Prefer the newest audio when a single callback dumps a long backlog.
    let kept = samples[samples.len() - allowed..].to_vec();
    produced.fetch_add(kept.len() as u64, Ordering::Relaxed);
    kept
}

fn admit_capture_samples(
    samples: Vec<f32>,
    produced: &AtomicU64,
    capture_started_at: Instant,
) -> Vec<f32> {
    admit_realtime_samples(
        samples,
        produced,
        capture_started_at,
        TARGET_SAMPLE_RATE,
        CATCHUP_BURST_SAMPLES,
    )
}

fn convert_samples<T>(data: &[T]) -> Vec<f32>
where
    T: Sample + SizedSample,
    f32: FromSample<T>,
{
    data.iter()
        .map(|sample| sample.to_sample::<f32>())
        .collect()
}

fn convert_input_data(data: &Data) -> Result<Vec<f32>, String> {
    macro_rules! convert {
        ($type:ty) => {
            data.as_slice::<$type>()
                .map(convert_samples)
                .ok_or_else(|| {
                    format!("Audio backend returned invalid {} samples", <$type>::FORMAT)
                })
        };
    }
    match data.sample_format() {
        SampleFormat::I8 => convert!(i8),
        SampleFormat::I16 => convert!(i16),
        SampleFormat::I32 => convert!(i32),
        SampleFormat::I64 => convert!(i64),
        SampleFormat::U8 => convert!(u8),
        SampleFormat::U16 => convert!(u16),
        SampleFormat::U32 => convert!(u32),
        SampleFormat::U64 => convert!(u64),
        SampleFormat::F32 => convert!(f32),
        SampleFormat::F64 => convert!(f64),
        format => Err(format!("Unsupported microphone sample format: {format}")),
    }
}

struct MonoResampler {
    channels: usize,
    input_rate: u32,
    accumulator: u64,
    window_sum: f32,
    window_frames: u32,
}

impl MonoResampler {
    fn new(channels: usize, input_rate: u32) -> Self {
        Self {
            channels: channels.max(1),
            input_rate: input_rate.max(8000),
            accumulator: 0,
            window_sum: 0.0,
            window_frames: 0,
        }
    }

    fn process(&mut self, interleaved: &[f32]) -> Vec<f32> {
        let mut output = Vec::new();
        for frame in interleaved.chunks_exact(self.channels) {
            let mono = frame.iter().sum::<f32>() / self.channels as f32;
            self.window_sum += mono;
            self.window_frames += 1;
            self.accumulator += u64::from(TARGET_SAMPLE_RATE);
            if self.accumulator >= u64::from(self.input_rate) {
                let averaged = self.window_sum / self.window_frames as f32;
                while self.accumulator >= u64::from(self.input_rate) {
                    output.push(averaged);
                    self.accumulator -= u64::from(self.input_rate);
                }
                self.window_sum = 0.0;
                self.window_frames = 0;
            }
        }
        output
    }
}

fn process_output_audio(data: Vec<f32>) -> (Vec<f32>, f32) {
    if data.is_empty() {
        return (data, 0.0);
    }
    let rms = (data.iter().map(|sample| sample * sample).sum::<f32>() / data.len() as f32).sqrt();
    (data, rms)
}

fn sample_to_pcm16(sample: f32) -> i16 {
    let normalized = sample.clamp(-1.0, 1.0);
    if normalized < 0.0 {
        (normalized * 32768.0) as i16
    } else {
        (normalized * 32767.0) as i16
    }
}

fn write_wav_header<W: Write>(writer: &mut W, sample_rate: u32, data_size: u32) -> Result<(), String> {
    let byte_rate = sample_rate * 2;
    writer
        .write_all(b"RIFF")
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&(36_u32 + data_size).to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(b"WAVEfmt ")
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&16_u32.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&1_u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&1_u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&sample_rate.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&byte_rate.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&2_u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&16_u16.to_le_bytes())
        .map_err(|error| error.to_string())?;
    writer
        .write_all(b"data")
        .map_err(|error| error.to_string())?;
    writer
        .write_all(&data_size.to_le_bytes())
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn patch_wav_sizes(file: &mut File, data_size: u32) -> Result<(), String> {
    file.seek(SeekFrom::Start(4))
        .map_err(|error| error.to_string())?;
    file.write_all(&(36_u32 + data_size).to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.seek(SeekFrom::Start(40))
        .map_err(|error| error.to_string())?;
    file.write_all(&data_size.to_le_bytes())
        .map_err(|error| error.to_string())?;
    file.flush().map_err(|error| error.to_string())?;
    Ok(())
}

fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let recording_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("recordings");
    fs::create_dir_all(&recording_dir).map_err(|error| error.to_string())?;
    Ok(recording_dir)
}

fn is_app_recording(entry: &fs::DirEntry) -> Result<bool, String> {
    if !entry
        .file_type()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Ok(false);
    }
    let file_name = entry.file_name();
    let Some(file_name) = file_name.to_str() else {
        return Ok(false);
    };
    Ok(file_name.starts_with("interview-") && file_name.ends_with(".wav"))
}

fn recording_storage_usage_in_dir(recording_dir: &Path) -> Result<RecordingStorageUsage, String> {
    if !recording_dir.exists() {
        return Ok(RecordingStorageUsage {
            bytes: 0,
            file_count: 0,
        });
    }

    let mut usage = RecordingStorageUsage {
        bytes: 0,
        file_count: 0,
    };
    for entry in fs::read_dir(recording_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if !is_app_recording(&entry)? {
            continue;
        }
        usage.bytes = usage
            .bytes
            .saturating_add(entry.metadata().map_err(|error| error.to_string())?.len());
        usage.file_count = usage.file_count.saturating_add(1);
    }
    Ok(usage)
}

fn clear_audio_recordings_in_dir(
    recording_dir: &Path,
    recording_active: bool,
) -> Result<RecordingStorageUsage, String> {
    if recording_active {
        return Err("recording-active".into());
    }
    if recording_dir.exists() {
        for entry in fs::read_dir(recording_dir).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if is_app_recording(&entry)? {
                fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
            }
        }
    }
    recording_storage_usage_in_dir(recording_dir)
}

fn discard_live_recording() {
    let live = AUDIO_STATE.live_recording.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(live) = live {
        drop(live.writer);
        let _ = fs::remove_file(live.path);
    }
}

fn begin_live_recording(app: &AppHandle) -> Result<(), String> {
    discard_live_recording();
    let mut live_recording = AUDIO_STATE
        .live_recording
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let path = recordings_dir(app)?.join(format!("interview-live-{timestamp}.wav"));
    let file = OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(true)
        .read(true)
        .open(&path)
        .map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    write_wav_header(&mut writer, TARGET_SAMPLE_RATE, 0)?;
    writer.flush().map_err(|error| error.to_string())?;
    *live_recording = Some(LiveRecording {
        path,
        writer,
        sample_count: 0,
        samples_since_flush: 0,
    });
    Ok(())
}

fn append_live_recording(app: &AppHandle, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    let mut live_guard = AUDIO_STATE.live_recording.lock().unwrap_or_else(|e| e.into_inner());
    let Some(live) = live_guard.as_mut() else {
        return;
    };
    let max_samples = (TARGET_SAMPLE_RATE as u64).saturating_mul(MAX_RECORDING_SECONDS as u64);
    if live.sample_count >= max_samples {
        return;
    }
    let remaining = (max_samples - live.sample_count) as usize;
    // Bound worst-case write work after sleep/wake backlog.
    let write_limit = remaining.min(MAX_RECORDING_WRITE_SAMPLES);
    let samples = if samples.len() > write_limit {
        &samples[..write_limit]
    } else {
        samples
    };

    let mut pcm = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        pcm.extend_from_slice(&sample_to_pcm16(*sample).to_le_bytes());
    }
    if let Err(error) = live.writer.write_all(&pcm) {
        let error_msg = format!("Disk write failed for live recording: {error}");
        drop(live_guard);
        remember_audio_failure(&error_msg);
        let _ = app.emit("audio-error", error_msg);
        return;
    }
    live.sample_count += samples.len() as u64;
    live.samples_since_flush += samples.len() as u64;
    // Keep crash recovery close to wall clock without flushing every packet.
    if live.samples_since_flush >= RECORDING_FLUSH_EVERY_SAMPLES {
        let _ = live.writer.flush();
        live.samples_since_flush = 0;
    }
}

fn finalize_live_recording(final_path: &Path) -> Result<Option<SavedRecording>, String> {
    let mut live_recording = AUDIO_STATE
        .live_recording
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(mut live) = live_recording.take() else {
        return Ok(None);
    };
    live.writer.flush().map_err(|error| error.to_string())?;
    let mut file = live
        .writer
        .into_inner()
        .map_err(|error| error.to_string())?;
    if live.sample_count == 0 {
        drop(file);
        let _ = fs::remove_file(&live.path);
        return Ok(None);
    }
    let data_size = live
        .sample_count
        .checked_mul(2)
        .and_then(|size| u32::try_from(size).ok())
        .ok_or_else(|| "Recording is too large to save as WAV".to_string())?;
    patch_wav_sizes(&mut file, data_size)?;
    drop(file);

    if live.path != final_path {
        if final_path.exists() {
            fs::remove_file(final_path).map_err(|error| error.to_string())?;
        }
        fs::rename(&live.path, final_path).or_else(|_| {
            fs::copy(&live.path, final_path).map(|_| ()).and_then(|_| fs::remove_file(&live.path))
        }).map_err(|error| error.to_string())?;
    }

    Ok(Some(SavedRecording {
        path: final_path.to_string_lossy().into_owned(),
        duration_seconds: live.sample_count / u64::from(TARGET_SAMPLE_RATE),
        sample_rate: TARGET_SAMPLE_RATE,
    }))
}

fn export_live_recording_snapshot(path: &Path) -> Result<Option<SavedRecording>, String> {
    let mut live_guard = AUDIO_STATE.live_recording.lock().unwrap_or_else(|e| e.into_inner());
    let Some(live) = live_guard.as_mut() else {
        return Ok(None);
    };
    live.writer.flush().map_err(|error| error.to_string())?;
    let data_size = live
        .sample_count
        .checked_mul(2)
        .and_then(|size| u32::try_from(size).ok())
        .ok_or_else(|| "Recording is too large to save as WAV".to_string())?;

    // Patch header on the live file first so the copied bytes are a valid WAV.
    {
        let file = live.writer.get_mut();
        patch_wav_sizes(file, data_size)?;
    }
    fs::copy(&live.path, path).map_err(|error| error.to_string())?;
    Ok(Some(SavedRecording {
        path: path.to_string_lossy().into_owned(),
        duration_seconds: live.sample_count / u64::from(TARGET_SAMPLE_RATE),
        sample_rate: TARGET_SAMPLE_RATE,
    }))
}

fn emit_audio_chunk(app: &AppHandle, data: Vec<f32>) {
    if data.is_empty() {
        return;
    }
    let (processed, rms) = process_output_audio(data);
    append_live_recording(app, &processed);

    // Amplitude only drives a UI meter; throttle after sleep/wake catch-up bursts.
    let now = Instant::now();
    let mut last = AUDIO_STATE
        .last_amplitude_emit
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let should_emit = last
        .map(|previous| now.duration_since(previous).as_millis() >= AMPLITUDE_EMIT_MIN_INTERVAL_MS)
        .unwrap_or(true);
    if should_emit {
        *last = Some(now);
        let _ = app.emit("audio-amplitude", rms.min(1.0));
    }
}

#[allow(dead_code)]
fn write_pcm16_wav<W: Write>(
    writer: &mut W,
    samples: &[f32],
    sample_rate: u32,
) -> Result<(), String> {
    let data_size = samples
        .len()
        .checked_mul(2)
        .and_then(|size| u32::try_from(size).ok())
        .ok_or_else(|| "Recording is too large to save as WAV".to_string())?;
    write_wav_header(writer, sample_rate, data_size)?;
    for sample in samples {
        writer
            .write_all(&sample_to_pcm16(*sample).to_le_bytes())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn emit_audio_source_chunk(app: &AppHandle, source: &'static str, samples: &[f32]) {
    if samples.is_empty() {
        return;
    }
    // Cap IPC payload size after device backlog so the frontend/STT path stays bounded.
    let samples = if samples.len() > MAX_SOURCE_CHUNK_SAMPLES {
        &samples[samples.len() - MAX_SOURCE_CHUNK_SAMPLES..]
    } else {
        samples
    };
    let _ = app.emit(
        "audio-source-chunk",
        AudioSourceChunkPayload {
            source,
            samples: samples.to_vec(),
        },
    );
}

fn push_mixed_audio(
    app: &AppHandle,
    mixer: &Arc<Mutex<TimedAudioMixer>>,
    source: AudioSource,
    timestamp_seconds: f64,
    samples: Vec<f32>,
) {
    if samples.is_empty() {
        return;
    }

    // Keep mixer input bounded. Prefer the newest audio after a long sleep.
    let (timestamp_seconds, samples) = if samples.len() > MAX_SOURCE_CHUNK_SAMPLES {
        let dropped = samples.len() - MAX_SOURCE_CHUNK_SAMPLES;
        let adjusted = timestamp_seconds + (dropped as f64 / f64::from(TARGET_SAMPLE_RATE));
        (
            adjusted,
            samples[samples.len() - MAX_SOURCE_CHUNK_SAMPLES..].to_vec(),
        )
    } else {
        (timestamp_seconds, samples)
    };

    let output = mixer
        .lock()
        .unwrap()
        .push(source, timestamp_seconds, samples);
    emit_audio_chunk(app, output);
}

fn select_input_device(device_name: Option<&str>) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    if let Some(name) = device_name {
        if let Ok(mut devices) = host.input_devices() {
            if let Some(device) = devices.find(|device| device.name().ok().as_deref() == Some(name))
            {
                return Ok(device);
            }
        }
    }
    host.default_input_device()
        .ok_or_else(|| "No microphone input device is available".into())
}

fn preferred_input_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    let preferred = device
        .supported_input_configs()
        .ok()
        .and_then(|mut configs| {
            configs.find(|config: &SupportedStreamConfigRange| {
                config.min_sample_rate() <= SampleRate(TARGET_SAMPLE_RATE)
                    && config.max_sample_rate() >= SampleRate(TARGET_SAMPLE_RATE)
            })
        })
        .map(|config| config.with_sample_rate(SampleRate(TARGET_SAMPLE_RATE)));
    preferred
        .or_else(|| device.default_input_config().ok())
        .ok_or_else(|| "No supported microphone input configuration".into())
}

#[cfg(target_os = "windows")]
fn select_loopback_device() -> Result<cpal::Device, String> {
    cpal::default_host()
        .default_output_device()
        .ok_or_else(|| "No default output audio device available for WASAPI loopback capture".into())
}

#[cfg(target_os = "windows")]
fn preferred_loopback_config(device: &cpal::Device) -> Result<cpal::SupportedStreamConfig, String> {
    // WASAPI loopback uses the render endpoint mix format; cpal enables LOOPBACK when an
    // output device is opened as an input stream.
    device
        .default_output_config()
        .map_err(|error| format!("No supported WASAPI loopback configuration: {error}"))
}

pub(crate) fn stop_audio_capture_sync() {
    if let Some(tx) = AUDIO_STATE.tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = tx.send(AudioCommand::Stop);
    }
    if let Some(handle) = AUDIO_STATE.handle.lock().unwrap_or_else(|e| e.into_inner()).take() {
        thread::spawn(move || {
            let _ = handle.join();
        });
    }
    *AUDIO_STATE.current_mode.lock().unwrap_or_else(|e| e.into_inner()) = "idle".into();
}

pub(crate) fn stop_audio_capture_and_wait() {
    if let Some(tx) = AUDIO_STATE.tx.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = tx.send(AudioCommand::Stop);
    }
    if let Some(handle) = AUDIO_STATE.handle.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = handle.join();
    }
    *AUDIO_STATE.current_mode.lock().unwrap_or_else(|e| e.into_inner()) = "idle".into();
}

#[cfg(target_os = "macos")]
fn system_audio_capability() -> Result<(), String> {
    audiotee::system_audio_support()
}

#[cfg(target_os = "windows")]
fn system_audio_capability() -> Result<(), String> {
    let device = select_loopback_device()?;
    preferred_loopback_config(&device).map(|_| ())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_audio_capability() -> Result<(), String> {
    Err("Built-in system audio capture is not available on this platform; microphone-only mode is available".into())
}

#[tauri::command]
pub async fn get_audio_capabilities() -> AudioCapabilities {
    let system_audio = system_audio_capability();
    let microphone_available = cpal::default_host().default_input_device().is_some();
    let current_mode = AUDIO_STATE.current_mode.lock().unwrap_or_else(|e| e.into_inner()).clone();
    AudioCapabilities {
        system_audio_available: system_audio.is_ok(),
        microphone_available,
        system_audio_reason: system_audio.err(),
        microphone_reason: (!microphone_available)
            .then(|| "No microphone input device is available".into()),
        current_mode: if current_mode.is_empty() {
            "idle".into()
        } else {
            current_mode
        },
        failure_reason: AUDIO_STATE.failure_reason.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        sample_rate: TARGET_SAMPLE_RATE,
        audiotee_commit: integration_version().into(),
    }
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn start_audio_capture(
    app: AppHandle,
    useSystemAudio: bool,
    useMicrophone: bool,
    deviceName: Option<String>,
) -> Result<AudioConfigPayload, String> {
    if !useSystemAudio && !useMicrophone {
        let error = "Select system audio, microphone, or both".to_string();
        remember_audio_failure(error.clone());
        return Err(error);
    }
    if useSystemAudio {
        if let Err(error) = system_audio_capability() {
            remember_audio_failure(error.clone());
            return Err(error);
        }
    }

    stop_audio_capture_and_wait();
    discard_live_recording();
    *AUDIO_STATE.last_recording.lock().unwrap_or_else(|e| e.into_inner()) = None;
    remember_audio_state("starting", None);
    if let Err(error) = begin_live_recording(&app) {
        remember_audio_failure(error.clone());
        return Err(error);
    }
    let (cmd_tx, cmd_rx) = mpsc::channel();
    let (startup_tx, startup_rx) = mpsc::sync_channel::<Result<AudioConfigPayload, String>>(1);
    let thread_app = app.clone();

    let handle = thread::spawn(move || {
        let mixer = Arc::new(Mutex::new(TimedAudioMixer::new(
            useSystemAudio,
            useMicrophone,
            TARGET_SAMPLE_RATE,
        )));
        let started_at = Instant::now();

        #[cfg(target_os = "macos")]
        let mut audiotee = if useSystemAudio {
            let system_app = thread_app.clone();
            let error_app = thread_app.clone();
            let system_mixer = Arc::clone(&mixer);
            let system_frame = Arc::new(AtomicU64::new(0));
            let frame_counter = Arc::clone(&system_frame);
            let system_origin = Arc::new(AtomicU64::new(u64::MAX));
            let origin_frame = Arc::clone(&system_origin);
            let capture_started_at = started_at;
            let system_produced = Arc::new(AtomicU64::new(0));
            let produced = Arc::clone(&system_produced);
            match AudioTeeProcess::spawn(
                move |samples| {
                    let samples = admit_capture_samples(samples, &produced, capture_started_at);
                    if samples.is_empty() {
                        return;
                    }
                    let elapsed_frame = (capture_started_at.elapsed().as_secs_f64()
                        * f64::from(TARGET_SAMPLE_RATE))
                    .round() as u64;
                    let origin = capture_origin_frame(&origin_frame, elapsed_frame);
                    let start_frame =
                        origin + frame_counter.fetch_add(samples.len() as u64, Ordering::SeqCst);
                    let timestamp = start_frame as f64 / f64::from(TARGET_SAMPLE_RATE);
                    emit_audio_source_chunk(&system_app, "system", &samples);
                    push_mixed_audio(
                        &system_app,
                        &system_mixer,
                        AudioSource::System,
                        timestamp,
                        samples,
                    );
                },
                move |error| {
                    remember_audio_failure(error.clone());
                    let _ = error_app.emit("audio-error", error);
                },
            ) {
                Ok(process) => Some(process),
                Err(error) => {
                    remember_audio_failure(error.clone());
                    let _ = startup_tx.send(Err(error));
                    return;
                }
            }
        } else {
            None
        };

        #[cfg(target_os = "windows")]
        let mut system_device_name = None;
        #[cfg(target_os = "windows")]
        let system_stream = if useSystemAudio {
            let device = match select_loopback_device() {
                Ok(device) => device,
                Err(error) => {
                    remember_audio_failure(error.clone());
                    let _ = startup_tx.send(Err(error));
                    return;
                }
            };
            let config = match preferred_loopback_config(&device) {
                Ok(config) => config,
                Err(error) => {
                    remember_audio_failure(error.clone());
                    let _ = startup_tx.send(Err(error));
                    return;
                }
            };
            let input_rate = config.sample_rate().0;
            let channels = usize::from(config.channels());
            let sample_format = config.sample_format();
            let stream_config = config.config();
            let system_app = thread_app.clone();
            let error_app = thread_app.clone();
            let system_mixer = Arc::clone(&mixer);
            let system_frame = Arc::new(AtomicU64::new(0));
            let frame_counter = Arc::clone(&system_frame);
            let system_origin = Arc::new(AtomicU64::new(u64::MAX));
            let origin_frame = Arc::clone(&system_origin);
            let capture_started_at = started_at;
            let mut resampler = MonoResampler::new(channels, input_rate);
            let system_produced = Arc::new(AtomicU64::new(0));
            let produced = Arc::clone(&system_produced);
            let stream = match device.build_input_stream_raw(
                &stream_config,
                sample_format,
                move |data, _| match convert_input_data(data) {
                    Ok(samples) => {
                        let mono = resampler.process(&samples);
                        let mono = admit_capture_samples(mono, &produced, capture_started_at);
                        if mono.is_empty() {
                            return;
                        }
                        let elapsed_frame = (capture_started_at.elapsed().as_secs_f64()
                            * f64::from(TARGET_SAMPLE_RATE))
                        .round() as u64;
                        let origin = capture_origin_frame(&origin_frame, elapsed_frame);
                        let start_frame =
                            origin + frame_counter.fetch_add(mono.len() as u64, Ordering::SeqCst);
                        emit_audio_source_chunk(&system_app, "system", &mono);
                        push_mixed_audio(
                            &system_app,
                            &system_mixer,
                            AudioSource::System,
                            start_frame as f64 / f64::from(TARGET_SAMPLE_RATE),
                            mono,
                        );
                    }
                    Err(error) => {
                        remember_audio_failure(error.clone());
                        let _ = system_app.emit("audio-error", error);
                    }
                },
                move |error| {
                    let error = error.to_string();
                    remember_audio_failure(error.clone());
                    let _ = error_app.emit("audio-error", error);
                },
                None,
            ) {
                Ok(stream) => stream,
                Err(error) => {
                    remember_audio_failure(error.to_string());
                    let _ = startup_tx.send(Err(format!(
                        "Failed to open WASAPI loopback stream: {error}"
                    )));
                    return;
                }
            };
            if let Err(error) = stream.play() {
                remember_audio_failure(error.to_string());
                let _ = startup_tx.send(Err(format!(
                    "Failed to start WASAPI loopback stream: {error}"
                )));
                return;
            }
            system_device_name = Some(
                device
                    .name()
                    .unwrap_or_else(|_| "Default system output".into()),
            );
            Some(stream)
        } else {
            None
        };

        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        let _ = useSystemAudio;

        #[cfg(not(target_os = "windows"))]
        let system_device_name: Option<String> = None;
        let mut microphone_name = None;
        let microphone_stream = if useMicrophone {
            let device = match select_input_device(deviceName.as_deref()) {
                Ok(device) => device,
                Err(error) => {
                    remember_audio_failure(error.clone());
                    #[cfg(target_os = "macos")]
                    if let Some(process) = audiotee.take() {
                        process.stop();
                    }
                    let _ = startup_tx.send(Err(error));
                    return;
                }
            };
            let name = device
                .name()
                .unwrap_or_else(|_| "Unknown microphone".into());
            let config = match preferred_input_config(&device) {
                Ok(config) => config,
                Err(error) => {
                    remember_audio_failure(error.clone());
                    #[cfg(target_os = "macos")]
                    if let Some(process) = audiotee.take() {
                        process.stop();
                    }
                    let _ = startup_tx.send(Err(error));
                    return;
                }
            };
            let input_rate = config.sample_rate().0;
            let channels = usize::from(config.channels());
            let sample_format = config.sample_format();
            let stream_config = config.config();
            let microphone_app = thread_app.clone();
            let error_app = thread_app.clone();
            let microphone_mixer = Arc::clone(&mixer);
            let microphone_frame = Arc::new(AtomicU64::new(0));
            let frame_counter = Arc::clone(&microphone_frame);
            let microphone_origin = Arc::new(AtomicU64::new(u64::MAX));
            let origin_frame = Arc::clone(&microphone_origin);
            let capture_started_at = started_at;
            let mut resampler = MonoResampler::new(channels, input_rate);
            let microphone_produced = Arc::new(AtomicU64::new(0));
            let produced = Arc::clone(&microphone_produced);
            let stream = match device.build_input_stream_raw(
                &stream_config,
                sample_format,
                move |data, _| match convert_input_data(data) {
                    Ok(samples) => {
                        let mono = resampler.process(&samples);
                        let mono = admit_capture_samples(mono, &produced, capture_started_at);
                        if mono.is_empty() {
                            return;
                        }
                        let elapsed_frame = (capture_started_at.elapsed().as_secs_f64()
                            * f64::from(TARGET_SAMPLE_RATE))
                        .round() as u64;
                        let origin = capture_origin_frame(&origin_frame, elapsed_frame);
                        let start_frame =
                            origin + frame_counter.fetch_add(mono.len() as u64, Ordering::SeqCst);
                        emit_audio_source_chunk(&microphone_app, "microphone", &mono);
                        push_mixed_audio(
                            &microphone_app,
                            &microphone_mixer,
                            AudioSource::Microphone,
                            start_frame as f64 / f64::from(TARGET_SAMPLE_RATE),
                            mono,
                        );
                    }
                    Err(error) => {
                        remember_audio_failure(error.clone());
                        let _ = microphone_app.emit("audio-error", error);
                    }
                },
                move |error| {
                    let error = error.to_string();
                    remember_audio_failure(error.clone());
                    let _ = error_app.emit("audio-error", error);
                },
                None,
            ) {
                Ok(stream) => stream,
                Err(error) => {
                    remember_audio_failure(error.to_string());
                    #[cfg(target_os = "macos")]
                    if let Some(process) = audiotee.take() {
                        process.stop();
                    }
                    let _ =
                        startup_tx.send(Err(format!("Failed to open microphone stream: {error}")));
                    return;
                }
            };
            if let Err(error) = stream.play() {
                remember_audio_failure(error.to_string());
                #[cfg(target_os = "macos")]
                if let Some(process) = audiotee.take() {
                    process.stop();
                }
                let _ = startup_tx.send(Err(format!("Failed to start microphone stream: {error}")));
                return;
            }
            microphone_name = Some(name);
            Some(stream)
        } else {
            None
        };

        let mode = match (useSystemAudio, useMicrophone) {
            (true, true) => "system+microphone",
            (true, false) => "system",
            (false, true) => "microphone",
            (false, false) => unreachable!(),
        };
        let payload = AudioConfigPayload {
            sample_rate: TARGET_SAMPLE_RATE,
            device: microphone_name
                .or(system_device_name)
                .unwrap_or_else(|| "Default system output".into()),
            mode: mode.into(),
        };
        let _ = thread_app.emit("audio-config", payload.clone());
        if startup_tx.send(Ok(payload)).is_err() {
            return;
        }

        let _ = cmd_rx.recv();
        drop(microphone_stream);
        #[cfg(target_os = "windows")]
        drop(system_stream);
        #[cfg(target_os = "macos")]
        if let Some(process) = audiotee.take() {
            process.stop();
        }
        let remaining = mixer.lock().unwrap_or_else(|e| e.into_inner()).flush();
        emit_audio_chunk(&thread_app, remaining);
    });

    *AUDIO_STATE.tx.lock().unwrap_or_else(|e| e.into_inner()) = Some(cmd_tx);
    *AUDIO_STATE.handle.lock().unwrap_or_else(|e| e.into_inner()) = Some(handle);

    match startup_rx.recv_timeout(Duration::from_secs(8)) {
        Ok(Ok(payload)) => {
            remember_audio_state(&payload.mode, None);
            Ok(payload)
        }
        Ok(Err(error)) => {
            stop_audio_capture_sync();
            Err(error)
        }
        Err(error) => {
            stop_audio_capture_sync();
            let error = format!("Timed out while starting audio capture: {error}");
            remember_audio_failure(error.clone());
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn stop_audio_capture() -> Result<String, String> {
    tokio::task::spawn_blocking(stop_audio_capture_and_wait)
        .await
        .map_err(|error| error.to_string())?;
    Ok("Capture stopped".into())
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn save_audio_recording(
    app: AppHandle,
    sessionId: String,
) -> Result<Option<SavedRecording>, String> {
    let safe_session_id: String = sessionId
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .collect();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs();
    let recording_dir = recordings_dir(&app)?;
    let file_name = if safe_session_id.is_empty() {
        format!("interview-{timestamp}.wav")
    } else {
        format!("interview-{timestamp}-{safe_session_id}.wav")
    };
    let path = recording_dir.join(file_name);
    let mut last_recording = AUDIO_STATE
        .last_recording
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let saved = finalize_live_recording(&path)?;
    if let Some(saved) = &saved {
        *last_recording = Some(saved.clone());
    }
    Ok(saved)
}

#[tauri::command]
pub async fn get_recording_storage_usage(app: AppHandle) -> Result<RecordingStorageUsage, String> {
    recording_storage_usage_in_dir(&recordings_dir(&app)?)
}

#[tauri::command]
pub async fn clear_audio_recordings(app: AppHandle) -> Result<RecordingStorageUsage, String> {
    let recording_dir = recordings_dir(&app)?;
    let capture_thread_active = AUDIO_STATE
        .tx
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .is_some();
    let current_mode = AUDIO_STATE
        .current_mode
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let recording_active = capture_thread_active
        || !matches!(current_mode.as_str(), "" | "idle" | "error");
    if recording_active {
        return Err("recording-active".into());
    }
    let mut last_recording = AUDIO_STATE
        .last_recording
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let mut live_recording = AUDIO_STATE
        .live_recording
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    if let Some(live) = live_recording.take() {
        drop(live.writer);
    }
    let usage = clear_audio_recordings_in_dir(&recording_dir, false)?;
    *last_recording = None;
    Ok(usage)
}

#[tauri::command]
pub async fn export_audio_recording(app: AppHandle) -> Result<Option<SavedRecording>, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let download_dir = app.path().download_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&download_dir).map_err(|error| error.to_string())?;
    let path = download_dir.join(format!("interview-recording-{timestamp}.wav"));

    if let Some(saved) = export_live_recording_snapshot(&path)? {
        return Ok(Some(saved));
    }

    let Some(last_recording) = AUDIO_STATE.last_recording.lock().unwrap_or_else(|e| e.into_inner()).clone() else {
        return Ok(None);
    };
    fs::copy(&last_recording.path, &path).map_err(|error| error.to_string())?;
    Ok(Some(SavedRecording {
        path: path.to_string_lossy().into_owned(),
        duration_seconds: last_recording.duration_seconds,
        sample_rate: last_recording.sample_rate,
    }))
}

#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<String>, String> {
    Ok(cpal::default_host()
        .input_devices()
        .map_err(|error| error.to_string())?
        .map(|device| device.name().unwrap_or_else(|_| "Unknown".into()))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{
        admit_realtime_samples, capture_origin_frame, clear_audio_recordings_in_dir,
        convert_samples, process_output_audio, recording_storage_usage_in_dir,
        stop_audio_capture_and_wait, write_pcm16_wav, AtomicU64, MonoResampler,
    };
    use std::time::Instant;

    #[test]
    fn converts_integer_microphone_samples_to_normalized_f32() {
        let signed = convert_samples(&[i16::MIN, 0, i16::MAX]);
        assert_eq!(signed[0], -1.0);
        assert_eq!(signed[1], 0.0);
        assert!(signed[2] > 0.99 && signed[2] <= 1.0);
    }

    #[test]
    fn downmixes_stereo_and_resamples_to_16khz() {
        let mut resampler = MonoResampler::new(2, 48_000);
        let input = vec![
            1.0, -1.0, 0.5, 0.5, 1.0, 1.0, -0.5, -0.5, 0.0, 0.0, 0.25, 0.25,
        ];
        let output = resampler.process(&input);
        assert!((output[0] - 0.5).abs() < 0.000_001);
        assert!((output[1] - (-1.0 / 12.0)).abs() < 0.000_001);
    }

    #[test]
    fn audio_quality_downsampling_averages_the_source_window() {
        let mut resampler = MonoResampler::new(2, 48_000);
        let output = resampler.process(&[1.0, 1.0, 1.0, 1.0, -1.0, -1.0]);
        assert!((output[0] - (1.0 / 3.0)).abs() < 0.000_001);
    }

    #[test]
    fn audio_quality_preserves_quiet_samples() {
        let input = vec![0.01, -0.01];
        let (output, _) = process_output_audio(input.clone());
        assert_eq!(output, input);
    }

    #[test]
    fn capture_origin_uses_the_first_elapsed_frame() {
        let origin = AtomicU64::new(u64::MAX);
        assert_eq!(capture_origin_frame(&origin, 320), 320);
        assert_eq!(capture_origin_frame(&origin, 640), 320);
    }

    #[test]
    fn admit_realtime_samples_drops_sleep_wake_backlog_bursts() {
        let started_at = Instant::now();
        let produced = AtomicU64::new(0);
        let first = admit_realtime_samples(vec![0.1; 20_000], &produced, started_at, 16_000, 1_000);
        // Budget is burst + tiny wall-clock elapsed; keep the newest samples only.
        assert!(first.len() <= 1_050);
        assert!(first.len() >= 1_000);
        assert_eq!(
            produced.load(std::sync::atomic::Ordering::Relaxed),
            first.len() as u64
        );
        // Already at/over the near-zero elapsed budget, so further backlog is dropped.
        let second = admit_realtime_samples(vec![0.2; 8_000], &produced, started_at, 16_000, 1_000);
        assert!(second.len() < 100);
    }

    #[test]
    fn writes_pcm16_mono_wav_header_and_samples() {
        let mut wav = Vec::new();
        write_pcm16_wav(&mut wav, &[-1.0, 0.0, 1.0], 16_000).unwrap();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(u32::from_le_bytes(wav[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(wav[40..44].try_into().unwrap()), 6);
        assert_eq!(
            i16::from_le_bytes(wav[44..46].try_into().unwrap()),
            i16::MIN
        );
        assert_eq!(
            i16::from_le_bytes(wav[48..50].try_into().unwrap()),
            i16::MAX
        );
    }

    #[test]
    fn repeated_stop_is_idempotent_when_capture_is_idle() {
        stop_audio_capture_and_wait();
        stop_audio_capture_and_wait();
    }

    #[test]
    fn streaming_wav_finalize_patches_sizes() {
        use super::{patch_wav_sizes, write_wav_header};
        use std::io::{Read, Seek, SeekFrom, Write};

        let dir = std::env::temp_dir().join(format!(
            "rabbit-stream-wav-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("live.wav");
        let mut file = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .read(true)
            .open(&path)
            .unwrap();
        write_wav_header(&mut file, 16_000, 0).unwrap();
        file.write_all(&(-1_i16).to_le_bytes()).unwrap();
        file.write_all(&0_i16.to_le_bytes()).unwrap();
        file.write_all(&1_i16.to_le_bytes()).unwrap();
        patch_wav_sizes(&mut file, 6).unwrap();
        file.seek(SeekFrom::Start(0)).unwrap();
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 42);
        assert_eq!(u32::from_le_bytes(bytes[40..44].try_into().unwrap()), 6);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn recording_storage_only_counts_and_clears_app_wav_files() {
        let dir = std::env::temp_dir().join(format!(
            "rabbit-recording-storage-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("nested")).unwrap();
        std::fs::write(dir.join("interview-1.wav"), [1_u8, 2, 3]).unwrap();
        std::fs::write(dir.join("interview-live-2.wav"), [1_u8; 5]).unwrap();
        std::fs::write(dir.join("notes.txt"), [1_u8; 7]).unwrap();
        std::fs::write(dir.join("other.wav"), [1_u8; 11]).unwrap();
        std::fs::write(dir.join("nested/interview-3.wav"), [1_u8; 13]).unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink("notes.txt", dir.join("interview-link.wav")).unwrap();

        assert_eq!(
            recording_storage_usage_in_dir(&dir).unwrap(),
            super::RecordingStorageUsage {
                bytes: 8,
                file_count: 2,
            }
        );
        assert!(clear_audio_recordings_in_dir(&dir, true).is_err());
        assert!(dir.join("interview-1.wav").exists());

        assert_eq!(
            clear_audio_recordings_in_dir(&dir, false).unwrap(),
            super::RecordingStorageUsage {
                bytes: 0,
                file_count: 0,
            }
        );
        assert!(!dir.join("interview-1.wav").exists());
        assert!(dir.join("notes.txt").exists());
        assert!(dir.join("other.wav").exists());
        assert!(dir.join("nested/interview-3.wav").exists());
        #[cfg(unix)]
        assert!(std::fs::symlink_metadata(dir.join("interview-link.wav")).is_ok());
        assert_eq!(
            clear_audio_recordings_in_dir(&dir, false).unwrap(),
            super::RecordingStorageUsage {
                bytes: 0,
                file_count: 0,
            }
        );

        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            clear_audio_recordings_in_dir(&dir, false).unwrap(),
            super::RecordingStorageUsage {
                bytes: 0,
                file_count: 0,
            }
        );
    }
}
