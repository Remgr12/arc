//! Payload NURBS <-> truck NURBS marshalling.
//!
//! Truck's `NurbsCurve`/`NurbsSurface` handle the homogeneous rational
//! basis; [`subs`] returns homogeneous coordinates (weight lumped in),
//! so callers divide by `w` at the end (`sample_*` helpers do).

use truck_geometry::prelude::{
    BSplineCurve, BSplineSurface, KnotVec, NurbsCurve, NurbsSurface,
    ParametricCurve, ParametricSurface,
};

/// Payload homogeneous point -> truck homogeneous vector.
pub fn hom(p: [f64; 4]) -> cgmath::Vector4<f64> {
    cgmath::Vector4::new(p[0], p[1], p[2], p[3])
}

/// Build a truck NURBS curve from control points + knot vector.
pub fn payload_curve(
    points: &[[f64; 4]],
    knots: &[f64],
    _degree: u32,
) -> Result<NurbsCurve<cgmath::Vector4<f64>>, String> {
    if points.is_empty() {
        return Err("nurbs curve needs control points".into());
    }
    let cps: Vec<cgmath::Vector4<f64>> = points.iter().map(|p| hom(*p)).collect();
    Ok(NurbsCurve::new(BSplineCurve::new(KnotVec::from(knots.to_vec()), cps)))
}

/// Build a truck NURBS surface from the control grid + knot vectors
/// (rows index the U direction).
pub fn payload_surface(
    control_points: &[Vec<[f64; 4]>],
    u_knots: &[f64],
    v_knots: &[f64],
    _u_degree: u32,
    _v_degree: u32,
) -> Result<NurbsSurface<cgmath::Vector4<f64>>, String> {
    if control_points.is_empty() || control_points[0].is_empty() {
        return Err("nurbs surface needs a rectangular control grid".into());
    }
    let cps: Vec<Vec<cgmath::Vector4<f64>>> = control_points
        .iter()
        .map(|row| row.iter().map(|p| hom(*p)).collect())
        .collect();
    let su = KnotVec::from(u_knots.to_vec());
    let sv = KnotVec::from(v_knots.to_vec());
    Ok(NurbsSurface::new(BSplineSurface::new((su, sv), cps)))
}

/// Rational position of the truck NURBS curve at parameter `t`.
pub fn curve_point3(curve: &NurbsCurve<cgmath::Vector4<f64>>, t: f64) -> [f64; 3] {
    let p = curve.subs(t);
    [p.x, p.y, p.z]
}

/// Rational position of the truck NURBS surface at `(u, v)`.
pub fn surface_point3(surface: &NurbsSurface<cgmath::Vector4<f64>>, u: f64, v: f64) -> [f64; 3] {
    let p = surface.subs(u, v);
    [p.x, p.y, p.z]
}
