//! B-rep booleans on payload-produced solids, via `truck-shapeops`.
//!
//! Operations are exact NURBS booleans restricted to transversal
//! intersections (tangential faces are not supported by upstream).
//! Boolean payloads whose children cannot be represented as truck
//! solids error out clearly.

use truck_modeling::Solid;
use truck_shapeops;

use crate::core::entity::CsgOperation;

/// Boolean operation on two solids (both in local payload space).
#[allow(dead_code)]
pub fn boolean(op: CsgOperation, a: &Solid, b: &Solid) -> Result<Solid, String> {
    match op {
        CsgOperation::Union => union(a, b),
        CsgOperation::Difference => difference(a, b),
        CsgOperation::Intersection => intersection(a, b),
    }
}

/// Boolean union via `truck_shapeops::or`.
#[allow(dead_code)]
pub fn union(a: &Solid, b: &Solid) -> Result<Solid, String> {
    truck_shapeops::or(a, b, crate::kernel::csg::TOLERANCE)
        .ok_or_else(|| "union failed (faces may intersect tangentially)".to_string())
}

/// Boolean difference: complement of `b` intersected with `a`.
#[allow(dead_code)]
pub fn difference(a: &Solid, b: &Solid) -> Result<Solid, String> {
    let mut cut = b.clone();
    cut.not();
    truck_shapeops::and(a, &cut, TOLERANCE)
        .ok_or_else(|| "difference failed (faces may intersect tangentially)".to_string())
}

/// Boolean intersection via `truck_shapeops::and`.
#[allow(dead_code)]
pub fn intersection(a: &Solid, b: &Solid) -> Result<Solid, String> {
    truck_shapeops::and(a, b, TOLERANCE)
        .ok_or_else(|| "intersection failed (faces may intersect tangentially)".to_string())
}

/// Global boolean tolerance.
#[allow(dead_code)]
pub const TOLERANCE: f64 = 0.001;
