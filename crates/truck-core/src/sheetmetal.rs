use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SheetMetal {
    pub base_thickness: f64,
    pub bends: Vec<Bend>,
    pub flat_pattern: FlatPattern,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Bend {
    pub angle: f64,
    pub tangent: [f64; 3],
    pub start_point: [f64; 3],
    pub center_point: [f64; 3],
    pub radius: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlatPattern {
    pub width: f64,
    pub height: f64,
    pub lines: Vec<FlatLine>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FlatLine {
    pub start: [f64; 2],
    pub end: [f64; 2],
    pub layer_id: Option<Uuid>,
}
