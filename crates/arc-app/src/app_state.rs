use arc_core::*;
use arc_geometry::*;
use arc_modeling::*;
use arc_architecture::*;
use arc_commands::Command;
use crate::renderer::Renderer;
use crate::ui::UIManager;
use crate::commands::CommandProcessor;
use crate::ipc::IPCHandler;
use crate::plugins::PluginSystem;
use tauri::Manager;
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;
use uuid::Uuid;
use serde::{Serialize, Deserialize};

pub struct AppState {
    pub modeling_kernel: ModelingKernel,
    pub arch_model: Option<ArchModelRef>,
    pub document_manager: DocumentManager,
    pub command_manager: crate::commands::CommandProcessor,
    pub plugin_system: PluginSystem,
    pub renderer: Option<Renderer>,
    pub ui_manager: UIManager,
    pub settings: AppSettings,
    pub active_document: Option<DocumentRef>,
    pub snap_engine: SnapEngine,
    pub viewport_manager: ViewportManager,
    pub ipc_handler: IPCHandler,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            modeling_kernel: ModelingKernel::new(),
            arch_model: None,
            document_manager: DocumentManager::new(),
            command_manager: crate::commands::CommandProcessor::new(),
            plugin_system: PluginSystem::new(),
            renderer: None,
            ui_manager: UIManager::new(),
            settings: AppSettings::default(),
            active_document: None,
            snap_engine: SnapEngine::new(SnapSettings::default()),
            viewport_manager: ViewportManager::new(),
            ipc_handler: IPCHandler::new(),
        }
    }

    pub fn initialize(&mut self, _app_handle: tauri::AppHandle) {
        self.setup_commands();
        self.setup_plugins();
        self.create_default_document();
    }

    fn setup_plugins(&mut self) {
        let _ = self.plugin_system.discover();
    }

    fn setup_commands(&mut self) {
        // Commands are registered in the local CommandProcessor
    }

    fn create_default_document(&mut self) {
        let doc = self.document_manager.create_document("Untitled".to_string());
        self.active_document = Some(doc.clone());
        
        let arch_model = Arc::new(RwLock::new(ArchitecturalModel::new("Default Project".to_string())));
        self.arch_model = Some(arch_model);
    }

    pub fn create_document(&mut self, name: String) -> DocumentRef {
        let doc = self.document_manager.create_document(name);
        self.active_document = Some(doc.clone());
        doc
    }

    pub fn open_document(&mut self, path: &str) -> Result<DocumentRef, String> {
        let content = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
        let doc: Document = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        let doc_ref = Arc::new(RwLock::new(doc));
        self.document_manager.documents.push(doc_ref.clone());
        self.active_document = Some(doc_ref.clone());
        Ok(doc_ref)
    }

    pub fn save_active_document(&self, path: Option<String>) -> Result<(), String> {
        if let Some(doc) = &self.active_document {
            let doc_guard = doc.read();
            let save_path = path.unwrap_or_else(|| {
                doc_guard.path.as_ref()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_else(|| format!("./{}.arc", doc_guard.name))
            });
            
            let content = serde_json::to_string_pretty(&*doc_guard).map_err(|e| e.to_string())?;
            std::fs::write(&save_path, content).map_err(|e| e.to_string())?;
            drop(doc_guard);
            
            if let Some(mut doc_mut) = self.active_document.as_ref() {
                doc_mut.write().path = Some(std::path::PathBuf::from(save_path));
                doc_mut.write().mark_saved();
            }
        }
        Ok(())
    }

    pub fn close_document(&mut self, id: EntityId) -> Result<(), String> {
        if let Some(active) = &self.active_document {
            if active.read().id == id {
                self.active_document = None;
            }
        }
        self.document_manager.close_document(
            self.document_manager.documents.iter().position(|d| d.read().id == id).unwrap_or(0)
        );
        Ok(())
    }

    pub fn active_document(&self) -> Option<DocumentRef> {
        self.active_document.clone()
    }

    pub fn documents(&self) -> &[DocumentRef] {
        self.document_manager.documents()
    }

    pub fn set_active_document(&mut self, id: EntityId) {
        if let Some(idx) = self.document_manager.documents.iter().position(|d| d.read().id == id) {
            self.document_manager.set_active_document(idx);
            self.active_document = self.document_manager.active_document();
        }
    }

    pub async fn execute_command(&self, command_id: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        self.command_manager.execute(command_id, args)
    }

    pub fn get_commands(&self) -> Vec<Command> {
        self.command_manager.list().into_iter()
            .map(|(_, entry)| Command {
                id: entry.id.clone(),
                name: entry.name.clone(),
                description: entry.description.clone(),
                category: entry.category.clone(),
            })
            .collect()
    }

    pub fn create_entity(&self, entity_type: &str, data: serde_json::Value) -> impl std::future::Future<Output = Result<String, String>> {
        let entity_type = entity_type.to_string();
        async move {
            if let Some(doc) = &self.active_document {
                let mut doc_guard = doc.write();
                // Create entity based on type
                let entity_id = EntityId::new();
                Ok(entity_id.0.to_string())
            } else {
                Err("No active document".to_string())
            }
        }
    }

    pub fn delete_entity(&self, entity_id: EntityId) -> impl std::future::Future<Output = Result<(), String>> {
        async move {
            if let Some(doc) = &self.active_document {
                doc.write().remove_entity(entity_id);
                Ok(())
            } else {
                Err("No active document".to_string())
            }
        }
    }

    pub fn update_entity(&self, entity_id: EntityId, data: serde_json::Value) -> impl std::future::Future<Output = Result<(), String>> {
        async move {
            if let Some(doc) = &self.active_document {
                if let Some(entity) = doc.read().entities.get(entity_id) {
                    // Update entity properties
                    Ok(())
                } else {
                    Err("Entity not found".to_string())
                }
            } else {
                Err("No active document".to_string())
            }
        }
    }

    pub fn get_selection(&self) -> Vec<EntityId> {
        if let Some(doc) = &self.active_document {
            doc.read().selection.selected_ids.iter().cloned().collect()
        } else {
            Vec::new()
        }
    }

    pub fn set_selection(&self, entity_ids: Vec<EntityId>, add: bool) -> Result<(), String> {
        if let Some(doc) = &self.active_document {
            let mut doc_guard = doc.write();
            doc_guard.selection.clear();
            for id in entity_ids {
                doc_guard.selection.select(id, add);
            }
            Ok(())
        } else {
            Err("No active document".to_string())
        }
    }

    pub fn get_viewport_state(&self, index: usize) -> Result<ViewportState, String> {
        self.viewport_manager.viewports.get(index)
            .map(|v| v.read().state.clone())
            .ok_or_else(|| "Viewport not found".to_string())
    }

    pub fn set_viewport_state(&self, index: usize, state: ViewportState) -> Result<(), String> {
        if let Some(vp) = self.viewport_manager.viewports.get(index) {
            vp.write().state = state;
            Ok(())
        } else {
            Err("Viewport not found".to_string())
        }
    }

    pub fn raycast(&self, viewport_index: usize, screen_x: f32, screen_y: f32) -> Result<Option<RaycastHit>, String> {
        if let Some(vp) = self.viewport_manager.viewports.get(viewport_index) {
            let viewport = vp.read();
            if let Some(doc) = &self.active_document {
                let (ray_origin, ray_dir) = viewport.screen_to_world(screen_x, screen_y);
                // Perform raycast against entities
                // This is simplified - real implementation would use BVH
                Ok(None)
            } else {
                Ok(None)
            }
        } else {
            Err("Viewport not found".to_string())
        }
    }

    pub fn get_snap_point(&self, viewport_index: usize, screen_x: f32, screen_y: f32) -> Result<Option<crate::SnapResult>, String> {
        if let Some(vp) = self.viewport_manager.viewports.get(viewport_index) {
            let viewport = vp.read();
            if let Some(doc) = &self.active_document {
                let (ray_origin, ray_dir) = viewport.screen_to_world(screen_x, screen_y);
                let snap = self.snap_engine.snap(
                    (screen_x, screen_y),
                    (ray_origin, ray_dir),
                    &doc.read().entities,
                    &viewport.state,
                    &doc.read().units,
                );
                Ok(snap)
            } else {
                Ok(None)
            }
        } else {
            Err("Viewport not found".to_string())
        }
    }

    pub fn get_plugins(&self) -> Vec<PluginInfo> {
        self.plugin_system.loaded_plugins().iter().map(|m| PluginInfo {
            id: m.id.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            description: m.description.clone(),
            author: m.author.clone(),
            entry: m.entry.clone(),
            enabled: m.enabled,
            loaded: m.loaded,
        }).collect()
    }

    pub fn enable_plugin(&self, plugin_id: &str) -> Result<(), String> {
        self.plugin_system.enable(plugin_id)
    }

    pub fn disable_plugin(&self, plugin_id: &str) -> Result<(), String> {
        self.plugin_system.disable(plugin_id)
    }

    pub fn get_settings(&self) -> serde_json::Value {
        serde_json::to_value(&self.settings).unwrap_or_default()
    }

    pub fn set_setting(&self, key: String, value: serde_json::Value) -> Result<(), String> {
        // Update settings
        Ok(())
    }

    pub fn undo(&self) -> Result<(), String> {
        if let Some(doc) = &self.active_document {
            doc.write().history.undo();
            Ok(())
        } else {
            Err("No active document".to_string())
        }
    }

    pub fn redo(&self) -> Result<(), String> {
        if let Some(doc) = &self.active_document {
            doc.write().history.redo();
            Ok(())
        } else {
            Err("No active document".to_string())
        }
    }

    pub fn can_undo(&self) -> bool {
        self.active_document.as_ref().map(|d| d.read().history.can_undo()).unwrap_or(false)
    }

    pub fn can_redo(&self) -> bool {
        self.active_document.as_ref().map(|d| d.read().history.can_redo()).unwrap_or(false)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AppSettings {
    pub grid_enabled: bool,
    pub grid_size: f64,
    pub grid_subdivisions: u32,
    pub snap_enabled: bool,
    pub ortho_mode: bool,
    pub polar_tracking: bool,
    pub object_snap: bool,
    pub dynamic_input: bool,
    pub units: Units,
    pub theme: String,
    pub language: String,
    pub auto_save: bool,
    pub auto_save_interval: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            grid_enabled: true,
            grid_size: 1000.0,
            grid_subdivisions: 10,
            snap_enabled: true,
            ortho_mode: false,
            polar_tracking: true,
            object_snap: true,
            dynamic_input: true,
            units: Units::metric(),
            theme: "dark".to_string(),
            language: "en".to_string(),
            auto_save: true,
            auto_save_interval: 300,
        }
    }
}

#[derive(Debug, Clone)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub enabled: bool,
    pub loaded: bool,
}

#[derive(Debug, Clone)]
pub struct RaycastHit {
    pub entity_id: EntityId,
    pub point: Point3<f64>,
    pub normal: Vector3<f64>,
    pub distance: f64,
}