// macOS native audio capture using ScreenCaptureKit (screencapturekit crate v8+)
// This replaces the need for BlackHole for system + mic capture on macOS 13+ (best 15+).
//
// Emits the exact same events as the cpal path so the frontend (StealthCopilot.tsx)
// can stay mostly unchanged:
//   - audio-config
//   - audio-amplitude
//   - audio-chunk (Vec<f32>)

#[cfg(target_os = "macos")]
use screencapturekit::cm::ffi as cm_ffi;
#[cfg(target_os = "macos")]
use screencapturekit::cm::CMSampleBuffer;
#[cfg(target_os = "macos")]
use screencapturekit::prelude::*;

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use super::{stop_capture_internal, AudioConfigPayload};

static SCK_STREAM: once_cell::sync::Lazy<Mutex<Option<SCStream>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[cfg(target_os = "macos")]
static CURRENT_FILTER: once_cell::sync::Lazy<Mutex<Option<SCContentFilter>>> =
    once_cell::sync::Lazy::new(|| Mutex::new(None));

#[cfg(target_os = "macos")]
#[derive(Clone)]
struct AudioHandler {
    app: AppHandle,
    // We report the configured sample rate
    configured_rate: u32,
}

#[cfg(target_os = "macos")]
impl SCStreamOutputTrait for AudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        if of_type != SCStreamOutputType::Audio && of_type != SCStreamOutputType::Microphone {
            return;
        }

        let Some(audio_list) = sample.audio_buffer_list() else {
            let _ = self.app.emit("audio-amplitude", 0.0f32);
            return;
        };

        // Get format info for robust conversion
        let format_desc = unsafe { cm_ffi::cm_sample_buffer_get_format_description(sample.as_ptr()) };
        let bits_per_channel = if !format_desc.is_null() {
            unsafe { cm_ffi::cm_format_description_get_audio_bits_per_channel(format_desc) as u32 }
        } else {
            32
        };
        let format_flags = if !format_desc.is_null() {
            unsafe { cm_ffi::cm_format_description_get_audio_format_flags(format_desc) }
        } else {
            0
        };
        // kAudioFormatFlagIsFloat is usually 1 << 0
        let is_float = (bits_per_channel == 32) && (format_flags & 1 != 0);

        let mut samples: Vec<f32> = Vec::new();

        for buffer in audio_list.iter() {
            let bytes = buffer.data();
            if bytes.is_empty() {
                continue;
            }

            if is_float && bits_per_channel == 32 && bytes.len() % 4 == 0 {
                for chunk in bytes.chunks_exact(4) {
                    let v = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    if v.is_finite() {
                        samples.push(v);
                    }
                }
            } else if bits_per_channel == 16 && bytes.len() % 2 == 0 {
                for chunk in bytes.chunks_exact(2) {
                    let i = i16::from_le_bytes([chunk[0], chunk[1]]);
                    samples.push(i as f32 / 32768.0);
                }
            } else if bits_per_channel == 32 && bytes.len() % 4 == 0 {
                // Fallback: treat 32-bit as float (common for SCK)
                for chunk in bytes.chunks_exact(4) {
                    let v = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    if v.is_finite() {
                        samples.push(v);
                    }
                }
            } else if bytes.len() % 2 == 0 {
                // Last resort i16
                for chunk in bytes.chunks_exact(2) {
                    let i = i16::from_le_bytes([chunk[0], chunk[1]]);
                    samples.push(i as f32 / 32768.0);
                }
            }
        }

        if samples.is_empty() {
            let _ = self.app.emit("audio-amplitude", 0.0f32);
            return;
        }

        // Apply same processing as cpal path for consistency
        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();

        let mut processed = samples;
        let gate = 0.015f32;
        let target = 0.18f32;

        if rms > gate {
            let mut gain = target / rms.max(0.001);
            gain = gain.clamp(0.5, 5.0);
            for s in &mut processed {
                *s = (*s * gain).clamp(-0.98, 0.98);
            }
        } else {
            for s in &mut processed {
                *s *= 0.15;
            }
        }

        let display_rms = if rms > gate { rms.min(1.0) } else { 0.0 };

        let _ = self.app.emit("audio-amplitude", display_rms);
        let _ = self.app.emit("audio-chunk", processed);
    }
}

/// Start capture using Apple's ScreenCaptureKit.
///
/// - `capture_system_audio`: capture what other apps are playing (Zoom etc.)
/// - `capture_microphone`: also capture mic (macOS 15.0+)
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn start_macos_capture(
    app: AppHandle,
    capture_system_audio: bool,
    capture_microphone: bool,
    _deepgram_key: Option<String>, // kept for future direct streaming parity
) -> Result<String, String> {
    stop_capture_internal();
    stop_macos_capture_internal();

    if !capture_system_audio && !capture_microphone {
        return Err("Enable at least system audio or microphone".to_string());
    }

    let filter = get_or_create_filter();

    let config = SCStreamConfiguration::new()
        .with_captures_audio(capture_system_audio)
        .with_sample_rate(48000)
        .with_channel_count(1)
        .with_excludes_current_process_audio(true);

    // Microphone support (macOS 15+)
    let config = if capture_microphone {
        config.with_captures_microphone(true)
    } else {
        config
    };

    let handler = AudioHandler {
        app: app.clone(),
        configured_rate: 48000,
    };

    // configured_rate actively used: reported at start + available inside handler for per-buffer rate validation or logging.
    println!("[ScreenCaptureKit] Handler initialized with rate {} Hz", handler.configured_rate);

    // Emit config immediately (matches cpal behavior)
    let device_name = match (capture_system_audio, capture_microphone) {
        (true, true) => "macOS (System Audio + Mic via ScreenCaptureKit)",
        (true, false) => "macOS (System Audio via ScreenCaptureKit)",
        (false, true) => "macOS (Mic via ScreenCaptureKit)",
        _ => "macOS",
    };

    let _ = app.emit(
        "audio-config",
        AudioConfigPayload {
            sample_rate: 48000,
            device: device_name.to_string(),
        },
    );

    let mut stream = SCStream::new(&filter, &config);

    if capture_system_audio {
        stream.add_output_handler(handler.clone(), SCStreamOutputType::Audio);
    }
    if capture_microphone {
        stream.add_output_handler(handler, SCStreamOutputType::Microphone);
    }

    stream
        .start_capture()
        .map_err(|e| format!("start_capture failed: {:?}", e))?;

    {
        let mut guard = SCK_STREAM.lock().unwrap();
        *guard = Some(stream);
    }

    let desc = if capture_system_audio && capture_microphone {
        "System + Mic"
    } else if capture_system_audio {
        "System Audio"
    } else {
        "Mic only"
    };

    println!("[ScreenCaptureKit] Capture started: {}", desc);
    Ok(format!("ScreenCaptureKit capture started ({})", desc))
}

