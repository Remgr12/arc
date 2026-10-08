use serde::{Serialize, Deserialize};
use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use crate::{CoordinateSystem, EntityId};

#[derive(Debug, Clone)]
pub struct Sketch {
    pub id: EntityId,
    pub name: String,
    pub plane: CoordinateSystem,
    pub curves: Vec<CurveEntity>,
    pub constraints: Vec<SketchConstraint>,
    pub is_fully_constrained: bool,
}

impl Sketch {
    pub fn new(name: String, plane: CoordinateSystem) -> Self {
        Self {
            id: EntityId::new(),
            name,
            plane,
            curves: Vec::new(),
            constraints: Vec::new(),
            is_fully_constrained: false,
        }
    }

    pub fn add_curve(&mut self, curve: CurveEntity) {
        self.curves.push(curve);
    }

    pub fn add_constraint(&mut self, constraint: SketchConstraint) {
        self.constraints.push(constraint);
    }

    pub fn rebuild(&mut self) -> Result<(), String> {
        Ok(())
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SketchConstraint {
    Coincident { point1: EntityId, point2: EntityId },
    Horizontal { entity: EntityId },
    Vertical { entity: EntityId },
    Parallel { entity1: EntityId, entity2: EntityId },
    Perpendicular { entity1: EntityId, entity2: EntityId },
    Tangent { curve1: EntityId, curve2: EntityId },
    Equal { entity1: EntityId, entity2: EntityId },
    Midpoint { point: EntityId, entity: EntityId },
    Distance { entity1: EntityId, entity2: EntityId, value: f64 },
    Angle { entity1: EntityId, entity2: EntityId, value: f64 },
}

pub type SketchRef = Arc<RwLock<Sketch>>;

#[derive(Debug, Clone)]
pub struct SketchBuilder {
    sketch: Sketch,
}

impl SketchBuilder {
    pub fn new(name: String, plane: CoordinateSystem) -> Self {
        Self { sketch: Sketch::new(name, plane) }
    }

    pub fn line(&mut self, start: Point3, end: Point3) -> GeometryId {
        let curve = CurveEntity::line(start, end);
        let id = curve.id;
        self.sketch.add_curve(curve);
        id
    }

    pub fn circle(&mut self, center: Point3, radius: f64) -> GeometryId {
        let curve = CurveEntity::circle(center, Vector3::new(0.0, 0.0, 1.0), radius);
        let id = curve.id;
        self.sketch.add_curve(curve);
        id
    }

    pub fn build(self) -> Sketch {
        self.sketch
    }
}