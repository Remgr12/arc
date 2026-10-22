//! Entities and parametric geometry payloads.

use serde::{Deserialize, Serialize};

use crate::core::{Color, EntityId, Transform};

/// A document layer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub id: EntityId,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Color,
}

impl Layer {
    pub fn new(name: String, color: Option<Color>) -> Self {
        Self {
            id: EntityId::new(),
            name,
            visible: true,
            locked: false,
            color: color.unwrap_or(Color::GRAY),
        }
    }
}

/// Parameterized geometry description of an entity. Entity placement
/// (position/orientation/scale) lives on the entity transform; these
/// parameters describe the shape in local space.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Geometry {
    /// Axis-aligned box with optional rounded vertical edges.
    Box {
        width: f64,
        depth: f64,
        height: f64,
        #[serde(default)]
        corner_radius: f64,
    },
    /// UV sphere centered at local origin.
    Sphere { radius: f64, segments: u32 },
    /// Cylinder along +Y.
    Cylinder { radius: f64, height: f64, segments: u32 },
    /// Cone along +Y (apex on top).
    Cone { radius: f64, height: f64, segments: u32 },
    /// Torus lying in the XZ plane.
    Torus {
        radius: f64,
        tube: f64,
        segments: u32,
        tubular_segments: u32,
    },
    /// Flat ground plane in XZ.
    Plane { width: f64, depth: f64 },

    // --- wireframe curves (selectable, not raycast-solid) ---
    /// Straight line from local origin to `end`.
    LineCurve { end: [f64; 3] },
    /// Polyline through points.
    PolylineCurve { points: Vec<[f64; 3]> },
    /// Circle in XZ plane.
    CircleCurve { radius: f64, segments: u32 },
    /// Arc in XZ plane.
    ArcCurve {
        radius: f64,
        start_angle_deg: f64,
        end_angle_deg: f64,
        segments: u32,
    },
    /// Rectangle outline in XZ plane.
    RectangleCurve { width: f64, depth: f64 },
    /// Regular polygon outline in XZ plane.
    PolygonCurve { radius: f64, sides: u32 },

    // --- sweeps & boolean style solids ---
    /// Extrusion of a closed XY polygon upwards by `height`.
    Extrude { polygon: Vec<[f64; 2]>, height: f64 },
    /// Revolution of an XZ profile (x = radius, z = height) about the local Y axis.
    Revolve {
        profile: Vec<[f64; 2]>,
        steps: u32,
        #[serde(default = "default_revolve_angle")]
        angle_deg: f64,
    },
    /// Tube swept along a polyline path.
    Sweep {
        path: Vec<[f64; 3]>,
        radius: f64,
        sides: u32,
    },
    /// Loft between N cross sections with equal vertex counts.
    Loft { sections: Vec<Vec<[f64; 3]>> },

    // --- architecture ---
    /// Wall following a polyline footprint.
    Wall {
        path: Vec<[f64; 2]>,
        width: f64,
        height: f64,
    },
    /// Staircase: `count` steps, each `run` deep, total rise `rise * count`.
    Stair {
        width: f64,
        rise: f64,
        run: f64,
        count: u32,
    },
    /// Flat pad / floor plate over a closed polygon.
    Slab { polygon: Vec<[f64; 2]>, height: f64 },
    /// Gable roof over a rectangular footprint.
    Roof {
        width: f64,
        depth: f64,
        pitch_deg: f64,
        overhang: f64,
    },
    /// Circular or square column along +Y.
    Column {
        radius: f64,
        height: f64,
        sides: u32,
    },
    /// Rectangular beam along X.
    Beam {
        length: f64,
        width: f64,
        height: f64,
    },
    /// Door with frame and panel, oriented in X facing +Z.
    Door {
        width: f64,
        height: f64,
        depth: f64,
        swing_deg: f64,
    },
    /// Window with frame, glazing bars and glass, oriented in X facing +Z.
    Window {
        width: f64,
        height: f64,
        depth: f64,
        panes_x: u32,
        panes_y: u32,
    },

    // --- annotation ---
    /// Dimension between two points (rendered as line + arrows + label).
    Dimension { start: [f64; 3], end: [f64; 3] },

    // --- imported mesh data ---
    /// Triangle soup imported from STL/OBJ (positions + triangle indices).
    ImportedMesh {
        positions: Vec<[f64; 3]>,
        indices: Vec<u32>,
    },

    // --- NURBS ---
    /// Tensor-product NURBS surface. Rows index U, columns index V;
    /// each control point is homogeneous [x, y, z, weight].
    NurbsSurface {
        control_points: Vec<Vec<[f64; 4]>>,
        u_degree: u32,
        v_degree: u32,
        u_knots: Vec<f64>,
        v_knots: Vec<f64>,
    },
    /// Loft through NURBS curves; each section is a row of homogeneous
    /// control points sampled into the shared U direction.
    NurbsLoft {
        sections: Vec<Vec<[f64; 4]>>,
        degree: u32,
        samples_u: u32,
        samples_v: u32,
    },
    /// Sweep a NURBS profile curve along a NURBS path curve.
    NurbsSweep {
        path: Vec<[f64; 4]>,
        profile: Vec<[f64; 4]>,
        path_degree: u32,
        profile_degree: u32,
        samples_u: u32,
        samples_v: u32,
    },
    /// Boolean combination of two child geometries (union, difference, intersection).
    /// Both children are evaluated in local space before the operation.
    Csg {
        operation: CsgOperation,
        first: Box<Geometry>,
        second: Box<Geometry>,
    },
    /// Fillet applied to a picked edge of a source solid. The edge is stored
    /// as its two endpoints in source-local coordinates and matched
    /// geometrically when the payload is evaluated.
    SolidFillet {
        source: Box<Geometry>,
        edge: [[f64; 3]; 2],
        radius: f64,
    },
}

