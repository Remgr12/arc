use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3};
use crate::{EntityId, EntityRef};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ConstraintType {
    // Geometric constraints
    Coincident,
    Parallel,
    Perpendicular,
    Tangent,
    Concentric,
    Collinear,
    Horizontal,
    Vertical,
    Equal,
    Symmetric,
    Fix,
    Midpoint,
    Intersection,

    // Dimensional constraints
    Distance,
    Angle,
    Radius,
    Diameter,
    Length,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Constraint {
    pub id: EntityId,
    pub constraint_type: ConstraintType,
    pub entities: Vec<EntityId>,
    pub parameters: Vec<f64>,
    pub enabled: bool,
    pub driving: bool,
    pub name: String,
}

impl Constraint {
    pub fn new(constraint_type: ConstraintType, entities: Vec<EntityId>, parameters: Vec<f64>) -> Self {
        Self {
            id: EntityId::new(),
            constraint_type,
            entities,
            parameters,
            enabled: true,
            driving: true,
            name: String::new(),
        }
    }

    pub fn entity_count(&self) -> usize {
        match self.constraint_type {
            ConstraintType::Coincident => 2,
            ConstraintType::Parallel => 2,
            ConstraintType::Perpendicular => 2,
            ConstraintType::Tangent => 2,
            ConstraintType::Concentric => 2,
            ConstraintType::Collinear => 2,
            ConstraintType::Horizontal => 1,
            ConstraintType::Vertical => 1,
            ConstraintType::Equal => 2,
            ConstraintType::Symmetric => 3,
            ConstraintType::Fix => 1,
            ConstraintType::Midpoint => 2,
            ConstraintType::Intersection => 2,
            ConstraintType::Distance => 2,
            ConstraintType::Angle => 3,
            ConstraintType::Radius => 1,
            ConstraintType::Diameter => 1,
            ConstraintType::Length => 1,
        }
    }
}

pub type ConstraintRef = Arc<RwLock<Constraint>>;

#[derive(Debug, Default)]
pub struct ConstraintSystem {
    constraints: dashmap::DashMap<EntityId, ConstraintRef>,
    by_entity: dashmap::DashMap<EntityId, Vec<EntityId>>,
}

impl ConstraintSystem {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&self, constraint: ConstraintRef) {
        let id = constraint.read().id;
        for entity_id in &constraint.read().entities {
            self.by_entity.entry(*entity_id).or_default().push(id);
        }
        self.constraints.insert(id, constraint);
    }

    pub fn remove(&self, id: EntityId) -> Option<ConstraintRef> {
        if let Some((_, constraint)) = self.constraints.remove(&id) {
            for entity_id in &constraint.read().entities {
                if let Some(mut vec) = self.by_entity.get_mut(entity_id) {
                    vec.retain(|cid| *cid != id);
                }
            }
            Some(constraint)
        } else {
            None
        }
    }

    pub fn get(&self, id: EntityId) -> Option<ConstraintRef> {
        self.constraints.get(&id).map(|c| c.clone())
    }

    pub fn get_by_entity(&self, entity_id: EntityId) -> Vec<ConstraintRef> {
        self.by_entity.get(&entity_id)
            .map(|ids| ids.iter().filter_map(|cid| self.constraints.get(cid).map(|c| c.clone())).collect())
            .unwrap_or_default()
    }

    pub fn all(&self) -> Vec<ConstraintRef> {
        self.constraints.iter().map(|c| c.clone()).collect()
    }

    pub fn count(&self) -> usize {
        self.constraints.len()
    }

    pub fn solve(&self, entities: &crate::EntityContainer) -> SolveResult {
        let mut result = SolveResult::default();
        
        for constraint_ref in self.constraints.iter() {
            let constraint = constraint_ref.read();
            if !constraint.enabled {
                continue;
            }
            
            if let Err(e) = self.solve_constraint(&constraint, entities) {
                result.errors.push(ConstraintError {
                    constraint_id: constraint.id,
                    message: e,
                });
            }
        }
        
        result
    }

    fn solve_constraint(&self, constraint: &Constraint, entities: &crate::EntityContainer) -> Result<(), String> {
        let entity_refs: Vec<_> = constraint.entities.iter()
            .filter_map(|id| entities.get(*id))
            .collect();
        
        if entity_refs.len() != constraint.entity_count() {
            return Err("Invalid entity count for constraint".to_string());
        }

        match constraint.constraint_type {
            ConstraintType::Coincident => self.solve_coincident(&entity_refs, &constraint.parameters),
            ConstraintType::Parallel => self.solve_parallel(&entity_refs),
            ConstraintType::Perpendicular => self.solve_perpendicular(&entity_refs),
            ConstraintType::Horizontal => self.solve_horizontal(&entity_refs),
            ConstraintType::Vertical => self.solve_vertical(&entity_refs),
            ConstraintType::Fix => self.solve_fix(&entity_refs),
            ConstraintType::Distance => self.solve_distance(&entity_refs, &constraint.parameters),
            ConstraintType::Angle => self.solve_angle(&entity_refs, &constraint.parameters),
            ConstraintType::Radius => self.solve_radius(&entity_refs, &constraint.parameters),
            ConstraintType::Equal => self.solve_equal(&entity_refs),
            _ => Ok(()),
        }
    }

    fn solve_coincident(&self, entities: &[EntityRef], _params: &[f64]) -> Result<(), String> {
        if entities.len() < 2 { return Err("Need 2 entities".to_string()); }
        Ok(())
    }

    fn solve_parallel(&self, entities: &[EntityRef]) -> Result<(), String> {
        if entities.len() < 2 { return Err("Need 2 entities".to_string()); }
        Ok(())
    }

    fn solve_perpendicular(&self, entities: &[EntityRef]) -> Result<(), String> {
        if entities.len() < 2 { return Err("Need 2 entities".to_string()); }
        Ok(())
    }

    fn solve_horizontal(&self, entities: &[EntityRef]) -> Result<(), String> {
        if entities.len() < 1 { return Err("Need 1 entity".to_string()); }
        Ok(())
    }

    fn solve_vertical(&self, entities: &[EntityRef]) -> Result<(), String> {
        if entities.len() < 1 { return Err("Need 1 entity".to_string()); }
        Ok(())
    }

    fn solve_fix(&self, entities: &[EntityRef]) -> Result<(), String> {
        if entities.len() < 1 { return Err("Need 1 entity".to_string()); }
        Ok(())
    }

    fn solve_distance(&self, entities: &[EntityRef], params: &[f64]) -> Result<(), String> {
        if entities.len() < 2 || params.is_empty() { return Err("Need 2 entities and distance".to_string()); }
        Ok(())
    }

    fn solve_angle(&self, entities: &[EntityRef], params: &[f64]) -> Result<(), String> {
        if entities.len() < 3 || params.is_empty() { return Err("Need 3 entities and angle".to_string()); }
        Ok(())
    }

    fn solve_radius(&self, entities: &[EntityRef], params: &[f64]) -> Result<(), String> {
        if entities.len() < 1 || params.is_empty() { return Err("Need 1 entity and radius".to_string()); }
        Ok(())
    }

    fn solve_equal(&self, entities: &[EntityRef]) -> Result<(), String> {
        if entities.len() < 2 { return Err("Need 2 entities".to_string()); }
        Ok(())
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct SolveResult {
    pub success: bool,
    pub iterations: u32,
    pub errors: Vec<ConstraintError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstraintError {
    pub constraint_id: EntityId,
    pub message: String,
}