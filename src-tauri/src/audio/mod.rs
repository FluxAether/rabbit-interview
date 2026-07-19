use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{
    Data, FromSample, Sample, SampleFormat, SampleRate, SizedSample, SupportedStreamConfigRange,
};
use serde::Serialize;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
pub mod screencapturekit;

#[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
pub use screencapturekit::{
    check_screen_recording_permission, list_macos_sources, present_macos_content_picker,
    start_macos_capture,
};

/// Control messages for the audio thread.
enum AudioCommand {
    Stop,
}

#[derive(Serialize, Clone)]
pub struct AudioConfigPayload {
    pub sample_rate: u32,
    pub device: String,
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

fn process_audio_chunk(app: &AppHandle, data: &[f32]) {
    if data.is_empty() {
        let _ = app.emit("audio-amplitude", 0.0f32);
        return;
    }

    let rms = (data.iter().map(|sample| sample * sample).sum::<f32>() / data.len() as f32).sqrt();
    let mut processed = data.to_vec();
    let gate_threshold = 0.015;
    let target_rms = 0.18;

    if rms > gate_threshold {
        let gain = (target_rms / rms.max(0.001)).clamp(0.5, 5.0);
        for sample in &mut processed {
            *sample = (*sample * gain).clamp(-0.98, 0.98);
        }
    } else {
        for sample in &mut processed {
            *sample *= 0.15;
        }
    }

    let display_rms = if rms > gate_threshold {
        rms.min(1.0)
    } else {
        0.0
    };
    let _ = app.emit("audio-amplitude", display_rms);
    let _ = app.emit("audio-chunk", processed);
}

fn process_typed_input<T>(app: &AppHandle, data: &Data) -> Result<(), String>
where
    T: Sample + SizedSample,
    f32: FromSample<T>,
{
    let samples = data
        .as_slice::<T>()
        .ok_or_else(|| format!("Audio backend returned invalid {} samples", T::FORMAT))?;
    process_audio_chunk(app, &convert_samples(samples));
    Ok(())
}

fn process_input_data(app: &AppHandle, data: &Data) -> Result<(), String> {
    match data.sample_format() {
        SampleFormat::I8 => process_typed_input::<i8>(app, data),
        SampleFormat::I16 => process_typed_input::<i16>(app, data),
        SampleFormat::I32 => process_typed_input::<i32>(app, data),
        SampleFormat::I64 => process_typed_input::<i64>(app, data),
        SampleFormat::U8 => process_typed_input::<u8>(app, data),
        SampleFormat::U16 => process_typed_input::<u16>(app, data),
        SampleFormat::U32 => process_typed_input::<u32>(app, data),
        SampleFormat::U64 => process_typed_input::<u64>(app, data),
        SampleFormat::F32 => process_typed_input::<f32>(app, data),
        SampleFormat::F64 => process_typed_input::<f64>(app, data),
        format => Err(format!("Unsupported microphone sample format: {format}")),
    }
}

/// Holds the handle to the background audio thread.
pub struct AudioCapture {
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    tx: Mutex<Option<mpsc::Sender<AudioCommand>>>,
}

impl Default for AudioCapture {
    fn default() -> Self {
        Self {
            handle: Mutex::new(None),
            tx: Mutex::new(None),
        }
    }
}

static AUDIO_STATE: once_cell::sync::Lazy<AudioCapture> =
    once_cell::sync::Lazy::new(|| AudioCapture::default());

pub(crate) fn stop_capture_internal() {
    // Send stop signal to the audio thread (this wakes recv())
    if let Some(tx) = AUDIO_STATE.tx.lock().unwrap().take() {
        let _ = tx.send(AudioCommand::Stop);
    }
    // IMPORTANT: Do NOT call join() here on the caller thread.
    // join() is blocking. If called from a Tauri async command it can stall the UI.
    // We take the handle so the next start can clean up, and join in a background thread.
    if let Some(handle) = AUDIO_STATE.handle.lock().unwrap().take() {
        thread::spawn(move || {
            // Best-effort join; ignore result
            let _ = handle.join();
        });
    }

    // Also stop any active macOS ScreenCaptureKit session
    #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
    crate::audio::screencapturekit::stop_macos_capture_sync();
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn start_capture(
    app: AppHandle,
    deviceName: Option<String>,
    deepgramKey: Option<String>,
) -> Result<String, String> {
    // Stop previous if any
    stop_capture_internal();

    let (cmd_tx, cmd_rx) = mpsc::channel();
    let (startup_tx, startup_rx) = mpsc::sync_channel::<Result<String, String>>(1);
    let app_handle = app.clone();
    drop(deepgramKey); // The WebView owns the single Deepgram connection.

    let handle = thread::spawn(move || {
        let host = cpal::default_host();

        let device = if let Some(name) = deviceName {
            // Find device by name
            match host.input_devices() {
                Ok(mut devices) => devices.find(|d| d.name().map(|n| n == name).unwrap_or(false)),
                Err(_) => None,
            }
            .or_else(|| {
                eprintln!(
                    "Requested device '{}' not found, falling back to default",
                    name
                );
                host.default_input_device()
            })
        } else {
            host.default_input_device()
        };
        let Some(device) = device else {
            let _ = startup_tx.send(Err("No microphone input device is available".into()));
            return;
        };

        let dev_name = device.name().unwrap_or_else(|_| "Unknown".to_string());

        // Prefer 16kHz for STT (Deepgram and others work best at 16k).
        // Fall back to device's default if 16k not supported.
        let config = match device.supported_input_configs() {
            Ok(mut supported) => {
                // Try to find a config that supports 16000 Hz, mono or any channels (we'll use as-is)
                let preferred_rate = 16000;
                supported
                    .find(|c: &SupportedStreamConfigRange| {
                        c.min_sample_rate() <= SampleRate(preferred_rate)
                            && c.max_sample_rate() >= SampleRate(preferred_rate)
                    })
                    .map(|range| range.with_sample_rate(SampleRate(preferred_rate)))
                    .or_else(|| device.default_input_config().ok())
            }
            Err(_) => device.default_input_config().ok(),
        };
        let Some(config) = config else {
            let _ = startup_tx.send(Err(format!(
                "No supported input configuration for {dev_name}"
            )));
            return;
        };

        let sample_rate = config.sample_rate().0;
        let sample_format = config.sample_format();
        let stream_config = config.config();
        println!(
            "Starting real capture on device: {} @ {}Hz",
            dev_name, sample_rate
        );

        let data_app = app_handle.clone();
        let error_app = app_handle.clone();
        let stream = match device.build_input_stream_raw(
            &stream_config,
            sample_format,
            move |data, _| {
                if let Err(error) = process_input_data(&data_app, data) {
                    let _ = data_app.emit("audio-error", error);
                }
            },
            move |error| {
                eprintln!("stream error: {error}");
                let _ = error_app.emit("audio-error", error.to_string());
            },
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                let _ = startup_tx.send(Err(format!("Failed to open microphone stream: {e}")));
                return;
            }
        };

        if let Err(e) = stream.play() {
            let _ = startup_tx.send(Err(format!("Failed to start microphone stream: {e}")));
            return;
        }

        let _ = app_handle.emit(
            "audio-config",
            AudioConfigPayload {
                sample_rate,
                device: dev_name.clone(),
            },
        );
        let message =
            format!("Microphone capture started: {dev_name} @ {sample_rate}Hz ({sample_format})");
        if startup_tx.send(Ok(message)).is_err() {
            return;
        }

        // Block until stop command
        let _ = cmd_rx.recv();

        // Dropping stream stops capture
        drop(stream);
        println!("Audio thread stopped");
    });

    match startup_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(message)) => {
            *AUDIO_STATE.handle.lock().unwrap() = Some(handle);
            *AUDIO_STATE.tx.lock().unwrap() = Some(cmd_tx);
            Ok(message)
        }
        Ok(Err(error)) => {
            let _ = handle.join();
            Err(error)
        }
        Err(error) => {
            let _ = cmd_tx.send(AudioCommand::Stop);
            thread::spawn(move || {
                let _ = handle.join();
            });
            Err(format!(
                "Timed out while starting microphone capture: {error}"
            ))
        }
    }
}

