// macOS native audio capture using ScreenCaptureKit (screencapturekit crate v8+)
// This replaces the need for BlackHole for system + mic capture on macOS 13+ (best 15+).
//
// Emits the exact same events as the cpal path so the frontend (StealthCopilot.tsx)
// can stay mostly unchanged:
//   - audio-config
//   - audio-amplitude
//   - audio-chunk (Vec<f32>)

#[cfg(target_os = "macos")]
use screencapturekit::cm::CMSampleBuffer;
#[cfg(target_os = "macos")]
use screencapturekit::prelude::*;

use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
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
    source: AudioSource,
    mixer: Arc<Mutex<TimedAudioMixer>>,
}

#[cfg(target_os = "macos")]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AudioSource {
    System,
    Microphone,
}

#[cfg(target_os = "macos")]
#[derive(Default)]
struct MixedFrame {
    system: Option<f32>,
    microphone: Option<f32>,
}

#[cfg(target_os = "macos")]
struct TimedAudioMixer {
    system_enabled: bool,
    microphone_enabled: bool,
    sample_rate: u32,
    first_system_frame: Option<i64>,
    first_microphone_frame: Option<i64>,
    system_progress: Option<i64>,
    microphone_progress: Option<i64>,
    next_frame: Option<i64>,
    pending: BTreeMap<i64, MixedFrame>,
}

#[cfg(target_os = "macos")]
impl TimedAudioMixer {
    fn new(system_enabled: bool, microphone_enabled: bool, sample_rate: u32) -> Self {
        Self {
            system_enabled,
            microphone_enabled,
            sample_rate,
            first_system_frame: None,
            first_microphone_frame: None,
            system_progress: None,
            microphone_progress: None,
            next_frame: None,
            pending: BTreeMap::new(),
        }
    }

    fn push(&mut self, source: AudioSource, timestamp_seconds: f64, samples: Vec<f32>) -> Vec<f32> {
        if samples.is_empty() || !timestamp_seconds.is_finite() {
            return Vec::new();
        }

        let start_frame = (timestamp_seconds * f64::from(self.sample_rate)).round() as i64;
        let end_frame = start_frame + samples.len() as i64;

        match source {
            AudioSource::System => {
                self.first_system_frame.get_or_insert(start_frame);
                self.system_progress =
                    Some(self.system_progress.map_or(end_frame, |p| p.max(end_frame)));
            }
            AudioSource::Microphone => {
                self.first_microphone_frame.get_or_insert(start_frame);
                self.microphone_progress = Some(
                    self.microphone_progress
                        .map_or(end_frame, |p| p.max(end_frame)),
                );
            }
        }

        for (offset, sample) in samples.into_iter().enumerate() {
            let frame_number = start_frame + offset as i64;
            if self.next_frame.is_some_and(|next| frame_number < next) {
                continue;
            }
            let frame = self.pending.entry(frame_number).or_default();
            match source {
                AudioSource::System => frame.system = Some(sample),
                AudioSource::Microphone => frame.microphone = Some(sample),
            }
        }

        let all_sources_started = (!self.system_enabled || self.first_system_frame.is_some())
            && (!self.microphone_enabled || self.first_microphone_frame.is_some());
        if !all_sources_started {
            return Vec::new();
        }

        let first_frame = match (self.system_enabled, self.microphone_enabled) {
            (true, true) => self
                .first_system_frame
                .unwrap()
                .min(self.first_microphone_frame.unwrap()),
            (true, false) => self.first_system_frame.unwrap(),
            (false, true) => self.first_microphone_frame.unwrap(),
            (false, false) => return Vec::new(),
        };
        let next_frame = *self.next_frame.get_or_insert(first_frame);

        let completed_through = match (self.system_enabled, self.microphone_enabled) {
            (true, true) => self
                .system_progress
                .unwrap()
                .min(self.microphone_progress.unwrap()),
            (true, false) => self.system_progress.unwrap(),
            (false, true) => self.microphone_progress.unwrap(),
            (false, false) => return Vec::new(),
        };
        if completed_through <= next_frame {
            return Vec::new();
        }

        let mut mixed = Vec::with_capacity((completed_through - next_frame) as usize);
        for frame_number in next_frame..completed_through {
            let frame = self.pending.remove(&frame_number).unwrap_or_default();
            let sample = frame.system.unwrap_or(0.0) + frame.microphone.unwrap_or(0.0);
            mixed.push(sample.clamp(-0.98, 0.98));
        }
        self.next_frame = Some(completed_through);
        mixed
    }
}

