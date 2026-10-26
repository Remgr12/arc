//! The document model: entities, layers, selection, history, scene snapshots,
//! raycasting and persistence.

use std::collections::BTreeMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::core::RayHit;
use crate::core::entity::{Entity, EntityData, Geometry};
use crate::core::history::{History, Snapshot};
use crate::core::mesh::{MeshBuffer, ray_point_segment_distance};
use crate::core::units::Units;
use crate::core::{Color, EntityId, Layer, Transform};
use crate::kernel::meshgen;

/// Project mode / workbench discipline.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProjectMode {
    #[default]
    Cad,
    Architecture,
}

/// A building storey / level datum.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LevelData {
    pub id: String,
    pub name: String,
    pub elevation: f64,
    #[serde(default = "default_level_height")]
    pub height: f64,
}

fn default_level_height() -> f64 {
    300.0
}

/// An architectural structural grid line with bubble marker.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GridData {
    pub id: String,
    pub name: String,
    pub start: [f64; 2],
    pub end: [f64; 2],
}

/// Serializable document (without derived mesh buffers).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentData {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub units: Units,
    #[serde(default)]
    pub project_mode: ProjectMode,
    #[serde(default)]
    pub levels: Vec<LevelData>,
    #[serde(default)]
    pub active_level: Option<String>,
    #[serde(default)]
    pub grids: Vec<GridData>,
    pub layers: Vec<Layer>,
    #[serde(default)]
    pub active_layer: EntityId,
    pub entities: Vec<Entity>,
    #[serde(default)]
    pub selection: Vec<EntityId>,
    #[serde(default)]
    pub primary: Option<EntityId>,
}

/// Domain document.
#[derive(Debug)]
pub struct Document {
    #[allow(dead_code)]
    pub id: EntityId,
    pub name: String,
    pub path: Option<String>,
    pub units: Units,
    pub modified: bool,
    #[allow(dead_code)]
    pub data_version: u32,
    pub project_mode: ProjectMode,
    pub levels: Vec<LevelData>,
    pub active_level: Option<String>,
    pub grids: Vec<GridData>,
    pub layers: Vec<Layer>,
    pub active_layer: EntityId,
    pub entities: BTreeMap<EntityId, Entity>,
    pub selection: Vec<EntityId>,
    pub primary: Option<EntityId>,
    pub history: History,
    mesh_cache: BTreeMap<EntityId, Arc<MeshBuffer>>,
    scene_version: u64,
    next_tag: u32,
}

impl Default for Document {
    fn default() -> Self {
        Self::new("Untitled".to_string())
    }
}

impl Document {
    pub fn new(name: String) -> Self {
        Self::new_with_mode(name, ProjectMode::Cad)
    }

