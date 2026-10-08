use serde::{Serialize, Deserialize};
use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::{CoordinateSystem, PartRef, EntityId};

#[derive(Debug, Clone)]
pub struct Assembly {
    pub id: EntityId,
    pub name: String,
    pub origin: CoordinateSystem,
    pub components: Vec<AssemblyComponent>,
    pub constraints: Vec<AssemblyConstraint>,
}

impl Assembly {
    pub fn new(name: String) -> Self {
        Self {
            id: EntityId::new(),
            name,
            origin: CoordinateSystem::default(),
            components: Vec::new(),
            constraints: Vec::new(),
        }
    }

    pub fn add_component(&mut self, component: AssemblyComponent) {
        self.components.push(component);
    }

    pub fn add_constraint(&mut self, constraint: AssemblyConstraint) {
        self.constraints.push(constraint);
    }
}

#[derive(Debug, Clone)]
pub struct AssemblyComponent {
    pub id: EntityId,
    pub part: PartRef,
    pub transform: Transform,
    pub is_fixed: bool,
}

impl AssemblyComponent {
    pub fn new(part: PartRef) -> Self {
        Self {
            id: EntityId::new(),
            part,
            transform: Transform::identity(),
            is_fixed: false,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum AssemblyConstraint {
    Mate { face1: EntityId, face2: EntityId, offset: f64 },
    Flush { face1: EntityId, face2: EntityId },
    Angle { face1: EntityId, face2: EntityId, angle: f64 },
    Tangent { face1: EntityId, face2: EntityId },
    Insert { axis1: EntityId, axis2: EntityId },
}

pub type AssemblyRef = Arc<RwLock<Assembly>>;