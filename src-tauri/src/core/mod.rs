//! app-core: the domain model of the arc application.
//!
//! Contains the entity model, parametric geometry payload definitions,
//! document model with layers/selection/history, raycasting and
//! persistence-friendly serialization types. Mesh generation and all
//! solid geometry evaluation live in the `kernel` module.

pub mod annotation;
pub mod assembly;
pub mod constraints;
pub mod document;
pub mod entity;
pub mod formats;
pub mod history;
pub mod mesh;
pub mod sheetmetal;
pub mod units;

pub use document::*;
pub use entity::*;
pub use history::*;
pub use mesh::*;
pub use units::*;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Unique identifier of an entity or layer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EntityId(pub Uuid);

impl EntityId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }
    pub fn nil() -> Self {
        Self(Uuid::nil())
    }
    pub fn as_string(&self) -> String {
        self.0.to_string()
    }
    pub fn parse(s: &str) -> Option<Self> {
        Uuid::parse_str(s).ok().map(Self)
    }
}

impl Default for EntityId {
    fn default() -> Self {
        Self::new()
    }
}

impl EntityId {
    /// Short human-friendly prefix (first 8 chars) used for auto names.
    pub fn short(&self) -> String {
        self.0.to_string()[..8].to_string()
    }
}

impl std::fmt::Display for EntityId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

/// RGBA color, components in 0..=1.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const fn rgb(r: f32, g: f32, b: f32) -> Self {
        Self { r, g, b, a: 1.0 }
    }
    pub const WHITE: Color = Color::rgb(1.0, 1.0, 1.0);
    pub const GRAY: Color = Color::rgb(0.62, 0.62, 0.65);
    pub const ORANGE: Color = Color::rgb(0.95, 0.61, 0.22);
    pub const BLUE: Color = Color::rgb(0.36, 0.55, 0.98);
    pub const GREEN: Color = Color::rgb(0.42, 0.73, 0.38);

    pub fn to_css(&self) -> String {
        if self.a >= 1.0 {
            format!("rgb({:.0} {:.0} {:.0})", self.r * 255.0, self.g * 255.0, self.b * 255.0)
        } else {
            format!(
                "rgba({:.0} {:.0} {:.0} {:.2})",
                self.r * 255.0,
                self.g * 255.0,
                self.b * 255.0,
                self.a
            )
        }
    }
}

/// Troubleshooting-free linear transform: position + quaternion rotation + scale.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Transform {
    pub position: [f64; 3],
    pub rotation: [f64; 4], // quaternion (x, y, z, w), normalized
    pub scale: [f64; 3],
}

impl Default for Transform {
    fn default() -> Self {
        Self {
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
        }
    }
}

impl Transform {
    pub fn identity() -> Self {
        Self::default()
    }

    pub fn at(x: f64, y: f64, z: f64) -> Self {
        Self {
            position: [x, y, z],
            ..Self::default()
        }
    }

    /// Rotation quaternion from axis + angle in radians.
    pub fn from_axis_angle(axis: [f64; 3], angle: f64) -> Self {
        let n = (axis[0] * axis[0] + axis[1] * axis[1] + axis[2] * axis[2]).sqrt();
        if n == 0.0 {
            return Self::default();
        }
        let (ax, ay, az) = (axis[0] / n, axis[1] / n, axis[2] / n);
        let s = (angle / 2.0).sin();
        Self {
            rotation: [ax * s, ay * s, az * s, (angle / 2.0).cos()],
            ..Self::default()
        }
    }

    /// 4x4 world matrix (column-major list suitable for three.js).
    pub fn to_world_matrix(&self) -> Vec<f64> {
        let q = nalgebra::UnitQuaternion::from_quaternion(nalgebra::Quaternion::new(
            self.rotation[3],
            self.rotation[0],
            self.rotation[1],
            self.rotation[2],
        ));
        let m = nalgebra::Matrix4::new_translation(&nalgebra::Vector3::new(
            self.position[0],
            self.position[1],
            self.position[2],
        )) * q.to_homogeneous()
            * nalgebra::Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::new(
                self.scale[0],
                self.scale[1],
                self.scale[2],
            ));
        let mut out = [0.0f64; 16];
        for (i, col) in m.column_iter().enumerate() {
            out[i * 4] = col.x;
            out[i * 4 + 1] = col.y;
            out[i * 4 + 2] = col.z;
            out[i * 4 + 3] = col.w;
        }
        out.to_vec()
    }

    /// Inverse matrix as list (column-major).
    pub fn to_inverse_matrix(&self) -> [f64; 16] {
        let q = nalgebra::UnitQuaternion::from_quaternion(nalgebra::Quaternion::new(
            self.rotation[3],
            self.rotation[0],
            self.rotation[1],
            self.rotation[2],
        ));
        let m = nalgebra::Matrix4::new_translation(&nalgebra::Vector3::new(
            self.position[0],
            self.position[1],
            self.position[2],
        )) * q.to_homogeneous()
            * nalgebra::Matrix4::new_nonuniform_scaling(&nalgebra::Vector3::new(
                self.scale[0],
                self.scale[1],
                self.scale[2],
            ));
        let inv = m.try_inverse().unwrap_or(nalgebra::Matrix4::identity());
        let mut out = [0.0f64; 16];
        for (i, col) in inv.column_iter().enumerate() {
            out[i * 4] = col.x;
            out[i * 4 + 1] = col.y;
            out[i * 4 + 2] = col.z;
            out[i * 4 + 3] = col.w;
        }
        out
    }

    /// Transform world ray into local space.
    pub fn ray_to_local(&self, origin: [f64; 3], dir: [f64; 3]) -> ([f64; 3], [f64; 3]) {
        let inv = self.to_inverse_matrix();
        let apply = |p: [f64; 3], w: f64| -> [f64; 3] {
            [
                inv[0] * p[0] + inv[4] * p[1] + inv[8] * p[2] + inv[12] * w,
                inv[1] * p[0] + inv[5] * p[1] + inv[9] * p[2] + inv[13] * w,
                inv[2] * p[0] + inv[6] * p[1] + inv[10] * p[2] + inv[14] * w,
            ]
        };
        let o = apply(origin, 1.0);
        let d = apply(dir, 0.0);
        (o, d)
    }

    pub fn transform_point(&self, p: [f64; 3]) -> [f64; 3] {
        let m = self.to_world_matrix();
        let (x, y, z) = (p[0], p[1], p[2]);
        [
            m[0] * x + m[4] * y + m[8] * z + m[12],
            m[1] * x + m[5] * y + m[9] * z + m[13],
            m[2] * x + m[6] * y + m[10] * z + m[14],
        ]
    }

    /// Transform direction (ignores translation, normalizes).
    pub fn transform_dir(&self, d: [f64; 3]) -> [f64; 3] {
        let m = self.to_world_matrix();
        let (x, y, z) = (d[0], d[1], d[2]);
        let v = [
            m[0] * x + m[4] * y + m[8] * z,
            m[1] * x + m[5] * y + m[9] * z,
            m[2] * x + m[6] * y + m[10] * z,
        ];
        let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if len == 0.0 {
            v
        } else {
            [v[0] / len, v[1] / len, v[2] / len]
        }
    }
}

/// World-space ray cast result.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RayHit {
    pub entity_id: EntityId,
    pub point: [f64; 3],
    pub normal: [f64; 3],
    pub distance: f64,
}
