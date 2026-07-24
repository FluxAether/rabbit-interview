mod audio;
mod commands;
mod copilot_window;
mod db;
mod speech;

use audio::{
    export_audio_recording, get_audio_capabilities, list_audio_devices, save_audio_recording,
    start_audio_capture, stop_audio_capture,
};
use commands::{get_history, get_settings, save_interview_record, save_settings};
use copilot_window::{
    close_copilot_window, get_copilot_window_status, hide_copilot_window,
    set_copilot_window_opacity, show_copilot_window, toggle_copilot_window,
};
use speech::{speak_text, stop_speaking};
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
                .build(),
        )
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            greet,
            start_audio_capture,
            stop_audio_capture,
            save_audio_recording,
            export_audio_recording,
            get_audio_capabilities,
            list_audio_devices,
            get_settings,
            save_settings,
            show_copilot_window,
            hide_copilot_window,
            toggle_copilot_window,
            get_copilot_window_status,
            set_copilot_window_opacity,
            close_copilot_window,
            get_history,
            save_interview_record,
            speak_text,
            stop_speaking,
        ])
        .setup(|app| {
            if let Err(e) = db::init_db(app) {
                eprintln!("DB init error: {}", e);
            }

            // Register the actual hotkey combinations.
            // The .with_handler on the plugin builder above will receive them and emit events.
            let capture_shortcut =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyC);
            if let Err(e) = app.global_shortcut().register(capture_shortcut) {
                eprintln!("Failed to register ⌘⇧C capture shortcut: {}", e);
            }

            let copilot_shortcut =
                Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyI);
            if let Err(e) = app.global_shortcut().register(copilot_shortcut) {
                eprintln!("Failed to register ⌘⇧I copilot shortcut: {}", e);
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if matches!(event, tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }) {
                audio::stop_audio_capture_and_wait();
                speech::stop_speaking();
            }
        });
}
