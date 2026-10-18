// Prevents an extra console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Emitter, Manager};

mod commands;
mod plugins;
mod state;

use arc_core::Document;
use state::{load_settings, save_settings, SharedState, Settings};

fn main() {
    let app_state: SharedState = Arc::new(Mutex::new(state::AppState::new()));
    let plugin_state: plugins::PluginLock = Mutex::new(plugins::PluginRuntime::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .manage(plugin_state)
        .setup(|app| {
            // Settings file lives in the app data dir.
            let data_dir = app
                .path()
                .app_data_dir()
                .expect("app data dir")
                .to_path_buf();
            let settings_path = data_dir.join("settings.json");
            let settings: Settings = load_settings(&settings_path);
            let shared = app.state::<SharedState>();
            {
                let mut s = shared.lock();
                s.settings = settings.clone();
                s.settings_path = Some(settings_path.clone());
                // The editor needs an active document to be usable, so create
                // one on first launch (and whenever none remains).
                if s.active.is_none() {
                    let id = s.next_doc_id();
                    let name = format!("Untitled {}", s.doc_counter);
                    s.documents.insert(id.clone(), Document::new(name));
                    s.order.push(id.clone());
                    s.active = Some(id);
                }
            }

            // Plugin dirs: beside the executable + app data dir.
            let exe_plugins = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|d| d.join("plugins")))
                .unwrap_or(data_dir.join("plugins"));
            let mut dirs = vec![exe_plugins, data_dir.join("plugins")];
            #[cfg(debug_assertions)]
            if let Ok(manifest) = std::env::var("CARGO_MANIFEST_DIR") {
                dirs.push(std::path::PathBuf::from(manifest).join("plugins"));
            }

            // Initial settings payload for the webview renderer.
            let _ = app.handle().emit("arc://settings", settings.clone());

            #[cfg(feature = "lua")]
            {
                let plugins = app.state::<plugins::PluginLock>();
                plugins.lock().dirs = dirs;
                plugins.lock().reload(&shared, &app.handle().clone());
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let shared = window.state::<SharedState>();
                let (settings, path) = {
                    let s = shared.lock();
                    (s.settings.clone(), s.settings_path.clone())
                };
                if let Some(path) = path {
                    save_settings(&path, &settings);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_plugins,
            commands::get_settings,
            commands::set_settings,
            commands::new_document,
            commands::open_document,
            commands::save_document,
            commands::close_document,
            commands::set_active_document,
            commands::get_scene,
            commands::create_entity,
            commands::update_geometry,
            commands::delete_entities,
            commands::duplicate_entities,
            commands::explode_entities,
            commands::set_transform,
            commands::set_entity_props,
            commands::set_selection,
            commands::raycast,
            commands::undo,
            commands::redo,
            commands::add_layer,
            commands::delete_layer,
            commands::rename_layer,
            commands::set_layer_visible,
            commands::set_layer_locked,
            commands::set_layer_color,
            commands::set_active_layer,
            commands::set_plugin_enabled,
            commands::reload_plugins,
            commands::export_scene,
        ])
        .run(tauri::generate_context!())
        .expect("error while running arc");
}
