use serde::{Serialize, Deserialize};
use arc_core::*;
use arc_geometry::*;
use crate::CoordinateSystem;

#[derive(Debug, Clone)]
pub struct Mirror {
    pub id: EntityId,
    pub base_feature: EntityId,
    pub plane: CoordinateSystem,
    pub merge_result: bool,
}

impl Mirror {
    pub fn new(base: EntityId, plane: CoordinateSystem) -> Self {
        Self {
            id: EntityId::new(),
            base_feature: base,
            plane,
            merge_result: false,
        }
    }
}