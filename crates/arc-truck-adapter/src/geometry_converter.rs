use std::collections::HashMap;

use arc_core::{Geometry, CsgOperation};

use crate::error::AdapterError;

/// Registry mapping arc-core geometry types to conversion functions
#[derive(Debug, Clone)]
pub struct GeometryRegistry {
    converters: HashMap<&'static str, Arc<dyn Fn(&Geometry) -> Result<TruckGeometry, AdapterError>>>,
}

impl GeometryRegistry {
    /// Create a new registry with all standard converters registered
    pub fn new() -> Self {
        let mut converters: HashMap<&str, Arc<dyn Fn(&Geometry) -> Result<TruckGeometry, AdapterError>>> = 
            HashMap::new();

        // Register all supported converters
        converters.insert("Box", Arc::new(convert_box_to_truck));
        converters.insert("Sphere", Arc::new(convert_sphere_to_truck));
        converters.insert("Cylinder", Arc::new(convert_cylinder_to_truck));
        converters.insert("Cone", Arc::new(convert_cone_to_truck));
        converters.insert("Plane", Arc::new(convert_plane_to_truck));
        converters.insert("ImportedMesh", Arc::new(convert_mesh_to_truck));
        converters.insert("LineCurve", Arc::new(convert_line_to_truck));
        converters.insert("PolylineCurve", Arc::new(convert_polyline_to_truck));
        converters.insert("CircleCurve", Arc::new(convert_circle_to_truck));
        converters.insert("ArcCurve", Arc::new(convert_arc_to_truck));
        converters.insert("Extrude", Arc::new(convert_extrude_to_truck));
        converters.insert("Revolve", Arc::new(convert_revolve_to_truck));
        converters.insert("Sweep", Arc::new(convert_sweep_to_truck));
        converters.insert("Loft", Arc::new(convert_loft_to_truck));
        converters.insert("Wall", Arc::new(convert_wall_to_truck));
        converters.insert("Slab", Arc::new(convert_slab_to_truck));
        converters.insert("Roof", Arc::new(convert_roof_to_truck));
        converters.insert("Column", Arc::new(convert_column_to_truck));
        converters.insert("Beam", Arc::new(convert_beam_to_truck));
        converters.insert("NurbsSurface", Arc::new(convert_nurbs_surface_to_truck));
        converters.insert("Csg", Arc::new(convert_csg_to_truck));

        Self { converters }
    }

    /// Convert an arc-core geometry to a truck-compatible type
    pub fn convert(&self, arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
        // Get the geometry type tag
        let type_name = match arc_geometry {
            Geometry::Box { .. } => "Box",
            Geometry::Sphere { .. } => "Sphere",
            Geometry::Cylinder { .. } => "Cylinder",
            Geometry::Cone { .. } => "Cone",
            Geometry::Plane { .. } => "Plane",
            Geometry::ImportedMesh { .. } => "ImportedMesh",
            Geometry::LineCurve { .. } => "LineCurve",
            Geometry::PolylineCurve { .. } => "PolylineCurve",
            Geometry::CircleCurve { .. } => "CircleCurve",
            Geometry::ArcCurve { .. } => "ArcCurve",
            Geometry::Extrude { .. } => "Extrude",
            Geometry::Revolve { .. } => "Revolve",
            Geometry::Sweep { .. } => "Sweep",
            Geometry::Loft { .. } => "Loft",
            Geometry::Wall { .. } => "Wall",
            Geometry::Slab { .. } => "Slab",
            Geometry::Roof { .. } => "Roof",
            Geometry::Column { .. } => "Column",
            Geometry::Beam { .. } => "Beam",
            Geometry::NurbsSurface { .. } => "NurbsSurface",
            Geometry::Csg { .. } => "Csg",
            _ => return Err(AdapterError::UnsupportedType),
        };

        let converter = self.converters.get(type_name)
            .ok_or_else(|| AdapterError::UnsupportedType)?;

        converter(arc_geometry)
    }

