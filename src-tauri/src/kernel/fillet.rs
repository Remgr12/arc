//! Payload -> fillet on a B-rep edge (truck-shapeops `fillet_with_side`).
//!
//! A `Geometry::SolidFillet` stores the picked edge as its two endpoints in
//! source-local coordinates. Evaluation matches those endpoints against the
//! B-rep topology (tolerance-based) to find the shared edge of exactly two
//! faces, runs `fillet_with_side` (which trims the adjacent end-cap faces so
//! the fillet face's end arcs stitch into the shell), and rebuilds the solid.

use std::collections::HashMap;

use truck_modeling::{Curve, EdgeID, Face, Shell, Solid, Surface};

use super::convert::pt_to_arr;

/// Endpoint matching tolerance for the picked edge.
const EDGE_TOL: f64 = 1e-3;

/// Rolling-ball surface approximation tolerance.
const FILLET_TOL: f64 = 1e-3;

fn close(a: [f64; 3], b: [f64; 3]) -> bool {
    (a[0] - b[0]).abs() <= EDGE_TOL
        && (a[1] - b[1]).abs() <= EDGE_TOL
        && (a[2] - b[2]).abs() <= EDGE_TOL
}

fn pt(point: cgmath::Point3<f64>) -> [f64; 3] {
    pt_to_arr(point)
}

/// Face use of a candidate B-rep edge.
struct EdgeUse {
    shell: usize,
    face: usize,
    face_ref: Face,
    /// end of the edge as stored (front)
    front: [f64; 3],
    /// end of the edge as stored (back)
    back: [f64; 3],
}

/// Finds the face other than the two filleted faces that lies at one picked
/// edge end (the end-cap face trimming its edge is the one stamped by
/// `fillet_with_side`).
fn side_face_at(
    solid: &Solid,
    skip: (&EdgeUse, &EdgeUse),
    end: [f64; 3],
) -> Option<EdgeUse> {
    for (shell, shell_ref) in solid.boundaries().iter().enumerate() {
        for (face, face_ref) in shell_ref.iter().enumerate() {
            if (shell == skip.0.shell && face == skip.0.face)
                || (shell == skip.1.shell && face == skip.1.face)
            {
                continue;
            }
            for cand in face_ref.edge_iter() {
                if close(pt(cand.front().point()), end)
                    || close(pt(cand.back().point()), end)
                {
                    return Some(EdgeUse {
                        shell,
                        face,
                        face_ref: face_ref.clone(),
                        front: pt(cand.front().point()),
                        back: pt(cand.back().point()),
                    });
                }
            }
        }
    }
    None
}

