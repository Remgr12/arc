use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Part {
    pub id: Uuid,
    pub name: String,
    pub transform: [f64; 12], // 3x4 matrix
    pub children: Vec<PartId>,
}

type PartId = Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assembly {
    pub id: PartId,
    pub name: String,
    pub parts: Vec<Part>,
    pub exploded: bool,
}

impl Assembly {
    pub fn new(name: String) -> Self {
        Assembly {
            id: Uuid::new_v4(),
            name,
            parts: Vec::new(),
            exploded: false,
        }
    }

    pub fn add_part(&mut self, part: Part) {
        self.parts.push(part);
    }
}
