//! Tauri command surface. All scene-mutating commands record undo history,
//! and emit `arc://scene` so the webview stays in sync.

use crate::core::annotation::{Annotation, AnnotationKind, DimensionGeometry};
use crate::core::constraints::{
    Constraint, ConstraintExpression, ConstraintType, GeometryParameter,
};
use crate::core::entity::CsgOperation;
use crate::core::formats::{Format, TriangleSoup};
use crate::core::sheetmetal::{FlatPattern, SheetMetalMaterial, SheetMetalPart};
use crate::core::{Color, Document, Entity, EntityId, Geometry, MeshBuffer, RayHit, Transform};
use crate::plugins::PluginLock;
use crate::state::{
    AppOverview, DocumentInfo, SceneEnvelope, Settings, SharedState, TransformUpdate, doc_mut,
    doc_ref, parse_ids,
};
use serde::Deserialize;
use serde_json::Value as Json;
use tauri::{AppHandle, Emitter, Manager, State};

// ------------------------------------------------------------ event helpers

pub fn emit_scene(app: &AppHandle, state: &SharedState, document_id: &str) {
    let payload = state
        .lock()
        .documents
        .get(document_id)
        .map(|d| SceneEnvelope {
            document_id: document_id.to_string(),
            scene: d.scene_data(),
        });
    if let Some(payload) = payload {
        let _ = app.emit("arc://scene", payload);
    }
}

pub fn emit_documents(app: &AppHandle, state: &SharedState) {
    let payload = {
        let s = state.lock();
        AppOverview {
            documents: s.documents_out(),
            active: s.active.clone(),
            settings: s.settings.clone(),
            updater: updater_notice(app),
        }
    };
    let _ = app.emit("arc://documents", payload);
}

fn updater_notice(app: &AppHandle) -> Option<crate::updater::UpdateNotice> {
    app.try_state::<crate::updater::UpdateNoticeCache>()
        .and_then(|c| c.0.clone())
}

fn fire_plugin_hook(
    state: &SharedState,
    plugins: Option<&PluginLock>,
    hook: &'static str,
    arg: &Json,
) {
    #[cfg(feature = "lua")]
    if let Some(p) = plugins {
        p.lock().fire(state, hook, arg);
    }
    #[cfg(not(feature = "lua"))]
    {
        let _ = (state, arg, plugins, hook);
    }
}

// ------------------------------------------------------------ shared helpers

/// Create an entity from a JSON geometry payload (also used by Lua plugins).
pub fn helpers_add_entity(
    app: &AppHandle,
    state: &SharedState,
    document_id: &str,
    geometry: &Json,
    name: Option<&str>,
) -> Result<String, String> {
    let kind: Geometry =
        serde_json::from_value(geometry.clone()).map_err(|e| format!("bad geometry: {e}"))?;
    let name = name.unwrap_or("").to_string();
    let mut out: Option<String> = None;
    doc_mut(state, document_id, "Add", |doc| {
        let entity = Entity::new(
            EntityId::new(),
            name.clone(),
            doc.active_layer,
            kind.clone(),
        );
        let (id, res) = doc.add_entity(entity);
        if res.is_ok() {
            out = Some(id.as_string());
        }
    })?;
    let out = out.ok_or("geometry rejected by kernel")?;
    emit_scene(app, state, document_id);
    Ok(out)
}

/// Apply one transform to multiple entities (also used by Lua plugins).
pub fn helpers_set_transform(
    app: &AppHandle,
    state: &SharedState,
    document_id: &str,
    transform: &Json,
    ids: &[&str],
    record: bool,
) -> Result<(), String> {
    let target: Transform =
        serde_json::from_value(transform.clone()).map_err(|e| format!("bad transform: {e}"))?;
    let ids = ids
        .iter()
        .map(|s| parse_one(s))
        .collect::<Result<Vec<EntityId>, _>>()?;
    weak_set_transform(state, document_id, &ids, &target, record, "Move")?;
    emit_scene(app, state, document_id);
    Ok(())
}

fn weak_set_transform(
    state: &SharedState,
    document_id: &str,
    ids: &[EntityId],
    target: &Transform,
    record: bool,
    label: &str,
) -> Result<(), String> {
    if record {
        doc_mut(state, document_id, label, |doc| {
            for id in ids {
                doc.set_transform(id, *target);
            }
        })
    } else {
        let mut s = state.lock();
        if let Some(doc) = s.documents.get_mut(document_id) {
            for id in ids {
                doc.set_transform(id, *target);
            }
        }
        Ok(())
    }
}

fn parse_one(s: &str) -> Result<EntityId, String> {
    EntityId::parse(s).ok_or_else(|| format!("bad id {s}"))
}

// ------------------------------------------------------------ app state

#[tauri::command]
pub fn get_state(app: AppHandle, state: State<'_, SharedState>) -> AppOverview {
    let s = state.lock();
    AppOverview {
        documents: s.documents_out(),
        active: s.active.clone(),
        settings: s.settings.clone(),
        updater: updater_notice(&app),
    }
}

#[tauri::command]
pub fn get_plugins(plugins: State<'_, PluginLock>) -> Vec<crate::state::PluginInfo> {
    plugins.lock().info()
}

// ------------------------------------------------------------ documents

