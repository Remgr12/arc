//! Geometry kernel tests.

use arc_core::meshgen;
use arc_core::entity::Geometry;
use arc_core::mesh::{earclip_xz, polygon_signed_area_xz, ray_triangle};

fn max_winding_error(buf: &arc_core::MeshBuffer, reference: [f64; 3]) -> f64 {
    let faces = buf.positions.chunks(9).zip(buf.normals.chunks(9));
    let mut worst = 0.0f64;
    for (pos, nrm) in faces {
        let a = [pos[0] as f64, pos[1] as f64, pos[2] as f64];
        let b = [pos[3] as f64, pos[4] as f64, pos[5] as f64];
        let c = [pos[6] as f64, pos[7] as f64, pos[8] as f64];
        let n_attr = [nrm[0] as f64, nrm[1] as f64, nrm[2] as f64];
        let n_geo = arc_core::mesh::tri_normal(a, b, c);
        let dot = n_attr[0] * n_geo[0] + n_attr[1] * n_geo[1] + n_attr[2] * n_geo[2];
        worst = worst.max(1.0 - dot);
    }
    let _ = reference;
    worst
}

fn outward_check(kind: Geometry, center: [f64; 3]) -> bool {
    let buf = meshgen::generate(&kind).unwrap();
    // For convex-ish shapes every face normal should roughly agree with
    // (face center - shape center).
    for (pos, nrm) in buf.positions.chunks(9).zip(buf.normals.chunks(9)) {
        let a = [pos[0] as f64, pos[1] as f64, pos[2] as f64];
        let b = [pos[3] as f64, pos[4] as f64, pos[5] as f64];
        let c = [pos[6] as f64, pos[7] as f64, pos[8] as f64];
        let n = [nrm[0] as f64, nrm[1] as f64, nrm[2] as f64];
        let center_face = [
            (a[0] + b[0] + c[0]) / 3.0,
            (a[1] + b[1] + c[1]) / 3.0,
            (a[2] + b[2] + c[2]) / 3.0,
        ];
        let dir = [
            center_face[0] - center[0],
            center_face[1] - center[1],
            center_face[2] - center[2],
        ];
        let dot = n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2];
        let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
        if len > 1e-9 && dot < -1e-9 {
            return false;
        }
    }
    true
}

#[test]
fn box_winding_consistent() {
    let buf = meshgen::generate(&Geometry::Box { width: 10.0, depth: 10.0, height: 10.0, corner_radius: 0.0 }).unwrap();
    assert_eq!(buf.tri_count(), 12);
    assert!(max_winding_error(&buf, [0.0; 3]) < 1e-6, "box normals must match winding");
    assert!(outward_check(Geometry::Box { width: 10.0, depth: 10.0, height: 10.0, corner_radius: 0.0 }, [0.0; 3]));
}

#[test]
fn sphere_normals_outward() {
    let g = Geometry::Sphere { radius: 5.0, segments: 12 };
    assert!(outward_check(g, [0.0; 3]));
}

#[test]
fn cylinder_normals_outward() {
    let g = Geometry::Cylinder { radius: 5.0, height: 10.0, segments: 12 };
    assert!(outward_check(g, [0.0; 3]));
}

#[test]
fn cone_normals_outward() {
    let g = Geometry::Cone { radius: 5.0, height: 10.0, segments: 12 };
    assert!(outward_check(g, [0.0, 2.5, 0.0]));
}

#[test]
fn extrude_cap_triangulation() {
    let g = Geometry::Extrude {
        polygon: vec![[0.0, 0.0], [10.0, 0.0], [10.0, 8.0], [5.0, 12.0], [0.0, 8.0]],
        height: 4.0,
    };
    let buf = meshgen::generate(&g).unwrap();
    assert!(buf.tri_count() > 5);
    assert!(outward_check(g, [0.0; 3]));
}

