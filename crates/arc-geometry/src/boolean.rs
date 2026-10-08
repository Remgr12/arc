use truck_topology::*;
use truck_modeling::*;
use crate::{SolidEntity, ShellEntity, FaceEntity, CurveEntity};

pub struct BooleanOps;

impl BooleanOps {
    pub fn union(a: &SolidEntity, b: &SolidEntity) -> Result<SolidEntity, String> {
        let mut result = a.solid.clone();
        result.union(&b.solid).map_err(|e| format!("Union failed: {:?}", e))?;
        Ok(SolidEntity::new("Union".to_string(), result))
    }

    pub fn union_many(solids: &[SolidEntity]) -> Result<SolidEntity, String> {
        if solids.is_empty() {
            return Err("No solids provided".to_string());
        }
        
        let mut result = solids[0].solid.clone();
        for solid in &solids[1..] {
            result.union(&solid.solid).map_err(|e| format!("Union failed: {:?}", e))?;
        }
        
        Ok(SolidEntity::new("Union".to_string(), result))
    }

    pub fn difference(a: &SolidEntity, b: &SolidEntity) -> Result<SolidEntity, String> {
        let mut result = a.solid.clone();
        result.difference(&b.solid).map_err(|e| format!("Difference failed: {:?}", e))?;
        Ok(SolidEntity::new("Difference".to_string(), result))
    }

    pub fn difference_many(a: &SolidEntity, tools: &[SolidEntity]) -> Result<SolidEntity, String> {
        let mut result = a.solid.clone();
        for tool in tools {
            result.difference(&tool.solid).map_err(|e| format!("Difference failed: {:?}", e))?;
        }
        Ok(SolidEntity::new("Difference".to_string(), result))
    }

    pub fn intersection(a: &SolidEntity, b: &SolidEntity) -> Result<SolidEntity, String> {
        let mut result = a.solid.clone();
        result.intersection(&b.solid).map_err(|e| format!("Intersection failed: {:?}", e))?;
        Ok(SolidEntity::new("Intersection".to_string(), result))
    }

    pub fn intersection_many(solids: &[SolidEntity]) -> Result<SolidEntity, String> {
        if solids.is_empty() {
            return Err("No solids provided".to_string());
        }
        
        let mut result = solids[0].solid.clone();
        for solid in &solids[1..] {
            result.intersection(&solid.solid).map_err(|e| format!("Intersection failed: {:?}", e))?;
        }
        
        Ok(SolidEntity::new("Intersection".to_string(), result))
    }

    pub fn split(solid: &SolidEntity, tool: &SolidEntity) -> Result<(SolidEntity, SolidEntity), String> {
        let intersection = Self::intersection(solid, tool)?;
        let difference_a = Self::difference(solid, tool)?;
        let difference_b = Self::difference(tool, solid)?;
        
        Ok((difference_a, difference_b))
    }

    pub fn split_by_face(solid: &SolidEntity, face: &FaceEntity) -> Result<(SolidEntity, SolidEntity), String> {
        let solid_a = solid.solid.clone();
        let solid_b = solid.solid.clone();
        
        let face_solid = SolidEntity::extrude(face, face.face.surface().unwrap().normal(0.5, 0.5).normalize(), 0.001);
        
        let part_a = Self::difference(solid, &face_solid)?;
        let part_b = Self::intersection(solid, &face_solid)?;
        
        Ok((part_a, part_b))
    }

    pub fn split_by_plane(solid: &SolidEntity, plane_origin: nalgebra::Point3<f64>, plane_normal: nalgebra::Vector3<f64>) -> Result<(SolidEntity, SolidEntity), String> {
        let plane = crate::SurfaceEntity::plane(plane_origin, plane_normal, 10000.0, 10000.0);
        let face = FaceEntity::from_surface(&plane, plane.u_range(), plane.v_range());
        Self::split_by_face(solid, &face)
    }

