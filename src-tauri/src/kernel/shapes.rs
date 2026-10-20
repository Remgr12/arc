//! Payload -> truck B-rep construction.
//!
//! Solid payloads are realized here as truck
//! `Solid<Point3, Curve, Surface>`; the mesh is then tessellated by
//! `truck-meshalgo` (see [`meshgen`]). Booleans run at B-rep level via
//! `truck-shapeops` (see [`csg`]).
//!
//! Construction recipes follow the upstream `truck-modeling` examples
//! (`cube.rs`, `cylinder.rs`, `sphere.rs`, `cone.rs`, `torus.rs`).

use std::f64::consts::{FRAC_PI_4, FRAC_PI_2, PI};

use cgmath::{Rad, Vector3};
use truck_modeling::{builder, Edge, Solid, Vertex, Wire};

use super::convert::arr_to_pt;

/// Whole-turn angle for `rsweep`/`cone`: any angle >= 2π triggers the
/// closed-sweep path (upstream examples pass `Rad(7.0)`).
const WHOLE: Rad<f64> = Rad(7.0);

fn at(x: f64, y: f64, z: f64) -> Vertex {
    builder::vertex(cgmath::Point3::new(x, y, z))
}

fn unit_x() -> Vector3<f64> {
    Vector3::unit_x()
}

fn unit_y() -> Vector3<f64> {
    Vector3::unit_y()
}

fn unit_z() -> Vector3<f64> {
    Vector3::unit_z()
}

/// Closed straight-line polygon wire through CCW `pts3`.
fn closed_wire(pts3: &[[f64; 3]]) -> Wire {
    let verts: Vec<Vertex> = pts3.iter().map(|p| builder::vertex(arr_to_pt(*p))).collect();
    let mut wire = Wire::new();
    for i in 0..verts.len() {
        wire.push_back(builder::line(&verts[i], &verts[(i + 1) % verts.len()]));
    }
    wire
}

/// Open straight-line polyline wire through `pts3` (>= 2 points).
fn polyline_wire(pts3: &[[f64; 3]]) -> Wire {
    let verts: Vec<Vertex> = pts3.iter().map(|p| builder::vertex(arr_to_pt(*p))).collect();
    let mut wire = Wire::new();
    for w in verts.windows(2) {
        wire.push_back(builder::line(&w[0], &w[1]));
    }
    wire
}

/// Planar face of a CCW polygon (`pts3`), for generic edge cases only;
/// primary payloads use dedicated constructors.
#[allow(dead_code)]
fn polygon_face(pts3: &[[f64; 3]], what: &str) -> Result<truck_modeling::Face, String> {
    builder::try_attach_plane(vec![closed_wire(pts3)]).map_err(|e| format!("{what}: {e}"))
}

// ------------------------------------------------------------------- box

/// Axis-aligned box centered on the local origin: width along X,
/// height along Y, depth along Z.
pub fn box_solid(width: f64, depth: f64, height: f64) -> Result<Solid, String> {
    if width <= 0.0 || depth <= 0.0 || height <= 0.0 {
        return Err("box dimensions must be positive".into());
    }
    // upstream cube recipe: three translation sweeps from one vertex
    let v = at(-width / 2.0, -height / 2.0, -depth / 2.0);
    let e = builder::tsweep(&v, unit_z() * depth);
    let f = builder::tsweep(&e, unit_y() * height);
    let solid: Solid = builder::tsweep(&f, unit_x() * width);
    Ok(solid)
}

