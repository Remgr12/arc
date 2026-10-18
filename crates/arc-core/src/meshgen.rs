//! Generators that turn parametric `Geometry` payloads into `MeshBuffer`s.
//!
//! All shapes are produced in local space; the entity `Transform` orients
//! them in the world. Triangles are flat-shaded (facet normals), curves are
//! emitted as cheap line lists.

use crate::entity::Geometry;
use crate::mesh::{earclip_xz, polygon_signed_area_xz, MeshBuilder, MeshBuffer};

/// Generate local mesh for the given geometry.
pub fn generate(kind: &Geometry) -> Result<MeshBuffer, String> {
    let mut mb = MeshBuilder::new();
    match kind {
        Geometry::Box { width, depth, height, corner_radius } => {
            gen_box(&mut mb, *width, *depth, *height, *corner_radius)
        }
        Geometry::Sphere { radius, segments } => gen_sphere(&mut mb, *radius, (*segments).max(4)),
        Geometry::Cylinder { radius, height, segments } => {
            gen_cylinder(&mut mb, *radius, *height, (*segments).max(3))
        }
        Geometry::Cone { radius, height, segments } => {
            gen_cone(&mut mb, *radius, *height, (*segments).max(3))
        }
        Geometry::Torus { radius, tube, segments, tubular_segments } => gen_torus(
            &mut mb,
            *radius,
            *tube,
            (*segments).max(6),
            (*tubular_segments).max(6),
        ),
        Geometry::Plane { width, depth } => gen_plane(&mut mb, *width, *depth),
        Geometry::LineCurve { end } => {
            mb.push_line([0.0, 0.0, 0.0], *end);
        }
        Geometry::PolylineCurve { points } => {
            mb.push_polyline(points);
        }
        Geometry::CircleCurve { radius, segments } => {
            gen_circle(&mut mb, *radius, (*segments).max(8))
        }
        Geometry::ArcCurve {
            radius,
            start_angle_deg,
            end_angle_deg,
            segments,
        } => gen_arc(&mut mb, *radius, *start_angle_deg, *end_angle_deg, (*segments).max(3)),
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
        Geometry::PolygonCurve { radius, sides } => gen_ring(&mut mb, *radius, (*sides).max(3)),
        Geometry::Extrude { polygon, height } => gen_extrude(&mut mb, polygon, *height)?,
        Geometry::Revolve { profile, steps, angle_deg } => {
            gen_revolve(&mut mb, profile, (*steps).max(3), *angle_deg)?
        }
        Geometry::Sweep { path, radius, sides } => {
            gen_sweep(&mut mb, path, *radius, (*sides).max(3))?
        }
        Geometry::Loft { sections } => gen_loft(&mut mb, sections)?,
        Geometry::Wall { path, width, height } => gen_wall(&mut mb, path, *width, *height),
        Geometry::Stair { width, rise, run, count } => {
            gen_stair(&mut mb, *width, *rise, *run, *count)
        }
        Geometry::Slab { polygon, height } => gen_slab(&mut mb, polygon, *height)?,
        Geometry::Roof { width, depth, pitch_deg, overhang } => {
            gen_roof(&mut mb, *width, *depth, *pitch_deg, *overhang)
        }
        Geometry::Column { radius, height, sides } => {
            gen_column(&mut mb, *radius, *height, (*sides).max(3))
        }
        Geometry::Beam { length, width, height } => gen_beam(&mut mb, *length, *width, *height),
        Geometry::Door { width, height, depth, swing_deg } => {
            gen_door(&mut mb, *width, *height, *depth, *swing_deg)
        }
        Geometry::Window { width, height, depth, panes_x, panes_y } => {
            gen_window(&mut mb, *width, *height, *depth, *panes_x, *panes_y)
        }
        Geometry::Dimension { start, end } => gen_dimension(&mut mb, *start, *end),
        Geometry::NurbsSurface { control_points, u_degree, v_degree, u_knots, v_knots } => {
            gen_nurbs_surface(&mut mb, control_points, *u_degree, *v_degree, u_knots, v_knots)?
        }
        Geometry::NurbsLoft { sections, degree, samples_v, .. } => {
            gen_nurbs_loft(&mut mb, sections, *degree, *samples_v)?
        }
        Geometry::NurbsSweep { path, profile, path_degree, profile_degree, samples_u, samples_v } => {
            gen_nurbs_sweep(&mut mb, path, profile, *path_degree, *profile_degree, *samples_u, *samples_v)?
        }
    }
    Ok(mb.into_buffer())
}

