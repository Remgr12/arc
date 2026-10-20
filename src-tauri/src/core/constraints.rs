//! Parametric constraint system.
//!
//! Constraints relate scalar parameters of entities (dimensions, positions,
//! angles) through expressions. The solver propagates values between linked
//! parameters and reports violations that cannot be resolved by simple
//! propagation.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::core::entity::Geometry;

/// Kind of relationship enforced between the two sides of a constraint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConstraintType {
    /// Both sides must evaluate to the same value.
    Equal,
    /// Entities must be parallel (same orientation axis).
    Parallel,
    /// Entities must be perpendicular.
    Perpendicular,
    /// Distance between the two entities must equal the right-hand value.
    Distance,
    /// Distance must be less than or equal to the right-hand value.
    LessThanOrEqual,
    /// Distance must be greater than or equal to the right-hand value.
    GreaterThanOrEqual,
    /// Angle between entities must equal the right-hand value (degrees).
    Angle,
    /// Entities must share a coordinate axis (aligned).
    Align,
}

/// A single scalar parameter of an entity's geometry or transform.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GeometryParameter {
    BoxWidth,
    BoxDepth,
    BoxHeight,
    BoxCornerRadius,
    SphereRadius,
    CylinderRadius,
    CylinderHeight,
    ConeRadius,
    ConeHeight,
    TorusRadius,
    TorusTube,
    PlaneWidth,
    PlaneDepth,
    CircleRadius,
    RectangleWidth,
    RectangleDepth,
    PolygonRadius,
    ExtrudeHeight,
    RevolveAngle,
    SweepRadius,
    LoftSectionCount,
    WallWidth,
    WallHeight,
    StairRise,
    StairRun,
    StairCount,
    SlabHeight,
    RoofPitch,
    ColumnRadius,
    ColumnHeight,
    BeamLength,
    BeamWidth,
    BeamHeight,
    DoorWidth,
    DoorHeight,
    WindowWidth,
    WindowHeight,
    PositionX,
    PositionY,
    PositionZ,
    ScaleX,
    ScaleY,
    ScaleZ,
}

