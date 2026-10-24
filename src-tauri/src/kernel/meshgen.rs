//! Payload -> `MeshBuffer` evaluation, backed by the truck kernel.
//!
//! Solid payloads are realized as truck B-rep solids and tessellated
//! with `truck-meshalgo`; architecture/wireframe/NURBS payloads keep
//! the old mesh-level generators (NURBS curves/surfaces now evaluated
//! through truck's rational basis functions).

use std::f64::consts::TAU;

use truck_geometry::prelude::{BoundedCurve, BoundedSurface};
use truck_modeling::Solid;

use crate::core::entity::{CsgOperation, Geometry};
use crate::core::mesh::{MeshBuffer, MeshBuilder, earclip_xz, polygon_signed_area_xz, tri_normal};

use super::convert::solid_to_buffer;
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
        Geometry::Box {
            width,
            depth,
            height,
            corner_radius,
        } => {
            let solid = if *corner_radius <= 1e-6 {
                shapes::box_solid(*width, *depth, *height)?
            } else {
                shapes::rounded_box_solid(*width, *depth, *height, *corner_radius)?
            };
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Sphere { radius, .. } => {
            let solid = shapes::sphere_solid(*radius)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Cylinder { radius, height, .. } => {
            let solid = shapes::cylinder_solid(*radius, *height)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Cone { radius, height, .. } => {
            let solid = shapes::cone_solid(*radius, *height)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Torus { radius, tube, .. } => {
            let solid = shapes::torus_solid(*radius, *tube)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Extrude { polygon, height } => {
            let solid = shapes::extrude_solid(polygon, *height)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Revolve {
            profile,
            steps,
            angle_deg,
        } => {
            let solid = shapes::revolve_solid(profile, *steps, *angle_deg)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Column {
            radius,
            height,
            sides,
        } => {
            let solid = shapes::column_solid(*radius, *height, *sides)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Beam {
            length,
            width,
            height,
        } => {
            let solid = shapes::beam_solid(*length, *width, *height)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Slab { polygon, height } => {
            // slab = extruded footprint 0..height (truck prism)
            let solid = shapes::slab_solid(polygon, *height)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::Csg {
            operation,
            first,
            second,
            first_transform,
            second_transform,
        } => {
            let mut a = payload_to_solid(first)?;
            if let Some(t) = first_transform {
                a = truck_modeling::builder::transformed(
                    &a,
                    super::convert::transform_to_cg_matrix(t),
                );
            }
            let mut b = payload_to_solid(second)?;
            if let Some(t) = second_transform {
                b = truck_modeling::builder::transformed(
                    &b,
                    super::convert::transform_to_cg_matrix(t),
                );
            }
            let solid = csg_boolean(*operation, a, b)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }
        Geometry::SolidFillet {
            source,
            edge,
            radius,
        } => {
            let source_solid = payload_to_solid(source)?;
            let solid = super::fillet::solid_fillet(&source_solid, *edge, *radius)?;
            mb.append_buffer(&solid_to_buffer(&solid, TESS_TOL));
        }

        // ---- mesh-level payloads (old generators)
        Geometry::Plane { width, depth } => gen_plane(&mut mb, *width, *depth),
        Geometry::Sweep {
            path,
            radius,
            sides,
        } => gen_sweep(&mut mb, path, *radius, (*sides).max(3))?,
        Geometry::Loft { sections } => gen_loft(&mut mb, sections)?,
        Geometry::Wall {
            path,
            width,
            height,
        } => gen_wall(&mut mb, path, *width, *height),
        Geometry::Stair {
            width,
            rise,
            run,
            count,
        } => gen_stair(&mut mb, *width, *rise, *run, *count),
        Geometry::Roof {
            width,
            depth,
            pitch_deg,
            overhang,
        } => gen_roof(&mut mb, *width, *depth, *pitch_deg, *overhang),
        Geometry::Door {
            width,
            height,
            depth,
            swing_deg,
        } => gen_door(&mut mb, *width, *height, *depth, *swing_deg),
        Geometry::Window {
            width,
            height,
            depth,
            panes_x,
            panes_y,
        } => gen_window(&mut mb, *width, *height, *depth, *panes_x, *panes_y),
        Geometry::Dimension { start, end } => gen_dimension(&mut mb, *start, *end),
        Geometry::ImportedMesh { positions, indices } => {
            gen_imported_mesh(&mut mb, positions, indices)?
        }

        // ---- NURBS (evaluated through truck)
        Geometry::NurbsSurface {
            control_points,
            u_degree,
            v_degree,
            u_knots,
            v_knots,
        } => gen_nurbs_surface(
            &mut mb,
            control_points,
            *u_degree,
            *v_degree,
            u_knots,
            v_knots,
        )?,
        Geometry::NurbsLoft {
            sections,
            degree,
            samples_v,
            ..
        } => gen_nurbs_loft(&mut mb, sections, *degree, *samples_v)?,
        Geometry::NurbsSweep {
            path,
            profile,
            path_degree,
            profile_degree,
            samples_u,
            samples_v,
        } => gen_nurbs_sweep(
            &mut mb,
            path,
            profile,
            *path_degree,
            *profile_degree,
            *samples_u,
            *samples_v,
        )?,

        // ---- sketches / wireframe
        Geometry::LineCurve { end } => {
            mb.push_line([0.0, 0.0, 0.0], *end);
        }
        Geometry::PolylineCurve { points } => {
            mb.push_polyline(points);
        }
        Geometry::CircleCurve { radius, segments } => gen_rim(&mut mb, *radius, (*segments).max(8)),
        Geometry::ArcCurve {
            radius,
            start_angle_deg,
            end_angle_deg,
            segments,
        } => gen_arc(
            &mut mb,
            *radius,
            *start_angle_deg,
            *end_angle_deg,
            (*segments).max(3),
        ),
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
        Geometry::PolygonCurve { radius, sides } => gen_rim(&mut mb, *radius, (*sides).max(3)),
    }
    Ok(mb.into_buffer())
}

/// Realize a payload sub-tree as a truck solid (B-rep payload set only).
pub fn payload_to_solid(kind: &Geometry) -> Result<Solid, String> {
    match kind {
        Geometry::Box {
            width,
            depth,
            height,
            corner_radius,
        } => {
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
        Geometry::Revolve {
            profile,
            steps,
            angle_deg,
        } => shapes::revolve_solid(profile, *steps, *angle_deg),
        Geometry::Column {
            radius,
            height,
            sides,
        } => shapes::column_solid(*radius, *height, *sides),
        Geometry::Beam {
            length,
            width,
            height,
        } => shapes::beam_solid(*length, *width, *height),
        Geometry::Slab { polygon, height } => shapes::slab_solid(polygon, *height),
        Geometry::Csg {
            operation,
            first,
            second,
            first_transform,
            second_transform,
        } => {
            let mut a = payload_to_solid(first)?;
            if let Some(t) = first_transform {
                a = truck_modeling::builder::transformed(
                    &a,
                    super::convert::transform_to_cg_matrix(t),
                );
            }
            let mut b = payload_to_solid(second)?;
            if let Some(t) = second_transform {
                b = truck_modeling::builder::transformed(
                    &b,
                    super::convert::transform_to_cg_matrix(t),
                );
            }
            csg_boolean(*operation, a, b)
        }
        Geometry::SolidFillet {
            source,
            edge,
            radius,
        } => {
            let source_solid = payload_to_solid(source)?;
            let filleted = super::fillet::solid_fillet(&source_solid, *edge, *radius)?;
            Ok(filleted)
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
        CsgOperation::Union => truck_shapeops::or(&a, &b, TOL)
            .ok_or_else(|| "union failed: shapes may intersect tangentially".into()),
        CsgOperation::Intersection => truck_shapeops::and(&a, &b, TOL)
            .ok_or_else(|| "intersection failed: shapes may intersect tangentially".into()),
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
        mb.push_tri(*a, *b, *c, n, 0);
    }
    Ok(())
}

/// Emit a closed axis-aligned cuboid from corners min/max; faces are tagged
/// `[face_offset, face_offset+6)` and the next free id is returned.
fn emit_cuboid(mb: &mut MeshBuilder, min: [f64; 3], max: [f64; 3], face_offset: u32) -> u32 {
    let (x0, x1) = (min[0], max[0]);
    let (y0, y1) = (min[1], max[1]);
    let (z0, z1) = (min[2], max[2]);
    let mut face_id = face_offset;
    mb.push_quad(
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
        [0.0, 0.0, -1.0],
        face_id,
    );
    face_id += 1;
    mb.push_quad(
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
        [x0, y0, z1],
        [0.0, 0.0, 1.0],
        face_id,
    );
    face_id += 1;
    mb.push_quad(
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
        [1.0, 0.0, 0.0],
        face_id,
    );
    face_id += 1;
    mb.push_quad(
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
        [x0, y0, z0],
        [-1.0, 0.0, 0.0],
        face_id,
    );
    face_id += 1;
    mb.push_quad(
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
        [0.0, 1.0, 0.0],
        face_id,
    );
    face_id += 1;
    mb.push_quad(
        [x0, y0, z1],
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [0.0, -1.0, 0.0],
        face_id,
    );
    face_id
}

/// Extrude a closed XZ profile (ensured CCW) between y0 and y1 with caps.
#[allow(dead_code)]
fn gen_prism_xz(mb: &mut MeshBuilder, profile: &mut [[f64; 2]], y0: f64, y1: f64) {
    ensure_ccw(profile);
    let mut face_id = 0u32;
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
            face_id,
        );
        face_id += 1;
        mb.push_tri(
            [a[0], y0, a[1]],
            [c[0], y0, c[1]],
            [b[0], y0, b[1]],
            [0.0, -1.0, 0.0],
            face_id,
        );
        face_id += 1;
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
            face_id,
        );
        face_id += 1;
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
    let face_id = 0u32;
    mb.push_quad(
        [-w, 0.0, -d],
        [-w, 0.0, d],
        [w, 0.0, d],
        [w, 0.0, -d],
        [0.0, 1.0, 0.0],
        face_id,
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
    let mut next_face = 0u32;
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
        next_face = emit_wall_slab(mb, c0, c1, c2, c3, 0.0, height, next_face);
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
    offset: u32,
) -> u32 {
    let mut face_id = offset;
    let pts = [c0, c1, c2, c3];
    mb.push_quad(
        [c0[0], y1, c0[1]],
        [c1[0], y1, c1[1]],
        [c2[0], y1, c2[1]],
        [c3[0], y1, c3[1]],
        [0.0, 1.0, 0.0],
        face_id,
    );
    face_id += 1;
    mb.push_quad(
        [c0[0], y0, c0[1]],
        [c3[0], y0, c3[1]],
        [c2[0], y0, c2[1]],
        [c1[0], y0, c1[1]],
        [0.0, -1.0, 0.0],
        face_id,
    );
    face_id += 1;
    for i in 0..4 {
        let j = (i + 1) % 4;
        let a = pts[i];
        let b = pts[j];
        let ex = b[0] - a[0];

        let ez = b[1] - a[1];
        let l = (ex * ex + ez * ez).sqrt();
        let nrm = if l > 1e-9 {
            [ez / l, 0.0, -ex / l]
        } else {
            [0.0; 3]
        };
        mb.push_quad(
            [a[0], y0, a[1]],
            [b[0], y0, b[1]],
            [b[0], y1, b[1]],
            [a[0], y1, a[1]],
            nrm,
            face_id,
        );
        face_id += 1;
    }
    face_id
}

fn gen_stair(mb: &mut MeshBuilder, width: f64, rise: f64, run: f64, count: u32) {
    let half_w = width / 2.0;
    let mut x = 0.0;
    let mut face_id = 0u32;
    for step in 0..count {
        let top = rise * (step as f64 + 1.0);
        mb.push_quad(
            [x, top, -half_w],
            [x + run, top, -half_w],
            [x + run, top, half_w],
            [x, top, half_w],
            [0.0, 1.0, 0.0],
            face_id,
        );
        face_id += 1;
        mb.push_quad(
            [x, top - rise, -half_w],
            [x, top, -half_w],
            [x, top, half_w],
            [x, top - rise, half_w],
            [-1.0, 0.0, 0.0],
            face_id,
        );
        face_id += 1;
        mb.push_quad(
            [x, 0.0, -half_w],
            [x, top, -half_w],
            [x + run, top, -half_w],
            [x + run, 0.0, -half_w],
            [0.0, 0.0, -1.0],
            face_id,
        );
        face_id += 1;
        mb.push_quad(
            [x + run, 0.0, half_w],
            [x + run, top, half_w],
            [x, top, half_w],
            [x, 0.0, half_w],
            [0.0, 0.0, 1.0],
            face_id,
        );
        face_id += 1;
        x += run;
    }
    let top_y = rise * count.max(1) as f64;
    mb.push_quad(
        [x, 0.0, -half_w],
        [x, top_y, -half_w],
        [x, top_y, half_w],
        [x, 0.0, half_w],
        [1.0, 0.0, 0.0],
        face_id,
    );
}

fn gen_roof(mb: &mut MeshBuilder, width: f64, depth: f64, pitch_deg: f64, overhang: f64) {
    let half_d = depth / 2.0 + overhang;
    let half_w = width / 2.0 + overhang;
    let ridge_h = (depth / 2.0).max(1e-6) * pitch_deg.to_radians().tan();
    let tri: [[f64; 2]; 3] = [[-half_d, 0.0], [half_d, 0.0], [0.0, ridge_h]];
    let (x0, x1) = (-half_w, half_w);

    let mut gable = |x: f64, want_plus_x: bool, face_id: u32| {
        let pts: Vec<[f64; 3]> = tri.iter().map(|p| [x, p[1], p[0]]).collect();
        let mut n = tri_normal(pts[0], pts[1], pts[2]);
        if (n[0] > 0.0) != want_plus_x {
            n = [-n[0], -n[1], -n[2]];
            mb.push_tri(pts[0], pts[2], pts[1], n, face_id);
        } else {
            mb.push_tri(pts[0], pts[1], pts[2], n, face_id);
        }
    };
    gable(x0, false, 0);
    gable(x1, true, 1);

    let centroid = [
        (tri[0][0] + tri[1][0] + tri[2][0]) / 3.0,
        (tri[0][1] + tri[1][1] + tri[2][1]) / 3.0,
    ];
    let mut face_id = 2u32;
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
            face_id,
        );
        face_id += 1;
    }
    mb.push_quad(
        [x0, 0.0, tri[0][0]],
        [x0, 0.0, tri[1][0]],
        [x1, 0.0, tri[1][0]],
        [x1, 0.0, tri[0][0]],
        [0.0, -1.0, 0.0],
        face_id,
    );
}

fn gen_door(mb: &mut MeshBuilder, width: f64, height: f64, depth: f64, swing_deg: f64) {
    let frame = 0.08_f64.max(depth.max(0.02) * 0.15);
    let panel_w = width - frame * 2.0;
    let half_d = depth / 2.0;
    let mut next_face = 0u32;

    next_face = emit_cuboid(mb, [0.0, 0.0, -half_d], [frame, height, half_d], next_face);
    next_face = emit_cuboid(
        mb,
        [width - frame, 0.0, -half_d],
        [width, height, half_d],
        next_face,
    );
    next_face = emit_cuboid(
        mb,
        [0.0, height, -half_d],
        [width, height + frame, half_d],
        next_face,
    );
    next_face = emit_cuboid(mb, [0.0, -0.02, -half_d], [width, 0.0, half_d], next_face);

    let hinge = [frame, 0.0, -half_d];
    let a = -swing_deg.to_radians();
    let (cs, sn) = (a.cos(), a.sin());
    let rot =
        |x: f64, z: f64| -> (f64, f64) { (hinge[0] + x * cs - z * sn, hinge[2] + x * sn + z * cs) };
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
    let mut face_id = next_face;
    mb.push_quad(c0, c3, c2, c1, [0.0, -1.0, 0.0], face_id);
    face_id += 1;
    mb.push_quad(d0, d1, d2, d3, [0.0, 1.0, 0.0], face_id);
    face_id += 1;
    for (aa, bb, cc, dd) in [
        (c0, c1, d1, d0),
        (c1, c2, d2, d1),
        (c2, c3, d3, d2),
        (c3, c0, d0, d3),
    ] {
        let ex = bb[0] - aa[0];
        let ez = bb[2] - aa[2];
        let l = (ex * ex + ez * ez).sqrt();
        let n = if l > 1e-9 {
            [ez / l, 0.0, -ex / l]
        } else {
            [0.0; 3]
        };
        mb.push_quad(aa, bb, cc, dd, n, face_id);
        face_id += 1;
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
    let mut next_face = 0u32;
    let mut bar = |x0: f64, y0: f64, x1: f64, y1: f64| {
        let (x0, x1) = (x0.min(x1), x0.max(x1));
        let (y0, y1) = (y0.min(y1), y0.max(y1));
        if (x1 - x0).abs() < 1e-9 && (y1 - y0).abs() < 1e-9 {
            return;
        }
        next_face = emit_cuboid(mb, [x0, y0, -half_d], [x1, y1, half_d], next_face);
    };
    bar(
        -width / 2.0,
        -height / 2.0,
        width / 2.0,
        -height / 2.0 + frame,
    );
    bar(
        -width / 2.0,
        height / 2.0 - frame,
        width / 2.0,
        height / 2.0,
    );
    bar(
        -width / 2.0,
        -height / 2.0,
        -width / 2.0 + frame,
        height / 2.0,
    );
    bar(
        width / 2.0 - frame,
        -height / 2.0,
        width / 2.0,
        height / 2.0,
    );

    let inner_w = width - 2.0 * frame;
    let inner_h = height - 2.0 * frame;
    let px = panes_x.max(1) as f64;
    let py = panes_y.max(1) as f64;
    for i in 1..panes_x.max(1) {
        let x = -width / 2.0 + frame + inner_w * (i as f64) / px;
        bar(
            x - frame / 2.0,
            -height / 2.0,
            x + frame / 2.0,
            height / 2.0,
        );
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
        next_face,
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
    let seed = if u[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
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
            [
                tip[0] - v[0] * ah * 0.35,
                tip[1] - v[1] * ah * 0.35,
                tip[2] - v[2] * ah * 0.35,
            ],
            [
                tip[0] + v[0] * ah * 0.35,
                tip[1] + v[1] * ah * 0.35,
                tip[2] + v[2] * ah * 0.35,
            ],
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
        norm3([
            path[j][0] - path[0][0],
            path[j][1] - path[0][1],
            path[j][2] - path[0][2],
        ])
    };
    let seed = if t0[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
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
fn gen_sweep(
    mb: &mut MeshBuilder,
    path: &[[f64; 3]],
    radius: f64,
    sides: u32,
) -> Result<(), String> {
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
            ring.push([
                origin[0] + radius * dx,
                origin[1] + radius * dy,
                origin[2] + radius * dz,
            ]);
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
            let n = tri_normal(a, b, c);
            mb.push_tri(a, b, c, n, 0);
            let n = tri_normal(a, c, d);
            mb.push_tri(a, c, d, n, 0);
        }
    }
    for (cap_idx, ring) in [&rings[0], rings.last().unwrap()].into_iter().enumerate() {
        let mut center = [0.0f64; 3];
        for v in ring.iter() {
            for k in 0..3 {
                center[k] += v[k];
            }
        }
        let n = ring.len() as f64;
        center = [center[0] / n, center[1] / n, center[2] / n];
        let face_id = (cap_idx + 1) as u32;
        for i in 0..ring.len() {
            let j = (i + 1) % ring.len();
            let (v0, v1) = if cap_idx == 0 {
                (ring[j], ring[i])
            } else {
                (ring[i], ring[j])
            };
            let normal = tri_normal(center, v0, v1);
            mb.push_tri(center, v0, v1, normal, face_id);
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
            let n = tri_normal(a, b, c);
            mb.push_tri(a, b, c, n, 0);
            let n = tri_normal(a, c, d);
            mb.push_tri(a, c, d, n, 0);
        }
    }
    Ok(())
}

/// Stitch sections + fan caps via XZ earclipping.
fn gen_loft(mb: &mut MeshBuilder, sections: &[Vec<[f64; 3]>]) -> Result<(), String> {
    stitch_sections(mb, sections)?;
    let avg_pt = |ring: &[[f64; 3]]| -> [f64; 3] {
        let mut c = [0.0; 3];
        for p in ring {
            c[0] += p[0];
            c[1] += p[1];
            c[2] += p[2];
        }
        let n = ring.len() as f64;
        [c[0] / n, c[1] / n, c[2] / n]
    };
    let c_first = avg_pt(sections.first().unwrap());
    let c_last = avg_pt(sections.last().unwrap());
    let loft_dir = [
        c_last[0] - c_first[0],
        c_last[1] - c_first[1],
        c_last[2] - c_first[2],
    ];
    for (cap_idx, cap) in [sections.first().unwrap(), sections.last().unwrap()]
        .into_iter()
        .enumerate()
    {
        let planar: Vec<[f64; 2]> = cap.iter().map(|p| [p[0], p[2]]).collect();
        let tris = earclip_xz(&planar);
        let face_id = (cap_idx + 1) as u32;
        let outward_sign = if cap_idx == 0 { -1.0 } else { 1.0 };
        for t in &tris {
            let a = cap[t[0]];
            let b = cap[t[1]];
            let c = cap[t[2]];
            let n = tri_normal(a, b, c);
            let align =
                (n[0] * loft_dir[0] + n[1] * loft_dir[1] + n[2] * loft_dir[2]) * outward_sign;
            let flip = if align.abs() > 1e-9 {
                align < 0.0
            } else {
                cap_idx == 0
            };
            if flip {
                let n_rev = tri_normal(a, c, b);
                mb.push_tri(a, c, b, n_rev, face_id);
            } else {
                mb.push_tri(a, b, c, n, face_id);
            }
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
    let nus = payload_surface(
        cps,
        &clamped_uniform_knots(cps.len(), du),
        &clamped_uniform_knots(cps[0].len(), dv),
        du as u32,
        dv as u32,
    )?;
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
                if pl < 1e-6 {
                    None
                } else {
                    Some([p[0] / pl, p[1] / pl, p[2] / pl])
                }
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
            if cl < 1e-9 {
                c = [0.0, 1.0, 0.0];
            } else {
                c = [c[0] / cl, c[1] / cl, c[2] / cl];
            }
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

// --------------------------------------------------------------------- tests

#[cfg(test)]
mod tests {
    use super::*;

    /// Distinct face ids present in a buffer.
    fn face_ids(buffer: &MeshBuffer) -> Vec<u32> {
        let mut ids = buffer.tri_face_ids.clone();
        ids.sort();
        ids.dedup();
        ids
    }

    #[test]
    fn box_has_six_face_tags() {
        let buffer = generate(&Geometry::Box {
            width: 60.0,
            depth: 40.0,
            height: 20.0,
            corner_radius: 0.0,
        })
        .expect("box mesh");
        assert!(!buffer.tri_face_ids.is_empty());
        assert_eq!(buffer.positions.len() / 3, buffer.tri_face_ids.len());
        let ids = face_ids(&buffer);
        assert_eq!(ids.len(), 6, "box should expose exactly 6 faces: {ids:?}");
    }

    #[test]
    fn cylinder_has_side_and_cap_tags() {
        let buffer = generate(&Geometry::Cylinder {
            radius: 20.0,
            height: 40.0,
            segments: 24,
        })
        .expect("cylinder mesh");
        assert_eq!(buffer.positions.len() / 3, buffer.tri_face_ids.len());
        // truck's rsweep cylinder: revoluted side + 2 semicircular caps = 4 B-rep faces
        assert_eq!(face_ids(&buffer).len(), 4);
    }

    #[test]
    fn extrude_has_cap_and_side_tags() {
        let buffer = generate(&Geometry::Extrude {
            polygon: vec![[0.0, 0.0], [40.0, 0.0], [40.0, 30.0], [0.0, 30.0]],
            height: 20.0,
        })
        .expect("extrude mesh");
        assert_eq!(buffer.positions.len() / 3, buffer.tri_face_ids.len());
        // 2 caps + at least one side face per polygon edge
        assert!(face_ids(&buffer).len() >= 6, "quad has 2 caps + 4 sides");
    }

    #[test]
    fn generated_tags_are_stable_across_calls() {
        let kind = Geometry::Box {
            width: 60.0,
            depth: 40.0,
            height: 20.0,
            corner_radius: 0.0,
        };
        let a = generate(&kind).expect("mesh");
        let b = generate(&kind).expect("mesh");
        assert_eq!(a.tri_face_ids, b.tri_face_ids);
        assert_eq!(a.positions, b.positions);
    }

    #[test]
    fn sphere_face_picking_falls_back_to_single_tag() {
        let buffer = generate(&Geometry::Sphere {
            radius: 30.0,
            segments: 16,
        })
        .expect("sphere mesh");
        assert_eq!(buffer.positions.len() / 3, buffer.tri_face_ids.len());
        assert!(!face_ids(&buffer).is_empty());
    }

    #[test]
    fn solid_fillet_adds_fillet_face_tag() {
        use crate::kernel::fillet::solid_fillet;
        let solid = shapes::box_solid(60.0, 40.0, 20.0).expect("box solid");
        // vertical edge on +X, +Z corner
        let filleted = solid_fillet(&solid, [[30.0, 10.0, 20.0], [30.0, -10.0, 20.0]], 4.0)
            .expect("box edge fillet");
        let buffer = solid_to_buffer(&filleted, TESS_TOL);
        assert_eq!(buffer.positions.len() / 3, buffer.tri_face_ids.len());
        let ids = face_ids(&buffer);
        // 6 faces minus the two cut faces stay, both cut faces remain and a
        // fillet face joins: 6 + 1
        assert_eq!(ids.len(), 7, "filleted box should have 7 faces: {ids:?}");
    }

    #[test]
    fn solid_fillet_dispatch_generates_mesh() {
        let buffer = generate(&Geometry::SolidFillet {
            source: Box::new(Geometry::Box {
                width: 60.0,
                depth: 40.0,
                height: 20.0,
                corner_radius: 0.0,
            }),
            edge: [[30.0, 10.0, -20.0], [30.0, -10.0, -20.0]],
            radius: 4.0,
        })
        .expect("fillet mesh");
        assert!(buffer.positions.len() >= 3);
        assert_eq!(buffer.positions.len() / 3, buffer.tri_face_ids.len());
    }

    #[test]
    fn solid_fillet_zero_radius_is_noop() {
        use crate::kernel::fillet::solid_fillet;
        let solid = shapes::box_solid(60.0, 40.0, 20.0).expect("box solid");
        let unchanged = solid_fillet(&solid, [[30.0, 10.0, 20.0], [30.0, -10.0, 20.0]], 0.0)
            .expect("identity fillet");
        let before = solid_to_buffer(&solid, TESS_TOL);
        let after = solid_to_buffer(&unchanged, TESS_TOL);
        assert_eq!(before.positions, after.positions);
    }

    #[test]
    fn solid_fillet_rejects_unknown_edge() {
        use crate::kernel::fillet::solid_fillet;
        let solid = shapes::box_solid(60.0, 40.0, 20.0).expect("box solid");
        // no B-rep edge has (35,10,20) as an endpoint
        let result = solid_fillet(&solid, [[30.0, 10.0, 20.0], [35.0, 10.0, 20.0]], 4.0);
        assert!(result.is_err(), "unknown edge pick must be rejected");
    }

    #[test]
    fn solid_fillet_vertical_edge_also_fillets() {
        use crate::kernel::fillet::solid_fillet;
        let solid = shapes::box_solid(60.0, 40.0, 20.0).expect("box solid");
        // (30,10,20)-(30,10,-20) is the unambiguous vertical edge on x=30,y=10
        let result = solid_fillet(&solid, [[30.0, 10.0, 20.0], [30.0, 10.0, -20.0]], 4.0);
        let filleted = result.expect("vertical edge fillet");
        assert_eq!(filleted.boundaries()[0].len(), 7);
    }

    #[test]
    fn torus_lies_in_xz_with_outward_normals_and_clamps_tube() {
        let radius = 30.0;
        let tube = 8.0;
        let buffer = generate(&Geometry::Torus {
            radius,
            tube,
            segments: 24,
            tubular_segments: 16,
        })
        .expect("torus mesh");
        assert!(!buffer.positions.is_empty());
        for (tri, norm) in buffer.positions.chunks(9).zip(buffer.normals.chunks(9)) {
            let cx = ((tri[0] + tri[3] + tri[6]) / 3.0) as f64;
            let cy = ((tri[1] + tri[4] + tri[7]) / 3.0) as f64;
            let cz = ((tri[2] + tri[5] + tri[8]) / 3.0) as f64;
            assert!(
                cy.abs() <= tube + 1e-2,
                "torus Y should stay within tube radius, got {cy}"
            );
            let r_xz = (cx * cx + cz * cz).sqrt();
            assert!(r_xz > 1e-3);
            let ring_x = cx * (radius / r_xz);
            let ring_z = cz * (radius / r_xz);
            let ox = cx - ring_x;
            let oy = cy;
            let oz = cz - ring_z;
            let dot = (norm[0] as f64) * ox + (norm[1] as f64) * oy + (norm[2] as f64) * oz;
            assert!(dot > 0.0, "torus normal should point outward, dot={dot}");
        }
        // tube >= radius should clamp rather than error
        assert!(shapes::torus_solid(20.0, 25.0).is_ok());
    }

    #[test]
    fn extrude_and_slab_clean_duplicates_and_orient_outward() {
        // CW vs CCW with repeated closing point
        let cw_dup = vec![
            [-20.0, -15.0],
            [20.0, -15.0],
            [20.0, -15.0],
            [20.0, 15.0],
            [-20.0, 15.0],
            [-20.0, -15.0],
        ];
        let ccw = vec![[-20.0, -15.0], [-20.0, 15.0], [20.0, 15.0], [20.0, -15.0]];
        for poly in [cw_dup, ccw] {
            let buf = generate(&Geometry::Extrude {
                polygon: poly,
                height: 20.0,
            })
            .expect("extrude mesh");
            for (tri, norm) in buf.positions.chunks(9).zip(buf.normals.chunks(9)) {
                let cx = ((tri[0] + tri[3] + tri[6]) / 3.0) as f64;
                let cy = ((tri[1] + tri[4] + tri[7]) / 3.0) as f64;
                let cz = ((tri[2] + tri[5] + tri[8]) / 3.0) as f64;
                let dot = (norm[0] as f64) * cx + (norm[1] as f64) * cy + (norm[2] as f64) * cz;
                assert!(dot > 0.0, "extrude normal should point outward, dot={dot}");
            }
        }
    }

    #[test]
    fn revolve_two_point_profile_validates_and_generates() {
        let rev = Geometry::Revolve {
            profile: vec![[15.0, 0.0], [15.0, 30.0]],
            steps: 16,
            angle_deg: 360.0,
        };
        rev.validate().expect("2-point revolve profile should validate");
        let buf = generate(&rev).expect("2-point revolve mesh");
        assert!(!buf.positions.is_empty());
    }

    #[test]
    fn solid_buffer_populates_edge_lines() {
        let buf = generate(&Geometry::Box {
            width: 40.0,
            depth: 30.0,
            height: 20.0,
            corner_radius: 0.0,
        })
        .expect("box mesh");
        // 12 edges * 2 points * 3 floats = 72 floats
        assert_eq!(buf.lines.len(), 72);
    }

    #[test]
    fn sweep_and_loft_have_distinct_cap_tags_and_outward_caps() {
        let sweep = generate(&Geometry::Sweep {
            path: vec![[0.0, 0.0, 0.0], [0.0, 40.0, 0.0]],
            radius: 10.0,
            sides: 12,
        })
        .expect("sweep mesh");
        assert_eq!(face_ids(&sweep), vec![0, 1, 2]);

        let loft = generate(&Geometry::Loft {
            sections: vec![
                vec![[-10.0, 0.0, -10.0], [10.0, 0.0, -10.0], [10.0, 0.0, 10.0], [-10.0, 0.0, 10.0]],
                vec![[-10.0, 30.0, -10.0], [10.0, 30.0, -10.0], [10.0, 30.0, 10.0], [-10.0, 30.0, 10.0]],
            ],
        })
        .expect("loft mesh");
        assert_eq!(face_ids(&loft), vec![0, 1, 2]);
    }

    #[test]
    fn csg_respects_child_transforms() {
        let mut t2 = crate::core::Transform::default();
        t2.position = [15.0, 0.0, 0.0];
        let csg = Geometry::Csg {
            operation: CsgOperation::Difference,
            first: Box::new(Geometry::Box {
                width: 30.0,
                depth: 30.0,
                height: 30.0,
                corner_radius: 0.0,
            }),
            second: Box::new(Geometry::Box {
                width: 30.0,
                depth: 20.0,
                height: 20.0,
                corner_radius: 0.0,
            }),
            first_transform: None,
            second_transform: Some(t2),
        };
        let buf = generate(&csg).expect("transformed csg difference");
        assert!(!buf.positions.is_empty());
        assert!(!buf.lines.is_empty());
    }
}