    pub fn imprint(solid: &SolidEntity, faces: &[FaceEntity]) -> Result<SolidEntity, String> {
        let mut result = solid.solid.clone();
        
        for face in faces {
            result.imprint(&face.face).map_err(|e| format!("Imprint failed: {:?}", e))?;
        }
        
        Ok(SolidEntity::new("Imprint".to_string(), result))
    }

    pub fn section(solid: &SolidEntity, plane_origin: nalgebra::Point3<f64>, plane_normal: nalgebra::Vector3<f64>) -> Result<Vec<CurveEntity>, String> {
        let plane = crate::SurfaceEntity::plane(plane_origin, plane_normal, 10000.0, 10000.0);
        let face = FaceEntity::from_surface(&plane, plane.u_range(), plane.v_range());
        
        let mut curves = Vec::new();
        for solid_face in solid.faces() {
            if let Some(surface) = solid_face.surface() {
                if let Some(intersections) = surface.intersection_with_surface(&plane.surface, 1e-6) {
                    for curve in intersections {
                        curves.push(CurveEntity::new("Section".to_string(), Box::new(curve)));
                    }
                }
            }
        }
        
        Ok(curves)
    }

    pub fn shell(solid: &SolidEntity, thickness: f64) -> Result<SolidEntity, String> {
        let hollowed = solid.solid.hollow(thickness).map_err(|e| format!("Shell failed: {:?}", e))?;
        Ok(SolidEntity::new("Shell".to_string(), hollowed))
    }

    pub fn offset_face(face: &FaceEntity, distance: f64) -> Result<FaceEntity, String> {
        let surface = face.surface().ok_or("Face has no surface")?;
        let offset_surface = surface.offset(distance).map_err(|e| format!("Offset failed: {:?}", e))?;
        
        let offset_face = FaceEntity::from_surface(
            &crate::SurfaceEntity::new("Offset".to_string(), Box::new(offset_surface)),
            face.face.surface().unwrap().u_range(),
            face.face.surface().unwrap().v_range(),
        );
        
        Ok(offset_face)
    }

    pub fn offset_solid(solid: &SolidEntity, distance: f64) -> Result<SolidEntity, String> {
        let mut result = solid.solid.clone();
        result.offset(distance).map_err(|e| format!("Offset solid failed: {:?}", e))?;
        Ok(SolidEntity::new("Offset".to_string(), result))
    }

    pub fn fillet(solid: &SolidEntity, edges: &[Edge], radius: f64) -> Result<SolidEntity, String> {
        let filleted = truck_fillet::fillet(&solid.solid, edges, radius).map_err(|e| format!("Fillet failed: {:?}", e))?;
        Ok(SolidEntity::new("Fillet".to_string(), filleted))
    }

    pub fn chamfer(solid: &SolidEntity, edges: &[Edge], distance: f64) -> Result<SolidEntity, String> {
        let chamfered = truck_fillet::chamfer(&solid.solid, edges, distance).map_err(|e| format!("Chamfer failed: {:?}", e))?;
        Ok(SolidEntity::new("Chamfer".to_string(), chamfered))
    }

    pub fn fillet_edges(solid: &SolidEntity, radius: f64) -> Result<SolidEntity, String> {
        let edges: Vec<_> = solid.edges().into_iter().cloned().collect();
        Self::fillet(solid, &edges, radius)
    }

    pub fn chamfer_edges(solid: &SolidEntity, distance: f64) -> Result<SolidEntity, String> {
        let edges: Vec<_> = solid.edges().into_iter().cloned().collect();
        Self::chamfer(solid, &edges, distance)
    }

    pub fn heal(solid: &SolidEntity) -> Result<SolidEntity, String> {
        let healed = truck_healing::heal(&solid.solid).map_err(|e| format!("Heal failed: {:?}", e))?;
        Ok(SolidEntity::new("Healed".to_string(), healed))
    }

    pub fn check_valid(solid: &SolidEntity) -> bool {
        solid.solid.is_valid()
    }

    pub fn validate_and_repair(solid: &SolidEntity) -> Result<SolidEntity, String> {
        if solid.solid.is_valid() {
            Ok(solid.clone())
        } else {
            Self::heal(solid)
        }
    }
}