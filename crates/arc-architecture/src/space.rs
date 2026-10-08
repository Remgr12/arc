use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::room::{Room, RoomRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpaceType {
    ThermalZone,
    LightingZone,
    HVACZone,
    FireCompartment,
    SecurityZone,
    AcousticZone,
    OccupancyZone,
    Custom,
}

#[derive(Debug, Clone)]
pub struct Space {
    pub id: EntityId,
    pub name: String,
    pub number: String,
    pub space_type: SpaceType,
    pub boundary: Polyline,
    pub height: f64,
    pub base_height: f64,
    pub rooms: Vec<RoomRef>,
    pub thermal_zone: Option<String>,
    pub lighting_zone: Option<String>,
    pub hvac_zone: Option<String>,
    pub area: f64,
    pub volume: f64,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

impl Space {
    pub fn new(name: String, boundary: Polyline, height: f64) -> Self {
        let area = Room::calculate_area(&boundary);
        
        let mut space = Self {
            id: EntityId::new(),
            name,
            number: String::new(),
            space_type: SpaceType::ThermalZone,
            boundary,
            height,
            base_height: 0.0,
            rooms: Vec::new(),
            thermal_zone: None,
            lighting_zone: None,
            hvac_zone: None,
            area,
            volume: area * height,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-SPCE".to_string(),
            properties: std::collections::HashMap::new(),
        };
        space.update_geometry();
        space
    }

    pub fn add_room(&mut self, room: RoomRef) {
        self.rooms.push(room);
    }

    pub fn set_zones(&mut self, thermal: Option<String>, lighting: Option<String>, hvac: Option<String>) {
        self.thermal_zone = thermal;
        self.lighting_zone = lighting;
        self.hvac_zone = hvac;
    }

    pub fn to_solid(&self) -> SolidEntity {
        ArchitecturePrimitives::slab(&self.boundary.vertices, self.height, self.base_height)
    }

    pub fn update_geometry(&mut self) {
        self.area = Room::calculate_area(&self.boundary);
        self.volume = self.area * self.height;
        
        let solid = self.to_solid();
        self.bounding_box = solid.bounding_box();
    }

    pub fn contains_point(&self, point: Point3) -> bool {
        let local = self.transform.inverse().transform_point(point);
        if local.z < self.base_height || local.z > self.base_height + self.height {
            return false;
        }
        
        Room::point_in_polygon(&local, &self.boundary.vertices, 0.0)
    }
}

pub type SpaceRef = Arc<RwLock<Space>>;

pub struct SpaceBuilder {
    space: Space,
}

impl SpaceBuilder {
    pub fn new(name: String, boundary: Polyline, height: f64) -> Self {
        Self {
            space: Space::new(name, boundary, height),
        }
    }

    pub fn number(mut self, number: String) -> Self {
        self.space.number = number;
        self
    }

    pub fn space_type(mut self, space_type: SpaceType) -> Self {
        self.space.space_type = space_type;
        self
    }

    pub fn base_height(mut self, base_height: f64) -> Self {
        self.space.base_height = base_height;
        self
    }

    pub fn zones(mut self, thermal: Option<String>, lighting: Option<String>, hvac: Option<String>) -> Self {
        self.space.set_zones(thermal, lighting, hvac);
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.space.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Space {
        self.space.update_geometry();
        self.space
    }
}

pub fn space_builder(name: String, boundary: Polyline, height: f64) -> SpaceBuilder {
    SpaceBuilder::new(name, boundary, height)
}