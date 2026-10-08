use arc_core::*;
use arc_geometry::*;
use nalgebra::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Roof {
    pub id: EntityId,
    pub name: String,
    pub roof_type: RoofType,
    pub outline: Polyline,
    pub pitch: f64,
    pub overhang: f64,
    pub thickness: f64,
    pub ridge_height: f64,
    pub eave_height: f64,
    pub material: String,
    pub insulation: f64,
    pub membrane: String,
    pub drainage: DrainageSystem,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum RoofType {
    Flat,
    Gable,
    Hip,
    Gambrel,
    Mansard,
    Shed,
    Butterfly,
    Dome,
    Vaulted,
    Curved,
    Green,
    Custom,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct DrainageSystem {
    pub gutters: bool,
    pub downspouts: Vec<Point3>,
    pub internal_drains: Vec<Point3>,
    pub slope_direction: Vector3,
    pub slope_percent: f64,
}

impl Roof {
    pub fn new(name: String, outline: Polyline, roof_type: RoofType) -> Self {
        let mut roof = Self {
            id: EntityId::new(),
            name,
            roof_type,
            outline,
            pitch: 30.0_f64.to_radians(),
            overhang: 300.0,
            thickness: 200.0,
            ridge_height: 0.0,
            eave_height: 0.0,
            material: "Metal".to_string(),
            insulation: 100.0,
            membrane: "TPO".to_string(),
            drainage: DrainageSystem::default(),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-ROOF".to_string(),
            properties: std::collections::HashMap::new(),
        };
        roof.update_geometry();
        roof
    }

    pub fn flat(outline: Polyline, thickness: f64) -> Self {
        let mut roof = Self::new("Flat Roof".to_string(), outline, RoofType::Flat);
        roof.thickness = thickness;
        roof.update_geometry();
        roof
    }

    pub fn gable(outline: Polyline, pitch: f64, ridge_height: f64) -> Self {
        let mut roof = Self::new("Gable Roof".to_string(), outline, RoofType::Gable);
        roof.pitch = pitch;
        roof.ridge_height = ridge_height;
        roof.update_geometry();
        roof
    }

    pub fn hip(outline: Polyline, pitch: f64, ridge_height: f64) -> Self {
        let mut roof = Self::new("Hip Roof".to_string(), outline, RoofType::Hip);
        roof.pitch = pitch;
        roof.ridge_height = ridge_height;
        roof.update_geometry();
        roof
    }

    pub fn shed(outline: Polyline, pitch: f64, high_side: f64, low_side: f64) -> Self {
        let mut roof = Self::new("Shed Roof".to_string(), outline, RoofType::Shed);
        roof.pitch = pitch;
        roof.ridge_height = high_side;
        roof.eave_height = low_side;
        roof.update_geometry();
        roof
    }

    pub fn to_solid(&self) -> SolidEntity {
        match self.roof_type {
            RoofType::Flat => ArchitecturePrimitives::roof_flat(&self.outline.vertices, self.thickness, 0.0),
            RoofType::Gable => ArchitecturePrimitives::roof_gable(&self.outline.vertices, self.ridge_height, 0.0),
            RoofType::Hip => ArchitecturePrimitives::roof_hip(&self.outline.vertices, self.ridge_height, 0.0),
            _ => ArchitecturePrimitives::roof_flat(&self.outline.vertices, self.thickness, 0.0),
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

pub type RoofRef = Arc<RwLock<Roof>>;

pub struct RoofBuilder {
    roof: Roof,
}

impl RoofBuilder {
    pub fn new(name: String, outline: Polyline) -> Self {
        Self {
            roof: Roof::new(name, outline, RoofType::Flat),
        }
    }

    pub fn roof_type(mut self, roof_type: RoofType) -> Self {
        self.roof.roof_type = roof_type;
        self
    }

    pub fn pitch(mut self, pitch: f64) -> Self {
        self.roof.pitch = pitch;
        self
    }

    pub fn overhang(mut self, overhang: f64) -> Self {
        self.roof.overhang = overhang;
        self
    }

    pub fn thickness(mut self, thickness: f64) -> Self {
        self.roof.thickness = thickness;
        self
    }

    pub fn ridge_height(mut self, height: f64) -> Self {
        self.roof.ridge_height = height;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.roof.material = material;
        self
    }

    pub fn drainage(mut self, drainage: DrainageSystem) -> Self {
        self.roof.drainage = drainage;
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.roof.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Roof {
        self.roof.update_geometry();
        self.roof
    }
}

pub fn roof_builder(name: String, outline: Polyline) -> RoofBuilder {
    RoofBuilder::new(name, outline)
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Slab {
    pub id: EntityId,
    pub name: String,
    pub slab_type: SlabType,
    pub outline: Polyline,
    pub thickness: f64,
    pub elevation: f64,
    pub material: String,
    pub reinforcement: Reinforcement,
    pub joints: Vec<ControlJoint>,
    pub slope: f64,
    pub slope_direction: Vector3,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SlabType {
    Floor,
    Roof,
    Foundation,
    SlabOnGrade,
    Suspended,
    Precast,
    PostTensioned,
    Waffle,
    Ribbed,
    Composite,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Reinforcement {
    pub top_bars: RebarLayer,
    pub bottom_bars: RebarLayer,
    pub shear_reinforcement: Option<ShearReinforcement>,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct RebarLayer {
    pub bar_size: String,
    pub spacing: f64,
    pub cover: f64,
    pub direction: Vector3,
}

#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct ShearReinforcement {
    pub type_: String,
    pub spacing: f64,
    pub size: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ControlJoint {
    pub id: EntityId,
    pub start: Point3,
    pub end: Point3,
    pub width: f64,
    pub depth: f64,
    pub sealant: String,
}

impl Slab {
    pub fn new(name: String, outline: Polyline, thickness: f64, elevation: f64) -> Self {
        let mut slab = Self {
            id: EntityId::new(),
            name,
            slab_type: SlabType::Floor,
            outline,
            thickness,
            elevation,
            material: "Concrete".to_string(),
            reinforcement: Reinforcement::default(),
            joints: Vec::new(),
            slope: 0.0,
            slope_direction: Vector3::new(0.0, 1.0, 0.0),
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-SLAB".to_string(),
            properties: std::collections::HashMap::new(),
        };
        slab.update_geometry();
        slab
    }

    pub fn floor(outline: Polyline, thickness: f64, elevation: f64) -> Self {
        Self::new("Floor Slab".to_string(), outline, thickness, elevation)
    }

    pub fn roof(outline: Polyline, thickness: f64, elevation: f64) -> Self {
        let mut slab = Self::new("Roof Slab".to_string(), outline, thickness, elevation);
        slab.slab_type = SlabType::Roof;
        slab.update_geometry();
        slab
    }

    pub fn foundation(outline: Polyline, thickness: f64) -> Self {
        let mut slab = Self::new("Foundation Slab".to_string(), outline, thickness, 0.0);
        slab.slab_type = SlabType::Foundation;
        slab.update_geometry();
        slab
    }

    pub fn add_joint(&mut self, joint: ControlJoint) {
        self.joints.push(joint);
    }

    pub fn set_reinforcement(&mut self, reinforcement: Reinforcement) {
        self.reinforcement = reinforcement;
    }

    pub fn to_solid(&self) -> SolidEntity {
        ArchitecturePrimitives::slab(&self.outline.vertices, self.thickness, self.elevation)
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

pub type SlabRef = Arc<RwLock<Slab>>;

pub struct SlabBuilder {
    slab: Slab,
}

impl SlabBuilder {
    pub fn new(name: String, outline: Polyline, thickness: f64, elevation: f64) -> Self {
        Self {
            slab: Slab::new(name, outline, thickness, elevation),
        }
    }

    pub fn slab_type(mut self, slab_type: SlabType) -> Self {
        self.slab.slab_type = slab_type;
        self
    }

    pub fn material(mut self, material: String) -> Self {
        self.slab.material = material;
        self
    }

    pub fn reinforcement(mut self, reinforcement: Reinforcement) -> Self {
        self.slab.reinforcement = reinforcement;
        self
    }

    pub fn add_joint(mut self, joint: ControlJoint) -> Self {
        self.slab.add_joint(joint);
        self
    }

    pub fn slope(mut self, slope: f64, direction: Vector3) -> Self {
        self.slab.slope = slope;
        self.slab.slope_direction = direction.normalize();
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.slab.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Slab {
        self.slab.update_geometry();
        self.slab
    }
}

pub fn slab_builder(name: String, outline: Polyline, thickness: f64, elevation: f64) -> SlabBuilder {
    SlabBuilder::new(name, outline, thickness, elevation)
}