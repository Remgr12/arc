use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Units {
    pub scale: f64,
    pub system: String,
    pub custom_factors: bool,
}

impl Units {
    pub fn new() -> Self {
        Units {
            scale: 1.0,
            system: "metric".to_string(),
            custom_factors: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MeshGeneration {
    pub subdivisions: usize,
    pub smooth: bool,
    pub symmetry: Option<[f64; 3]>, // x, y, z symmetry planes
    pub merge_tolerance: f64,
}

impl MeshGeneration {
    pub fn new() -> Self {
        MeshGeneration {
            subdivisions: 1,
            smooth: true,
            symmetry: None,
            merge_tolerance: 1e-6,
        }
    }
}

pub fn generate_mesh(vertices: &[[f64; 3]], indices: &[u32], generation: &MeshGeneration) -> (Vec<[f64; 3]>, Vec<[f64; 3]>, Vec<[f64; 2]>, Vec<u32>) {
    let mut result_vertices = vertices.to_vec();
    let mut result_normals = vec![[0.0, 0.0, 0.0]; vertices.len()];
    let mut result_texcoords = vec![[0.0, 0.0]; vertices.len()];

    for triangle in indices.chunks(3) {
        if triangle.len() < 3 {
            continue;
        }

        let v0 = vertices[triangle[0] as usize];
        let v1 = vertices[triangle[1] as usize];
        let v2 = vertices[triangle[2] as usize];

        let edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        let edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

        let normal = [
            edge1[1] * edge2[2] - edge1[2] * edge2[1],
            edge1[2] * edge2[0] - edge1[0] * edge2[2],
            edge1[0] * edge2[1] - edge1[1] * edge2[0],
        ];

        let normal_len = (normal[0].powi(2) + normal[1].powi(2) + normal[2].powi(2)).sqrt();
        if normal_len > 0.0 {
            let inv_normal_len = 1.0 / normal_len;
            let normalized_normal = [normal[0] * inv_normal_len, normal[1] * inv_normal_len, normal[2] * inv_normal_len];

            result_normals[triangle[0] as usize][0] += normalized_normal[0];
            result_normals[triangle[0] as usize][1] += normalized_normal[1];
            result_normals[triangle[0] as usize][2] += normalized_normal[2];

            result_normals[triangle[1] as usize][0] += normalized_normal[0];
            result_normals[triangle[1] as usize][1] += normalized_normal[1];
            result_normals[triangle[1] as usize][2] += normalized_normal[2];

            result_normals[triangle[2] as usize][0] += normalized_normal[0];
            result_normals[triangle[2] as usize][1] += normalized_normal[1];
            result_normals[triangle[2] as usize][2] += normalized_normal[2];
        }
    }

    for normal in result_normals.iter_mut() {
        let len = (normal[0].powi(2) + normal[1].powi(2) + normal[2].powi(2)).sqrt();
        if len > 0.0 {
            normal[0] /= len;
            normal[1] /= len;
            normal[2] /= len;
        }
    }

    if generation.smooth {
        // Simplified smooth filter - could be improved
        for i in 1..result_vertices.len() - 1 {
            result_vertices[i][0] = (result_vertices[i - 1][0] + result_vertices[i][0] + result_vertices[i + 1][0]) / 3.0;
            result_vertices[i][1] = (result_vertices[i - 1][1] + result_vertices[i][1] + result_vertices[i + 1][1]) / 3.0;
            result_vertices[i][2] = (result_vertices[i - 1][2] + result_vertices[i][2] + result_vertices[i + 1][2]) / 3.0;
        }
    }

    (result_vertices, result_normals, result_texcoords, indices.to_vec())
}

pub struct MeshGenerator {
    generation: MeshGeneration,
}

impl MeshGenerator {
    pub fn new() -> Self {
        MeshGenerator {
            generation: MeshGeneration::new(),
        }
    }

    pub fn generate(&self, vertices: &[[f64; 3]], indices: &[u32]) -> (Vec<[f64; 3]>, Vec<[f64; 3]>, Vec<[f64; 2]>, Vec<u32>) {
        generate_mesh(vertices, indices, &self.generation)
    }
}

pub fn raycast_mesh(origin: &[f64; 3], direction: &[f64; 3], vertices: &[[f64; 3]], indices: &[u32]) -> Option<f64> {
    let mut nearest_dist = f64::MAX;

    for triangle in indices.chunks(3) {
        if triangle.len() < 3 {
            continue;
        }

        let v0 = vertices[triangle[0] as usize];
        let v1 = vertices[triangle[1] as usize];
        let v2 = vertices[triangle[2] as usize];

        let edge1 = [v1[0] - v0[0], v1[1] - v0[1], v1[2] - v0[2]];
        let edge2 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];

        let mut h = [direction[1] * edge2[2] - direction[2] * edge2[1],
            direction[2] * edge2[0] - direction[0] * edge2[2],
            direction[0] * edge2[1] - direction[1] * edge2[0]];

        let a = edge1[0] * h[0] + edge1[1] * h[1] + edge1[2] * h[2];
        if a.abs() < 1e-6 {
            continue;
        }

        let f = 1.0 / a;
        let s = [
            origin[0] - v0[0], origin[1] - v0[1], origin[2] - v0[2],
        ];

        let u = f * (s[0] * h[0] + s[1] * h[1] + s[2] * h[2]);
        if u < 0.0 || u > 1.0 {
            continue;
        }

        let q = [
            s[1] * edge2[2] - s[2] * edge2[1],
            s[2] * edge2[0] - s[0] * edge2[2],
            s[0] * edge1[2] - s[1] * edge1[2],
        ];

        let v = f * (direction[0] * q[0] + direction[1] * q[1] + direction[2] * q[2]);
        if v < 0.0 || u + v > 1.0 {
            continue;
        }

        let t = f * (edge1[0] * q[0] + edge1[1] * q[1] + edge1[2] * q[2]);
        if t > 1e-6 && t < nearest_dist {
            nearest_dist = t;
        }
    }

    if nearest_dist < f64::MAX { Some(nearest_dist) } else { None }
}
