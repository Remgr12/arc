//! The geometry kernel of arc: ricosjp/truck (vendored B-rep + NURBS
//! CAD kernel) integrated into arc's parametric payload model.
//!
//! Module layout:
//! - [`meshgen`]  - payload (`crate::core::entity::Geometry`) ->
//!   `MeshBuffer` evaluation, backed by truck shape tessellation
//! - [`shapes`]   - payload -> truck `Solid` construction
//! - [`csg`]      - truck-shapeops booleans on constructed solids
//! - [`nurbs`]    - payload <-> truck NURBS marshalling
//! - [`convert`]  - cgmath <-> arc conversions, mesh buffer mapping
//! - [`step`]     - STEP import/export through `truck-stepio`
//!
//! Everything geometric at runtime flows through truck: there is no
//! other kernel in the application.

pub mod convert;
pub mod csg;
pub mod fillet;
pub mod meshgen;
pub mod nurbs;
pub mod shapes;
pub mod step;