// ------------------------------------------------------------------ helpers

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
        // outward normal for CCW polygon in XZ (viewed from +Y)
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

/// Reverse the polygon in place if it is clockwise (needed for outward wall normals).
fn ensure_ccw(profile: &mut [[f64; 2]]) {
    if polygon_signed_area_xz(profile) < 0.0 {
        profile.reverse();
    }
}

/// Ring points (x, z) on radius r from angle 0..2π, in increasing-angle order.
fn ring_xz(r: f64, steps: u32, at_y: f64) -> Vec<[f64; 3]> {
    (0..steps)
        .map(|i| {
            let a = std::f64::consts::TAU * (i as f64) / steps as f64;
            [r * a.cos(), at_y, r * a.sin()]
        })
        .collect()
}

/// Flat cap disc from a center to a ring. `flip` false → normal +Y.
fn emit_cap_disc(mb: &mut MeshBuilder, center: [f64; 3], ring: &[[f64; 3]], flip: bool) {
    let n = [0.0f64, if flip { -1.0 } else { 1.0 }, 0.0];
    for i in 0..ring.len() {
        let j = (i + 1) % ring.len();
        if flip {
            mb.push_tri(center, ring[i], ring[j], n);
        } else {
            mb.push_tri(center, ring[j], ring[i], n);
        }
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

// --------------------------------------------------------------- primitives

fn gen_box(mb: &mut MeshBuilder, width: f64, depth: f64, height: f64, corner_radius: f64) {
    if corner_radius <= 1e-6 {
        emit_cuboid(
            mb,
            [-width / 2.0, -height / 2.0, -depth / 2.0],
            [width / 2.0, height / 2.0, depth / 2.0],
        );
        return;
    }
    // Rounded box: rounded-rect profile in XZ extruded along Y.
    let radius = corner_radius
        .clamp(0.0, width / 2.0 - 1e-6)
        .min(depth / 2.0 - 1e-6);
    let half_w = width / 2.0 - radius;
    let half_d = depth / 2.0 - radius;
    let per_corner = 8;
    let corners: [([f64; 2], f64); 4] = [
        ([half_w, -half_d], -90.0),
        ([half_w, half_d], 0.0),
        ([-half_w, half_d], 90.0),
        ([-half_w, -half_d], 180.0),
    ];
    let mut profile: Vec<[f64; 2]> = Vec::new();
    for (center, start_deg) in corners {
        for i in 0..per_corner {
            let a = (start_deg + 90.0 * (i as f64) / per_corner as f64).to_radians();
            profile.push([center[0] + radius * a.cos(), center[1] + radius * a.sin()]);
        }
    }
    gen_prism_xz(mb, &mut profile, -height / 2.0, height / 2.0);
}

fn gen_sphere(mb: &mut MeshBuilder, radius: f64, segments: u32) {
    let s = segments;
    let rings = (segments / 2).max(4);
    // θ ∈ [0, π]: 0 = north pole, π = south pole.
    let theta_at = |i: u32| std::f64::consts::PI * (i as f64) / rings as f64;
    let p = |phi: f64, theta: f64| {
        [radius * phi.cos() * theta.sin(), radius * theta.cos(), radius * phi.sin() * theta.sin()]
    };
    for i in 0..rings {
        let (th0, th1) = (theta_at(i), theta_at(i + 1));
        let bottom = i == 0;
        let top = i == rings - 1;
        for j in 0..s {
            let a0 = std::f64::consts::TAU * (j as f64) / s as f64;
            let a1 = std::f64::consts::TAU * (j as f64 + 1.0) / s as f64;
            let p00 = p(a0, th0);
            let p01 = p(a1, th0);
            let p10 = p(a0, th1);
            let p11 = p(a1, th1);
            if bottom && top {
                continue; // degenerate configuration
            }
            if bottom {
                // p00 == p01 == north pole (θ=0): fan the pole to the lower ring
                let n = crate::mesh::tri_normal(p00, p11, p10);
                mb.push_tri(p00, p11, p10, n);
            } else if top {
                // p10 == p11 == south pole (θ=π): fan the upper ring to it
                let n = crate::mesh::tri_normal(p00, p01, p10);
                mb.push_tri(p00, p01, p10, n);
            } else {
                let n = crate::mesh::tri_normal(p10, p00, p01);
                mb.push_tri(p10, p00, p01, n);
                let n = crate::mesh::tri_normal(p10, p01, p11);
                mb.push_tri(p10, p01, p11, n);
            }
        }
    }
}

fn gen_cylinder(mb: &mut MeshBuilder, radius: f64, height: f64, segments: u32) {
    gen_lathe(mb, &[[radius, 0.0], [radius, height]], segments, 360.0, true);
}

fn gen_cone(mb: &mut MeshBuilder, radius: f64, height: f64, segments: u32) {
    gen_lathe(mb, &[[radius, 0.0], [0.0, height]], segments, 360.0, true);
}

fn gen_torus(mb: &mut MeshBuilder, radius: f64, tube: f64, segments: u32, tubular: u32) {
    let p = |u: f64, v: f64| {
        [
            (radius + tube * v.cos()) * u.cos(),
            tube * v.sin(),
            (radius + tube * v.cos()) * u.sin(),
        ]
    };
    for i in 0..segments {
        let u0 = std::f64::consts::TAU * (i as f64) / segments as f64;
        let u1 = std::f64::consts::TAU * (i as f64 + 1.0) / segments as f64;
        for j in 0..tubular {
            let v0 = std::f64::consts::TAU * (j as f64) / tubular as f64;
            let v1 = std::f64::consts::TAU * (j as f64 + 1.0) / tubular as f64;
            let a = p(u0, v0);
            let b = p(u1, v0);
            let c = p(u1, v1);
            let d = p(u0, v1);
            let n = crate::mesh::tri_normal(a, b, c);
            mb.push_quad(a, b, c, d, n);
        }
    }
}

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

// ------------------------------------------------------------------- curves

fn gen_circle(mb: &mut MeshBuilder, radius: f64, segments: u32) {
    let mut pts = Vec::with_capacity(segments as usize + 1);
    for i in 0..=segments {
        let a = std::f64::consts::TAU * (i as f64) / segments as f64;
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

fn gen_ring(mb: &mut MeshBuilder, radius: f64, sides: u32) {
    let mut pts = Vec::with_capacity(sides as usize + 1);
    for i in 0..=sides {
        let a = std::f64::consts::TAU * (i as f64) / sides as f64;
        pts.push([radius * a.cos(), 0.0, radius * a.sin()]);
    }
    mb.push_polyline(&pts);
}

// ------------------------------------------------------------------- solids

fn recenter_polygon(polygon: &[[f64; 2]]) -> Vec<[f64; 2]> {
    let n = polygon.len() as f64;
    let (mut cx, mut cz) = (0.0, 0.0);
    for p in polygon {
        cx += p[0];
        cz += p[1];
    }
    polygon
        .iter()
        .map(|p| [p[0] - cx / n, p[1] - cz / n])
        .collect()
}

fn gen_extrude(mb: &mut MeshBuilder, polygon: &[[f64; 2]], height: f64) -> Result<(), String> {
    if polygon.len() < 3 {
        return Err("extrude polygon needs at least 3 points".into());
    }
    if height <= 0.0 {
        return Err("extrude height must be positive".into());
    }
    let mut profile = recenter_polygon(polygon);
    gen_prism_xz(mb, &mut profile, -height / 2.0, height / 2.0);
    Ok(())
}

/// Lathe: revolve an XZ profile (x = radius, z = height) around local Y.
fn gen_lathe(mb: &mut MeshBuilder, profile: &[[f64; 2]], steps: u32, angle_deg: f64, full: bool) {
    let steps = steps.max(2);
    let angle_at = |i: u32| -> f64 {
        if full {
            std::f64::consts::TAU * (i as f64) / steps as f64
        } else {
            angle_deg.to_radians() * (i as f64) / (steps - 1) as f64
        }
    };
    let p = |r: f64, ang: f64, y: f64| -> [f64; 3] {
        [r.max(0.0) * ang.cos(), y, r.max(0.0) * ang.sin()]
    };

    // Side surface.
    for i in 0..steps.saturating_sub(if full { 1 } else { 0 }) {
        let (a0, a1) = (angle_at(i), angle_at(i + 1));
        for k in 0..profile.len() - 1 {
            let (r0, y0) = (profile[k][0], profile[k][1]);
            let (r1, y1) = (profile[k + 1][0], profile[k + 1][1]);
            let v00 = p(r0, a0, y0);
            let v01 = p(r0, a1, y0);
            let v10 = p(r1, a0, y1);
            let v11 = p(r1, a1, y1);
            if (v10[0] - v11[0]).abs() < 1e-12
                && (v10[2] - v11[2]).abs() < 1e-12
                && (v10[1] - v11[1]).abs() < 1e-12
            {
                let n = crate::mesh::tri_normal(v00, v10, v01);
                mb.push_tri(v00, v10, v01, n);
            } else {
                let n = crate::mesh::tri_normal(v00, v10, v11);
                mb.push_tri(v00, v10, v11, n);
                let n = crate::mesh::tri_normal(v00, v11, v01);
                mb.push_tri(v00, v11, v01, n);
            }
        }
    }

    if full {
        // Disc caps where an end has radius > 0.
        for (idx, flip) in [(0usize, true), (profile.len() - 1, false)] {
            let (r, y) = (profile[idx][0], profile[idx][1]);
            if r < 1e-9 {
                continue;
            }
            let ring = ring_xz(r, steps, y);
            emit_cap_disc(mb, [0.0, y, 0.0], &ring, flip);
        }
    } else {
        // Close the two seam ends with flat strips along the profile. The
        // strip face points opposite the sweep direction at each seam.
        for (idx, sgn) in [(0u32, 1.0f64), (steps, -1.0f64)] {
            let ang = angle_at(idx.min(steps));
            let n = [sgn * ang.sin(), 0.0, -sgn * ang.cos()];
            for k in 0..profile.len() - 1 {
                let y0 = profile[k][1];
                let y1 = profile[k + 1][1];
                let r0 = profile[k][0].max(0.0);
                let r1 = profile[k + 1][0].max(0.0);
                if (y1 - y0).abs() < 1e-9 && (r1 - r0).abs() < 1e-9 {
                    continue;
                }
                let a = p(0.0, ang, y0);
                let b = p(r0, ang, y0);
                let c = p(r1, ang, y1);
                let d = p(0.0, ang, y1);
                mb.push_quad(a, b, c, d, n);
            }
        }
    }
}

fn gen_revolve(mb: &mut MeshBuilder, profile: &[[f64; 2]], steps: u32, angle_deg: f64) -> Result<(), String> {
    if profile.len() < 2 {
        return Err("revolve profile needs at least 2 points".into());
    }
    let full = (angle_deg - 360.0).abs() < 1e-6;
    gen_lathe(mb, profile, steps, angle_deg, full);
    Ok(())
}

/// Parallel transport frames along a polyline (origin, tangent-right, up).
fn path_frames(path: &[[f64; 3]]) -> Vec<([f64; 3], [f64; 3], [f64; 3])> {
    let mut frames = Vec::with_capacity(path.len());
    if path.is_empty() {
        return frames;
    }
    // initial arbitrary perpendicular frame
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
        let r = {
            let proj = [tangent[0] * dot3(prev_r, tangent), tangent[1] * dot3(prev_r, tangent), tangent[2] * dot3(prev_r, tangent)];
            norm3([prev_r[0] - proj[0], prev_r[1] - proj[1], prev_r[2] - proj[2]])
        };
        let u = {
            let proj = [tangent[0] * dot3(prev_u, tangent), tangent[1] * dot3(prev_u, tangent), tangent[2] * dot3(prev_u, tangent)];
            norm3([prev_u[0] - proj[0], prev_u[1] - proj[1], prev_u[2] - proj[2]])
        };
        frames.push((path[i], r, u));
    }
    frames
}

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
            let a = std::f64::consts::TAU * (i as f64) / sides as f64;
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
            let n = crate::mesh::tri_normal(a, c, b);
            mb.push_tri(a, c, b, n);
            let n = crate::mesh::tri_normal(a, b, d);
            mb.push_tri(a, b, d, n);
        }
    }
    // scatter end caps (fan from ring centroid)
    for (ring, dir) in [(&rings[0], -1.0f64), (rings.last().unwrap(), 1.0f64)] {
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
            let normal = crate::mesh::tri_normal(center, ring[i], ring[j]);
            let normal = [normal[0] * dir, normal[1] * dir, normal[2] * dir];
            mb.push_tri(center, ring[i], ring[j], normal);
        }
    }
    Ok(())
}

