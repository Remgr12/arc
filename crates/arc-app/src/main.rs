use arc_core::*;
use arc_geometry::*;
use arc_modeling::*;
use arc_architecture::*;
use arc_plugin::*;
use tauri::{AppHandle, Manager, Runtime, State, Window};
use std::sync::Arc;
use parking_lot::RwLock;
use tracing::{info, error, warn};

mod app_state;
mod renderer;
mod ui;
mod commands;
mod ipc;
mod plugins;

use app_state::AppState;

#[tauri::command]
async fn new_document(app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    let mut app_state = state.inner.write();
    let doc = app_state.create_document("Untitled".to_string());
    let doc_id = doc.read().id.0.to_string();
    app_state.set_active_document(doc.read().id);
    info!("Created new document: {}", doc_id);
    Ok(doc_id)
}

#[tauri::command]
async fn open_document(app: AppHandle, state: State<'_, AppState>, path: String) -> Result<String, String> {
    let mut app_state = state.inner.write();
    let doc = app_state.open_document(&path).map_err(|e| e.to_string())?;
    let doc_id = doc.read().id.0.to_string();
    app_state.set_active_document(doc.read().id);
    info!("Opened document: {} from {}", doc_id, path);
    Ok(doc_id)
}

#[tauri::command]
async fn save_document(app: AppHandle, state: State<'_, AppState>, path: Option<String>) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.save_active_document(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn close_document(app: AppHandle, state: State<'_, AppState>, document_id: String) -> Result<(), String> {
    let mut app_state = state.inner.write();
    let id = uuid::Uuid::parse_str(&document_id).map_err(|e| e.to_string())?;
    app_state.close_document(EntityId(id)).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_active_document(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let app_state = state.inner.read();
    Ok(app_state.active_document().map(|d| d.read().id.0.to_string()))
}

#[tauri::command]
async fn get_documents(state: State<'_, AppState>) -> Result<Vec<DocumentInfo>, String> {
    let app_state = state.inner.read();
    Ok(app_state.documents().iter().map(|d| {
        let doc = d.read();
        DocumentInfo {
            id: doc.id.0.to_string(),
            name: doc.name.clone(),
            path: doc.path.as_ref().map(|p| p.to_string_lossy().to_string()),
            modified: doc.modified,
        }
    }).collect())
}

#[derive(serde::Serialize)]
struct DocumentInfo {
    id: String,
    name: String,
    path: Option<String>,
    modified: bool,
}

#[tauri::command]
async fn execute_command(app: AppHandle, state: State<'_, AppState>, command_id: String, args: serde_json::Value) -> Result<serde_json::Value, String> {
    let app_state = state.inner.read();
    app_state.execute_command(&command_id, args).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_commands(state: State<'_, AppState>) -> Result<Vec<CommandInfo>, String> {
    let app_state = state.inner.read();
    Ok(app_state.get_commands().iter().map(|c| CommandInfo {
        id: c.id.clone(),
        name: c.name.clone(),
        description: c.description.clone(),
        category: c.category.clone(),
    }).collect())
}

#[derive(serde::Serialize)]
struct CommandInfo {
    id: String,
    name: String,
    description: String,
    category: String,
}

#[tauri::command]
async fn create_entity(state: State<'_, AppState>, entity_type: String, data: serde_json::Value) -> Result<String, String> {
    let app_state = state.inner.read();
    app_state.create_entity(&entity_type, data).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn delete_entity(state: State<'_, AppState>, entity_id: String) -> Result<(), String> {
    let app_state = state.inner.read();
    let id = uuid::Uuid::parse_str(&entity_id).map_err(|e| e.to_string())?;
    app_state.delete_entity(EntityId(id)).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_entity(state: State<'_, AppState>, entity_id: String, data: serde_json::Value) -> Result<(), String> {
    let app_state = state.inner.read();
    let id = uuid::Uuid::parse_str(&entity_id).map_err(|e| e.to_string())?;
    app_state.update_entity(EntityId(id), data).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_selection(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let app_state = state.inner.read();
    Ok(app_state.get_selection().iter().map(|id| id.0.to_string()).collect())
}

#[tauri::command]
async fn set_selection(state: State<'_, AppState>, entity_ids: Vec<String>, add: bool) -> Result<(), String> {
    let app_state = state.inner.read();
    let ids: Result<Vec<_>, _> = entity_ids.iter().map(|s| uuid::Uuid::parse_str(s).map(EntityId)).collect();
    app_state.set_selection(ids.map_err(|e| e.to_string())?, add).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_viewport_state(state: State<'_, AppState>, viewport_index: usize) -> Result<ViewportState, String> {
    let app_state = state.inner.read();
    Ok(app_state.get_viewport_state(viewport_index).map_err(|e| e.to_string())?)
}

#[tauri::command]
async fn set_viewport_state(state: State<'_, AppState>, viewport_index: usize, state_data: ViewportState) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.set_viewport_state(viewport_index, state_data).map_err(|e| e.to_string())
}

#[tauri::command]
async fn raycast(state: State<'_, AppState>, viewport_index: usize, screen_x: f32, screen_y: f32) -> Result<Option<RaycastResult>, String> {
    let app_state = state.inner.read();
    Ok(app_state.raycast(viewport_index, screen_x, screen_y).map_err(|e| e.to_string())?)
}

#[derive(serde::Serialize)]
struct RaycastResult {
    entity_id: Option<String>,
    point: [f64; 3],
    normal: [f64; 3],
    distance: f64,
}

#[tauri::command]
async fn get_snap_point(state: State<'_, AppState>, viewport_index: usize, screen_x: f32, screen_y: f32) -> Result<Option<SnapResult>, String> {
    let app_state = state.inner.read();
    Ok(app_state.get_snap_point(viewport_index, screen_x, screen_y).map_err(|e| e.to_string())?)
}

#[derive(serde::Serialize)]
struct SnapResult {
    point: [f64; 3],
    snap_type: String,
    entity_id: Option<String>,
}

#[tauri::command]
async fn get_plugins(state: State<'_, AppState>) -> Result<Vec<PluginInfo>, String> {
    let app_state = state.inner.read();
    Ok(app_state.get_plugins().iter().map(|p| PluginInfo {
        id: p.id.clone(),
        name: p.name.clone(),
        version: p.version.clone(),
        description: p.description.clone(),
        author: p.author.clone(),
        enabled: p.enabled,
        loaded: p.loaded,
    }).collect())
}

#[derive(serde::Serialize)]
struct PluginInfo {
    id: String,
    name: String,
    version: String,
    description: String,
    author: String,
    enabled: bool,
    loaded: bool,
}

#[tauri::command]
async fn enable_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.enable_plugin(&plugin_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn disable_plugin(state: State<'_, AppState>, plugin_id: String) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.disable_plugin(&plugin_id).map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_settings(state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    let app_state = state.inner.read();
    Ok(app_state.get_settings())
}

#[tauri::command]
async fn set_setting(state: State<'_, AppState>, key: String, value: serde_json::Value) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.set_setting(key, value).map_err(|e| e.to_string())
}

#[tauri::command]
async fn undo(state: State<'_, AppState>) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.undo().map_err(|e| e.to_string())
}

#[tauri::command]
async fn redo(state: State<'_, AppState>) -> Result<(), String> {
    let app_state = state.inner.read();
    app_state.redo().map_err(|e| e.to_string())
}

#[tauri::command]
async fn can_undo(state: State<'_, AppState>) -> Result<bool, String> {
    let app_state = state.inner.read();
    Ok(app_state.can_undo())
}

#[tauri::command]
async fn can_redo(state: State<'_, AppState>) -> Result<bool, String> {
    let app_state = state.inner.read();
    Ok(app_state.can_redo())
}

fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    info!("Starting ARC CAD Application");

    let app_state = Arc::new(RwLock::new(AppState::new()));

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            new_document,
            open_document,
            save_document,
            close_document,
            get_active_document,
            get_documents,
            execute_command,
            get_commands,
            create_entity,
            delete_entity,
            update_entity,
            get_selection,
            set_selection,
            get_viewport_state,
            set_viewport_state,
            raycast,
            get_snap_point,
            get_plugins,
            enable_plugin,
            disable_plugin,
            get_settings,
            set_setting,
            undo,
            redo,
            can_undo,
            can_redo,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let app_state = app.state::<Arc<RwLock<AppState>>>();
            
            {
                let mut state = app_state.inner.write();
                state.initialize(app_handle.clone());
            }
            
            info!("ARC CAD Application initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Error running ARC application");
}