use once_cell::sync::Lazy;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

#[derive(Default)]
struct SpeechState {
    generation: u64,
    child: Option<Child>,
}

static SPEECH_STATE: Lazy<Mutex<SpeechState>> = Lazy::new(|| Mutex::new(SpeechState::default()));

fn terminate_child(child: Option<Child>) {
    if let Some(mut child) = child {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn reserve_generation() -> (u64, Option<Child>) {
    let mut state = SPEECH_STATE.lock().unwrap_or_else(|e| e.into_inner());
    state.generation = state.generation.wrapping_add(1);
    (state.generation, state.child.take())
}

pub fn stop_current() {
    let (_, child) = reserve_generation();
    terminate_child(child);
}

fn voice_for_language(language: &str) -> Option<&'static str> {
    match language {
        "zh-CN" => Some("Tingting"),
        "zh-TW" => Some("Meijia"),
        "en-US" => Some("Samantha"),
        _ => None,
    }
}

#[tauri::command]
pub async fn stop_speaking() -> Result<(), String> {
    stop_current();
    Ok(())
}

#[tauri::command]
pub async fn speak_text(text: String, _language: String, rate: Option<u16>) -> Result<(), String> {
    #[allow(unused_variables)]
    let language = _language;
    let text = text.trim();
    if text.is_empty() {
        stop_current();
        return Ok(());
    }
    if text.chars().count() > 2_000 {
        return Err("Speech text is too long".into());
    }

    let (generation, previous_child) = reserve_generation();
    terminate_child(previous_child);

    let child = spawn_speech_process(text, &language, rate)?;
    {
        let mut state = SPEECH_STATE.lock().unwrap_or_else(|e| e.into_inner());
        if state.generation != generation {
            drop(state);
            terminate_child(Some(child));
            return Ok(());
        }
        state.child = Some(child);
    }

    loop {
        let status = {
            let mut state = SPEECH_STATE.lock().unwrap_or_else(|e| e.into_inner());
            if state.generation != generation {
                return Ok(());
            }
            let Some(child) = state.child.as_mut() else {
                return Ok(());
            };
            child.try_wait().map_err(|error| error.to_string())?
        };

        if let Some(status) = status {
            let mut state = SPEECH_STATE.lock().unwrap_or_else(|e| e.into_inner());
            if state.generation == generation {
                state.child.take();
            }
            return if status.success() {
                Ok(())
            } else {
                Err(format!("Speech process exited with status {status}"))
            };
        }

        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[cfg(target_os = "macos")]
fn spawn_speech_process(text: &str, language: &str, rate: Option<u16>) -> Result<Child, String> {
    let mut command = Command::new("/usr/bin/say");
    command
        .arg("-r")
        .arg(rate.unwrap_or(185).clamp(100, 300).to_string());
    if let Some(voice) = voice_for_language(language) {
        command.arg("-v").arg(voice);
    }
    command
        .arg(text)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.spawn().map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn spawn_speech_process(text: &str, _language: &str, rate: Option<u16>) -> Result<Child, String> {
    let rate_val = ((i32::from(rate.unwrap_or(185).clamp(100, 300)) - 185) / 10).clamp(-10, 10);
    let escaped_text = text.replace('\'', "''");
    let ps_script = format!(
        "$s = New-Object -ComObject SAPI.SpVoice; $s.Rate = {}; $s.Speak('{}');",
        rate_val, escaped_text
    );
    let utf16_bytes: Vec<u8> = ps_script
        .encode_utf16()
        .flat_map(|u| u.to_le_bytes())
        .collect();
    let encoded = encode_base64(&utf16_bytes);

    let mut command = Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.spawn().map_err(|error| error.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn spawn_speech_process(_text: &str, _language: &str, _rate: Option<u16>) -> Result<Child, String> {
    Err("System speech is supported on macOS and Windows only".into())
}

#[cfg(target_os = "windows")]
fn encode_base64(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in data.chunks(3) {
        let b0 = chunk[0];
        let b1 = if chunk.len() > 1 { chunk[1] } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] } else { 0 };
        let triple = (u32::from(b0) << 16) | (u32::from(b1) << 8) | u32::from(b2);
        result.push(CHARSET[((triple >> 18) & 63) as usize] as char);
        result.push(CHARSET[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[((triple >> 6) & 63) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(triple & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::{stop_current, voice_for_language};

    #[test]
    fn maps_supported_languages() {
        assert_eq!(voice_for_language("zh-CN"), Some("Tingting"));
        assert_eq!(voice_for_language("zh-TW"), Some("Meijia"));
        assert_eq!(voice_for_language("en-US"), Some("Samantha"));
        assert_eq!(voice_for_language("fr-FR"), None);
    }

    #[test]
    fn repeated_stop_is_idempotent() {
        stop_current();
        stop_current();
    }
}