/// Stitch consecutive equal-count section rings into quad triangles,
/// without end caps.
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
            let n = crate::mesh::tri_normal(a, c, b);
            mb.push_tri(a, c, b, n);
            let n = crate::mesh::tri_normal(a, b, d);
            mb.push_tri(a, b, d, n);
        }
    }
    Ok(())
}

// ------------------------------------------------------------------- nurbs

/// Cox-de Boor basis value N_{i,degree}(t) over `knots`.
fn nurbs_basis(i: usize, degree: usize, knots: &[f64], t: f64) -> f64 {
    if degree == 0 {
        let last = knots[knots.len() - 1];
        let in_span = t >= knots[i] && t < knots[i + 1];
        let at_end = (t - last).abs() < 1e-12 && knots[i + 1] >= last && knots[i] < last;
        if in_span || at_end {
            1.0
        } else {
            0.0
        }
    } else {
        let left_den = knots[i + degree] - knots[i];
        let right_den = knots[i + degree + 1] - knots[i + 1];
        let left = if left_den.abs() < 1e-12 {
            0.0
        } else {
            (t - knots[i]) / left_den * nurbs_basis(i, degree - 1, knots, t)
        };
        let right = if right_den.abs() < 1e-12 {
            0.0
        } else {
            (knots[i + degree + 1] - t) / right_den * nurbs_basis(i + 1, degree - 1, knots, t)
        };
        left + right
    }
}

