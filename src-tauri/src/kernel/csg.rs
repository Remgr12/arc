//! B-rep booleans on payload-produced solids, via `truck-shapeops`.
//!
//! Operations are exact NURBS booleans restricted to transversal
//! intersections (tangential faces are not supported by upstream).
//! Boolean payloads whose children cannot be represented as truck
//! solids error out clearly.

use std::panic::{AssertUnwindSafe, catch_unwind};
use truck_modeling::Solid;
use truck_shapeops;

use crate::core::entity::CsgOperation;

/// Tolerances tried in order during CSG boolean evaluation.
/// Practical CAD models often have boundary cuts or micro-features where a single
/// tight tolerance like 0.001 fails, but 0.02 or 0.05 resolves cleanly.
pub const ADAPTIVE_TOLERANCES: &[f64] = &[0.05, 0.02, 0.1];

/// Compute the centroid of a Solid by averaging its boundary vertices.
pub fn solid_centroid(s: &Solid) -> [f64; 3] {
    let mut sum = [0.0, 0.0, 0.0];
    let mut count = 0;
    for shell in s.boundaries() {
        for v in shell.vertex_iter() {
            let p = v.point();
            sum[0] += p.x;
            sum[1] += p.y;
            sum[2] += p.z;
            count += 1;
        }
    }
    if count == 0 {
        [0.0, 0.0, 0.0]
    } else {
        [sum[0] / count as f64, sum[1] / count as f64, sum[2] / count as f64]
    }
}

/// Compute axis-aligned bounding box `([min_x, min_y, min_z], [max_x, max_y, max_z])`.
pub fn solid_aabb(s: &Solid) -> ([f64; 3], [f64; 3]) {
    let mut min = [f64::INFINITY; 3];
    let mut max = [f64::NEG_INFINITY; 3];
    for shell in s.boundaries() {
        for v in shell.vertex_iter() {
            let p = v.point();
            min[0] = min[0].min(p.x);
            min[1] = min[1].min(p.y);
            min[2] = min[2].min(p.z);
            max[0] = max[0].max(p.x);
            max[1] = max[1].max(p.y);
            max[2] = max[2].max(p.z);
        }
    }
    (min, max)
}

/// Check if point is inside a closed mesh using ray casting (Möller–Trumbore).
fn point_in_mesh(p: [f64; 3], mesh: &crate::core::mesh::MeshBuffer) -> bool {
    let (ox, oy, oz) = (p[0], p[1], p[2]);
    // Perturb ray slightly to avoid hitting edges/vertices exactly
    let (dx, dy, dz) = (1.0, 0.000137, 0.000089);
    let mut hits = 0;

    for chunk in mesh.positions.chunks_exact(9) {
        let v0 = [chunk[0] as f64, chunk[1] as f64, chunk[2] as f64];
        let v1 = [chunk[3] as f64, chunk[4] as f64, chunk[5] as f64];
        let v2 = [chunk[6] as f64, chunk[7] as f64, chunk[8] as f64];

        let e1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        let e2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

        let h = [
            dy * e2[2] - dz * e2[1],
            dz * e2[0] - dx * e2[2],
            dx * e2[1] - dy * e2[0],
        ];
        let a = e1[0] * h[0] + e1[1] * h[1] + e1[2] * h[2];
        if a.abs() < 1e-9 {
            continue;
        }
        let f = 1.0 / a;
        let s = [ox - v0[0], oy - v0[1], oz - v0[2]];
        let u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
        if !(0.0..=1.0).contains(&u) {
            continue;
        }
        let q = [
            s[1] * e1[2] - s[2] * e1[1],
            s[2] * e1[0] - s[0] * e1[2],
            s[0] * e1[1] - s[1] * e1[0],
        ];
        let v = f * (dx * q[0] + dy * q[1] + dz * q[2]);
        if v < 0.0 || u + v > 1.0 {
            continue;
        }
        let t = f * (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]);
        if t > 1e-7 {
            hits += 1;
        }
    }
    hits % 2 == 1
}

/// Check if point is inside a Solid.
pub fn is_point_inside_solid(pt: [f64; 3], s: &Solid) -> bool {
    let (min, max) = solid_aabb(s);
    if pt[0] < min[0] - 1e-4
        || pt[0] > max[0] + 1e-4
        || pt[1] < min[1] - 1e-4
        || pt[1] > max[1] + 1e-4
        || pt[2] < min[2] - 1e-4
        || pt[2] > max[2] + 1e-4
    {
        return false;
    }
    let mesh = crate::kernel::convert::solid_to_buffer(s, 0.05);
    point_in_mesh(pt, &mesh)
}

/// Boolean operation on two solids (both in local payload space).
pub fn boolean(op: CsgOperation, a: &Solid, b: &Solid) -> Result<Solid, String> {
    match op {
        CsgOperation::Union => union(a, b),
        CsgOperation::Difference => difference(a, b),
        CsgOperation::Intersection => intersection(a, b),
    }
}