    pub fn new_with_mode(name: String, mode: ProjectMode) -> Self {
        let mut layers = Vec::new();
        let levels = if mode == ProjectMode::Architecture {
            vec![
                LevelData {
                    id: "level-1".to_string(),
                    name: "Level 1".to_string(),
                    elevation: 0.0,
                    height: 300.0,
                },
                LevelData {
                    id: "level-2".to_string(),
                    name: "Level 2".to_string(),
                    elevation: 300.0,
                    height: 300.0,
                },
                LevelData {
                    id: "level-roof".to_string(),
                    name: "Roof Level".to_string(),
                    elevation: 600.0,
                    height: 0.0,
                },
            ]
        } else {
            Vec::new()
        };

        let grids = if mode == ProjectMode::Architecture {
            vec![
                GridData {
                    id: "grid-1".to_string(),
                    name: "1".to_string(),
                    start: [-600.0, -400.0],
                    end: [-600.0, 400.0],
                },
                GridData {
                    id: "grid-2".to_string(),
                    name: "2".to_string(),
                    start: [0.0, -400.0],
                    end: [0.0, 400.0],
                },
                GridData {
                    id: "grid-3".to_string(),
                    name: "3".to_string(),
                    start: [600.0, -400.0],
                    end: [600.0, 400.0],
                },
                GridData {
                    id: "grid-a".to_string(),
                    name: "A".to_string(),
                    start: [-800.0, -300.0],
                    end: [800.0, -300.0],
                },
                GridData {
                    id: "grid-b".to_string(),
                    name: "B".to_string(),
                    start: [-800.0, 300.0],
                    end: [800.0, 300.0],
                },
            ]
        } else {
            Vec::new()
        };

        let active_level = if mode == ProjectMode::Architecture {
            Some("level-1".to_string())
        } else {
            None
        };

        if mode == ProjectMode::Architecture {
            layers.push(Layer::new("Walls".to_string(), Some(Color::rgb(0.82, 0.45, 0.25))));
            layers.push(Layer::new("Openings".to_string(), Some(Color::rgb(0.20, 0.60, 0.90))));
            layers.push(Layer::new("Floors & Roofs".to_string(), Some(Color::rgb(0.55, 0.58, 0.65))));
            layers.push(Layer::new("Structure".to_string(), Some(Color::rgb(0.90, 0.60, 0.15))));
            layers.push(Layer::new("Stairs".to_string(), Some(Color::rgb(0.35, 0.70, 0.45))));
            layers.push(Layer::new("Rooms & Furniture".to_string(), Some(Color::rgb(0.65, 0.40, 0.80))));
            layers.push(Layer::new("Grids & Levels".to_string(), Some(Color::rgb(0.40, 0.45, 0.50))));
        } else {
            layers.push(Layer::new("Default".to_string(), Some(Color::GRAY)));
        }

        let active_layer = layers[0].id;
        Self {
            id: EntityId::new(),
            name,
            path: None,
            units: Units::default(),
            modified: false,
            data_version: 1,
            project_mode: mode,
            levels,
            active_level,
            grids,
            layers,
            active_layer,
            entities: BTreeMap::new(),
            selection: Vec::new(),
            primary: None,
            history: History::new(128),
            mesh_cache: BTreeMap::new(),
            scene_version: 1,
            next_tag: 1,
        }
    }

    #[allow(dead_code)]
    pub fn scene_version(&self) -> u64 {
        self.scene_version
    }

    pub fn touch(&mut self) {
        self.modified = true;
        self.scene_version += 1;
    }

    // ------------------------------------------------------------- entities

    /// Give a fresh, unique display name like "Box 3" for a kind.
    fn allocate_name(&mut self, kind: &Geometry) -> String {
        let label = Self::kind_label(kind);
        let mut n;
        loop {
            n = self.next_tag;
            self.next_tag += 1;
            let candidate = format!("{} {}", label, n);
            let taken = self
                .entities
                .values()
                .any(|e| e.name.eq_ignore_ascii_case(&candidate));
            if !taken {
                break;
            }
        }
        format!("{} {}", label, n)
    }