/// Clamped uniform knot vector for `n` control points of `degree`.
pub fn clamped_uniform_knots(n: usize, degree: usize) -> Vec<f64> {
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

/// Homogeneous NURBS curve evaluation at `t`: returns [x, y, z, w] sums
/// without the perspective divide.
fn nurbs_curve_h(points: &[[f64; 4]], knots: &[f64], degree: usize, t: f64) -> [f64; 4] {
    let n = points.len();
    if n == 0 {
        return [0.0; 4];
    }
    let d = degree.min(n - 1);
    let lo = knots.get(d).copied().unwrap_or(0.0);
    let hi = knots
        .get(knots.len().saturating_sub(d + 1))
        .copied()
        .unwrap_or(lo);
    let t = if hi > lo { t.clamp(lo, hi) } else { lo };
    let mut out = [0.0f64; 4];
    for (i, p) in points.iter().enumerate() {
        if i + d + 1 >= knots.len() {
            break;
        }
        let b = nurbs_basis(i, d, knots, t);
        if b == 0.0 {
            continue;
        }
        out[0] += b * p[0] * p[3];
        out[1] += b * p[1] * p[3];
        out[2] += b * p[2] * p[3];
        out[3] += b * p[3];
    }
    if out[3].abs() < 1e-12 {
        let p = points[0];
        let w = if p[3] == 0.0 { 1.0 } else { p[3] };
        return [p[0] * w, p[1] * w, p[2] * w, w];
    }
    out
}

/// Rational (divided) NURBS curve evaluation at `t`.
fn nurbs_curve_point(points: &[[f64; 4]], knots: &[f64], degree: usize, t: f64) -> [f64; 3] {
    let h = nurbs_curve_h(points, knots, degree, t);
    if h[3].abs() < 1e-12 {
        return [h[0], h[1], h[2]];
    }
    [h[0] / h[3], h[1] / h[3], h[2] / h[3]]
}

/// Tensor-product NURBS surface point at (u, v).
fn nurbs_surface_point(
    cps: &[Vec<[f64; 4]>],
    u_knots: &[f64],
    du: usize,
    v_knots: &[f64],
    dv: usize,
    u: f64,
    v: f64,
) -> [f64; 3] {
    let nv = cps.first().map(|r| r.len()).unwrap_or(0);
    if nv == 0 {
        return [0.0; 3];
    }
    let mut q: Vec<[f64; 4]> = Vec::with_capacity(nv);
    for j in 0..nv {
        let col: Vec<[f64; 4]> = (0..cps.len()).map(|i| cps[i][j]).collect();
        q.push(nurbs_curve_h(&col, u_knots, du, u));
    }
    nurbs_curve_point(&q, v_knots, dv, v)
}

/// Open NURBS surface shell: sample a (su x sv) grid and stitch quads.
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
    let su = (cps.len() * 4).clamp(8, 96);
    let sv = (cps[0].len() * 4).clamp(8, 96);
    let mut grid: Vec<Vec<[f64; 3]>> = Vec::with_capacity(su);
    for iu in 0..su {
        let u = iu as f64 / (su - 1) as f64;
        let mut row = Vec::with_capacity(sv);
        for iv in 0..sv {
            let v = iv as f64 / (sv - 1) as f64;
            row.push(nurbs_surface_point(cps, u_knots, du, v_knots, dv, u, v));
        }
        grid.push(row);
    }
    stitch_sections(mb, &grid)
}

