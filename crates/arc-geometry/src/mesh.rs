use truck_meshalgo::*;
use nalgebra::{Point3, Vector3, Matrix4};
use crate::{GeometryId, GeometryType, Geometry};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct MeshEntity {
    pub id: GeometryId,
    pub name: String,
    pub mesh: PolygonMesh,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
    pub render_data: Option<MeshRenderData>,
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
    pub color: [f32; 4],
}

impl MeshEntity {
    pub fn new(name: String, mesh: PolygonMesh) -> Self {
        let bounds = mesh.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
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

    pub fn from_solid(solid: &crate::SolidEntity, tolerance: f64) -> Self {
        let mesh = solid.solid.triangulation(tolerance).to_polygon();
        Self::new("Mesh".to_string(), mesh)
    }

    pub fn from_shell(shell: &crate::ShellEntity, tolerance: f64) -> Self {
        let mesh = shell.shell.triangulation(tolerance).to_polygon();
        Self::new("Mesh".to_string(), mesh)
    }

    pub fn from_face(face: &crate::FaceEntity, tolerance: f64) -> Self {
        let mesh = face.face.triangulation(tolerance).to_polygon();
        Self::new("Mesh".to_string(), mesh)
    }

    pub fn box_mesh(min: Point3, max: Point3, subdivisions: (u32, u32, u32)) -> Self {
        let mesh = truck_meshalgo::mesher::box_mesh(
            truck_geometry::Point3::new(min.x, min.y, min.z),
            truck_geometry::Point3::new(max.x, max.y, max.z),
            subdivisions.0,
            subdivisions.1,
            subdivisions.2,
        );
        Self::new("Box Mesh".to_string(), mesh)
    }

    pub fn sphere_mesh(center: Point3, radius: f64, u_div: u32, v_div: u32) -> Self {
        let mesh = truck_meshalgo::mesher::sphere_mesh(
            truck_geometry::Point3::new(center.x, center.y, center.z),
            radius,
            u_div,
            v_div,
        );
        Self::new("Sphere Mesh".to_string(), mesh)
    }

    pub fn cylinder_mesh(origin: Point3, axis: Vector3, radius: f64, height: f64, radial_div: u32, height_div: u32) -> Self {
        let mesh = truck_meshalgo::mesher::cylinder_mesh(
            truck_geometry::Point3::new(origin.x, origin.y, origin.z),
            truck_geometry::Vector3::new(axis.x, axis.y, axis.z),
            radius,
            height,
            radial_div,
            height_div,
        );
        Self::new("Cylinder Mesh".to_string(), mesh)
    }

    pub fn plane_mesh(origin: Point3, x_axis: Vector3, y_axis: Vector3, width: f64, height: f64, u_div: u32, v_div: u32) -> Self {
        let mesh = truck_meshalgo::mesher::plane_mesh(
            truck_geometry::Point3::new(origin.x, origin.y, origin.z),
            truck_geometry::Vector3::new(x_axis.x, x_axis.y, x_axis.z),
            truck_geometry::Vector3::new(y_axis.x, y_axis.y, y_axis.z),
            width,
            height,
            u_div,
            v_div,
        );
        Self::new("Plane Mesh".to_string(), mesh)
    }

    pub fn vertex_count(&self) -> usize {
        self.mesh.vertex_count()
    }

    pub fn face_count(&self) -> usize {
        self.mesh.face_count()
    }

    pub fn has_normals(&self) -> bool {
        self.mesh.has_normals()
    }

    pub fn has_uvs(&self) -> bool {
        self.mesh.has_uvs()
    }

    pub fn compute_normals(&mut self) {
        self.mesh.compute_normals();
        self.render_data = None;
    }

    pub fn compute_uvs(&mut self) {
        self.mesh.compute_uvs();
        self.render_data = None;
    }

    pub fn merge(&mut self, other: &MeshEntity) {
        self.mesh.merge(&other.mesh);
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn subdivide(&mut self, levels: u32) {
        for _ in 0..levels {
            self.mesh.subdivide();
        }
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn simplify(&mut self, target_faces: usize) {
        self.mesh.simplify(target_faces);
        self.update_bounding_box();
        self.render_data = None;
    }

    pub fn to_obj(&self) -> String {
        let mut output = String::new();
        for v in self.mesh.vertices() {
            output.push_str(&format!("v {} {} {}\n", v.x, v.y, v.z));
        }
        if self.mesh.has_normals() {
            for n in self.mesh.normals() {
                output.push_str(&format!("vn {} {} {}\n", n.x, n.y, n.z));
            }
        }
        if self.mesh.has_uvs() {
            for uv in self.mesh.uvs() {
                output.push_str(&format!("vt {} {}\n", uv.x, uv.y));
            }
        }
        for face in self.mesh.faces() {
            output.push_str("f");
            for (i, v) in face.vertices().iter().enumerate() {
                output.push_str(&format!(" {}/{}/{}", v + 1, v + 1, v + 1));
            }
            output.push_str("\n");
        }
        output
    }

    pub fn build_render_data(&mut self) {
        let mut vertices = Vec::with_capacity(self.mesh.vertex_count());
        let mut indices = Vec::new();

        let positions = self.mesh.vertices();
        let normals = if self.mesh.has_normals() { self.mesh.normals() } else { &[] };
        let uvs = if self.mesh.has_uvs() { self.mesh.uvs() } else { &[] };

        for (i, pos) in positions.iter().enumerate() {
            let normal = if i < normals.len() { normals[i] } else { Vector3::new(0.0, 0.0, 1.0) };
            let uv = if i < uvs.len() { uvs[i] } else { Point3::new(0.0, 0.0, 0.0) };
            
            vertices.push(MeshVertex {
                position: [pos.x as f32, pos.y as f32, pos.z as f32],
                normal: [normal.x as f32, normal.y as f32, normal.z as f32],
                uv: [uv.x as f32, uv.y as f32],
                color: [1.0, 1.0, 1.0, 1.0],
            });
        }

        for face in self.mesh.faces() {
            let verts: Vec<_> = face.vertices().collect();
            for i in 1..verts.len() - 1 {
                indices.push(verts[0] as u32);
                indices.push(verts[i] as u32);
                indices.push(verts[i + 1] as u32);
            }
        }

        let mut bounds_min = [f32::INFINITY; 3];
        let mut bounds_max = [f32::NEG_INFINITY; 3];
        for v in &vertices {
            for j in 0..3 {
                bounds_min[j] = bounds_min[j].min(v.position[j]);
                bounds_max[j] = bounds_max[j].max(v.position[j]);
            }
        }

        self.render_data = Some(MeshRenderData {
            vertex_buffer: vertices,
            index_buffer: indices,
            bounds_min,
            bounds_max,
        });
    }

    pub fn render_data(&mut self) -> &MeshRenderData {
        if self.render_data.is_none() {
            self.build_render_data();
        }
        self.render_data.as_ref().unwrap()
    }
}

impl Geometry for MeshEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Mesh
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
        let new_mesh = self.mesh.transformed(&matrix);
        self.mesh = new_mesh;
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
        self.render_data = None;
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl MeshEntity {
    fn update_bounding_box(&mut self) {
        let bounds = self.mesh.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type MeshRef = Arc<RwLock<MeshEntity>>;