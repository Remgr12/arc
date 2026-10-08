pub mod entity;
pub mod selection;
pub mod document;
pub mod layer;
pub mod units;
pub mod snap;
pub mod constraint;
pub mod history;
pub mod viewport;
pub mod events;

use std::sync::Arc;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3, UnitQuaternion, Matrix4};
use glam::{Vec3, Quat, Mat4};

pub use entity::*;
pub use selection::*;
pub use document::*;
pub use layer::*;
pub use units::*;
pub use snap::*;
pub use constraint::*;
pub use history::*;
pub use viewport::*;
pub use events::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EntityId(pub Uuid);

impl EntityId {
    pub fn new() -> Self {
        Self(Uuid::new_v4())
    }

    pub fn nil() -> Self {
        Self(Uuid::nil())
    }
}

impl Default for EntityId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
pub struct Color {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Color {
    pub const WHITE: Self = Self { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
    pub const BLACK: Self = Self { r: 0.0, g: 0.0, b: 0.0, a: 1.0 };
    pub const RED: Self = Self { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
    pub const GREEN: Self = Self { r: 0.0, g: 1.0, b: 0.0, a: 1.0 };
    pub const BLUE: Self = Self { r: 0.0, g: 0.0, b: 1.0, a: 1.0 };
    pub const YELLOW: Self = Self { r: 1.0, g: 1.0, b: 0.0, a: 1.0 };
    pub const MAGENTA: Self = Self { r: 1.0, g: 0.0, b: 1.0, a: 1.0 };
    pub const CYAN: Self = Self { r: 0.0, g: 1.0, b: 1.0, a: 1.0 };
    pub const ORANGE: Self = Self { r: 1.0, g: 0.5, b: 0.0, a: 1.0 };
    pub const GRAY: Self = Self { r: 0.5, g: 0.5, b: 0.5, a: 1.0 };
    pub const LIGHT_GRAY: Self = Self { r: 0.8, g: 0.8, b: 0.8, a: 1.0 };
    pub const TRANSPARENT: Self = Self { r: 0.0, g: 0.0, b: 0.0, a: 0.0 };

    pub fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Self { r, g, b, a }
    }

    pub fn rgb(r: f32, g: f32, b: f32) -> Self {
        Self { r, g, b, a: 1.0 }
    }

    pub fn from_hex(hex: u32) -> Self {
        Self {
            r: ((hex >> 16) & 0xFF) as f32 / 255.0,
            g: ((hex >> 8) & 0xFF) as f32 / 255.0,
            b: (hex & 0xFF) as f32 / 255.0,
            a: 1.0,
        }
    }

    pub fn to_array(&self) -> [f32; 4] {
        [self.r, self.g, self.b, self.a]
    }
}

impl From<Color> for [f32; 4] {
    fn from(c: Color) -> Self {
        c.to_array()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct BoundingBox {
    pub min: Point3<f64>,
    pub max: Point3<f64>,
}

impl BoundingBox {
    pub fn new(min: Point3<f64>, max: Point3<f64>) -> Self {
        Self { min, max }
    }

    pub fn empty() -> Self {
        Self {
            min: Point3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY),
            max: Point3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY),
        }
    }

    pub fn center(&self) -> Point3<f64> {
        Point3::new(
            (self.min.x + self.max.x) * 0.5,
            (self.min.y + self.max.y) * 0.5,
            (self.min.z + self.max.z) * 0.5,
        )
    }

    pub fn size(&self) -> Vector3<f64> {
        self.max - self.min
    }

    pub fn contains(&self, point: Point3<f64>) -> bool {
        point.x >= self.min.x && point.x <= self.max.x &&
        point.y >= self.min.y && point.y <= self.max.y &&
        point.z >= self.min.z && point.z <= self.max.z
    }

    pub fn expand(&mut self, other: &BoundingBox) {
        self.min.x = self.min.x.min(other.min.x);
        self.min.y = self.min.y.min(other.min.y);
        self.min.z = self.min.z.min(other.min.z);
        self.max.x = self.max.x.max(other.max.x);
        self.max.y = self.max.y.max(other.max.y);
        self.max.z = self.max.z.max(other.max.z);
    }

