use std::collections::HashMap;

use arc_core::{Color, EntityId, Transform};

use crate::geometry_converter::{GeometryRegistry, TruckGeometry};
use crate::error::AdapterError;

/// Main adapter between arc-core and truck CAD kernel
pub struct ArcTruckAdapter {
    geometry_registry: GeometryRegistry,
    truck_kernel: Option<TruckKernelAdapter>,
    arc_kernel: Option<ArcCoreKernelAdapter>,
}

impl ArcTruckAdapter {
    /// Create a new adapter with dual-kernel support
    pub fn new() -> Self {
        let geometry_registry = GeometryRegistry::new();
        
        Self {
            geometry_registry,
            truck_kernel: Some(TruckKernelAdapter::new()),
            arc_kernel: Some(ArcCoreKernelAdapter::new()),
        }
    }
    
    /// Convert arc-core geometry to truck geometry
    pub fn convert_to_truck(&self, arc_geometry: &arc_core::Geometry) -> Result<TruckGeometry, AdapterError> {
        self.geometry_registry.convert(arc_geometry)
    }
    
    /// Convert truck geometry to arc-core
    pub fn convert_to_arc(&self, truck_geometry: &TruckGeometry) -> Result<arc_core::Geometry, AdapterError> {
        truck_geometry.to_arc_geometry()
    }
    
    /// Create an entity using the most appropriate kernel
    pub fn create_entity(
        &self,
        geometry: &arc_core::Geometry,
        name: String,
        transform: Transform,
    ) -> Result<EntityId, AdapterError> {
        // Prefer truck kernel if available and supported
        if let Some(ref truck_kernel) = self.truck_kernel {
            if truck_kernel.is_supported(geometry) {
                return truck_kernel.create_entity(geometry, name, transform);
            }
        }
        
        // Fall back to arc-core
        if let Some(ref arc_kernel) = self.arc_kernel {
            return arc_kernel.create_entity(geometry, name, transform);
        }
        
        Err(AdapterError::Unsupported("No kernel available for entity creation"))
    }
    
    /// Export entity to GLTF format using truck kernel
    pub fn export_gltf(&self, entity_id: EntityId) -> Result<String, AdapterError> {
        if let Some(ref truck_kernel) = self.truck_kernel {
            return truck_kernel.export_gltf(entity_id);
        }
        
        Err(AdapterError::Unsupported("Truck kernel not available for GLTF export"))
    }
    
    /// Check if a geometry type is supported by truck
    pub fn is_truck_supported(&self, geometry: &arc_core::Geometry) -> bool {
        self.geometry_registry.is_supported(geometry)
    }
}

/// Adapter for truck kernel operations
pub struct TruckKernelAdapter {
    // Internal state for truck kernel operations
}

impl TruckKernelAdapter {
    fn new() -> Self {
        Self {}
    }
    
    fn is_supported(&self, geometry: &arc_core::Geometry) -> bool {
        // Check if geometry can be converted to truck
        // This would use the geometry registry
        unimplemented!("Truck support check")
    }
    
    fn create_entity(
        &self,
        geometry: &arc_core::Geometry,
        name: String,
        transform: Transform,
    ) -> Result<EntityId, AdapterError> {
        unimplemented!("Entity creation in truck kernel")
    }
    
    fn export_gltf(&self, entity_id: EntityId) -> Result<String, AdapterError> {
        unimplemented!("GLTF export from truck kernel")
    }
}

/// Adapter for arc-core kernel operations
pub struct ArcCoreKernelAdapter {
    // Internal state for arc-core operations
}

impl ArcCoreKernelAdapter {
    fn new() -> Self {
        Self {}
    }
    
    fn create_entity(
        &self,
        geometry: &arc_core::Geometry,
        name: String,
        transform: Transform,
    ) -> Result<EntityId, AdapterError> {
        // Direct arc-core entity creation
        unimplemented!("Entity creation in arc-core kernel")
    }
}

/// Trait for geometry conversion capabilities
pub trait GeometryConverter {
    /// Convert arc-core geometry to a compatible format
    fn convert_to_compatible(&self, geometry: &arc_core::Geometry) -> Result<CompatibleGeometry, AdapterError>;
    
    /// Check if a geometry type is supported
    fn is_supported(&self, geometry: &arc_core::Geometry) -> bool;
    
    /// Get the name of this converter
    fn name(&self) -> &'static str;
}

/// Union type for compatible geometry representations
#[derive(Debug, Clone)]
pub enum CompatibleGeometry {
    /// Arc-core geometry (direct representation)
    ArcCore(arc_core::Geometry),
    /// Truck-compatible geometry (converted)
    Truck(TruckGeometry),
    /// Generic mesh data
    Mesh {
        positions: Vec<[f64; 3]>,
        indices: Vec<u32>,
        transform: Transform,
    },
}