#[cfg(target_os = "macos")]
fn decode_pcm_to_mono(
    bytes: &[u8],
    bits_per_channel: u32,
    is_float: bool,
    channels: usize,
) -> Vec<f32> {
    let samples: Vec<f32> = if is_float && bits_per_channel == 32 && bytes.len() % 4 == 0 {
        bytes
            .chunks_exact(4)
            .map(|chunk| {
                let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                if sample.is_finite() { sample } else { 0.0 }
            })
            .collect()
    } else if bits_per_channel == 16 && bytes.len() % 2 == 0 {
        bytes
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
            .collect()
    } else if bits_per_channel == 32 && bytes.len() % 4 == 0 {
        bytes
            .chunks_exact(4)
            .map(|chunk| {
                let sample = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                if sample.is_finite() { sample } else { 0.0 }
            })
            .collect()
    } else if bytes.len() % 2 == 0 {
        bytes
            .chunks_exact(2)
            .map(|chunk| i16::from_le_bytes([chunk[0], chunk[1]]) as f32 / 32768.0)
            .collect()
    } else {
        Vec::new()
    };

    let channels = channels.max(1);
    if channels == 1 {
        return samples;
    }

    let frame_count = samples.len() / channels;
    if frame_count == 0 {
        return Vec::new();
    }

    let mut channel_energy = vec![0.0f32; channels];
    for frame in samples.chunks_exact(channels) {
        for (channel, sample) in frame.iter().enumerate() {
            channel_energy[channel] += sample * sample;
        }
    }
    let (dominant_channel, dominant_energy) = channel_energy
        .iter()
        .copied()
        .enumerate()
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .unwrap();
    let second_energy = channel_energy
        .iter()
        .copied()
        .enumerate()
        .filter(|(channel, _)| *channel != dominant_channel)
        .map(|(_, energy)| energy)
        .fold(0.0f32, f32::max);
    let use_dominant_channel = dominant_energy > 1.0e-10 && dominant_energy > second_energy * 64.0;

    samples
        .chunks_exact(channels)
        .map(|frame| {
            if use_dominant_channel {
                frame[dominant_channel]
            } else {
                frame.iter().sum::<f32>() / channels as f32
            }
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn resample_linear(samples: Vec<f32>, input_rate: f64, output_rate: f64) -> Vec<f32> {
    if samples.is_empty()
        || input_rate <= 0.0
        || output_rate <= 0.0
        || (input_rate - output_rate).abs() < 1.0
    {
        return samples;
    }

    let output_len =
        ((samples.len() as f64 * output_rate / input_rate).round() as usize).max(1);
    (0..output_len)
        .map(|index| {
            let source_position = index as f64 * input_rate / output_rate;
            let left = (source_position.floor() as usize).min(samples.len() - 1);
            let right = (left + 1).min(samples.len() - 1);
            let fraction = (source_position - left as f64) as f32;
            samples[left] + (samples[right] - samples[left]) * fraction
        })
        .collect()
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::{decode_pcm_to_mono, resample_linear, AudioSource, TimedAudioMixer};

    #[test]
    fn downmixes_three_interleaved_channels_to_mono() {
        let frames = [[0.5f32, 0.0, 0.0], [-0.5, 0.0, 0.0]];
        let bytes: Vec<u8> = frames
            .into_iter()
            .flatten()
            .flat_map(f32::to_le_bytes)
            .collect();

        assert_eq!(decode_pcm_to_mono(&bytes, 32, true, 3), vec![0.5, -0.5]);
    }

    #[test]
    fn averages_balanced_interleaved_channels() {
        let frames = [[0.6f32, 0.2], [-0.2, -0.6]];
        let bytes: Vec<u8> = frames
            .into_iter()
            .flatten()
            .flat_map(f32::to_le_bytes)
            .collect();

        assert_eq!(decode_pcm_to_mono(&bytes, 32, true, 2), vec![0.4, -0.4]);
    }

    #[test]
    fn mixes_system_and_microphone_on_the_same_timeline() {
        let mut mixer = TimedAudioMixer::new(true, true, 48_000);

        assert!(mixer
            .push(AudioSource::System, 1.0, vec![0.2, 0.2])
            .is_empty());
        let mixed = mixer.push(AudioSource::Microphone, 1.0, vec![0.3, -0.3]);
        assert_eq!(mixed.len(), 2);
        assert!((mixed[0] - 0.5).abs() < 1.0e-6);
        assert!((mixed[1] + 0.1).abs() < 1.0e-6);
    }

    #[test]
    fn preserves_quiet_single_source_audio() {
        let mut mixer = TimedAudioMixer::new(false, true, 48_000);

        assert_eq!(
            mixer.push(AudioSource::Microphone, 1.0, vec![0.001, -0.001]),
            vec![0.001, -0.001]
        );
    }

    #[test]
    fn resamples_airpods_microphone_to_the_mix_rate() {
        let input = vec![0.25; 480];
        let output = resample_linear(input, 24_000.0, 48_000.0);

        assert_eq!(output.len(), 960);
        assert!(output.iter().all(|sample| (*sample - 0.25).abs() < 1.0e-6));
    }
}

#[cfg(target_os = "macos")]
impl SCStreamOutputTrait for AudioHandler {
    fn did_output_sample_buffer(&self, sample: CMSampleBuffer, of_type: SCStreamOutputType) {
        let source = match of_type {
            SCStreamOutputType::Audio => AudioSource::System,
            SCStreamOutputType::Microphone => AudioSource::Microphone,
            _ => return,
        };
        if source != self.source {
            return;
        }

        let Some(audio_list) = sample.audio_buffer_list() else {
            let _ = self.app.emit("audio-amplitude", 0.0f32);
            return;
        };

        let format_desc = sample.format_description();
        let bits_per_channel = format_desc
            .as_ref()
            .and_then(|desc| desc.audio_bits_per_channel())
            .unwrap_or(32);
        let input_rate = format_desc
            .as_ref()
            .and_then(|desc| desc.audio_sample_rate())
            .unwrap_or(48_000.0);
        let is_float = format_desc
            .as_ref()
            .is_some_and(|desc| desc.audio_is_float());

        let mut samples: Vec<f32> = Vec::new();

        for buffer in audio_list.iter() {
            let bytes = buffer.data();
            if bytes.is_empty() {
                continue;
            }

            samples.extend(decode_pcm_to_mono(
                bytes,
                bits_per_channel,
                is_float,
                buffer.number_channels.max(1) as usize,
            ));
        }

        if samples.is_empty() {
            let _ = self.app.emit("audio-amplitude", 0.0f32);
            return;
        }

        let samples = resample_linear(samples, input_rate, 48_000.0);

        let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
        let timestamp_seconds = sample.presentation_timestamp().as_seconds();
        let mixed = timestamp_seconds
            .and_then(|timestamp| {
                self.mixer
                    .lock()
                    .ok()
                    .map(|mut mixer| mixer.push(source, timestamp, samples))
            })
            .unwrap_or_default();

        let _ = self.app.emit("audio-amplitude", rms.min(1.0));
        if !mixed.is_empty() {
            let _ = self.app.emit("audio-chunk", mixed);
        }
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

    let mixer = Arc::new(Mutex::new(TimedAudioMixer::new(
        capture_system_audio,
        capture_microphone,
        48000,
    )));

    println!("[ScreenCaptureKit] Handler initialized with rate 48000 Hz");

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
        stream.add_output_handler(
            AudioHandler {
                app: app.clone(),
                source: AudioSource::System,
                mixer: mixer.clone(),
            },
            SCStreamOutputType::Audio,
        );
    }
    if capture_microphone {
        stream.add_output_handler(
            AudioHandler {
                app: app.clone(),
                source: AudioSource::Microphone,
                mixer,
            },
            SCStreamOutputType::Microphone,
        );
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
pub fn stop_macos_capture_sync() {
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
/// Fixed: clone the stored picked filter so the user's choice survives multiple start/stop cycles
/// (previously take() consumed it after first use).
#[cfg(target_os = "macos")]
fn get_or_create_filter() -> SCContentFilter {
    {
        let guard = CURRENT_FILTER.lock().unwrap();
        if let Some(f) = guard.as_ref() {
            // Clone the selection so it can be reused for future captures without re-picking.
            // (SCContentFilter is Clone in the screencapturekit crate.)
            return f.clone();
        }
    }

    // Fallback to first display (do not overwrite a picked filter)
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
pub fn stop_macos_capture_sync() {}