    pub fn expand_point(&mut self, point: Point3<f64>) {
        self.min.x = self.min.x.min(point.x);
        self.min.y = self.min.y.min(point.y);
        self.min.z = self.min.z.min(point.z);
        self.max.x = self.max.x.max(point.x);
        self.max.y = self.max.y.max(point.y);
        self.max.z = self.max.z.max(point.z);
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EntityType {
    // Sketch entities
    Point,
    Line,
    Arc,
    Circle,
    Ellipse,
    Spline,
    Rectangle,
    Polygon,
    Text,

    // 3D entities
    Extrusion,
    Revolution,
    Loft,
    Sweep,
    Fillet,
    Chamfer,
    Shell,
    Boolean,

    // Architecture entities
    Wall,
    Door,
    Window,
    Stair,
    Roof,
    Slab,
    Column,
    Beam,
    Room,
    Grid,
    Level,

    // Reference/construction
    Plane,
    Axis,
    Point3D,
    CoordinateSystem,

    // Annotation
    Dimension,
    Leader,
    Tag,
    Symbol,

    // Group/Assembly
    Group,
    Block,
    ExternalReference,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum RenderMode {
    Solid,
    Wireframe,
    Edges,
    Points,
    Shaded,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityCategory {
    Sketch,
    Solid,
    Surface,
    Mesh,
    Architecture,
    Annotation,
    Reference,
    Group,
}

impl EntityType {
    pub fn category(&self) -> EntityCategory {
        match self {
            EntityType::Point | EntityType::Line | EntityType::Arc | EntityType::Circle
            | EntityType::Ellipse | EntityType::Spline | EntityType::Rectangle
            | EntityType::Polygon | EntityType::Text => EntityCategory::Sketch,

            EntityType::Extrusion | EntityType::Revolution | EntityType::Loft
            | EntityType::Sweep | EntityType::Fillet | EntityType::Chamfer
            | EntityType::Shell | EntityType::Boolean => EntityCategory::Solid,

            EntityType::Wall | EntityType::Door | EntityType::Window
            | EntityType::Stair | EntityType::Roof | EntityType::Slab
            | EntityType::Column | EntityType::Beam | EntityType::Room
            | EntityType::Grid | EntityType::Level => EntityCategory::Architecture,

            EntityType::Dimension | EntityType::Leader | EntityType::Tag | EntityType::Symbol => EntityCategory::Annotation,

            EntityType::Plane | EntityType::Axis | EntityType::Point3D | EntityType::CoordinateSystem => EntityCategory::Reference,

            EntityType::Group | EntityType::Block | EntityType::ExternalReference => EntityCategory::Group,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ViewType {
    Perspective,
    Orthographic,
    Top,
    Bottom,
    Front,
    Back,
    Left,
    Right,
    Isometric,
    Dimetric,
    Trimetric,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ViewportState {
    pub view_type: ViewType,
    pub camera_position: Point3<f64>,
    pub camera_target: Point3<f64>,
    pub camera_up: Vector3<f64>,
    pub fov: f64,
    pub near: f64,
    pub far: f64,
    pub aspect_ratio: f32,
}

impl Default for ViewportState {
    fn default() -> Self {
        Self {
            view_type: ViewType::Perspective,
            camera_position: Point3::new(10.0, 10.0, 10.0),
            camera_target: Point3::origin(),
            camera_up: Vector3::new(0.0, 0.0, 1.0),
            fov: 45.0_f64.to_radians(),
            near: 0.1,
            far: 10000.0,
            aspect_ratio: 16.0 / 9.0,
        }
    }
}

impl ViewportState {
    pub fn view_matrix(&self) -> Matrix4<f64> {
        Matrix4::look_at_rh(
            &self.camera_position,
            &self.camera_target,
            &self.camera_up,
        )
    }

    pub fn projection_matrix(&self) -> Matrix4<f64> {
        match self.view_type {
            ViewType::Perspective => {
                Matrix4::new_perspective(self.aspect_ratio as f64, self.fov, self.near, self.far)
            }
            _ => {
                let size = 50.0;
                Matrix4::new_orthographic(
                    -size * self.aspect_ratio as f64,
                    size * self.aspect_ratio as f64,
                    -size,
                    size,
                    self.near,
                    self.far,
                )
            }
        }
    }

    pub fn view_projection_matrix(&self) -> Matrix4<f64> {
        self.projection_matrix() * self.view_matrix()
    }
}

pub fn nalgebra_to_glam_point3(p: Point3<f64>) -> Vec3 {
    Vec3::new(p.x as f32, p.y as f32, p.z as f32)
}

pub fn nalgebra_to_glam_vector3(v: Vector3<f64>) -> Vec3 {
    Vec3::new(v.x as f32, v.y as f32, v.z as f32)
}

pub fn glam_to_nalgebra_point3(v: Vec3) -> Point3<f64> {
    Point3::new(v.x as f64, v.y as f64, v.z as f64)
}

pub fn glam_to_nalgebra_vector3(v: Vec3) -> Vector3<f64> {
    Vector3::new(v.x as f64, v.y as f64, v.z as f64)
}

pub fn nalgebra_to_glam_mat4(m: &Matrix4<f64>) -> Mat4 {
    Mat4::from_cols_array_2d(&[
        [m.m11 as f32, m.m12 as f32, m.m13 as f32, m.m14 as f32],
        [m.m21 as f32, m.m22 as f32, m.m23 as f32, m.m24 as f32],
        [m.m31 as f32, m.m32 as f32, m.m33 as f32, m.m34 as f32],
        [m.m41 as f32, m.m42 as f32, m.m43 as f32, m.m44 as f32],
    ])
}

pub fn glam_to_nalgebra_mat4(m: Mat4) -> Matrix4<f64> {
    let cols = m.to_cols_array_2d();
    Matrix4::new(
        cols[0][0] as f64, cols[1][0] as f64, cols[2][0] as f64, cols[3][0] as f64,
        cols[0][1] as f64, cols[1][1] as f64, cols[2][1] as f64, cols[3][1] as f64,
        cols[0][2] as f64, cols[1][2] as f64, cols[2][2] as f64, cols[3][2] as f64,
        cols[0][3] as f64, cols[1][3] as f64, cols[2][3] as f64, cols[3][3] as f64,
    )
}