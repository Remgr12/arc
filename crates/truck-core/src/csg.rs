use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum CSGOperation {
    Union,
    Intersection,
    Difference,
    Subtract,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CSG {
    pub id: Uuid,
    pub operation: CSGOperation,
    pub children: Vec<Uuid>, // References to entity or other CSG IDs
    pub transform: [f64; 12],
}

impl CSG {
    pub fn new(operation: CSGOperation) -> Self {
        CSG {
            id: Uuid::new_v4(),
            operation,
            children: Vec::new(),
            transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
        }
    }

    pub fn add_child(&mut self, child_id: Uuid) {
        self.children.push(child_id);
    }
}
