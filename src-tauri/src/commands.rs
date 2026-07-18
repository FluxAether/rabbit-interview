use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindowBuilder, WebviewUrl};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub launch_at_startup: bool,
    pub auto_update: bool,
    pub update_channel: String,
    pub language: String,
    pub ai_model: String,
    pub stealth_enabled: bool,
    pub mic_device: Option<String>,
    // STT provider configuration
    pub stt_provider: String,
    pub stt_model: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "Light".into(),
            launch_at_startup: true,
            auto_update: true,
            update_channel: "Stable".into(),
            language: "zh-CN".into(),
            ai_model: "groq-llama-3.1".into(),
            stealth_enabled: true,
            mic_device: None,
            stt_provider: "deepgram".into(),
            stt_model: "nova-2".into(),
        }
    }
}

#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    // In full version load from sqlite. For now return defaults + localStorage simulated.
    Ok(AppSettings::default())
}

#[tauri::command]
pub async fn save_settings(settings: AppSettings) -> Result<(), String> {
    println!("Saving settings: {:?}", settings);
    // TODO: persist to SQLite via sql plugin
    Ok(())
}

#[tauri::command]
pub async fn launch_copilot_window(app: AppHandle) -> Result<(), String> {
    // Create or focus the floating stealth copilot window matching the design exactly
    if let Some(existing) = app.get_webview_window("copilot") {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let _window = WebviewWindowBuilder::new(
        &app,
        "copilot",
        WebviewUrl::App("index.html#copilot-floating".into()),
    )
    .title("AI Interview Assistant")
    .inner_size(420.0, 380.0)
    .resizable(false)
    .decorations(false)
    .closable(true)
    .always_on_top(true)
    .shadow(true)
    .skip_taskbar(true)
    // Do not set transparent(true) here — the floating panel uses CSS background + blur
    .build()
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub async fn hide_copilot_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("copilot") {
        let _ = window.hide();
    }
    Ok(())
}

#[tauri::command]
pub async fn close_copilot_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("copilot") {
        let _ = window.close();
    }
    Ok(())
}

// Interview record types
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InterviewRecord {
    pub id: Option<i64>,
    pub date: String,
    pub role: String,
    pub company: String,
    pub score: i32,
    pub transcript: String,
    pub duration: i32,
    pub mode: String,
}

#[tauri::command]
pub async fn save_interview_record(record: InterviewRecord) -> Result<i64, String> {
    println!("Saving interview record: {:?}", record);
    // Real impl: INSERT into sqlite and return id
    Ok(123) // mock id
}

#[tauri::command]
pub async fn get_history() -> Result<Vec<InterviewRecord>, String> {
    // Mock data for now — will be replaced by real DB query
    Ok(vec![
        InterviewRecord {
            id: Some(1),
            date: "2025-05-24 10:30".into(),
            role: "Senior Product Designer".into(),
            company: "TechNova Inc.".into(),
            score: 88,
            transcript: "User: ... AI: ...".into(),
            duration: 1240,
            mode: "behavioral".into(),
        },
        InterviewRecord {
            id: Some(2),
            date: "2025-05-20 14:15".into(),
            role: "Frontend Engineer".into(),
            company: "CodeSphere".into(),
            score: 76,
            transcript: "".into(),
            duration: 980,
            mode: "technical".into(),
        },
    ])
}