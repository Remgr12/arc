use truck_modeling::*;
use truck_modeling::builder;
use std::result::Result;
use crate::{Point3, Vector3};
use truck_polymesh::*;
use truck_modeling::Point3 as TruckPoint3;
use crate::{SolidEntity, FaceEntity, MeshEntity, CurveEntity, SurfaceEntity, ShellEntity};
use crate::{GeometryId, GeometryType, Geometry};

pub struct Tessellation;

impl Tessellation {
    pub fn solid(solid: &SolidEntity, tolerance: f64) -> MeshEntity {
        MeshEntity::from_solid(solid, tolerance)
    }

    pub fn shell(shell: &ShellEntity, tolerance: f64) -> MeshEntity {
        MeshEntity::from_shell(shell, tolerance)
    }

    pub fn face(face: &FaceEntity, tolerance: f64) -> MeshEntity {
        MeshEntity::from_face(face, tolerance)
    }

    pub fn curve(curve: &CurveEntity, segments: usize) -> MeshEntity {
        MeshEntity::new("Curve Mesh".to_string(), PolygonMesh::default())
    }

    pub fn surface(surface: &SurfaceEntity, u_div: usize, v_div: usize) -> MeshEntity {
        MeshEntity::new("Surface Mesh".to_string(), PolygonMesh::default())
    }

    pub fn adaptive_solid(_solid: &SolidEntity, _max_edge_length: f64, _max_angle: f64) -> MeshEntity {
        MeshEntity::new("Adaptive Mesh".to_string(), PolygonMesh::default())
    }

    pub fn adaptive_face(_face: &FaceEntity, _max_edge_length: f64, _max_angle: f64) -> MeshEntity {
        MeshEntity::new("Adaptive Face Mesh".to_string(), PolygonMesh::default())
    }

    pub fn with_normals(mesh: &mut MeshEntity) {
        mesh.compute_normals();
    }

    pub fn with_uvs(mesh: &mut MeshEntity) {
        mesh.compute_uvs();
    }

    pub fn smooth(mesh: &mut MeshEntity, iterations: usize, _lambda: f64) {
        for _ in 0..iterations {
        }
        mesh.render_data = None;
    }

    pub fn subdivide(mesh: &mut MeshEntity, levels: u32) {
        mesh.subdivide(levels);
    }

    pub fn simplify(mesh: &mut MeshEntity, target_faces: usize) {
        mesh.simplify(target_faces);
    }

    pub fn remesh(mesh: &mut MeshEntity, _target_edge_length: f64) {
        mesh.update_bounding_box();
        mesh.render_data = None;
    }

    pub fn decimate(mesh: &mut MeshEntity, ratio: f64) {
        let target = (mesh.face_count() as f64 * ratio) as usize;
        mesh.simplify(target);
    }

    pub fn mesh_quality(mesh: &MeshEntity) -> MeshQuality {
        let mut quality = MeshQuality::default();
        
        quality
    }

    pub fn edge_loops(mesh: &MeshEntity) -> Vec<Vec<usize>> {
        let mut loops = Vec::new();
        let mut visited = std::collections::HashSet::new();
        
        for face in mesh.mesh.face_iter() {
            let verts: Vec<_> = face.iter().map(|v| v.pos).collect();
            for i in 0..verts.len() {
                let edge = (verts[i], verts[(i + 1) % verts.len()]);
                if !visited.contains(&edge) && !visited.contains(&(edge.1, edge.0)) {
                    if let Some(loop_) = Self::trace_edge_loop(&mesh.mesh, edge, &mut visited) {
                        if loop_.len() > 2 {
                            loops.push(loop_);
                        }
                    }
                }
            }
        }
        
        loops
    }

    fn trace_edge_loop(mesh: &PolygonMesh, start_edge: (usize, usize), visited: &mut std::collections::HashSet<(usize, usize)>) -> Option<Vec<usize>> {
        let mut loop_ = vec![start_edge.0];
        let mut current = start_edge.1;
        let start = start_edge.0;
        
        visited.insert(start_edge);
        visited.insert((start_edge.1, start_edge.0));
        
        while current != start {
            loop_.push(current);
            
            let mut next = None;
            for face in mesh.face_iter() {
                let verts: Vec<_> = face.iter().map(|v| v.pos).collect();
                for i in 0..verts.len() {
                    let v0 = verts[i];
                    let v1 = verts[(i + 1) % verts.len()];
                    if v0 == current && !visited.contains(&(v0, v1)) {
                        next = Some(v1);
                        break;
                    }
                }
                if next.is_some() { break; }
            }
            
            if let Some(n) = next {
                visited.insert((current, n));
                visited.insert((n, current));
                current = n;
            } else {
                return None;
            }
        }
        
        Some(loop_)
    }
}

#[derive(Debug, Default)]
pub struct MeshQuality {
    pub face_count: usize,
    pub total_area: f64,
    pub min_edge_length: f64,
    pub max_edge_length: f64,
    pub avg_edge_length: f64,
    pub max_aspect_ratio: f64,
}

impl MeshQuality {
    pub fn is_good(&self) -> bool {
        self.max_aspect_ratio < 10.0 && self.min_edge_length > 1e-6
    }
}

pub struct TessellationSettings {
    pub tolerance: f64,
    pub max_edge_length: f64,
    pub max_angle: f64,
    pub adaptive: bool,
    pub compute_normals: bool,
    pub compute_uvs: bool,
}

impl Default for TessellationSettings {
    fn default() -> Self {
        Self {
            tolerance: 0.01,
            max_edge_length: 10.0,
            max_angle: 15.0_f64.to_radians(),
            adaptive: true,
            compute_normals: true,
            compute_uvs: false,
        }
    }
}

impl TessellationSettings {
    pub fn high_quality() -> Self {
        Self {
            tolerance: 0.001,
            max_edge_length: 5.0,
            max_angle: 5.0_f64.to_radians(),
            adaptive: true,
            compute_normals: true,
            compute_uvs: true,
        }
    }

    pub fn low_quality() -> Self {
        Self {
            tolerance: 0.1,
            max_edge_length: 50.0,
            max_angle: 30.0_f64.to_radians(),
            adaptive: false,
            compute_normals: true,
            compute_uvs: false,
        }
    }

    pub fn realtime() -> Self {
        Self {
            tolerance: 0.05,
            max_edge_length: 20.0,
            max_angle: 20.0_f64.to_radians(),
            adaptive: false,
            compute_normals: true,
            compute_uvs: false,
        }
    }
}