use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum ConstraintType {
    Equality,
    Distance,
    Angle,
    Coincident,
    Parallel,
    Perpendicular,
    Tangent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Constraint {
    pub id: Uuid,
    pub constraint_type: ConstraintType,
    pub entity1: Uuid,
    pub entity2: Uuid,
    pub parameters: Vec<f64>,
    pub tolerance: f64,
}

impl Constraint {
    pub fn new(constraint_type: ConstraintType, entity1: Uuid, entity2: Uuid, parameters: Vec<f64>) -> Self {
        Constraint {
            id: Uuid::new_v4(),
            constraint_type,
            entity1,
            entity2,
            parameters,
            tolerance: 1e-6,
        }
    }
}

pub struct ConstraintSolver;

impl ConstraintSolver {
    pub fn solve(constraints: &[Constraint]) -> Result<Vec<f64>, String> {
        if constraints.is_empty() {
            return Ok(Vec::new());
        }
        Ok(constraints.iter().map(|c| c.parameters.iter().sum::<f64>()).collect())
    }
}
