use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_float, c_int};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

const TRANSCRIPT_EVENT: &str = "stt-transcript";
const ERROR_EVENT: &str = "stt-error";

#[derive(Clone, Serialize, Deserialize)]
pub struct AppleSttStatus {
    pub available: bool,
    pub os_supported: bool,
    pub apple_silicon: bool,
    pub speech_supported: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Serialize)]
pub struct AppleTranscriptEvent {
    #[serde(rename = "sessionId")]
    pub session_id: Option<u64>,
    pub generation: Option<u64>,
    pub source: String,
    pub text: String,
    pub is_final: bool,
    pub boundary: String,
}

#[derive(Clone, Serialize)]
pub struct AppleSttErrorEvent {
    #[serde(rename = "sessionId")]
    pub session_id: Option<u64>,
    pub generation: Option<u64>,
    pub source: String,
    pub message: String,
}

static APP: OnceCell<AppHandle> = OnceCell::new();
static CALLBACKS_READY: AtomicBool = AtomicBool::new(false);
// ponytail: the Swift bridge is global; serialize startup until it supports independent runtimes.
static LIFECYCLE: Mutex<()> = Mutex::new(());
static STARTED_SOURCES: Mutex<Vec<String>> = Mutex::new(Vec::new());

#[cfg(target_os = "macos")]
#[link(name = "AppleSttBridge", kind = "static")]
unsafe extern "C" {
    fn rabbit_apple_stt_set_callbacks(
        transcript: extern "C" fn(*const c_char, *const c_char, bool, *const c_char, u64),
        error: extern "C" fn(*const c_char, *const c_char, u64),
    );
    fn rabbit_apple_stt_status_json() -> *mut c_char;
    fn rabbit_apple_stt_start(
        sources: *const c_char,
        language: *const c_char,
        generation: u64,
    ) -> *mut c_char;
    fn rabbit_apple_stt_push(source: *const c_char, samples: *const c_float, count: c_int);
    fn rabbit_apple_stt_stop();
    fn rabbit_apple_stt_free_string(ptr: *mut c_char);
    fn rabbit_microphone_status() -> *mut c_char;
    fn rabbit_request_microphone() -> *mut c_char;
}

fn cstr_to_string(ptr: *const c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_string_lossy()
        .into_owned()
}

fn take_c_string(ptr: *mut c_char) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let value = cstr_to_string(ptr);
    #[cfg(target_os = "macos")]
    unsafe {
        rabbit_apple_stt_free_string(ptr);
    }
    value
}

extern "C" fn on_transcript(
    source: *const c_char,
    text: *const c_char,
    is_final: bool,
    boundary: *const c_char,
    generation: u64,
) {
    let Some(app) = APP.get() else {
        return;
    };
    let identity = super::realtime::apple_identity(&cstr_to_string(source));
    if identity.map(|id| id.1).unwrap_or(0) != generation {
        return;
    }
    let _ = app.emit(
        TRANSCRIPT_EVENT,
        AppleTranscriptEvent {
            session_id: identity.map(|id| id.0),
            generation: identity.map(|id| id.1),
            source: cstr_to_string(source),
            text: cstr_to_string(text),
            is_final,
            boundary: cstr_to_string(boundary),
        },
    );
}

extern "C" fn on_error(source: *const c_char, message: *const c_char, generation: u64) {
    let Some(app) = APP.get() else {
        return;
    };
    let identity = super::realtime::apple_identity(&cstr_to_string(source));
    if identity.map(|id| id.1).unwrap_or(0) != generation {
        return;
    }
    let _ = app.emit(
        ERROR_EVENT,
        AppleSttErrorEvent {
            session_id: identity.map(|id| id.0),
            generation: identity.map(|id| id.1),
            source: cstr_to_string(source),
            message: cstr_to_string(message),
        },
    );
}

pub fn microphone_permission_status() -> String {
    #[cfg(not(target_os = "macos"))]
    {
        "granted".into()
    }
    #[cfg(target_os = "macos")]
    {
        take_c_string(unsafe { rabbit_microphone_status() })
    }
}

pub fn request_microphone_permission() -> String {
    #[cfg(not(target_os = "macos"))]
    {
        "granted".into()
    }
    #[cfg(target_os = "macos")]
    {
        take_c_string(unsafe { rabbit_request_microphone() })
    }
}