#[allow(unused_variables, unused_mut)]
#[tauri::command]
pub fn new_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    plugins: State<'_, PluginLock>,
    name: Option<String>,
) -> Result<DocumentInfo, String> {
    let info = {
        let mut s = state.lock();
        let id = s.next_doc_id();
        let name = name.unwrap_or_else(|| format!("Untitled {}", s.doc_counter));
        s.documents.insert(id.clone(), Document::new(name));
        s.order.push(id.clone());
        s.active = Some(id.clone());
        s.doc_info(&id).expect("just inserted")
    };
    emit_documents(&app, &state);
    fire_plugin_hook(&state, Some(&plugins), "new", &serde_json::json!({}));
    Ok(info)
}

#[tauri::command]
pub fn set_active_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    id: String,
) -> Result<(), String> {
    {
        let mut s = state.lock();
        if !s.documents.contains_key(&id) {
            return Err(format!("unknown document {id}"));
        }
        s.active = Some(id);
    }
    emit_documents(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn close_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    id: String,
) -> Result<(), String> {
    {
        let mut s = state.lock();
        s.documents.remove(&id);
        s.doc_paths.remove(&id);
        s.annotations.remove(&id);
        s.constraints.remove(&id);
        s.order.retain(|x| x != &id);
        if s.active.as_deref() == Some(&id) {
            s.active = s.order.last().cloned();
        }
        // Keep the workspace usable: never leave it with no document.
        if s.active.is_none() {
            let new_id = s.next_doc_id();
            let name = format!("Untitled {}", s.doc_counter);
            s.documents.insert(new_id.clone(), Document::new(name));
            s.order.push(new_id.clone());
            s.active = Some(new_id);
        }
    }
    emit_documents(&app, &state);
    Ok(())
}

#[tauri::command]
pub fn open_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    plugins: State<'_, PluginLock>,
    path: String,
) -> Result<DocumentInfo, String> {
    open_document_impl(&app, &state, Some(&plugins), &path)
}

/// Shared by the `open_document` command and startup session restore.
pub fn open_document_impl(
    app: &AppHandle,
    state: &SharedState,
    plugins: Option<&PluginLock>,
    path: &str,
) -> Result<DocumentInfo, String> {
    let json = std::fs::read_to_string(path).map_err(|e| format!("open failed: {e}"))?;
    let doc = Document::from_json(&json).map_err(|e| format!("parse failed: {e}"))?;

    let info = {
        let mut s = state.lock();
        let id = s.next_doc_id();
        s.documents.insert(id.clone(), doc);
        s.order.push(id.clone());
        s.active = Some(id.clone());
        s.doc_paths
            .insert(id.clone(), std::path::PathBuf::from(path));
        crate::state::remember_recent(&mut s.settings, path);
        s.doc_info(&id).expect("just inserted")
    };
    emit_documents(app, state);
    fire_plugin_hook(state, plugins, "open", &serde_json::json!({ "path": path }));
    Ok(info)
}

#[tauri::command]
pub fn save_document(
    app: AppHandle,
    state: State<'_, SharedState>,
    plugins: State<'_, PluginLock>,
    document_id: String,
    path: Option<String>,
) -> Result<DocumentInfo, String> {
    save_document_impl(&app, &state, Some(&plugins), &document_id, path.as_deref())
}

/// Shared by the `save_document` command and programmatic saves.
pub fn save_document_impl(
    app: &AppHandle,
    state: &SharedState,
    plugins: Option<&PluginLock>,
    document_id: &str,
    path: Option<&str>,
) -> Result<DocumentInfo, String> {
    let json = doc_ref(state, document_id, |d| d.save_string())??;
    let final_path = match path {
        Some(p) => {
            state
                .lock()
                .doc_paths
                .insert(document_id.to_string(), std::path::PathBuf::from(p));
            p.to_string()
        }
        None => {
            let s = state.lock();
            s.doc_paths
                .get(document_id)
                .map(|p| p.display().to_string())
                .ok_or("document has no path")?
        }
    };
    if let Some(parent) = std::path::Path::new(&final_path).parent() {
        // Typed workspace folders may not exist yet — make saving self-healing.
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&final_path, json).map_err(|e| format!("write failed: {e}"))?;
    {
        let mut s = state.lock();
        if let Some(doc) = s.documents.get_mut(document_id) {
            doc.path = Some(final_path.clone());
            doc.modified = false;
        }
        crate::state::remember_recent(&mut s.settings, &final_path);
    }
    emit_documents(app, state);
    fire_plugin_hook(
        state,
        plugins,
        "save",
        &serde_json::json!({ "path": final_path }),
    );
    let info = state.lock().doc_info(document_id).expect("exists");
    Ok(info)
}

// ------------------------------------------------------------ scene access

