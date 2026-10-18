use serde::{Deserialize, Serialize};
use nalgebra::{DMatrix, Point3, Vector3};
use std::f64::consts::{PI, TAU};

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vector4 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub w: f64,
}

impl Vector4 {
    pub fn new(x: f64, y: f64, z: f64, w: f64) -> Self {
        Self { x, y, z, w }
    }
    
    pub fn to_point3(&self) -> Point3<f64> {
        Point3::new(self.x, self.y, self.z)
    }
    
    pub fn to_vector3(&self) -> Vector3<f64> {
        Vector3::new(self.x, self.y, self.z)
    }
    
    pub fn homogeneous_point(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z, w: 1.0 }
    }
    
    pub fn homogeneous_dir(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z, w: 0.0 }
    }
}

impl From<Vector4> for Point3<f64> {
    fn from(v: Vector4) -> Self {
        Point3::new(v.x / v.w, v.y / v.w, v.z / v.w)
    }
}

impl From<Vector4> for Vector3<f64> {
    fn from(v: Vector4) -> Self {
        Vector3::new(v.x / v.w, v.y / v.w, v.z / v.w)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControlPoint {
    pub position: [f64; 3],
    pub weight: f64,
}

impl ControlPoint {
    pub fn new(position: [f64; 3], weight: f64) -> Self {
        Self { position, weight }
    }
    
    pub fn to_vector4(&self) -> Vector4 {
        Vector4::new(self.position[0], self.position[1], self.position[2], self.weight)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KnotVector {
    pub knots: Vec<f64>,
    pub degree: u32,
}

impl KnotVector {
    pub fn new(degree: u32, knots: Vec<f64>) -> Self {
        Self { degree, knots }
    }
    
    pub fn size(&self) -> usize {
        self.knots.len()
    }
    
    pub fn is_valid(&self) -> bool {
        if self.knots.is_empty() {
            return false;
        }
        let size = self.size();
        let degree_plus_1 = self.degree as usize + 1;
        if size < 2 * degree_plus_1 {
            return false;
        }
        let min = *self.knots.iter().min_by(|a, b| a.partial_cmp(b).unwrap()).unwrap();
        let max = *self.knots.iter().max_by(|a, b| a.partial_cmp(b).unwrap()).unwrap();
        (min <= 0.0 && max >= 1.0) || (min < 0.0 && max > 1.0)
    }
    
    pub fn find_span(&self, u: f64) -> usize {
        let m = self.knots.len() as i32;
        let p = self.degree as i32;
        
        if (u - self.knots[0]).abs() < 1e-9 {
            return p as usize;
        }
        if (u - self.knots[m as usize - 1]).abs() < 1e-9 {
            return (m - p - 1) as usize;
        }
        
        let mut low = p;
        let mut high = m - p - 1;
        let mut span = low;
        
        while low <= high {
            let mid = (low + high) / 2;
            if u >= self.knots[mid as usize] && u < self.knots[(mid + 1) as usize] {
                span = mid;
                break;
            }
            if u < self.knots[mid as usize] {
                high = mid - 1;
            } else {
                low = mid + 1;
            }
        }
        
        span as usize
    }
    
    pub fn evaluate_basis(&self, u: f64, span: usize) -> f64 {
        if span >= self.knots.len() - 1 {
            return 0.0;
        }

        let p = self.degree;
        let mut nd: Vec<f64> = vec![0.0; (p + 1) as usize];
        nd[0] = 1.0;

        for r in 1..=p {
            let mut saved = 0.0;
            for j in 0..=(r as usize - 1) {
                let denominator = self.knots[span + j + 1 - r as usize + p as usize] - self.knots[span + j + 1];
                if denominator.abs() < 1e-9 {
                    nd[j] = 0.0;
                } else {
                    let alpha = (u - self.knots[span + j + 1]) / denominator;
                    nd[j] *= 1.0 - alpha;
                    saved += nd[j] * alpha;
                }
            }
            nd[r as usize] = saved;
        }

        nd[p as usize]
    }

    /// Full basis row N_{span-p..span, p}(u): p+1 values from the Cox-de Boor
    /// triangular recurrence (The NURBS Book, algorithm A2.2).
    pub fn basis_fns(&self, span: usize, u: f64) -> Vec<f64> {
        basis_row(&self.knots, span, self.degree as usize, u)
    }

    /// Clamped uniform knot vector over `n` control points, normalized to [0, 1].
    pub fn clamped(n: usize, degree: u32) -> Self {
        Self {
            degree,
            knots: clamped_uniform(n, degree as usize),
        }
    }
}

/// Largest index i with knots[i] <= u < knots[i+1], clamped to the valid
/// span range [degree, len - degree - 2].
pub fn span_for(knots: &[f64], degree: usize, u: f64) -> usize {
    let len = knots.len();
    if len < 2 {
        return 0;
    }
    let p = degree.min(len.saturating_sub(2));
    let hi = len - p - 2;
    if u <= knots[0] {
        return p;
    }
    if u >= knots[len - 1] {
        return hi.max(p);
    }
    let (mut low, mut high) = (p, hi.max(p));
    let mut span = p;
    while low <= high {
        let mid = (low + high) / 2;
        if u >= knots[mid] && u < knots[mid + 1] {
            span = mid;
            break;
        }
        if u < knots[mid] {
            if mid == 0 {
                break;
            }
            high = mid - 1;
        } else {
            low = mid + 1;
        }
    }
    span.clamp(p, hi.max(p))
}

/// Cox-de Boor basis row over `degree + 1` functions starting at
/// `span - degree` (The NURBS Book, algorithm A2.2).
pub fn basis_row(knots: &[f64], span: usize, degree: usize, u: f64) -> Vec<f64> {
    let mut n = vec![0.0; degree + 1];
    let mut left = vec![0.0; degree + 1];
    let mut right = vec![0.0; degree + 1];
    n[0] = 1.0;
    for j in 1..=degree {
        left[j] = u - knots[span + 1 - j];
        right[j] = knots[span + j] - u;
        let mut saved = 0.0;
        for r in 0..j {
            let denom = right[r + 1] + left[j - r];
            let temp = if denom.abs() < 1e-12 { 0.0 } else { n[r] / denom };
            n[r] = saved + right[r + 1] * temp;
            saved = left[j - r] * temp;
        }
        n[j] = saved;
    }
    n
}

/// Clamped uniform knot values for `n` control points of `degree`.
pub fn clamped_uniform(n: usize, degree: usize) -> Vec<f64> {
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

/// Premultiplied homogeneous control point [w*x, w*y, w*z, w].
type Homogeneous = [f64; 4];

fn to_h(cp: &ControlPoint) -> Homogeneous {
    [cp.position[0] * cp.weight, cp.position[1] * cp.weight, cp.position[2] * cp.weight, cp.weight]
}

fn from_h(h: Homogeneous) -> ControlPoint {
    let w = if h[3].abs() < 1e-12 { 1.0 } else { h[3] };
    ControlPoint::new([h[0] / w, h[1] / w, h[2] / w], w)
}

/// Homogeneous NURBS curve evaluation at `u` (no perspective divide).
pub fn eval_curve_h(points: &[Homogeneous], knots: &[f64], degree: usize, u: f64) -> Homogeneous {
    if points.is_empty() {
        return [0.0; 4];
    }
    let span = span_for(knots, degree, u);
    let basis = basis_row(knots, span, degree, u);
    let mut h = [0.0f64; 4];
    for (j, b) in basis.iter().enumerate() {
        let idx = span - degree + j;
        if idx >= points.len() {
            break;
        }
        let cp = points[idx];
        h[0] += b * cp[0];
        h[1] += b * cp[1];
        h[2] += b * cp[2];
        h[3] += b * cp[3];
    }
    h
}

/// Derivative control points of a homogeneous curve (one degree lower).
fn deriv_ctrl(points: &[Homogeneous], knots: &[f64], degree: usize) -> Vec<Homogeneous> {
    let n = points.len();
    if n < 2 || degree == 0 {
        return Vec::new();
    }
    (0..n - 1)
        .map(|i| {
            let den = knots[i + degree + 1] - knots[i + 1];
            let s = if den.abs() < 1e-12 { 0.0 } else { degree as f64 / den };
            [
                s * (points[i + 1][0] - points[i][0]),
                s * (points[i + 1][1] - points[i][1]),
                s * (points[i + 1][2] - points[i][2]),
                s * (points[i + 1][3] - points[i][3]),
            ]
        })
        .collect()
}

/// Rational derivative of C = N / W at `u`: (C'(u), W'(u)) given the
/// homogeneous value and its homogeneous derivative.
fn rational_deriv(n: [f64; 3], w: f64, dn: [f64; 3], dw: f64) -> [f64; 3] {
    if w.abs() < 1e-12 {
        return [0.0; 3];
    }
    [
        (dn[0] * w - n[0] * dw) / (w * w),
        (dn[1] * w - n[1] * dw) / (w * w),
        (dn[2] * w - n[2] * dw) / (w * w),
    ]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NURBSSurface {
    // Control points grid: u x v
    pub control_points: Vec<Vec<ControlPoint>>,
    // Knot vectors in U and V directions
    pub knot_vector_u: KnotVector,
    pub knot_vector_v: KnotVector,
    // Surface boundaries
    pub u_min: f64,
    pub u_max: f64,
    pub v_min: f64,
    pub v_max: f64,
    // U/V trim curves (empty if no trimming)
    pub trim_curves: Vec<NURBSTrimCurve>,
}

impl NURBSSurface {
    pub fn new(
        control_points: Vec<Vec<ControlPoint>>,
        knot_vector_u: KnotVector,
        knot_vector_v: KnotVector,
        u_min: f64,
        u_max: f64,
        v_min: f64,
        v_max: f64,
        trim_curves: Vec<NURBSTrimCurve>,
    ) -> Result<Self, String> {
        if control_points.is_empty() || control_points[0].is_empty() {
            return Err("Control point grid must be non-empty".to_string());
        }
        if !knot_vector_u.is_valid() || !knot_vector_v.is_valid() {
            return Err("Invalid knot vector".to_string());
        }
        let pu = knot_vector_u.degree as usize;
        let pv = knot_vector_v.degree as usize;
        let (u_count, v_count) = (control_points.len(), control_points[0].len());
        if u_count < pu + 1 || v_count < pv + 1 {
            return Err("Insufficient control points for given degree".to_string());
        }
        if control_points.iter().any(|row| row.len() != v_count) {
            return Err("Control point grid must be rectangular".to_string());
        }
        if control_points.iter().flatten().any(|cp| cp.weight <= 0.0) {
            return Err("Control point weights must be positive".to_string());
        }
        if knot_vector_u.knots.len() != u_count + pu + 1 {
            return Err(format!(
                "U knot vector must have u_count + u_degree + 1 entries ({} expected, {} found)",
                u_count + pu + 1,
                knot_vector_u.knots.len()
            ));
        }
        if knot_vector_v.knots.len() != v_count + pv + 1 {
            return Err(format!(
                "V knot vector must have v_count + v_degree + 1 entries ({} expected, {} found)",
                v_count + pv + 1,
                knot_vector_v.knots.len()
            ));
        }
        Ok(Self {
            control_points,
            knot_vector_u,
            knot_vector_v,
            u_min,
            u_max,
            v_min,
            v_max,
            trim_curves,
        })
    }
    
    pub fn u_count(&self) -> usize {
        self.control_points.len()
    }
    
    pub fn v_count(&self) -> usize {
        self.control_points[0].len()
    }
    
    pub fn degree(&self) -> u32 {
        self.knot_vector_u.degree
    }
    
    pub fn evaluate(&self, u: f64, v: f64) -> Result<PointOnSurface, String> {
        let grid = to_h_grid(&self.control_points);
        let h = eval_surface_h(&grid, &self.knot_vector_u, &self.knot_vector_v, u, v);
        if h[3].abs() < 1e-12 {
            return Err("surface weights collapsed at evaluation point".to_string());
        }
        let point = [h[0] / h[3], h[1] / h[3], h[2] / h[3]];
        let d = self.derivative(u, v)?;
        Ok(PointOnSurface::new(point, d.normal, u, v, (1.0, 1.0)))
    }

    /// Exact rational first partial derivatives and the surface normal.
    pub fn derivative(&self, u: f64, v: f64) -> Result<SurfaceDerivative, String> {
        let pu = self.knot_vector_u.degree as usize;
        let pv = self.knot_vector_v.degree as usize;

        let self_grid = to_h_grid(&self.control_points);
        let h = eval_surface_h(&self_grid, &self.knot_vector_u, &self.knot_vector_v, u, v);
        if h[3].abs() < 1e-12 {
            return Err("surface weights collapsed at evaluation point".to_string());
        }
        let point = [h[0] / h[3], h[1] / h[3], h[2] / h[3]];

        // d/du: derivative control grid along each column, evaluated with
        // degree pu - 1 over the same U knots.
        let du = if pu >= 1 && self.u_count() >= 2 {
            let mut grid: Vec<Vec<Homogeneous>> = Vec::with_capacity(self.u_count() - 1);
            for i in 0..self.u_count() - 1 {
                let den = self.knot_vector_u.knots[i + pu + 1] - self.knot_vector_u.knots[i + 1];
                let s = if den.abs() < 1e-12 { 0.0 } else { pu as f64 / den };
                let row: Vec<Homogeneous> = (0..self.v_count())
                    .map(|j| {
                        let a = to_h(&self.control_points[i][j]);
                        let b = to_h(&self.control_points[i + 1][j]);
                        [s * (b[0] - a[0]), s * (b[1] - a[1]), s * (b[2] - a[2]), s * (b[3] - a[3])]
                    })
                    .collect();
                grid.push(row);
            }
            let hu = eval_surface_h(
                &grid,
                &KnotVector::new(
                    self.knot_vector_u.degree - 1,
                    self.knot_vector_u.knots[1..self.knot_vector_u.knots.len() - 1].to_vec(),
                ),
                &self.knot_vector_v,
                u,
                v,
            );
            let w = h[3];
            rational_deriv([h[0], h[1], h[2]], w, [hu[0], hu[1], hu[2]], hu[3])
        } else {
            [0.0; 3]
        };

        // d/dv: derivative control grid along each row.
        let dv = if pv >= 1 && self.v_count() >= 2 {
            let mut grid: Vec<Vec<Homogeneous>> = Vec::with_capacity(self.u_count());
            for row in &self.control_points {
                let drow: Vec<Homogeneous> = (0..self.v_count() - 1)
                    .map(|j| {
                        let den = self.knot_vector_v.knots[j + pv + 1] - self.knot_vector_v.knots[j + 1];
                        let s = if den.abs() < 1e-12 { 0.0 } else { pv as f64 / den };
                        let a = to_h(&row[j]);
                        let b = to_h(&row[j + 1]);
                        [s * (b[0] - a[0]), s * (b[1] - a[1]), s * (b[2] - a[2]), s * (b[3] - a[3])]
                    })
                    .collect();
                grid.push(drow);
            }
            let hv = eval_surface_h(
                &grid,
                &self.knot_vector_u,
                &KnotVector::new(
                    self.knot_vector_v.degree - 1,
                    self.knot_vector_v.knots[1..self.knot_vector_v.knots.len() - 1].to_vec(),
                ),
                u,
                v,
            );
            let w = h[3];
            rational_deriv([h[0], h[1], h[2]], w, [hv[0], hv[1], hv[2]], hv[3])
        } else {
            [0.0; 3]
        };

        let cross = [
            du[1] * dv[2] - du[2] * dv[1],
            du[2] * dv[0] - du[0] * dv[2],
            du[0] * dv[1] - du[1] * dv[0],
        ];
        let len = (cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2]).sqrt();
        let normal = if len < 1e-12 {
            [0.0; 3]
        } else {
            [cross[0] / len, cross[1] / len, cross[2] / len]
        };

        Ok(SurfaceDerivative {
            point,
            du,
            dv,
            normal,
        })
    }

    /// Sample the surface into a (u_steps+1) x (v_steps+1) grid of vertices
    /// with consistent triangle winding.
    pub fn tessellate(&self, u_steps: u32, v_steps: u32) -> Result<(Vec<[f64; 3]>, Vec<[u32; 3]>), String> {
        let us = u_steps.max(1) as usize;
        let vs = v_steps.max(1) as usize;
        let mut vertices = Vec::with_capacity((us + 1) * (vs + 1));
        for i in 0..=us {
            let u = if us == 0 { 0.0 } else { i as f64 / us as f64 };
            for j in 0..=vs {
                let v = if vs == 0 { 0.0 } else { j as f64 / vs as f64 };
                let grid = to_h_grid(&self.control_points);
                let h = eval_surface_h(&grid, &self.knot_vector_u, &self.knot_vector_v, u, v);
                if h[3].abs() < 1e-12 {
                    return Err("surface weights collapsed while tessellating".to_string());
                }
                vertices.push([h[0] / h[3], h[1] / h[3], h[2] / h[3]]);
            }
        }
        let mut indices = Vec::with_capacity(us * vs * 2);
        for i in 0..us {
            for j in 0..vs {
                let a = (i * (vs + 1) + j) as u32;
                let b = ((i + 1) * (vs + 1) + j) as u32;
                let c = ((i + 1) * (vs + 1) + j + 1) as u32;
                let d = (i * (vs + 1) + j + 1) as u32;
                indices.push([a, b, c]);
                indices.push([a, c, d]);
            }
        }
        Ok((vertices, indices))
    }

    /// Insert a single knot at `u` in the U direction (Boehm).
    pub fn insert_knot_u(&mut self, u: f64) -> Result<(), String> {
        let columns: Vec<Vec<ControlPoint>> = (0..self.v_count())
            .map(|j| (0..self.u_count()).map(|i| self.control_points[i][j].clone()).collect())
            .collect();
        let original_knots = self.knot_vector_u.knots.clone();
        let degree = self.knot_vector_u.degree as usize;
        let mut new_knots: Option<Vec<f64>> = None;
        let mut new_columns: Vec<Vec<ControlPoint>> = Vec::with_capacity(columns.len());
        for col in &columns {
            let homos: Vec<Homogeneous> = col.iter().map(to_h).collect();
            let (pts, knots) = insert_curve_knot(&homos, &original_knots, degree, u)?;
            if new_knots.is_none() {
                new_knots = Some(knots);
            }
            new_columns.push(pts.iter().map(|p| from_h(*p)).collect());
        }
        self.knot_vector_u.knots = new_knots.unwrap_or(original_knots);
        let new_rows: Vec<Vec<ControlPoint>> = (0..new_columns[0].len())
            .map(|i| (0..new_columns.len()).map(|j| new_columns[j][i].clone()).collect())
            .collect();
        self.control_points = new_rows;
        Ok(())
    }

    /// Insert a single knot at `u` in the V direction (Boehm).
    pub fn insert_knot_v(&mut self, u: f64) -> Result<(), String> {
        let original_knots = self.knot_vector_v.knots.clone();
        let degree = self.knot_vector_v.degree as usize;
        let mut new_knots: Option<Vec<f64>> = None;
        let mut new_rows = Vec::with_capacity(self.u_count());
        for row in &self.control_points {
            let homos: Vec<Homogeneous> = row.iter().map(to_h).collect();
            let (pts, knots) = insert_curve_knot(&homos, &original_knots, degree, u)?;
            if new_knots.is_none() {
                new_knots = Some(knots);
            }
            new_rows.push(pts.iter().map(|p| from_h(*p)).collect());
        }
        self.knot_vector_v.knots = new_knots.unwrap_or(original_knots);
        self.control_points = new_rows;
        Ok(())
    }
}


fn to_h_grid(cps: &[Vec<ControlPoint>]) -> Vec<Vec<Homogeneous>> {
    cps.iter()
        .map(|row| row.iter().map(to_h).collect())
        .collect()
}

/// Tensor-product homogeneous surface evaluation with independent degrees.
pub fn eval_surface_h(
    cps: &[Vec<Homogeneous>],
    ku: &KnotVector,
    kv: &KnotVector,
    u: f64,
    v: f64,
) -> Homogeneous {
    let pu = ku.degree as usize;
    let pv = kv.degree as usize;
    let su = span_for(&ku.knots, pu, u);
    let bu = basis_row(&ku.knots, su, pu, u);
    let sv = span_for(&kv.knots, pv, v);
    let bv = basis_row(&kv.knots, sv, pv, v);
    let mut h = [0.0f64; 4];
    for (i, bui) in bu.iter().enumerate() {
        let ui = su - pu + i;
        if ui >= cps.len() {
            break;
        }
        let row = &cps[ui];
        let mut mid = [0.0f64; 4];
        for (j, bvj) in bv.iter().enumerate() {
            let vj = sv - pv + j;
            if vj >= row.len() {
                break;
            }
            let cp = &row[vj];
            mid[0] += bvj * cp[0];
            mid[1] += bvj * cp[1];
            mid[2] += bvj * cp[2];
            mid[3] += bvj * cp[3];
        }
        h[0] += bui * mid[0];
        h[1] += bui * mid[1];
        h[2] += bui * mid[2];
        h[3] += bui * mid[3];
    }
    h
}

/// First and second-order geometric data on a surface point.
#[derive(Debug, Clone, Copy)]
pub struct SurfaceDerivative {
    pub point: [f64; 3],
    pub du: [f64; 3],
    pub dv: [f64; 3],
    pub normal: [f64; 3],
}

/// Single-knot insertion for a homogeneous curve. The refined control
/// polygon is recovered exactly by collocating the curve at the Greville
/// abscissae of the extended knot vector (Schoenberg-Whitney guarantees the
/// collocation matrix is nonsingular).
pub fn insert_curve_knot(
    points: &[Homogeneous],
    knots: &[f64],
    degree: usize,
    u: f64,
) -> Result<(Vec<Homogeneous>, Vec<f64>), String> {
    let n = points.len();
    if n == 0 {
        return Err("cannot insert a knot into an empty curve".to_string());
    }
    if degree == 0 {
        return Err("knot insertion requires degree >= 1".to_string());
    }
    if knots.len() != n + degree + 1 {
        return Err("knot vector length does not match control point count".to_string());
    }
    let lo = knots[degree];
    let hi = knots[knots.len() - degree - 1];
    if !(lo..=hi).contains(&u) {
        return Err(format!("knot {} outside curve domain [{}, {}]", u, lo, hi));
    }
    let k = span_for(knots, degree, u);
    let mut new_knots = knots.to_vec();
    new_knots.insert(k + 1, u);
    let n_new = n + 1;

    // Greville abscissae: mean of knots[i+1 ..= i+degree].
    let greville: Vec<f64> = (0..n_new)
        .map(|i| {
            let sum: f64 = new_knots[i + 1..i + 1 + degree].iter().sum();
            sum / degree as f64
        })
        .collect();

    let mut mat = DMatrix::zeros(n_new, n_new);
    for (row, &t) in greville.iter().enumerate() {
        let span = span_for(&new_knots, degree, t);
        let basis = basis_row(&new_knots, span, degree, t);
        for (j, b) in basis.iter().enumerate() {
            let col = span - degree + j;
            if col < n_new {
                mat[(row, col)] = *b;
            }
        }
    }
    let mut rhs = DMatrix::zeros(n_new, 4);
    for (row, &t) in greville.iter().enumerate() {
        let h = eval_curve_h(points, knots, degree, t);
        for (c, v) in h.iter().enumerate() {
            rhs[(row, c)] = *v;
        }
    }
    let sol = mat
        .lu()
        .solve(&rhs)
        .ok_or_else(|| "knot insertion collocation system is singular".to_string())?;
    let out: Vec<Homogeneous> = (0..n_new)
        .map(|i| [sol[(i, 0)], sol[(i, 1)], sol[(i, 2)], sol[(i, 3)]])
        .collect();
    Ok((out, new_knots))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NURBSTrimCurve {
    pub trim_type: TrimCurveType,
    pub points: Vec<[f64; 3]>,
}

impl NURBSTrimCurve {
    pub fn new(trim_type: TrimCurveType, points: Vec<[f64; 3]>) -> Self {
        Self { trim_type, points }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum TrimCurveType {
    OpenPolygon,
    ClosedPolygon,
    Segment,
    Circle,
    Arc,
}

#[derive(Debug, Clone)]
pub struct PointOnSurface {
    pub point: [f64; 3],
    pub normal: [f64; 3],
    pub u: f64,
    pub v: f64,
    pub weights: (f64, f64),
}

impl PointOnSurface {
    pub fn new(point: [f64; 3], normal: [f64; 3], u: f64, v: f64, weights: (f64, f64)) -> Self {
        Self { point, normal, u, v, weights }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NURBSSurfaceGeometry {
    Rect {
        u_degree: u32,
        v_degree: u32,
        control_points: Vec<Vec<ControlPoint>>,
        knot_vector_u: Vec<f64>,
        knot_vector_v: Vec<f64>,
        u_min: f64,
        u_max: f64,
        v_min: f64,
        v_max: f64,
        trim_curves: Vec<NURBSTrimCurve>,
    },
    Loft {
        sections: Vec<Vec<[f64; 3]>>,
        weights: Option<Vec<Vec<f64>>>,
        closed: bool,
    },
    Sweep {
        profile: Vec<[f64; 3]>, 
        path: Vec<[f64; 3]>,
        weights: Option<Vec<f64>>,
    },
}

impl NURBSSurfaceGeometry {
    pub fn create_from_circle(
        center: [f64; 3],
        radius: f64,
        u_degree: u32,
        v_degree: u32,
        u_segments: u32,
        v_segments: u32,
    ) -> Self {
        let mut control_points = Vec::new();
        for i in 0..u_segments as usize {
            let mut row = Vec::new();
            let theta = TAU * (i as f64) / (u_segments as f64);
            for j in 0..v_segments as usize {
                let phi = PI * (j as f64) / (v_segments as f64 - 1.0);
                let r = radius * phi.sin();
                let x = center[0] + r * theta.cos();
                let y = center[1] + r * theta.sin();
                let z = center[2];
                let weight = 1.0;
                row.push(ControlPoint::new([x, y, z], weight));
            }
            control_points.push(row);
        }
        let degree = u_degree.min(v_degree);
        let knot_count = control_points.len() + degree as usize;
        let mut knots_u = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_u.push(0.0);
        }
        for i in 0..u_segments.saturating_sub(degree) + 1 {
            knots_u.push(i as f64);
        }
        for _ in 0..(degree as usize + 1) {
            knots_u.push(u_segments as f64);
        }
        let mut knots_v = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_v.push(0.0);
        }
        for i in 0..v_segments.saturating_sub(degree) + 1 {
            knots_v.push(i as f64);
        }
        for _ in 0..(degree as usize + 1) {
            knots_v.push(v_segments as f64);
        }
        let knot_vector_u = KnotVector::new(degree, knots_u);
        let knot_vector_v = KnotVector::new(degree, knots_v);
        NURBSSurfaceGeometry::Rect {
            u_degree,
            v_degree,
            control_points,
            knot_vector_u: knot_vector_u.knots,
            knot_vector_v: knot_vector_v.knots,
            u_min: 0.0,
            u_max: u_segments as f64,
            v_min: 0.0,
            v_max: v_segments as f64,
            trim_curves: Vec::new(),
        }
    }
    
    pub fn create_from_points(
        points: Vec<Vec<[f64; 3]>>,
        weights: Option<Vec<Vec<f64>>>,
    ) -> Result<Self, String> {
        let degree = 3;
        let u_segments = points.len() as f64;
        let v_segments = points[0].len() as f64;
        let mut control_points = Vec::new();
        for u_row in points {
            let mut v_row = Vec::new();
            for (i, pos) in u_row.iter().enumerate() {
                let weight = weights
                    .as_ref()
                    .and_then(|w| w.first().and_then(|row| row.get(i)))
                    .copied()
                    .unwrap_or(1.0);
                v_row.push(ControlPoint::new(*pos, weight));
            }
            control_points.push(v_row);
        }
        let knot_count = (control_points.len() + degree as usize).max((control_points[0].len() + degree as usize) as usize);
        let mut knots_u = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_u.push(0.0);
        }
        for i in 1..(u_segments as usize).saturating_sub(degree as usize) + 1 {
            knots_u.push(i as f64);
        }
        for _ in 0..(degree as usize + 1) {
            knots_u.push(u_segments as f64);
        }
        let mut knots_v = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_v.push(0.0);
        }
        for i in 1..(v_segments as usize).saturating_sub(degree as usize) + 1 {
            knots_v.push(i as f64);
        }
        for _ in 0..(degree as usize + 1) {
            knots_v.push(v_segments as f64);
        }
        let knot_vector_u = KnotVector::new(degree, knots_u);
        let knot_vector_v = KnotVector::new(degree, knots_v);
        Ok(NURBSSurfaceGeometry::Rect {
            u_degree: degree,
            v_degree: degree,
            control_points,
            knot_vector_u: knot_vector_u.knots,
            knot_vector_v: knot_vector_v.knots,
            u_min: 0.0,
            u_max: u_segments as f64,
            v_min: 0.0,
            v_max: v_segments as f64,
            trim_curves: Vec::new(),
        })
    }
}
/// A rational B-spline curve with de Boor evaluation, derivatives,
/// arc-length parameterization and Boehm knot insertion.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NURBSCurve {
    pub control_points: Vec<ControlPoint>,
    pub knots: KnotVector,
}

impl NURBSCurve {
    /// Validate and build a curve. Knot vector length must equal
    /// `points + degree + 1`, weights must be positive and the knot vector
    /// non-decreasing.
    pub fn new(control_points: Vec<ControlPoint>, knots: KnotVector) -> Result<Self, String> {
        let n = control_points.len();
        if n == 0 {
            return Err("curve needs at least one control point".to_string());
        }
        if knots.degree < 1 {
            return Err("curve degree must be at least 1".to_string());
        }
        let p = knots.degree as usize;
        if n < p + 1 {
            return Err("not enough control points for the curve degree".to_string());
        }
        if knots.knots.len() != n + p + 1 {
            return Err(format!(
                "knot vector must have n + degree + 1 entries ({} expected, {} found)",
                n + p + 1,
                knots.knots.len()
            ));
        }
        if knots.knots.windows(2).any(|w| w[1] < w[0]) {
            return Err("knot vector must be non-decreasing".to_string());
        }
        if control_points.iter().any(|cp| cp.weight <= 0.0) {
            return Err("control point weights must be positive".to_string());
        }
        Ok(Self {
            control_points,
            knots,
        })
    }

    /// Degree-1 polyline-style curve through `points`.
    pub fn polyline(points: Vec<[f64; 3]>) -> Result<Self, String> {
        if points.len() < 2 {
            return Err("polyline needs at least 2 points".to_string());
        }
        let cps: Vec<ControlPoint> = points.into_iter().map(|p| ControlPoint::new(p, 1.0)).collect();
        let n = cps.len();
        Ok(Self {
            control_points: cps,
            knots: KnotVector::new(1, clamped_uniform(n, 1)),
        })
    }

    pub fn degree(&self) -> u32 {
        self.knots.degree
    }

    /// Valid parameter domain [knots[p], knots[len - p - 1]].
    pub fn domain(&self) -> (f64, f64) {
        let p = self.knots.degree as usize;
        (
            self.knots.knots[p],
            self.knots.knots[self.knots.knots.len() - p - 1],
        )
    }

    fn homos(&self) -> Vec<Homogeneous> {
        self.control_points.iter().map(to_h).collect()
    }

    /// Rational curve point at `u`.
    pub fn evaluate(&self, u: f64) -> Result<[f64; 3], String> {
        let h = eval_curve_h(&self.homos(), &self.knots.knots, self.knots.degree as usize, u);
        if h[3].abs() < 1e-12 {
            return Err("curve weights collapsed at evaluation point".to_string());
        }
        Ok([h[0] / h[3], h[1] / h[3], h[2] / h[3]])
    }

    /// First rational derivative at `u`.
    pub fn derivative(&self, u: f64) -> Result<[f64; 3], String> {
        let (n, w, dn, dw) = self.h_and_derivs(u, 1)?;
        Ok(rational_deriv(n, w, dn, dw))
    }

    /// Second rational derivative at `u`.
    pub fn second_derivative(&self, u: f64) -> Result<[f64; 3], String> {
        let (n, w, dn, dw) = self.h_and_derivs(u, 2)?;
        let (d2n, d2w) = {
            let homos = self.homos();
            let p = self.knots.degree as usize;
            let k1 = self.knots.knots[1..self.knots.knots.len() - 1].to_vec();
            let d1 = deriv_ctrl(&homos, &self.knots.knots, p);
            let d2 = deriv_ctrl(&d1, &k1, p.saturating_sub(1));
            let h2 = if d2.is_empty() {
                [0.0; 4]
            } else {
                let k2 = k1[1..k1.len() - 1].to_vec();
                eval_curve_h(&d2, &k2, p.saturating_sub(2), u)
            };
            ([h2[0], h2[1], h2[2]], h2[3])
        };
        // C'' = N''/W - 2 N' W'/W^2 - N W''/W^2 + 2 N W'^2/W^3
        if w.abs() < 1e-12 {
            return Err("curve weights collapsed at evaluation point".to_string());
        }
        let w2 = w * w;
        let w3 = w2 * w;
        Ok([
            d2n[0] / w - 2.0 * dn[0] * dw / w2 - n[0] * d2w / w2 + 2.0 * n[0] * dw * dw / w3,
            d2n[1] / w - 2.0 * dn[1] * dw / w2 - n[1] * d2w / w2 + 2.0 * n[1] * dw * dw / w3,
            d2n[2] / w - 2.0 * dn[2] * dw / w2 - n[2] * d2w / w2 + 2.0 * n[2] * dw * dw / w3,
        ])
    }

    fn h_and_derivs(&self, u: f64, order: u32) -> Result<([f64; 3], f64, [f64; 3], f64), String> {
        let homos = self.homos();
        let p = self.knots.degree as usize;
        let h = eval_curve_h(&homos, &self.knots.knots, p, u);
        if h[3].abs() < 1e-12 {
            return Err("curve weights collapsed at evaluation point".to_string());
        }
        let d1 = deriv_ctrl(&homos, &self.knots.knots, p);
        let h1 = if d1.is_empty() {
            [0.0; 4]
        } else {
            let k1 = &self.knots.knots[1..self.knots.knots.len() - 1];
            eval_curve_h(&d1, k1, p - 1, u)
        };
        let (n, w) = ([h[0], h[1], h[2]], h[3]);
        let (dn, dw) = ([h1[0], h1[1], h1[2]], h1[3]);
        Ok((n, w, dn, dw))
    }

    /// Uniformly sample the curve into a polyline of `samples` points.
    pub fn tessellate(&self, samples: u32) -> Result<Vec<[f64; 3]>, String> {
        let s = samples.max(2) as usize;
        let (lo, hi) = self.domain();
        Ok((0..s)
            .map(|i| {
                let t = lo + (hi - lo) * (i as f64 / (s - 1) as f64);
                self.evaluate(t).unwrap_or([0.0; 3])
            })
            .collect())
    }

    /// Cumulative chord-length table over uniformly sampled parameters.
    pub fn arc_length_table(&self, samples: u32) -> Result<ArcLengthTable, String> {
        let pts = self.tessellate(samples)?;
        Ok(ArcLengthTable::from_points(&pts))
    }

    /// Approximate total curve length.
    pub fn length(&self, samples: u32) -> Result<f64, String> {
        Ok(self.arc_length_table(samples)?.total_length())
    }

    /// Insert a single knot at `u` (Boehm), preserving the curve shape.
    pub fn insert_knot(&mut self, u: f64) -> Result<(), String> {
        let (pts, knots) = insert_curve_knot(
            &self.homos(),
            &self.knots.knots,
            self.knots.degree as usize,
            u,
        )?;
        self.control_points = pts.iter().map(|p| from_h(*p)).collect();
        self.knots.knots = knots;
        Ok(())
    }
}

/// Cumulative chord-length table for arc-length parameterization.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArcLengthTable {
    pub params: Vec<f64>,
    pub cumulative: Vec<f64>,
}

impl ArcLengthTable {
    pub fn from_points(points: &[[f64; 3]]) -> Self {
        let mut cumulative = Vec::with_capacity(points.len());
        let mut total = 0.0;
        cumulative.push(0.0);
        for w in points.windows(2) {
            let d = [
                w[1][0] - w[0][0],
                w[1][1] - w[0][1],
                w[1][2] - w[0][2],
            ];
            total += (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
            cumulative.push(total);
        }
        let n = points.len();
        Self {
            params: (0..n).map(|i| i as f64 / (n.max(2) - 1) as f64).collect(),
            cumulative,
        }
    }

    pub fn total_length(&self) -> f64 {
        self.cumulative.last().copied().unwrap_or(0.0)
    }

    /// Map an arc length s (clamped to [0, total]) back to a curve parameter.
    pub fn parameter_at(&self, s: f64) -> f64 {
        let total = self.total_length();
        if total <= 0.0 || self.params.is_empty() {
            return 0.0;
        }
        let s = s.clamp(0.0, total);
        match self.cumulative.binary_search_by(|c| c.partial_cmp(&s).unwrap()) {
            Ok(i) => return self.params[i.min(self.params.len() - 1)],
            Err(i) => {
                if i == 0 {
                    return self.params[0];
                }
                let lo = i - 1;
                let seg = self.cumulative[i] - self.cumulative[lo];
                if seg <= 0.0 {
                    return self.params[lo];
                }
                let f = (s - self.cumulative[lo]) / seg;
                self.params[lo] + f * (self.params[i.min(self.params.len() - 1)] - self.params[lo])
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOL: f64 = 1e-9;

    #[test]
    fn quadratic_bezier_as_nurbs() {
        let cps = vec![
            ControlPoint::new([0.0, 0.0, 0.0], 1.0),
            ControlPoint::new([1.0, 0.0, 0.0], 1.0),
            ControlPoint::new([2.0, 0.0, 0.0], 1.0),
        ];
        let curve = NURBSCurve::new(cps, KnotVector::new(2, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0])).unwrap();
        let p = curve.evaluate(0.5).unwrap();
        assert!((p[0] - 1.0).abs() < TOL, "midpoint x = {}", p[0]);
        assert!(p[1].abs() < TOL && p[2].abs() < TOL);
    }

    #[test]
    fn circular_arc_is_rational() {
        // quarter circle from (1,0) to (0,1), weights 1, sqrt(2)/2, 1
        let s2 = std::f64::consts::FRAC_1_SQRT_2;
        let cps = vec![
            ControlPoint::new([1.0, 0.0, 0.0], 1.0),
            ControlPoint::new([1.0, 1.0, 0.0], s2),
            ControlPoint::new([0.0, 1.0, 0.0], 1.0),
        ];
        let curve = NURBSCurve::new(cps, KnotVector::new(2, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0])).unwrap();
        for i in 0..=20 {
            let u = i as f64 / 20.0;
            let p = curve.evaluate(u).unwrap();
            let r = (p[0] * p[0] + p[1] * p[1]).sqrt();
            assert!((r - 1.0).abs() < 1e-9, "radius {} at u={}", r, u);
        }
        let mid = curve.evaluate(0.5).unwrap();
        assert!((mid[0] - s2).abs() < 1e-9 && (mid[1] - s2).abs() < 1e-9);
    }

    #[test]
    fn bilinear_patch_interpolates_corners() {
        // rows index U, columns index V; point = [u, v, 0]
        let rows = vec![
            vec![ControlPoint::new([0.0, 0.0, 0.0], 1.0), ControlPoint::new([0.0, 1.0, 0.0], 1.0)],
            vec![ControlPoint::new([1.0, 0.0, 0.0], 1.0), ControlPoint::new([1.0, 1.0, 0.0], 1.0)],
        ];
        let surface = NURBSSurface::new(
            rows,
            KnotVector::new(1, vec![0.0, 0.0, 1.0, 1.0]),
            KnotVector::new(1, vec![0.0, 0.0, 1.0, 1.0]),
            0.0,
            1.0,
            0.0,
            1.0,
            Vec::new(),
        )
        .unwrap();
        for (u, v, expected) in [
            (0.0, 0.0, [0.0, 0.0, 0.0]),
            (1.0, 0.0, [1.0, 0.0, 0.0]),
            (0.0, 1.0, [0.0, 1.0, 0.0]),
            (1.0, 1.0, [1.0, 1.0, 0.0]),
            (0.5, 0.5, [0.5, 0.5, 0.0]),
            (0.25, 0.75, [0.25, 0.75, 0.0]),
        ] {
            let p = surface.evaluate(u, v).unwrap().point;
            for k in 0..3 {
                assert!((p[k] - expected[k]).abs() < TOL, "at ({}, {}): {:?}", u, v, p);
            }
        }
    }

    #[test]
    fn surface_normal_is_perpendicular_to_plane() {
        let rows = vec![
            vec![ControlPoint::new([0.0, 0.0, 0.0], 1.0), ControlPoint::new([2.0, 0.0, 0.0], 1.0)],
            vec![ControlPoint::new([0.0, 1.0, 0.0], 1.0), ControlPoint::new([2.0, 1.0, 0.0], 1.0)],
        ];
        let surface = NURBSSurface::new(
            rows,
            KnotVector::new(1, vec![0.0, 0.0, 1.0, 1.0]),
            KnotVector::new(1, vec![0.0, 0.0, 1.0, 1.0]),
            0.0,
            1.0,
            0.0,
            1.0,
            Vec::new(),
        )
        .unwrap();
        let d = surface.derivative(0.5, 0.5).unwrap();
        assert!((d.du[1] - 1.0).abs() < TOL, "du = {:?}", d.du);
        assert!((d.dv[0] - 2.0).abs() < TOL, "dv = {:?}", d.dv);
        assert!((d.normal[2].abs() - 1.0).abs() < TOL, "normal = {:?}", d.normal);
    }

    #[test]
    fn independent_uv_degrees_accepted() {
        // u degree 2 (3 rows), v degree 1 (2 columns)
        let rows: Vec<Vec<ControlPoint>> = (0..3)
            .map(|i| {
                vec![
                    ControlPoint::new([i as f64, 0.0, 0.0], 1.0),
                    ControlPoint::new([i as f64, 1.0, 0.0], 1.0),
                ]
            })
            .collect();
        let surface = NURBSSurface::new(
            rows,
            KnotVector::new(2, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0]),
            KnotVector::new(1, vec![0.0, 0.0, 1.0, 1.0]),
            0.0,
            1.0,
            0.0,
            1.0,
            Vec::new(),
        );
        assert!(surface.is_ok(), "independent degrees rejected: {:?}", surface.err());
    }

    #[test]
    fn line_derivative_constant() {
        let curve = NURBSCurve::polyline(vec![[0.0, 0.0, 0.0], [2.0, 0.0, 4.0]]).unwrap();
        let d = curve.derivative(0.3).unwrap();
        assert!((d[0] - 2.0).abs() < TOL && (d[1]).abs() < TOL && (d[2] - 4.0).abs() < TOL);
        let p = curve.evaluate(0.25).unwrap();
        assert!((p[0] - 0.5).abs() < TOL && (p[2] - 1.0).abs() < TOL);
    }

    #[test]
    fn arc_length_of_line_is_exact() {
        let curve = NURBSCurve::polyline(vec![[0.0, 0.0, 0.0], [3.0, 4.0, 0.0]]).unwrap();
        let len = curve.length(32).unwrap();
        assert!((len - 5.0).abs() < TOL, "length = {}", len);
        let table = curve.arc_length_table(32).unwrap();
        let half = table.parameter_at(2.5);
        assert!((half - 0.5).abs() < TOL, "param at half = {}", half);
    }

    #[test]
    fn quarter_circle_length_close_to_arc() {
        let s2 = std::f64::consts::FRAC_1_SQRT_2;
        let cps = vec![
            ControlPoint::new([1.0, 0.0, 0.0], 1.0),
            ControlPoint::new([1.0, 1.0, 0.0], s2),
            ControlPoint::new([0.0, 1.0, 0.0], 1.0),
        ];
        let curve = NURBSCurve::new(cps, KnotVector::new(2, vec![0.0, 0.0, 0.0, 1.0, 1.0, 1.0])).unwrap();
        let len = curve.length(512).unwrap();
        let expected = std::f64::consts::FRAC_PI_2;
        assert!((len - expected).abs() < 1e-3, "length {} vs {}", len, expected);
    }

    #[test]
    fn knot_insertion_preserves_shape() {
        let cps = vec![
            ControlPoint::new([0.0, 0.0, 0.0], 1.0),
            ControlPoint::new([1.0, 2.0, 0.0], 1.0),
            ControlPoint::new([3.0, 2.0, 0.0], 1.5),
            ControlPoint::new([4.0, 0.0, 0.0], 1.0),
        ];
        let mut curve = NURBSCurve::new(
            cps,
            KnotVector::new(3, vec![0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0]),
        )
        .unwrap();
        let before: Vec<[f64; 3]> = (0..=40)
            .map(|i| curve.evaluate(i as f64 / 40.0).unwrap())
            .collect();
        curve.insert_knot(0.3).unwrap();
        curve.insert_knot(0.65).unwrap();
        assert_eq!(curve.control_points.len(), 6, "two insertions add two points");
        for (i, expected) in before.iter().enumerate() {
            let got = curve.evaluate(i as f64 / 40.0).unwrap();
            for k in 0..3 {
                assert!(
                    (got[k] - expected[k]).abs() < TOL,
                    "sample {}: {:?} vs {:?}",
                    i,
                    got,
                    expected
                );
            }
        }
    }

    #[test]
    fn surface_knot_insertion_preserves_shape() {
        let rows = vec![
            vec![ControlPoint::new([0.0, 0.0, 0.0], 1.0), ControlPoint::new([1.0, 0.0, 0.0], 1.0), ControlPoint::new([2.0, 0.0, 0.0], 1.0)],
            vec![ControlPoint::new([0.0, 1.0, 0.0], 1.0), ControlPoint::new([1.0, 2.0, 0.0], 1.0), ControlPoint::new([2.0, 1.0, 0.0], 1.0)],
        ];
        let mut surface = NURBSSurface::new(
            rows,
            KnotVector::new(1, vec![0.0, 0.0, 1.0, 1.0]),
            KnotVector::new(1, vec![0.0, 0.0, 0.5, 1.0, 1.0]),
            0.0,
            1.0,
            0.0,
            1.0,
            Vec::new(),
        )
        .unwrap();
        let before: Vec<[f64; 3]> = (0..=10)
            .flat_map(|i| {
                let surface = &surface;
                (0..=10).map(move |j| surface.evaluate(i as f64 / 10.0, j as f64 / 10.0).unwrap().point)
            })
            .collect();
        surface.insert_knot_u(0.25).unwrap();
        assert_eq!(surface.u_count(), 3, "one column inserted");
        for (idx, expected) in before.iter().enumerate() {
            let i = idx / 11;
            let j = idx % 11;
            let got = surface.evaluate(i as f64 / 10.0, j as f64 / 10.0).unwrap().point;
            for k in 0..3 {
                assert!((got[k] - expected[k]).abs() < TOL);
            }
        }
    }

    #[test]
    fn tessellate_index_grid_is_watertight() {
        let rows: Vec<Vec<ControlPoint>> = (0..4)
            .map(|i| {
                (0..3)
                    .map(|j| ControlPoint::new([i as f64, j as f64, (i * j) as f64 * 0.1], 1.0))
                    .collect()
            })
            .collect();
        let surface = NURBSSurface::new(
            rows,
            KnotVector::new(2, vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0]),
            KnotVector::new(1, vec![0.0, 0.0, 0.5, 1.0, 1.0]),
            0.0,
            1.0,
            0.0,
            1.0,
            Vec::new(),
        )
        .unwrap();
        let (verts, indices) = surface.tessellate(6, 5).unwrap();
        assert_eq!(verts.len(), 7 * 6);
        let mut edge_count: std::collections::HashMap<(u32, u32), u32> = std::collections::HashMap::new();
        for tri in &indices {
            for e in [(tri[0], tri[1]), (tri[1], tri[2]), (tri[2], tri[0])] {
                let key = if e.0 < e.1 { e } else { (e.1, e.0) };
                *edge_count.entry(key).or_insert(0) += 1;
            }
        }
        // boundary edges appear once, interior edges twice
        let boundary = edge_count.values().filter(|&&c| c == 1).count();
        let interior_bad = edge_count.values().filter(|&&c| c > 2).count();
        assert_eq!(boundary, 2 * (7 + 6) - 4, "boundary edges");
        assert_eq!(interior_bad, 0, "no edge may be shared by more than 2 triangles");
    }

    #[test]
    fn basis_row_partitions_unity() {
        let knots = vec![0.0, 0.0, 0.0, 0.5, 1.0, 1.0, 1.0];
        for i in 0..=10 {
            let u = i as f64 / 10.0;
            let span = span_for(&knots, 2, u);
            let row = basis_row(&knots, span, 2, u);
            let sum: f64 = row.iter().sum();
            assert!((sum - 1.0).abs() < TOL, "basis sum {} at u={}", sum, u);
        }
    }

    #[test]
    fn curve_validation_rejects_bad_input() {
        assert!(NURBSCurve::new(Vec::new(), KnotVector::new(1, vec![0.0, 1.0])).is_err());
        let cps = vec![ControlPoint::new([0.0; 3], 0.0)];
        assert!(NURBSCurve::new(cps, KnotVector::new(1, vec![0.0, 1.0])).is_err());
    }
}