pub fn attach_app(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(target_os = "macos")]
    if !CALLBACKS_READY.swap(true, Ordering::SeqCst) {
        unsafe { rabbit_apple_stt_set_callbacks(on_transcript, on_error) };
    }
}

fn unavailable_status(reason: &str) -> AppleSttStatus {
    AppleSttStatus {
        available: false,
        os_supported: false,
        apple_silicon: false,
        speech_supported: false,
        reason: Some(reason.to_string()),
    }
}

pub fn status() -> AppleSttStatus {
    #[cfg(not(target_os = "macos"))]
    {
        return unavailable_status("Apple on-device STT is only available on macOS");
    }

    #[cfg(target_os = "macos")]
    {
        let raw = unsafe { rabbit_apple_stt_status_json() };
        let json = take_c_string(raw);
        serde_json::from_str(&json)
            .unwrap_or_else(|_| unavailable_status("Apple STT status was invalid"))
    }
}

pub fn start(sources: &[String], language: &str) -> Result<(), String> {
    let _lifecycle = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
    if super::realtime::has_apple_sessions() {
        return Err("Apple STT is owned by an active capture".into());
    }
    start_inner(sources, language, 0)
}

pub(crate) fn start_owned(
    sources: &[String],
    language: &str,
    generation: u64,
) -> Result<(), String> {
    let _lifecycle = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
    if !sources
        .iter()
        .all(|source| super::realtime::is_generation(source, generation))
    {
        return Err("Apple STT startup was cancelled".into());
    }
    start_inner(sources, language, generation)
}

fn start_inner(sources: &[String], language: &str, generation: u64) -> Result<(), String> {
    if sources.is_empty() {
        return Err("No Apple STT audio sources were requested".into());
    }
    let status = status();
    if !status.available {
        return Err(status
            .reason
            .unwrap_or_else(|| "Apple on-device STT is unavailable".into()));
    }
    if language == "multi" {
        return Err("Apple on-device STT does not support multilingual auto-detect".into());
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = (sources, generation);
        return Err("Apple on-device STT is only available on macOS".into());
    }

    #[cfg(target_os = "macos")]
    {
        let csv = sources.join(",");
        let sources_c = CString::new(csv).map_err(|error| error.to_string())?;
        let language_c = CString::new(language).map_err(|error| error.to_string())?;
        let error_ptr =
            unsafe { rabbit_apple_stt_start(sources_c.as_ptr(), language_c.as_ptr(), generation) };
        let error = take_c_string(error_ptr);
        if !error.is_empty() {
            return Err(error);
        }
        *STARTED_SOURCES
            .lock()
            .unwrap_or_else(|error| error.into_inner()) = sources.to_vec();
        Ok(())
    }
}

pub fn push_samples(source: &str, samples: &[f32]) {
    if samples.is_empty() || !is_active() {
        return;
    }
    #[cfg(target_os = "macos")]
    {
        let Ok(source_c) = CString::new(source) else {
            return;
        };
        unsafe {
            rabbit_apple_stt_push(source_c.as_ptr(), samples.as_ptr(), samples.len() as c_int);
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = source;
        let _ = samples;
    }
}

pub fn stop() {
    let _lifecycle = LIFECYCLE.lock().unwrap_or_else(|e| e.into_inner());
    if !super::realtime::has_apple_sessions() {
        stop_inner();
    }
}

fn stop_inner() {
    #[cfg(target_os = "macos")]
    unsafe {
        rabbit_apple_stt_stop();
    }
    STARTED_SOURCES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

pub fn is_active() -> bool {
    !STARTED_SOURCES
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .is_empty()
}

#[tauri::command]
pub fn get_apple_stt_status() -> AppleSttStatus {
    status()
}

#[tauri::command]
pub async fn start_apple_stt(
    sources: Vec<String>,
    language: String,
) -> Result<AppleSttStatus, String> {
    start(&sources, &language)?;
    Ok(status())
}

#[tauri::command]
pub async fn stop_apple_stt() -> Result<(), String> {
    stop();
    Ok(())
}

#[tauri::command]
pub async fn test_apple_stt(language: String) -> Result<AppleSttStatus, String> {
    start(&["microphone".into()], &language)?;
    stop();
    Ok(status())
}

#[tauri::command]
pub fn get_microphone_permission_status() -> String {
    microphone_permission_status()
}

#[tauri::command]
pub async fn request_microphone_permission_command() -> String {
    tokio::task::spawn_blocking(request_microphone_permission)
        .await
        .unwrap_or_else(|_| "denied".into())
}
