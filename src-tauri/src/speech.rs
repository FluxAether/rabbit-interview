use once_cell::sync::Lazy;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static SPEECH_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

pub fn stop_current() {
    if let Some(mut child) = SPEECH_PROCESS.lock().unwrap_or_else(|e| e.into_inner()).take() {
        let _ = child.kill();
        let _ = child.wait();
    }
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
pub async fn speak_text(text: String, language: String, rate: Option<u16>) -> Result<(), String> {
    stop_current();
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    if text.chars().count() > 2_000 {
        return Err("Speech text is too long".into());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/say");
        command
            .arg("-r")
            .arg(rate.unwrap_or(185).clamp(100, 300).to_string());
        if let Some(voice) = voice_for_language(&language) {
            command.arg("-v").arg(voice);
        }
        command
            .arg(text)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let child = command.spawn().map_err(|error| error.to_string())?;
        *SPEECH_PROCESS.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
        Ok(())
    }

    #[cfg(target_os = "windows")]
    {
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
        let child = command.spawn().map_err(|error| error.to_string())?;
        *SPEECH_PROCESS.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);
        Ok(())
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (language, rate);
        Err("System speech is supported on macOS and Windows only".into())
    }
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
    use super::voice_for_language;

    #[test]
    fn maps_supported_languages() {
        assert_eq!(voice_for_language("zh-CN"), Some("Tingting"));
        assert_eq!(voice_for_language("zh-TW"), Some("Meijia"));
        assert_eq!(voice_for_language("en-US"), Some("Samantha"));
        assert_eq!(voice_for_language("fr-FR"), None);
    }
}
