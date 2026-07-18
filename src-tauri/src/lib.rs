mod audio;
mod commands;
mod db;

use audio::{start_capture, stop_capture, list_audio_devices};
use commands::{get_settings, save_settings, launch_copilot_window, hide_copilot_window, close_copilot_window, get_history, save_interview_record};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            start_capture,
            stop_capture,
            list_audio_devices,
            get_settings,
            save_settings,
            launch_copilot_window,
            hide_copilot_window,
            close_copilot_window,
            get_history,
            save_interview_record
        ])
        .setup(|app| {
            if let Err(e) = db::init_db(app) {
                eprintln!("DB init error: {}", e);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
