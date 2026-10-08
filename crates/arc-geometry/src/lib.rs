pub mod curve;
pub mod surface;
pub mod solid;
pub mod mesh;
pub mod builder;
pub mod face;
pub mod primitives;
pub mod intersection;
pub mod boolean;
pub mod tessellation;
pub mod conversion;

pub use face::*;
pub use curve::*;
pub use surface::*;
pub use solid::*;
pub use mesh::*;
pub use builder::*;
pub use primitives::*;
pub use intersection::*;
pub use boolean::*;
pub use tessellation::*;
pub use conversion::*;

pub use arc_core::{BoundingBox, Transform, Color, EntityId, EntityType, EntityCategory};
pub use truck_polymesh::PolygonMesh;

pub use nalgebra::UnitQuaternion;

pub type Point3 = nalgebra::Point3<f64>;
pub type Vector3 = nalgebra::Vector3<f64>;
pub type Matrix4 = nalgebra::Matrix4<f64>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub struct GeometryId(pub uuid::Uuid);

impl GeometryId {
    pub fn new() -> Self {
        Self(uuid::Uuid::new_v4())
    }
}

impl Default for GeometryId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct GeometryData {
    pub id: GeometryId,
    pub name: String,
    pub geometry_type: GeometryType,
    pub data: Vec<u8>,
    pub bounding_box: crate::BoundingBox,
    pub transform: crate::Transform,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
pub enum GeometryType {
    Curve,
    Surface,
    Solid,
    Mesh,
    Wire,
    Face,
    Shell,
    Vertex,
    Edge,
}

pub trait Geometry: Send + Sync + std::fmt::Debug {
    fn id(&self) -> GeometryId;
    fn geometry_type(&self) -> GeometryType;
    fn name(&self) -> &str;
    fn bounding_box(&self) -> crate::BoundingBox;
    fn transform(&self) -> crate::Transform;
    fn set_transform(&mut self, transform: crate::Transform);
    fn apply_transform(&mut self, transform: crate::Transform);
    fn clone_box(&self) -> Box<dyn Geometry>;
    fn as_data(&self) -> GeometryData;
}

pub struct GeometryContainer {
    geometries: std::collections::HashMap<GeometryId, Box<dyn Geometry>>,
    by_type: std::collections::HashMap<GeometryType, Vec<GeometryId>>,
}

impl GeometryContainer {
    pub fn new() -> Self {
        Self {
            geometries: std::collections::HashMap::new(),
            by_type: std::collections::HashMap::new(),
        }
    }

    pub fn add(&mut self, geometry: Box<dyn Geometry>) {
        let id = geometry.id();
        let gtype = geometry.geometry_type();
        self.geometries.insert(id, geometry);
        self.by_type.entry(gtype).or_default().push(id);
    }

    pub fn remove(&mut self, id: GeometryId) -> Option<Box<dyn Geometry>> {
        if let Some(geometry) = self.geometries.remove(&id) {
            let gtype = geometry.geometry_type();
            if let Some(vec) = self.by_type.get_mut(&gtype) {
                vec.retain(|gid| *gid != id);
            }
            Some(geometry)
        } else {
            None
        }
    }

    pub fn get(&self, id: GeometryId) -> Option<&dyn Geometry> {
        self.geometries.get(&id).map(|g| g.as_ref())
    }

    pub fn get_mut<'a>(&'a mut self, id: GeometryId) -> Option<&'a mut Box<dyn Geometry>> {
        self.geometries.get_mut(&id)
    }

    pub fn get_by_type(&self, gtype: GeometryType) -> Vec<GeometryId> {
        self.by_type.get(&gtype).cloned().unwrap_or_default()
    }

    pub fn all(&self) -> Vec<&dyn Geometry> {
        self.geometries.values().map(|g| g.as_ref()).collect()
    }

    pub fn count(&self) -> usize {
        self.geometries.len()
    }
}

impl Default for GeometryContainer {
    fn default() -> Self {
        Self::new()
    }
}