use truck_modeling::*;
use truck_modeling::builder;
use truck_modeling::cgmath::Point3 as TruckPoint3;
use truck_modeling::cgmath::Vector3 as TruckVector3;
use std::result::Result;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::{Point3, Vector3, GeometryId, GeometryType, Geometry, GeometryData, BoundingBox, Transform};
use crate::{CurveEntity, SurfaceEntity, FaceEntity, MeshEntity, Polyline};

#[derive(Debug, Clone)]
pub struct SolidEntity {
    pub id: GeometryId,
    pub name: String,
    pub solid: Solid,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl SolidEntity {
    pub fn new(name: String, solid: Solid) -> Self {
        Self {
            id: GeometryId::new(),
            name,
            solid,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
        }
    }

    pub fn box_solid(min: Point3, max: Point3) -> Self {
        let solid = Self::create_box(min, max);
        Self::new("Box".to_string(), solid)
    }

    pub fn box_centered(center: Point3, size: Vector3) -> Self {
        let half = size * 0.5;
        let min = center - half;
        let max = center + half;
        Self::box_solid(min, max)
    }

    pub fn create_box(min: Point3, max: Point3) -> Solid {
        let min_t = TruckPoint3::new(min.x, min.y, min.z);
        let max_t = TruckPoint3::new(max.x, max.y, max.z);
        let v1 = Vertex::new(min_t);
        let v2 = Vertex::new(TruckPoint3::new(max_t.x, min_t.y, min_t.z));
        let v3 = Vertex::new(TruckPoint3::new(max_t.x, max_t.y, min_t.z));
        let v4 = Vertex::new(TruckPoint3::new(min_t.x, max_t.y, min_t.z));
        let v5 = Vertex::new(TruckPoint3::new(min_t.x, min_t.y, max_t.z));
        let v6 = Vertex::new(TruckPoint3::new(max_t.x, min_t.y, max_t.z));
        let v7 = Vertex::new(max_t);
        let v8 = Vertex::new(TruckPoint3::new(min_t.x, max_t.y, max_t.z));
        
        let mut wire1 = Wire::new();
        wire1.push_back(builder::line(&v1, &v2));
        wire1.push_back(builder::line(&v2, &v3));
        wire1.push_back(builder::line(&v3, &v4));
        wire1.push_back(builder::line(&v4, &v1));
        
        let mut wire2 = Wire::new();
        wire2.push_back(builder::line(&v5, &v6));
        wire2.push_back(builder::line(&v6, &v7));
        wire2.push_back(builder::line(&v7, &v8));
        wire2.push_back(builder::line(&v8, &v5));
        
        let bottom = builder::try_attach_plane(&[wire1]).expect("Failed to create bottom face");
        let top = builder::try_attach_plane(&[wire2]).expect("Failed to create top face");
        
        Solid::new(vec![])
    }

    pub fn cylinder(_origin: Point3, _axis: Vector3, _radius: f64, _height: f64) -> Self {
        Self::new("Cylinder".to_string(), Solid::new(vec![]))
    }

    pub fn sphere(_center: Point3, _radius: f64) -> Self {
        Self::new("Sphere".to_string(), Solid::new(vec![]))
    }

    pub fn cone(_origin: Point3, _axis: Vector3, _radius: f64, _height: f64) -> Self {
        Self::new("Cone".to_string(), Solid::new(vec![]))
    }

    pub fn torus(_center: Point3, _axis: Vector3, _major_radius: f64, _minor_radius: f64) -> Self {
        Self::new("Torus".to_string(), Solid::new(vec![]))
    }

    pub fn extrude(face: &crate::FaceEntity, direction: Vector3, distance: f64) -> Self {
        let truck_dir = TruckVector3::new(direction.x, direction.y, direction.z);
        let solid = builder::tsweep(&face.face, truck_dir * distance);
        Self::new("Extrusion".to_string(), solid)
    }

    pub fn revolve(face: &crate::FaceEntity, axis_origin: Point3, axis_direction: Vector3, angle: f64) -> Self {
        let origin_t = TruckPoint3::new(axis_origin.x, axis_origin.y, axis_origin.z);
        let dir_t = TruckVector3::new(axis_direction.x, axis_direction.y, axis_direction.z);
        let solid = builder::rsweep(&face.face, origin_t, dir_t, Rad(angle));
        Self::new("Revolution".to_string(), solid)
    }

    pub fn loft(_profiles: &[crate::FaceEntity]) -> Result<Self, String> {
        Err("Loft not implemented".to_string())
    }

    pub fn sweep(_profile: &crate::FaceEntity, _path: &crate::CurveEntity) -> Result<Self, String> {
        Err("Sweep not implemented".to_string())
    }

    pub fn shell(&self, thickness: f64) -> Result<Self, String> {
        Err("Shell not supported by truck topology v0.6".to_string())
    }

    pub fn fillet(&self, _edges: &[Edge], _radius: f64) -> Result<Self, String> {
        Ok(self.clone())
    }

    pub fn chamfer(&self, _edges: &[Edge], _distance: f64) -> Result<Self, String> {
        Ok(self.clone())
    }

    pub fn faces(&self) -> Vec<Face> {
        self.solid.face_iter().cloned().collect()
    }

    pub fn edges(&self) -> Vec<Edge> {
        self.solid.edge_iter().collect()
    }

    pub fn vertices(&self) -> Vec<Vertex> {
        self.solid.vertex_iter().collect()
    }

    pub fn volume(&self) -> f64 {
        0.0
    }

    pub fn surface_area(&self) -> f64 {
        0.0
    }
}

impl Geometry for SolidEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Solid
    }

    fn bounding_box(&self) -> crate::BoundingBox {
        self.bounding_box
    }

    fn transform(&self) -> crate::Transform {
        self.transform
    }

    fn set_transform(&mut self, transform: crate::Transform) {
        self.transform = transform;
        self.update_bounding_box();
    }

    fn apply_transform(&mut self, transform: crate::Transform) {
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Solid,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
    }
}

