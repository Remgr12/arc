use std::result::Result;

use crate::core::entity::Geometry;
use crate::core::Transform;
use truck_stepio::r#in::{self as in_step, *};
use truck_stepio::r#in::convert::ProductShape;
use truck_modeling::Solid;

impl Geometry {
    /// STEP import into `(name, mesh payload, identity transform)`
    /// tuples (one per STEP product with a volume model).
    pub fn from_step_mesh(text: &str) -> Result<Vec<(String, Geometry, Transform)>, String> {
        let table = Table::from_step(&text)
            .ok_or_else(|| "STEP parse failed".to_string())?;
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
                let mut placement = Matrix4::identity();
                for edge in path.edges() {
                    let m = Matrix4::try_from(&edge.entity().matrix)
                        .unwrap_or_else(|_| Matrix4::identity());
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
                    let shells: Vec<_> = match shape {
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
                    if name.is_empty() { "STEP".to_owned() } else { name },
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

fn transform_polygon(
    polygon: &truck_polymesh::PolygonMesh,
    matrix: &Matrix4,
) -> truck_polymesh::PolygonMesh {
    let mut out = polygon.clone();
    out.positions_mut()
        .iter_mut()
        .for_each(|p| *p = matrix.transform_point(*p));
    out
}

fn polygon_to_mesh_data(
    polygon: &truck_polymesh::PolygonMesh,
) -> (Vec<[f64; 3]>, Vec<u32>) {
    let positions: Vec<[f64; 3]> = polygon
        .positions()
        .iter()
        .map(|p| [p.x, p.y, p.z])
        .collect();
    let mut indices: Vec<u32> = Vec::new();
    let push_fan = |indices: &mut Vec<u32>, face: &[_]| {
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

pub fn export_solid(solid: &Solid, name: &str) -> Result<String, String> {
    let mut table = Table::new();
    let compressed = truck_topology::compress::CompressedSolid::<Point3, truck_geometry::Curve3D, truck_geometry::Surface>::from(solid.boundaries().clone());
    let shell = CompressedShell::<Point3, truck_geometry::Curve3D, truck_geometry::Surface> {
        vertices: compressed.boundaries[0].vertices.clone(),
        edges: compressed.boundaries[0].edges.clone(),
        faces: compressed.boundaries[0].faces.clone(),
    };
    let step_solid = in_step::out::topology::manifold_solid_brep_from_compressed_shell(&table, &shell)
        .map_err(|e| format!("Failed to create STEP solid: {e}"))?;
    table.manifold_solid_brep.insert(1, step_solid);
    in_step::out::assy::write_table(&table, name)
        .map_err(|e| format!("Failed to write STEP: {e}"))
}

pub fn export_document(doc: &crate::core::Document) -> Result<String, String> {
    let solids: Vec<_> = doc
        .entities()
        .filter_map(|(_, geo)| match geo {
            Geometry::Solid(solid) => Some(solid.clone()),
            _ => None,
        })
        .collect();
    if solids.is_empty() {
        return Err("Document has no solids".into());
    }
    let fused = solids[0].clone();
    for solid in &solids[1..] {
        let fused_solid = truck_modeling::Solid::fuse(fused.clone(), solid.clone())
            .map_err(|e| format!("Failed to fuse solids: {e}"))?;
        let _ = fused_solid;
    }
    export_solid(&fused, "Document")
}
