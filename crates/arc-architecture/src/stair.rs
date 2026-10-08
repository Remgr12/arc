use arc_core::*;
use arc_geometry::*;
use crate::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct Stair {
    pub id: EntityId,
    pub name: String,
    pub stair_type: StairType,
    pub run: f64,
    pub rise: f64,
    pub width: f64,
    pub tread_depth: f64,
    pub riser_height: f64,
    pub nosing: f64,
    pub tread_count: usize,
    pub landing_depth: f64,
    pub landing_width: f64,
    pub start_point: Point3,
    pub end_point: Point3,
    pub direction: Vector3,
    pub turn_type: TurnType,
    pub stringer_type: StringerType,
    pub stringer_width: f64,
    pub stringer_height: f64,
    pub railing: Railing,
    pub material: String,
    pub finish: String,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StairType {
    Straight,
    LShaped,
    UShaped,
    Spiral,
    Curved,
    Winder,
    Grand,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TurnType {
    None,
    QuarterLanding,
    HalfLanding,
    Winder,
    Spiral,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StringerType {
    Closed,
    Open,
    Mono,
    Center,
    Cantilevered,
}

#[derive(Debug, Clone, Default)]
pub struct Railing {
    pub enabled: bool,
    pub height: f64,
    pub profile: RailingProfile,
    pub material: String,
    pub baluster_spacing: f64,
    pub handrail_profile: String,
    pub extensions: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RailingProfile {
    #[default]
    Round,
    Square,
    Rectangular,
    Custom,
}

impl Stair {
    pub fn new(name: String, start: Point3, end: Point3, width: f64, rise: f64, run: f64) -> Self {
        let direction = (end - start).normalize();
        let total_rise = (end.z - start.z).abs();
        let tread_count = (total_rise / rise).ceil() as usize;
        let actual_rise = total_rise / tread_count as f64;
        let actual_run = run;
        
        let mut stair = Self {
            id: EntityId::new(),
            name,
            stair_type: StairType::Straight,
            run: actual_run,
            rise: actual_rise,
            width,
            tread_depth: actual_run,
            riser_height: actual_rise,
            nosing: 25.0,
            tread_count,
            landing_depth: width,
            landing_width: width * 2.0,
            start_point: start,
            end_point: end,
            direction,
            turn_type: TurnType::None,
            stringer_type: StringerType::Closed,
            stringer_width: 300.0,
            stringer_height: 250.0,
            railing: Railing {
                enabled: true,
                height: 900.0,
                profile: RailingProfile::Round,
                material: "Steel".to_string(),
                baluster_spacing: 100.0,
                handrail_profile: "Round".to_string(),
                extensions: 300.0,
            },
            material: "Concrete".to_string(),
            finish: "Tile".to_string(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-STAIR".to_string(),
            properties: std::collections::HashMap::new(),
        };
        stair.update_geometry();
        stair
    }

    pub fn straight(start: Point3, end: Point3, width: f64, rise: f64, run: f64) -> Self {
        Self::new("Straight Stair".to_string(), start, end, width, rise, run)
    }

    pub fn l_shaped(start: Point3, mid: Point3, end: Point3, width: f64, rise: f64, run: f64) -> Self {
        let mut stair = Self::new("L-Shaped Stair".to_string(), start, end, width, rise, run);
        stair.stair_type = StairType::LShaped;
        stair.turn_type = TurnType::QuarterLanding;
        stair.update_geometry();
        stair
    }

    pub fn u_shaped(start: Point3, mid1: Point3, mid2: Point3, end: Point3, width: f64, rise: f64, run: f64) -> Self {
        let mut stair = Self::new("U-Shaped Stair".to_string(), start, end, width, rise, run);
        stair.stair_type = StairType::UShaped;
        stair.turn_type = TurnType::HalfLanding;
        stair.update_geometry();
        stair
    }

    pub fn spiral(center: Point3, radius: f64, height: f64, turns: f64, width: f64) -> Self {
        let start = Point3::new(center.x + radius, center.y, 0.0);
        let end = Point3::new(center.x + radius, center.y, height);
        let mut stair = Self::new("Spiral Stair".to_string(), start, end, width, 180.0, 250.0);
        stair.stair_type = StairType::Spiral;
        stair.turn_type = TurnType::Spiral;
        stair.update_geometry();
        stair
    }

    pub fn set_stringer(&mut self, stringer_type: StringerType, width: f64, height: f64) {
        self.stringer_type = stringer_type;
        self.stringer_width = width;
        self.stringer_height = height;
        self.update_geometry();
    }

    pub fn set_railing(&mut self, railing: Railing) {
        self.railing = railing;
        self.update_geometry();
    }

    pub fn to_solids(&self) -> Vec<SolidEntity> {
        let mut solids = Vec::new();
        
        let treads = ArchitecturePrimitives::stair_run(
            self.start_point,
            self.direction,
            self.run * self.tread_count as f64,
            self.rise,
            self.width,
            self.tread_depth,
            self.tread_count,
        );
        
        solids.extend(treads);
        
        if self.railing.enabled {
            let railing_solid = self.create_railing();
            solids.push(railing_solid);
        }
        
        let stringers = self.create_stringers();
        solids.extend(stringers);
        
        solids
    }

    fn create_stringers(&self) -> Vec<SolidEntity> {
        let mut stringers = Vec::new();
        let half_width = self.width * 0.5;
        
        match self.stringer_type {
            StringerType::Closed => {
                let left = SolidEntity::box_centered(
                    Point3::new(-half_width - self.stringer_width * 0.5, 0.0, self.rise * 0.5),
                    Vector3::new(self.stringer_width, self.tread_depth * self.tread_count as f64, self.rise * self.tread_count as f64),
                );
                let right = SolidEntity::box_centered(
                    Point3::new(half_width + self.stringer_width * 0.5, 0.0, self.rise * 0.5),
                    Vector3::new(self.stringer_width, self.tread_depth * self.tread_count as f64, self.rise * self.tread_count as f64),
                );
                stringers.push(left);
                stringers.push(right);
            }
            StringerType::Mono => {
                let mono = SolidEntity::box_centered(
                    Point3::new(0.0, 0.0, self.rise * 0.5),
                    Vector3::new(self.stringer_width, self.tread_depth * self.tread_count as f64, self.rise * self.tread_count as f64),
                );
                stringers.push(mono);
            }
            StringerType::Center => {
                let center = SolidEntity::box_centered(
                    Point3::new(0.0, 0.0, self.rise * 0.5),
                    Vector3::new(self.stringer_width, self.tread_depth * self.tread_count as f64, self.rise * self.tread_count as f64),
                );
                stringers.push(center);
            }
            _ => {}
        }
        
        for s in &mut stringers {
            let matrix = self.transform.to_matrix();
            s.apply_transform(crate::Transform::from_matrix(matrix));
        }
        
        stringers
    }

    fn create_railing(&self) -> SolidEntity {
        let posts: Vec<SolidEntity> = (0..=self.tread_count)
            .map(|i| {
                let z = self.rise * i as f64;
                let x = self.width * 0.5 + 50.0;
                SolidEntity::cylinder(
                    Point3::new(x, 0.0, z),
                    Vector3::new(0.0, 0.0, 1.0),
                    25.0,
                    self.railing.height,
                )
            })
            .collect();
        
        let handrail = SolidEntity::cylinder(
            Point3::new(self.width * 0.5 + 50.0, 0.0, self.railing.height),
            Vector3::new(0.0, 1.0, 0.0),
            25.0,
            self.tread_depth * self.tread_count as f64,
        );
        
        let mut result = posts[0].clone();
        for post in &posts[1..] {
            result = BooleanOps::union(&result, post).unwrap_or(result);
        }
        result = BooleanOps::union(&result, &handrail).unwrap_or(result);
        
        let matrix = self.transform.to_matrix();
        result.apply_transform(crate::Transform::from_matrix(matrix));
        
        result
    }

    pub fn update_geometry(&mut self) {
        let solids = self.to_solids();
        let mut bbox = BoundingBox::empty();
        for solid in &solids {
            bbox.expand(&solid.bounding_box());
        }
        self.bounding_box = bbox;
    }

    pub fn contains_point(&self, point: Point3, tolerance: f64) -> bool {
        let local = self.transform.inverse().transform_point(point);
        let half_w = self.width * 0.5 + tolerance;
        let half_d = self.tread_depth * self.tread_count as f64 * 0.5 + tolerance;
        let half_h = self.rise * self.tread_count as f64 * 0.5 + tolerance;
        
        local.x.abs() <= half_w && local.y.abs() <= half_d && local.z.abs() <= half_h
    }
}

pub type StairRef = Arc<RwLock<Stair>>;

pub struct StairBuilder {
    stair: Stair,
}

impl StairBuilder {
    pub fn new(name: String, start: Point3, end: Point3, width: f64) -> Self {
        Self {
            stair: Stair::new(name, start, end, width, 180.0, 250.0),
        }
    }

    pub fn stair_type(mut self, stair_type: StairType) -> Self {
        self.stair.stair_type = stair_type;
        self
    }

    pub fn rise_run(mut self, rise: f64, run: f64) -> Self {
        self.stair.rise = rise;
        self.stair.run = run;
        self
    }

    pub fn tread_count(mut self, count: usize) -> Self {
        self.stair.tread_count = count;
        self
    }

    pub fn nosing(mut self, nosing: f64) -> Self {
        self.stair.nosing = nosing;
        self
    }

    pub fn stringer(mut self, stringer_type: StringerType, width: f64, height: f64) -> Self {
        self.stair.stringer_type = stringer_type;
        self.stair.stringer_width = width;
        self.stair.stringer_height = height;
        self
    }

    pub fn railing(mut self, railing: Railing) -> Self {
        self.stair.railing = railing;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.stair.material = material;
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.stair.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Stair {
        self.stair.update_geometry();
        self.stair
    }
}

pub fn stair_builder(name: String, start: Point3, end: Point3, width: f64) -> StairBuilder {
    StairBuilder::new(name, start, end, width)
}