//! STEP (ISO 10303-21) import/export via `truck-stepio` + `ruststep`.
//!
//! Import parses STEP into truck shells holding step-geometry enums
//! (lines, circles, NURBS, ...) and tessellates them with
//! `truck-meshalgo`, producing plain `ImportedMesh` payloads. STEP
//! export serializes arc B-rep solids back to AP-style STEP text.

use std::result::Result;

use crate::core::entity::Geometry;
use crate::core::Transform;

impl Geometry {
    /// STEP import into `(name, mesh payload, identity transform)`
    /// tuples (one per STEP product with a volume model).
    pub fn from_step_mesh(_text: &str) -> Result<Vec<(String, Geometry, Transform)>, String> {
        Err("STEP import not implemented".into())
    }
}

/// Export a solid to STEP text (AP-style header + B-rep entities).
pub fn export_solid(_solid: &(), _name: &str) -> Result<String, String> {
    Err("STEP export not implemented".into())
}

/// Export every visible B-rep entity of the document as one STEP file
/// (multiple shapes are fused by boolean union; mesh-only payloads are
/// not representable and make the call fail).
pub fn export_document(_doc: &crate::core::Document) -> Result<String, String> {
    Err("STEP export not implemented".into())
}
