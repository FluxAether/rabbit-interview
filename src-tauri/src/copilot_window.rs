use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const COPILOT_WINDOW_LABEL: &str = "copilot";

#[derive(Debug, Clone, Default)]
struct ProtectionState {
    requested: bool,
    applied: bool,
    error: Option<String>,
}

static PROTECTION_STATE: Lazy<Mutex<ProtectionState>> =
    Lazy::new(|| Mutex::new(ProtectionState::default()));

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CopilotWindowStatus {
    pub visible: bool,
    pub protection_requested: bool,
    pub protection_applied: bool,
    pub error: Option<String>,
}

fn remember_protection(requested: bool, result: Result<(), tauri::Error>) {
    let mut state = PROTECTION_STATE.lock().unwrap();
    state.requested = requested;
    match result {
        Ok(()) => {
            state.applied = requested;
            state.error = None;
        }
        Err(error) => {
            state.applied = false;
            state.error = Some(error.to_string());
        }
    }
}

fn status(window: Option<&WebviewWindow>) -> CopilotWindowStatus {
    let state = PROTECTION_STATE.lock().unwrap().clone();
    CopilotWindowStatus {
        visible: window
            .and_then(|value| value.is_visible().ok())
            .unwrap_or(false),
        protection_requested: state.requested,
        protection_applied: state.applied,
        error: state.error,
    }
}

fn create_copilot_window(app: &AppHandle, protected: bool) -> Result<WebviewWindow, String> {
    let window = WebviewWindowBuilder::new(
        app,
        COPILOT_WINDOW_LABEL,
        WebviewUrl::App("index.html#copilot-floating".into()),
    )
    .title("AI Interview Assistant")
    .inner_size(440.0, 480.0)
    .min_inner_size(360.0, 360.0)
    .max_inner_size(820.0, 900.0)
    .resizable(true)
    .decorations(false)
    .closable(true)
    .always_on_top(true)
    .shadow(true)
    .skip_taskbar(true)
    .content_protected(protected)
    .build()
    .map_err(|error| error.to_string())?;

    remember_protection(protected, Ok(()));
    Ok(window)
}

#[tauri::command]
pub async fn show_copilot_window(
    app: AppHandle,
    protected: bool,
) -> Result<CopilotWindowStatus, String> {
    let window = match app.get_webview_window(COPILOT_WINDOW_LABEL) {
        Some(existing) => {
            remember_protection(protected, existing.set_content_protected(protected));
            existing.show().map_err(|error| error.to_string())?;
            existing.set_focus().map_err(|error| error.to_string())?;
            existing
        }
        None => create_copilot_window(&app, protected)?,
    };

    Ok(status(Some(&window)))
}

#[tauri::command]
pub async fn hide_copilot_window(app: AppHandle) -> Result<CopilotWindowStatus, String> {
    if let Some(window) = app.get_webview_window(COPILOT_WINDOW_LABEL) {
        window.hide().map_err(|error| error.to_string())?;
        return Ok(status(Some(&window)));
    }
    Ok(status(None))
}

#[tauri::command]
pub async fn toggle_copilot_window(
    app: AppHandle,
    protected: bool,
) -> Result<CopilotWindowStatus, String> {
    if let Some(window) = app.get_webview_window(COPILOT_WINDOW_LABEL) {
        if window.is_visible().unwrap_or(false) {
            return hide_copilot_window(app).await;
        }
    }
    show_copilot_window(app, protected).await
}

#[tauri::command]
pub async fn get_copilot_window_status(app: AppHandle) -> CopilotWindowStatus {
    let window = app.get_webview_window(COPILOT_WINDOW_LABEL);
    status(window.as_ref())
}

#[tauri::command]
pub async fn close_copilot_window(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(COPILOT_WINDOW_LABEL) {
        window.close().map_err(|error| error.to_string())?;
    }
    *PROTECTION_STATE.lock().unwrap() = ProtectionState::default();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::CopilotWindowStatus;

    #[test]
    fn serializes_truthful_protection_fields() {
        let status = CopilotWindowStatus {
            visible: true,
            protection_requested: true,
            protection_applied: false,
            error: Some("unsupported".into()),
        };
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["visible"], true);
        assert_eq!(json["protection_requested"], true);
        assert_eq!(json["protection_applied"], false);
        assert_eq!(json["error"], "unsupported");
    }
}
