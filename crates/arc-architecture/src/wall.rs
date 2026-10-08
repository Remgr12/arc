use arc_core::*;
use arc_geometry::*;
use nalgebra::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Wall {
    pub id: EntityId,
    pub name: String,
    pub wall_type: WallType,
    pub baseline: Polyline,
    pub height: f64,
    pub thickness: f64,
    pub base_height: f64,
    pub justification: WallJustification,
    pub material: String,
    pub layers: Vec<WallLayer>,
    pub openings: Vec<OpeningRef>,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WallType {
    Generic,
    Basic,
    Curtain,
    Stacked,
    Composite,
    Retaining,
    Foundation,
    Parapet,
    Core,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum WallJustification {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct WallLayer {
    pub name: String,
    pub thickness: f64,
    pub material: String,
    pub function: LayerFunction,
    pub wraps: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum LayerFunction {
    Structure,
    Substrate,
    Insulation,
    Finish1,
    Finish2,
    Membrane,
    Other,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Opening {
    pub id: EntityId,
    pub opening_type: OpeningType,
    pub position: f64,
    pub width: f64,
    pub height: f64,
    pub sill_height: f64,
    pub door: Option<DoorRef>,
    pub window: Option<WindowRef>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum OpeningType {
    Door,
    Window,
    Opening,
    Nich,
}

impl Wall {
    pub fn new(name: String, baseline: Polyline, height: f64, thickness: f64) -> Self {
        let mut wall = Self {
            id: EntityId::new(),
            name,
            wall_type: WallType::Basic,
            baseline,
            height,
            thickness,
            base_height: 0.0,
            justification: WallJustification::Center,
            material: "Concrete".to_string(),
            layers: Vec::new(),
            openings: Vec::new(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-WALL".to_string(),
            properties: std::collections::HashMap::new(),
        };
        wall.update_geometry();
        wall
    }

    pub fn straight(start: Point3, end: Point3, height: f64, thickness: f64) -> Self {
        let baseline = Polyline::from_points(vec![start, end]);
        Self::new("Wall".to_string(), baseline, height, thickness)
    }

    pub fn curved(center: Point3, radius: f64, start_angle: f64, end_angle: f64, height: f64, thickness: f64) -> Self {
        let points: Vec<Point3> = (0..=32)
            .map(|i| {
                let t = i as f64 / 32.0;
                let angle = start_angle + (end_angle - start_angle) * t;
                Point3::new(
                    center.x + radius * angle.cos(),
                    center.y + radius * angle.sin(),
                    center.z,
                )
            })
            .collect();
        let baseline = Polyline::from_points(points);
        Self::new("Curved Wall".to_string(), baseline, height, thickness)
    }

    pub fn composite(name: String, baseline: Polyline, height: f64, layers: Vec<WallLayer>) -> Self {
        let thickness: f64 = layers.iter().map(|l| l.thickness).sum();
        let mut wall = Self::new(name, baseline, height, thickness);
        wall.wall_type = WallType::Composite;
        wall.layers = layers;
        wall.update_geometry();
        wall
    }

    pub fn add_opening(&mut self, opening: Opening) -> EntityId {
        let id = opening.id;
        self.openings.push(opening);
        self.update_geometry();
        id
    }

    pub fn remove_opening(&mut self, opening_id: EntityId) {
        self.openings.retain(|o| o.id != opening_id);
        self.update_geometry();
    }

    pub fn set_justification(&mut self, justification: WallJustification) {
        self.justification = justification;
        self.update_geometry();
    }

    pub fn set_height(&mut self, height: f64) {
        self.height = height;
        self.update_geometry();
    }

    pub fn set_base_height(&mut self, base_height: f64) {
        self.base_height = base_height;
        self.update_geometry();
    }

    pub fn to_solid(&self) -> SolidEntity {
        let mut solids = Vec::new();
        
        for segment in self.baseline_segments() {
            let wall_solid = ArchitecturePrimitives::wall(
                segment.0,
                segment.1,
                self.height,
                self.thickness,
                self.base_height,
            );
            solids.push(wall_solid);
        }
        
        if solids.len() == 1 {
            solids[0].clone()
        } else {
            let mut result = solids[0].clone();
            for solid in &solids[1..] {
                result = BooleanOps::union(&result, solid).unwrap_or(result);
            }
            result
        }
    }

    pub fn baseline_segments(&self) -> Vec<(Point3, Point3)> {
        let mut segments = Vec::new();
        let points = &self.baseline.vertices;
        for i in 1..points.len() {
            segments.push((points[i - 1], points[i]));
        }
        segments
    }

    pub fn length(&self) -> f64 {
        self.baseline.length()
    }

    pub fn area(&self) -> f64 {
        self.length() * self.height
    }

    pub fn volume(&self) -> f64 {
        self.area() * self.thickness
    }

    pub fn update_geometry(&mut self) {
        let solid = self.to_solid();
        self.bounding_box = solid.bounding_box();
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }

    pub fn contains_point(&self, point: Point3, tolerance: f64) -> bool {
        for segment in self.baseline_segments() {
            let dist = Intersection::distance_point_line(point, segment.0, segment.1);
            if dist <= self.thickness * 0.5 + tolerance {
                let z_min = self.base_height - tolerance;
                let z_max = self.base_height + self.height + tolerance;
                if point.z >= z_min && point.z <= z_max {
                    return true;
                }
            }
        }
        false
    }
}

pub type WallRef = Arc<RwLock<Wall>>;

pub struct WallBuilder {
    wall: Wall,
}

impl WallBuilder {
    pub fn new(name: String) -> Self {
        let baseline = Polyline::from_points(vec![Point3::origin(), Point3::new(1000.0, 0.0, 0.0)]);
        Self {
            wall: Wall::new(name, baseline, 3000.0, 200.0),
        }
    }

    pub fn baseline(mut self, baseline: Polyline) -> Self {
        self.wall.baseline = baseline;
        self
    }

    pub fn height(mut self, height: f64) -> Self {
        self.wall.height = height;
        self
    }

    pub fn thickness(mut self, thickness: f64) -> Self {
        self.wall.thickness = thickness;
        self
    }

    pub fn base_height(mut self, base_height: f64) -> Self {
        self.wall.base_height = base_height;
        self
    }

    pub fn wall_type(mut self, wall_type: WallType) -> Self {
        self.wall.wall_type = wall_type;
        self
    }

    pub fn justification(mut self, justification: WallJustification) -> Self {
        self.wall.justification = justification;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.wall.material = material;
        self
    }

    pub fn add_layer(mut self, layer: WallLayer) -> Self {
        self.wall.layers.push(layer);
        self
    }

    pub fn add_opening(mut self, opening: Opening) -> Self {
        self.wall.add_opening(opening);
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.wall.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Wall {
        self.wall.update_geometry();
        self.wall
    }
}

pub fn wall_builder(name: String) -> WallBuilder {
    WallBuilder::new(name)
}