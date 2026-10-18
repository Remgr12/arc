//! Professional dimension annotation system for arc 3D modeling.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::Color;

/// Dimension types for professional CAD annotations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DimensionType {
    /// Linear dimension: distance between two points
    Linear,
    /// Aligned dimension: distance projected onto a reference axis
    LinearAligned,
    /// Rotated dimension: distance between points with arbitrary orientation
    LinearRotated,
    /// Projected dimension: distance measured along a projection direction
    LinearProjected,
    /// Angular dimension: angle between two intersecting lines
    Angular,
    /// Radial dimension: radius or diameter of a circle/arc
    Radial,
    /// Ordinate dimension: coordinate value from a reference point
    Ordinate,
    /// Custom dimension with user-defined geometry and measurement
    Custom,
}

/// Arrowhead styles for dimension annotations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArrowheadStyle {
    /// Closed filled triangle
    Closed,
    /// Open triangle
    Open,
    /// Dot at the end
    Dot,
    /// Slash mark
    Slash,
    /// No arrowhead
    None,
}

/// Text style for dimension labels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TextStyle {
    /// Regular text
    Regular,
    /// Bold text
    Bold,
    /// Italic text
    Italic,
    /// Underlined text
    Underlined,
}

/// Leader line style for associative annotations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LeaderStyle {
    /// Solid line
    Solid,
    /// Dashed line
    Dashed,
    /// Dotted line
    Dotted,
    /// No leader
    None,
}

/// Line type for annotation lines.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LineType {
    /// Solid line
    Solid,
    /// Dashed line
    Dashed,
    /// Dotted line
    Dotted,
    /// Dash-dot line
    DashDot,
}

/// Dimension style defines appearance and formatting for dimension annotations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionStyle {
    pub id: String,
    pub name: String,
    pub color: [f32; 4],
    pub line_width: f32,
    pub arrowhead: ArrowheadStyle,
    pub arrow_size: f64,
    pub text_style: TextStyle,
    pub text_size: f64,
    pub units: Option<String>,
    pub precision: u32,
    pub prefix: String,
    pub suffix: String,
    pub show_units: bool,
    pub show_units_flag: bool,
    pub scale_factor: f64,
    pub dim_scale: f64,
    pub override_dimscale: bool,
    pub leader_arrow: bool,
    pub leader_style: LeaderStyle,
    pub extension_line: bool,
    pub extension_length: f64,
}

impl DimensionStyle {
    pub fn new(name: String) -> Self {
        Self {
            id: format!("style-{}", name.to_lowercase().replace(" ", "-")),
            name,
            color: [0.62, 0.62, 0.65, 1.0], // GRAY
            line_width: 1.0,
            arrowhead: ArrowheadStyle::Closed,
            arrow_size: 0.05,
            text_style: TextStyle::Regular,
            text_size: 0.02,
            units: None,
            precision: 2,
            prefix: String::new(),
            suffix: String::new(),
            show_units: true,
            show_units_flag: true,
            scale_factor: 1.0,
            dim_scale: 1.0,
            override_dimscale: false,
            leader_arrow: false,
            leader_style: LeaderStyle::Solid,
            extension_line: true,
            extension_length: 0.02,
        }
    }
}

/// Dimension geometry with type-specific parameters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionGeometry {
    pub dimension_type: DimensionType,
    /// Start point of the dimension
    pub start: [f64; 3],
    /// End point of the dimension
    pub end: [f64; 3],
    /// Reference point for aligned/rotated dimensions
    pub ref_point: Option<[f64; 3]>,
    /// Reference line for angular dimensions (two points)
    pub angular_ref_points: Option<([f64; 3], [f64; 3])>,
    /// Circle/arc center for radial dimensions
    pub radial_center: Option<[f64; 3]>,
    /// Radius or diameter for radial dimensions
    pub radial_value: Option<f64>,
    /// Ordinate reference point and direction
    pub ordinate_ref: Option<([f64; 3], [f64; 3])>,
    /// Ordinate origin
    pub ordinate_origin: Option<[f64; 3]>,
    /// Dimension style reference
    pub style_id: Option<String>,
    /// Custom geometry data
    pub custom_data: Option<serde_json::Value>,
    /// Leader start point
    pub leader_start: Option<[f64; 3]>,
    /// Leader end point
    pub leader_end: Option<[f64; 3]>,
}

/// Extension line for dimensions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExtensionLine {
    pub start: [f64; 3],
    pub end: [f64; 3],
    pub color: [f32; 4],
    pub line_width: f32,
}

/// Arrow for dimensions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Arrow {
    pub tip: [f64; 3],
    pub wing1: [f64; 3],
    pub wing2: [f64; 3],
    pub color: [f32; 4],
    pub line_width: f32,
}

/// Annotation layer for organizing annotation entities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnotationLayer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: [f32; 4],
    pub line_type: LineType,
    pub line_weight: f32,
    /// Auto-number dimensions
    pub auto_number: bool,
    /// Dimension prefix
    pub dimension_prefix: String,
    /// Dimension suffix
    pub dimension_suffix: String,
}

impl AnnotationLayer {
    pub fn new(name: String) -> Self {
        Self {
            id: format!("layer-{}", name.to_lowercase().replace(" ", "-")),
            name,
            visible: true,
            locked: false,
            color: [0.36, 0.55, 0.98, 1.0], // BLUE
            line_type: LineType::Solid,
            line_weight: 1.0,
            auto_number: false,
            dimension_prefix: String::new(),
            dimension_suffix: String::new(),
        }
    }
}

/// Annotation group for organizing related annotations.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AnnotationGroup {
    pub id: String,
    pub name: String,
    pub layer: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<[f32; 4]>,
    /// Type of group
    pub group_type: GroupType,
    /// Entities in this group
    pub entities: Vec<String>,
}

/// Types of annotation groups.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupType {
    /// Reference geometry group
    Reference,
    /// Dimension group
    Dimension,
    /// All geometry group
    All,
    /// Selection set
    Selection,
    /// Custom group
    Custom,
}

/// Complete dimension annotation with all properties.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DimensionAnnotation {
    pub id: String,
    pub name: String,
    pub layer: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<[f32; 4]>,
    pub geometry: DimensionGeometry,
    pub extension_line: Option<ExtensionLine>,
    pub arrow: Option<Arrow>,
    pub text: Option<String>,
    pub units: Option<String>,
    pub precision: u32,
    pub style_id: Option<String>,
    /// Group this annotation belongs to
    pub group_id: Option<String>,
    /// Associated dimension entity (if any)
    pub dimension_entity_id: Option<String>,
    /// Associated entity for ordinate dimensions
    pub ordinate_entity_id: Option<String>,
}
