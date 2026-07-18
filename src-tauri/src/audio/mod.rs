use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc;
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter};

/// Control messages for the audio thread.
enum AudioCommand {
    Stop,
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
    if let Some(tx) = AUDIO_STATE.tx.lock().unwrap().take() {
        let _ = tx.send(AudioCommand::Stop);
    }
    if let Some(handle) = AUDIO_STATE.handle.lock().unwrap().take() {
        let _ = handle.join();
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

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Config error: {}", e);
                return;
            }
        };

        let sample_rate = config.sample_rate().0;
        let dev_name = device.name().unwrap_or_else(|_| "Unknown".to_string());
        println!("Starting real capture on device: {} @ {}Hz", dev_name, sample_rate);

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

                // Send chunk for STT or further processing (f32, frontend will convert)
                if data.len() > 64 {
                    let preview: Vec<f32> = data.iter().take(512).cloned().collect();
                    let _ = app_handle.emit("audio-chunk", preview);
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