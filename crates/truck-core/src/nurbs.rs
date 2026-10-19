use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NURBSCurve {
    pub degree: usize,
    pub knots: Vec<f64>,
    pub control_points: Vec<[f64; 3]>, // (x,y,z)
    pub weights: Vec<f64>,
    pub periodic: bool,
}

impl NURBSCurve {
    pub fn new(degree: usize, knots: Vec<f64>, control_points: Vec<[f64; 3]>, weights: Vec<f64>, periodic: bool) -> Self {
        NURBSCurve {
            degree,
            knots,
            control_points,
            weights,
            periodic,
        }
    }

    pub fn evaluate(&self, t: f64) -> [f64; 3] {
        let n = self.control_points.len();
        let mut result = [0.0, 0.0, 0.0];
        let mut factor = 0.0;

        for i in 0..n {
            let mut basis = 1.0;
            for j in 0..self.degree {
                if let Some(k) = self.knots.get(i + 1 + j) {
                    if let Some(k_prev) = self.knots.get(i + j) {
                        basis *= if k != k_prev { (t - k_prev) / (k - k_prev) } else { 0.0 };
                    }
                }
            }

            let weight = self.weights.get(i).unwrap_or(&1.0);
            let point = self.control_points.get(i).unwrap_or(&[0.0, 0.0, 0.0]);

            result[0] += basis * weight * point[0];
            result[1] += basis * weight * point[1];
            result[2] += basis * weight * point[2];
            factor += basis * weight;
        }

        if factor > 0.0 {
            result[0] /= factor;
            result[1] /= factor;
            result[2] /= factor;
        }

        result
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NURBSSurface {
    pub u_degree: usize,
    pub v_degree: usize,
    pub u_knots: Vec<f64>,
    pub v_knots: Vec<f64>,
    pub control_points: Vec<Vec<[f64; 3]>>, // 2D array of points
    pub weights: Vec<Vec<f64>>,
    pub periodic_u: bool,
    pub periodic_v: bool,
}

impl NURBSSurface {
    pub fn new(
        u_degree: usize,
        v_degree: usize,
        u_knots: Vec<f64>,
        v_knots: Vec<f64>,
        control_points: Vec<Vec<[f64; 3]>>,
        weights: Vec<Vec<f64>>,
        periodic_u: bool,
        periodic_v: bool,
    ) -> Self {
        NURBSSurface {
            u_degree,
            v_degree,
            u_knots,
            v_knots,
            control_points,
            weights,
            periodic_u,
            periodic_v,
        }
    }

    pub fn evaluate(&self, u: f64, v: f64) -> [f64; 3] {
        let rows = self.control_points.len();
        if rows == 0 {
            return [0.0, 0.0, 0.0];
        }
        let cols = self.control_points[0].len();

        let mut result = [0.0, 0.0, 0.0];
        let mut factor = 0.0;

        for i in 0..rows {
            let mut bu = 1.0;
            for j in 0..self.u_degree {
                if let Some(uk) = self.u_knots.get(i + 1 + j) {
                    if let Some(uk_prev) = self.u_knots.get(i + j) {
                        bu *= if *uk != *uk_prev { (u - uk_prev) / (*uk - *uk_prev) } else { 0.0 };
                    }
                }
            }

            for k in 0..cols {
                let mut bv = 1.0;
                for j in 0..self.v_degree {
                    if let Some(vk) = self.v_knots.get(k + 1 + j) {
                        if let Some(vk_prev) = self.v_knots.get(k + j) {
                            bv *= if *vk != *vk_prev { (v - vk_prev) / (*vk - *vk_prev) } else { 0.0 };
                        }
                    }
                }

                let weight = self.weights.get(i).and_then(|row| row.get(k)).unwrap_or(&1.0);
                let point = self.control_points.get(i).and_then(|row| row.get(k)).unwrap_or(&[0.0, 0.0, 0.0]);

                result[0] += bu * bv * weight * point[0];
                result[1] += bu * bv * weight * point[1];
                result[2] += bu * bv * weight * point[2];
                factor += bu * bv * weight;
            }
        }

        if factor > 0.0 {
            result[0] /= factor;
            result[1] /= factor;
            result[2] /= factor;
        }

        result
    }
}
