//! Arc-to-Truck adapter
//! 
//! This crate provides bidirectional conversion between arc-core's monolithic
//! CAD kernel and truck's modular trait-based architecture. It enables seamless
//! interoperability while preserving existing functionality during migration.

use std::error::Error;

use arc_core::Geometry;

pub mod adapter;
pub mod error;
pub mod geometry_converter;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_adapter_creation() {
        let adapter = adapter::ArcTruckAdapter::new();
        assert!(adapter.geometry_registry.is_supported(&Geometry::Box {
            width: 1.0,
            depth: 1.0,
            height: 1.0,
            corner_radius: 0.0,
        }));
    }
}