impl GeometryParameter {
    /// Human-readable name used in solver diagnostics.
    pub fn label(&self) -> &'static str {
        match self {
            GeometryParameter::BoxWidth => "box width",
            GeometryParameter::BoxDepth => "box depth",
            GeometryParameter::BoxHeight => "box height",
            GeometryParameter::BoxCornerRadius => "box corner radius",
            GeometryParameter::SphereRadius => "sphere radius",
            GeometryParameter::CylinderRadius => "cylinder radius",
            GeometryParameter::CylinderHeight => "cylinder height",
            GeometryParameter::ConeRadius => "cone radius",
            GeometryParameter::ConeHeight => "cone height",
            GeometryParameter::TorusRadius => "torus radius",
            GeometryParameter::TorusTube => "torus tube",
            GeometryParameter::PlaneWidth => "plane width",
            GeometryParameter::PlaneDepth => "plane depth",
            GeometryParameter::CircleRadius => "circle radius",
            GeometryParameter::RectangleWidth => "rectangle width",
            GeometryParameter::RectangleDepth => "rectangle depth",
            GeometryParameter::PolygonRadius => "polygon radius",
            GeometryParameter::ExtrudeHeight => "extrude height",
            GeometryParameter::RevolveAngle => "revolve angle",
            GeometryParameter::SweepRadius => "sweep radius",
            GeometryParameter::LoftSectionCount => "loft section count",
            GeometryParameter::WallWidth => "wall width",
            GeometryParameter::WallHeight => "wall height",
            GeometryParameter::StairRise => "stair rise",
            GeometryParameter::StairRun => "stair run",
            GeometryParameter::StairCount => "stair count",
            GeometryParameter::SlabHeight => "slab height",
            GeometryParameter::RoofPitch => "roof pitch",
            GeometryParameter::ColumnRadius => "column radius",
            GeometryParameter::ColumnHeight => "column height",
            GeometryParameter::BeamLength => "beam length",
            GeometryParameter::BeamWidth => "beam width",
            GeometryParameter::BeamHeight => "beam height",
            GeometryParameter::DoorWidth => "door width",
            GeometryParameter::DoorHeight => "door height",
            GeometryParameter::WindowWidth => "window width",
            GeometryParameter::WindowHeight => "window height",
            GeometryParameter::PositionX => "position x",
            GeometryParameter::PositionY => "position y",
            GeometryParameter::PositionZ => "position z",
            GeometryParameter::ScaleX => "scale x",
            GeometryParameter::ScaleY => "scale y",
            GeometryParameter::ScaleZ => "scale z",
        }
    }

    /// Extract the current value of this parameter from geometry, if it
    /// applies to the given variant.
    pub fn value_of(geometry: &Geometry) -> impl Iterator<Item = (GeometryParameter, f64)> {
        let pairs: Vec<(GeometryParameter, f64)> = match geometry {
            Geometry::Box { width, depth, height, corner_radius } => vec![
                (GeometryParameter::BoxWidth, *width),
                (GeometryParameter::BoxDepth, *depth),
                (GeometryParameter::BoxHeight, *height),
                (GeometryParameter::BoxCornerRadius, *corner_radius),
            ],
            Geometry::Sphere { radius, .. } => vec![(GeometryParameter::SphereRadius, *radius)],
            Geometry::Cylinder { radius, height, .. } => vec![
                (GeometryParameter::CylinderRadius, *radius),
                (GeometryParameter::CylinderHeight, *height),
            ],
            Geometry::Cone { radius, height, .. } => vec![
                (GeometryParameter::ConeRadius, *radius),
                (GeometryParameter::ConeHeight, *height),
            ],
            Geometry::Torus { radius, tube, .. } => vec![
                (GeometryParameter::TorusRadius, *radius),
                (GeometryParameter::TorusTube, *tube),
            ],
            Geometry::Plane { width, depth } => vec![
                (GeometryParameter::PlaneWidth, *width),
                (GeometryParameter::PlaneDepth, *depth),
            ],
            Geometry::CircleCurve { radius, .. } => vec![(GeometryParameter::CircleRadius, *radius)],
            Geometry::RectangleCurve { width, depth } => vec![
                (GeometryParameter::RectangleWidth, *width),
                (GeometryParameter::RectangleDepth, *depth),
            ],
            Geometry::PolygonCurve { radius, .. } => vec![(GeometryParameter::PolygonRadius, *radius)],
            Geometry::Extrude { height, .. } => vec![(GeometryParameter::ExtrudeHeight, *height)],
            Geometry::Revolve { angle_deg, .. } => vec![(GeometryParameter::RevolveAngle, *angle_deg)],
            Geometry::Sweep { radius, .. } => vec![(GeometryParameter::SweepRadius, *radius)],
            Geometry::Loft { sections } => {
                vec![(GeometryParameter::LoftSectionCount, sections.len() as f64)]
            }
            Geometry::Wall { width, height, .. } => vec![
                (GeometryParameter::WallWidth, *width),
                (GeometryParameter::WallHeight, *height),
            ],
            Geometry::Stair { rise, run, count, .. } => vec![
                (GeometryParameter::StairRise, *rise),
                (GeometryParameter::StairRun, *run),
                (GeometryParameter::StairCount, *count as f64),
            ],
            Geometry::Slab { height, .. } => vec![(GeometryParameter::SlabHeight, *height)],
            Geometry::Roof { pitch_deg, .. } => vec![(GeometryParameter::RoofPitch, *pitch_deg)],
            Geometry::Column { radius, height, .. } => vec![
                (GeometryParameter::ColumnRadius, *radius),
                (GeometryParameter::ColumnHeight, *height),
            ],
            Geometry::Beam { length, width, height } => vec![
                (GeometryParameter::BeamLength, *length),
                (GeometryParameter::BeamWidth, *width),
                (GeometryParameter::BeamHeight, *height),
            ],
            Geometry::Door { width, height, .. } => vec![
                (GeometryParameter::DoorWidth, *width),
                (GeometryParameter::DoorHeight, *height),
            ],
            Geometry::Window { width, height, .. } => vec![
                (GeometryParameter::WindowWidth, *width),
                (GeometryParameter::WindowHeight, *height),
            ],
            _ => Vec::new(),
        };
        pairs.into_iter()
    }
}

/// One side of a constraint: either a parameter of some entity or a
/// constant value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConstraintExpression {
    GeometryParameter {
        entity_id: u64,
        parameter: GeometryParameter,
    },
    Constant(f64),
}

impl ConstraintExpression {
    /// Evaluate against the cached parameter values.
    fn evaluate(&self, values: &ValueCache) -> Option<f64> {
        match self {
            ConstraintExpression::Constant(v) => Some(*v),
            ConstraintExpression::GeometryParameter { entity_id, parameter } => values
                .get(&(*entity_id, *parameter))
                .copied(),
        }
    }

    fn entity(&self) -> Option<u64> {
        match self {
            ConstraintExpression::GeometryParameter { entity_id, .. } => Some(*entity_id),
            ConstraintExpression::Constant(_) => None,
        }
    }
}

/// A single declared relationship between two expressions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Constraint {
    pub id: u64,
    pub kind: ConstraintType,
    pub lhs: ConstraintExpression,
    pub rhs: Option<ConstraintExpression>,
    pub tolerance: f64,
}

impl Constraint {
    pub fn new(
        id: u64,
        kind: ConstraintType,
        lhs: ConstraintExpression,
        rhs: Option<ConstraintExpression>,
        tolerance: f64,
    ) -> Self {
        Self {
            id,
            kind,
            lhs,
            rhs,
            tolerance: if tolerance > 0.0 { tolerance } else { 1e-6 },
        }
    }

    /// Constraint summary used in diagnostics and the UI.
    pub fn describe(&self) -> String {
        let rhs = self
            .rhs
            .as_ref()
            .map(|e| e.describe())
            .unwrap_or_else(|| "none".to_string());
        format!("{:?} {} == {}", self.kind, self.lhs.describe(), rhs)
    }
}

