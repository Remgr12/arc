use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Annotation {
    pub id: Uuid,
    pub text: String,
    pub position: [f64; 3],
    pub normal: [f64; 3],
}

impl Annotation {
    pub fn new(text: String, position: [f64; 3], normal: [f64; 3]) -> Self {
        Annotation {
            id: Uuid::new_v4(),
            text,
            position,
            normal,
        }
    }
}
