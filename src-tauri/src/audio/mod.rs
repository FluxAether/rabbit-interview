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
}

struct AudioCapture {
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    tx: Mutex<Option<mpsc::Sender<AudioCommand>>>,
    current_mode: Mutex<String>,
    failure_reason: Mutex<Option<String>>,
    live_recording: Mutex<Option<LiveRecording>>,
    last_recording: Mutex<Option<SavedRecording>>,
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
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SavedRecording {
    pub path: String,
    pub duration_seconds: u64,
    pub sample_rate: u32,
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

fn discard_live_recording() {
    let live = AUDIO_STATE.live_recording.lock().unwrap_or_else(|e| e.into_inner()).take();
    if let Some(live) = live {
        drop(live.writer);
        let _ = fs::remove_file(live.path);
    }
}

fn begin_live_recording(app: &AppHandle) -> Result<(), String> {
    discard_live_recording();
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
    *AUDIO_STATE.live_recording.lock().unwrap_or_else(|e| e.into_inner()) = Some(LiveRecording {
        path,
        writer,
        sample_count: 0,
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
    let samples = if samples.len() > remaining {
        &samples[..remaining]
    } else {
        samples
    };
    for sample in samples {
        let pcm = sample_to_pcm16(*sample);
        if let Err(error) = live.writer.write_all(&pcm.to_le_bytes()) {
            let error_msg = format!("Disk write failed for live recording: {error}");
            remember_audio_failure(&error_msg);
            let _ = app.emit("audio-error", error_msg);
            return;
        }
        live.sample_count += 1;
    }
    // Keep crash recovery close to wall clock without fsync every packet.
    let _ = live.writer.flush();
}

fn finalize_live_recording(final_path: &Path) -> Result<Option<SavedRecording>, String> {
    let Some(mut live) = AUDIO_STATE.live_recording.lock().unwrap_or_else(|e| e.into_inner()).take() else {
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
    let _ = app.emit("audio-amplitude", rms.min(1.0));
}

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

#[cfg(not(target_os = "macos"))]
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
    begin_live_recording(&app)?;
    remember_audio_state("starting", None);
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
            match AudioTeeProcess::spawn(
                move |samples| {
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

        #[cfg(not(target_os = "macos"))]
        let _ = useSystemAudio;

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
            let stream = match device.build_input_stream_raw(
                &stream_config,
                sample_format,
                move |data, _| match convert_input_data(data) {
                    Ok(samples) => {
                        let mono = resampler.process(&samples);
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
            device: microphone_name.unwrap_or_else(|| "Default system output".into()),
            mode: mode.into(),
        };
        let _ = thread_app.emit("audio-config", payload.clone());
        if startup_tx.send(Ok(payload)).is_err() {
            return;
        }

        let _ = cmd_rx.recv();
        drop(microphone_stream);
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
    let saved = finalize_live_recording(&path)?;
    if let Some(saved) = &saved {
        *AUDIO_STATE.last_recording.lock().unwrap_or_else(|e| e.into_inner()) = Some(saved.clone());
    }
    Ok(saved)
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
        capture_origin_frame, convert_samples, process_output_audio, stop_audio_capture_and_wait,
        write_pcm16_wav, AtomicU64, MonoResampler,
    };

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
}