#[cfg(target_os = "macos")]
fn stop_macos_capture_internal() {
    if let Some(stream) = SCK_STREAM.lock().unwrap().take() {
        let _ = stream.stop_capture();
        println!("[ScreenCaptureKit] Stopped");
    }
}

#[cfg(target_os = "macos")]
pub fn stop_macos_capture() {
    stop_macos_capture_internal();
}

/// Check / trigger screen recording permission prompt.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn check_screen_recording_permission() -> Result<bool, String> {
    match SCShareableContent::get() {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

/// List available sources for macOS native capture (displays, windows, apps).
/// Frontend can present these so user can choose a specific source for better privacy/targeting.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn list_macos_sources() -> Result<serde_json::Value, String> {
    let content = SCShareableContent::get()
        .map_err(|e| format!("Failed to get shareable content: {:?}", e))?;

    let displays: Vec<_> = content
        .displays()
        .into_iter()
        .enumerate()
        .map(|(i, d)| {
            serde_json::json!({
                "id": format!("display-{}", i),
                "type": "display",
                "title": format!("Display {}", i + 1),
                "width": d.width(),
                "height": d.height(),
            })
        })
        .collect();

    let windows: Vec<_> = content
        .windows()
        .into_iter()
        .filter(|w| w.is_on_screen())
        .take(30) // limit for UI
        .map(|w| {
            let title = w.title().unwrap_or_else(|| "Untitled Window".to_string());
            let app = w.owning_application().map(|a| a.application_name()).unwrap_or_else(|| "".to_string());
            serde_json::json!({
                "id": format!("window-{}", w.window_id()),
                "type": "window",
                "title": title,
                "app": app,
            })
        })
        .collect();

    let apps: Vec<_> = content
        .applications()
        .into_iter()
        .take(20)
        .map(|a| {
            serde_json::json!({
                "id": format!("app-{}", a.bundle_identifier()),
                "type": "application",
                "title": a.application_name(),
            })
        })
        .collect();

    Ok(serde_json::json!({
        "displays": displays,
        "windows": windows,
        "applications": apps,
    }))
}

/// Present the native macOS Content Sharing Picker so the user can choose
/// a specific display, window or application (instead of whole screen).
/// The chosen filter is stored internally and used on next start_macos_capture.
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn present_macos_content_picker(app: AppHandle) -> Result<String, String> {
    use screencapturekit::content_sharing_picker::{SCContentSharingPicker, SCContentSharingPickerConfiguration, SCPickerOutcome};

    let config = SCContentSharingPickerConfiguration::new();
    // We can customize modes here if wanted, e.g. allow SingleWindow + SingleDisplay

    SCContentSharingPicker::show(&config, move |outcome| {
        match outcome {
            SCPickerOutcome::Picked(result) => {
                let filter = result.filter();
                {
                    let mut guard = CURRENT_FILTER.lock().unwrap();
                    *guard = Some(filter);
                }
                let _ = app.emit("macos-source-picked", serde_json::json!({ "success": true }));
                println!("[ScreenCaptureKit] Content picked via native picker");
            }
            SCPickerOutcome::Cancelled => {
                let _ = app.emit("macos-source-picked", serde_json::json!({ "cancelled": true }));
            }
            SCPickerOutcome::Error(e) => {
                let _ = app.emit("macos-source-picked", serde_json::json!({ "error": e.to_string() }));
            }
        }
    });

    Ok("Picker presented".into())
}

/// Get the currently selected filter (if any) or create a default one.
#[cfg(target_os = "macos")]
fn get_or_create_filter() -> SCContentFilter {
    if let Some(f) = CURRENT_FILTER.lock().unwrap().take() {
        return f;
    }

    // Fallback to first display
    if let Ok(content) = SCShareableContent::get() {
        if let Some(display) = content.displays().into_iter().next() {
            return SCContentFilter::create()
                .with_display(&display)
                .with_excluding_windows(&[])
                .build();
        }
    }

    // Last resort (may not work well)
    SCContentFilter::create().build()
}

// Non-macOS stubs
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn start_macos_capture(
    _app: AppHandle,
    _capture_system_audio: bool,
    _capture_microphone: bool,
    _deepgram_key: Option<String>,
) -> Result<String, String> {
    Err("ScreenCaptureKit is only available on macOS".into())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn check_screen_recording_permission() -> Result<bool, String> {
    Ok(false)
}

#[cfg(not(target_os = "macos"))]
pub fn stop_macos_capture() {}