impl ConstraintExpression {
    pub fn describe(&self) -> String {
        match self {
            ConstraintExpression::Constant(v) => format!("{v}"),
            ConstraintExpression::GeometryParameter { entity_id, parameter } => {
                format!("e{entity_id}.{}", parameter.label())
            }
        }
    }
}

/// Cached parameter values keyed by (entity, parameter).
type ValueCache = HashMap<(u64, GeometryParameter), f64>;

/// Solvable set of constraints with a per-entity dirty tracker.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ConstraintSystem {
    constraints: Vec<Constraint>,
    next_id: u64,
    values: ValueCache,
    dirty: HashSet<u64>,
}

impl ConstraintSystem {
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a constraint; returns its runtime id (always > 0).
    pub fn add_constraint(&mut self, constraint: Constraint) -> u64 {
        self.next_id += 1;
        let id = self.next_id;
        let mut stored = constraint;
        stored.id = id;
        self.constraints.push(stored);
        id
    }

    pub fn remove_constraint(&mut self, id: u64) -> bool {
        let before = self.constraints.len();
        self.constraints.retain(|c| c.id != id);
        self.constraints.len() != before
    }

    pub fn constraints(&self) -> &[Constraint] {
        &self.constraints
    }

    pub fn has_dirty_entities(&self) -> bool {
        !self.dirty.is_empty()
    }

    /// Absorb an entity's current parameter values and mark it dirty.
    pub fn update_entity(&mut self, entity_id: u64, entity: &crate::core::Entity) {
        for (parameter, value) in GeometryParameter::value_of(&entity.kind) {
            self.values.insert((entity_id, parameter), value);
        }
        let t = &entity.transform;
        self.values.insert((entity_id, GeometryParameter::PositionX), t.position[0]);
        self.values.insert((entity_id, GeometryParameter::PositionY), t.position[1]);
        self.values.insert((entity_id, GeometryParameter::PositionZ), t.position[2]);
        self.values.insert((entity_id, GeometryParameter::ScaleX), t.scale[0]);
        self.values.insert((entity_id, GeometryParameter::ScaleY), t.scale[1]);
        self.values.insert((entity_id, GeometryParameter::ScaleZ), t.scale[2]);
        self.dirty.insert(entity_id);
    }

    pub fn clear_dirty(&mut self, entity_id: u64) {
        self.dirty.remove(&entity_id);
    }

    pub fn is_dirty(&self, entity_id: u64) -> bool {
        self.dirty.contains(&entity_id)
    }

    /// Run the solver: propagate equalities and validate every constraint.
    /// Returns an error naming the first unresolvable violation.
    pub fn solve(&mut self) -> Result<(), String> {
        // Equality propagation: values flow from the left side to the right
        // side for a bounded number of passes (handles simple chains).
        for _ in 0..8 {
            let mut changed = false;
            for constraint in &self.constraints {
                if constraint.kind != ConstraintType::Equal {
                    continue;
                }
                let Some(rhs) = constraint.rhs.as_ref() else {
                    continue;
                };
                let lhs_value = constraint.lhs.evaluate(&self.values);
                let rhs_value = rhs.evaluate(&self.values);
                match (lhs_value, rhs_value) {
                    (Some(l), Some(r)) if (l - r).abs() <= constraint.tolerance => {}
                    (Some(l), Some(_)) => {
                        if let Some(entity) = rhs.entity() {
                            if let ConstraintExpression::GeometryParameter { parameter, .. } = rhs {
                                self.values.insert((entity, *parameter), l);
                                self.dirty.insert(entity);
                                changed = true;
                            }
                        }
                    }
                    _ => {}
                }
            }
            if !changed {
                break;
            }
        }

        // Validate everything that could not be propagated.
        for constraint in &self.constraints {
            let Some(rhs) = constraint.rhs.as_ref() else {
                continue;
            };
            let (Some(l), Some(r)) = (constraint.lhs.evaluate(&self.values), rhs.evaluate(&self.values))
            else {
                // Missing values are allowed (entities not yet registered).
                continue;
            };
            let violated = match constraint.kind {
                ConstraintType::Equal => (l - r).abs() > constraint.tolerance,
                ConstraintType::Distance => (l - r).abs() > constraint.tolerance,
                ConstraintType::LessThanOrEqual => l > r + constraint.tolerance,
                ConstraintType::GreaterThanOrEqual => l < r - constraint.tolerance,
                // Orientation-style constraints are validated downstream where
                // entity orientations are known; treated as satisfied here.
                ConstraintType::Parallel
                | ConstraintType::Perpendicular
                | ConstraintType::Angle
                | ConstraintType::Align => false,
            };
            if violated {
                return Err(format!(
                    "constraint {} violated: {} vs {}",
                    constraint.id,
                    constraint.lhs.describe(),
                    rhs.describe()
                ));
            }
        }
        Ok(())
    }

    /// Number of constraints that reference parameters with no cached value.
    pub fn pending_count(&self) -> usize {
        self.constraints
            .iter()
            .filter(|c| {
                c.rhs.as_ref().is_some_and(|rhs| {
                    c.lhs.evaluate(&self.values).is_none() || rhs.evaluate(&self.values).is_none()
                })
            })
            .count()
    }
}
