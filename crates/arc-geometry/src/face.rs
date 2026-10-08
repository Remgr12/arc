use truck_modeling::*;
use truck_modeling::builder;
use std::result::Result;
use crate::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;
use crate::{GeometryId, GeometryType, Geometry, GeometryData, BoundingBox, Transform};
use crate::{CurveEntity, SurfaceEntity, SolidEntity, ShellEntity, MeshEntity, Polyline};

#[derive(Debug, Clone)]
pub struct FaceEntity {
    pub id: GeometryId,
    pub name: String,
    pub face: Face,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl FaceEntity {
    pub fn new(name: String, face: Face) -> Self {
        Self {
            id: GeometryId::new(),
            name,
            face,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
        }
    }

    pub fn from_surface(surface: &crate::SurfaceEntity, u_range: (f64, f64), v_range: (f64, f64)) -> Self {
        let wire = Wire::new();
        let face = builder::try_attach_plane(&[wire]).expect("Failed to create face from surface");
        Self::new("Face".to_string(), face)
    }

    pub fn surface(&self) -> Option<&crate::SurfaceEntity> {
        None
    }

    pub fn polygon_face(vertices: Vec<crate::Point3>) -> Self {
        let wire = crate::Polyline::from_points(vertices).to_wire();
        let face = builder::try_attach_plane(&[wire]).expect("Failed to create polygon face");
        Self::new("Polygon".to_string(), face)
    }

    pub fn u_range(&self) -> (f64, f64) {
        (0.0, 1.0)
    }

    pub fn v_range(&self) -> (f64, f64) {
        (0.0, 1.0)
    }
}

impl Geometry for FaceEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Face
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn bounding_box(&self) -> crate::BoundingBox {
        self.bounding_box
    }

    fn transform(&self) -> crate::Transform {
        self.transform
    }

    fn set_transform(&mut self, transform: crate::Transform) {
        self.transform = transform;
    }

    fn apply_transform(&mut self, transform: crate::Transform) {
        self.transform = self.transform.mul(&transform);
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Face,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
    }
}
