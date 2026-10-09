use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::{EntityContainer, EntityId, EntityRef, Layer, LayerContainer, Selection, ViewportState, Units, SnapSettings, History, Metadata};

#[derive(Debug)]
pub struct Document {
    pub id: EntityId,
    pub name: String,
    pub path: Option<PathBuf>,
    pub modified: bool,
    pub version: u32,
    pub units: Units,
    pub snap_settings: SnapSettings,
    pub entities: EntityContainer,
    pub layers: LayerContainer,
    pub selection: Selection,
    pub viewports: Vec<ViewportState>,
    pub active_viewport: usize,
    pub history: History,
    pub metadata: Metadata,
}

impl Document {
    pub fn new(name: String) -> Self {
        let mut layers = LayerContainer::new();
        let default_layer = layers.create_layer("Default".to_string(), None);
        let default_layer_id = default_layer.read().id;

        Self {
            id: EntityId::new(),
            name,
            path: None,
            modified: false,
            version: 1,
            units: Units::default(),
            snap_settings: SnapSettings::default(),
            entities: EntityContainer::new(),
            layers,
            selection: Selection::new(),
            viewports: vec![ViewportState::default(); 4],
            active_viewport: 0,
            history: History::new(),
            metadata: Metadata::default(),
        }
    }

    pub fn active_viewport(&self) -> &ViewportState {
        &self.viewports[self.active_viewport]
    }

    pub fn active_viewport_mut(&mut self) -> &mut ViewportState {
        &mut self.viewports[self.active_viewport]
    }

    pub fn set_active_viewport(&mut self, index: usize) {
        if index < self.viewports.len() {
            self.active_viewport = index;
        }
    }

    pub fn add_entity(&mut self, entity: EntityRef) -> EntityId {
        let id = entity.read().id();
        self.entities.add(entity);
        self.mark_modified();
        id
    }

    pub fn remove_entity(&mut self, id: EntityId) -> Option<EntityRef> {
        self.selection.deselect(id);
        let entity = self.entities.remove(id);
        self.mark_modified();
        entity
    }

    pub fn get_entity(&self, id: EntityId) -> Option<EntityRef> {
        self.entities.get(id)
    }

    pub fn mark_modified(&mut self) {
        self.modified = true;
        self.version += 1;
    }

    pub fn mark_saved(&mut self) {
        self.modified = false;
    }
}

impl Default for Document {
    fn default() -> Self {
        Self::new("Untitled".to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentSettings {
    pub grid_enabled: bool,
    pub grid_size: f64,
    pub grid_subdivisions: u32,
    pub grid_color: crate::Color,
    pub snap_enabled: bool,
    pub ortho_mode: bool,
    pub polar_tracking: bool,
    pub object_snap: bool,
    pub dynamic_input: bool,
    pub line_weight_display: bool,
    pub transparency_display: bool,
    pub selection_preview: bool,
}

impl Default for DocumentSettings {
    fn default() -> Self {
        Self {
            grid_enabled: true,
            grid_size: 1000.0,
            grid_subdivisions: 10,
            grid_color: crate::Color::LIGHT_GRAY,
            snap_enabled: true,
            ortho_mode: false,
            polar_tracking: true,
            object_snap: true,
            dynamic_input: true,
            line_weight_display: false,
            transparency_display: true,
            selection_preview: true,
        }
    }
}

pub type DocumentRef = Arc<RwLock<Document>>;

#[derive(Debug, Default)]
pub struct DocumentManager {
    documents: Vec<DocumentRef>,
    active_index: Option<usize>,
}

impl DocumentManager {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_document(&mut self, name: String) -> DocumentRef {
        let doc = Arc::new(RwLock::new(Document::new(name)));
        self.documents.push(doc.clone());
        self.active_index = Some(self.documents.len() - 1);
        doc
    }

    pub fn create_document_from_ref(&mut self, doc: DocumentRef) -> DocumentRef {
        self.documents.push(doc.clone());
        self.active_index = Some(self.documents.len() - 1);
        doc
    }

    pub fn close_document(&mut self, index: usize) -> Option<DocumentRef> {
        if index < self.documents.len() {
            let doc = self.documents.remove(index);
            if let Some(active) = self.active_index {
                if active >= index && active > 0 {
                    self.active_index = Some(active - 1);
                } else if self.documents.is_empty() {
                    self.active_index = None;
                }
            }
            Some(doc)
        } else {
            None
        }
    }

    pub fn active_document(&self) -> Option<DocumentRef> {
        self.active_index.and_then(|i| self.documents.get(i).cloned())
    }

    pub fn set_active_document(&mut self, index: usize) {
        if index < self.documents.len() {
            self.active_index = Some(index);
        }
    }

    pub fn document_count(&self) -> usize {
        self.documents.len()
    }

    pub fn documents(&self) -> &[DocumentRef] {
        &self.documents
    }
}