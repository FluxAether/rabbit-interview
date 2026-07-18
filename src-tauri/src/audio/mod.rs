use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleRate, SupportedStreamConfigRange};
use serde::Serialize;
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter};

/// Control messages for the audio thread.
enum AudioCommand {
    Stop,
}

#[derive(Serialize, Clone)]
struct AudioConfigPayload {
    sample_rate: u32,
    device: String,
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

static AUDIO_STATE: once_cell::sync::Lazy<AudioCapture> = once_cell::sync::Lazy::new(|| AudioCapture::default());

fn stop_capture_internal() {
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
}

#[tauri::command]
#[allow(non_snake_case)]
pub async fn start_capture(app: AppHandle, deviceName: Option<String>) -> Result<String, String> {
    // Stop previous if any
    stop_capture_internal();

    let (cmd_tx, cmd_rx) = mpsc::channel();
    let app_handle = app.clone();

    let handle = thread::spawn(move || {
        let host = cpal::default_host();

        let device = if let Some(name) = deviceName {
            // Find device by name
            match host.input_devices() {
                Ok(mut devices) => devices.find(|d| d.name().map(|n| n == name).unwrap_or(false)),
                Err(_) => None,
            }
            .unwrap_or_else(|| {
                eprintln!("Requested device '{}' not found, falling back to default", name);
                host.default_input_device().expect("no default input device")
            })
        } else {
            host.default_input_device().expect("no default input device")
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
        }
        .expect("failed to obtain any input config");

        let sample_rate = config.sample_rate().0;
        println!("Starting real capture on device: {} @ {}Hz", dev_name, sample_rate);

        // Emit config so frontend knows the real sample rate (important for Deepgram)
        let _ = app_handle.emit(
            "audio-config",
            AudioConfigPayload {
                sample_rate,
                device: dev_name.clone(),
            },
        );

        let err_fn = |err| eprintln!("stream error: {}", err);

        // Build stream inside the dedicated thread (avoids !Send issues)
        let stream = match device.build_input_stream(
            &config.into(),
            move |data: &[f32], _: &cpal::InputCallbackInfo| {
                // RMS amplitude for UI visualization
                let rms = if !data.is_empty() {
                    (data.iter().map(|s| s * s).sum::<f32>() / data.len() as f32).sqrt()
                } else {
                    0.0
                };
                let _ = app_handle.emit("audio-amplitude", rms.min(1.0));

                // Send FULL buffer for good STT quality (no more artificial truncation to 512)
                if !data.is_empty() {
                    let chunk: Vec<f32> = data.to_vec();
                    let _ = app_handle.emit("audio-chunk", chunk);
                }
            },
            err_fn,
            None,
        ) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("build stream failed: {}", e);
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("play failed: {}", e);
            return;
        }

        // Block until stop command
        let _ = cmd_rx.recv();

        // Dropping stream stops capture
        drop(stream);
        println!("Audio thread stopped");
    });

    // Store the thread handle and command channel
    {
        let mut h = AUDIO_STATE.handle.lock().unwrap();
        *h = Some(handle);
    }
    {
        let mut t = AUDIO_STATE.tx.lock().unwrap();
        *t = Some(cmd_tx);
    }

    Ok("Real mic capture started (dedicated thread)".into())
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
    let devices = host.input_devices()
        .map_err(|e| e.to_string())?
        .map(|d| d.name().unwrap_or_else(|_| "Unknown".into()))
        .collect();
    Ok(devices)
}