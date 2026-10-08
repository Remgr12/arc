use truck_topology::*;
use truck_modeling::*;
use nalgebra::{Point3, Vector3, Matrix4};
use crate::{GeometryId, GeometryType, Geometry};
use std::sync::Arc;
use parking_lot::RwLock;

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
        let bounds = solid.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        
        Self {
            id: GeometryId::new(),
            name,
            solid,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
        }
    }

    pub fn box_solid(min: Point3, max: Point3) -> Self {
        let solid = builder::cuboid(min, max);
        Self::new("Box".to_string(), solid)
    }

    pub fn cylinder(origin: Point3, axis: Vector3, radius: f64, height: f64) -> Self {
        let solid = builder::cylinder(origin, axis, radius, height);
        Self::new("Cylinder".to_string(), solid)
    }

    pub fn sphere(center: Point3, radius: f64) -> Self {
        let solid = builder::sphere(center, radius);
        Self::new("Sphere".to_string(), solid)
    }

    pub fn cone(origin: Point3, axis: Vector3, radius: f64, height: f64) -> Self {
        let solid = builder::cone(origin, axis, radius, height);
        Self::new("Cone".to_string(), solid)
    }

    pub fn torus(center: Point3, axis: Vector3, major_radius: f64, minor_radius: f64) -> Self {
        let solid = builder::torus(center, axis, major_radius, minor_radius);
        Self::new("Torus".to_string(), solid)
    }

    pub fn extrude(face: &crate::FaceEntity, direction: Vector3, distance: f64) -> Self {
        let solid = builder::tsweep(&face.face, direction * distance);
        Self::new("Extrusion".to_string(), solid)
    }

    pub fn revolve(face: &crate::FaceEntity, axis_origin: Point3, axis_direction: Vector3, angle: f64) -> Self {
        let solid = builder::rsweep(&face.face, axis_origin, axis_direction, Rad(angle));
        Self::new("Revolution".to_string(), solid)
    }

    pub fn loft(profiles: &[crate::FaceEntity]) -> Result<Self, String> {
        if profiles.len() < 2 {
            return Err("Loft requires at least 2 profiles".to_string());
        }
        let faces: Vec<&Face> = profiles.iter().map(|f| &f.face).collect();
        let solid = builder::loft(&faces).map_err(|e| format!("Loft failed: {:?}", e))?;
        Ok(Self::new("Loft".to_string(), solid))
    }

    pub fn sweep(profile: &crate::FaceEntity, path: &crate::CurveEntity) -> Result<Self, String> {
        let solid = builder::sweep(&profile.face, &path.curve).map_err(|e| format!("Sweep failed: {:?}", e))?;
        Ok(Self::new("Sweep".to_string(), solid))
    }

    pub fn shell(&self, thickness: f64) -> Result<Self, String> {
        let solid = self.solid.hollow(thickness).map_err(|e| format!("Shell failed: {:?}", e))?;
        Ok(Self::new("Shell".to_string(), solid))
    }

    pub fn fillet(&self, edges: &[Edge], radius: f64) -> Result<Self, String> {
        let solid = truck_fillet::fillet(&self.solid, edges, radius).map_err(|e| format!("Fillet failed: {:?}", e))?;
        Ok(Self::new("Fillet".to_string(), solid))
    }

    pub fn chamfer(&self, edges: &[Edge], distance: f64) -> Result<Self, String> {
        let solid = truck_fillet::chamfer(&self.solid, edges, distance).map_err(|e| format!("Chamfer failed: {:?}", e))?;
        Ok(Self::new("Chamfer".to_string(), solid))
    }

    pub fn faces(&self) -> Vec<&Face> {
        self.solid.face_iter().collect()
    }

    pub fn edges(&self) -> Vec<&Edge> {
        self.solid.edge_iter().collect()
    }

    pub fn vertices(&self) -> Vec<&Vertex> {
        self.solid.vertex_iter().collect()
    }

    pub fn volume(&self) -> f64 {
        self.solid.volume()
    }

    pub fn surface_area(&self) -> f64 {
        self.solid.face_iter().map(|f| f.area()).sum()
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
        let matrix = transform.to_matrix();
        let new_solid = self.solid.transformed(&matrix);
        self.solid = new_solid;
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl SolidEntity {
    fn update_bounding_box(&mut self) {
        let bounds = self.solid.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
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
        let bounds = shell.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        
        Self {
            id: GeometryId::new(),
            name,
            shell,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
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
        let shell = solid.solid.into_boundaries().pop().expect("Solid has no boundary");
        Self::new("Shell".to_string(), shell)
    }

    pub fn add_face(&mut self, face: Face) {
        self.shell.push(face);
        self.update_bounding_box();
    }

    pub fn faces(&self) -> Vec<&Face> {
        self.shell.face_iter().collect()
    }

    pub fn to_solid(&self) -> Option<SolidEntity> {
        if self.shell.is_closed() {
            Some(SolidEntity::new("Solid".to_string(), Solid::new(vec![self.shell.clone()])))
        } else {
            None
        }
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
        let matrix = transform.to_matrix();
        let new_shell = self.shell.transformed(&matrix);
        self.shell = new_shell;
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl ShellEntity {
    fn update_bounding_box(&mut self) {
        let bounds = self.shell.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type ShellRef = Arc<RwLock<ShellEntity>>;