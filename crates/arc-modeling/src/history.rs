use serde::{Serialize, Deserialize};
use arc_core::*;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ModelingHistory {
    pub sketches: Vec<EntityId>,
    pub features: Vec<EntityId>,
    pub current_sketch: Option<EntityId>,
    pub current_feature: Option<EntityId>,
}

impl ModelingHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add_sketch(&mut self, id: EntityId) {
        self.sketches.push(id);
        self.current_sketch = Some(id);
    }

    pub fn add_feature(&mut self, id: EntityId) {
        self.features.push(id);
        self.current_feature = Some(id);
    }

    pub fn clear(&mut self) {
        self.sketches.clear();
        self.features.clear();
        self.current_sketch = None;
        self.current_feature = None;
    }
}