    pub fn kind_label(kind: &Geometry) -> &'static str {
        match kind {
            Geometry::Box { .. } => "Box",
            Geometry::Sphere { .. } => "Sphere",
            Geometry::Cylinder { .. } => "Cylinder",
            Geometry::Cone { .. } => "Cone",
            Geometry::Torus { .. } => "Torus",
            Geometry::Plane { .. } => "Plane",
            Geometry::LineCurve { .. } => "Line",
            Geometry::PolylineCurve { .. } => "Polyline",
            Geometry::CircleCurve { .. } => "Circle",
            Geometry::ArcCurve { .. } => "Arc",
            Geometry::RectangleCurve { .. } => "Rectangle",
            Geometry::PolygonCurve { .. } => "Polygon",
            Geometry::NurbsSurface { .. } => "NURBS Surface",
            Geometry::NurbsLoft { .. } => "NURBS Loft",
            Geometry::NurbsSweep { .. } => "NURBS Sweep",
            Geometry::Csg { .. } => "CSG Solid",
            Geometry::SolidFillet { .. } => "Fillet",
            Geometry::ImportedMesh { .. } => "Imported Mesh",
            Geometry::Extrude { .. } => "Extrude",
            Geometry::Revolve { .. } => "Revolve",
            Geometry::Sweep { .. } => "Sweep",
            Geometry::Loft { .. } => "Loft",
            Geometry::Wall { .. } => "Wall",
            Geometry::Stair { .. } => "Stair",
            Geometry::Slab { .. } => "Slab",
            Geometry::Roof { .. } => "Roof",
            Geometry::Column { .. } => "Column",
            Geometry::Beam { .. } => "Beam",
            Geometry::Door { .. } => "Door",
            Geometry::Window { .. } => "Window",
            Geometry::Component { .. } => "Component",
            Geometry::Room { .. } => "Room",
            Geometry::Railing { .. } => "Railing",
            Geometry::GridLine { .. } => "Grid Line",
            Geometry::LevelDatum { .. } => "Level Datum",
            Geometry::Dimension { .. } => "Dimension",
        }
    }

    /// Add an entity (also generates mesh). Returns (id, error).
    pub fn add_entity(&mut self, mut entity: Entity) -> (EntityId, Result<(), String>) {
        let buffer = match entity.kind.validate().and_then(|_| meshgen::generate(&entity.kind)) {
            Ok(buf) => Arc::new(buf),
            Err(e) => return (entity.id, Err(e)),
        };
        let id = entity.id;
        if entity.name.is_empty() {
            entity.name = self.allocate_name(&entity.kind);
        }
        self.entities.insert(id, entity);
        self.mesh_cache.insert(id, buffer);
        self.touch();
        (id, Ok(()))
    }

    pub fn get(&self, id: &EntityId) -> Option<&Entity> {
        self.entities.get(id)
    }

    #[allow(dead_code)]
    pub fn get_mut(&mut self, id: &EntityId) -> Option<&mut Entity> {
        if self.entities.contains_key(id) {
            self.touch();
        }
        self.entities.get_mut(id)
    }

    pub fn remove_entity(&mut self, id: &EntityId) -> Option<Entity> {
        let removed = self.entities.remove(id)?;
        self.selection.retain(|s| s != id);
        if self.primary == Some(*id) {
            self.primary = None;
        }
        self.mesh_cache.remove(id);
        self.touch();
        Some(removed)
    }

    /// Update geometry payload; mesh regenerates.
    pub fn set_kind(&mut self, id: &EntityId, kind: Geometry) -> Result<(), String> {
        kind.validate()?;
        let buf = meshgen::generate(&kind)?; // surface mesh errors early
        if let Some(e) = self.entities.get_mut(id) {
            e.kind = kind;
            self.mesh_cache.insert(*id, Arc::new(buf));
            self.touch();
        }
        Ok(())
    }

    pub fn set_transform(&mut self, id: &EntityId, transform: Transform) {
        if let Some(e) = self.entities.get_mut(id) {
            e.transform = transform;
            self.touch();
        }
    }

    pub fn set_color(&mut self, id: &EntityId, color: Option<Color>) {
        if let Some(e) = self.entities.get_mut(id) {
            e.color = color;
            self.touch();
        }
    }

    pub fn set_name(&mut self, id: &EntityId, name: String) {
        if let Some(e) = self.entities.get_mut(id) {
            e.name = name;
            self.touch();
        }
    }

    pub fn set_material(&mut self, id: &EntityId, material: Option<String>) {
        if let Some(e) = self.entities.get_mut(id) {
            e.material = material;
            self.touch();
        }
    }

    pub fn set_visible(&mut self, id: &EntityId, visible: bool) {
        if let Some(e) = self.entities.get_mut(id) {
            e.visible = visible;
            self.touch();
        }
    }

    pub fn set_locked(&mut self, id: &EntityId, locked: bool) {
        if let Some(e) = self.entities.get_mut(id) {
            e.locked = locked;
            self.touch();
        }
    }

    pub fn set_layer(&mut self, ids: &[EntityId], layer: EntityId) {
        if !self.layers.iter().any(|l| l.id == layer) {
            return;
        }
        for id in ids {
            if let Some(e) = self.entities.get_mut(id) {
                e.layer = layer;
            }
        }
        self.touch();
    }

    pub fn duplicate(&mut self, id: &EntityId) -> Option<EntityId> {
        let mut clone = self.entities.get(id)?.clone();
        clone.id = EntityId::new();
        clone.name = String::new();
        // offset slightly for visibility
        clone.transform.position[0] += 10.0;
        clone.transform.position[2] += 10.0;
        let (new_id, res) = self.add_entity(clone);
        res.ok()?;
        Some(new_id)
    }

    // -------------------------------------------------------------- meshes

    pub fn mesh(&mut self, id: &EntityId) -> Option<Arc<MeshBuffer>> {
        if let Some(cached) = self.mesh_cache.get(id) {
            return Some(cached.clone());
        }
        let entity = self.entities.get(id)?;
        if !entity.kind.has_triangles() && !entity.kind.has_lines() {
            return None;
        }
        let buffer = meshgen::generate(&entity.kind).ok()?;
        let arc = Arc::new(buffer);
        self.mesh_cache.insert(*id, arc.clone());
        Some(arc)
    }

    // ----------------------------------------------------------- selection

    pub fn select(&mut self, ids: Vec<EntityId>, primary: Option<EntityId>) {
        self.selection = ids;
        if let Some(p) = &primary
            && !self.selection.contains(p)
        {
            self.selection.push(*p);
        }
        self.primary = primary.or_else(|| self.selection.first().copied());
        self.touch();
    }

    #[allow(dead_code)]
    pub fn clear_selection(&mut self) {
        if !self.selection.is_empty() || self.primary.is_some() {
            self.selection.clear();
            self.primary = None;
            self.touch();
        }
    }

    // -------------------------------------------------------------- layers

    pub fn add_layer(&mut self, name: String, color: Option<Color>) -> EntityId {
        let mut layer = Layer::new(name, color);
        // ensure unique name
        let mut n = 1;
        while self.layers.iter().any(|l| l.name == layer.name) {
            n += 1;
            layer.name = format!("Layer {n}");
            layer.name = layer.name.replace("Layer 1", &format!("Layer {n}"));
        }
        let id = layer.id;
        self.layers.push(layer);
        self.touch();
        id
    }

    pub fn remove_layer(&mut self, id: &EntityId) -> Result<(), String> {
        if self.layers.len() <= 1 {
            return Err("Cannot remove the last layer".into());
        }
        let layer = self.layers.iter().find(|l| &l.id == id).cloned();
        let layer = match layer {
            Some(l) => l,
            None => return Err("Layer not found".into()),
        };
        // entities on the layer are removed too
        let doomed: Vec<EntityId> = self
            .entities
            .values()
            .filter(|e| e.layer == *id)
            .map(|e| e.id)
            .collect();
        for id in doomed {
            self.remove_entity(&id);
        }
        self.layers.retain(|l| l.id != *id);
        if self.active_layer == *id {
            self.active_layer = self.layers[0].id;
        }
        let _ = layer;
        self.touch();
        Ok(())
    }

    pub fn set_active_layer(&mut self, id: &EntityId) {
        if self.layers.iter().any(|l| l.id == *id) {
            self.active_layer = *id;
            self.touch();
        }
    }

    pub fn layer_visible(&self, entity: &Entity) -> bool {
        self.layers
            .iter()
            .find(|l| l.id == entity.layer)
            .map(|l| l.visible)
            .unwrap_or(true)
    }

    pub fn rename_layer(&mut self, id: &EntityId, name: String) {
        if let Some(l) = self.layers.iter_mut().find(|l| l.id == *id) {
            l.name = name;
            self.touch();
        }
    }

    pub fn set_layer_visible(&mut self, id: &EntityId, visible: bool) {
        if let Some(l) = self.layers.iter_mut().find(|l| l.id == *id) {
            l.visible = visible;
            self.touch();
        }
    }

    pub fn set_layer_locked(&mut self, id: &EntityId, locked: bool) {
        if let Some(l) = self.layers.iter_mut().find(|l| l.id == *id) {
            l.locked = locked;
            self.touch();
        }
    }

    pub fn set_layer_color(&mut self, id: &EntityId, color: Color) {
        if let Some(l) = self.layers.iter_mut().find(|l| l.id == *id) {
            l.color = color;
            self.touch();
        }
    }

    // ------------------------------------------------------------- history

    fn snapshot(&self) -> Snapshot {
        Snapshot {
            entities: self.entities.clone(),
            layers: self.layers.clone(),
            active_layer: self.active_layer,
            selection: self.selection.clone(),
            primary: self.primary,
        }
    }

    fn apply_snapshot(&mut self, snap: Snapshot) {
        self.mesh_cache.clear();
        self.entities = snap.entities;
        self.layers = snap.layers;
        self.active_layer = snap.active_layer;
        self.selection = snap.selection;
        self.primary = snap.primary;
        self.touch();
    }

    /// Perform a mutating action and record it for undo.
    pub fn apply<F: FnOnce(&mut Document)>(&mut self, label: &str, f: F) {
        let before = self.snapshot();
        f(self);
        let after = self.snapshot();
        self.history.push(label.to_string(), before, after);
        self.touch();
    }

    pub fn undo(&mut self) -> Option<String> {
        let label = self.history.undo_label()?.to_string();
        let snap = self.history.undo()?;
        self.apply_snapshot(snap);
        Some(label)
    }

    pub fn redo(&mut self) -> Option<String> {
        let label = self.history.redo_label()?.to_string();
        let snap = self.history.redo()?;
        self.apply_snapshot(snap);
        Some(label)
    }

    pub fn can_undo(&self) -> bool {
        self.history.can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.can_redo()
    }

    // ------------------------------------------------------------ raycast

    /// Raycast entities. Solid meshes hit by triangle intersection; curve
    /// entities via segment distance with a world-space tolerance.
    pub fn raycast(&self, origin: [f64; 3], dir: [f64; 3], tolerance: f64) -> Option<RayHit> {
        let mut best: Option<RayHit> = None;
        for entity in self.entities.values() {
            if !entity.visible || entity.locked || !self.layer_visible(entity) {
                continue;
            }
            let tri_ok = entity.kind.has_triangles();
            let line_ok = entity.kind.has_lines();
            if !tri_ok && !line_ok {
                continue;
            }
            let (local_origin, local_dir) = entity.transform.ray_to_local(origin, dir);
            let mut entity_hit: Option<(f64, [f64; 3], [f64; 3], u32)> = None;

            if tri_ok {
                if let Some(buffer) = self.mesh_cache.get(&entity.id) {
                    let positions = &buffer.positions;
                    let mut tri_index = 0;
                    for tri in positions.chunks(9) {
                        let a = [tri[0] as f64, tri[1] as f64, tri[2] as f64];
                        let b = [tri[3] as f64, tri[4] as f64, tri[5] as f64];
                        let c = [tri[6] as f64, tri[7] as f64, tri[8] as f64];
                        let face_id = buffer.tri_face_ids.get(tri_index).copied().unwrap_or(0);
                        if let Some((dist, hit_face_id)) = crate::core::mesh::ray_triangle(
                            local_origin,
                            local_dir,
                            a,
                            b,
                            c,
                            face_id,
                        ) && entity_hit.map(|(d, _, _, _)| dist < d).unwrap_or(true)
                        {
                            let normal = crate::core::mesh::tri_normal(a, b, c);
                            // world normal via rotation+scale inverse transpose ≈ transform dir
                            let world_normal = entity.transform.transform_dir(normal);
                            let point = [
                                origin[0] + dir[0] * dist,
                                origin[1] + dir[1] * dist,
                                origin[2] + dir[2] * dist,
                            ];
                            entity_hit = Some((dist, point, world_normal, hit_face_id));
                        }
                        tri_index += 1;
                    }
                }
            } else if line_ok {
                // segment picking in world space
                let mut best_line: Option<(f64, [f64; 3])> = None;
                if let Some(buffer) = self.mesh_cache.get(&entity.id) {
                    for seg in buffer.lines.chunks(6) {
                        let a = entity.transform.transform_point([
                            seg[0] as f64,
                            seg[1] as f64,
                            seg[2] as f64,
                        ]);
                        let b = entity.transform.transform_point([
                            seg[3] as f64,
                            seg[4] as f64,
                            seg[5] as f64,
                        ]);
                        let (dist, ray_t) = ray_point_segment_distance(origin, dir, a, b);
                        if dist <= tolerance && best_line.map(|(d, _)| dist < d).unwrap_or(true) {
                            let point = [
                                origin[0] + dir[0] * ray_t,
                                origin[1] + dir[1] * ray_t,
                                origin[2] + dir[2] * ray_t,
                            ];
                            best_line = Some((dist, point));
                        }
                    }
                }
                if let Some((dist, point)) = best_line {
                    entity_hit = Some((dist, point, [0.0, 1.0, 0.0], 0));
                }
            }

            if let Some((dist, point, normal, face_id)) = entity_hit {
                let replace = best.as_ref().map(|b| dist_mut(b) > dist).unwrap_or(true);
                if replace {
                    best = Some(RayHit {
                        entity_id: entity.id,
                        point,
                        normal,
                        distance: dist,
                        face: Some(face_id),
                    });
                }
            }
        }
        best
    }

    // --------------------------------------------------------- persistence

    pub fn set_project_mode(&mut self, mode: ProjectMode) {
        self.project_mode = mode;
        if mode == ProjectMode::Architecture && self.levels.is_empty() {
            self.levels = vec![
                LevelData {
                    id: "level-1".to_string(),
                    name: "Level 1".to_string(),
                    elevation: 0.0,
                    height: 300.0,
                },
                LevelData {
                    id: "level-2".to_string(),
                    name: "Level 2".to_string(),
                    elevation: 300.0,
                    height: 300.0,
                },
                LevelData {
                    id: "level-roof".to_string(),
                    name: "Roof Level".to_string(),
                    elevation: 600.0,
                    height: 0.0,
                },
            ];
            self.active_level = Some("level-1".to_string());
        }
        self.touch();
    }

    pub fn add_level(&mut self, name: String, elevation: f64, height: f64) -> LevelData {
        let id = format!("level-{}", uuid::Uuid::new_v4().simple());
        let level = LevelData {
            id: id.clone(),
            name,
            elevation,
            height,
        };
        self.levels.push(level.clone());
        self.levels.sort_by(|a, b| {
            a.elevation
                .partial_cmp(&b.elevation)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        if self.active_level.is_none() {
            self.active_level = Some(id);
        }
        self.touch();
        level
    }

    pub fn remove_level(&mut self, level_id: &str) -> bool {
        let initial_len = self.levels.len();
        self.levels.retain(|l| l.id != level_id);
        if self.active_level.as_deref() == Some(level_id) {
            self.active_level = self.levels.first().map(|l| l.id.clone());
        }
        let removed = self.levels.len() < initial_len;
        if removed {
            self.touch();
        }
        removed
    }

    pub fn set_active_level(&mut self, level_id: Option<String>) {
        self.active_level = level_id;
        self.touch();
    }

    pub fn add_grid(&mut self, name: String, start: [f64; 2], end: [f64; 2]) -> GridData {
        let id = format!("grid-{}", uuid::Uuid::new_v4().simple());
        let grid = GridData { id, name, start, end };
        self.grids.push(grid.clone());
        self.touch();
        grid
    }

    pub fn remove_grid(&mut self, grid_id: &str) -> bool {
        let initial_len = self.grids.len();
        self.grids.retain(|g| g.id != grid_id);
        let removed = self.grids.len() < initial_len;
        if removed {
            self.touch();
        }
        removed
    }

    pub fn to_data(&self) -> DocumentData {
        DocumentData {
            version: 1,
            name: self.name.clone(),
            path: self.path.clone(),
            units: self.units.clone(),
            project_mode: self.project_mode,
            levels: self.levels.clone(),
            active_level: self.active_level.clone(),
            grids: self.grids.clone(),
            layers: self.layers.clone(),
            active_layer: self.active_layer,
            entities: self.entities.values().cloned().collect(),
            selection: self.selection.clone(),
            primary: self.primary,
        }
    }

    pub fn from_data(data: DocumentData) -> Self {
        let mut doc = Document::new_with_mode(data.name.clone(), data.project_mode);
        doc.name = data.name;
        doc.path = data.path;
        doc.units = data.units;
        doc.project_mode = data.project_mode;
        doc.levels = data.levels;
        doc.active_level = data.active_level;
        doc.grids = data.grids;
        if !data.layers.is_empty() {
            doc.layers = data.layers;
            doc.active_layer = data.active_layer;
        }
        for entity in data.entities {
            doc.entities.insert(entity.id, entity);
        }
        doc.selection = data.selection;
        doc.primary = data.primary;
        doc.modified = false;
        doc
    }

    /// Bounding box of all visible entities ([min, max] per component).
    #[allow(dead_code)]
    pub fn bounds(&self) -> Option<[[f64; 3]; 2]> {
        let mut min = [f64::INFINITY; 3];
        let mut max = [f64::NEG_INFINITY; 3];
        let mut any = false;
        for entity in self.entities.values() {
            if !entity.visible || !self.layer_visible(entity) {
                continue;
            }
            if let Some(buffer) = self.mesh_cache.get(&entity.id) {
                for chunk in buffer.positions.chunks(9) {
                    for v in [0, 3, 6] {
                        let p = entity.transform.transform_point([
                            chunk[v] as f64,
                            chunk[v + 1] as f64,
                            chunk[v + 2] as f64,
                        ]);
                        for k in 0..3 {
                            min[k] = min[k].min(p[k]);
                            max[k] = max[k].max(p[k]);
                        }
                    }
                    any = true;
                }
                for l in buffer.lines.chunks(3) {
                    let p =
                        entity
                            .transform
                            .transform_point([l[0] as f64, l[1] as f64, l[2] as f64]);
                    for k in 0..3 {
                        min[k] = min[k].min(p[k]);
                        max[k] = max[k].max(p[k]);
                    }
                    any = true;
                }
            }
        }
        if any { Some([min, max]) } else { None }
    }
}

/// Raycast: entities' meshes must already be materialized for raycasting.
pub fn materialize_meshes(doc: &mut Document) {
    let ids: Vec<EntityId> = doc.entities.keys().copied().collect();
    for id in ids {
        let _ = doc.mesh(&id);
    }
}

/// Small helper for comparing hit distances.
fn dist_mut(hit: &RayHit) -> f64 {
    hit.distance
}

/// Entity snapshot for the frontend (with mesh arrays).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneEntity {
    #[serde(flatten)]
    pub data: EntityData,
    pub tri_positions: Option<Vec<f32>>,
    pub tri_normals: Option<Vec<f32>>,
    /// Per-triangle face group ids parallel to `tri_positions` (3 entries per
    /// face). Sent only for triangulated kinds; used for face picking.
    pub tri_face_ids: Option<Vec<u32>>,
    pub lines: Option<Vec<f32>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LayerData {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: [f32; 4],
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SceneData {
    pub version: u64,
    pub name: String,
    pub modified: bool,
    pub path: Option<String>,
    pub units: Units,
    pub project_mode: ProjectMode,
    pub levels: Vec<LevelData>,
    pub active_level: Option<String>,
    pub grids: Vec<GridData>,
    pub active_layer: String,
    pub entities: Vec<SceneEntity>,
    pub layers: Vec<LayerData>,
    pub selection: Vec<String>,
    pub primary: Option<String>,
    pub can_undo: bool,
    pub can_redo: bool,
    pub undo_label: Option<String>,
    pub redo_label: Option<String>,
    pub history_len: usize,
    pub history_pos: usize,
}

impl Document {
    /// Build a full snapshot for the frontend.
    pub fn scene_data(&self) -> SceneData {
        let mut entities = Vec::with_capacity(self.entities.len());
        for entity in self.entities.values() {
            let buffer = self.mesh_cache.get(&entity.id);
            let (tri_positions, tri_normals, tri_face_ids, lines) = match buffer {
                Some(b) => (
                    if entity.kind.has_triangles() {
                        Some(b.positions.clone())
                    } else {
                        None
                    },
                    if entity.kind.has_triangles() {
                        Some(b.normals.clone())
                    } else {
                        None
                    },
                    if entity.kind.has_triangles() {
                        Some(b.tri_face_ids.clone())
                    } else {
                        None
                    },
                    if !b.lines.is_empty() {
                        Some(b.lines.clone())
                    } else {
                        None
                    },
                ),
                None => (None, None, None, None),
            };
            entities.push(SceneEntity {
                data: EntityData {
                    id: entity.id.as_string(),
                    name: entity.name.clone(),
                    kind: entity.kind.type_name().to_string(),
                    category: entity.kind.category(),
                    layer: entity.layer.as_string(),
                    visible: entity.visible,
                    locked: entity.locked,
                    color: entity.color.map(|c| [c.r, c.g, c.b, c.a]),
                    transform: entity.transform,
                    geometry: entity.kind.clone(),
                    material: entity.material.clone(),
                },
                tri_positions,
                tri_normals,
                tri_face_ids,
                lines,
            });
        }
        let layers = self
            .layers
            .iter()
            .map(|l| LayerData {
                id: l.id.as_string(),
                name: l.name.clone(),
                visible: l.visible,
                locked: l.locked,
                color: [l.color.r, l.color.g, l.color.b, l.color.a],
            })
            .collect();
        SceneData {
            version: self.scene_version,
            name: self.name.clone(),
            modified: self.modified,
            path: self.path.clone(),
            units: self.units.clone(),
            project_mode: self.project_mode,
            levels: self.levels.clone(),
            active_level: self.active_level.clone(),
            grids: self.grids.clone(),
            active_layer: self.active_layer.as_string(),
            entities,
            layers,
            selection: self.selection.iter().map(|i| i.as_string()).collect(),
            primary: self.primary.map(|i| i.as_string()),
            can_undo: self.can_undo(),
            can_redo: self.can_redo(),
            undo_label: self.history.undo_label().map(|s| s.to_string()),
            redo_label: self.history.redo_label().map(|s| s.to_string()),
            history_len: self.history.len(),
            history_pos: self.history.position(),
        }
    }

    pub fn save_string(&self) -> Result<String, String> {
        serde_json::to_string(&self.to_data()).map_err(|e| e.to_string())
    }

    pub fn from_json(json: &str) -> Result<Self, String> {
        let data: DocumentData = serde_json::from_str(json).map_err(|e| e.to_string())?;
        Ok(Self::from_data(data))
    }
}