/// Boolean union via `truck_shapeops::or` with adaptive tolerance search and disjoint/containment fallbacks.
pub fn union(a: &Solid, b: &Solid) -> Result<Solid, String> {
    let (a_min, a_max) = solid_aabb(a);
    let (b_min, b_max) = solid_aabb(b);
    let disjoint_aabbs = a_max[0] < b_min[0]
        || b_max[0] < a_min[0]
        || a_max[1] < b_min[1]
        || b_max[1] < a_min[1]
        || a_max[2] < b_min[2]
        || b_max[2] < a_min[2];

    if disjoint_aabbs {
        // Disjoint union: compound solid containing both shells
        let mut boundaries = a.boundaries().clone();
        boundaries.extend(b.boundaries().clone());
        if let Ok(compound) = Solid::try_new(boundaries) {
            return Ok(compound);
        }
    }

    let strictly_b_in_a = b_min[0] > a_min[0] + 1e-3
        && b_max[0] < a_max[0] - 1e-3
        && b_min[1] > a_min[1] + 1e-3
        && b_max[1] < a_max[1] - 1e-3
        && b_min[2] > a_min[2] + 1e-3
        && b_max[2] < a_max[2] - 1e-3;
    if strictly_b_in_a && is_point_inside_solid(solid_centroid(b), a) {
        return Ok(a.clone());
    }

    let strictly_a_in_b = a_min[0] > b_min[0] + 1e-3
        && a_max[0] < b_max[0] - 1e-3
        && a_min[1] > b_min[1] + 1e-3
        && a_max[1] < b_max[1] - 1e-3
        && a_min[2] > b_min[2] + 1e-3
        && a_max[2] < b_max[2] - 1e-3;
    if strictly_a_in_b && is_point_inside_solid(solid_centroid(a), b) {
        return Ok(b.clone());
    }

    for &tol in ADAPTIVE_TOLERANCES {
        let res = catch_unwind(AssertUnwindSafe(|| truck_shapeops::or(a, b, tol)));
        if let Ok(Some(solid)) = res {
            return Ok(solid);
        }
    }

    // Check containment fallback
    let b_in_a_aabb = b_min[0] >= a_min[0] - 1e-3
        && b_max[0] <= a_max[0] + 1e-3
        && b_min[1] >= a_min[1] - 1e-3
        && b_max[1] <= a_max[1] + 1e-3
        && b_min[2] >= a_min[2] - 1e-3
        && b_max[2] <= a_max[2] + 1e-3;
    if b_in_a_aabb && is_point_inside_solid(solid_centroid(b), a) {
        return Ok(a.clone());
    }

    let a_in_b_aabb = a_min[0] >= b_min[0] - 1e-3
        && a_max[0] <= b_max[0] + 1e-3
        && a_min[1] >= b_min[1] - 1e-3
        && a_max[1] <= b_max[1] + 1e-3
        && a_min[2] >= b_min[2] - 1e-3
        && a_max[2] <= b_max[2] + 1e-3;
    if a_in_b_aabb && is_point_inside_solid(solid_centroid(a), b) {
        return Ok(b.clone());
    }

    Err("union failed: shapes may intersect tangentially or non-manifold".to_string())
}

/// Boolean difference: complement of `b` intersected with `a` with adaptive tolerance search and void/disjoint fallbacks.
pub fn difference(a: &Solid, b: &Solid) -> Result<Solid, String> {
    let mut cut = b.clone();
    cut.not();

    let (a_min, a_max) = solid_aabb(a);
    let (b_min, b_max) = solid_aabb(b);
    let disjoint_aabbs = a_max[0] < b_min[0]
        || b_max[0] < a_min[0]
        || a_max[1] < b_min[1]
        || b_max[1] < a_min[1]
        || a_max[2] < b_min[2]
        || b_max[2] < a_min[2];

    if disjoint_aabbs {
        // b is completely outside a: a \ b = a
        return Ok(a.clone());
    }

    // Fast-path: if b is strictly inside a's bounding box, create cavity directly
    let strictly_inside_aabb = b_min[0] > a_min[0] + 1e-3
        && b_max[0] < a_max[0] - 1e-3
        && b_min[1] > a_min[1] + 1e-3
        && b_max[1] < a_max[1] - 1e-3
        && b_min[2] > a_min[2] + 1e-3
        && b_max[2] < a_max[2] - 1e-3;

    if strictly_inside_aabb {
        let b_center = solid_centroid(b);
        if is_point_inside_solid(b_center, a) {
            let mut boundaries = a.boundaries().clone();
            boundaries.extend(cut.boundaries().clone());
            if let Ok(hollow) = Solid::try_new(boundaries) {
                return Ok(hollow);
            }
        }
    }

    for &tol in ADAPTIVE_TOLERANCES {
        let res = catch_unwind(AssertUnwindSafe(|| truck_shapeops::and(a, &cut, tol)));
        if let Ok(Some(solid)) = res {
            return Ok(solid);
        }
    }

    // Check if b is completely inside a (creating an internal cavity/void)
    let b_in_a_aabb = b_min[0] >= a_min[0] - 1e-3
        && b_max[0] <= a_max[0] + 1e-3
        && b_min[1] >= a_min[1] - 1e-3
        && b_max[1] <= a_max[1] + 1e-3
        && b_min[2] >= a_min[2] - 1e-3
        && b_max[2] <= a_max[2] + 1e-3;
    if b_in_a_aabb && is_point_inside_solid(solid_centroid(b), a) {
        let mut boundaries = a.boundaries().clone();
        boundaries.extend(cut.boundaries().clone());
        if let Ok(hollow) = Solid::try_new(boundaries) {
            return Ok(hollow);
        }
    }

    // Check if a is completely inside b
    let a_in_b_aabb = a_min[0] >= b_min[0] - 1e-3
        && a_max[0] <= b_max[0] + 1e-3
        && a_min[1] >= b_min[1] - 1e-3
        && a_max[1] <= b_max[1] + 1e-3
        && a_min[2] >= b_min[2] - 1e-3
        && a_max[2] <= b_max[2] + 1e-3;
    if a_in_b_aabb && is_point_inside_solid(solid_centroid(a), b) {
        return Err("difference resulted in empty solid: target is completely engulfed by cutter".into());
    }

    Err("difference failed: shapes may intersect tangentially".to_string())
}

