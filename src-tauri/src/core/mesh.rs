//! Mesh data and tessellation utilities.

use crate::core::Transform;

/// Triangulated mesh + wireframe line segments, both in local space.
/// Triangles are non-indexed (positions in groups of three vertices).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MeshBuffer {
    pub positions: Vec<f32>,
    pub normals: Vec<f32>,
    pub lines: Vec<f32>,
}

impl MeshBuffer {
    pub fn tri_count(&self) -> usize {
        self.positions.len() / 9
    }
}

/// Incremental mesh builder.
#[derive(Debug, Default)]
pub struct MeshBuilder {
    buffer: MeshBuffer,
}

impl MeshBuilder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn into_buffer(self) -> MeshBuffer {
        self.buffer
    }

    /// Merge another buffer's contents into this builder.
    pub fn append_buffer(&mut self, buffer: &MeshBuffer) {
        self.buffer
            .positions
            .extend_from_slice(&buffer.positions);
        self.buffer.normals.extend_from_slice(&buffer.normals);
        self.buffer.lines.extend_from_slice(&buffer.lines);
    }

    pub fn push_tri(&mut self, a: [f64; 3], b: [f64; 3], c: [f64; 3], normal: [f64; 3]) {
        for v in [a, b, c] {
            self.buffer.positions.extend_from_slice(&[v[0] as f32, v[1] as f32, v[2] as f32]);
            self.buffer
                .normals
                .extend_from_slice(&[normal[0] as f32, normal[1] as f32, normal[2] as f32]);
        }
    }

    /// Flat-shaded quad: two triangles with a shared normal.
    pub fn push_quad(
        &mut self,
        a: [f64; 3],
        b: [f64; 3],
        c: [f64; 3],
        d: [f64; 3],
        normal: [f64; 3],
    ) {
        self.push_tri(a, b, c, normal);
        self.push_tri(a, c, d, normal);
    }

    pub fn push_line(&mut self, a: [f64; 3], b: [f64; 3]) {
        self.buffer.lines.extend_from_slice(&[
            a[0] as f32, a[1] as f32, a[2] as f32, b[0] as f32, b[1] as f32, b[2] as f32,
        ]);
    }

    /// Polyline segments.
    pub fn push_polyline(&mut self, points: &[[f64; 3]]) {
        for w in points.windows(2) {
            self.push_line(w[0], w[1]);
        }
    }
}

/// Signed area of an XZ polygon (> 0 means counter-clockwise as seen from +Y).
pub fn polygon_signed_area_xz(points: &[[f64; 2]]) -> f64 {
    let mut sum = 0.0;
    let n = points.len();
    for i in 0..n {
        let j = (i + 1) % n;
        sum += points[i][0] * points[j][1] - points[j][0] * points[i][1];
    }
    sum / 2.0
}

/// Segment/segment orientation test with epsilon (returns -1, 0, +1).
fn orient(a: [f64; 2], b: [f64; 2], p: [f64; 2]) -> f64 {
    let v = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    if v > 1e-9 {
        1.0
    } else if v < -1e-9 {
        -1.0
    } else {
        0.0
    }
}

/// Proper segment intersection (touching allowed, treated as no intersection).
fn segments_cross(a: [f64; 2], b: [f64; 2], c: [f64; 2], d: [f64; 2]) -> bool {
    let o1 = orient(a, b, c);
    let o2 = orient(a, b, d);
    let o3 = orient(c, d, a);
    let o4 = orient(c, d, b);
    ((o1 > 0.0 && o2 < 0.0) || (o1 < 0.0 && o2 > 0.0))
        && ((o3 > 0.0 && o4 < 0.0) || (o3 < 0.0 && o4 > 0.0))
}

