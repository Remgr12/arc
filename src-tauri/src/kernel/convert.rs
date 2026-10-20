//! cgmath <-> plain-array conversions used at the truck boundary, plus
//! the polygon-mesh -> `MeshBuffer` copy routines.

use cgmath::prelude::*;
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

/// Convert a truck polygon mesh into a triangle-soup `MeshBuffer`.
///
/// Winding is preserved (truck tessellators emit outward faces); triangle
/// normals are recomputed from the geometry for stable shading.
pub fn polygon_to_buffer(mesh: &PolygonMesh) -> crate::core::MeshBuffer {
    let mut mb = crate::core::mesh::MeshBuilder::new();
    let positions = mesh.positions();
    let mut corners: Vec<std::vec::IntoIter<[f64; 3]>> = Vec::new();
    let mut groups: Vec<Vec<[f64; 3]>> = Vec::new();
    let _ = &mut corners;

    for tri in mesh.faces().tri_faces().iter() {
        groups.push(tri.iter().map(|v| pt_to_arr(positions[v.pos])).collect());
    }
    for quad in mesh.faces().quad_faces().iter() {
        groups.push(quad.iter().map(|v| pt_to_arr(positions[v.pos])).collect());
    }
    for other in mesh.faces().other_faces().iter() {
        groups.push(other.iter().map(|v| pt_to_arr(positions[v.pos])).collect());
    }
    for points in &groups {
        if points.len() < 3 {
            continue;
        }
        let a = points[0];
        for t in 1..points.len() - 1 {
            let b = points[t];
            let c = points[t + 1];
            let n = crate::core::mesh::tri_normal(a, b, c);
            mb.push_tri(a, b, c, n);
        }
    }
    mb.into_buffer()
}
