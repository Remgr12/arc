use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mesh {
    pub vertices: Vec<[f64; 3]>, // x, y, z
    pub normals: Vec<[f64; 3]>, // nx, ny, nz
    pub texcoords: Vec<[f64; 2]>, // u, v
    pub indices: Vec<u32>, // triangle indices
}

impl Mesh {
    pub fn new() -> Self {
        Mesh {
            vertices: Vec::new(),
            normals: Vec::new(),
            texcoords: Vec::new(),
            indices: Vec::new(),
        }
    }
}
