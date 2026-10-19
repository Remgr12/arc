//! Migration strategy for transitioning from arc-core to truck CAD kernel
//!
//! This document outlines a phased migration approach that allows gradual
c//! adoption of truck while maintaining backward compatibility during transition.

# Migration Overview

The arc application currently depends heavily on `arc-core` for:
- **Geometry representation**: 40+ concrete types in `Geometry` enum
- **Entity management**: UUID-based document and entity model
- **Export/import formats**: STL, OBJ, GLTF, STEP, DXF
- **Advanced operations**: CSG, constraints, sheet metal, annotations
- **Document management**: History, layers, selection, raycasting

Truck provides:
- **Modular architecture**: Separate crates for geometry, topology, modeling
- **Trait-based API**: Abstract geometric operations
- **Modern foundations**: Built on Rust's type system and WebGPU

# Migration Strategy

## Phase 1: Foundation Adapter (Weeks 1-2)

### 1.1 Create Bridge Module
- Create `bridge.rs` in `src-tauri/` that handles truck-arc compatibility
- Implement `ArcCoreBridge` struct wrapping truck operations
- Provide `add_entity`, `export_gltf`, `raycast`, `csg_apply` adapters

### 1.2 Key Adaptations Required

```rust
// 1. Geometry Conversion
enum ArcCoreGeometry {
    Box { width: f64, depth: f64, height: f64 },
    Sphere { radius: f64, segments: u32 },
    // ... 38 more variants
}

enum TruckGeometry {
    Curve(BSplineCurve<cgmath::Point3<f64>>),
    Surface(BSplineSurface<cgmath::Point3<f64>>),
    Mesh { positions: Vec<[f64; 3]>, indices: Vec<u32> },
}

// Conversion function
fn convert_to_truck(arc: &ArcCoreGeometry) -> TruckGeometry;
fn convert_to_arc(truck: &TruckGeometry) -> ArcCoreGeometry;
```

### 1.3 Performance Considerations
- Buffer geometry conversions in background threads
- Use copy-on-write for large mesh data
- Cache converted geometries for repeated operations

## Phase 2: Core Migration (Weeks 3-6)

### 2.1 Critical Path Migration
Priority 1: Core functionality that cannot be disabled

1. **Export/Import Operations**
   - GLTF export (critical for web integration)
   - STL export (standard 3D printing)
   - OBJ export (industry standard)

2. **Basic Geometry Creation**
   - Box, Sphere, ImportedMesh
   - LineCurve, CircleCurve, ArcCurve
   - Extrude, Revolve primitives

3. **Entity Management**
   - Transform handling
   - Material system
   - Layer management

### 2.2 API Translation Layer
```rust
// Bridge that hides the implementation details
pub struct ArcCoreBridge {
    truck_kernel: TruckKernel,
    arc_core_fallback: bool,
}

impl ArcCoreBridge {
    // These maintain the same API as arc-core
    pub fn add_entity(&mut self, geometry: ArcCoreGeometry, name: String) -> EntityId;
    pub fn export_gltf(&self, entity_id: EntityId) -> Result<String, String>;
    pub fn raycast(&self, origin: [f64; 3], dir: [f64; 3], tolerance: f64) -> Option<RayHit>;
    
    // New truck-specific operations
    pub fn create_box(&mut self, width: f64, height: f64, depth: f64) -> EntityId;
    pub fn loft_surfaces(&mut self, surfaces: Vec<TruckGeometry>) -> EntityId;
}
```

### 2.3 Dual-Mode Operation
The bridge operates in hybrid mode:
- Use truck when available and supported
- Fall back to arc-core for unsupported types
- Gradually migrate as new features are implemented

## Phase 3: Advanced Features (Weeks 7-10)

### 3.1 Feature Parity
- **CSG Operations**: Translate boolean operations to truck modeling
- **Constraints**: Map to truck's optimization capabilities
- **Sheet Metal**: Custom implementation since truck has limited support
- **Annotations**: Maintain arc-core's annotation system

### 3.2 Performance Optimization
- **Lazy evaluation**: Defer geometry conversion until needed
- **Batch operations**: Process multiple entities together
- **Memory pooling**: Reuse allocated buffers
- **Parallel processing**: Use multi-threading for intensive operations

## Phase 4: Integration & Testing (Weeks 11-12)

### 4.1 Testing Strategy
```rust
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_export_gltf() {
        let mut bridge = ArcCoreBridge::new();
        let entity_id = bridge.create_box(10.0, 5.0, 2.0);
        let gltf = bridge.export_gltf(entity_id).expect("GLTF export failed");
        // Validate GLTF structure
    }
    
    #[test]
    fn test_raycast() {
        let mut bridge = ArcCoreBridge::new();
        let entity_id = bridge.create_sphere(5.0);
        let hit = bridge.raycast([0.0, 0.0, 0.0], [0.0, 0.0, 1.0], 0.001)
            .expect("Raycast failed");
        assert!(hit.distance < 5.0);
    }
}
```

