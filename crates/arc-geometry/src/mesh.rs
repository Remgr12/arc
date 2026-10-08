use std::sync::Arc;
use parking_lot::RwLock;
use truck_polymesh::PolygonMesh;
use crate::{Point3, Vector3, Matrix4};
use crate::{GeometryId, GeometryType, Geometry, GeometryData, BoundingBox, Transform};
use crate::{SolidEntity, FaceEntity, ShellEntity, CurveEntity, SurfaceEntity, Polyline};
use bytemuck::Pod;

#[derive(Debug)]
pub struct MeshEntity {
    pub id: GeometryId,
    pub name: String,
    pub mesh: PolygonMesh,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
    pub render_data: Option<MeshRenderData>,
}

impl Clone for MeshEntity {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            name: self.name.clone(),
            mesh: self.mesh.clone(),
            transform: self.transform,
            bounding_box: self.bounding_box,
            render_data: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MeshRenderData {
    pub vertex_buffer: Vec<MeshVertex>,
    pub index_buffer: Vec<u32>,
    pub bounds_min: [f32; 3],
    pub bounds_max: [f32; 3],
}

#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
#[repr(C)]
pub struct MeshVertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
}
impl MeshEntity {
    pub fn new(name: String, mesh: PolygonMesh) -> Self {
        let bounds = mesh.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min().x, bounds.min().y, bounds.min().z),
            Point3::new(bounds.max().x, bounds.max().y, bounds.max().z),
        );
        
        Self {
            id: GeometryId::new(),
            name,
            mesh,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
            render_data: None,
        }
    }

    pub fn from_solid(_solid: &SolidEntity, _tolerance: f64) -> Self {
        Self::new("Mesh".to_string(), PolygonMesh::default())
    }

    pub fn from_shell(_shell: &ShellEntity, _tolerance: f64) -> Self {
        Self::new("Mesh".to_string(), PolygonMesh::default())
    }

    pub fn from_face(_face: &FaceEntity, _tolerance: f64) -> Self {
        Self::new("Mesh".to_string(), PolygonMesh::default())
    }

    pub fn box_mesh(min: Point3, max: Point3, _subdivisions: (u32, u32, u32)) -> Self {
        Self::new("Box Mesh".to_string(), PolygonMesh::default())
    }

    pub fn sphere_mesh(_center: Point3, _radius: f64, _u_div: u32, _v_div: u32) -> Self {
        Self::new("Sphere Mesh".to_string(), PolygonMesh::default())
    }

    pub fn cylinder_mesh(_origin: Point3, _axis: Vector3, _radius: f64, _height: f64, _radial_div: u32, _height_div: u32) -> Self {
        Self::new("Cylinder Mesh".to_string(), PolygonMesh::default())
    }

    pub fn plane_mesh(_origin: Point3, _x_axis: Vector3, _y_axis: Vector3, _width: f64, _height: f64, _u_div: u32, _v_div: u32) -> Self {
        Self::new("Plane Mesh".to_string(), PolygonMesh::default())
    }

    pub fn vertex_count(&self) -> usize {
        self.mesh.attributes().positions().len()
    }

    pub fn face_count(&self) -> usize {
        self.mesh.face_iter().count()
    }

    pub fn has_normals(&self) -> bool {
        !self.mesh.attributes().normals().is_empty()
    }

    pub fn has_uvs(&self) -> bool {
        !self.mesh.attributes().uv_coords().is_empty()
    }

    pub fn compute_normals(&mut self) {
        self.render_data = None;
    }

    pub fn compute_uvs(&mut self) {
        self.render_data = None;
    }

    pub fn merge(&mut self, other: &MeshEntity) {
        self.mesh.merge(other.mesh.clone());
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn subdivide(&mut self, _levels: u32) {
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn simplify(&mut self, _target_faces: usize) {
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn smooth(&mut self, _lambda: f64) {
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn remesh(&mut self, _target_edge_length: f64) {
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn compute_bounds(&self) -> crate::BoundingBox {
        self.bounding_box
    }

    pub fn update_bounding_box(&mut self) {
        let bounds = self.mesh.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min().x, bounds.min().y, bounds.min().z),
            Point3::new(bounds.max().x, bounds.max().y, bounds.max().z),
        );
    }

    pub fn to_triangles(&self) -> Vec<[Point3; 3]> {
        let mut triangles = Vec::new();
        let positions = self.mesh.attributes().positions();
        for face in self.mesh.face_iter() {
            let verts: Vec<Point3> = face.iter().map(|v| Point3::new(
                positions[v.pos].x,
                positions[v.pos].y,
                positions[v.pos].z,
            )).collect();
            if verts.len() >= 3 {
                for i in 1..(verts.len() - 1) {
                    triangles.push([verts[0], verts[i], verts[i + 1]]);
                }
            }
        }
        triangles
    }
}

impl Geometry for MeshEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Mesh
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

    fn apply_transform(&mut self, _transform: crate::Transform) {
        self.update_bounding_box();
        self.render_data = None;
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Mesh,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
    }
}

pub type MeshRef = Arc<RwLock<MeshEntity>>;
