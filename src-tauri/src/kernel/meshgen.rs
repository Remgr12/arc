//! Payload -> `MeshBuffer` evaluation, backed by the truck kernel.
//!
//! Solid payloads are realized as truck B-rep solids and tessellated
//! with `truck-meshalgo`; architecture/wireframe/NURBS payloads keep
//! the old mesh-level generators (NURBS curves/surfaces now evaluated
//! through truck's rational basis functions).

use std::f64::consts::TAU;

use truck_geometry::prelude::{BoundedCurve, BoundedSurface};
use truck_meshalgo::tessellation::{MeshedShape, RobustMeshableShape};

use truck_modeling::Solid;

use crate::core::entity::{CsgOperation, Geometry};
use crate::core::mesh::{earclip_xz, polygon_signed_area_xz, tri_normal, MeshBuilder, MeshBuffer};

use super::convert::polygon_to_buffer;
use super::nurbs::{payload_curve, payload_surface};
use super::shapes;

/// Tessellation tolerance for B-rep triangulation.
const TESS_TOL: f64 = 0.001;

// ------------------------------------------------------------------ dispatch

/// Generate local mesh for the given geometry.
pub fn generate(kind: &Geometry) -> Result<MeshBuffer, String> {
    let mut mb = MeshBuilder::new();
    match kind {
        // ---- B-rep solids (truck shape -> polygon mesh)
        Geometry::Box { width, depth, height, corner_radius } => {
            let solid = if *corner_radius <= 1e-6 {
                shapes::box_solid(*width, *depth, *height)?
            } else {
                shapes::rounded_box_solid(*width, *depth, *height, *corner_radius)?
            };
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Sphere { radius, .. } => {
            let solid = shapes::sphere_solid(*radius)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Cylinder { radius, height, .. } => {
            let solid = shapes::cylinder_solid(*radius, *height)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Cone { radius, height, .. } => {
            let solid = shapes::cone_solid(*radius, *height)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Torus { radius, tube, .. } => {
            let solid = shapes::torus_solid(*radius, *tube)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Extrude { polygon, height } => {
            let solid = shapes::extrude_solid(polygon, *height)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Revolve { profile, steps, angle_deg } => {
            let solid = shapes::revolve_solid(profile, *steps, *angle_deg)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Column { radius, height, sides } => {
            let solid = shapes::column_solid(*radius, *height, *sides)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Beam { length, width, height } => {
            let solid = shapes::beam_solid(*length, *width, *height)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Slab { polygon, height } => {
            // slab = extruded footprint 0..height (truck prism)
            let solid = shapes::slab_solid(polygon, *height)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }
        Geometry::Csg { operation, first, second } => {
            let a = payload_to_solid(first)?;
            let b = payload_to_solid(second)?;
            let solid = csg_boolean(*operation, a, b)?;
            mb.append_buffer(&polygon_to_buffer(&solid.robust_triangulation(TESS_TOL).to_polygon()));
        }

        // ---- mesh-level payloads (old generators)
        Geometry::Plane { width, depth } => gen_plane(&mut mb, *width, *depth),
        Geometry::Sweep { path, radius, sides } => {
            gen_sweep(&mut mb, path, *radius, (*sides).max(3))?
        }
        Geometry::Loft { sections } => gen_loft(&mut mb, sections)?,
        Geometry::Wall { path, width, height } => gen_wall(&mut mb, path, *width, *height),
        Geometry::Stair { width, rise, run, count } => {
            gen_stair(&mut mb, *width, *rise, *run, *count)
        }
        Geometry::Roof { width, depth, pitch_deg, overhang } => {
            gen_roof(&mut mb, *width, *depth, *pitch_deg, *overhang)
        }
        Geometry::Door { width, height, depth, swing_deg } => {
            gen_door(&mut mb, *width, *height, *depth, *swing_deg)
        }
        Geometry::Window { width, height, depth, panes_x, panes_y } => {
            gen_window(&mut mb, *width, *height, *depth, *panes_x, *panes_y)
        }
        Geometry::Dimension { start, end } => gen_dimension(&mut mb, *start, *end),
        Geometry::ImportedMesh { positions, indices } => {
            gen_imported_mesh(&mut mb, positions, indices)?
        }

        // ---- NURBS (evaluated through truck)
        Geometry::NurbsSurface { control_points, u_degree, v_degree, u_knots, v_knots } => {
            gen_nurbs_surface(&mut mb,
                control_points, *u_degree, *v_degree, u_knots, v_knots)?
        }
        Geometry::NurbsLoft { sections, degree, samples_v, .. } => {
            gen_nurbs_loft(&mut mb, sections, *degree, *samples_v)?
        }
        Geometry::NurbsSweep { path, profile, path_degree, profile_degree, samples_u, samples_v } => {
            gen_nurbs_sweep(&mut mb, path, profile, *path_degree, *profile_degree,
                *samples_u, *samples_v)?
        }

        // ---- sketches / wireframe
        Geometry::LineCurve { end } => {
            mb.push_line([0.0, 0.0, 0.0], *end);
        }
        Geometry::PolylineCurve { points } => {
            mb.push_polyline(points);
        }
        Geometry::CircleCurve { radius, segments } => {
            gen_rim(&mut mb, *radius, (*segments).max(8))
        }
        Geometry::ArcCurve { radius, start_angle_deg, end_angle_deg, segments } => {
            gen_arc(&mut mb, *radius, *start_angle_deg, *end_angle_deg, (*segments).max(3))
        }
        Geometry::RectangleCurve { width, depth } => {
            let (w, d) = (*width / 2.0, *depth / 2.0);
            mb.push_polyline(&[
                [-w, 0.0, -d],
                [w, 0.0, -d],
                [w, 0.0, d],
                [-w, 0.0, d],
                [-w, 0.0, -d],
            ]);
        }
        Geometry::PolygonCurve { radius, sides } => {
            gen_rim(&mut mb, *radius, (*sides).max(3))
        }
    }
    Ok(mb.into_buffer())
}

/// Realize a payload sub-tree as a truck solid (B-rep payload set only).
pub fn payload_to_solid(kind: &Geometry) -> Result<Solid, String> {
    match kind {
        Geometry::Box { width, depth, height, corner_radius } => {
            if *corner_radius <= 1e-6 {
                shapes::box_solid(*width, *depth, *height)
            } else {
                shapes::rounded_box_solid(*width, *depth, *height, *corner_radius)
            }
        }
        Geometry::Sphere { radius, .. } => shapes::sphere_solid(*radius),
        Geometry::Cylinder { radius, height, .. } => shapes::cylinder_solid(*radius, *height),
        Geometry::Cone { radius, height, .. } => shapes::cone_solid(*radius, *height),
        Geometry::Torus { radius, tube, .. } => shapes::torus_solid(*radius, *tube),
        Geometry::Extrude { polygon, height } => shapes::extrude_solid(polygon, *height),
        Geometry::Revolve { profile, steps, angle_deg } => {
            shapes::revolve_solid(profile, *steps, *angle_deg)
        }
        Geometry::Column { radius, height, sides } => {
            shapes::column_solid(*radius, *height, *sides)
        }
        Geometry::Beam { length, width, height } => shapes::beam_solid(*length, *width, *height),
        Geometry::Slab { polygon, height } => shapes::slab_solid(polygon, *height),
        Geometry::Csg { operation, first, second } => {
            let a = payload_to_solid(first)?;
            let b = payload_to_solid(second)?;
            csg_boolean(*operation, a, b)
        }
        other => Err(format!(
            "boolean operations support only B-rep payloads; '{}' cannot be processed",
            other.type_name()
        )),
    }
}

/// B-rep boolean union/difference/intersection via truck-shapeops.
fn csg_boolean(op: CsgOperation, a: Solid, b: Solid) -> Result<Solid, String> {
    const TOL: f64 = 0.001;
    match op {
        CsgOperation::Union => {
            truck_shapeops::or(&a, &b, TOL)
                .ok_or_else(|| "union failed: shapes may intersect tangentially".into())
        }
        CsgOperation::Intersection => {
            truck_shapeops::and(&a, &b, TOL)
                .ok_or_else(|| "intersection failed: shapes may intersect tangentially".into())
        }
        CsgOperation::Difference => {
            let mut not = b.clone();
            not.not();
            truck_shapeops::and(&a, &not, TOL)
                .ok_or_else(|| "difference failed: shapes may intersect tangentially".into())
        }
    }
}

// ------------------------------------------------------------------ helpers

/// Emit an imported triangle soup directly.
fn gen_imported_mesh(
    mb: &mut MeshBuilder,
    positions: &[[f64; 3]],
    indices: &[u32],
) -> Result<(), String> {
    for tri in indices.chunks(3) {
        if tri.len() != 3 {
            continue;
        }
        let (a, b, c) = (
            positions.get(tri[0] as usize),
            positions.get(tri[1] as usize),
            positions.get(tri[2] as usize),
        );
        let (Some(a), Some(b), Some(c)) = (a, b, c) else {
            continue;
        };
        let n = tri_normal(*a, *b, *c);
        mb.push_tri(*a, *b, *c, n);
    }
    Ok(())
}

/// Emit a closed axis-aligned cuboid from corners min/max.
fn emit_cuboid(mb: &mut MeshBuilder, min: [f64; 3], max: [f64; 3]) {
    let (x0, x1) = (min[0], max[0]);
    let (y0, y1) = (min[1], max[1]);
    let (z0, z1) = (min[2], max[2]);
    mb.push_quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0.0, 0.0, -1.0]);
    mb.push_quad([x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1], [0.0, 0.0, 1.0]);
    mb.push_quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1.0, 0.0, 0.0]);
    mb.push_quad([x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0], [-1.0, 0.0, 0.0]);
    mb.push_quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0.0, 1.0, 0.0]);
    mb.push_quad([x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [0.0, -1.0, 0.0]);
}

/// Extrude a closed XZ profile (ensured CCW) between y0 and y1 with caps.
#[allow(dead_code)]
fn gen_prism_xz(mb: &mut MeshBuilder, profile: &mut [[f64; 2]], y0: f64, y1: f64) {
    ensure_ccw(profile);
    let tris = earclip_xz(profile);
    for t in &tris {
        let a = profile[t[0]];
        let b = profile[t[1]];
        let c = profile[t[2]];
        mb.push_tri(
            [a[0], y1, a[1]],
            [b[0], y1, b[1]],
            [c[0], y1, c[1]],
            [0.0, 1.0, 0.0],
        );
        mb.push_tri(
            [a[0], y0, a[1]],
            [c[0], y0, c[1]],
            [b[0], y0, b[1]],
            [0.0, -1.0, 0.0],
        );
    }
    let n = profile.len();
    for i in 0..n {
        let j = (i + 1) % n;
        let a = profile[i];
        let b = profile[j];
        let ex = b[0] - a[0];
        let ez = b[1] - a[1];
        let len = (ex * ex + ez * ez).sqrt();
        if len < 1e-9 {
            continue;
        }
        let outward = [ez / len, 0.0, -ex / len];
        mb.push_quad(
            [a[0], y0, a[1]],
            [b[0], y0, b[1]],
            [b[0], y1, b[1]],
            [a[0], y1, a[1]],
            outward,
        );
    }
}

/// Reverse the polygon in place if clockwise.
#[allow(dead_code)]
fn ensure_ccw(profile: &mut [[f64; 2]]) {
    if polygon_signed_area_xz(profile) < 0.0 {
        profile.reverse();
    }
}

fn dot3(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

fn norm3(a: [f64; 3]) -> [f64; 3] {
    let l = (a[0] * a[0] + a[1] * a[1] + a[2] * a[2]).sqrt();
    if l < 1e-12 {
        [0.0; 3]
    } else {
        [a[0] / l, a[1] / l, a[2] / l]
    }
}

// ---------------------------------------------------------------- architecture

fn gen_plane(mb: &mut MeshBuilder, width: f64, depth: f64) {
    let (w, d) = (width / 2.0, depth / 2.0);
    mb.push_quad(
        [-w, 0.0, -d],
        [-w, 0.0, d],
        [w, 0.0, d],
        [w, 0.0, -d],
        [0.0, 1.0, 0.0],
    );
}

fn gen_rim(mb: &mut MeshBuilder, radius: f64, segments: u32) {
    let mut pts = Vec::with_capacity(segments as usize + 1);
    for i in 0..=segments {
        let a = TAU * (i as f64) / segments as f64;
        pts.push([radius * a.cos(), 0.0, radius * a.sin()]);
    }
    mb.push_polyline(&pts);
}

fn gen_arc(mb: &mut MeshBuilder, radius: f64, start_deg: f64, end_deg: f64, segments: u32) {
    let mut pts = Vec::with_capacity(segments as usize + 1);
    for i in 0..=segments {
        let a = (start_deg + (end_deg - start_deg) * (i as f64) / segments as f64).to_radians();
        pts.push([radius * a.cos(), 0.0, radius * a.sin()]);
    }
    mb.push_polyline(&pts);
}

fn gen_wall(mb: &mut MeshBuilder, path: &[[f64; 2]], width: f64, height: f64) {
    if path.len() < 2 {
        return;
    }
    let half = width / 2.0;
    for i in 0..path.len() - 1 {
        let (start, end) = (path[i], path[i + 1]);
        let dx = end[0] - start[0];
        let dz = end[1] - start[1];
        let len = (dx * dx + dz * dz).sqrt();
        if len < 1e-9 {
            continue;
        }
        let (nx, nz) = (dx / len, dz / len);
        let a = [start[0] - nx * half, start[1] - nz * half];
        let b = [end[0] + nx * half, end[1] + nz * half];
        let (px, pz) = (-nz * half, nx * half);
        let c0 = [a[0] + px, a[1] + pz];
        let c1 = [a[0] - px, a[1] - pz];
        let c2 = [b[0] - px, b[1] - pz];
        let c3 = [b[0] + px, b[1] + pz];
        emit_wall_slab(mb, c0, c1, c2, c3, 0.0, height);
    }
}

fn emit_wall_slab(
    mb: &mut MeshBuilder,
    c0: [f64; 2],
    c1: [f64; 2],
    c2: [f64; 2],
    c3: [f64; 2],
    y0: f64,
    y1: f64,
) {
    let pts = [c0, c1, c2, c3];
    mb.push_quad([c0[0], y1, c0[1]], [c1[0], y1, c1[1]], [c2[0], y1, c2[1]], [c3[0], y1, c3[1]], [0.0, 1.0, 0.0]);
    mb.push_quad([c0[0], y0, c0[1]], [c3[0], y0, c3[1]], [c2[0], y0, c2[1]], [c1[0], y0, c1[1]], [0.0, -1.0, 0.0]);
    for i in 0..4 {
        let j = (i + 1) % 4;
        let a = pts[i];
        let b = pts[j];
        let ex = b[0] - a[0];
        let ez = b[1] - a[1];
        let l = (ex * ex + ez * ez).sqrt();
        let nrm = if l > 1e-9 { [ez / l, 0.0, -ex / l] } else { [0.0; 3] };
        mb.push_quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], nrm);
    }
}

fn gen_stair(mb: &mut MeshBuilder, width: f64, rise: f64, run: f64, count: u32) {
    let half_w = width / 2.0;
    let mut x = 0.0;
    for step in 0..count {
        let top = rise * (step as f64 + 1.0);
        mb.push_quad(
            [x, top, -half_w],
            [x + run, top, -half_w],
            [x + run, top, half_w],
            [x, top, half_w],
            [0.0, 1.0, 0.0],
        );
        mb.push_quad(
            [x, top - rise, -half_w],
            [x, top, -half_w],
            [x, top, half_w],
            [x, top - rise, half_w],
            [-1.0, 0.0, 0.0],
        );
        mb.push_quad(
            [x, 0.0, -half_w],
            [x, top, -half_w],
            [x + run, top, -half_w],
            [x + run, 0.0, -half_w],
            [0.0, 0.0, -1.0],
        );
        mb.push_quad(
            [x + run, 0.0, half_w],
            [x + run, top, half_w],
            [x, top, half_w],
            [x, 0.0, half_w],
            [0.0, 0.0, 1.0],
        );
        x += run;
    }
    let top_y = rise * count.max(1) as f64;
    mb.push_quad(
        [x, 0.0, -half_w],
        [x, top_y, -half_w],
        [x, top_y, half_w],
        [x, 0.0, half_w],
        [1.0, 0.0, 0.0],
    );
}

fn gen_roof(mb: &mut MeshBuilder, width: f64, depth: f64, pitch_deg: f64, overhang: f64) {
    let half_d = depth / 2.0 + overhang;
    let half_w = width / 2.0 + overhang;
    let ridge_h = (depth / 2.0).max(1e-6) * pitch_deg.to_radians().tan();
    let tri: [[f64; 2]; 3] = [[-half_d, 0.0], [half_d, 0.0], [0.0, ridge_h]];
    let (x0, x1) = (-half_w, half_w);

    let mut gable = |x: f64, want_plus_x: bool| {
        let pts: Vec<[f64; 3]> = tri.iter().map(|p| [x, p[1], p[0]]).collect();
        let mut n = tri_normal(pts[0], pts[1], pts[2]);
        if (n[0] > 0.0) != want_plus_x {
            n = [-n[0], -n[1], -n[2]];
            mb.push_tri(pts[0], pts[2], pts[1], n);
        } else {
            mb.push_tri(pts[0], pts[1], pts[2], n);
        }
    };
    gable(x0, false);
    gable(x1, true);

    let centroid = [
        (tri[0][0] + tri[1][0] + tri[2][0]) / 3.0,
        (tri[0][1] + tri[1][1] + tri[2][1]) / 3.0,
    ];
    for i in 0..3 {
        let j = (i + 1) % 3;
        let a = tri[i];
        let b = tri[j];
        let ez = b[0] - a[0];
        let ey = b[1] - a[1];
        let l = (ez * ez + ey * ey).sqrt();
        if l < 1e-9 {
            continue;
        }
        let mut n2 = [ey / l, -ez / l];
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        if n2[0] * (mid[0] - centroid[0]) + n2[1] * (mid[1] - centroid[1]) > 0.0 {
            n2 = [-n2[0], -n2[1]];
        }
        mb.push_quad(
            [x0, a[1], a[0]],
            [x1, a[1], a[0]],
            [x1, b[1], b[0]],
            [x0, b[1], b[0]],
            [0.0, n2[1], n2[0]],
        );
    }
    mb.push_quad(
        [x0, 0.0, tri[0][0]],
        [x0, 0.0, tri[1][0]],
        [x1, 0.0, tri[1][0]],
        [x1, 0.0, tri[0][0]],
        [0.0, -1.0, 0.0],
    );
}

fn gen_door(mb: &mut MeshBuilder, width: f64, height: f64, depth: f64, swing_deg: f64) {
    let frame = 0.08_f64.max(depth.max(0.02) * 0.15);
    let panel_w = width - frame * 2.0;
    let half_d = depth / 2.0;

    emit_cuboid(mb, [0.0, 0.0, -half_d], [frame, height, half_d]);
    emit_cuboid(mb, [width - frame, 0.0, -half_d], [width, height, half_d]);
    emit_cuboid(mb, [0.0, height, -half_d], [width, height + frame, half_d]);
    emit_cuboid(mb, [0.0, -0.02, -half_d], [width, 0.0, half_d]);

    let hinge = [frame, 0.0, -half_d];
    let a = -swing_deg.to_radians();
    let (cs, sn) = (a.cos(), a.sin());
    let rot = |x: f64, z: f64| -> (f64, f64) {
        (hinge[0] + x * cs - z * sn, hinge[2] + x * sn + z * cs)
    };
    let corners = [
        rot(0.0, 0.0),
        rot(panel_w, 0.0),
        rot(panel_w, depth),
        rot(0.0, depth),
    ];
    let y0 = 0.02_f64;
    let y1 = height - 0.02;
    let pts: Vec<[f64; 3]> = corners
        .iter()
        .map(|(x, z)| [*x, y0, *z])
        .chain(corners.iter().map(|(x, z)| [*x, y1, *z]))
        .collect();
    let (c0, c1, c2, c3) = (pts[0], pts[1], pts[2], pts[3]);
    let (d0, d1, d2, d3) = (pts[4], pts[5], pts[6], pts[7]);
    mb.push_quad(c0, c3, c2, c1, [0.0, -1.0, 0.0]);
    mb.push_quad(d0, d1, d2, d3, [0.0, 1.0, 0.0]);
    for (aa, bb, cc, dd) in [(c0, c1, d1, d0), (c1, c2, d2, d1), (c2, c3, d3, d2), (c3, c0, d0, d3)] {
        let ex = bb[0] - aa[0];
        let ez = bb[2] - aa[2];
        let l = (ex * ex + ez * ez).sqrt();
        let n = if l > 1e-9 { [ez / l, 0.0, -ex / l] } else { [0.0; 3] };
        mb.push_quad(aa, bb, cc, dd, n);
    }
}

fn gen_window(
    mb: &mut MeshBuilder,
    width: f64,
    height: f64,
    depth: f64,
    panes_x: u32,
    panes_y: u32,
) {
    let frame = (depth.max(0.02) * 0.12).clamp(0.02, width / 4.0);
    let half_d = depth / 2.0;
    let mut bar = |x0: f64, y0: f64, x1: f64, y1: f64| {
        let (x0, x1) = (x0.min(x1), x0.max(x1));
        let (y0, y1) = (y0.min(y1), y0.max(y1));
        if (x1 - x0).abs() < 1e-9 && (y1 - y0).abs() < 1e-9 {
            return;
        }
        emit_cuboid(mb, [x0, y0, -half_d], [x1, y1, half_d]);
    };
    bar(-width / 2.0, -height / 2.0, width / 2.0, -height / 2.0 + frame);
    bar(-width / 2.0, height / 2.0 - frame, width / 2.0, height / 2.0);
    bar(-width / 2.0, -height / 2.0, -width / 2.0 + frame, height / 2.0);
    bar(width / 2.0 - frame, -height / 2.0, width / 2.0, height / 2.0);

    let inner_w = width - 2.0 * frame;
    let inner_h = height - 2.0 * frame;
    let px = panes_x.max(1) as f64;
    let py = panes_y.max(1) as f64;
    for i in 1..panes_x.max(1) {
        let x = -width / 2.0 + frame + inner_w * (i as f64) / px;
        bar(x - frame / 2.0, -height / 2.0, x + frame / 2.0, height / 2.0);
    }
    for i in 1..panes_y.max(1) {
        let y = -height / 2.0 + frame + inner_h * (i as f64) / py;
        bar(-width / 2.0, y - frame / 2.0, width / 2.0, y + frame / 2.0);
    }
    let glass_t = depth * 0.06;
    emit_cuboid(
        mb,
        [-width / 2.0 + frame, -height / 2.0 + frame, -glass_t],
        [width / 2.0 - frame, height / 2.0 - frame, glass_t],
    );
}

fn gen_dimension(mb: &mut MeshBuilder, start: [f64; 3], end: [f64; 3]) {
    mb.push_line(start, end);
    let dx = end[0] - start[0];
    let dy = end[1] - start[1];
    let dz = end[2] - start[2];
    let len = (dx * dx + dy * dy + dz * dz).sqrt();
    if len < 1e-9 {
        return;
    }
    let u = [dx / len, dy / len, dz / len];
    let seed = if u[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
    let v = norm3(cross3(u, seed));
    let ah = (len * 0.08).clamp(0.05, 2.0);
    for (i, tip) in [start, end].into_iter().enumerate() {
        let sgn: f64 = if i == 0 { 1.0 } else { -1.0 };
        let w1 = [
            tip[0] + u[0] * ah * sgn + v[0] * ah * 0.35,
            tip[1] + u[1] * ah * sgn + v[1] * ah * 0.35,
            tip[2] + u[2] * ah * sgn + v[2] * ah * 0.35,
        ];
        let w2 = [
            tip[0] + u[0] * ah * sgn - v[0] * ah * 0.35,
            tip[1] + u[1] * ah * sgn - v[1] * ah * 0.35,
            tip[2] + u[2] * ah * sgn - v[2] * ah * 0.35,
        ];
        mb.push_line(tip, w1);
        mb.push_line(tip, w2);
        mb.push_line(
            [tip[0] - v[0] * ah * 0.35, tip[1] - v[1] * ah * 0.35, tip[2] - v[2] * ah * 0.35],
            [tip[0] + v[0] * ah * 0.35, tip[1] + v[1] * ah * 0.35, tip[2] + v[2] * ah * 0.35],
        );
    }
}

// ---------------------------------------------------------------- sweep/loft

/// Parallel transport frames along a polyline (origin, right, up).
fn path_frames(path: &[[f64; 3]]) -> Vec<([f64; 3], [f64; 3], [f64; 3])> {
    let mut frames = Vec::with_capacity(path.len());
    if path.is_empty() {
        return frames;
    }
    let t0 = {
        let j = (path.len() - 1).min(1);
        norm3([path[j][0] - path[0][0], path[j][1] - path[0][1], path[j][2] - path[0][2]])
    };
    let seed = if t0[1].abs() < 0.9 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
    let r0 = norm3(cross3(t0, seed));
    let u0 = norm3(cross3(t0, r0));
    frames.push((path[0], r0, u0));
    for i in 1..path.len() {
        let tangent = norm3([
            path[i][0] - path[i - 1][0],
            path[i][1] - path[i - 1][1],
            path[i][2] - path[i - 1][2],
        ]);
        let (_, prev_r, prev_u) = frames[i - 1];
        let proj = |v: [f64; 3], t: [f64; 3]| -> [f64; 3] {
            let d = dot3(v, t);
            [v[0] - t[0] * d, v[1] - t[1] * d, v[2] - t[2] * d]
        };
        let r = norm3(proj(prev_r, tangent));
        let u = norm3(proj(prev_u, tangent));
        frames.push((path[i], r, u));
    }
    frames
}

/// Tube swept along a polyline path with flat end caps.
fn gen_sweep(mb: &mut MeshBuilder, path: &[[f64; 3]], radius: f64, sides: u32) -> Result<(), String> {
    if path.len() < 2 {
        return Err("sweep path needs at least 2 points".into());
    }
    if radius <= 0.0 {
        return Err("sweep radius must be positive".into());
    }
    let frames = path_frames(path);
    let mut rings: Vec<Vec<[f64; 3]>> = Vec::with_capacity(frames.len());
    for (origin, right, up) in &frames {
        let mut ring = Vec::with_capacity(sides as usize);
        for i in 0..sides {
            let a = TAU * (i as f64) / sides as f64;
            let dx = right[0] * a.cos() + up[0] * a.sin();
            let dy = right[1] * a.cos() + up[1] * a.sin();
            let dz = right[2] * a.cos() + up[2] * a.sin();
            ring.push([origin[0] + radius * dx, origin[1] + radius * dy, origin[2] + radius * dz]);
        }
        rings.push(ring);
    }
    for r in 0..rings.len() - 1 {
        for i in 0..sides as usize {
            let j = (i + 1) % sides as usize;
            let a = rings[r][i];
            let b = rings[r][j];
            let c = rings[r + 1][j];
            let d = rings[r + 1][i];
            let n = tri_normal(a, c, b);
            mb.push_tri(a, c, b, n);
            let n = tri_normal(a, b, d);
            mb.push_tri(a, b, d, n);
        }
    }
    for ring in [&rings[0], rings.last().unwrap()] {
        let mut center = [0.0f64; 3];
        for v in ring.iter() {
            for k in 0..3 {
                center[k] += v[k];
            }
        }
        let n = ring.len() as f64;
        center = [center[0] / n, center[1] / n, center[2] / n];
        for i in 0..ring.len() {
            let j = (i + 1) % ring.len();
            let normal = tri_normal(center, ring[i], ring[j]);
            mb.push_tri(center, ring[i], ring[j], normal);
        }
    }
    Ok(())
}

/// Stitch consecutive equal-count section rings into flat-shaded quads.
fn stitch_sections(mb: &mut MeshBuilder, sections: &[Vec<[f64; 3]>]) -> Result<(), String> {
    if sections.len() < 2 {
        return Err("loft needs at least 2 sections".into());
    }
    let count = sections[0].len();
    if count < 3 || sections.iter().any(|s| s.len() != count) {
        return Err("loft sections must have equal vertex counts (>=3)".into());
    }
    for r in 0..sections.len() - 1 {
        let (lower, upper) = (&sections[r], &sections[r + 1]);
        for i in 0..count {
            let j = (i + 1) % count;
            let a = lower[i];
            let b = lower[j];
            let c = upper[j];
            let d = upper[i];
            let n = tri_normal(a, c, b);
            mb.push_tri(a, c, b, n);
            let n = tri_normal(a, b, d);
            mb.push_tri(a, b, d, n);
        }
    }
    Ok(())
}

/// Stitch sections + fan caps via XZ earclipping.
fn gen_loft(mb: &mut MeshBuilder, sections: &[Vec<[f64; 3]>]) -> Result<(), String> {
    stitch_sections(mb, sections)?;
    for cap in [sections.first().unwrap(), sections.last().unwrap()] {
        let planar: Vec<[f64; 2]> = cap.iter().map(|p| [p[0], p[2]]).collect();
        let tris = earclip_xz(&planar);
        for t in &tris {
            let a = cap[t[0]];
            let b = cap[t[1]];
            let c = cap[t[2]];
            let n = tri_normal(a, b, c);
            mb.push_tri(a, b, c, n);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------- nurbs

/// Clamped uniform knot vector for `n` control points of `degree`.
fn clamped_uniform_knots(n: usize, degree: usize) -> Vec<f64> {
    let total = n + degree + 1;
    (0..total)
        .map(|i| {
            if i <= degree {
                0.0
            } else if i >= n {
                1.0
            } else {
                (i - degree) as f64 / (n - degree) as f64
            }
        })
        .collect()
}

/// Sample a payload NURBS curve into `n` 3D points via truck.
fn sample_nurbs_curve(points: &[[f64; 4]], degree: u32, n: usize) -> Result<Vec<[f64; 3]>, String> {
    if points.len() < 2 {
        return Err("nurbs curve needs at least 2 control points".into());
    }
    let d = (degree as usize).min(points.len() - 1).max(1);
    let curve = payload_curve(points, &clamped_uniform_knots(points.len(), d), d as u32)?;
    let (lo, hi) = curve.range_tuple();
    Ok((0..n)
        .map(|i| {
            let t = lo + (hi - lo) * i as f64 / (n - 1) as f64;
            super::nurbs::curve_point3(&curve, t)
        })
        .collect())
}

/// NURBS surface: sample (su x sv) truck grid and stitch + boundary rims.
fn gen_nurbs_surface(
    mb: &mut MeshBuilder,
    cps: &Vec<Vec<[f64; 4]>>,
    u_degree: u32,
    v_degree: u32,
    u_knots: &[f64],
    v_knots: &[f64],
) -> Result<(), String> {
    if cps.is_empty() || cps[0].is_empty() {
        return Err("nurbs surface needs a rectangular control grid".into());
    }
    let du = (u_degree as usize).min(cps.len() - 1).max(1);
    let dv = (v_degree as usize).min(cps[0].len() - 1).max(1);
    let nus = payload_surface(cps, &clamped_uniform_knots(cps.len(), du),
        &clamped_uniform_knots(cps[0].len(), dv), du as u32, dv as u32)?;
    let _ = (u_knots, v_knots);
    let su = (cps.len() * 4).clamp(8, 96);
    let sv = (cps[0].len() * 4).clamp(8, 96);
    let ((ulo, uhi), (vlo, vhi)) = nus.range_tuple();
    let mut grid: Vec<Vec<[f64; 3]>> = Vec::with_capacity(su);
    for iu in 0..su {
        let u = ulo + (uhi - ulo) * iu as f64 / (su - 1) as f64;
        let mut row = Vec::with_capacity(sv);
        for iv in 0..sv {
            let v = vlo + (vhi - vlo) * iv as f64 / (sv - 1) as f64;
            row.push(super::nurbs::surface_point3(&nus, u, v));
        }
        grid.push(row);
    }
    stitch_sections(mb, &grid)
    // shell remain: rim lines through truck sample_curve of the boundary rows
}

/// NURBS loft: sample each section curve through truck and cap.
fn gen_nurbs_loft(
    mb: &mut MeshBuilder,
    sections: &Vec<Vec<[f64; 4]>>,
    degree: u32,
    samples_v: u32,
) -> Result<(), String> {
    if sections.len() < 2 {
        return Err("nurbs loft needs at least 2 section curves".into());
    }
    let sv = (samples_v as usize).clamp(3, 128);
    let mut rows: Vec<Vec<[f64; 3]>> = Vec::with_capacity(sections.len());
    for sec in sections {
        if sec.is_empty() {
            return Err("empty nurbs loft section".into());
        }
        rows.push(sample_nurbs_curve(sec, degree, sv)?);
    }
    gen_loft(mb, &rows)
}

/// NURBS sweep: sample profile + path through truck, parallel-transport
/// rings along the path.
fn gen_nurbs_sweep(
    mb: &mut MeshBuilder,
    path: &Vec<[f64; 4]>,
    profile: &Vec<[f64; 4]>,
    path_degree: u32,
    profile_degree: u32,
    samples_u: u32,
    samples_v: u32,
) -> Result<(), String> {
    if path.len() < 2 {
        return Err("nurbs sweep path needs at least 2 control points".into());
    }
    if profile.len() < 3 {
        return Err("nurbs sweep profile needs at least 3 control points".into());
    }
    let su = (samples_u as usize).max(2);
    let sv = (samples_v as usize).clamp(3, 128);
    let path_pts = sample_nurbs_curve(path, path_degree, su)?;
    let profile_pts3 = sample_nurbs_curve(profile, profile_degree, sv)?;

    let mut sections: Vec<Vec<[f64; 3]>> = Vec::with_capacity(su);
    let mut prev_normal: Option<[f64; 3]> = None;
    for (s, center) in path_pts.iter().enumerate() {
        let next = path_pts[(s + 1).min(su - 1)];
        let prev = path_pts[s.saturating_sub(1)];
        let tangent = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
        let tangent = norm3(tangent);
        let normal = match prev_normal {
            Some(n) => {
                let p = [
                    n[0] - tangent[0] * dot3(n, tangent),
                    n[1] - tangent[1] * dot3(n, tangent),
                    n[2] - tangent[2] * dot3(n, tangent),
                ];
                let pl = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
                if pl < 1e-6 { None } else { Some([p[0] / pl, p[1] / pl, p[2] / pl]) }
            }
            None => None,
        };
        let normal = normal.unwrap_or_else(|| {
            let reference = if tangent[0].abs() < 0.9 {
                [1.0, 0.0, 0.0]
            } else {
                [0.0, 0.0, 1.0]
            };
            let mut c = cross3(tangent, reference);
            let cl = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
            if cl < 1e-9 { c = [0.0, 1.0, 0.0]; } else { c = [c[0] / cl, c[1] / cl, c[2] / cl]; }
            c
        });
        let binormal = cross3(tangent, normal);
        let ring: Vec<[f64; 3]> = profile_pts3
            .iter()
            .map(|p| {
                [
                    center[0] + normal[0] * p[0] + binormal[0] * p[2],
                    center[1] + normal[1] * p[0] + binormal[1] * p[2],
                    center[2] + normal[2] * p[0] + binormal[2] * p[2],
                ]
            })
            .collect();
        sections.push(ring);
        prev_normal = Some(normal);
    }
    gen_loft(mb, &sections)
}
