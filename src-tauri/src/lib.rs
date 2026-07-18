mod audio;
mod commands;
mod db;

use audio::{start_capture, stop_capture, list_audio_devices};

#[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
use audio::{start_macos_capture, check_screen_recording_permission, list_macos_sources, present_macos_content_picker};
use commands::{get_settings, save_settings, launch_copilot_window, hide_copilot_window, close_copilot_window, get_history, save_interview_record};
use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

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
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, _shortcut_id| {
                    // We only care about the two documented shortcuts.
                    // Emit different events so frontend can react appropriately.
                    let _ = match shortcut {
                        s if s.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyC) => {
                            app.emit("toggle-capture", ())
                        }
                        s if s.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyI) => {
                            app.emit("toggle-copilot", ())
                        }
                        _ => Ok(()),
                    };
                })
                .build()
        )
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
            save_interview_record,
            // macOS native audio (ScreenCaptureKit) — enabled with feature "macos-system-audio"
            #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
            start_macos_capture,
            #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
            check_screen_recording_permission,
            #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
            list_macos_sources,
            #[cfg(all(target_os = "macos", feature = "macos-system-audio"))]
            present_macos_content_picker,
        ])
        .setup(|app| {
            if let Err(e) = db::init_db(app) {
                eprintln!("DB init error: {}", e);
            }

            // Register the actual hotkey combinations.
            // The .with_handler on the plugin builder above will receive them and emit events.
            let capture_shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyC);
            if let Err(e) = app.global_shortcut().register(capture_shortcut) {
                eprintln!("Failed to register ⌘⇧C capture shortcut: {}", e);
            }

            let copilot_shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyI);
            if let Err(e) = app.global_shortcut().register(copilot_shortcut) {
                eprintln!("Failed to register ⌘⇧I copilot shortcut: {}", e);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
