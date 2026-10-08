use truck_meshalgo::*;
use truck_topology::*;
use nalgebra::{Point3, Vector3};
use crate::{SolidEntity, ShellEntity, FaceEntity, MeshEntity, CurveEntity, SurfaceEntity};

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
        let points: Vec<Point3> = (0..=segments)
            .map(|i| {
                let t = curve.parameter_range().0 + (curve.parameter_range().1 - curve.parameter_range().0) * (i as f64 / segments as f64);
                curve.evaluate(t)
            })
            .collect();
        
        let mut mesh = PolygonMesh::new();
        for (i, point) in points.iter().enumerate() {
            mesh.add_vertex(*point);
        }
        for i in 1..points.len() {
            mesh.add_line(i - 1, i);
        }
        
        MeshEntity::new("Curve Mesh".to_string(), mesh)
    }

    pub fn surface(surface: &SurfaceEntity, u_div: usize, v_div: usize) -> MeshEntity {
        let u_range = surface.u_range();
        let v_range = surface.v_range();
        
        let mut mesh = PolygonMesh::new();
        let mut indices = Vec::new();
        
        for i in 0..=u_div {
            let u = u_range.0 + (u_range.1 - u_range.0) * (i as f64 / u_div as f64);
            for j in 0..=v_div {
                let v = v_range.0 + (v_range.1 - v_range.0) * (j as f64 / v_div as f64);
                let point = surface.evaluate(u, v);
                mesh.add_vertex(point);
                indices.push(i * (v_div + 1) + j);
            }
        }
        
        for i in 0..u_div {
            for j in 0..v_div {
                let a = i * (v_div + 1) + j;
                let b = a + 1;
                let c = (i + 1) * (v_div + 1) + j;
                let d = c + 1;
                
                mesh.add_triangle(a, b, c);
                mesh.add_triangle(b, d, c);
            }
        }
        
        MeshEntity::new("Surface Mesh".to_string(), mesh)
    }

    pub fn adaptive_solid(solid: &SolidEntity, max_edge_length: f64, max_angle: f64) -> MeshEntity {
        let mesh = solid.solid.adaptive_triangulation(max_edge_length, max_angle).to_polygon();
        MeshEntity::new("Adaptive Mesh".to_string(), mesh)
    }

    pub fn adaptive_face(face: &FaceEntity, max_edge_length: f64, max_angle: f64) -> MeshEntity {
        let mesh = face.face.adaptive_triangulation(max_edge_length, max_angle).to_polygon();
        MeshEntity::new("Adaptive Face Mesh".to_string(), mesh)
    }

    pub fn with_normals(mesh: &mut MeshEntity) {
        mesh.compute_normals();
    }

    pub fn with_uvs(mesh: &mut MeshEntity) {
        mesh.compute_uvs();
    }

    pub fn smooth(mesh: &mut MeshEntity, iterations: usize, lambda: f64) {
        for _ in 0..iterations {
            mesh.mesh.smooth(lambda);
        }
        mesh.render_data = None;
    }

    pub fn subdivide(mesh: &mut MeshEntity, levels: u32) {
        mesh.subdivide(levels);
    }

    pub fn simplify(mesh: &mut MeshEntity, target_faces: usize) {
        mesh.simplify(target_faces);
    }

    pub fn remesh(mesh: &mut MeshEntity, target_edge_length: f64) {
        mesh.mesh.remesh(target_edge_length);
        mesh.update_bounding_box();
        mesh.render_data = None;
    }

    pub fn decimate(mesh: &mut MeshEntity, ratio: f64) {
        let target = (mesh.face_count() as f64 * ratio) as usize;
        mesh.simplify(target);
    }

    pub fn mesh_quality(mesh: &MeshEntity) -> MeshQuality {
        let mut quality = MeshQuality::default();
        
        for face in mesh.mesh.faces() {
            let verts: Vec<_> = face.vertices().map(|i| mesh.mesh.vertices()[i]).collect();
            if verts.len() >= 3 {
                let a = verts[0];
                let b = verts[1];
                let c = verts[2];
                
                let ab = b - a;
                let ac = c - a;
                let area = 0.5 * ab.cross(&ac).norm();
                
                quality.total_area += area;
                quality.face_count += 1;
                
                let edges = [ab.norm(), (c - b).norm(), (a - c).norm()];
                let max_edge = edges.iter().fold(0.0f64, |a, &b| a.max(b));
                let min_edge = edges.iter().fold(f64::INFINITY, |a, &b| a.min(b));
                
                if min_edge > 0.0 {
                    quality.max_aspect_ratio = quality.max_aspect_ratio.max(max_edge / min_edge);
                }
                
                quality.min_edge_length = quality.min_edge_length.min(min_edge);
                quality.max_edge_length = quality.max_edge_length.max(max_edge);
            }
        }
        
        if quality.face_count > 0 {
            quality.avg_edge_length = (quality.min_edge_length + quality.max_edge_length) * 0.5;
        }
        
        quality
    }

    pub fn edge_loops(mesh: &MeshEntity) -> Vec<Vec<usize>> {
        let mut loops = Vec::new();
        let mut visited = std::collections::HashSet::new();
        
        for face in mesh.mesh.faces() {
            let verts: Vec<_> = face.vertices().collect();
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
            for face in mesh.faces() {
                let verts: Vec<_> = face.vertices().collect();
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