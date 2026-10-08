use serde::{Serialize, Deserialize};
use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::CoordinateSystem;

#[derive(Debug, Clone)]
pub struct Part {
    pub id: EntityId,
    pub name: String,
    pub origin: CoordinateSystem,
    pub bodies: Vec<Body>,
    pub appearance: Appearance,
}

impl Part {
    pub fn new(name: String) -> Self {
        Self {
            id: EntityId::new(),
            name,
            origin: CoordinateSystem::default(),
            bodies: Vec::new(),
            appearance: Appearance::default(),
        }
    }

    pub fn add_body(&mut self, body: Body) {
        self.bodies.push(body);
    }

    pub fn update(&mut self) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct Body {
    pub id: EntityId,
    pub name: String,
    pub geometry: Option<SolidEntity>,
    pub color: Color,
}

impl Body {
    pub fn new(name: String, geometry: SolidEntity) -> Self {
        Self {
            id: EntityId::new(),
            name,
            geometry: Some(geometry),
            color: Color::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Appearance {
    pub color: Color,
    pub opacity: f32,
    pub material: String,
}

impl Default for Appearance {
    fn default() -> Self {
        Self {
            color: Color::default(),
            opacity: 1.0,
            material: "default".to_string(),
        }
    }
}

pub type PartRef = Arc<RwLock<Part>>;