/// Box with rounded vertical edges. The rounded-rect profile (straight
/// sides + quarter-circle arcs) lives in the XZ plane and is swept up
/// by `height`, centered on the local origin.
pub fn rounded_box_solid(
    width: f64,
    depth: f64,
    height: f64,
    corner_radius: f64,
) -> Result<Solid, String> {
    if width <= 0.0 || depth <= 0.0 || height <= 0.0 {
        return Err("box dimensions must be positive".into());
    }
    let radius = corner_radius
        .clamp(0.0, (width / 2.0 - 1e-6).min(depth / 2.0 - 1e-6).max(0.0));
    if radius <= 1e-6 {
        return box_solid(width, depth, height);
    }
    let hw = width / 2.0 - radius;
    let hd = depth / 2.0 - radius;
    let radius = radius;
    // profile in the XZ plane at y = -height/2, CCW seen from +Y:
    // corners in order bottom-right, top-right, top-left, bottom-left;
    // each contributes a quarter arc plus a straight side
    let centers: [(f64, f64); 4] = [(hw, -hd), (hw, hd), (-hw, hd), (-hw, -hd)];
    let starts: [Rad<f64>; 4] = [
        Rad(-FRAC_PI_2),
        Rad(0.0),
        Rad(FRAC_PI_2),
        Rad(PI),
    ];
    let on = |c: (f64, f64), a: Rad<f64>| (c.0 + radius * a.0.cos(), c.1 + radius * a.0.sin());
    let y0 = -height / 2.0;
    let first_on = on(centers[0], starts[0]);
    let mut prev = at(first_on.0, y0, first_on.1);
    let first_v = prev.clone();
    let mut edges: Vec<Edge> = Vec::with_capacity(8);
    for (ci, center) in centers.iter().enumerate() {
        let start = starts[ci];
        let end = Rad(start.0 + FRAC_PI_2);
        let p_start = if ci == 0 { first_v.clone() } else { at(on(*center, start).0, y0, on(*center, start).1) };
        let p_end_v = at(on(*center, end).0, y0, on(*center, end).1);
        let mid = Rad(start.0 + FRAC_PI_4);
        let transit = on(*center, mid);
        edges.push(
            builder::circle_arc(
                &p_start,
                &p_end_v,
                truck_modeling::builder::ArcConstraint::Transit(cgmath::Point3::new(
                    transit.0, y0, transit.1,
                )),
            ),
        );
        prev = p_end_v;
        // straight side to the next corner's arc start
        let next = centers[(ci + 1) % 4];
        let nstart = on(next, starts[(ci + 1) % 4]);
        let nv = at(nstart.0, y0, nstart.1);
        edges.push(builder::line(&prev, &nv));
        prev = nv;
    }
    // close the ring
    edges.push(builder::line(&prev, &first_v));
    let wire = Wire::from_iter(edges);
    let profile_face = builder::try_attach_plane(vec![wire])
        .map_err(|e| format!("rounded box profile: {e}"))?;
    let solid: Solid = builder::tsweep(&profile_face, unit_y() * height);
    // profile was at y = -height/2; lift to center
    let solid = builder::translated(&solid, Vector3::new(0.0, height / 2.0, 0.0));
    Ok(solid)
}

// ------------------------------------------------------------- primitives

/// UV sphere of the given radius, centered at the local origin.
pub fn sphere_solid(radius: f64) -> Result<Solid, String> {
    if radius <= 0.0 {
        return Err("sphere radius must be positive".into());
    }
    // upstream sphere recipe: polar vertex -> meridian arc -> cone builder
    let v0 = at(0.0, radius, 0.0);
    let wire: Wire = builder::rsweep(&v0, cgmath_zero_pt(), unit_x(), Rad(PI), 3);
    let shell = builder::cone(&wire, unit_y(), WHOLE, 4);
    Ok(Solid::new(vec![shell]))
}

/// Cylinder along +Y with the base circle on the local origin plane.
pub fn cylinder_solid(radius: f64, height: f64) -> Result<Solid, String> {
    if radius <= 0.0 || height <= 0.0 {
        return Err("cylinder radius/height must be positive".into());
    }
    // upstream cylinder recipe
    let vertex = at(0.0, 0.0, radius);
    let circle: Wire = builder::rsweep(&vertex, cgmath_zero_pt(), unit_y(), WHOLE, 2);
    let disk = builder::try_attach_plane(vec![circle])
        .map_err(|e| format!("cylinder base plane: {e}"))?;
    let solid: Solid = builder::tsweep(&disk, unit_y() * height);
    Ok(solid)
}

/// Cone along +Y (tip on top), base circle centered on the local origin.
pub fn cone_solid(radius: f64, height: f64) -> Result<Solid, String> {
    if radius <= 0.0 || height <= 0.0 {
        return Err("cone radius/height must be positive".into());
    }
    // upstream cone recipe: triangular profile wire swept about Y
    let v0 = at(0.0, height, 0.0);
    let v1 = at(0.0, 0.0, radius);
    let v2 = at(0.0, 0.0, 0.0);
    let wire: Wire = vec![builder::line(&v0, &v1), builder::line(&v1, &v2)].into();
    let shell = builder::cone(&wire, unit_y(), WHOLE, 4);
    Ok(Solid::new(vec![shell]))
}

/// Torus lying in the XZ plane (major `radius`, tube `tube`).
pub fn torus_solid(radius: f64, tube: f64) -> Result<Solid, String> {
    if radius <= 0.0 || tube <= 0.0 || tube >= radius {
        return Err("torus requires 0 < tube < radius".into());
    }
    // upstream torus recipe: tube circle swept into a ring
    let v = at(radius, 0.0, tube);
    let w: Wire = builder::rsweep(
        &v,
        cgmath::Point3::new(radius, 0.0, 0.0),
        unit_y(),
        WHOLE,
        2,
    );
    let shell = builder::rsweep(&w, cgmath_zero_pt(), unit_z(), WHOLE, 2);
    Ok(Solid::new(vec![shell]))
}

