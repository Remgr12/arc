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

#[derive(Serialize, Deserialize)]
struct SerializableDocument {
    id: String,
    name: String,
    path: Option<String>,
    modified: bool,
    version: u32,
    units: String,
    entities: Vec<SerializableEntity>,
    layers: Vec<SerializableLayer>,
    selection: SerializableSelection,
    viewports: Vec<ViewportState>,
    active_viewport: usize,
    metadata: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct SerializableEntity {
    id: String,
    name: String,
    entity_type: String,
    visible: bool,
    locked: bool,
    data: serde_json::Value,
}

#[derive(Serialize, Deserialize)]
struct SerializableLayer {
    id: String,
    name: String,
    visible: bool,
    locked: bool,
    color: Color,
    line_weight: f32,
    line_type: String,
    transparency: f32,
}

#[derive(Serialize, Deserialize)]
struct SerializableSelection {
    selected_ids: Vec<String>,
    primary_id: Option<String>,
    hover_id: Option<String>,
}

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
        let serializable_doc: SerializableDocument = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        
        let mut doc = Document::new(serializable_doc.name);
        doc.id = EntityId(Uuid::parse_str(&serializable_doc.id).map_err(|e| e.to_string())?);
        doc.path = serializable_doc.path.map(std::path::PathBuf::from);
        doc.modified = serializable_doc.modified;
        doc.version = serializable_doc.version;
        
        // Reconstruct entities, layers, selection, etc.
        // This is simplified - real implementation would properly reconstruct all data
        
        let doc_ref = Arc::new(RwLock::new(doc));
        self.document_manager.create_document_from_ref(doc_ref.clone());
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
            
            let serializable_doc = SerializableDocument {
                id: doc_guard.id.0.to_string(),
                name: doc_guard.name.clone(),
                path: doc_guard.path.as_ref().map(|p| p.to_string_lossy().to_string()),
                modified: doc_guard.modified,
                version: doc_guard.version,
                units: format!("{:?}", doc_guard.units),
                entities: doc_guard.entities.iter().map(|e| {
                    let entity = e.read();
                    SerializableEntity {
                        id: entity.id().0.to_string(),
                        name: entity.name().to_string(),
                        entity_type: format!("{:?}", entity.entity_type()),
                        visible: entity.visible(),
                        locked: entity.locked(),
                        data: serde_json::Value::Null, // Simplified
                    }
                }).collect(),
                layers: doc_guard.layers.all().iter().map(|l| {
                    let layer = l.read();
                    SerializableLayer {
                        id: layer.id.0.to_string(),
                        name: layer.name.clone(),
                        visible: layer.visible,
                        locked: layer.locked,
                        color: layer.color,
                        line_weight: layer.line_weight,
                        line_type: format!("{:?}", layer.line_type),
                        transparency: layer.transparency,
                    }
                }).collect(),
                selection: SerializableSelection {
                    selected_ids: doc_guard.selection.selected_ids.iter().map(|id| id.0.to_string()).collect(),
                    primary_id: doc_guard.selection.primary_id.map(|id| id.0.to_string()),
                    hover_id: doc_guard.selection.hover_id.map(|id| id.0.to_string()),
                },
                viewports: doc_guard.viewports.clone(),
                active_viewport: doc_guard.active_viewport,
                metadata: serde_json::Value::Null, // Simplified
            };
            
