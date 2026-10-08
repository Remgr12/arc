use std::any::Any;
use std::fmt::Debug;
use std::sync::Arc;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3, UnitQuaternion, Matrix4};
use parking_lot::RwLock;
use dashmap::DashMap;
use crate::{EntityId, EntityType, EntityCategory, BoundingBox, Color};

pub trait Entity: Send + Sync + Debug + Any {
    fn id(&self) -> EntityId;
    fn entity_type(&self) -> EntityType;
    fn name(&self) -> &str;
    fn set_name(&mut self, name: String);
    fn visible(&self) -> bool;
    fn set_visible(&mut self, visible: bool);
    fn locked(&self) -> bool;
    fn set_locked(&mut self, locked: bool);
    fn color(&self) -> Option<Color>;
    fn set_color(&mut self, color: Option<Color>);
    fn layer_id(&self) -> EntityId;
    fn set_layer_id(&mut self, layer_id: EntityId);
    fn transform(&self) -> Transform;
    fn set_transform(&mut self, transform: Transform);
    fn bounding_box(&self) -> BoundingBox;
    fn update_bounding_box(&mut self);
    fn as_any(&self) -> &dyn Any;
    fn as_any_mut(&mut self) -> &mut dyn Any;
    fn clone_box(&self) -> Box<dyn Entity>;
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseEntity {
    pub id: EntityId,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<Color>,
    pub layer_id: EntityId,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub metadata: Metadata,
}

impl Default for BaseEntity {
    fn default() -> Self {
        Self {
            id: EntityId::new(),
            name: String::new(),
            visible: true,
            locked: false,
            color: None,
            layer_id: EntityId::nil(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            metadata: Metadata::default(),
        }
    }
}

impl BaseEntity {
    pub fn new(entity_type: EntityType) -> Self {
        let mut base = Self::default();
        base.name = format!("{:?}_{}", entity_type, Uuid::new_v4().to_string()[..8].to_string());
        base
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Metadata {
    pub tags: Vec<String>,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
    pub description: String,
}

impl Metadata {
    pub fn get<T: for<'de> Deserialize<'de>>(&self, key: &str) -> Option<T> {
        self.properties.get(key).and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    pub fn set<T: Serialize>(&mut self, key: &str, value: T) {
        if let Ok(val) = serde_json::to_value(value) {
            self.properties.insert(key.to_string(), val);
        }
    }

    pub fn has_tag(&self, tag: &str) -> bool {
        self.tags.iter().any(|t| t == tag)
    }

    pub fn add_tag(&mut self, tag: String) {
        if !self.tags.iter().any(|t| t == &tag) {
            self.tags.push(tag);
        }
    }

    pub fn remove_tag(&mut self, tag: &str) {
        self.tags.retain(|t| t != tag);
    }
}

pub type EntityRef = Arc<RwLock<dyn Entity>>;

#[derive(Debug)]
pub struct EntityContainer {
    entities: DashMap<EntityId, EntityRef>,
    by_type: DashMap<EntityType, Vec<EntityId>>,
    by_layer: DashMap<EntityId, Vec<EntityId>>,
}

impl EntityContainer {
    pub fn new() -> Self {
        Self {
            entities: DashMap::new(),
            by_type: DashMap::new(),
            by_layer: DashMap::new(),
        }
    }

    pub fn add(&self, entity: EntityRef) {
        let id = entity.read().id();
        let entity_type = entity.read().entity_type();
        let layer_id = entity.read().layer_id();

        self.entities.insert(id, entity);
        self.by_type.entry(entity_type).or_default().push(id);
        self.by_layer.entry(layer_id).or_default().push(id);
    }

    pub fn remove(&self, id: EntityId) -> Option<EntityRef> {
        if let Some((_, entity)) = self.entities.remove(&id) {
            let entity_type = entity.read().entity_type();
            let layer_id = entity.read().layer_id();

            if let Some(mut vec) = self.by_type.get_mut(&entity_type) {
                vec.retain(|eid| *eid != id);
            }
            if let Some(mut vec) = self.by_layer.get_mut(&layer_id) {
                vec.retain(|eid| *eid != id);
            }
            Some(entity)
        } else {
            None
        }
    }

    pub fn get(&self, id: EntityId) -> Option<EntityRef> {
        self.entities.get(&id).map(|e| e.clone())
    }

    pub fn get_by_type(&self, entity_type: EntityType) -> Vec<EntityRef> {
        self.by_type.get(&entity_type)
            .map(|ids| ids.iter().filter_map(|id| self.entities.get(id).map(|e| e.clone())).collect())
            .unwrap_or_default()
    }

    pub fn get_by_layer(&self, layer_id: EntityId) -> Vec<EntityRef> {
        self.by_layer.get(&layer_id)
            .map(|ids| ids.iter().filter_map(|id| self.entities.get(id).map(|e| e.clone())).collect())
            .unwrap_or_default()
    }

    pub fn all(&self) -> Vec<EntityRef> {
        self.entities.iter().map(|e| e.clone()).collect()
    }

    pub fn count(&self) -> usize {
        self.entities.len()
    }

    pub fn iter(&self) -> impl Iterator<Item = EntityRef> + '_ {
        self.entities.iter().map(|e| e.clone())
    }
}

impl Default for EntityContainer {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub translation: Vector3<f64>,
    pub rotation: UnitQuaternion<f64>,
    pub scale: Vector3<f64>,
}

impl Transform {
    pub fn identity() -> Self {
        Self {
            translation: Vector3::zeros(),
            rotation: UnitQuaternion::identity(),
            scale: Vector3::new(1.0, 1.0, 1.0),
        }
    }

    pub fn from_translation(t: Vector3<f64>) -> Self {
        Self {
            translation: t,
            rotation: UnitQuaternion::identity(),
            scale: Vector3::new(1.0, 1.0, 1.0),
        }
    }

    pub fn from_rotation(r: UnitQuaternion<f64>) -> Self {
        Self {
            translation: Vector3::zeros(),
            rotation: r,
            scale: Vector3::new(1.0, 1.0, 1.0),
        }
    }

    pub fn from_scale(s: Vector3<f64>) -> Self {
        Self {
            translation: Vector3::zeros(),
            rotation: UnitQuaternion::identity(),
            scale: s,
        }
    }

    pub fn to_matrix(&self) -> Matrix4<f64> {
        Matrix4::new_nonuniform_scaling(&self.scale)
            * self.rotation.to_homogeneous()
            * Matrix4::new_translation(&self.translation)
    }

    pub fn inverse(&self) -> Self {
        let inv_scale = Vector3::new(
            1.0 / self.scale.x,
            1.0 / self.scale.y,
            1.0 / self.scale.z,
        );
        let inv_rot = self.rotation.inverse();
        let inv_trans = -(inv_rot * (self.translation.component_mul(&inv_scale)));
        
        Self {
            translation: inv_trans,
            rotation: inv_rot,
            scale: inv_scale,
        }
    }

    pub fn transform_point(&self, point: Point3<f64>) -> Point3<f64> {
        self.to_matrix().transform_point(&point)
    }

    pub fn transform_vector(&self, vector: Vector3<f64>) -> Vector3<f64> {
        self.rotation * (vector.component_mul(&self.scale))
    }

    pub fn mul(&self, other: &Transform) -> Transform {
        let matrix = self.to_matrix() * other.to_matrix();
        let rot_matrix: nalgebra::Matrix3<f64> = matrix.fixed_view::<3, 3>(0, 0).clone().try_into().unwrap();
        let rotation = UnitQuaternion::from_matrix(&rot_matrix);
        Transform {
            translation: Vector3::new(matrix[(3, 0)], matrix[(3, 1)], matrix[(3, 2)]),
            rotation,
            scale: Vector3::new(1.0, 1.0, 1.0),
        }
    }

    pub fn transform_bounding_box(&self, bbox: &crate::BoundingBox) -> crate::BoundingBox {
        let min = self.transform_point(bbox.min);
        let max = self.transform_point(bbox.max);
        crate::BoundingBox::new(
            Point3::new(min.x.min(max.x), min.y.min(max.y), min.z.min(max.z)),
            Point3::new(min.x.max(max.x), min.y.max(max.y), min.z.max(max.z)),
        )
    }

    pub fn from_matrix(matrix: nalgebra::Matrix4<f64>) -> Self {
        let rot_matrix: nalgebra::Matrix3<f64> = matrix.fixed_view::<3, 3>(0, 0).clone().try_into().unwrap();
        let rotation = UnitQuaternion::from_matrix(&rot_matrix);
        Transform {
            translation: Vector3::new(matrix[(3, 0)], matrix[(3, 1)], matrix[(3, 2)]),
            rotation,
            scale: Vector3::new(1.0, 1.0, 1.0),
        }
    }
}

impl Default for Transform {
    fn default() -> Self {
        Self::identity()
    }
}