/// Extrusion of a closed XZ polygon (payload coords `[x, z]`) upwards
/// by `height`. The profile is recentered on its centroid first (same
/// behavior as the old kernel).
pub fn extrude_solid(polygon: &[[f64; 2]], height: f64) -> Result<Solid, String> {
    if polygon.len() < 3 {
        return Err("extrude needs at least 3 points".into());
    }
    if height <= 0.0 {
        return Err("extrude height must be positive".into());
    }
    let centered = recenter_polygon(polygon);
    let pts3: Vec<[f64; 3]> = centered.iter().map(|p| [p[0], 0.0, p[1]]).collect();
    let face = polygon_face(&pts3, "extrude profile")?;
    let solid: Solid = builder::tsweep(&face, unit_y() * height);
    // old kernel extrudes the recentred profile asymmetrically: -h/2..h/2
    let solid = builder::translated(&solid, Vector3::new(0.0, -height / 2.0, 0.0));
    Ok(solid)
}

/// Slab: recentred footprint extruded 0..height.
pub fn slab_solid(polygon: &[[f64; 2]], height: f64) -> Result<Solid, String> {
    if polygon.len() < 3 {
        return Err("slab polygon needs at least 3 points".into());
    }
    if height <= 0.0 {
        return Err("slab height must be positive".into());
    }
    let centered = recenter_polygon(polygon);
    let pts3: Vec<[f64; 3]> = centered.iter().map(|p| [p[0], 0.0, p[1]]).collect();
    let face = polygon_face(&pts3, "slab profile")?;
    let solid: Solid = builder::tsweep(&face, unit_y() * height);
    Ok(solid)
}

/// Revolution of an XZ profile (`x` = radius, `z` = height) about the
/// local Y axis via the truck `cone` builder, which supplies planar
/// end caps with topological identity for both full and partial turns.
///
/// Profiles whose endpoints do not sit on the axis are connected to it
/// with straight radial segments; the revolution of a radial line is
/// the flat cap disk/annulus.
pub fn revolve_solid(profile: &[[f64; 2]], steps: u32, angle_deg: f64) -> Result<Solid, String> {
    if profile.len() < 2 {
        return Err("revolve needs a 2+ point profile".into());
    }
    let angle = angle_deg.clamp(-360.0, 360.0).abs();
    if angle < 1e-9 {
        return Err("revolve angle must be non-zero".into());
    }
    // enforce: first and last profile points on the axis
    let mut pts: Vec<[f64; 2]> = profile.to_vec();
    if pts[0][0].abs() > 1e-12 {
        pts.insert(0, [0.0, pts[0][1]]);
    }
    let last = pts[pts.len() - 1];
    if last[0].abs() > 1e-12 {
        pts.push([0.0, last[1]]);
    }
    // truck's cone builder rotates about +Y seen in (z, x): map the
    // profile (x = radius, z = height) into (z, y) so the axis is Y
    let pts3: Vec<[f64; 3]> = pts.iter().map(|p| [0.0, p[1], p[0]]).collect();
    let wire = polyline_wire(&pts3);
    let division = (steps.max(3) as usize).min(180);
    let shell = builder::cone(&wire, unit_y(), Rad(angle.to_radians()), division);
    Ok(Solid::new(vec![shell]))
}

/// Regular n-gon prism column (radius from center to corners) along +Y,
/// first vertex at -45 degrees (matches the old kernel).
pub fn column_solid(radius: f64, height: f64, sides: u32) -> Result<Solid, String> {
    if radius <= 0.0 || height <= 0.0 {
        return Err("column radius/height must be positive".into());
    }
    let sides = (sides.max(3)) as usize;
    let pts3: Vec<[f64; 3]> = (0..sides)
        .map(|i| {
            let a = std::f64::consts::TAU * i as f64 / sides as f64 - FRAC_PI_4;
            [radius * a.cos(), 0.0, radius * a.sin()]
        })
        .collect();
    let face = polygon_face(&pts3, "column profile")?;
    let solid: Solid = builder::tsweep(&face, unit_y() * height);
    Ok(solid)
}

/// Rectangular beam: length along +X from the origin, centered in Y/Z.
pub fn beam_solid(length: f64, width: f64, height: f64) -> Result<Solid, String> {
    if length <= 0.0 || width <= 0.0 || height <= 0.0 {
        return Err("beam dimensions must be positive".into());
    }
    let hh = height / 2.0;
    let hw = width / 2.0;
    let v = at(0.0, -hh, -hw);
    let e = builder::tsweep(&v, unit_z() * width);
    let f = builder::tsweep(&e, unit_y() * height);
    let solid: Solid = builder::tsweep(&f, unit_x() * length);
    Ok(solid)
}

fn recenter_polygon(polygon: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let (mut cx, mut cz) = (0.0, 0.0);
    for p in polygon {
        cx += p[0];
        cz += p[1];
    }
    let n = polygon.len() as f64;
    polygon
        .iter()
        .map(|p| [p[0] - cx / n, p[1] - cz / n])
        .collect()
}

/// cgmath origin point (Point::origin comes from the cgmath prelude).
fn cgmath_zero_pt() -> cgmath::Point3<f64> {
    cgmath::Point3::new(0.0, 0.0, 0.0)
}
