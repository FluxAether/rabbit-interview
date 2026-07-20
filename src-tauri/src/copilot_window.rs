use once_cell::sync::Lazy;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const COPILOT_WINDOW_LABEL: &str = "copilot";

#[derive(Debug, Clone, Default)]
struct ProtectionState {
    requested: bool,
    applied: bool,
    request_dispatched: bool,
    error: Option<String>,
}

static PROTECTION_STATE: Lazy<Mutex<ProtectionState>> =
    Lazy::new(|| Mutex::new(ProtectionState::default()));

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct CopilotWindowStatus {
    pub visible: bool,
    pub protection_requested: bool,
    pub protection_applied: bool,
    pub platform_supported: bool,
    pub request_dispatched: bool,
    pub error: Option<String>,
}

fn platform_supported() -> bool {
    cfg!(any(target_os = "macos", target_os = "windows"))
}

fn remember_protection(requested: bool, result: Result<bool, String>) {
    let mut state = PROTECTION_STATE.lock().unwrap();
    state.requested = requested;
    state.request_dispatched = result.is_ok();
    match result {
        Ok(matches_requested_state) => {
            state.applied = requested && matches_requested_state;
            state.error = if matches_requested_state {
                None
            } else {
                Some(
                    "The operating system did not confirm the requested capture-protection state"
                        .into(),
                )
            };
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
        platform_supported: platform_supported(),
        request_dispatched: state.request_dispatched,
        error: state.error,
    }
}

#[cfg(target_os = "macos")]
fn native_protection_matches(window: &WebviewWindow, protected: bool) -> Result<bool, String> {
    use objc2_app_kit::{NSWindow, NSWindowSharingType};
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    let window = unsafe { &*pointer.cast::<NSWindow>() };
    let expected = if protected {
        NSWindowSharingType::None
    } else {
        NSWindowSharingType::ReadOnly
    };
    Ok(window.sharingType() == expected)
}

#[cfg(target_os = "windows")]
fn native_protection_matches(window: &WebviewWindow, protected: bool) -> Result<bool, String> {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };
    let mut affinity = WDA_NONE.0;
    unsafe {
        GetWindowDisplayAffinity(
            window.hwnd().map_err(|error| error.to_string())?,
            &mut affinity,
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(affinity
        == if protected {
            WDA_EXCLUDEFROMCAPTURE.0
        } else {
            WDA_NONE.0
        })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn native_protection_matches(_window: &WebviewWindow, _protected: bool) -> Result<bool, String> {
    Err("Screen capture protection is not supported on this platform".into())
}

fn apply_and_verify_protection(window: &WebviewWindow, protected: bool) -> Result<bool, String> {
    window
        .set_content_protected(protected)
        .map_err(|error| error.to_string())?;
    if !platform_supported() {
        return Err("Screen capture protection is not supported on this platform".into());
    }

    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let verify_window = window.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(native_protection_matches(&verify_window, protected));
        })
        .map_err(|error| error.to_string())?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(2))
        .map_err(|error| format!("Timed out while verifying capture protection: {error}"))?
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

    Ok(window)
}

#[tauri::command]
pub async fn show_copilot_window(
    app: AppHandle,
    protected: bool,
) -> Result<CopilotWindowStatus, String> {
    let window = match app.get_webview_window(COPILOT_WINDOW_LABEL) {
        Some(existing) => {
            existing.show().map_err(|error| error.to_string())?;
            existing.set_focus().map_err(|error| error.to_string())?;
            existing
        }
        None => create_copilot_window(&app, protected)?,
    };
    remember_protection(protected, apply_and_verify_protection(&window, protected));

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
            platform_supported: true,
            request_dispatched: true,
            error: Some("unsupported".into()),
        };
        let json = serde_json::to_value(status).unwrap();
        assert_eq!(json["visible"], true);
        assert_eq!(json["protection_requested"], true);
        assert_eq!(json["protection_applied"], false);
        assert_eq!(json["platform_supported"], true);
        assert_eq!(json["request_dispatched"], true);
        assert_eq!(json["error"], "unsupported");
    }
}