/// Solid loft through NURBS section curves (sampled, then capped).
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
        let d = (degree as usize).min(sec.len() - 1).max(1);
        let knots = clamped_uniform_knots(sec.len(), d);
        let row = (0..sv)
            .map(|i| nurbs_curve_point(sec, &knots, d, i as f64 / (sv - 1) as f64))
            .collect();
        rows.push(row);
    }
    gen_loft(mb, &rows)
}

/// Solid sweep of a NURBS profile curve (XZ plane) along a NURBS path,
/// using parallel-transport frames.
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
    let pd = (path_degree as usize).min(path.len() - 1).max(1);
    let fd = (profile_degree as usize).min(profile.len() - 1).max(1);
    let path_knots = clamped_uniform_knots(path.len(), pd);
    let profile_knots = clamped_uniform_knots(profile.len(), fd);

    let profile_pts: Vec<[f64; 2]> = (0..sv)
        .map(|i| {
            let p = nurbs_curve_point(profile, &profile_knots, fd, i as f64 / (sv - 1) as f64);
            [p[0], p[2]]
        })
        .collect();

    let path_pts: Vec<[f64; 3]> = (0..su)
        .map(|i| nurbs_curve_point(path, &path_knots, pd, i as f64 / (su - 1) as f64))
        .collect();

    // parallel transport frames along the path
    let mut sections: Vec<Vec<[f64; 3]>> = Vec::with_capacity(su);
    let mut prev_normal: Option<[f64; 3]> = None;
    for (s, center) in path_pts.iter().enumerate() {
        let next = path_pts[(s + 1).min(su - 1)];
        let prev = path_pts[s.saturating_sub(1)];
        let tangent = [next[0] - prev[0], next[1] - prev[1], next[2] - prev[2]];
        let len = (tangent[0] * tangent[0] + tangent[1] * tangent[1] + tangent[2] * tangent[2])
            .sqrt();
        let tangent = if len < 1e-9 {
            [0.0, 1.0, 0.0]
        } else {
            [tangent[0] / len, tangent[1] / len, tangent[2] / len]
        };

        let normal = match prev_normal {
            Some(n) => {
                // project previous normal onto the plane perpendicular to tangent
                let dot = n[0] * tangent[0] + n[1] * tangent[1] + n[2] * tangent[2];
                let p = [n[0] - dot * tangent[0], n[1] - dot * tangent[1], n[2] - dot * tangent[2]];
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
            // arbitrary perpendicular to the tangent
            let reference = if tangent[0].abs() < 0.9 {
                [1.0, 0.0, 0.0]
            } else {
                [0.0, 0.0, 1.0]
            };
            let mut c = [
                tangent[1] * reference[2] - tangent[2] * reference[1],
                tangent[2] * reference[0] - tangent[0] * reference[2],
                tangent[0] * reference[1] - tangent[1] * reference[0],
            ];
            let cl = (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
            if cl < 1e-9 {
                c = [0.0, 1.0, 0.0];
            } else {
                c = [c[0] / cl, c[1] / cl, c[2] / cl];
            }
            c
        });
        let binormal = [
            tangent[1] * normal[2] - tangent[2] * normal[1],
            tangent[2] * normal[0] - tangent[0] * normal[2],
            tangent[0] * normal[1] - tangent[1] * normal[0],
        ];
        prev_normal = Some(normal);

        let ring: Vec<[f64; 3]> = profile_pts
            .iter()
            .map(|p| {
                [
                    center[0] + normal[0] * p[0] + binormal[0] * p[1],
                    center[1] + normal[1] * p[0] + binormal[1] * p[1],
                    center[2] + normal[2] * p[0] + binormal[2] * p[1],
                ]
            })
            .collect();
        sections.push(ring);
    }
    gen_loft(mb, &sections)
}

