# Truck CAD Kernel Migration Plan

## Overview
This document outlines the migration from arc-core to truck CAD kernel. Given the significant architectural differences, this will be a phased migration with adapter layers to maintain backward compatibility.

## Current Architecture

### Arc-core
- **Monolithic domain-specific kernel**
- **40+ concrete geometry types** in enum (Box, Sphere, Extrude, etc.)
- **UUID-based entity management**
- **Transform-based approach**
- **Business-logic embedded** (constraints, sheet metal, CSG)

### Truck
- **Modular trait-based kernel**
- **Separate crates**: truck-geometry, truck-topology, truck-modeling, etc.
- **Pointer-based topology with IDs**
- **Mathematical primitive approach**
- **Pure geometry operations**

## Migration Strategy

Given the scope (40+ geometry variants in arc-core vs truck's modular architecture), I'll propose a **phased migration with minimal initial footprint**:

### Phase 1: Foundation & Critical Path (Week 1-2)
**Goal: Ensure existing functionality doesn't break while adding truck compatibility**

1. Create `arc-truck-adapter` crate in `/home/debian/repositories/arc/crates/arc-truck-adapter/`
2. Implement **mandatory adapters** for:
   - GLTF export/import (critical for UI integration)
   - STL export (standard 3D printing format)
   - OBJ export (industry standard)
3. Create **geometry conversion registry** that maps arc-core variants to truck equivalents
4. Set up dual-mode operation that:
   - Uses truck for exported formats when available
   - Falls back to arc-core for unsupported types

### Phase 2: Core Geometry Migration (Week 3-4)
**Goal: Migrate the most commonly used primitives while maintaining backward compatibility**

**Priority 1: Basic Primitives** (used in commands.rs)
- Box → truck modeling (equivalent to box)
- Sphere → truck modeling (sphere)
- ImportedMesh → truck mesh (direct mapping)
- LineCurve/Polyline → truck curve
- CircleCurve/ArcCurve → truck B-spline/NURBS
- Extrude/Sweep → truck loft/sweep

**Priority 2: Architecture Types** (used by plugin users)
- Wall, Slab, Roof → truck loft-based equivalents
- Column, Beam → truck primitive + loft

### Phase 3: Advanced Features (Week 5-6)
**Goal: Add support for complex features**

- NURBS operations → truck's native NURBS support
- CSG operations → truck's modeling tools
- Constraints → truck's optimization capabilities (if available)
- Sheet metal → custom arc-core implementations (truck has limited support)

### Phase 4: Optimization & Integration (Week 7-8)
**Goal: Performance, testing, and final polish**

- Performance profiling of adapter layer
- Comprehensive testing of all formats
- Memory usage analysis
- Integration testing with existing plugins

## Key Technical Challenges

### 1. Type System Mapping
```rust
// Arc-core: Enum-based
enum Geometry {
    Box { width: f64, depth: f64, height: f64 },
    Sphere { radius: f64 },
    NurbsSurface { /* ... */ },
}

// Truck: Trait-based with generics
pub trait Curve<P> where P: Point + ...
pub trait Surface<P> where P: Point + ...
```

**Solution**: Create adapter structs that implement traits and map to enum variants

### 2. Entity Model Differences
- **Arc-core**: Single entity model with UUIDs
- **Truck**: Topological system with VertexID, EdgeID, FaceID

**Solution**: Create `EntityFromTopology` converter that builds entities from truck topology

### 3. API Paradigm Shift
- **Arc-core**: Procedural, domain-specific builders
- **Truck**: Functional, mathematical composition

**Solution**: Implement builder adapters that mimic arc-core patterns while using truck underneath

## Implementation Details

### 1. Adapter Crate Structure
```
arc-adapter/
├── src/
│   ├── geometry/          // Geometry type converters
│   │   ├── arc_from_truck.rs    // Truck → Arc-core
│   │   └── truck_from_arc.rs    // Arc-core → Truck
│   ├── topology/          // Topology adapters
│   │   ├── entity_mapper.rs    // Vertex/Edge/Face → Entity
│   │   └── constraint_adaptor.rs
│   ├── core/              // Core adapter logic
│   │   ├── kernel.rs         // Main adapter entry point
│   │   └── registry.rs       // Type registry
│   └── traits/             // Compatibility traits
│       ├── truck_traits.rs   // Arc-core compatible traits
│       └── arc_traits.rs     // Truck compatible traits
└── Cargo.toml
```

### 2. Key Adapter Components

#### Geometry Adapter
```rust
pub struct GeometryAdapter {
    arc_geometry_registry: HashMap<String, Arc<dyn Fn(&TruckType) -> ArcCoreGeometry>>,
}

impl GeometryAdapter {
    pub fn new() -> Self {
        let mut registry = HashMap::new();
        
        // Register common conversions
        registry.insert("Box".to_string(), Arc::new(convert_box_from_truck));
        registry.insert("Sphere".to_string(), Arc::new(convert_sphere_from_truck));
        registry.insert("BSplineSurface".to_string(), Arc::new(convert_bspline_from_truck));
        
        Self { arc_geometry_registry: registry }
    }
    
    pub fn convert_truck_to_arc(&self, truck_type: &TruckType) -> ArcCoreGeometry {
        // Look up converter and apply
        let converter = self.arc_geometry_registry
            .get(truck_type.name())
            .ok_or_else(|| format!("No converter for {} type", truck_type.name()))?;
        converter(truck_type)
    }
}
```

#### Entity Mapper
```rust
pub struct EntityMapper {
    truck_kernel: truck::TruckKernel,
    arc_document: Arc<Document>,
}

impl EntityMapper {
    pub fn new(document: Arc<Document>) -> Self {
        Self {
            truck_kernel: truck::TruckKernel::new(),
            arc_document: document,
        }
    }
    
    pub fn from_truck_topology(&mut self, face: &Face<Point3, Curve, Surface>) -> Vec<EntityId> {
        // Create entities for each topological element
        let mut entity_ids = Vec::new();
        
        // Convert surface to entity
        let surface_entity = self.create_entity_from_surface(&face.surface());
        entity_ids.push(surface_entity.id);
        
        // Convert edges to entities
        for edge in face.boundaries().flat_iter() {
            let edge_entity = self.create_entity_from_edge(&edge);
            entity_ids.push(edge_entity.id);
        }
        
        entity_ids
    }
}
```

### 3. Integration Points

#### Command Layer
```rust
pub fn helpers_add_entity_adapted(
    app: &AppHandle,
    state: &SharedState,
    document_id: &str,
    geometry: &Json,
    name: Option<&str>,
) -> Result<String, String> {
    // Try truck first, fall back to arc-core
    let kind: Result<Geometry, _> = serde_json::from_value(geometry.clone());
    
    if let Ok(arc_geom) = kind {
        // Check if we have a truck-compatible converter
        if let Some(truck_geom) = geometry_adapter.arc_to_truck(&arc_geom) {
            // Use truck kernel to create entity
            let entity_id = truck_entity_manager.create_entity(truck_geom);
            let arc_entity = entity_mapper.to_arc_entity(entity_id);
            
            doc_mut(state, document_id, "Add", |doc| {
                doc.add_entity(arc_entity);
            })?;
            
            return Ok(entity_id.as_string());
        }
    }
    
    // Fall back to original arc-core logic
    helpers_add_entity_original(app, state, document_id, geometry, name)
}
```

#### Export/Import Adapters
```rust
pub struct ExportAdapter {
    arc_document: Arc<Document>,
    truck_geometry: truck::TruckGeometry,
}

impl ExportAdapter {
    pub fn export_gltf(&self) -> Result<String, String> {
        // Convert arc-core entities to truck-compatible format
        let truck_entities = self.convert_entities_to_truck();
        
        // Use truck's glTF exporter
        truck::export::export_gltf(&truck_entities)
    }
    
    fn convert_entities_to_truck(&self) -> Vec<truck::TruckEntity> {
        self.arc_document.entities.values()
            .filter_map(|entity| self.entity_to_truck(entity))
            .collect()
    }
    
    fn entity_to_truck(&self, entity: &Entity) -> Option<truck::TruckEntity> {
        match &entity.kind {
            Geometry::ImportedMesh { positions, indices } => {
                Some(truck::TruckEntity::Mesh {
                    positions: positions.clone(),
                    indices: indices.clone(),
                    transform: entity.transform,
                })
            }
            Geometry::Box { width, depth, height, corner_radius } => {
                // Use truck modeling to create box
                let box_geometry = truck::modeling::create_box(*width, *depth, *height, *corner_radius);
                Some(truck::TruckEntity::Geometry(box_geometry))
            }
            // Add more converters...
            _ => None, // Unsupported for now
        }
    }
}
```

## Migration Timeline

### Phase 1: Foundation (Weeks 1-2)
- [ ] Create adapter crate
- [ ] Document all geometry types and mappings
- [ ] Set up compatibility testing
- [ ] Implement basic bridge layer

### Phase 2: Geometry Core (Weeks 3-4)
- [ ] Implement BSpline/NURBS converters
- [ ] Implement curve/surface adapters
- [ ] Set up dual-mode operation
- [ ] Test basic shape creation

### Phase 3: Topology Integration (Weeks 5-6)
- [ ] Implement entity mapping from truck topology
- [ ] Add constraint system adapter
- [ ] Create sheet metal adapter
- [ ] Test CSG operations

### Phase 4: Application Features (Weeks 7-8)
- [ ] Implement all remaining geometry type adapters
- [ ] Complete export/import adapters
- [ ] Test full workflow
- [ ] Performance optimization

## Testing Strategy

### Compatibility Tests
1. **API Compatibility**: Ensure all arc-core commands work through adapter
2. **Feature Parity**: Verify all major features are preserved
3. **Performance**: Benchmark key operations
4. **Memory Usage**: Compare resource consumption

### Integration Tests
1. **End-to-end workflow**: Full import/export cycle
2. **Plugin compatibility**: Ensure Lua plugins still work
3. **Constraint solving**: Verify constraint system works
4. **Undo/redo**: Test history tracking

## Risk Assessment

### High Risk
- **API breakage**: Commands that directly call arc-core will break
- **Data corruption**: Geometry conversion errors
- **Performance degradation**: Adapter layer overhead

### Medium Risk
- **Memory leaks**: New allocations in adapter layer
- **Bug introduction**: Complex conversion logic
- **Build complexity**: Managing two kernels

### Low Risk
- **Gradual migration**: Can phase in truck features
- **Fallback mode**: Can revert to arc-core for problematic conversions
- **Iterative testing**: Can test incrementally

## Success Criteria

1. **All arc-core commands work** through adapter layer
2. **Feature parity**: No functionality loss
3. **Performance within 50%**: Adapter overhead acceptable
4. **Memory stable**: No leaks in production
5. **Build successful**: Full test suite passes

## Next Steps

1. **Week 1**: Create adapter crate skeleton and documentation
2. **Week 2**: Implement basic geometry converters
3. **Week 3**: Add truck kernel integration
4. **Week 4**: Begin topology mapping
5. **Week 5**: Complete adapter and start testing

This is a significant undertaking that requires careful planning and incremental testing. The adapter approach allows us to leverage truck's robustness while preserving arc-core's application-specific features and business logic.

## Dependencies

### Core Dependencies
- `arc-core`: Local crate (existing)
- `truck`: https://github.com/ricosjp/truck
- `truck-base`, `truck-geometry`, `truck-topology`, etc.

### Development Dependencies
- `cargo-expand`: For analyzing trait implementations
- `cargo-tree`: For dependency analysis
- `rustc-ap`: For AST introspection

## Build Commands

```bash
# Build adapter crate
cd arc-adapter
cargo build

# Run tests
cargo test

# Check for unused dependencies
cargo tree

# Generate documentation
cargo doc --open
```

## Monitoring & Maintenance

### Monitoring
- **Performance counters**: Track conversion times
- **Memory profiling**: Monitor adapter memory usage
- **Error rates**: Track conversion failures

### Maintenance
- **Automated tests**: Run on every PR
- **Documentation**: Keep adapter API updated
- **Refactoring**: Clean up unused converters periodically

This migration plan provides a structured approach to transitioning from arc-core to truck while minimizing risk and preserving existing functionality.