/// Boolean operation applied by a `Geometry::Csg`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsgOperation {
    Union,
    Difference,
    Intersection,
}

fn default_revolve_angle() -> f64 {
    360.0
}

impl Geometry {
    pub fn type_name(&self) -> &'static str {
        match self {
            Geometry::Box { .. } => "box",
            Geometry::Sphere { .. } => "sphere",
            Geometry::Cylinder { .. } => "cylinder",
            Geometry::Cone { .. } => "cone",
            Geometry::Torus { .. } => "torus",
            Geometry::Plane { .. } => "plane",
            Geometry::LineCurve { .. } => "line",
            Geometry::PolylineCurve { .. } => "polyline",
            Geometry::CircleCurve { .. } => "circle",
            Geometry::ArcCurve { .. } => "arc",
            Geometry::RectangleCurve { .. } => "rectangle",
            Geometry::PolygonCurve { .. } => "polygon",
            Geometry::Extrude { .. } => "extrude",
            Geometry::Revolve { .. } => "revolve",
            Geometry::Sweep { .. } => "sweep",
            Geometry::Loft { .. } => "loft",
            Geometry::NurbsSurface { .. } => "nurbs_surface",
            Geometry::NurbsLoft { .. } => "nurbs_loft",
            Geometry::NurbsSweep { .. } => "nurbs_sweep",
            Geometry::Csg { .. } => "csg",
            Geometry::SolidFillet { .. } => "solid_fillet",
            Geometry::ImportedMesh { .. } => "imported_mesh",
            Geometry::Wall { .. } => "wall",
            Geometry::Stair { .. } => "stair",
            Geometry::Slab { .. } => "slab",
            Geometry::Roof { .. } => "roof",
            Geometry::Column { .. } => "column",
            Geometry::Beam { .. } => "beam",
            Geometry::Door { .. } => "door",
            Geometry::Window { .. } => "window",
            Geometry::Dimension { .. } => "dimension",
        }
    }

    /// Human-friendly category.
    pub fn category(&self) -> GeometryCategory {
        match self {
            Geometry::Box { .. }
            | Geometry::Sphere { .. }
            | Geometry::Cylinder { .. }
            | Geometry::Cone { .. }
            | Geometry::Torus { .. }
            | Geometry::Plane { .. } => GeometryCategory::Primitive,
            Geometry::LineCurve { .. }
            | Geometry::PolylineCurve { .. }
            | Geometry::CircleCurve { .. }
            | Geometry::ArcCurve { .. }
            | Geometry::RectangleCurve { .. }
            | Geometry::PolygonCurve { .. } => GeometryCategory::Sketch,
            Geometry::Extrude { .. }
            | Geometry::Revolve { .. }
            | Geometry::Sweep { .. }
            | Geometry::Loft { .. }
            | Geometry::NurbsSurface { .. }
            | Geometry::NurbsLoft { .. }
            | Geometry::NurbsSweep { .. }
            | Geometry::Csg { .. }
            | Geometry::SolidFillet { .. } => GeometryCategory::Solid,
            Geometry::Wall { .. }
            | Geometry::Stair { .. }
            | Geometry::Slab { .. }
            | Geometry::Roof { .. }
            | Geometry::Column { .. }
            | Geometry::Beam { .. }
            | Geometry::Door { .. }
            | Geometry::Window { .. } => GeometryCategory::Architecture,
            Geometry::Dimension { .. } => GeometryCategory::Annotation,
            Geometry::ImportedMesh { .. } => GeometryCategory::Solid,
        }
    }

    /// Entities composed of triangles are raycast targets; curves only hit
    /// segment-based picking.
    pub fn has_triangles(&self) -> bool {
        !matches!(
            self,
            Geometry::LineCurve { .. }
                | Geometry::PolylineCurve { .. }
                | Geometry::CircleCurve { .. }
                | Geometry::ArcCurve { .. }
                | Geometry::RectangleCurve { .. }
                | Geometry::PolygonCurve { .. }
                | Geometry::Dimension { .. }
        )
    }

    /// Curves that render as line geometry.
    pub fn has_lines(&self) -> bool {
        matches!(
            self,
            Geometry::LineCurve { .. }
                | Geometry::PolylineCurve { .. }
                | Geometry::CircleCurve { .. }
                | Geometry::ArcCurve { .. }
                | Geometry::RectangleCurve { .. }
                | Geometry::PolygonCurve { .. }
        ) || matches!(self, Geometry::Dimension { .. })
    }

    /// All polygons must be closed for cap triangulation.
    pub fn validate(&self) -> Result<(), String> {
        let check_poly = |poly: &[[f64; 2]], name: &str| {
            if poly.len() < 3 {
                return Err(format!("{name} needs at least 3 points"));
            }
            Ok(())
        };
        match self {
            Geometry::Box { width, depth, height, .. } => {
                if *width <= 0.0 || *depth <= 0.0 || *height <= 0.0 {
                    return Err("box dimensions must be positive".into());
                }
            }
            Geometry::Sphere { radius, .. }
            | Geometry::Cylinder { radius, .. }
            | Geometry::Cone { radius, .. }
            | Geometry::CircleCurve { radius, .. }
            | Geometry::ArcCurve { radius, .. }
            | Geometry::PolygonCurve { radius, .. }
            | Geometry::Sweep { radius, .. }
            | Geometry::Column { radius, .. }
            | Geometry::Torus { radius, .. } => {
                if *radius <= 0.0 {
                    return Err("radius must be positive".into());
                }
            }
            Geometry::Extrude { polygon, height } => {
                check_poly(polygon, "extrude profile")?;
                if *height <= 0.0 {
                    return Err("extrude height must be positive".into());
                }
            }
            Geometry::Revolve { profile, steps, .. } => {
                check_poly(profile, "revolve profile")?;
                if *steps < 3 {
                    return Err("revolve steps must be >= 3".into());
                }
            }
            Geometry::Wall { path, width, height } => {
                if path.len() < 2 {
                    return Err("wall path needs at least 2 points".into());
                }
                if *width <= 0.0 || *height <= 0.0 {
                    return Err("wall width/height must be positive".into());
                }
            }
            Geometry::Stair { rise, run, count, .. } => {
                if *rise <= 0.0 || *run <= 0.0 || *count == 0 {
                    return Err("stair rise/run/count must be positive".into());
                }
            }
            Geometry::Slab { polygon, height } => {
                check_poly(polygon, "slab polygon")?;
                if *height <= 0.0 {
                    return Err("slab height must be positive".into());
                }
            }
            _ => {}
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryCategory {
    Primitive,
    Sketch,
    Solid,
    Architecture,
    Annotation,
    Csg,
}

/// A document entity: identity, display info, transform and parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    pub id: EntityId,
    pub name: String,
    pub layer: EntityId,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<Color>,
    pub transform: Transform,
    pub kind: Geometry,
    /// Optional material key from the materials library (e.g. "steel").
    pub material: Option<String>,
}

impl Entity {
    pub fn new(id: EntityId, name: String, layer: EntityId, kind: Geometry) -> Self {
        Self {
            id,
            name,
            layer,
            visible: true,
            locked: false,
            color: None,
            transform: Transform::default(),
            kind,
            material: None,
        }
    }
}

/// Entity as sent to the frontend (without mesh buffers; mesh arrays ride along in SceneData).
#[derive(Debug, Clone, Serialize)]
pub struct EntityData {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub category: GeometryCategory,
    pub layer: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<[f32; 4]>,
    pub transform: Transform,
    pub geometry: Geometry,
    /// Optional material key from the materials library (e.g. "steel", "glass").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub material: Option<String>,
}