### 4.2 Integration Tests
- **End-to-end workflow**: Import/export cycle
- **Plugin compatibility**: Ensure Lua plugins still work
- **Performance benchmarks**: Measure against original arc-core
- **Memory usage**: Verify no leaks

## Implementation Details

### 5.1 Geometry Conversion Implementation
```rust
// In geometry_converter.rs
pub struct GeometryConverter {
    truck_kernel: TruckKernel,
}

impl GeometryConverter {
    // Map each arc-core variant
    pub fn convert_box(&self, arc: BoxGeometry) -> TruckGeometry {
        let mut points = vec![
            [arc.width/2.0, arc.depth/2.0, arc.height/2.0],
            [-arc.width/2.0, arc.depth/2.0, arc.height/2.0],
            // ... more corners
        ];
        TruckGeometry::Mesh { positions: points, indices: vec![] }
    }
    
    pub fn convert_sphere(&self, arc: SphereGeometry) -> TruckGeometry {
        // Create sphere using truck's modeling primitives
        truck::modeling::create_sphere(arc.radius, arc.segments)
    }
}
```

### 5.2 File Format Adapters
```rust
// In format_adapters.rs
pub struct GLTFAdapters {
    truck_exporter: TruckGLTFExporter,
    arc_core_fallback: ArcCoreGLTFExporter,
}

impl GLTFAdapters {
    pub fn export(&self, entity: EntityId) -> Result<String, String> {
        // Try truck first
        if let Ok(gltf) = self.truck_exporter.export(entity) {
            return Ok(gltf);
        }
        
        // Fall back to arc-core
        self.arc_core_fallback.export(entity)
    }
}
```

## Build Configuration

### 6.1 Feature Flags
```toml
[features]
# Core truck functionality
features/truck = []

# Arc-core compatibility layer
features/arc-compat = ["truck"]

# Full migration mode
features/migrated = ["truck", "arc-compat"]

# Fallback mode (original behavior)
features/fallback = []
```

### 6.2 Conditional Compilation
```rust
#[cfg(feature = "truck")]
mod truck_bridge {
    use truck::topology::Solid;
    // Truck-specific implementations
}

#[cfg(not(feature = "truck"))]
mod truck_bridge {
    // Fallback to arc-core implementations
}
```

## Migration Timeline

### Week 1-2: Foundation
- Create adapter infrastructure
- Implement basic geometry converters
- Set up dual-mode testing

### Week 3-4: Core Operations
- Migrate GLTF/STL/OBJ export
- Implement basic entity creation
- Add raycasting support

### Week 5-6: Feature Migration
- Migrate CSG operations
- Add constraint system support
- Implement sheet metal operations

### Week 7-8: Advanced Features
- Migrate annotation system
- Optimize performance
- Add truck-specific capabilities

### Week 9-10: Integration
- Full integration testing
- Performance benchmarking
- Documentation updates

## Success Metrics

### 1. Functionality
- All original arc-core commands work through adapter
- No functionality loss during migration
- New truck features available

### 2. Performance
- Adapter overhead < 20%
- No memory leaks
- Reasonable conversion times (< 100ms for large models)

### 3. Compatibility
- All existing plugins work unchanged
- No breaking changes to public API
- Backward compatibility maintained

## Risk Assessment

### High Risk
- **Performance degradation**: Adapter adds overhead
- **Memory leaks**: New allocations in conversion code
- **Feature gaps**: Some arc-core features may not have truck equivalents

### Medium Risk
- **Build complexity**: Managing two kernels simultaneously
- **Testing coverage**: Need comprehensive tests for both systems
- **Documentation**: Need updated docs for new API

### Low Risk
- **Gradual migration**: Can phase in truck features
- **Fallback mode**: Can revert to arc-core for problematic conversions
- **Iterative development**: Test each feature incrementally

## Next Steps

1. **Immediate Actions**:
   - Create `bridge.rs` with basic adapter skeleton
   - Implement essential converters (Box, Sphere, Mesh)
   - Set up testing infrastructure

2. **Week 1**: Begin implementing core export/import adapters
3. **Week 2**: Add basic entity creation and manipulation
4. **Week 3-4**: Integrate with existing commands.rs
5. **Week 5-6**: Add CSG and constraint support
6. **Week 7-8**: Complete feature migration
7. **Week 9-10**: Final testing and optimization

This migration strategy allows us to leverage truck's modern architecture while preserving all existing functionality and maintaining backward compatibility throughout the transition process.
