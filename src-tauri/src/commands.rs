//! Tauri command surface. All scene-mutating commands record undo history,
//! and emit `arc://scene` so the webview stays in sync.

use crate::plugins::PluginLock;
use crate::state::{
    doc_mut, doc_ref, parse_ids, AppOverview, DocumentInfo, SceneEnvelope, Settings,
    SharedState, TransformUpdate,
};
use arc_core::{Color, Document, Entity, EntityId, Geometry, RayHit, Transform};
use serde::Deserialize;
use serde_json::Value as Json;
use tauri::{AppHandle, Emitter, State};

// ------------------------------------------------------------ event helpers

pub fn emit_scene(app: &AppHandle, state: &SharedState, document_id: &str) {
    let payload = state.lock().documents.get(document_id).map(|d| SceneEnvelope {
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
        }
    };
    let _ = app.emit("arc://documents", payload);
}

fn fire_plugin_hook(
    state: &State<'_, SharedState>,
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
        let entity = Entity::new(EntityId::new(), name.clone(), doc.active_layer, kind.clone());
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
    let target: Transform = serde_json::from_value(transform.clone())
        .map_err(|e| format!("bad transform: {e}"))?;
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
pub fn get_state(
    state: State<'_, SharedState>,
    plugins: State<'_, PluginLock>,
) -> AppOverview {
    let _ = &plugins;
    let s = state.lock();
    AppOverview {
        documents: s.documents_out(),
        active: s.active.clone(),
        settings: s.settings.clone(),
    }
}

#[tauri::command]
pub fn get_plugins(
    plugins: State<'_, PluginLock>,
) -> Vec<crate::state::PluginInfo> {
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
    let json = std::fs::read_to_string(&path).map_err(|e| format!("open failed: {e}"))?;
    let doc = Document::from_json(&json).map_err(|e| format!("parse failed: {e}"))?;

    let info = {
        let mut s = state.lock();
        let id = s.next_doc_id();
        s.documents.insert(id.clone(), doc);
        s.order.push(id.clone());
        s.active = Some(id.clone());
        s.doc_paths.insert(id.clone(), std::path::PathBuf::from(path.clone()));
        s.doc_info(&id).expect("just inserted")
    };
    emit_documents(&app, &state);
    fire_plugin_hook(
        &state,
        Some(&plugins),
        "open",
        &serde_json::json!({ "path": path }),
    );
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
    let json = doc_ref(&state, &document_id, |d| d.save_string())??;
    let final_path = match path {
        Some(p) => {
            state
                .lock()
                .doc_paths
                .insert(document_id.clone(), std::path::PathBuf::from(p.clone()));
            p
        }
        None => {
            let s = state.lock();
            s.doc_paths
                .get(&document_id)
                .map(|p| p.display().to_string())
                .ok_or("document has no path")?
        }
    };
    std::fs::write(&final_path, json).map_err(|e| format!("write failed: {e}"))?;
    {
        let mut s = state.lock();
        if let Some(doc) = s.documents.get_mut(&document_id) {
            doc.path = Some(final_path.clone());
            doc.modified = false;
        }
    }
    emit_documents(&app, &state);
    fire_plugin_hook(
        &state,
        Some(&plugins),
        "save",
        &serde_json::json!({ "path": final_path }),
    );
    let info = state.lock().doc_info(&document_id).expect("exists");
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
    doc_mut(&state, &document_id, "Layer", |d| d.set_layer_locked(&id, locked))?;
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

#[tauri::command]
pub fn set_settings(
    app: AppHandle,
    state: State<'_, SharedState>,
    settings: Settings,
) -> Settings {
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
        arc_core::materialize_meshes(doc);
        match format.as_str() {
            "obj" => bytes_of_text(&export_obj(doc)),
            "stl" => export_stl_binary(doc),
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
        let n = arc_core::mesh::tri_normal(a, b, c);
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
