//! Boolean solid operations (CSG) on triangle soup meshes.
//!
//! `MeshBuffer` stores non-indexed triangles, which is exactly the input
//! format BSP-tree CSG implementations prefer. `boolean` consumes two
//! meshes and produces the combined result.

use crate::entity::CsgOperation;
use crate::mesh::MeshBuffer;

/// Placeholder implementation: union concatenates the two meshes (leaving
/// internal faces in place); difference and intersection are not yet
/// implemented and return an error. A full BSP-tree implementation will
/// replace this.
pub fn boolean(
    op: CsgOperation,
    a: &MeshBuffer,
    b: &MeshBuffer,
) -> Result<MeshBuffer, String> {
    match op {
        CsgOperation::Union => Ok(union_concat(a, b)),
        CsgOperation::Difference | CsgOperation::Intersection => {
            Err("CSG difference/intersection not yet implemented".to_string())
        }
    }
}

/// Simple union: concatenate positions and normals of both meshes.
fn union_concat(a: &MeshBuffer, b: &MeshBuffer) -> MeshBuffer {
    let mut positions = a.positions.clone();
    let mut normals = a.normals.clone();
    let mut lines = a.lines.clone();
    positions.extend_from_slice(&b.positions);
    normals.extend_from_slice(&b.normals);
    lines.extend_from_slice(&b.lines);
    MeshBuffer {
        positions,
        normals,
        lines,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meshgen;

    #[test]
    fn union_concatenates_triangles() {
        let a = meshgen::generate(&crate::entity::Geometry::Box {
            width: 10.0,
            depth: 10.0,
            height: 10.0,
            corner_radius: 0.0,
        })
        .unwrap();
        let b = meshgen::generate(&crate::entity::Geometry::Box {
            width: 10.0,
            depth: 10.0,
            height: 10.0,
            corner_radius: 0.0,
        })
        .unwrap();
        let result = boolean(CsgOperation::Union, &a, &b).unwrap();
        assert_eq!(result.tri_count(), a.tri_count() + b.tri_count());
    }

    #[test]
    fn unimplemented_ops_error() {
        let a = meshgen::generate(&crate::entity::Geometry::Box {
            width: 10.0,
            depth: 10.0,
            height: 10.0,
            corner_radius: 0.0,
        })
        .unwrap();
        let b = meshgen::generate(&crate::entity::Geometry::Box {
            width: 10.0,
            depth: 10.0,
            height: 10.0,
            corner_radius: 0.0,
        })
        .unwrap();
        assert!(boolean(CsgOperation::Difference, &a, &b).is_err());
        assert!(boolean(CsgOperation::Intersection, &a, &b).is_err());
    }
}