/// Boolean intersection via `truck_shapeops::and` with adaptive tolerance search and containment fallbacks.
pub fn intersection(a: &Solid, b: &Solid) -> Result<Solid, String> {
    for &tol in ADAPTIVE_TOLERANCES {
        let res = catch_unwind(AssertUnwindSafe(|| truck_shapeops::and(a, b, tol)));
        if let Ok(Some(solid)) = res {
            return Ok(solid);
        }
    }

    // Fallback when shapes do not intersect transversally:
    let (a_min, a_max) = solid_aabb(a);
    let (b_min, b_max) = solid_aabb(b);
    let disjoint_aabbs = a_max[0] < b_min[0]
        || b_max[0] < a_min[0]
        || a_max[1] < b_min[1]
        || b_max[1] < a_min[1]
        || a_max[2] < b_min[2]
        || b_max[2] < a_min[2];

    if disjoint_aabbs {
        return Err("intersection is empty: shapes do not overlap".into());
    }

    let b_in_a_aabb = b_min[0] >= a_min[0] - 1e-3
        && b_max[0] <= a_max[0] + 1e-3
        && b_min[1] >= a_min[1] - 1e-3
        && b_max[1] <= a_max[1] + 1e-3
        && b_min[2] >= a_min[2] - 1e-3
        && b_max[2] <= a_max[2] + 1e-3;
    if b_in_a_aabb && is_point_inside_solid(solid_centroid(b), a) {
        return Ok(b.clone());
    }

    let a_in_b_aabb = a_min[0] >= b_min[0] - 1e-3
        && a_max[0] <= b_max[0] + 1e-3
        && a_min[1] >= b_min[1] - 1e-3
        && a_max[1] <= b_max[1] + 1e-3
        && a_min[2] >= b_min[2] - 1e-3
        && a_max[2] <= b_max[2] + 1e-3;
    if a_in_b_aabb && is_point_inside_solid(solid_centroid(a), b) {
        return Ok(a.clone());
    }

    Err("intersection failed: shapes may intersect tangentially".to_string())
}

/// Legacy default tolerance constant for backward compatibility.
#[allow(dead_code)]
pub const TOLERANCE: f64 = 0.001;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::shapes::box_solid;

    #[test]
    fn test_difference_box_strictly_inside() {
        let big = box_solid(100.0, 100.0, 100.0).expect("big box");
        let small = box_solid(20.0, 20.0, 20.0).expect("small box");
        let diff = difference(&big, &small);
        println!("difference strictly inside: {:?}", diff.is_ok());
        assert!(diff.is_ok());

        let u = union(&big, &small);
        assert!(u.is_ok());

        let i = intersection(&big, &small);
        assert!(i.is_ok());

        let mut cut = small.clone();
        cut.not();
        let mut boundaries = big.boundaries().clone();
        boundaries.extend(cut.boundaries().clone());
        let hollow = Solid::try_new(boundaries);
        println!("hollow solid try_new: {:?}", hollow.is_ok());
        if let Ok(h) = hollow {
            let buf = crate::kernel::convert::solid_to_buffer(&h, 0.05);
            println!("hollow mesh vertices: {}", buf.positions.len());
        }
    }

    #[test]
    fn test_difference_box_and_cylinder() {
        let big = box_solid(50.0, 50.0, 50.0).expect("box");
        let cyl = crate::kernel::shapes::cylinder_solid(10.0, 30.0).expect("cylinder");
        let diff = difference(&big, &cyl);
        println!("box and cyl diff: {:?}", diff.is_ok());
        assert!(diff.is_ok());
    }
}

