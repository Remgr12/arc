use serde::{Serialize, Deserialize};
use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::{EntityId, Vector3, Point3, CoordinateSystem};

#[derive(Debug, Clone)]
pub struct Feature {
    pub id: EntityId,
    pub name: String,
    pub feature_type: FeatureType,
    pub parameters: Vec<FeatureParameter>,
    pub parent_sketch: Option<EntityId>,
    pub output_geometry: Option<EntityId>,
}

impl Feature {
    pub fn new(name: String, feature_type: FeatureType) -> Self {
        Self {
            id: EntityId::new(),
            name,
            feature_type,
            parameters: Vec::new(),
            parent_sketch: None,
            output_geometry: None,
        }
    }

    pub fn rebuild(&mut self, _model: &crate::Model) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub enum FeatureType {
    Extrude { direction: Vector3, distance: f64 },
    Revolve { axis: Vector3, angle: f64 },
    Sweep { path: EntityId },
    Loft { profiles: Vec<EntityId> },
    Fillet { edges: Vec<EntityId>, radius: f64 },
    Chamfer { edges: Vec<EntityId>, distance: f64 },
    Shell { faces: Vec<EntityId>, thickness: f64 },
    Hole { center: Point3, diameter: f64, depth: f64 },
    Pattern { base: EntityId, count: u32, spacing: f64 },
    Mirror { base: EntityId, plane: CoordinateSystem },
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct FeatureParameter {
    pub name: String,
    pub value: f64,
    pub expression: Option<String>,
}

pub type FeatureRef = Arc<RwLock<Feature>>;