#[tauri::command]
pub fn get_scene(
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<SceneEnvelope, String> {
    let scene = doc_ref(&state, &document_id, |d| d.scene_data())?;
    Ok(SceneEnvelope { document_id, scene })
}

// ------------------------------------------------------------ entities

#[derive(Debug, Clone, serde::Serialize)]
pub struct CreateEntityOut {
    pub id: String,
    pub name: String,
}

#[tauri::command]
pub fn create_entity(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    geometry: Json,
    name: Option<String>,
) -> Result<CreateEntityOut, String> {
    let id = helpers_add_entity(&app, &state, &document_id, &geometry, name.as_deref())?;
    let entity_id = parse_one(&id)?;
    let name_out = doc_ref(&state, &document_id, |d| {
        d.get(&entity_id).map(|e| e.name.clone())
    })?
    .unwrap_or_default();
    Ok(CreateEntityOut { id, name: name_out })
}

#[tauri::command]
pub fn update_geometry(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    entity_id: String,
    geometry: Json,
) -> Result<(), String> {
    let kind: Geometry =
        serde_json::from_value(geometry).map_err(|e| format!("bad geometry: {e}"))?;
    let id = parse_one(&entity_id)?;
    let mut result = Ok(());
    doc_mut(&state, &document_id, "Edit Geometry", |d| {
        result = d.set_kind(&id, kind);
    })?;
    result?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn delete_entities(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    entity_ids: Vec<String>,
) -> Result<(), String> {
    let ids = parse_ids(&entity_ids)?;
    doc_mut(&state, &document_id, "Delete", |d| {
        for id in &ids {
            d.remove_entity(id);
        }
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn duplicate_entities(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    entity_ids: Vec<String>,
) -> Result<Vec<String>, String> {
    let ids = parse_ids(&entity_ids)?;
    let mut cloned: Vec<String> = vec![];
    doc_mut(&state, &document_id, "Duplicate", |d| {
        for id in &ids {
            if let Some(new_id) = d.duplicate(id) {
                cloned.push(new_id.as_string());
            }
        }
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(cloned)
}

#[tauri::command]
pub fn set_transform(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    updates: Vec<TransformUpdate>,
    record: bool,
) -> Result<(), String> {
    let parsed: Vec<(EntityId, Transform)> = updates
        .iter()
        .map(|u| parse_one(&u.id).map(|i| (i, u.transform)))
        .collect::<Result<_, _>>()?;
    if record {
        doc_mut(&state, &document_id, "Move", |d| {
            for (id, t) in &parsed {
                d.set_transform(id, *t);
            }
        })?;
    } else {
        let mut s = state.lock();
        if let Some(doc) = s.documents.get_mut(&document_id) {
            for (id, t) in &parsed {
                doc.set_transform(id, *t);
            }
        }
    }
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityPropsUpdate {
    pub name: Option<String>,
    pub visible: Option<bool>,
    pub locked: Option<bool>,
    /// Some(None) clears the color; Some(Some(rgba)) sets it.
    pub color: Option<Option<[f64; 4]>>,
    pub layer_id: Option<String>,
}

#[tauri::command]
pub fn set_entity_props(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    entity_id: String,
    props: EntityPropsUpdate,
) -> Result<(), String> {
    let id = parse_one(&entity_id)?;
    let layer = match &props.layer_id {
        Some(s) => Some(parse_one(s)?),
        None => Option::<EntityId>::None,
    };
    let prop_values = props;
    doc_mut(&state, &document_id, "Properties", |d| {
        if let Some(color) = prop_values.color {
            let color = color.map(|rgba| Color {
                r: rgba[0] as f32,
                g: rgba[1] as f32,
                b: rgba[2] as f32,
                a: rgba[3] as f32,
            });
            d.set_color(&id, color);
        }
        if let Some(name) = &prop_values.name {
            d.set_name(&id, name.clone());
        }
        if let Some(visible) = prop_values.visible {
            d.set_visible(&id, visible);
        }
        if let Some(locked) = prop_values.locked {
            d.set_locked(&id, locked);
        }
        if let Some(layer) = layer {
            d.set_layer(&[id], layer);
        }
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn set_selection(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    ids: Vec<String>,
    primary: Option<String>,
) -> Result<(), String> {
    let ids = parse_ids(&ids)?;
    let primary = match primary {
        Some(p) => Some(parse_one(&p)?),
        None => None,
    };
    {
        let mut s = state.lock();
        let doc = s
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| format!("unknown document {document_id}"))?;
        doc.select(ids, primary);
    }
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn explode_entities(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    entity_ids: Vec<String>,
    distance: f64,
) -> Result<Vec<String>, String> {
    let ids = parse_ids(&entity_ids)?;
    let positions: Vec<(EntityId, [f64; 3])> = doc_ref(&state, &document_id, |d| {
        ids.iter()
            .filter_map(|id| d.get(id).map(|e| (e.id, e.transform.position)))
            .collect()
    })?;
    let n = positions.len().max(1) as f64;
    let centroid = {
        let mut c = [0.0f64; 3];
        for p in positions.iter().map(|(_, p)| p) {
            for k in 0..3 {
                c[k] += p[k] / n;
            }
        }
        c
    };
    let mut moved: Vec<String> = vec![];
    doc_mut(&state, &document_id, "Explode", |d| {
        for (id, p) in positions.clone() {
            let mut dir = [p[0] - centroid[0], p[1] - centroid[1], p[2] - centroid[2]];
            let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
            if len < 1e-6 {
                dir = [1.0, 0.0, 0.0];
            } else {
                dir = [dir[0] / len, dir[1] / len, dir[2] / len];
            }
            let mut t = d.get(&id).map(|e| e.transform).unwrap_or_default();
            for (tk, dk) in t.position.iter_mut().zip(dir.iter()) {
                *tk += dk * distance;
            }
            d.set_transform(&id, t);
            moved.push(id.as_string());
        }
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(moved)
}

#[tauri::command]
pub fn raycast(
    state: State<'_, SharedState>,
    document_id: String,
    origin: [f64; 3],
    dir: [f64; 3],
    tolerance: f64,
) -> Result<Option<RayHit>, String> {
    let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
    let dir = if len < 1e-12 {
        [0.0, 0.0, 1.0]
    } else {
        [dir[0] / len, dir[1] / len, dir[2] / len]
    };
    doc_ref(&state, &document_id, |d| d.raycast(origin, dir, tolerance))
}

// ------------------------------------------------------------ history

#[tauri::command]
pub fn undo(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<Option<String>, String> {
    let label = {
        let mut s = state.lock();
        let doc = s
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| format!("unknown document {document_id}"))?;
        doc.undo()
    };
    emit_scene(&app, &state, &document_id);
    Ok(label)
}

#[tauri::command]
pub fn redo(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<Option<String>, String> {
    let label = {
        let mut s = state.lock();
        let doc = s
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| format!("unknown document {document_id}"))?;
        doc.redo()
    };
    emit_scene(&app, &state, &document_id);
    Ok(label)
}

// ------------------------------------------------------------ layers

#[tauri::command]
pub fn add_layer(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    name: Option<String>,
) -> Result<String, String> {
    let mut id_out: Option<String> = None;
    doc_mut(&state, &document_id, "Layer", |d| {
        let id = d.add_layer(name.clone().unwrap_or_default(), None);
        id_out = Some(id.as_string());
    })?;
    emit_scene(&app, &state, &document_id);
    id_out.ok_or_else(|| "layer add failed".into())
}

#[tauri::command]
pub fn delete_layer(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    layer_id: String,
) -> Result<(), String> {
    let id = parse_one(&layer_id)?;
    let mut result = Ok(());
    doc_mut(&state, &document_id, "Layer", |d| {
        result = d.remove_layer(&id);
    })?;
    result?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn rename_layer(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    layer_id: String,
    name: String,
) -> Result<(), String> {
    let id = parse_one(&layer_id)?;
    doc_mut(&state, &document_id, "Layer", |d| {
        d.rename_layer(&id, name.clone());
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn set_layer_visible(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    layer_id: String,
    visible: bool,
) -> Result<(), String> {
    let id = parse_one(&layer_id)?;
    doc_mut(&state, &document_id, "Layer", |d| {
        d.set_layer_visible(&id, visible);
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn set_layer_locked(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    layer_id: String,
    locked: bool,
) -> Result<(), String> {
    let id = parse_one(&layer_id)?;
    doc_mut(&state, &document_id, "Layer", |d| {
        d.set_layer_locked(&id, locked)
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn set_layer_color(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    layer_id: String,
    color: [f64; 4],
) -> Result<(), String> {
    let id = parse_one(&layer_id)?;
    doc_mut(&state, &document_id, "Layer", |d| {
        d.set_layer_color(
            &id,
            Color {
                r: color[0] as f32,
                g: color[1] as f32,
                b: color[2] as f32,
                a: color[3] as f32,
            },
        );
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn set_active_layer(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    layer_id: String,
) -> Result<(), String> {
    let id = parse_one(&layer_id)?;
    doc_mut(&state, &document_id, "Layer", |d| d.set_active_layer(&id))?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

// ------------------------------------------------------------ settings

#[tauri::command]
pub fn get_settings(state: State<'_, SharedState>) -> Settings {
    state.lock().settings.clone()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProjectSummary {
    pub name: String,
    pub path: String,
    pub modified: i64,
    pub size: u64,
}

#[tauri::command]
pub fn list_projects(dir: String) -> Vec<ProjectSummary> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let is_arc = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("arc"))
            .unwrap_or(false);
        if !is_arc {
            continue;
        }
        let Ok(meta) = entry.metadata() else {
            continue;
        };
        if !meta.is_file() {
            continue;
        }
        let name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("untitled")
            .to_string();
        let modified = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        out.push(ProjectSummary {
            name,
            path: path.display().to_string(),
            modified,
            size: meta.len(),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

// ------------------------------------------------------------ project thumbnails

/// `<name>.thumbnail.png` sitting beside the .arc file.
fn thumbnail_path(project_path: &std::path::Path) -> Option<std::path::PathBuf> {
    let stem = project_path.file_stem()?.to_str()?;
    if stem.is_empty() {
        return None;
    }
    let parent = project_path.parent()?;
    Some(parent.join(format!("{stem}.thumbnail.png")))
}

/// Store a base64 data-URL PNG captured from the viewport, beside the
/// saved document. Best effort from the UI side — errors surface as strings.
#[tauri::command]
pub fn save_project_thumbnail(
    state: State<'_, SharedState>,
    document_id: String,
    base64_png: String,
) -> Result<(), String> {
    let doc_path = {
        let s = state.lock();
        let path = s
            .doc_paths
            .get(&document_id)
            .ok_or("document has no path")?;
        path.display().to_string()
    };
    let target = thumbnail_path(std::path::Path::new(&doc_path)).ok_or("invalid project path")?;
    let prefix = "data:image/png;base64,";
    let raw = base64_png.strip_prefix(prefix).unwrap_or(&base64_png);
    let bytes = base64::decode(raw).map_err(|e| format!("decode failed: {e}"))?;
    if let Some(parent) = target.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&target, bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(())
}

/// Base64 PNG for a project's stored thumbnail, if one exists.
#[tauri::command]
pub fn read_project_thumbnail(project_path: String) -> Option<String> {
    let target = thumbnail_path(std::path::Path::new(&project_path))?;
    let bytes = std::fs::read(target).ok()?;
    Some(base64::encode(bytes))
}

#[tauri::command]
pub fn set_settings(app: AppHandle, state: State<'_, SharedState>, settings: Settings) -> Settings {
    let saved = {
        let mut s = state.lock();
        s.settings = settings.clone();
        if let Some(path) = s.settings_path.clone() {
            crate::state::save_settings(&path, &settings);
        }
        s.settings.clone()
    };
    let _ = app.emit("arc://settings", saved.clone());
    saved
}

// ------------------------------------------------------------ plugins

#[tauri::command]
pub fn reload_plugins(
    app: AppHandle,
    state: State<'_, SharedState>,
    plugins: State<'_, PluginLock>,
) -> Vec<crate::state::PluginInfo> {
    let list = {
        let mut p = plugins.lock();
        p.reload(state.inner(), &app)
    };
    let _ = app.emit("arc://plugins", &list);
    list
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: AppHandle,
    state: State<'_, SharedState>,
    name: String,
    enabled: bool,
) -> Result<(), String> {
    {
        let mut s = state.lock();
        if enabled {
            if !s.settings.enabled_plugins.contains(&name) {
                s.settings.enabled_plugins.push(name.clone());
            }
        } else {
            s.settings.enabled_plugins.retain(|n| n != &name);
        }
        if let Some(path) = s.settings_path.clone() {
            crate::state::save_settings(&path, &s.settings);
        }
    }
    let _ = app.emit("arc://settings", state.lock().settings.clone());
    Ok(())
}

// ------------------------------------------------------------ export

#[tauri::command]
pub fn export_scene(
    state: State<'_, SharedState>,
    document_id: String,
    path: String,
    format: String,
) -> Result<String, String> {
    let bytes = {
        let mut s = state.lock();
        let doc = s
            .documents
            .get_mut(&document_id)
            .ok_or_else(|| format!("unknown document {document_id}"))?;
        crate::core::materialize_meshes(doc);
        match format.as_str() {
            "obj" => bytes_of_text(&export_obj(doc)),
            "stl" => export_stl_binary(doc),
            "stl_ascii" => bytes_of_text(&crate::core::formats::export_stl_ascii(
                &merged_world_mesh(doc),
                &doc.name,
            )),
            "gltf" => bytes_of_text(&crate::core::formats::export_gltf(
                &merged_world_mesh(doc),
                &doc.name,
            )?),
            "step" | "stp" => bytes_of_text(&crate::kernel::step::export_document(doc)?),
            other => return Err(format!("unsupported format: {other}")),
        }
    };
    std::fs::write(&path, bytes).map_err(|e| format!("write failed: {e}"))?;
    Ok(path)
}

fn bytes_of_text(text: &str) -> Vec<u8> {
    text.as_bytes().to_vec()
}

fn export_obj(doc: &mut Document) -> String {
    let mut out = String::from("# arc export\n");
    let mut base: usize = 1;
    let ids: Vec<EntityId> = doc
        .entities
        .values()
        .filter(|e| e.visible && !e.locked)
        .map(|e| e.id)
        .collect();
    for id in ids {
        let Some((name, t)) = doc.get(&id).map(|e| (e.name.clone(), e.transform)) else {
            continue;
        };
        let Some(buffer) = doc.mesh(&id) else {
            continue;
        };
        if buffer.positions.is_empty() {
            continue;
        }
        out.push_str(&format!("o {}\n", name.replace(' ', "_")));
        for c in buffer.positions.chunks(3) {
            let w = t.transform_point([c[0] as f64, c[1] as f64, c[2] as f64]);
            out.push_str(&format!("v {} {} {}\n", w[0], w[1], w[2]));
        }
        let count = buffer.positions.len() / 3;
        let mut i = base;
        while i < base + count {
            out.push_str(&format!("f {} {} {}\n", i, i + 1, i + 2));
            i += 3;
        }
        base += count;
    }
    out
}

/// Binary STL of all visible solid geometry (little-endian).
fn export_stl_binary(doc: &mut Document) -> Vec<u8> {
    let mut tris: Vec<([f64; 3], [f64; 3], [f64; 3])> = vec![];
    let ids: Vec<EntityId> = doc
        .entities
        .values()
        .filter(|e| e.visible && !e.locked)
        .map(|e| e.id)
        .collect();
    for id in ids {
        let Some(t) = doc.get(&id).map(|e| e.transform) else {
            continue;
        };
        let Some(buffer) = doc.mesh(&id) else {
            continue;
        };
        for tri in buffer.positions.chunks(9) {
            let a = t.transform_point([tri[0] as f64, tri[1] as f64, tri[2] as f64]);
            let b = t.transform_point([tri[3] as f64, tri[4] as f64, tri[5] as f64]);
            let c = t.transform_point([tri[6] as f64, tri[7] as f64, tri[8] as f64]);
            tris.push((a, b, c));
        }
    }
    let mut out = vec![0u8; 84 + tris.len() * 50];
    out[..9].copy_from_slice(b"arc stl\0\0");
    let count = tris.len() as u32;
    out[80..84].copy_from_slice(&count.to_le_bytes());
    let mut cursor = 84usize;
    for (a, b, c) in tris {
        let n = crate::core::mesh::tri_normal(a, b, c);
        for v in [n, a, b, c] {
            for comp in v {
                out[cursor..cursor + 4].copy_from_slice(&(comp as f32).to_le_bytes());
                cursor += 4;
            }
        }
        out[cursor..cursor + 2].copy_from_slice(&0u16.to_le_bytes());
        cursor += 2;
    }
    out
}

/// All visible geometry baked into one world-space triangle buffer, for the
/// single-mesh exporters in `crate::core::formats` (STL ASCII, glTF).
fn merged_world_mesh(doc: &mut Document) -> MeshBuffer {
    let ids: Vec<EntityId> = doc
        .entities
        .values()
        .filter(|e| e.visible && !e.locked)
        .map(|e| e.id)
        .collect();
    let mut merged = MeshBuffer::default();
    for id in ids {
        let Some(t) = doc.get(&id).map(|e| e.transform) else {
            continue;
        };
        let Some(buffer) = doc.mesh(&id) else {
            continue;
        };
        let world = crate::core::mesh::mesh_world(&buffer, &t);
        merged.positions.extend_from_slice(&world.positions);
        merged.normals.extend_from_slice(&world.normals);
    }
    merged
}

// ------------------------------------------------------------ import

#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportReport {
    pub format: String,
    pub entities_created: Vec<String>,
}

fn format_name(format: Format) -> &'static str {
    match format {
        Format::Obj => "obj",
        Format::Stl => "stl",
        Format::StlAscii => "stl_ascii",
        Format::Dxf => "dxf",
        Format::Gltf => "gltf",
        Format::Step => "step",
    }
}

/// DXF drawings live in the XY plane with +Z up, while arc's ground plane is
/// XZ with +Y up; imported coordinates swap Y and Z so plans lie flat.
fn dxf_point(p: [f64; 3]) -> [f64; 3] {
    [p[0], p[2], p[1]]
}

fn soup_entity(what: &str, soup: TriangleSoup) -> Result<(String, Geometry, Transform), String> {
    if soup.is_empty() {
        return Err(format!("no triangles found in {what}"));
    }
    let indices = soup
        .indices
        .iter()
        .flat_map(|t| t.iter().copied())
        .collect();
    Ok((
        what.to_string(),
        Geometry::ImportedMesh {
            positions: soup.positions,
            indices,
        },
        Transform::default(),
    ))
}

#[tauri::command]
pub fn import_file(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    path: String,
    format: Option<String>,
) -> Result<ImportReport, String> {
    let override_format = format.as_deref().map(str::to_ascii_lowercase);
    let detected = match override_format.as_deref() {
        Some("obj") => Format::Obj,
        Some("stl") | Some("stl_binary") => Format::Stl,
        Some("stl_ascii") => Format::StlAscii,
        Some("dxf") => Format::Dxf,
        Some("gltf") => return Err("gltf import is not supported".into()),
        Some("step") | Some("stp") => Format::Step,
        Some(other) => return Err(format!("unsupported import format: {other}")),
        None => {
            let detected = Format::detect(&path).ok_or_else(|| {
                format!("cannot detect format of {path}; pass an explicit format")
            })?;
            if detected == Format::Gltf {
                return Err("gltf import is not supported".into());
            }
            detected
        }
    };
    let report_format = format_name(detected).to_string();
    let bytes = std::fs::read(&path).map_err(|e| format!("read failed: {e}"))?;
    let stem = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Imported")
        .to_string();

    let mut new_entities: Vec<(String, Geometry, Transform)> = Vec::new();
    match detected {
        Format::Obj => {
            let obj = crate::core::formats::parse_obj(&String::from_utf8_lossy(&bytes))?;
            let soup = TriangleSoup::from_triangles(obj.faces.iter().filter_map(|f| {
                if f.len() != 3 {
                    return None;
                }
                let (a, b, c) = (f[0] as usize, f[1] as usize, f[2] as usize);
                Some([obj.positions[a], obj.positions[b], obj.positions[c]])
            }));
            new_entities.push(soup_entity(&stem, soup)?);
        }
        Format::Stl | Format::StlAscii => {
            let mesh = crate::core::formats::parse_stl(&bytes)?;
            let name = mesh.name.clone().unwrap_or_else(|| stem.clone());
            let soup = TriangleSoup::from_stl(&mesh);
            new_entities.push(soup_entity(&path, soup).map(|(_, g, t)| (name, g, t))?);
        }
        Format::Dxf => {
            let drawing = crate::core::formats::parse_dxf(&String::from_utf8_lossy(&bytes))?;
            for line in drawing.lines {
                let start = dxf_point(line.start);
                let end = dxf_point(line.end);
                let delta = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
                if delta.iter().all(|c| c.abs() < 1e-12) {
                    continue;
                }
                new_entities.push((
                    String::new(),
                    Geometry::LineCurve { end: delta },
                    Transform::at(start[0], start[1], start[2]),
                ));
            }
            for circle in drawing.circles {
                let center = dxf_point(circle.center);
                new_entities.push((
                    String::new(),
                    Geometry::CircleCurve {
                        radius: circle.radius,
                        segments: 48,
                    },
                    Transform::at(center[0], center[1], center[2]),
                ));
            }
            for arc in drawing.arcs {
                let center = dxf_point(arc.center);
                new_entities.push((
                    String::new(),
                    Geometry::ArcCurve {
                        radius: arc.radius,
                        start_angle_deg: arc.start_angle_deg,
                        end_angle_deg: arc.end_angle_deg,
                        segments: 48,
                    },
                    Transform::at(center[0], center[1], center[2]),
                ));
            }
            for polyline in drawing.polylines {
                let first = dxf_point([polyline.vertices[0][0], polyline.vertices[0][1], 0.0]);
                let points = polyline
                    .vertices
                    .iter()
                    .map(|v| {
                        let w = dxf_point([v[0], v[1], 0.0]);
                        [w[0] - first[0], w[1] - first[1], w[2] - first[2]]
                    })
                    .collect();
                new_entities.push((
                    String::new(),
                    Geometry::PolylineCurve { points },
                    Transform::at(first[0], first[1], first[2]),
                ));
            }
        }
        Format::Step => {
            let text = String::from_utf8_lossy(&bytes);
            for (name, kind, transform) in crate::core::entity::Geometry::from_step_mesh(&text)? {
                new_entities.push((name, kind, transform));
            }
        }
        Format::Gltf => unreachable!("rejected above"),
    }

    let mut created: Vec<String> = Vec::new();
    doc_mut(&state, &document_id, "Import", |doc| {
        for (name, kind, transform) in new_entities {
            let mut entity = Entity::new(EntityId::new(), name, doc.active_layer, kind);
            entity.transform = transform;
            let (id, res) = doc.add_entity(entity);
            if res.is_ok() {
                created.push(id.as_string());
            }
        }
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(ImportReport {
        format: report_format,
        entities_created: created,
    })
}

// ------------------------------------------------------------ sheet metal

#[tauri::command]
pub fn sheetmetal_materials() -> Vec<SheetMetalMaterial> {
    crate::core::sheetmetal::default_materials()
}

#[tauri::command]
pub fn sheetmetal_flat_pattern(spec: Json) -> Result<FlatPattern, String> {
    let part: SheetMetalPart =
        serde_json::from_value(spec).map_err(|e| format!("bad sheet metal part: {e}"))?;
    part.validate()?;
    crate::core::sheetmetal::flat_pattern(&part)
}

// ------------------------------------------------------------ annotations

#[tauri::command]
pub fn annotation_create(
    state: State<'_, SharedState>,
    document_id: String,
    kind: Json,
    style: Option<String>,
) -> Result<String, String> {
    let kind: AnnotationKind =
        serde_json::from_value(kind).map_err(|e| format!("bad annotation kind: {e}"))?;
    let label = match &kind {
        AnnotationKind::Linear(_) => "Linear",
        AnnotationKind::Angular(_) => "Angular",
        AnnotationKind::Radial(_) => "Radial",
    }
    .to_string();
    let style = style.unwrap_or_else(|| "default".to_string());
    let id = {
        let mut s = state.lock();
        if !s.documents.contains_key(&document_id) {
            return Err(format!("unknown document {document_id}"));
        }
        let registry = s.annotations.entry(document_id).or_default();
        let annotation = Annotation::new(label, kind, style);
        registry.add_annotation(annotation)?.as_string()
    };
    Ok(id)
}

#[tauri::command]
pub fn annotation_measure(
    state: State<'_, SharedState>,
    document_id: String,
    annotation_id: String,
) -> Result<f64, String> {
    let id = parse_one(&annotation_id)?;
    let s = state.lock();
    if !s.documents.contains_key(&document_id) {
        return Err(format!("unknown document {document_id}"));
    }
    let registry = s
        .annotations
        .get(&document_id)
        .ok_or_else(|| format!("unknown annotation {annotation_id}"))?;
    registry.measure(&id)
}

#[tauri::command]
pub fn annotation_geometry(
    state: State<'_, SharedState>,
    document_id: String,
    annotation_id: String,
) -> Result<DimensionGeometry, String> {
    let id = parse_one(&annotation_id)?;
    let s = state.lock();
    if !s.documents.contains_key(&document_id) {
        return Err(format!("unknown document {document_id}"));
    }
    let registry = s
        .annotations
        .get(&document_id)
        .ok_or_else(|| format!("unknown annotation {annotation_id}"))?;
    registry.build_geometry(&id)
}

// ------------------------------------------------------------ constraints

#[tauri::command]
pub fn constraint_add(
    state: State<'_, SharedState>,
    document_id: String,
    kind: ConstraintType,
    lhs_entity: String,
    lhs_param: GeometryParameter,
    rhs: Option<Json>,
) -> Result<u64, String> {
    let lhs_id = parse_one(&lhs_entity)?;
    {
        let s = state.lock();
        let doc = s
            .documents
            .get(&document_id)
            .ok_or_else(|| format!("unknown document {document_id}"))?;
        if !doc.entities.contains_key(&lhs_id) {
            return Err(format!("unknown entity {lhs_entity}"));
        }
    }
    let mut s = state.lock();
    let cstate = s.constraints.entry(document_id).or_default();
    let lhs = ConstraintExpression::GeometryParameter {
        entity_id: cstate.handle(lhs_entity.as_str()),
        parameter: lhs_param,
    };
    let rhs_expr = match rhs {
        None => None,
        Some(value) => {
            if let Some(constant) = value.as_f64() {
                Some(ConstraintExpression::Constant(constant))
            } else {
                #[derive(Deserialize)]
                struct RhsParam {
                    entity_id: String,
                    parameter: GeometryParameter,
                }
                let param: RhsParam =
                    serde_json::from_value(value).map_err(|e| format!("bad rhs: {e}"))?;
                Some(ConstraintExpression::GeometryParameter {
                    entity_id: cstate.handle(&param.entity_id),
                    parameter: param.parameter,
                })
            }
        }
    };
    let constraint = Constraint::new(0, kind, lhs, rhs_expr, 1e-6);
    Ok(cstate.system.add_constraint(constraint))
}

/// The kernel reports only the first violation per `solve`; parse its id out
/// of the message so the probe loop below can drop it and surface every
/// remaining violation as well.
fn violated_constraint_id(message: &str) -> Option<u64> {
    let rest = message.strip_prefix("constraint ")?;
    let end = rest.find(' ')?;
    rest[..end].parse().ok()
}

#[tauri::command]
pub fn solve_constraints(
    state: State<'_, SharedState>,
    document_id: String,
) -> Result<Vec<String>, String> {
    let entities: Vec<(String, Entity)> = {
        let s = state.lock();
        let doc = s
            .documents
            .get(&document_id)
            .ok_or_else(|| format!("unknown document {document_id}"))?;
        doc.entities
            .values()
            .map(|e| (e.id.as_string(), e.clone()))
            .collect()
    };
    let mut s = state.lock();
    let cstate = s.constraints.entry(document_id).or_default();
    for (entity_id, entity) in &entities {
        let handle = cstate.handle(entity_id);
        cstate.system.update_entity(handle, entity);
    }
    // Solve on a clone, dropping each reported violation so the next pass
    // reveals further ones; the live system is left untouched.
    let mut violations: Vec<String> = Vec::new();
    let mut probe = cstate.system.clone();
    loop {
        match probe.solve() {
            Ok(()) => break,
            Err(message) => {
                let removed =
                    violated_constraint_id(&message).is_some_and(|id| probe.remove_constraint(id));
                violations.push(message);
                if !removed {
                    break;
                }
            }
        }
    }
    Ok(violations)
}

// ------------------------------------------------------------ materials + CSG

#[derive(Debug, Clone, serde::Serialize)]
pub struct MaterialLibraryEntry {
    pub id: String,
    pub label: String,
    pub color: [f64; 3],
    pub roughness: f64,
    pub metalness: f64,
}

#[tauri::command]
pub fn get_material_library() -> Vec<MaterialLibraryEntry> {
    const ENTRIES: &[(&str, &str, [f64; 3], f64, f64)] = &[
        ("steel", "Steel", [0.659, 0.678, 0.710], 0.35, 0.9),
        ("aluminum", "Aluminum", [0.784, 0.800, 0.824], 0.4, 0.85),
        (
            "brushed_metal",
            "Brushed metal",
            [0.690, 0.710, 0.737],
            0.25,
            0.85,
        ),
        ("copper", "Copper", [0.722, 0.451, 0.200], 0.4, 0.9),
        (
            "plastic_white",
            "Plastic white",
            [0.949, 0.949, 0.949],
            0.7,
            0.0,
        ),
        (
            "plastic_black",
            "Plastic black",
            [0.165, 0.165, 0.180],
            0.6,
            0.05,
        ),
        ("glass", "Glass", [0.812, 0.910, 0.937], 0.1, 0.0),
        ("rubber", "Rubber", [0.227, 0.227, 0.227], 0.95, 0.0),
        ("wood_oak", "Wood oak", [0.690, 0.545, 0.341], 0.8, 0.0),
        ("concrete", "Concrete", [0.604, 0.604, 0.573], 0.95, 0.0),
        ("chrome", "Chrome", [0.910, 0.914, 0.925], 0.15, 1.0),
        ("gold", "Gold", [0.831, 0.686, 0.216], 0.3, 1.0),
    ];
    ENTRIES
        .iter()
        .map(
            |(id, label, color, roughness, metalness)| MaterialLibraryEntry {
                id: id.to_string(),
                label: label.to_string(),
                color: *color,
                roughness: *roughness,
                metalness: *metalness,
            },
        )
        .collect()
}

#[tauri::command]
pub fn set_entity_material(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    entity_id: String,
    material: Option<String>,
) -> Result<(), String> {
    let id = parse_one(&entity_id)?;
    doc_mut(&state, &document_id, "Material", |d| {
        d.set_material(&id, material)
    })?;
    emit_scene(&app, &state, &document_id);
    Ok(())
}

#[tauri::command]
pub fn csg_apply(
    app: AppHandle,
    state: State<'_, SharedState>,
    document_id: String,
    operation: String,
    first_id: String,
    second_id: String,
) -> Result<CreateEntityOut, String> {
    let op: CsgOperation =
        serde_json::from_value(Json::String(operation.clone())).map_err(|_| {
            format!("unknown CSG operation: {operation} (use union, difference, intersection)")
        })?;
    let first = parse_one(&first_id)?;
    let second = parse_one(&second_id)?;
    let (first_pair, second_pair) = doc_ref(&state, &document_id, |d| {
        let a = d.get(&first).map(|e| (e.kind.clone(), e.transform));
        let b = d.get(&second).map(|e| (e.kind.clone(), e.transform));
        (a, b)
    })?;
    let (first_kind, first_t) = first_pair.ok_or("first entity not found")?;
    let (second_kind, second_t) = second_pair.ok_or("second entity not found")?;
    for (label, kind) in [("first", &first_kind), ("second", &second_kind)] {
        if !kind.has_triangles() {
            return Err(format!("{label} entity has no solid geometry to boolean"));
        }
    }
    let geometry = Geometry::Csg {
        operation: op,
        first: Box::new(first_kind),
        second: Box::new(second_kind),
        first_transform: Some(first_t),
        second_transform: Some(second_t),
    };
    crate::kernel::meshgen::generate(&geometry)?;
    let label = match op {
        CsgOperation::Union => "Union",
        CsgOperation::Difference => "Difference",
        CsgOperation::Intersection => "Intersection",
    };
    let mut created: Option<(String, String)> = None;
    doc_mut(&state, &document_id, label, |doc| {
        let entity = Entity::new(
            EntityId::new(),
            label.to_string(),
            doc.active_layer,
            geometry.clone(),
        );
        let (id, res) = doc.add_entity(entity);
        if res.is_ok() {
            doc.remove_entity(&first);
            doc.remove_entity(&second);
            doc.select(vec![id], Some(id));
            let name = doc.get(&id).map(|e| e.name.clone()).unwrap_or_default();
            created = Some((id.as_string(), name));
        }
    })?;
    let (id, name) = created.ok_or("geometry rejected by kernel")?;
    emit_scene(&app, &state, &document_id);
    Ok(CreateEntityOut { id, name })
}