impl SolidEntity {
    fn update_bounding_box(&mut self) {
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type SolidRef = Arc<RwLock<SolidEntity>>;

#[derive(Debug, Clone)]
pub struct ShellEntity {
    pub id: GeometryId,
    pub name: String,
    pub shell: Shell,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl ShellEntity {
    pub fn new(name: String, shell: Shell) -> Self {
        Self {
            id: GeometryId::new(),
            name,
            shell,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
        }
    }

    pub fn from_faces(faces: Vec<Face>) -> Self {
        let mut shell = Shell::new();
        for face in faces {
            shell.push(face);
        }
        Self::new("Shell".to_string(), shell)
    }

    pub fn from_solid(solid: &SolidEntity) -> Self {
        let shell = solid.solid.clone().into_boundaries().pop().expect("Solid has no boundary");
        Self::new("Shell".to_string(), shell)
    }

    pub fn add_face(&mut self, face: Face) {
        self.shell.push(face);
        self.update_bounding_box();
    }

    pub fn faces(&self) -> Vec<Face> {
        self.shell.face_iter().cloned().collect()
    }

    pub fn to_solid(&self) -> Option<SolidEntity> {
        Some(SolidEntity::new("Solid".to_string(), Solid::new(vec![self.shell.clone()])))
    }
}

impl Geometry for ShellEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Shell
    }

    fn bounding_box(&self) -> crate::BoundingBox {
        self.bounding_box
    }

    fn transform(&self) -> crate::Transform {
        self.transform
    }

    fn set_transform(&mut self, transform: crate::Transform) {
        self.transform = transform;
        self.update_bounding_box();
    }

    fn apply_transform(&mut self, transform: crate::Transform) {
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Shell,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
    }
}

impl ShellEntity {
    fn update_bounding_box(&mut self) {
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type ShellRef = Arc<RwLock<ShellEntity>>;