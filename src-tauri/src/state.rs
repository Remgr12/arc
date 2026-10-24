use crate::core::annotation::AnnotationRegistry;
use crate::core::constraints::ConstraintSystem;
use crate::core::document::SceneData;
use crate::core::{Document, EntityId};
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
    #[serde(default)]
    pub fast_mode: bool,
    #[serde(default)]
    pub auto_save: bool,
    pub enabled_plugins: Vec<String>,
    /// Recently opened/saved document paths, most recent first.
    #[serde(default)]
    pub recent_files: Vec<String>,
    /// Reopen the documents from `recent_files` on launch.
    #[serde(default)]
    pub reopen_last_session: bool,
    /// Workspace folder the startup screen lists `*.arc` files from.
    #[serde(default)]
    pub workspace_dir: Option<String>,
    /// Unix seconds of the last updater check; auto checks run at most
    /// every 12 hours.
    #[serde(default)]
    pub updater_last_check: Option<i64>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            units: "metric".into(),
            grid_size: 2.0,
            snap_enabled: true,
            show_grid: true,
            show_axes: true,
            fast_mode: false,
            auto_save: true,
            enabled_plugins: vec![],
            recent_files: vec![],
            reopen_last_session: false,
            workspace_dir: None,
            updater_last_check: None,
        }
    }
}

/// Move `path` to the front of the recently-used list, capped.
pub fn remember_recent(settings: &mut Settings, path: &str) {
    settings.recent_files.retain(|p| p != path);
    settings.recent_files.insert(0, path.to_string());
    settings.recent_files.truncate(10);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub name: String,
    pub path: String,
    pub enabled: bool,
    pub ok: bool,
    pub error: Option<String>,
}

/// Per-document constraint bookkeeping: the kernel solver plus a mapping
/// from entity id strings to the solver's numeric entity handles (the
/// kernel addresses entities by `u64`, documents by UUID string).
#[derive(Debug, Default)]
pub struct ConstraintDocState {
    pub system: ConstraintSystem,
    entity_handles: HashMap<String, u64>,
    next_handle: u64,
}

impl ConstraintDocState {
    /// Stable numeric handle for an entity id, allocating one on first use.
    pub fn handle(&mut self, entity_id: &str) -> u64 {
        if let Some(h) = self.entity_handles.get(entity_id) {
            return *h;
        }
        self.next_handle += 1;
        self.entity_handles
            .insert(entity_id.to_string(), self.next_handle);
        self.next_handle
    }
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
    /// Dimension annotations, kept outside `Document` (kernel type).
    pub annotations: HashMap<String, AnnotationRegistry>,
    /// Constraint systems, kept outside `Document` (kernel type).
    pub constraints: HashMap<String, ConstraintDocState>,
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
            annotations: HashMap::new(),
            constraints: HashMap::new(),
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updater: Option<crate::updater::UpdateNotice>,
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
    pub transform: crate::core::Transform,
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
    let mut s: Settings = match std::fs::read_to_string(path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_default(),
        Err(_) => Settings::default(),
    };
    if s.units == "mm" || s.units == "cm" {
        s.units = "metric".into();
    }
    s
}

pub fn save_settings(path: &Path, settings: &Settings) {
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")));
        let _ = std::fs::write(path, json);
    }
}