/// Fillet the edge (two endpoints in solid-local space) of `solid`.
///
/// When `radius` is non-positive, the source solid is returned unchanged
/// (a zero-radius fillet is a no-op).
pub fn solid_fillet(solid: &Solid, edge: [[f64; 3]; 2], radius: f64) -> Result<Solid, String> {
    if radius <= EDGE_TOL {
        return Ok(solid.clone());
    }
    let (picked_a, picked_b) = (edge[0], edge[1]);

    // Endpoint matching alone does not uniquely identify an edge (all four
    // edges of a box corner share endpoints), so both picks are required.
    let mut uses: HashMap<EdgeID, Vec<EdgeUse>> = HashMap::new();
    for (shell, shell_ref) in solid.boundaries().iter().enumerate() {
        for (face, face_ref) in shell_ref.iter().enumerate() {
            for cand in face_ref.edge_iter() {
                let (p0, p1) = (pt(cand.front().point()), pt(cand.back().point()));
                if !(close(p0, picked_a) && close(p1, picked_b))
                    && !(close(p0, picked_b) && close(p1, picked_a))
                {
                    continue;
                }
                uses.entry(cand.id()).or_default().push(EdgeUse {
                    shell,
                    face,
                    face_ref: face_ref.clone(),
                    front: p0,
                    back: p1,
                });
            }
        }
    }

    // Filleting requires a topological edge shared by exactly two faces.
    let mut matched = uses
        .into_iter()
        .filter(|(_, face_uses)| face_uses.len() == 2)
        .collect::<Vec<_>>();
    if matched.is_empty() {
        return Err("fillet failed: picked edge is not shared by two faces".into());
    }
    if matched.len() > 1 {
        return Err("fillet failed: picked edge endpoints are ambiguous".into());
    }
    let (edge, mut face_uses) = matched.remove(0);
    let use1 = face_uses.pop().ok_or("fillet failed: internal edge use")?;
    let use0 = face_uses.pop().ok_or("fillet failed: internal edge use")?;

    // The end-cap faces trimming the fillet's end arcs: side0 corresponds to
    // the front end of the picked edge as found in face0's arc, side1 to its
    // back end.
    let side0 = side_face_at(solid, (&use0, &use1), use0.front);
    let side1 = side_face_at(solid, (&use0, &use1), use0.back);

    let pieces = truck_shapeops::fillet::fillet_with_side::<Curve, Surface, f64>(
        &use0.face_ref,
        &use1.face_ref,
        edge,
        side0.as_ref().map(|s| &s.face_ref),
        side1.as_ref().map(|s| &s.face_ref),
        radius,
        FILLET_TOL,
    )
    .ok_or_else(|| "fillet failed: the selected edge cannot be filleted".to_string())?;

    let fillet = &pieces.simple_fillet;
    let fillet_face0 = fillet.face0.clone();
    let fillet_face1 = fillet.face1.clone();
    let mut fillet_face = fillet.fillet.clone();

    let mut attempts = 0;
    loop {
        let mut shells: Vec<Shell> = solid.boundaries().clone();
        shells[use0.shell][use0.face] = fillet_face0.clone();
        shells[use1.shell][use1.face] = fillet_face1.clone();
        if let (Some(s0), Some(new_side0)) = (side0.as_ref(), pieces.side0.as_ref()) {
            shells[s0.shell][s0.face] = new_side0.clone();
        }
        if let (Some(s1), Some(new_side1)) = (side1.as_ref(), pieces.side1.as_ref()) {
            shells[s1.shell][s1.face] = new_side1.clone();
        }
        shells[use1.shell].push(fillet_face.clone());
        match Solid::try_new(shells) {
            Ok(solid) => return Ok(solid),
            Err(e) => {
                attempts += 1;
                if attempts > 1 {
                    return Err(format!("fillet failed: result shell is invalid ({e})"));
                }
                // the fillet face normal can come out facing inward; flipping
                // it repairs shell consistency
                fillet_face.invert();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kernel::shapes;
    use std::panic::{catch_unwind, AssertUnwindSafe};

    fn box_solid() -> Solid {
        shapes::box_solid(60.0, 40.0, 20.0).expect("box")
    }

    fn find_picked(solid: &Solid, edge: [[f64; 3]; 2]) -> (EdgeID, EdgeUse, EdgeUse) {
        let (picked_a, picked_b) = (edge[0], edge[1]);
        let mut uses: HashMap<EdgeID, Vec<EdgeUse>> = HashMap::new();
        for (shell, shell_ref) in solid.boundaries().iter().enumerate() {
            for (face, face_ref) in shell_ref.iter().enumerate() {
                for cand in face_ref.edge_iter() {
                    let (p0, p1) = (pt(cand.front().point()), pt(cand.back().point()));
                    if !(close(p0, picked_a) && close(p1, picked_b))
                        && !(close(p0, picked_b) && close(p1, picked_a))
                    {
                        continue;
                    }
                    uses.entry(cand.id()).or_default().push(EdgeUse {
                        shell,
                        face,
                        face_ref: face_ref.clone(),
                        front: p0,
                        back: p1,
                    });
                }
            }
        }
        let (edge, mut face_uses) = uses.into_iter().find(|(_, l)| l.len() == 2).unwrap();
        let use1 = face_uses.pop().unwrap();
        let use0 = face_uses.pop().unwrap();
        (edge, use0, use1)
    }

    #[test]
    fn direct_bottom_edge_fillet() {
        let solid = box_solid();
        let result = solid_fillet(&solid, [[30.0, 10.0, -20.0], [30.0, -10.0, -20.0]], 4.0);
        let solid = result.expect("bottom edge fillet");
        assert_eq!(solid.boundaries()[0].len(), 7);
    }
}