            let content = serde_json::to_string_pretty(&serializable_doc).map_err(|e| e.to_string())?;
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
        if let Some(idx) = self.document_manager.documents().iter().position(|d| d.read().id == id) {
            self.document_manager.close_document(idx);
        }
        Ok(())
    }

    pub fn active_document(&self) -> Option<DocumentRef> {
        self.active_document.clone()
    }

    pub fn documents(&self) -> &[DocumentRef] {
        self.document_manager.documents()
    }

    pub fn set_active_document(&mut self, id: EntityId) {
        if let Some(idx) = self.document_manager.documents().iter().position(|d| d.read().id == id) {
            self.document_manager.set_active_document(idx);
            self.active_document = self.document_manager.active_document();
        }
    }

    pub fn execute_command(&self, command_id: &str, args: serde_json::Value) -> Result<serde_json::Value, String> {
        self.command_manager.execute(command_id, args)
    }

    pub fn get_commands(&self) -> Vec<Command> {
        self.command_manager.list().into_iter()
            .map(|(_, entry)| Command {
                id: entry.id.clone(),
                name: entry.name.clone(),
                description: entry.description.clone(),
                category: entry.category.clone(),
                icon: None,
                shortcut: None,
                enabled: true,
                visible: true,
                async_: false,
            })
            .collect()
    }

    pub fn create_entity(&self, entity_type: &str, data: serde_json::Value) -> Result<String, String> {
        let entity_type = entity_type.to_string();
        if let Some(doc) = &self.active_document {
            let mut doc_guard = doc.write();
            // Create entity based on type
            let entity_id = EntityId::new();
            Ok(entity_id.0.to_string())
        } else {
            Err("No active document".to_string())
        }
    }

    pub fn delete_entity(&self, entity_id: EntityId) -> Result<(), String> {
        if let Some(doc) = &self.active_document {
            doc.write().remove_entity(entity_id);
            Ok(())
        } else {
            Err("No active document".to_string())
        }
    }

    pub fn update_entity(&self, entity_id: EntityId, data: serde_json::Value) -> Result<(), String> {
        if let Some(doc) = &self.active_document {
            if let Some(_entity) = doc.read().entities.get(entity_id) {
                // Update entity properties
                Ok(())
            } else {
                Err("Entity not found".to_string())
            }
        } else {
            Err("No active document".to_string())
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
        self.viewport_manager.viewports().get(index)
            .map(|v| v.read().state.clone())
            .ok_or_else(|| "Viewport not found".to_string())
    }

    pub fn set_viewport_state(&self, index: usize, state: ViewportState) -> Result<(), String> {
        if let Some(vp) = self.viewport_manager.viewports().get(index) {
            vp.write().state = state;
            Ok(())
        } else {
            Err("Viewport not found".to_string())
        }
    }

    pub fn raycast(&self, viewport_index: usize, screen_x: f32, screen_y: f32, screen_width: f32, screen_height: f32) -> Result<Option<RaycastHit>, String> {
        if let Some(vp) = self.viewport_manager.viewports().get(viewport_index) {
            let viewport = vp.read();
            if let Some(doc) = &self.active_document {
                let (ray_origin, ray_dir) = viewport.screen_to_world((screen_x, screen_y), (screen_width, screen_height));
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

    pub fn get_snap_point(&self, viewport_index: usize, screen_x: f32, screen_y: f32, screen_width: f32, screen_height: f32) -> Result<Option<SnapResult>, String> {
        if let Some(vp) = self.viewport_manager.viewports().get(viewport_index) {
            let viewport = vp.read();
            if let Some(doc) = &self.active_document {
                let (ray_origin, _ray_dir) = viewport.screen_to_world((screen_x, screen_y), (screen_width, screen_height));
                let screen_point = Point3::new(ray_origin.x, ray_origin.y, ray_origin.z);
                let snap = self.snap_engine.find_snap(screen_point, &viewport.state, &doc.read().entities);
                Ok(Some(snap))
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
            enabled: m.enabled,
            loaded: m.loaded,
        }).collect()
    }

    pub fn enable_plugin(&mut self, plugin_id: &str) -> Result<(), String> {
        self.plugin_system.enable(plugin_id)
    }

    pub fn disable_plugin(&mut self, plugin_id: &str) -> Result<(), String> {
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
        if let Some(doc) = &self.active_document {
            doc.read().history.can_undo()
        } else {
            false
        }
    }

    pub fn can_redo(&self) -> bool {
        if let Some(doc) = &self.active_document {
            doc.read().history.can_redo()
        } else {
            false
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub auto_save: bool,
    pub auto_save_interval: u32,
    pub viewport_background: [f32; 4],
    pub grid_enabled: bool,
    pub grid_size: f64,
    pub snap_enabled: bool,
    pub ortho_mode: bool,
    pub units: Units,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: "en".to_string(),
            auto_save: true,
            auto_save_interval: 300,
            viewport_background: [0.1, 0.1, 0.12, 1.0],
            grid_enabled: true,
            grid_size: 1000.0,
            snap_enabled: true,
            ortho_mode: false,
            units: Units::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub point: Point3,
    pub normal: Vector3,
    pub distance: f64,
}