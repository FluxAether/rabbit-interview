use once_cell::sync::Lazy;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

static SPEECH_PROCESS: Lazy<Mutex<Option<Child>>> = Lazy::new(|| Mutex::new(None));

fn stop_current() {
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

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (language, rate);
        Err("System speech is currently supported on macOS only".into())
    }
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
