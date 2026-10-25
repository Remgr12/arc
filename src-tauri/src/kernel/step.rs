//! STEP (ISO 10303-21) import/export via `truck-stepio` + `ruststep`.
//!
//! Import parses STEP into truck shells holding step-geometry enums
//! (lines, circles, NURBS, ...) and tessellates them with
//! `truck-meshalgo`, producing plain `ImportedMesh` payloads. STEP
//! export serializes arc B-rep solids back to AP-style STEP text.

use std::result::Result;

use crate::core::Transform;
use crate::core::entity::Geometry;

use truck_meshalgo::prelude::*;
use truck_stepio::r#in::{Table, convert::ProductShape};
use truck_stepio::r#out::{self as out, StepDesign};
use truck_topology::compress::CompressedShell;

use truck_base::cgmath64::Transform as _;
use truck_modeling::Solid;

/// STEP-imported curve/surface geometry enums.
pub type StepCurve = truck_stepio::r#in::step_geometry::Curve3D;
/// STEP-imported curve/surface geometry enums.
pub type StepSurface = truck_stepio::r#in::step_geometry::Surface;

impl Geometry {
    /// STEP import into `(name, mesh payload, identity transform)`
    /// tuples (one per STEP product with a volume model).
    pub fn from_step_mesh(text: &str) -> Result<Vec<(String, Geometry, Transform)>, String> {
        let table = Table::from_step(text)
            .ok_or_else(|| "STEP parse failed: no data section".to_string())?;
        let assy = table
            .step_assy()
            .map_err(|e| format!("STEP assembly failed: {e}"))?;

        let mut entities = Vec::new();
        for top in assy.top_nodes() {
            for path in assy.paths_iter(top.index()) {
                let ent = path.terminal_node().entity();
                let name = if ent.attrs.name.is_empty() {
                    ent.attrs.id.clone()
                } else {
                    ent.attrs.name.clone()
                };
                let mut placement = truck_base::cgmath64::One::one();
                for edge in path.edges() {
                    let m = truck_base::cgmath64::Matrix4::try_from(&edge.entity().matrix)
                        .unwrap_or_else(|_| truck_base::cgmath64::One::one());
                    placement = placement * m;
                }
                let mut positions: Vec<[f64; 3]> = Vec::new();
                let mut indices: Vec<u32> = Vec::new();
                let mut push_mesh = |mesh: &truck_polymesh::PolygonMesh| {
                    let vertex_count = (positions.len() / 3) as u32;
                    let (pos, idx) = polygon_to_mesh_data(mesh);
                    indices.extend(idx.iter().map(|i| i + vertex_count));
                    positions.extend(pos);
                };
                for shape in ent.shape.iter() {
                    let shells: Vec<&CompressedShell<Point3, StepCurve, StepSurface>> = match shape
                    {
                        ProductShape::Solid(solid) => solid.boundaries.iter().collect(),
                        ProductShape::Shells(shells) => shells.iter().collect(),
                        ProductShape::Matrix(_) => continue,
                    };
                    for shell in shells {
                        let bdd = shell.triangulation(0.01).to_polygon().bounding_box();
                        let tol = if bdd.diameter() > 1e-6 {
                            bdd.diameter() * 0.001
                        } else {
                            0.01
                        };
                        let meshed = shell.robust_triangulation(tol).to_polygon();
                        let transformed = transform_polygon(&meshed, &placement);
                        push_mesh(&transformed);
                    }
                }
                if indices.is_empty() {
                    continue;
                }
                entities.push((
                    if name.is_empty() {
                        "STEP".to_owned()
                    } else {
                        name
                    },
                    Geometry::ImportedMesh { positions, indices },
                    Transform::default(),
                ));
            }
        }
        if entities.is_empty() {
            return Err("STEP file contains no solids".into());
        }
        Ok(entities)
    }
}

/// Apply a placement matrix to all positions of a polygon mesh.
fn transform_polygon(
    polygon: &truck_polymesh::PolygonMesh,
    matrix: &truck_base::cgmath64::Matrix4,
) -> truck_polymesh::PolygonMesh {
    let mut out = polygon.clone();
    out.positions_mut()
        .iter_mut()
        .for_each(|p| *p = matrix.transform_point(*p));
    out
}

/// PolygonMesh -> indexed mesh data (fan-triangulated polygons).
fn polygon_to_mesh_data(polygon: &truck_polymesh::PolygonMesh) -> (Vec<[f64; 3]>, Vec<u32>) {
    let positions: Vec<[f64; 3]> = polygon
        .positions()
        .iter()
        .map(|p| [p.x, p.y, p.z])
        .collect();
    let mut indices: Vec<u32> = Vec::new();
    let push_fan = |indices: &mut Vec<u32>, face: &[truck_polymesh::StandardVertex]| {
        if face.len() >= 3 {
            for i in 1..face.len() - 1 {
                indices.push(face[0].pos as u32);
                indices.push(face[i].pos as u32);
                indices.push(face[i + 1].pos as u32);
            }
        }
    };
    for face in polygon.faces().tri_faces() {
        push_fan(&mut indices, face);
    }
    for face in polygon.faces().quad_faces() {
        push_fan(&mut indices, face);
    }
    for face in polygon.faces().other_faces() {
        push_fan(&mut indices, face);
    }
    (positions, indices)
}

/// Export a solid to STEP text (AP-style header + B-rep entities).
pub fn export_solid(solid: &Solid, name: &str) -> Result<String, String> {
    let compressed = solid.compress();
    let repr = StepDesign::from_model(out::StepModel::from(&compressed));
    let step_string = out::StepDisplay::new(
        out::StepHeaderDescriptor {
            organization_system: name.to_owned(),
            ..Default::default()
        },
        repr,
    )
    .to_string();
    Ok(step_string)
}

/// Export every visible B-rep entity of the document as one STEP file
/// (multiple shapes are fused by boolean union; mesh-only payloads are
/// not representable and make the call fail).
pub fn export_document(doc: &crate::core::Document) -> Result<String, String> {
    let mut solids: Vec<Solid> = Vec::new();
    for e in doc.entities.values() {
        if !e.visible || e.locked {
            continue;
        }
        let solid = super::meshgen::payload_to_solid(&e.kind)?;
        let mat = super::convert::transform_to_cg_matrix(&e.transform);
        solids.push(solid.mapped(
            |p: &Point3| mat.transform_point(*p),
            |c| c.clone(),
            |s| s.clone(),
        ));
    }
    match solids.len() {
        0 => Err("nothing to export".into()),
        1 => export_solid(&solids[0], &doc.name),
        _ => {
            let compressed_solids: Vec<_> = solids.iter().map(|s| s.compress()).collect();
            let shells: Vec<_> = compressed_solids.iter().flat_map(|s| &s.boundaries).collect();
            let model: out::StepModel<_, _, _> = shells.into_iter().collect();
            let repr = StepDesign::from_model(model);
            let step_string = out::StepDisplay::new(
                out::StepHeaderDescriptor {
                    organization_system: doc.name.clone(),
                    ..Default::default()
                },
                repr,
            )
            .to_string();
            Ok(step_string)
        }
    }
}