#[test]
fn raycast_sphere_direct_hit() {
    let mut doc = arc_core::Document::new("test".into());
    let (id, res) = doc.add_entity(arc_core::Entity::new(
        arc_core::EntityId::new(),
        String::new(),
        doc.active_layer,
        Geometry::Sphere { radius: 50.0, segments: 24 },
    ));
    res.unwrap();
    arc_core::materialize_meshes(&mut doc);
    let hit = doc.raycast([0.0, 0.0, -500.0], [0.0, 0.0, 1.0], 1.0);
    assert!(hit.is_some(), "must hit sphere");
    let hit = hit.unwrap();
    assert_eq!(hit.entity_id, id);
    let d = (hit.distance - 449.0).abs();
    assert!(d < 1.5, "hit distance should be ~450 with sphere radius 50 (triangulated), got {}", hit.distance);
}

#[test]
fn raycast_miss() {
    let mut doc = arc_core::Document::new("test".into());
    doc.add_entity(arc_core::Entity::new(
        arc_core::EntityId::new(),
        String::new(),
        doc.active_layer,
        Geometry::Box { width: 10.0, depth: 10.0, height: 10.0, corner_radius: 0.0 },
    ))
    .1
    .unwrap();
    arc_core::materialize_meshes(&mut doc);
    let hit = doc.raycast([0.0, 100.0, -500.0], [0.0, 0.0, 1.0], 1.0);
    assert!(hit.is_none());
}

#[test]
fn earclip_handles_concave() {
    // Concave "U" polygon (as seen from +Y, CCW)
    let pts: Vec<[f64; 2]> = vec![
        [0.0, 0.0],
        [10.0, 0.0],
        [10.0, 10.0],
        [7.0, 10.0],
        [7.0, 4.0],
        [3.0, 4.0],
        [3.0, 10.0],
        [0.0, 10.0],
    ];
    assert!(polygon_signed_area_xz(&pts) > 0.0);
    let tris = earclip_xz(&pts);
    // every triangle must use valid indices
    for t in &tris {
        assert!(t.iter().all(|i| *i < pts.len()));
    }
    // area coverage: sum of triangle areas ≈ polygon area
    let poly_area = polygon_signed_area_xz(&pts).abs();
    let tri_area: f64 = tris
        .iter()
        .map(|t| {
            let a = pts[t[0]];
            let b = pts[t[1]];
            let c = pts[t[2]];
            0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).abs()
        })
        .sum();
    assert!((poly_area - tri_area).abs() < 1e-6, "triangulation must cover polygon: {} vs {}", poly_area, tri_area);
    //Triangles must not exceed the polygon significantly (containment simply via area)
    assert_eq!(tris.len(), pts.len() - 2);
}

#[test]
fn ray_triangle_hit() {
    let d = ray_triangle([0.0, 0.0, -5.0], [0.0, 0.0, 1.0], [-1.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]);
    assert!(d.is_some());
    assert!((d.unwrap() - 5.0).abs() < 1e-9);
}

#[test]
fn history_round_trip() {
    let mut doc = arc_core::Document::new("test".into());
    let (id, res) = doc.add_entity(arc_core::Entity::new(
        arc_core::EntityId::new(),
        String::new(),
        doc.active_layer,
        Geometry::Box { width: 1.0, depth: 1.0, height: 1.0, corner_radius: 0.0 },
    ));
    res.unwrap();
    doc.apply("delete", |d| {
        d.remove_entity(&id);
    });
    assert_eq!(doc.entities.len(), 0);
    assert!(doc.can_undo());
    doc.undo();
    assert_eq!(doc.entities.len(), 1);
    assert!(doc.can_redo());
    doc.redo();
    assert_eq!(doc.entities.len(), 0);
}

#[test]
fn persistence_round_trip() {
    let mut doc = arc_core::Document::new("roundtrip".into());
    doc.add_entity(arc_core::Entity::new(
        arc_core::EntityId::new(),
        "Sample".into(),
        doc.active_layer,
        Geometry::Torus { radius: 50.0, tube: 10.0, segments: 24, tubular_segments: 12 },
    ))
    .1
    .unwrap();
    let json = doc.save_string().unwrap();
    let doc2 = arc_core::Document::from_json(&json).unwrap();
    assert_eq!(doc2.name, "roundtrip");
    assert_eq!(doc2.entities.len(), 1);
    let entity = doc2.entities.values().next().unwrap();
    match &entity.kind {
        Geometry::Torus { radius, tube, .. } => {
            assert!((radius - 50.0).abs() < 1e-9 && (tube - 10.0).abs() < 1e-9);
        }
        _ => panic!("kind did not survive serialization"),
    }
}
