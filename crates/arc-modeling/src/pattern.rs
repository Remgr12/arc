use serde::{Serialize, Deserialize};
use arc_core::*;
use arc_geometry::*;
use crate::CoordinateSystem;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pattern {
    pub id: EntityId,
    pub pattern_type: PatternType,
    pub base_feature: EntityId,
    pub count: u32,
    pub spacing: f64,
    pub direction: Vector3,
}

impl Pattern {
    pub fn linear(base: EntityId, direction: Vector3, count: u32, spacing: f64) -> Self {
        Self {
            id: EntityId::new(),
            pattern_type: PatternType::Linear,
            base_feature: base,
            count,
            spacing,
            direction,
        }
    }

    pub fn circular(base: EntityId, center: Point3, axis: Vector3, count: u32) -> Self {
        Self {
            id: EntityId::new(),
            pattern_type: PatternType::Circular,
            base_feature: base,
            count,
            spacing: 0.0,
            direction: axis,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PatternType {
    Linear,
    Circular,
    CurveDriven,
    SketchDriven,
}