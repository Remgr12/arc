use arc_core::*;
use arc_geometry::*;
use nalgebra::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Column {
    pub id: EntityId,
    pub name: String,
    pub column_type: ColumnType,
    pub shape: ColumnShape,
    pub width: f64,
    pub depth: f64,
    pub radius: f64,
    pub height: f64,
    pub base_height: f64,
    pub top_height: f64,
    pub position: Point3,
    pub rotation: f64,
    pub material: String,
    pub reinforcement: ColumnReinforcement,
    pub base_connection: Connection,
    pub top_connection: Connection,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ColumnType {
    Structural,
    Architectural,
    Pilotis,
    Engaged,
    FreeStanding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ColumnShape {
    Rectangular,
    Circular,
    Square,
    LShaped,
    TShaped,
    Cross,
    Polygon,
    Custom,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ColumnReinforcement {
    pub longitudinal: RebarSet,
    pub ties: TieSet,
    pub dowels: Vec<Dowel>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct RebarSet {
    pub bar_count: usize,
    pub bar_size: String,
    pub cover: f64,
    pub grade: String,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct TieSet {
    pub bar_size: String,
    pub spacing: f64,
    pub configuration: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Dowel {
    pub position: Point3,
    pub diameter: f64,
    pub length: f64,
    pub bar_size: String,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Connection {
    pub type_: String,
    pub plate_thickness: f64,
    pub bolt_size: String,
    pub bolt_count: usize,
    pub weld_size: f64,
}

impl Column {
    pub fn new(name: String, position: Point3, height: f64) -> Self {
        let mut column = Self {
            id: EntityId::new(),
            name,
            column_type: ColumnType::Structural,
            shape: ColumnShape::Rectangular,
            width: 400.0,
            depth: 400.0,
            radius: 200.0,
            height,
            base_height: 0.0,
            top_height: height,
            position,
            rotation: 0.0,
            material: "Concrete".to_string(),
            reinforcement: ColumnReinforcement::default(),
            base_connection: Connection::default(),
            top_connection: Connection::default(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-COLS".to_string(),
            properties: std::collections::HashMap::new(),
        };
        column.update_geometry();
        column
    }

    pub fn rectangular(name: String, position: Point3, width: f64, depth: f64, height: f64) -> Self {
        let mut column = Self::new(name, position, height);
        column.shape = ColumnShape::Rectangular;
        column.width = width;
        column.depth = depth;
        column.update_geometry();
        column
    }

    pub fn circular(name: String, position: Point3, radius: f64, height: f64) -> Self {
        let mut column = Self::new(name, position, height);
        column.shape = ColumnShape::Circular;
        column.radius = radius;
        column.update_geometry();
        column
    }

    pub fn square(name: String, position: Point3, size: f64, height: f64) -> Self {
        Self::rectangular(name, position, size, size, height)
    }

    pub fn set_base_top(&mut self, base: f64, top: f64) {
        self.base_height = base;
        self.top_height = top;
        self.height = top - base;
        self.update_geometry();
    }

    pub fn set_rotation(&mut self, angle: f64) {
        self.rotation = angle;
        self.update_geometry();
    }

    pub fn set_material(&mut self, material: String) {
        self.material = material;
    }

    pub fn set_reinforcement(&mut self, reinforcement: ColumnReinforcement) {
        self.reinforcement = reinforcement;
    }

    pub fn to_solid(&self) -> SolidEntity {
        let origin = Point3::new(
            self.position.x - self.width * 0.5,
            self.position.y - self.depth * 0.5,
            self.base_height,
        );
        
        match self.shape {
            ColumnShape::Rectangular | ColumnShape::Square => {
                ArchitecturePrimitives::column_rectangular(
                    self.position,
                    self.width,
                    self.depth,
                    self.height,
                    self.base_height,
                )
            }
            ColumnShape::Circular => {
                ArchitecturePrimitives::column(
                    self.position,
                    self.radius,
                    self.height,
                    self.base_height,
                )
            }
            _ => {
                ArchitecturePrimitives::column_rectangular(
                    self.position,
                    self.width,
                    self.depth,
                    self.height,
                    self.base_height,
                )
            }
        }
    }

    pub fn update_geometry(&mut self) {
        let solid = self.to_solid();
        self.bounding_box = solid.bounding_box();
    }

    pub fn contains_point(&self, point: Point3, tolerance: f64) -> bool {
        let local = self.transform.inverse().transform_point(point);
        self.bounding_box.contains(local)
    }
}

pub type ColumnRef = Arc<RwLock<Column>>;

pub struct ColumnBuilder {
    column: Column,
}

impl ColumnBuilder {
    pub fn new(name: String, position: Point3, height: f64) -> Self {
        Self {
            column: Column::new(name, position, height),
        }
    }

    pub fn shape(mut self, shape: ColumnShape) -> Self {
        self.column.shape = shape;
        self
    }

    pub fn rectangular(mut self, width: f64, depth: f64) -> Self {
        self.column.shape = ColumnShape::Rectangular;
        self.column.width = width;
        self.column.depth = depth;
        self
    }

    pub fn circular(mut self, radius: f64) -> Self {
        self.column.shape = ColumnShape::Circular;
        self.column.radius = radius;
        self
    }

    pub fn square(mut self, size: f64) -> Self {
        self.column.shape = ColumnShape::Square;
        self.column.width = size;
        self.column.depth = size;
        self
    }

    pub fn base_top(mut self, base: f64, top: f64) -> Self {
        self.column.base_height = base;
        self.column.top_height = top;
        self.column.height = top - base;
        self
    }

    pub fn rotation(mut self, angle: f64) -> Self {
        self.column.rotation = angle;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.column.material = material;
        self
    }

    pub fn reinforcement(mut self, reinforcement: ColumnReinforcement) -> Self {
        self.column.reinforcement = reinforcement;
        self
    }

    pub fn base_connection(mut self, connection: Connection) -> Self {
        self.column.base_connection = connection;
        self
    }

    pub fn top_connection(mut self, connection: Connection) -> Self {
        self.column.top_connection = connection;
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.column.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Column {
        self.column.update_geometry();
        self.column
    }
}

pub fn column_builder(name: String, position: Point3, height: f64) -> ColumnBuilder {
    ColumnBuilder::new(name, position, height)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Beam {
    pub id: EntityId,
    pub name: String,
    pub beam_type: BeamType,
    pub shape: BeamShape,
    pub width: f64,
    pub height: f64,
    pub flange_width: f64,
    pub flange_thickness: f64,
    pub web_thickness: f64,
    pub length: f64,
    pub start_point: Point3,
    pub end_point: Point3,
    pub material: String,
    pub reinforcement: BeamReinforcement,
    pub connections: Vec<BeamConnection>,
    pub openings: Vec<BeamOpening>,
    pub camber: f64,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BeamType {
    Primary,
    Secondary,
    Girder,
    Joist,
    Purlin,
    Lintel,
    Spandrel,
    Transfer,
    Cantilever,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum BeamShape {
    Rectangular,
    IBeam,
    TBeam,
    LBeam,
    Channel,
    Box,
    Circular,
    Custom,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct BeamReinforcement {
    pub top_bars: RebarSet,
    pub bottom_bars: RebarSet,
    pub stirrups: StirrupSet,
    pub shear_studs: Vec<ShearStud>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct StirrupSet {
    pub bar_size: String,
    pub spacing: f64,
    pub legs: usize,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ShearStud {
    pub position: f64,
    pub diameter: f64,
    pub height: f64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BeamConnection {
    pub id: EntityId,
    pub position: f64,
    pub type_: String,
    pub connected_element: EntityId,
    pub bolts: Vec<Bolt>,
    pub welds: Vec<Weld>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Bolt {
    pub size: String,
    pub grade: String,
    pub count: usize,
    pub pattern: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Weld {
    pub size: f64,
    pub length: f64,
    pub type_: String,
    pub position: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BeamOpening {
    pub id: EntityId,
    pub position: f64,
    pub width: f64,
    pub height: f64,
    pub shape: OpeningShape,
    pub reinforcement: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum OpeningShape {
    Circular,
    Rectangular,
    Oval,
    Custom,
}

impl Beam {
    pub fn new(name: String, start: Point3, end: Point3, width: f64, height: f64) -> Self {
        let length = (end - start).norm();
        let direction = (end - start).normalize();
        
        let mut beam = Self {
            id: EntityId::new(),
            name,
            beam_type: BeamType::Primary,
            shape: BeamShape::Rectangular,
            width,
            height,
            flange_width: width,
            flange_thickness: height * 0.15,
            web_thickness: width * 0.1,
            length,
            start_point: start,
            end_point: end,
            material: "Steel".to_string(),
            reinforcement: BeamReinforcement::default(),
            connections: Vec::new(),
            openings: Vec::new(),
            camber: 0.0,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-BEAM".to_string(),
            properties: std::collections::HashMap::new(),
        };
        beam.update_geometry();
        beam
    }

    pub fn rectangular(name: String, start: Point3, end: Point3, width: f64, height: f64) -> Self {
        Self::new(name, start, end, width, height)
    }

    pub fn i_beam(name: String, start: Point3, end: Point3, width: f64, height: f64, flange_w: f64, flange_t: f64, web_t: f64) -> Self {
        let mut beam = Self::new(name, start, end, width, height);
        beam.shape = BeamShape::IBeam;
        beam.flange_width = flange_w;
        beam.flange_thickness = flange_t;
        beam.web_thickness = web_t;
        beam.update_geometry();
        beam
    }

    pub fn set_material(&mut self, material: String) {
        self.material = material;
    }

    pub fn add_connection(&mut self, connection: BeamConnection) {
        self.connections.push(connection);
    }

    pub fn add_opening(&mut self, opening: BeamOpening) {
        self.openings.push(opening);
        self.update_geometry();
    }

    pub fn set_camber(&mut self, camber: f64) {
        self.camber = camber;
        self.update_geometry();
    }

    pub fn to_solid(&self) -> SolidEntity {
        ArchitecturePrimitives::beam(self.start_point, self.end_point, self.width, self.height)
    }

    pub fn update_geometry(&mut self) {
        let solid = self.to_solid();
        self.bounding_box = solid.bounding_box();
        self.length = (self.end_point - self.start_point).norm();
    }

    pub fn contains_point(&self, point: Point3, tolerance: f64) -> bool {
        let local = self.transform.inverse().transform_point(point);
        self.bounding_box.contains(local)
    }
}

pub type BeamRef = Arc<RwLock<Beam>>;

pub struct BeamBuilder {
    beam: Beam,
}

impl BeamBuilder {
    pub fn new(name: String, start: Point3, end: Point3) -> Self {
        Self {
            beam: Beam::new(name, start, end, 300.0, 500.0),
        }
    }

    pub fn beam_type(mut self, beam_type: BeamType) -> Self {
        self.beam.beam_type = beam_type;
        self
    }

    pub fn shape(mut self, shape: BeamShape) -> Self {
        self.beam.shape = shape;
        self
    }

    pub fn dimensions(mut self, width: f64, height: f64) -> Self {
        self.beam.width = width;
        self.beam.height = height;
        self
    }

    pub fn i_beam_dims(mut self, flange_w: f64, flange_t: f64, web_t: f64) -> Self {
        self.beam.flange_width = flange_w;
        self.beam.flange_thickness = flange_t;
        self.beam.web_thickness = web_t;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.beam.material = material;
        self
    }

    pub fn add_connection(mut self, connection: BeamConnection) -> Self {
        self.beam.add_connection(connection);
        self
    }

    pub fn add_opening(mut self, opening: BeamOpening) -> Self {
        self.beam.add_opening(opening);
        self
    }

    pub fn camber(mut self, camber: f64) -> Self {
        self.beam.camber = camber;
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.beam.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Beam {
        self.beam.update_geometry();
        self.beam
    }
}

pub fn beam_builder(name: String, start: Point3, end: Point3) -> BeamBuilder {
    BeamBuilder::new(name, start, end)
}