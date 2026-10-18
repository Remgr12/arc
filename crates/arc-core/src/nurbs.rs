use serde::{Deserialize, Serialize};
use nalgebra::{Vector3, Matrix4, Point3, Isometry3, UnitQuaternion};
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
        if knot_vector_u.degree != knot_vector_v.degree {
            return Err("U and V knot vectors must have the same degree".to_string());
        }
        if !knot_vector_u.is_valid() || !knot_vector_v.is_valid() {
            return Err("Invalid knot vector".to_string());
        }
        let degree = knot_vector_u.degree as usize;
        let (u_count, v_count) = (control_points.len(), control_points[0].len());
        if u_count < degree + 1 || v_count < degree + 1 {
            return Err("Insufficient control points for given degree".to_string());
        }
        if control_points.iter().any(|row| row.len() != v_count) {
            return Err("Control point grid must be rectangular".to_string());
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
        let u_span = self.knot_vector_u.find_span(u);
        let v_span = self.knot_vector_v.find_span(v);
        
        let mut point = Vector4::homogeneous_point(0.0, 0.0, 0.0);
        let mut weighted_sum = 0.0;
        
        for i in 0..=self.knot_vector_u.degree as usize {
            let ui = u_span - self.knot_vector_u.degree as usize + i;
            let nui = self.knot_vector_u.evaluate_basis(u, ui);
            
            let mut v_point = Vector4::homogeneous_point(0.0, 0.0, 0.0);
            let mut v_weighted_sum = 0.0;
            
            for j in 0..=self.knot_vector_v.degree as usize {
                let vj = v_span - self.knot_vector_v.degree as usize + j;
                let nvj = self.knot_vector_v.evaluate_basis(v, vj);
                
                let control_point = &self.control_points[ui][vj];
                let cp_vec = control_point.to_vector4();
                
                v_point.x += nvj * cp_vec.x * cp_vec.w;
                v_point.y += nvj * cp_vec.y * cp_vec.w;
                v_point.z += nvj * cp_vec.z * cp_vec.w;
                v_weighted_sum += nvj * cp_vec.w;
            }
            
            point.x += nui * v_point.x;
            point.y += nui * v_point.y;
            point.z += nui * v_point.z;
            weighted_sum += nui * v_weighted_sum;
        }
        
        let result_point: Point3<f64> = point.into();
        let normal = [result_point.x, result_point.y, result_point.z];
        
        Ok(PointOnSurface::new(
            [result_point.x, result_point.y, result_point.z],
            normal,
            u,
            v,
            (1.0, 1.0),
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NURBSTrimCurve {
    pub type: TrimCurveType,
    pub points: Vec<[f64; 3]>,
}

impl NURBSTrimCurve {
    pub fn new(type: TrimCurveType, points: Vec<[f64; 3]>) -> Self {
        Self { type, points }
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
                let phi = PI * (j as f64) / (v_segments as f64 - 1);
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
        for i in 0..u_segments - degree as usize + 1 {
            knots_u.push(i as f64);
        }
        for _ in 0..(degree as usize + 1) {
            knots_u.push(u_segments as f64);
        }
        let mut knots_v = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_v.push(0.0);
        }
        for i in 0..v_segments - degree as usize + 1 {
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
                let weight = weights.as_ref().and_then(|w| w.get(i)).copied().unwrap_or(1.0);
                v_row.push(ControlPoint::new(*pos, weight));
            }
            control_points.push(v_row);
        }
        let knot_count = (control_points.len() + degree as usize).max((control_points[0].len() + degree as usize) as usize);
        let mut knots_u = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_u.push(0.0);
        }
        for i in 1..u_segments as usize - degree as usize + 1 {
            knots_u.push(i as f64);
        }
        for _ in 0..(degree as usize + 1) {
            knots_u.push(u_segments as f64);
        }
        let mut knots_v = Vec::new();
        for _ in 0..(degree as usize + 1) {
            knots_v.push(0.0);
        }
        for i in 1..v_segments as usize - degree as usize + 1 {
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