/// Ear-clipping triangulation of a planar polygon given in XZ order.
/// Returns triangle index triples into `points`, using the input vertex order.
/// Handles concave polygons; ears are validated by reflex-vertex containment
/// and diagonal/boundary intersection tests.
pub fn earclip_xz(points: &[[f64; 2]]) -> Vec<[usize; 3]> {
    let n = points.len();
    if n < 3 {
        return vec![];
    }
    if n == 3 {
        return vec![[0, 1, 2]];
    }

    // Work internally with CCW winding.
    let flip = polygon_signed_area_xz(points) < 0.0;

    let is_convex = |verts: &[usize], k: usize, len: usize| -> bool {
        let a = points[verts[(k + len - 1) % len]];
        let b = points[verts[k % len]];
        let c = points[verts[(k + 1) % len]];
        let cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if flip {
            cr < -1e-9
        } else {
            cr > 1e-9
        }
    };
    let point_in_tri = |p: [f64; 2], t: [usize; 3]| -> bool {
        let v = [points[t[0]], points[t[1]], points[t[2]]];
        let sgn = |a: [f64; 2], b: [f64; 2], q: [f64; 2]| -> f64 {
            (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0])
        };
        let (mut d1, mut d2, mut d3) = (sgn(v[0], v[1], p), sgn(v[1], v[2], p), sgn(v[2], v[0], p));
        if flip {
            d1 = -d1;
            d2 = -d2;
            d3 = -d3;
        }
        // strictly inside the (CCW) ear triangle
        d1 > 1e-9 && d2 > 1e-9 && d3 > 1e-9
    };

    let mut remaining: Vec<usize> = (0..n).collect();
    let mut tris = Vec::new();
    let mut guard = 0usize;
    while remaining.len() > 3 && guard < 4 * n * n {
        guard += 1;
        let len = remaining.len();
        let mut clipped = false;
        'outer: for k in 0..len {
            if !is_convex(&remaining, k, len) {
                continue;
            }
            let prev = remaining[(k + len - 1) % len];
            let cur = remaining[k];
            let next = remaining[(k + 1) % len];
            let t = [prev, cur, next];

            // 1. no strictly-inside remaining convex corner? reject via reflex vertices
            for (pos, &ri) in remaining.iter().enumerate() {
                if pos == (k + len - 1) % len || pos == k || pos == (k + 1) % len {
                    continue;
                }
                if point_in_tri(points[ri], t) {
                    continue 'outer;
                }
            }
            // 2. the diagonal (prev → next) must not cross other boundary edges
            let a = points[prev];
            let b = points[next];
            for e in 0..len {
                let v0 = remaining[e];
                let v1 = remaining[(e + 1) % len];
                // skip edges sharing ear endpoints
                if v0 == prev || v0 == next || v1 == prev || v1 == next {
                    // still check the *adjacent* edge (prev,cur) etc.? Those are the ear's own edges; skip.
                    continue;
                }
                if segments_cross(a, b, points[v0], points[v1]) {
                    continue 'outer;
                }
            }
            tris.push(t);
            remaining.retain(|&r| r != cur);
            clipped = true;
            break 'outer;
        }
        if !clipped {
            // Degenerate polygon: clip the first convex corner regardless of
            // containment, else drop the first vertex to make progress.
            if let Some(k) = (0..remaining.len())
                .find(|&k| is_convex(&remaining, k, remaining.len()))
            {
                let len = remaining.len();
                let cur = remaining[k];
                let t = [
                    remaining[(k + len - 1) % len],
                    cur,
                    remaining[(k + 1) % len],
                ];
                tris.push(t);
                remaining.retain(|&r| r != cur);
            } else {
                remaining.remove(0);
            }
        }
    }
    if remaining.len() == 3 {
        tris.push([remaining[0], remaining[1], remaining[2]]);
    }
    tris
}

