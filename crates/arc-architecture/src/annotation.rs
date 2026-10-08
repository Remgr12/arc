use arc_core::*;
use arc_geometry::*;
use nalgebra::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Annotation {
    pub id: EntityId,
    pub name: String,
    pub annotation_type: AnnotationType,
    pub position: Point3,
    pub rotation: f64,
    pub text: String,
    pub text_style: TextStyle,
    pub leader: Option<Leader>,
    pub dimension: Option<Dimension>,
    pub tag: Option<Tag>,
    pub symbol: Option<Symbol>,
    pub cloud: Option<RevisionCloud>,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum AnnotationType {
    Text,
    Dimension,
    Leader,
    Tag,
    Symbol,
    RevisionCloud,
    Keynote,
    SpotElevation,
    SpotCoordinate,
    NorthArrow,
    ScaleBar,
    TitleBlock,
    DetailCallout,
    SectionMark,
    ElevationMark,
    GridLine,
    LevelMark,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TextStyle {
    pub font_family: String,
    pub font_size: f64,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub color: crate::Color,
    pub alignment: TextAlignment,
    pub line_spacing: f64,
    pub width_factor: f64,
    pub oblique_angle: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TextAlignment {
    Left,
    Center,
    Right,
    Justified,
}

impl Default for TextStyle {
    fn default() -> Self {
        Self {
            font_family: "Arial".to_string(),
            font_size: 200.0,
            bold: false,
            italic: false,
            underline: false,
            color: crate::Color::BLACK,
            alignment: TextAlignment::Left,
            line_spacing: 1.0,
            width_factor: 1.0,
            oblique_angle: 0.0,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Leader {
    pub points: Vec<Point3>,
    pub arrowhead: ArrowheadType,
    pub arrow_size: f64,
    pub landing_length: f64,
    pub content: LeaderContent,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ArrowheadType {
    Closed,
    Open,
    Dot,
    Tick,
    ArchitecturalTick,
    None,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum LeaderContent {
    Text(String),
    Block(String),
    None,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Dimension {
    pub dimension_type: DimensionType,
    pub points: Vec<Point3>,
    pub dimension_line_offset: f64,
    pub extension_line_offset: f64,
    pub extension_line_extension: f64,
    pub arrowhead: ArrowheadType,
    pub arrow_size: f64,
    pub text_style: TextStyle,
    pub text_position: DimensionTextPosition,
    pub text_rotation: f64,
    pub precision: u8,
    pub units: DimensionUnits,
    pub suppress_leading_zeros: bool,
    pub suppress_trailing_zeros: bool,
    pub zero_suppression: ZeroSuppression,
    pub alternate_units: bool,
    pub alternate_units_scale: f64,
    pub alternate_units_precision: u8,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DimensionType {
    Linear,
    Aligned,
    Angular,
    ArcLength,
    Radius,
    Diameter,
    Ordinate,
    Baseline,
    Continue,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DimensionTextPosition {
    Above,
    Below,
    Inside,
    Outside,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum DimensionUnits {
    Architectural,
    Decimal,
    Engineering,
    Fractional,
    Scientific,
    Metric,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ZeroSuppression {
    None,
    Leading,
    Trailing,
    Both,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Tag {
    pub tag_type: TagType,
    pub family: String,
    pub parameters: std::collections::HashMap<String, serde_json::Value>,
    pub orientation: f64,
    pub leader: Option<Leader>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum TagType {
    Door,
    Window,
    Room,
    Wall,
    Column,
    Beam,
    Equipment,
    Furniture,
    Custom,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Symbol {
    pub symbol_type: SymbolType,
    pub name: String,
    pub scale: f64,
    pub rotation: f64,
    pub definition: SymbolDefinition,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SymbolType {
    NorthArrow,
    SectionMark,
    ElevationMark,
    DetailCallout,
    GridHead,
    LevelMark,
    DoorSwing,
    WindowTag,
    RoomTag,
    Custom,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SymbolDefinition {
    pub geometry: Vec<SymbolGeometry>,
    pub attributes: Vec<SymbolAttribute>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SymbolGeometry {
    Line(Point3, Point3),
    Arc(Point3, f64, f64, f64),
    Circle(Point3, f64),
    Text(Point3, String, TextStyle),
    Polygon(Vec<Point3>),
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SymbolAttribute {
    pub name: String,
    pub value: String,
    pub position: Point3,
    pub text_style: TextStyle,
    pub visible: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RevisionCloud {
    pub points: Vec<Point3>,
    pub arc_length: f64,
    pub arc_chord_height: f64,
    pub style: CloudStyle,
    pub revision_number: String,
    pub revision_date: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum CloudStyle {
    Rectangular,
    Polygonal,
    Freehand,
}

impl Annotation {
    pub fn new_text(name: String, position: Point3, text: String, style: TextStyle) -> Self {
        let mut ann = Self {
            id: EntityId::new(),
            name,
            annotation_type: AnnotationType::Text,
            position,
            rotation: 0.0,
            text,
            text_style: style,
            leader: None,
            dimension: None,
            tag: None,
            symbol: None,
            cloud: None,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ANNO".to_string(),
            properties: std::collections::HashMap::new(),
        };
        ann.update_bounds();
        ann
    }

    pub fn new_dimension(name: String, dim_type: DimensionType, points: Vec<Point3>, offset: f64) -> Self {
        let mut ann = Self {
            id: EntityId::new(),
            name,
            annotation_type: AnnotationType::Dimension,
            position: points.first().copied().unwrap_or(Point3::origin()),
            rotation: 0.0,
            text: String::new(),
            text_style: TextStyle::default(),
            leader: None,
            dimension: Some(Dimension {
                dimension_type: dim_type,
                points,
                dimension_line_offset: offset,
                extension_line_offset: 10.0,
                extension_line_extension: 20.0,
                arrowhead: ArrowheadType::ArchitecturalTick,
                arrow_size: 50.0,
                text_style: TextStyle::default(),
                text_position: DimensionTextPosition::Above,
                text_rotation: 0.0,
                precision: 2,
                units: DimensionUnits::Metric,
                suppress_leading_zeros: false,
                suppress_trailing_zeros: false,
                zero_suppression: ZeroSuppression::None,
                alternate_units: false,
                alternate_units_scale: 1.0,
                alternate_units_precision: 2,
            }),
            tag: None,
            symbol: None,
            cloud: None,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-DIMS".to_string(),
            properties: std::collections::HashMap::new(),
        };
        ann.update_bounds();
        ann
    }

    pub fn new_leader(name: String, points: Vec<Point3>, content: LeaderContent) -> Self {
        let mut ann = Self {
            id: EntityId::new(),
            name,
            annotation_type: AnnotationType::Leader,
            position: points.first().copied().unwrap_or(Point3::origin()),
            rotation: 0.0,
            text: String::new(),
            text_style: TextStyle::default(),
            leader: Some(Leader {
                points,
                arrowhead: ArrowheadType::ArchitecturalTick,
                arrow_size: 50.0,
                landing_length: 100.0,
                content,
            }),
            dimension: None,
            tag: None,
            symbol: None,
            cloud: None,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ANNO".to_string(),
            properties: std::collections::HashMap::new(),
        };
        ann.update_bounds();
        ann
    }

    pub fn new_tag(name: String, tag_type: TagType, position: Point3, family: String, params: std::collections::HashMap<String, serde_json::Value>) -> Self {
        let mut ann = Self {
            id: EntityId::new(),
            name,
            annotation_type: AnnotationType::Tag,
            position,
            rotation: 0.0,
            text: String::new(),
            text_style: TextStyle::default(),
            leader: None,
            dimension: None,
            tag: Some(Tag {
                tag_type,
                family,
                parameters: params,
                orientation: 0.0,
                leader: None,
            }),
            symbol: None,
            cloud: None,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ANNO".to_string(),
            properties: std::collections::HashMap::new(),
        };
        ann.update_bounds();
        ann
    }

    pub fn new_symbol(name: String, symbol_type: SymbolType, position: Point3, symbol_name: String) -> Self {
        let mut ann = Self {
            id: EntityId::new(),
            name,
            annotation_type: AnnotationType::Symbol,
            position,
            rotation: 0.0,
            text: String::new(),
            text_style: TextStyle::default(),
            leader: None,
            dimension: None,
            tag: None,
            symbol: Some(Symbol {
                symbol_type,
                name: symbol_name,
                scale: 1.0,
                rotation: 0.0,
                definition: SymbolDefinition {
                    geometry: Vec::new(),
                    attributes: Vec::new(),
                },
            }),
            cloud: None,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ANNO".to_string(),
            properties: std::collections::HashMap::new(),
        };
        ann.update_bounds();
        ann
    }

    pub fn new_revision_cloud(name: String, points: Vec<Point3>) -> Self {
        let mut ann = Self {
            id: EntityId::new(),
            name,
            annotation_type: AnnotationType::RevisionCloud,
            position: points.first().copied().unwrap_or(Point3::origin()),
            rotation: 0.0,
            text: String::new(),
            text_style: TextStyle::default(),
            leader: None,
            dimension: None,
            tag: None,
            symbol: None,
            cloud: Some(RevisionCloud {
                points,
                arc_length: 200.0,
                arc_chord_height: 50.0,
                style: CloudStyle::Polygonal,
                revision_number: String::new(),
                revision_date: String::new(),
            }),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ANNO".to_string(),
            properties: std::collections::HashMap::new(),
        };
        ann.update_bounds();
        ann
    }

    pub fn update_bounds(&mut self) {
        self.bounding_box = BoundingBox::empty();
        self.bounding_box.expand_point(self.position);
    }

    pub fn calculate_dimension_text(&self, units: &Units) -> String {
        if let Some(dim) = &self.dimension {
            if dim.points.len() >= 2 {
                let dist = (dim.points[0] - dim.points[1]).norm();
                units.format_length(dist)
            } else {
                String::new()
            }
        } else {
            String::new()
        }
    }
}

pub type AnnotationRef = Arc<RwLock<Annotation>>;

pub struct AnnotationBuilder {
    annotation: Annotation,
}

impl AnnotationBuilder {
    pub fn text(name: String, position: Point3, text: String) -> Self {
        Self {
            annotation: Annotation::new_text(name, position, text, TextStyle::default()),
        }
    }

    pub fn dimension(name: String, dim_type: DimensionType, points: Vec<Point3>, offset: f64) -> Self {
        Self {
            annotation: Annotation::new_dimension(name, dim_type, points, offset),
        }
    }

    pub fn leader(name: String, points: Vec<Point3>, content: LeaderContent) -> Self {
        Self {
            annotation: Annotation::new_leader(name, points, content),
        }
    }

    pub fn tag(name: String, tag_type: TagType, position: Point3, family: String, params: std::collections::HashMap<String, serde_json::Value>) -> Self {
        Self {
            annotation: Annotation::new_tag(name, tag_type, position, family, params),
        }
    }

    pub fn symbol(name: String, symbol_type: SymbolType, position: Point3, symbol_name: String) -> Self {
        Self {
            annotation: Annotation::new_symbol(name, symbol_type, position, symbol_name),
        }
    }

    pub fn revision_cloud(name: String, points: Vec<Point3>) -> Self {
        Self {
            annotation: Annotation::new_revision_cloud(name, points),
        }
    }

    pub fn text_style(mut self, style: TextStyle) -> Self {
        self.annotation.text_style = style;
        self
    }

    pub fn rotation(mut self, angle: f64) -> Self {
        self.annotation.rotation = angle;
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.annotation.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Annotation {
        self.annotation.update_bounds();
        self.annotation
    }
}

pub fn text_annotation(name: String, position: Point3, text: String) -> AnnotationBuilder {
    AnnotationBuilder::text(name, position, text)
}

pub fn dimension_annotation(name: String, dim_type: DimensionType, points: Vec<Point3>, offset: f64) -> AnnotationBuilder {
    AnnotationBuilder::dimension(name, dim_type, points, offset)
}

pub fn leader_annotation(name: String, points: Vec<Point3>, content: LeaderContent) -> AnnotationBuilder {
    AnnotationBuilder::leader(name, points, content)
}

pub fn tag_annotation(name: String, tag_type: TagType, position: Point3, family: String, params: std::collections::HashMap<String, serde_json::Value>) -> AnnotationBuilder {
    AnnotationBuilder::tag(name, tag_type, position, family, params)
}

pub fn symbol_annotation(name: String, symbol_type: SymbolType, position: Point3, symbol_name: String) -> AnnotationBuilder {
    AnnotationBuilder::symbol(name, symbol_type, position, symbol_name)
}

pub fn revision_cloud_annotation(name: String, points: Vec<Point3>) -> AnnotationBuilder {
    AnnotationBuilder::revision_cloud(name, points)
}