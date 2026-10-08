pub mod curve;
pub mod surface;
pub mod solid;
pub mod mesh;
pub mod builder;
pub mod primitives;
pub mod intersection;
pub mod boolean;
pub mod tessellation;
pub mod conversion;

use truck_geometry::*;
use truck_topology::*;
use truck_modeling::*;
use nalgebra::{Point3, Vector3, Matrix4};
use crate::conversion::*;

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

pub type Point3 = truck_geometry::Point3;
pub type Vector3 = truck_geometry::Vector3;
pub type Matrix4 = truck_geometry::Matrix4;
pub type Wire = truck_topology::Wire;
pub type Face = truck_topology::Face;
pub type Shell = truck_topology::Shell;
pub type Solid = truck_topology::Solid;
pub type Vertex = truck_topology::Vertex;
pub type Edge = truck_topology::Edge;
pub type PolygonMesh = truck_meshalgo::PolygonMesh;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
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
    fn bounding_box(&self) -> crate::BoundingBox;
    fn transform(&self) -> crate::Transform;
    fn set_transform(&mut self, transform: crate::Transform);
    fn apply_transform(&mut self, transform: crate::Transform);
    fn clone_box(&self) -> Box<dyn Geometry>;
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

    pub fn get_mut(&mut self, id: GeometryId) -> Option<&mut dyn Geometry> {
        self.geometries.get_mut(&id).map(|g| g.as_mut())
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