fn gen_loft(mb: &mut MeshBuilder, sections: &[Vec<[f64; 3]>]) -> Result<(), String> {
    stitch_sections(mb, sections)?;
    for cap in [sections.first().unwrap(), sections.last().unwrap()] {
        let planar: Vec<[f64; 2]> = cap.iter().map(|p| [p[0], p[2]]).collect();
        // ensure ccw winding so earclip normals point up consistently
        let tris = earclip_xz(&planar);
        for t in &tris {
            let a = cap[t[0]];
            let b = cap[t[1]];
            let c = cap[t[2]];
            let n = crate::mesh::tri_normal(a, b, c);
            mb.push_tri(a, b, c, n);
        }
    }
    Ok(())
}

// -------------------------------------------------------------- architecture

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
        // extend segment by half width on both sides to close corners cleanly
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

/// Wall segment as an extruded quad between 4 footprint corners, y0..y1.
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
    // top / bottom
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
        // top face of the full block
        mb.push_quad(
            [x, top, -half_w],
            [x + run, top, -half_w],
            [x + run, top, half_w],
            [x, top, half_w],
            [0.0, 1.0, 0.0],
        );
        // riser front face
        mb.push_quad(
            [x, top - rise, -half_w],
            [x, top, -half_w],
            [x, top, half_w],
            [x, top - rise, half_w],
            [-1.0, 0.0, 0.0],
        );
        // left/right wall faces of the whole block
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
    // back face of the whole staircase
    let top_y = rise * count.max(1) as f64;
    mb.push_quad(
        [x, 0.0, -half_w],
        [x, top_y, -half_w],
        [x, top_y, half_w],
        [x, 0.0, half_w],
        [1.0, 0.0, 0.0],
    );
}

