use arc_core::*;
use arc_geometry::*;
use crate::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;
use crate::wall::WallRef;
use crate::door::DoorRef;
use crate::window::WindowRef;
use crate::space::{Space, SpaceType, SpaceRef, SpaceBuilder};

#[derive(Debug, Clone)]
pub struct Room {
    pub id: EntityId,
    pub name: String,
    pub number: String,
    pub room_type: RoomType,
    pub outline: Polyline,
    pub height: f64,
    pub base_height: f64,
    pub walls: Vec<WallRef>,
    pub doors: Vec<DoorRef>,
    pub windows: Vec<WindowRef>,
    pub floor_finish: String,
    pub wall_finish: String,
    pub ceiling_finish: String,
    pub base_finish: String,
    pub area: f64,
    pub perimeter: f64,
    pub volume: f64,
    pub occupancy: Occupancy,
    pub tags: Vec<String>,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoomType {
    Office,
    Conference,
    Lobby,
    Corridor,
    Restroom,
    Kitchen,
    Storage,
    Mechanical,
    Electrical,
    Server,
    Laboratory,
    Classroom,
    Residential,
    Retail,
    Warehouse,
    Custom,
}

#[derive(Debug, Clone, Default)]
pub struct Occupancy {
    pub classification: String,
    pub occupant_load: usize,
    pub area_per_person: f64,
    pub fire_rating: String,
}

impl Room {
    pub fn new(name: String, outline: Polyline, height: f64) -> Self {
        let area = Self::calculate_area(&outline);
        let perimeter = outline.length();
        
        let mut room = Self {
            id: EntityId::new(),
            name,
            number: String::new(),
            room_type: RoomType::Office,
            outline,
            height,
            base_height: 0.0,
            walls: Vec::new(),
            doors: Vec::new(),
            windows: Vec::new(),
            floor_finish: "Carpet".to_string(),
            wall_finish: "Paint".to_string(),
            ceiling_finish: "Acoustic Tile".to_string(),
            base_finish: "Vinyl Base".to_string(),
            area,
            perimeter,
            volume: area * height,
            occupancy: Occupancy::default(),
            tags: Vec::new(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ROOM".to_string(),
            properties: std::collections::HashMap::new(),
        };
        room.update_geometry();
        room
    }

    pub fn calculate_area(outline: &Polyline) -> f64 {
        let points = &outline.vertices;
        if points.len() < 3 {
            return 0.0;
        }
        
        let mut area = 0.0;
        for i in 0..points.len() {
            let j = (i + 1) % points.len();
            area += points[i].x * points[j].y;
            area -= points[j].x * points[i].y;
        }
        area.abs() * 0.5
    }

    pub fn add_wall(&mut self, wall: WallRef) {
        self.walls.push(wall);
    }

    pub fn add_door(&mut self, door: DoorRef) {
        self.doors.push(door);
    }

    pub fn add_window(&mut self, window: WindowRef) {
        self.windows.push(window);
    }

    pub fn set_finishes(&mut self, floor: String, wall: String, ceiling: String, base: String) {
        self.floor_finish = floor;
        self.wall_finish = wall;
        self.ceiling_finish = ceiling;
        self.base_finish = base;
    }

    pub fn set_occupancy(&mut self, occupancy: Occupancy) {
        self.occupancy = occupancy;
    }

    pub fn add_tag(&mut self, tag: String) {
        if !self.tags.contains(&tag) {
            self.tags.push(tag);
        }
    }

    pub fn to_solid(&self) -> SolidEntity {
        ArchitecturePrimitives::slab(&self.outline.vertices, self.height, self.base_height)
    }

    pub fn update_geometry(&mut self) {
        self.area = Self::calculate_area(&self.outline);
        self.perimeter = self.outline.length();
        self.volume = self.area * self.height;
        
        let solid = self.to_solid();
        self.bounding_box = solid.bounding_box();
    }

    pub fn contains_point(&self, point: Point3, tolerance: f64) -> bool {
        let local = self.transform.inverse().transform_point(point);
        if local.z < self.base_height - tolerance || local.z > self.base_height + self.height + tolerance {
            return false;
        }
        
        Self::point_in_polygon(&local, &self.outline.vertices, tolerance)
    }

    pub fn point_in_polygon(point: &Point3, polygon: &[Point3], tolerance: f64) -> bool {
        let mut inside = false;
        let mut j = polygon.len() - 1;
        
        for i in 0..polygon.len() {
            let pi = &polygon[i];
            let pj = &polygon[j];
            
            if ((pi.y > point.y) != (pj.y > point.y)) &&
                (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x + tolerance) {
                inside = !inside;
            }
            j = i;
        }
        
        inside
    }
}

pub type RoomRef = Arc<RwLock<Room>>;

pub struct RoomBuilder {
    room: Room,
}

impl RoomBuilder {
    pub fn new(name: String, outline: Polyline, height: f64) -> Self {
        Self {
            room: Room::new(name, outline, height),
        }
    }

    pub fn number(mut self, number: String) -> Self {
        self.room.number = number;
        self
    }

    pub fn room_type(mut self, room_type: RoomType) -> Self {
        self.room.room_type = room_type;
        self
    }

    pub fn base_height(mut self, height: f64) -> Self {
        self.room.base_height = height;
        self
    }

    pub fn finishes(mut self, floor: String, wall: String, ceiling: String, base: String) -> Self {
        self.room.set_finishes(floor, wall, ceiling, base);
        self
    }

    pub fn occupancy(mut self, occupancy: Occupancy) -> Self {
        self.room.set_occupancy(occupancy);
        self
    }

    pub fn add_tag(mut self, tag: String) -> Self {
        self.room.add_tag(tag);
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.room.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Room {
        self.room.update_geometry();
        self.room
    }
}

pub fn room_builder(name: String, outline: Polyline, height: f64) -> RoomBuilder {
    RoomBuilder::new(name, outline, height)
}
