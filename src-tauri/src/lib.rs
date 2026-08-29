mod audio;
mod copilot_window;
mod secure_store;
mod speech;
mod stt;

use audio::{
    clear_audio_recordings, export_audio_recording, get_audio_capabilities,
    get_recording_storage_usage, list_audio_devices, read_saved_recording, save_audio_recording,
    start_audio_capture, stop_audio_capture,
};
use copilot_window::{
    get_copilot_window_status, hide_copilot_window, set_copilot_window_opacity,
    show_copilot_window, toggle_copilot_window,
};
use secure_store::{delete_secure_secret, load_secure_secret, save_secure_secret};
use speech::{speak_text, stop_speaking};
use stt::apple::{
    get_apple_stt_status, get_microphone_permission_status, request_microphone_permission_command,
    start_apple_stt, stop_apple_stt, test_apple_stt,
};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
            start_audio_capture,
            stop_audio_capture,
            save_audio_recording,
            read_saved_recording,
            get_recording_storage_usage,
            clear_audio_recordings,
            export_audio_recording,
            get_audio_capabilities,
            list_audio_devices,
            show_copilot_window,
            hide_copilot_window,
            toggle_copilot_window,
            get_copilot_window_status,
            set_copilot_window_opacity,
            speak_text,
            stop_speaking,
            get_apple_stt_status,
            start_apple_stt,
            stop_apple_stt,
            test_apple_stt,
            get_microphone_permission_status,
            request_microphone_permission_command,
            load_secure_secret,
            save_secure_secret,
            delete_secure_secret,
        ])
        .setup(|app| {
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

            stt::apple::attach_app(app.handle());

            if let Some(urls) = app.deep_link().get_current()? {
                for url in urls {
                    emit_auth_callback(app.handle(), &url);
                }
            }
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    emit_auth_callback(&handle, &url);
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                audio::stop_audio_capture_and_wait();
                speech::stop_current();
                stt::apple::stop();
            }
        });
}

fn emit_auth_callback(app: &tauri::AppHandle, url: &url::Url) {
    if is_auth_callback(url) {
        let _ = app.emit("auth-callback", url.as_str());
    }
}

fn is_auth_callback(url: &url::Url) -> bool {
    if url.scheme() != "rabbitinterview"
        || url.host_str() != Some("auth")
        || !matches!(url.path(), "/callback" | "/logout")
    {
        return false;
    }
    let query = url
        .query_pairs()
        .collect::<std::collections::HashMap<_, _>>();
    let has_state = query.get("state").is_some_and(|value| !value.is_empty());
    let has_result = url.path() == "/logout"
        || query.get("code").is_some_and(|value| !value.is_empty())
        || query.get("error").is_some_and(|value| !value.is_empty());
    has_state && has_result
}

#[cfg(test)]
mod hosted_auth_tests {
    use super::is_auth_callback;

    #[test]
    fn accepts_only_the_exact_oidc_callback_shape() {
        assert!(is_auth_callback(
            &url::Url::parse("rabbitinterview://auth/callback?state=s&code=c").unwrap()
        ));
        assert!(is_auth_callback(
            &url::Url::parse("rabbitinterview://auth/logout?state=s").unwrap()
        ));
        for rejected in [
            "rabbitinterview://auth/other?state=s&code=c",
            "https://auth/callback?state=s&code=c",
            "rabbitinterview://auth/callback?code=c",
            "rabbitinterview://auth/callback?state=s",
        ] {
            assert!(!is_auth_callback(&url::Url::parse(rejected).unwrap()));
        }
    }
}