fn gen_slab(mb: &mut MeshBuilder, polygon: &[[f64; 2]], height: f64) -> Result<(), String> {
    if polygon.len() < 3 {
        return Err("slab polygon needs at least 3 points".into());
    }
    if height <= 0.0 {
        return Err("slab height must be positive".into());
    }
    let mut profile = recenter_polygon(polygon);
    gen_prism_xz(mb, &mut profile, 0.0, height);
    Ok(())
}

fn gen_roof(mb: &mut MeshBuilder, width: f64, depth: f64, pitch_deg: f64, overhang: f64) {
    let half_d = depth / 2.0 + overhang;
    let half_w = width / 2.0 + overhang;
    let ridge_h = (depth / 2.0).max(1e-6) * pitch_deg.to_radians().tan();
    // Cross-section triangle in (z, y): two eave corners + ridge.
    let tri: [[f64; 2]; 3] = [[-half_d, 0.0], [half_d, 0.0], [0.0, ridge_h]];
    let (x0, x1) = (-half_w, half_w);

    // Gable end triangles; normals must face outward along -X / +X.
    let mut gable = |x: f64, want_plus_x: bool| {
        let pts: Vec<[f64; 3]> = tri.iter().map(|p| [x, p[1], p[0]]).collect();
        let mut n = crate::mesh::tri_normal(pts[0], pts[1], pts[2]);
        if (n[0] > 0.0) != want_plus_x {
            n = [-n[0], -n[1], -n[2]];
            mb.push_tri(pts[0], pts[2], pts[1], n);
        } else {
            mb.push_tri(pts[0], pts[1], pts[2], n);
        }
    };
    gable(x0, false);
    gable(x1, true);

    // Roof planes: sweep each cross-section edge along X, normals face out.
    let centroid = [
        (tri[0][0] + tri[1][0] + tri[2][0]) / 3.0,
        (tri[0][1] + tri[1][1] + tri[2][1]) / 3.0,
    ];
    for i in 0..3 {
        let j = (i + 1) % 3;
        let a = tri[i]; // (z, y)
        let b = tri[j];
        let ez = b[0] - a[0];
        let ey = b[1] - a[1];
        let l = (ez * ez + ey * ey).sqrt();
        if l < 1e-9 {
            continue;
        }
        // In-plane (z, y) normal candidates; orient away from the centroid.
        let mut n2 = [ey / l, -ez / l];
        let mid = [(a[0] + b[0]) / 2.0, (a[1] + b[1]) / 2.0];
        if n2[0] * (mid[0] - centroid[0]) + n2[1] * (mid[1] - centroid[1]) > 0.0 {
            n2 = [-n2[0], -n2[1]];
        }
        // (z, y) normal → 3D normal [0, ny, nz]
        mb.push_quad(
            [x0, a[1], a[0]],
            [x1, a[1], a[0]],
            [x1, b[1], b[0]],
            [x0, b[1], b[0]],
            [0.0, n2[1], n2[0]],
        );
    }
    // Underside along the base edge.
    mb.push_quad(
        [x0, 0.0, tri[0][0]],
        [x0, 0.0, tri[1][0]],
        [x1, 0.0, tri[1][0]],
        [x1, 0.0, tri[0][0]],
        [0.0, -1.0, 0.0],
    );
}

