//! cgmath <-> plain-array conversions used at the truck boundary, plus
//! the polygon-mesh -> `MeshBuffer` copy routines.

use cgmath::prelude::*;
use truck_meshalgo::tessellation::RobustMeshableShape;
use truck_polymesh::PolygonMesh;

/// `[x, y, z]` -> cgmath point.
pub fn arr_to_pt(a: [f64; 3]) -> cgmath::Point3<f64> {
    cgmath::Point3::new(a[0], a[1], a[2])
}

/// cgmath point -> `[x, y, z]`.
pub fn pt_to_arr(p: cgmath::Point3<f64>) -> [f64; 3] {
    [p.x, p.y, p.z]
}

/// cgmath vector -> `[x, y, z]`.
#[allow(dead_code)]
pub fn vec_to_arr(v: cgmath::Vector3<f64>) -> [f64; 3] {
    [v.x, v.y, v.z]
}

/// Build a cgmath transform equivalent to `crate::core::Transform`
/// (position + unit quaternion rotation + scale).
pub fn transform_to_cg_matrix(t: &crate::core::Transform) -> cgmath::Matrix4<f64> {
    let q = cgmath::Quaternion::new(t.rotation[3], t.rotation[0], t.rotation[1], t.rotation[2]);
    let r = cgmath::Matrix4::from(q);
    let s = cgmath::Matrix4::from_nonuniform_scale(t.scale[0], t.scale[1], t.scale[2]);
    cgmath::Matrix4::from_translation(arr_to_pt(t.position).to_vec()) * r * s
}

/// Copy one polygon mesh into `mb`, tagging every triangle `face_id`.
fn append_polygon(mb: &mut crate::core::mesh::MeshBuilder, mesh: &PolygonMesh, face_id: u32) {
    let positions = mesh.positions();
    for pts in mesh.faces().tri_faces().iter().map(|f| vertex_points(positions, f)) {
        push_fan(mb, &pts, face_id);
    }
    for pts in mesh.faces().quad_faces().iter().map(|f| vertex_points(positions, f)) {
        push_fan(mb, &pts, face_id);
    }
    for pts in mesh.faces().other_faces().iter().map(|f| vertex_points(positions, f)) {
        push_fan(mb, &pts, face_id);
    }
}

fn vertex_points(
    positions: &[cgmath::Point3<f64>],
    face: &[truck_polymesh::StandardVertex],
) -> Vec<[f64; 3]> {
    face.iter().map(|v| pt_to_arr(positions[v.pos])).collect()
}

fn push_fan(mb: &mut crate::core::mesh::MeshBuilder, pts: &[[f64; 3]], face_id: u32) {
    if pts.len() < 3 {
        return;
    }
    for t in 1..pts.len() - 1 {
        let tri = [pts[0], pts[t], pts[t + 1]];
        mb.push_tri(tri[0], tri[1], tri[2], tri_normal(&tri), face_id);
    }
}

/// Geometric normal from three vertices (used for facing, not interpolation).
fn tri_normal(pts: &[[f64; 3]]) -> [f64; 3] {
    let (a, b, c) = (pts[0], pts[1], pts[2]);
    let u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
    ];
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if len < 1e-12 {
        [0.0, 0.0, 0.0]
    } else {
        [n[0] / len, n[1] / len, n[2] / len]
    }
}

/// Tessellate a solid B-rep face-by-face, tagging each triangulated group with
/// the B-rep face's index so the frontend can pick individual faces.
pub fn solid_to_buffer(solid: &truck_modeling::Solid, tol: f64) -> crate::core::mesh::MeshBuffer {
    let mut mb = crate::core::mesh::MeshBuilder::new();
    let mut face_id: u32 = 0;
    for shell in solid.boundaries() {
        for face in shell.face_iter() {
            let single: truck_modeling::Shell = std::iter::once(face.clone()).collect();
            let tessellated = single.robust_triangulation(tol);
            for tess_face in tessellated.face_iter() {
                if let Some(polygon) = tess_face.surface() {
                    append_polygon(&mut mb, &polygon, face_id);
                }
            }
            face_id += 1;
        }
    }
    mb.into_buffer()
}

/// Convert a truck polygon mesh into a triangle-soup `MeshBuffer`.
///
/// Winding is preserved (truck tessellators emit outward faces); triangle
/// normals are recomputed from the geometry for stable shading. Face tags are
/// per polygon face — use [`solid_to_buffer`] for B-rep face identity.
#[allow(dead_code)]
pub fn polygon_to_buffer(mesh: &PolygonMesh) -> crate::core::mesh::MeshBuffer {
    let mut mb = crate::core::mesh::MeshBuilder::new();
    let mut next_face_id = 0u32;
    for pts in mesh.faces().tri_faces().iter().map(|f| vertex_points(mesh.positions(), f)) {
        push_fan(&mut mb, &pts, next_face_id);
        next_face_id += 1;
    }
    for pts in mesh.faces().quad_faces().iter().map(|f| vertex_points(mesh.positions(), f)) {
        push_fan(&mut mb, &pts, next_face_id);
        next_face_id += 1;
    }
    for pts in mesh.faces().other_faces().iter().map(|f| vertex_points(mesh.positions(), f)) {
        push_fan(&mut mb, &pts, next_face_id);
        next_face_id += 1;
    }
    mb.into_buffer()
}