    /// Check if a geometry type is supported
    pub fn is_supported(&self, geometry: &Geometry) -> bool {
        let type_name = match geometry {
            Geometry::Box { .. } => "Box",
            Geometry::Sphere { .. } => "Sphere",
            Geometry::Cylinder { .. } => "Cylinder",
            Geometry::Cone { .. } => "Cone",
            Geometry::Plane { .. } => "Plane",
            Geometry::ImportedMesh { .. } => "ImportedMesh",
            Geometry::LineCurve { .. } => "LineCurve",
            Geometry::PolylineCurve { .. } => "PolylineCurve",
            Geometry::CircleCurve { .. } => "CircleCurve",
            Geometry::ArcCurve { .. } => "ArcCurve",
            Geometry::Extrude { .. } => "Extrude",
            Geometry::Revolve { .. } => "Revolve",
            Geometry::Sweep { .. } => "Sweep",
            Geometry::Loft { .. } => "Loft",
            Geometry::Wall { .. } => "Wall",
            Geometry::Slab { .. } => "Slab",
            Geometry::Roof { .. } => "Roof",
            Geometry::Column { .. } => "Column",
            Geometry::Beam { .. } => "Beam",
            Geometry::NurbsSurface { .. } => "NurbsSurface",
            Geometry::Csg { .. } => "Csg",
            _ => return false,
        };

        self.converters.contains_key(type_name)
    }
}

/// Union type representing truck-compatible geometry
#[derive(Debug, Clone)]
pub enum TruckGeometry {
    Unsupported,
}

impl TruckGeometry {
    /// Convert truck geometry back to arc-core for compatibility
    pub fn to_arc_geometry(&self) -> Result<Geometry, AdapterError> {
        Err(AdapterError::Unsupported)
    }
}

// === Core Conversion Functions ===

fn convert_box_to_truck(arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
    match arc_geometry {
        Geometry::Box { width, depth, height, corner_radius } => {
            // Create a box using truck modeling
            let mut points = Vec::new();
            let w = width / 2.0;
            let d = depth / 2.0;
            let h = height / 2.0;

            // Add corners
            points.push([ -w, -d, -h]);
            points.push([ w, -d, -h]);
            points.push([ w, d, -h]);
            points.push([ -w, d, -h]);
            points.push([ -w, -d, h]);
            points.push([ w, -d, h]);
            points.push([ w, d, h]);
            points.push([ -w, d, h]);

            // This is a simplified conversion - in reality would use truck lofting
            // For now, just create a mesh
            Ok(TruckGeometry::Unsupported)
        }
        _ => Err(AdapterError::TypeMismatch),
    }
}

fn convert_sphere_to_truck(arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
    match arc_geometry {
        Geometry::Sphere { radius, segments } => {
            // Create a sphere using truck modeling
            let mut points = Vec::new();
            let segments = *segments as usize;

            for i in 0..segments {
                let theta = 2.0 * std::f64::consts::PI * (i as f64) / (segments as f64);
                for j in 0..(segments / 2) {
                    let phi = std::f64::consts::PI * (j as f64) / ((segments / 2) as f64);
                    let x = radius * phi.sin() * theta.cos();
                    let y = radius * phi.sin() * theta.sin();
                    let z = radius * phi.cos();
                    points.push([x, y, z]);
                }
            }

            // This is a simplified conversion - in reality would use truck lofting
            Ok(TruckGeometry::Unsupported)
        }
        _ => Err(AdapterError::TypeMismatch),
    }
}

fn convert_mesh_to_truck(arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
    match arc_geometry {
        Geometry::ImportedMesh { positions, indices } => {
            Ok(TruckGeometry::Unsupported)
        }
        _ => Err(AdapterError::TypeMismatch),
    }
}

fn convert_line_to_truck(arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
    match arc_geometry {
        Geometry::LineCurve { end } => {
            Ok(TruckGeometry::Unsupported)
        }
        _ => Err(AdapterError::TypeMismatch),
    }
}

fn convert_circle_to_truck(arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
    match arc_geometry {
        Geometry::CircleCurve { radius, segments } => {
            Ok(TruckGeometry::Unsupported)
        }
        _ => Err(AdapterError::TypeMismatch),
    }
}

fn convert_arc_to_truck(arc_geometry: &Geometry) -> Result<TruckGeometry, AdapterError> {
    match arc_geometry {
        Geometry::ArcCurve { radius, start_angle_deg, end_angle_deg, segments } => {
            Ok(TruckGeometry::Unsupported)
        }
        _ => Err(AdapterError::TypeMismatch),
    }
}

// === Conversion to Arc-core ===

fn convert_truck_curve_to_arc(curve: &std::any::Any) -> Result<Geometry, AdapterError> {
    // This is a placeholder - actual implementation would depend on truck types
    Err(AdapterError::Unsupported)
}

fn convert_truck_surface_to_arc(surface: &std::any::Any) -> Result<Geometry, AdapterError> {
    // This is a placeholder - actual implementation would depend on truck types
    Err(AdapterError::Unsupported)
}

fn convert_truck_solid_to_arc(solid: &std::any::Any) -> Result<Geometry, AdapterError> {
    // This is a placeholder - actual implementation would depend on truck types
    Err(AdapterError::Unsupported)
}

// ... Additional conversion functions would be implemented here ...