fn gen_column(mb: &mut MeshBuilder, radius: f64, height: f64, sides: u32) {
    let sides = sides.max(3);
    let mut poly: Vec<[f64; 2]> = Vec::new();
    for i in 0..sides {
        let a = std::f64::consts::TAU * (i as f64) / sides as f64 - std::f64::consts::FRAC_PI_4;
        poly.push([radius * a.cos(), radius * a.sin()]);
    }
    gen_prism_xz(mb, &mut poly, 0.0, height);
}

fn gen_beam(mb: &mut MeshBuilder, length: f64, width: f64, height: f64) {
    emit_cuboid(
        mb,
        [0.0, -height / 2.0, -width / 2.0],
        [length, height / 2.0, width / 2.0],
    );
}

fn gen_door(mb: &mut MeshBuilder, width: f64, height: f64, depth: f64, swing_deg: f64) {
    let frame = 0.08_f64.max(depth.max(0.02) * 0.15);
    let panel_w = width - frame * 2.0;
    let half_d = depth / 2.0;

    // jambs
    emit_cuboid(mb, [0.0, 0.0, -half_d], [frame, height, half_d]);
    emit_cuboid(mb, [width - frame, 0.0, -half_d], [width, height, half_d]);
    // head (lintel slightly above opening)
    emit_cuboid(mb, [0.0, height, -half_d], [width, height + frame, half_d]);
    // sill
    emit_cuboid(mb, [0.0, -0.02, -half_d], [width, 0.0, half_d]);

    // door panel hinged at (frame, 0, front face) rotating around Y by swing
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
    // [c0y0, c1y0, c2y0, c3y0, c0y1, c1y1, c2y1, c3y1]
    let (c0, c1, c2, c3) = (pts[0], pts[1], pts[2], pts[3]);
    let (d0, d1, d2, d3) = (pts[4], pts[5], pts[6], pts[7]);
    mb.push_quad(c0, c3, c2, c1, [0.0, -1.0, 0.0]);
    mb.push_quad(d0, d1, d2, d3, [0.0, 1.0, 0.0]);
    // sides: explicit outward normal for CCW ground loop (edge ⊥ in XZ then -Y cross)
    // panel loop c0→c1→c2→c3 is CCW seen from +Y (before rotation ordering).
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
    // glass pane: thin slab in the middle
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
    // extension ticks at both ends
    for (i, tip) in [start, end].into_iter().enumerate() {
        let sgn: f64 = if i == 0 { 1.0 } else { -1.0 };
        // arrow wings
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
        // cross tick
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
