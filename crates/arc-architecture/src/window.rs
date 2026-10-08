use arc_core::*;
use arc_geometry::*;
use nalgebra::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Window {
    pub id: EntityId,
    pub name: String,
    pub window_type: WindowType,
    pub style: WindowStyle,
    pub width: f64,
    pub height: f64,
    pub depth: f64,
    pub frame_width: f64,
    pub frame_depth: f64,
    pub sill_height: f64,
    pub head_height: f64,
    pub sash_thickness: f64,
    pub glazing_thickness: f64,
    pub mullions: Vec<Mullion>,
    pub position: Point3,
    pub orientation: Vector3,
    pub wall: Option<WallRef>,
    pub level: Option<LevelRef>,
    pub frame_material: String,
    pub glazing_material: String,
    pub hardware: WindowHardware,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WindowType {
    Fixed,
    Casement,
    Awning,
    Hopper,
    Sliding,
    DoubleHung,
    SingleHung,
    TiltTurn,
    Pivot,
    Skylight,
    CurtainWall,
    Storefront,
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WindowStyle {
    Rectangular,
    Arched,
    Circular,
    Triangular,
    Trapezoidal,
    Custom,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Mullion {
    pub id: EntityId,
    pub orientation: MullionOrientation,
    pub position: f64,
    pub width: f64,
    pub depth: f64,
    pub material: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum MullionOrientation {
    Vertical,
    Horizontal,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct WindowHardware {
    pub handle: Option<String>,
    pub lock: Option<String>,
    pub hinge: Option<String>,
    pub operator: Option<String>,
    pub stay: Option<String>,
}

impl Window {
    pub fn new(name: String, width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut window = Self {
            id: EntityId::new(),
            name,
            window_type: WindowType::Fixed,
            style: WindowStyle::Rectangular,
            width,
            height,
            depth: 100.0,
            frame_width: 50.0,
            frame_depth: 50.0,
            sill_height: 900.0,
            head_height: 2100.0,
            sash_thickness: 40.0,
            glazing_thickness: 24.0,
            mullions: Vec::new(),
            position,
            orientation: orientation.normalize(),
            wall: None,
            level: None,
            frame_material: "Aluminum".to_string(),
            glazing_material: "Glass".to_string(),
            hardware: WindowHardware::default(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-WIND".to_string(),
            properties: std::collections::HashMap::new(),
        };
        window.update_geometry();
        window
    }

    pub fn fixed(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        Self::new("Fixed Window".to_string(), width, height, position, orientation)
    }

    pub fn casement(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut window = Self::new("Casement Window".to_string(), width, height, position, orientation);
        window.window_type = WindowType::Casement;
        window.update_geometry();
        window
    }

    pub fn sliding(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut window = Self::new("Sliding Window".to_string(), width, height, position, orientation);
        window.window_type = WindowType::Sliding;
        window.update_geometry();
        window
    }

    pub fn double_hung(width: f64, height: f64, position: Point3, orientation: Vector3) -> Self {
        let mut window = Self::new("Double Hung Window".to_string(), width, height, position, orientation);
        window.window_type = WindowType::DoubleHung;
        window.update_geometry();
        window
    }

    pub fn curtain_wall(width: f64, height: f64, position: Point3, orientation: Vector3, mullion_spacing: f64) -> Self {
        let mut window = Self::new("Curtain Wall".to_string(), width, height, position, orientation);
        window.window_type = WindowType::CurtainWall;
        
        let count = (width / mullion_spacing) as usize;
        for i in 1..count {
            window.add_mullion(Mullion {
                id: EntityId::new(),
                orientation: MullionOrientation::Vertical,
                position: i as f64 * mullion_spacing,
                width: 50.0,
                depth: 100.0,
                material: "Aluminum".to_string(),
            });
        }
        window.update_geometry();
        window
    }

    pub fn add_mullion(&mut self, mullion: Mullion) {
        self.mullions.push(mullion);
        self.update_geometry();
    }

    pub fn set_in_wall(&mut self, wall: WallRef, position_along: f64) {
        self.wall = Some(wall.clone());
        let wall_guard = wall.read();
        let segment = wall_guard.baseline_segments().get(position_along as usize % wall_guard.baseline_segments().len().max(1)).cloned();
        drop(wall_guard);
        
        if let Some((start, end)) = segment {
            let dir = (end - start).normalize();
            let pos = start + dir * position_along + Vector3::new(-dir.y, dir.x, 0.0) * (wall_guard.thickness * 0.5);
            self.position = Point3::new(pos.x, pos.y, self.sill_height);
            self.orientation = dir;
        }
        self.update_geometry();
    }

    pub fn to_solid(&self) -> SolidEntity {
        let frame = SolidEntity::box_centered(
            Point3::new(0.0, 0.0, (self.sill_height + self.height) * 0.5),
            Vector3::new(self.width + self.frame_width * 2.0, self.depth + self.frame_width * 2.0, self.height),
        );
        
        let glazing = SolidEntity::box_centered(
            Point3::new(0.0, 0.0, (self.sill_height + self.height) * 0.5),
            Vector3::new(self.width, self.glazing_thickness, self.height),
        );
        
        let mut result = BooleanOps::union(&frame, &glazing).unwrap_or(frame);
        
        for mullion in &self.mullions {
            let mullion_solid = SolidEntity::box_centered(
                Point3::new(mullion.position - self.width * 0.5, 0.0, (self.sill_height + self.height) * 0.5),
                Vector3::new(mullion.width, mullion.depth, self.height),
            );
            result = BooleanOps::union(&result, &mullion_solid).unwrap_or(result);
        }
        
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
        let half_w = (self.width + self.frame_width * 2.0) * 0.5 + tolerance;
        let half_d = (self.depth + self.frame_width * 2.0) * 0.5 + tolerance;
        let half_h = self.height * 0.5 + tolerance;
        
        local.x.abs() <= half_w && local.y.abs() <= half_d && local.z.abs() <= half_h
    }
}

pub type WindowRef = Arc<RwLock<Window>>;

pub struct WindowBuilder {
    window: Window,
}

impl WindowBuilder {
    pub fn new(name: String, width: f64, height: f64) -> Self {
        Self {
            window: Window::new(name, width, height, Point3::origin(), Vector3::new(1.0, 0.0, 0.0)),
        }
    }

    pub fn position(mut self, position: Point3) -> Self {
        self.window.position = position;
        self
    }

    pub fn orientation(mut self, orientation: Vector3) -> Self {
        self.window.orientation = orientation.normalize();
        self
    }

    pub fn window_type(mut self, window_type: WindowType) -> Self {
        self.window.window_type = window_type;
        self
    }

    pub fn style(mut self, style: WindowStyle) -> Self {
        self.window.style = style;
        self
    }

    pub fn dimensions(mut self, width: f64, height: f64, depth: f64) -> Self {
        self.window.width = width;
        self.window.height = height;
        self.window.depth = depth;
        self
    }

    pub fn frame(mut self, width: f64, depth: f64) -> Self {
        self.window.frame_width = width;
        self.window.frame_depth = depth;
        self
    }

    pub fn sill_height(mut self, height: f64) -> Self {
        self.window.sill_height = height;
        self
    }

    pub fn add_mullion(mut self, mullion: Mullion) -> Self {
        self.window.add_mullion(mullion);
        self
    }

    pub fn materials(mut self, frame: String, glazing: String) -> Self {
        self.window.frame_material = frame;
        self.window.glazing_material = glazing;
        self
    }

    pub fn in_wall(mut self, wall: WallRef, position: f64) -> Self {
        self.window.set_in_wall(wall, position);
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.window.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Window {
        self.window.update_geometry();
        self.window
    }
}

pub fn window_builder(name: String, width: f64, height: f64) -> WindowBuilder {
    WindowBuilder::new(name, width, height)
}