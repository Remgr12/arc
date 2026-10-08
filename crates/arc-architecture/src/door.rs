use arc_core::*;
use arc_geometry::*;
use crate::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;
use crate::wall::WallRef;
use crate::level::LevelRef;
use crate::grid::GridRef;
use crate::stair::StairRef;
use crate::roof::RoofRef;
use crate::slab::SlabRef as DoorSlabRef;
use crate::column::ColumnRef;
use crate::beam::BeamRef;
use crate::room::RoomRef;
use crate::space::SpaceRef;
use crate::annotation::AnnotationRef;
use crate::window::WindowRef;
use crate::wall::OpeningRef;

#[derive(Debug, Clone)]
pub struct Door {
    pub id: EntityId,
    pub name: String,
    pub door_type: DoorType,
    pub style: DoorStyle,
    pub width: f64,
    pub height: f64,
    pub thickness: f64,
    pub frame_width: f64,
    pub frame_depth: f64,
    pub swing_angle: f64,
    pub swing_direction: SwingDirection,
    pub hinge_side: HingeSide,
    pub position: Point3,
    pub orientation: Vector3,
    pub wall: Option<WallRef>,
    pub level: Option<LevelRef>,
    pub material: String,
    pub frame_material: String,
    pub hardware: HardwareSet,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DoorType {
    Single,
    Double,
    Sliding,
    Pocket,
    Bifold,
    Revolving,
    Overhead,
    Fire,
    Security,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DoorStyle {
    Panel,
    Flush,
    Glass,
    Louvered,
    French,
    Dutch,
    Barn,
    Pivot,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SwingDirection {
    In,
    Out,
    Left,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HingeSide {
    Left,
    Right,
}

#[derive(Debug, Clone, Default)]
pub struct HardwareSet {
    pub handle: Option<String>,
    pub lock: Option<String>,
    pub hinge: Option<String>,
    pub closer: Option<String>,
    pub stop: Option<String>,
    pub threshold: Option<String>,
}

impl Door {
    pub fn new(name: String, width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut door = Self {
            id: EntityId::new(),
            name,
            door_type: DoorType::Single,
            style: DoorStyle::Panel,
            width,
            height,
            thickness: 45.0,
            frame_width: 100.0,
            frame_depth: 50.0,
            swing_angle: 90.0_f64.to_radians(),
            swing_direction: SwingDirection::In,
            hinge_side: HingeSide::Left,
            position,
            orientation: orientation.normalize(),
            wall: None,
            level: None,
            material: "Wood".to_string(),
            frame_material: "Wood".to_string(),
            hardware: HardwareSet::default(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-DOOR".to_string(),
            properties: std::collections::HashMap::new(),
        };
        door.update_geometry();
        door
    }

    pub fn single(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        Self::new("Single Door".to_string(), width, height, position, orientation)
    }

    pub fn double(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut door = Self::new("Double Door".to_string(), width, height, position, orientation);
        door.door_type = DoorType::Double;
        door.update_geometry();
        door
    }

    pub fn sliding(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut door = Self::new("Sliding Door".to_string(), width, height, position, orientation);
        door.door_type = DoorType::Sliding;
        door.style = DoorStyle::Panel;
        door.update_geometry();
        door
    }

    pub fn set_swing(&mut self, angle: f64, direction: SwingDirection, hinge: HingeSide) {
        self.swing_angle = angle;
        self.swing_direction = direction;
        self.hinge_side = hinge;
        self.update_geometry();
    }

    pub fn set_in_wall(&mut self, wall: WallRef, position_along: f64) {
        self.wall = Some(wall.clone());
        let wall_guard = wall.read();
        let segments = wall_guard.baseline_segments();
        let segment = segments.get(position_along as usize % segments.len().max(1)).cloned();
        let thickness = wall_guard.thickness;
        drop(wall_guard);
        
        if let Some((start, end)) = segment {
            let dir = (end - start).normalize();
            let pos = start + dir * position_along + Vector3::new(-dir.y, dir.x, 0.0) * (thickness * 0.5);
            self.position = pos;
            self.orientation = dir;
        }
        self.update_geometry();
    }

    pub fn to_solid(&self) -> SolidEntity {
        let half_width = self.width * 0.5;
        let half_thick = self.thickness * 0.5;
        
        let leaf = SolidEntity::box_centered(
            Point3::new(0.0, 0.0, self.height * 0.5),
            Vector3::new(self.width, self.thickness, self.height),
        );
        
        let frame = SolidEntity::box_centered(
            Point3::new(0.0, 0.0, (self.height + self.frame_depth) * 0.5),
            Vector3::new(self.width + self.frame_width * 2.0, self.thickness + self.frame_width * 2.0, self.frame_depth),
        );
        
        let mut result = BooleanOps::union(&leaf, &frame).unwrap_or(leaf);
        
        let matrix = self.transform.to_matrix();
        result.apply_transform(crate::Transform::from_matrix(matrix));
        
        result
    }

    pub fn update_geometry(&mut self) {
        let solid = self.to_solid();
        self.bounding_box = solid.bounding_box();
    }

    pub fn contains_point(&self, point: Point3, tolerance: f64) -> bool {
        let local = self.transform.inverse().transform_point(point);
        let half_w = self.width * 0.5 + tolerance;
        let half_t = self.thickness * 0.5 + tolerance;
        let half_h = self.height * 0.5 + tolerance;
        
        local.x.abs() <= half_w && local.y.abs() <= half_t && local.z.abs() <= half_h
    }
}

pub type DoorRef = Arc<RwLock<Door>>;

pub struct DoorBuilder {
    door: Door,
}

impl DoorBuilder {
    pub fn new(name: String, width: f64, height: f64) -> Self {
        Self {
            door: Door::new(name, width, height, Point3::origin(), Vector3::new(1.0, 0.0, 0.0)),
        }
    }

    pub fn position(mut self, position: Point3) -> Self {
        self.door.position = position;
        self
    }

    pub fn orientation(mut self, orientation: Vector3) -> Self {
        self.door.orientation = orientation.normalize();
        self
    }

    pub fn door_type(mut self, door_type: DoorType) -> Self {
        self.door.door_type = door_type;
        self
    }

    pub fn style(mut self, style: DoorStyle) -> Self {
        self.door.style = style;
        self
    }

    pub fn thickness(mut self, thickness: f64) -> Self {
        self.door.thickness = thickness;
        self
    }

    pub fn frame(mut self, width: f64, depth: f64) -> Self {
        self.door.frame_width = width;
        self.door.frame_depth = depth;
        self
    }

    pub fn swing(mut self, angle: f64, direction: SwingDirection, hinge: HingeSide) -> Self {
        self.door.swing_angle = angle;
        self.door.swing_direction = direction;
        self.door.hinge_side = hinge;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.door.material = material;
        self
    }

    pub fn frame_material(mut self, material: String) -> Self {
        self.door.frame_material = material;
        self
    }

    pub fn hardware(mut self, hardware: HardwareSet) -> Self {
        self.door.hardware = hardware;
        self
    }

    pub fn in_wall(mut self, wall: WallRef, position: f64) -> Self {
        self.door.set_in_wall(wall, position);
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.door.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Door {
        self.door.update_geometry();
        self.door
    }
}

pub fn door_builder(name: String, width: f64, height: f64) -> DoorBuilder {
    DoorBuilder::new(name, width, height)
}