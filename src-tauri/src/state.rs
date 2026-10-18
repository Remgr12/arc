use arc_core::document::SceneData;
use arc_core::{Document, EntityId};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct Settings {
    pub units: String,
    pub grid_size: f64,
    pub snap_enabled: bool,
    pub show_grid: bool,
    pub show_axes: bool,
    pub enabled_plugins: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            units: "mm".into(),
            grid_size: 10.0,
            snap_enabled: true,
            show_grid: true,
            show_axes: true,
            enabled_plugins: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub path: String,
    pub enabled: bool,
    pub ok: bool,
    pub error: Option<String>,
}

/// Interior state shared with all commands.
pub struct AppState {
    pub documents: HashMap<String, Document>,
    pub order: Vec<String>,
    pub active: Option<String>,
    pub doc_counter: u32,
    pub doc_paths: HashMap<String, PathBuf>,
    pub settings: Settings,
    pub settings_path: Option<PathBuf>,
}

pub type SharedState = Arc<Mutex<AppState>>;

impl AppState {
    pub fn new() -> Self {
        Self {
            documents: HashMap::new(),
            order: vec![],
            active: None,
            doc_counter: 0,
            doc_paths: HashMap::new(),
            settings: Settings::default(),
            settings_path: None,
        }
    }

    pub fn next_doc_id(&mut self) -> String {
        self.doc_counter += 1;
        format!("doc-{}", self.doc_counter)
    }

    pub fn doc_info(&self, id: &str) -> Option<DocumentInfo> {
        self.documents.get(id).map(|d| DocumentInfo {
            id: id.to_string(),
            name: d.name.clone(),
            dirty: d.modified,
            path: self.doc_paths.get(id).map(|p| p.display().to_string()),
        })
    }

    pub fn documents_out(&self) -> Vec<DocumentInfo> {
        self.order
            .iter()
            .filter_map(|id| self.doc_info(id))
            .collect()
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DocumentInfo {
    pub id: String,
    pub name: String,
    pub dirty: bool,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppOverview {
    pub documents: Vec<DocumentInfo>,
    pub active: Option<String>,
    pub settings: Settings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEnvelope {
    pub document_id: String,
    pub scene: SceneData,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransformUpdate {
    pub id: String,
    pub transform: arc_core::Transform,
}

/// Get a document mutably, recording a history entry labelled `label`.
pub fn doc_mut(
    state: &SharedState,
    document_id: &str,
    label: &str,
    f: impl FnOnce(&mut Document),
) -> Result<(), String> {
    let mut s = state.lock();
    let doc = s
        .documents
        .get_mut(document_id)
        .ok_or_else(|| format!("unknown document {document_id}"))?;
    doc.apply(label, f);
    Ok(())
}

/// Read-only document access.
pub fn doc_ref<T>(
    state: &SharedState,
    document_id: &str,
    f: impl FnOnce(&Document) -> T,
) -> Result<T, String> {
    let s = state.lock();
    let doc = s
        .documents
        .get(document_id)
        .ok_or_else(|| format!("unknown document {document_id}"))?;
    Ok(f(doc))
}

/// Parse entity id safely.
pub fn parse_ids(ids: &[String]) -> Result<Vec<EntityId>, String> {
    ids.iter()
        .map(|s| EntityId::parse(s).ok_or_else(|| format!("bad id {s}")))
        .collect()
}

pub fn load_settings(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_settings(path: &Path, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
        let _ = std::fs::write(path, json);
    }
}
