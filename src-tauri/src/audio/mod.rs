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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

const TARGET_SAMPLE_RATE: u32 = AUDIOTEE_SAMPLE_RATE;

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

#[derive(Default)]
struct AudioCapture {
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    tx: Mutex<Option<mpsc::Sender<AudioCommand>>>,
    current_mode: Mutex<String>,
    failure_reason: Mutex<Option<String>>,
}

static AUDIO_STATE: once_cell::sync::Lazy<AudioCapture> =
    once_cell::sync::Lazy::new(AudioCapture::default);

fn remember_audio_state(mode: &str, failure_reason: Option<String>) {
    *AUDIO_STATE.current_mode.lock().unwrap() = mode.into();
    *AUDIO_STATE.failure_reason.lock().unwrap() = failure_reason;
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
            input_rate,
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

fn emit_audio_chunk(app: &AppHandle, data: Vec<f32>) {
    if data.is_empty() {
        return;
    }
    let (processed, rms) = process_output_audio(data);
    let _ = app.emit("audio-amplitude", rms.min(1.0));
    let _ = app.emit("audio-chunk", processed);
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
    if let Some(tx) = AUDIO_STATE.tx.lock().unwrap().take() {
        let _ = tx.send(AudioCommand::Stop);
    }
    if let Some(handle) = AUDIO_STATE.handle.lock().unwrap().take() {
        thread::spawn(move || {
            let _ = handle.join();
        });
    }
    *AUDIO_STATE.current_mode.lock().unwrap() = "idle".into();
}

pub(crate) fn stop_audio_capture_and_wait() {
    if let Some(tx) = AUDIO_STATE.tx.lock().unwrap().take() {
        let _ = tx.send(AudioCommand::Stop);
    }
    if let Some(handle) = AUDIO_STATE.handle.lock().unwrap().take() {
        let _ = handle.join();
    }
    *AUDIO_STATE.current_mode.lock().unwrap() = "idle".into();
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
    let current_mode = AUDIO_STATE.current_mode.lock().unwrap().clone();
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
        failure_reason: AUDIO_STATE.failure_reason.lock().unwrap().clone(),
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
        let remaining = mixer.lock().unwrap().flush();
        emit_audio_chunk(&thread_app, remaining);
    });

    *AUDIO_STATE.tx.lock().unwrap() = Some(cmd_tx);
    *AUDIO_STATE.handle.lock().unwrap() = Some(handle);

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
        AtomicU64, MonoResampler,
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
    fn repeated_stop_is_idempotent_when_capture_is_idle() {
        stop_audio_capture_and_wait();
        stop_audio_capture_and_wait();
    }
}