/// Möller-Trumbore ray-triangle intersection. Returns distance along ray.
pub fn ray_triangle(
    origin: [f64; 3],
    dir: [f64; 3],
    a: [f64; 3],
    b: [f64; 3],
    c: [f64; 3],
) -> Option<f64> {
    let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let p = [
        dir[1] * e2[2] - dir[2] * e2[1],
        dir[2] * e2[0] - dir[0] * e2[2],
        dir[0] * e2[1] - dir[1] * e2[0],
    ];
    let det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if det.abs() < 1e-12 {
        return None;
    }
    let inv_det = 1.0 / det;
    let t = [
        origin[0] - a[0],
        origin[1] - a[1],
        origin[2] - a[2],
    ];
    let u = (t[0] * p[0] + t[1] * p[1] + t[2] * p[2]) * inv_det;
    if !(0.0..=1.0).contains(&u) {
        return None;
    }
    let q = [
        t[1] * e1[2] - t[2] * e1[1],
        t[2] * e1[0] - t[0] * e1[2],
        t[0] * e1[1] - t[1] * e1[0],
    ];
    let v = (dir[0] * q[0] + dir[1] * q[1] + dir[2] * q[2]) * inv_det;
    if v < 0.0 || u + v > 1.0 {
        return None;
    }
    let dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv_det;
    if dist > 1e-9 {
        Some(dist)
    } else {
        None
    }
}

/// Normal of a triangle.
pub fn tri_normal(a: [f64; 3], b: [f64; 3], c: [f64; 3]) -> [f64; 3] {
    let e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
    ];
    let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
    if len < 1e-12 {
        [0.0, 0.0, 1.0]
    } else {
        [n[0] / len, n[1] / len, n[2] / len]
    }
}

/// Closest distance between a ray and a 3D segment. Returns (distance, ray param).
pub fn ray_point_segment_distance(
    origin: [f64; 3],
    dir: [f64; 3],
    a: [f64; 3],
    b: [f64; 3],
) -> (f64, f64) {
    let u = dir;
    let v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    let w0 = [a[0] - origin[0], a[1] - origin[1], a[2] - origin[2]];

    let dot = |p: [f64; 3], q: [f64; 3]| p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    let a_ = dot(u, u).max(1e-12);
    let b_ = dot(u, v);
    let c_ = dot(v, v).max(1e-12);
    let d_ = dot(u, w0);
    let e_ = dot(v, w0);
    let denom = a_ * c_ - b_ * b_;

    let dist_fn = |s: f64, t: f64| -> f64 {
        let rp = [origin[0] + u[0] * s, origin[1] + u[1] * s, origin[2] + u[2] * s];
        let sp = [a[0] + v[0] * t, a[1] + v[1] * t, a[2] + v[2] * t];
        let d = [rp[0] - sp[0], rp[1] - sp[1], rp[2] - sp[2]];
        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
    };

    if denom.abs() < 1e-12 {
        // Parallel: distance via endpoint projections.
        let t = (-e_ / c_).clamp(0.0, 1.0);
        let s = ((t * b_) - d_) / a_;
        let s2 = s.max(0.0);
        let t2 = ((s2 * a_ + d_) / c_.max(1e-12)).clamp(0.0, 1.0);
        let dist = dist_fn(s2, t2);
        return (dist, s2);
    }

    let t0 = ((a_ * e_ - b_ * d_) / denom).clamp(0.0, 1.0);
    let s0 = ((t0 * b_) - d_) / a_;
    let s0 = s0.max(0.0);
    let t1 = ((s0 * a_ + d_) / c_.max(1e-12)).clamp(0.0, 1.0);
    (dist_fn(s0, t1), s0)
}

/// Transform MeshBuffer vertices into world space (used for OBJ/STL export).
pub fn mesh_world(buffer: &MeshBuffer, t: &Transform) -> MeshBuffer {
    let mut out = MeshBuffer::default();
    for chunk in buffer.positions.chunks(9) {
        let a = t.transform_point([chunk[0] as f64, chunk[1] as f64, chunk[2] as f64]);
        let b = t.transform_point([chunk[3] as f64, chunk[4] as f64, chunk[5] as f64]);
        let c = t.transform_point([chunk[6] as f64, chunk[7] as f64, chunk[8] as f64]);
        out.positions.extend_from_slice(&[a[0] as f32, a[1] as f32, a[2] as f32, b[0] as f32, b[1] as f32, b[2] as f32, c[0] as f32, c[1] as f32, c[2] as f32]);
        let n = tri_normal(a, b, c);
        for _ in 0..3 {
            out.normals.extend_from_slice(&[n[0] as f32, n[1] as f32, n[2] as f32]);
        }
    }
    out.lines = buffer.lines.clone();
    out
}
