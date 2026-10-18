//! Constraint system tests.

use arc_core::constraints::{ConstraintSystem, Constraint, ConstraintType, ConstraintExpression, GeometryParameter};
use arc_core::entity::Geometry;

fn default_box() -> Geometry {
    Geometry::Box { width: 10.0, depth: 10.0, height: 10.0, corner_radius: 0.0 }
}

fn default_sphere() -> Geometry {
    Geometry::Sphere { radius: 5.0, segments: 12 }
}

#[test]
fn constraint_creation() {
    let mut system = ConstraintSystem::new();
    let entity1_id = 1u64;
    let entity2_id = 2u64;

    let constraint = Constraint::new(
        0,
        ConstraintType::Equal,
        ConstraintExpression::GeometryParameter {
            entity_id: entity1_id,
            parameter: GeometryParameter::BoxWidth,
        },
        Some(ConstraintExpression::GeometryParameter {
            entity_id: entity2_id,
            parameter: GeometryParameter::BoxWidth,
        }),
        1e-9,
    );

    let constraint_id = system.add_constraint(constraint);
    assert!(constraint_id > 0);
}

#[test]
fn constraint_system_has_dirty_entities() {
    let system = ConstraintSystem::new();
    assert!(!system.has_dirty_entities());
}

#[test]
fn constraint_update_entity() {
    let mut system = ConstraintSystem::new();
    let entity_id = 1u64;
    let entity = arc_core::Entity::new(
        arc_core::EntityId::nil(),
        "Test Box".to_string(),
        arc_core::EntityId::nil(),
        default_box(),
    );

    system.update_entity(entity_id, &entity);
    assert!(system.has_dirty_entities());
    system.clear_dirty(entity_id);
    assert!(!system.has_dirty_entities());
}

#[test]
fn constraint_solve() {
    let mut system = ConstraintSystem::new();
    let entity1_id = 1u64;
    let entity2_id = 2u64;

    let constraint = Constraint::new(
        0,
        ConstraintType::Equal,
        ConstraintExpression::GeometryParameter {
            entity_id: entity1_id,
            parameter: GeometryParameter::SphereRadius,
        },
        Some(ConstraintExpression::GeometryParameter {
            entity_id: entity2_id,
            parameter: GeometryParameter::SphereRadius,
        }),
        1e-9,
    );

    system.add_constraint(constraint);

    let entity1 = arc_core::Entity::new(
        arc_core::EntityId::nil(),
        "Sphere 1".to_string(),
        arc_core::EntityId::nil(),
        default_sphere(),
    );
    let entity2 = arc_core::Entity::new(
        arc_core::EntityId::nil(),
        "Sphere 2".to_string(),
        arc_core::EntityId::nil(),
        default_sphere(),
    );

    system.update_entity(entity1_id, &entity1);
    system.update_entity(entity2_id, &entity2);

    let result = system.solve();
    assert!(result.is_ok());
}

