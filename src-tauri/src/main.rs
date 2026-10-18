// Prevents an extra console window on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use parking_lot::Mutex;
use std::sync::Arc;
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

mod bridge;
mod commands;
mod plugins;
mod state;
mod updater;

use arc_core::Document;
use state::{load_settings, save_settings, SharedState, Settings};

fn main() {
    let app_state: SharedState = Arc::new(Mutex::new(state::AppState::new()));
    let plugin_state: plugins::PluginLock = Mutex::new(plugins::PluginRuntime::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
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
                // Optional session restore: reopen saved documents  (most
                // recent last, so it ends up active).
                if settings.reopen_last_session {
                    let mut opened = 0;
                    for path in settings.recent_files.iter().rev() {
                        if opened >= 6 {
                            break;
                        }
                        if !std::path::Path::new(path).exists() {
                            continue;
                        }
                        if commands::open_document_impl(app.handle(), &shared, None, path)
                            .is_ok()
                        {
                            opened += 1;
                        }
                    }
                }
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

            bridge::start(app.handle().clone(), data_dir.join("bridge.json"));

            updater::maybe_check_on_startup(app.handle().clone());

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let shared = window.state::<SharedState>();
                let has_dirty = shared.lock().documents.values().any(|d| d.modified);
                if has_dirty {
                    let discard = window
                        .dialog()
                        .message("You have unsaved changes. Quit anyway?")
                        .title("arc")
                        .kind(MessageDialogKind::Warning)
                        .buttons(MessageDialogButtons::OkCancelCustom(
                            "Discard changes".to_string(),
                            "Cancel".to_string(),
                        ))
                        .blocking_show();
                    if !discard {
                        api.prevent_close();
                        return;
                    }
                }
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
            commands::list_projects,
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
            commands::import_file,
            commands::sheetmetal_materials,
            commands::sheetmetal_flat_pattern,
            commands::annotation_create,
            commands::annotation_measure,
            commands::annotation_geometry,
            commands::constraint_add,
            commands::solve_constraints,
            updater::check_for_updates,
            updater::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running arc");
}