#[tauri::command]
pub async fn stop_capture() -> Result<String, String> {
    stop_capture_internal();
    Ok("Capture stopped".into())
}

/// List available input devices (useful for BlackHole / aggregate devices)
#[tauri::command]
pub async fn list_audio_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .map(|d| d.name().unwrap_or_else(|_| "Unknown".into()))
        .collect();
    Ok(devices)
}

/// Always-exposed stop for macOS capture path.
/// When the macos-system-audio feature + mac is active, this stops the SCK backend.
/// Otherwise it is a harmless no-op so that JS "always call both stop" paths never throw.
#[tauri::command]
pub async fn stop_macos_capture() -> Result<String, String> {
    #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
    {
        crate::audio::screencapturekit::stop_macos_capture_sync();
        // Also ensure the shared internal state is cleared (idempotent)
        // stop_capture_internal already does this but we call sync here directly.
    }
    #[cfg(not(all(target_os = "macos", feature = "macos-system-audio")))]
    {
        // no-op
    }
    Ok("Stop signal sent (macOS path if active)".into())
}

#[cfg(test)]
mod tests {
    use super::convert_samples;

    #[test]
    fn converts_integer_microphone_samples_to_normalized_f32() {
        let signed = convert_samples(&[i16::MIN, 0, i16::MAX]);
        assert_eq!(signed[0], -1.0);
        assert_eq!(signed[1], 0.0);
        assert!(signed[2] > 0.99 && signed[2] <= 1.0);

        let unsigned = convert_samples(&[u16::MIN, 32768, u16::MAX]);
        assert_eq!(unsigned[0], -1.0);
        assert_eq!(unsigned[1], 0.0);
        assert!(unsigned[2] > 0.99 && unsigned[2] <= 1.0);
    }
}
