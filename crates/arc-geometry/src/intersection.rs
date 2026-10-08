use truck_topology::*;
use truck_geometry::*;
use nalgebra::{Point3, Vector3};
use crate::{CurveEntity, SurfaceEntity, SolidEntity, FaceEntity};

pub struct Intersection;

impl Intersection {
    pub fn curve_curve(a: &CurveEntity, b: &CurveEntity, tolerance: f64) -> Vec<Point3> {
        let mut results = Vec::new();
        
        if let Some(intersections) = a.curve.intersection(&b.curve, tolerance) {
            for t in intersections {
                results.push(a.curve.subs(t.0));
            }
        }
        
        results
    }

    pub fn curve_surface(curve: &CurveEntity, surface: &SurfaceEntity, tolerance: f64) -> Vec<Point3> {
        let mut results = Vec::new();
        
        if let Some(intersections) = curve.curve.intersection_with_surface(&surface.surface, tolerance) {
            for t in intersections {
                results.push(curve.curve.subs(t));
            }
        }
        
        results
    }

    pub fn surface_surface(a: &SurfaceEntity, b: &SurfaceEntity, tolerance: f64) -> Vec<CurveEntity> {
        let mut results = Vec::new();
        
        if let Some(curves) = a.surface.intersection_with_surface(&b.surface, tolerance) {
            for curve in curves {
                results.push(CurveEntity::new("Intersection".to_string(), Box::new(curve)));
            }
        }
        
        results
    }

    pub fn solid_solid(a: &SolidEntity, b: &SolidEntity) -> Vec<CurveEntity> {
        let mut results = Vec::new();
        
        for face_a in a.faces() {
            for face_b in b.faces() {
                if let Some(surface_a) = face_a.surface() {
                    if let Some(surface_b) = face_b.surface() {
                        if let Some(curves) = surface_a.intersection_with_surface(surface_b, 1e-6) {
                            for curve in curves {
                                results.push(CurveEntity::new("Intersection".to_string(), Box::new(curve)));
                            }
                        }
                    }
                }
            }
        }
        
        results
    }

    pub fn ray_solid(origin: Point3, direction: Vector3, solid: &SolidEntity) -> Vec<Point3> {
        let mut results = Vec::new();
        let ray = truck_geometry::Line::new(origin, origin + direction * 10000.0);
        
        for face in solid.faces() {
            if let Some(surface) = face.surface() {
                if let Some(intersections) = ray.intersection_with_surface(surface, 1e-6) {
                    for t in intersections {
                        let point = ray.subs(t);
                        if face.contains_point(point, 1e-6) {
                            results.push(point);
                        }
                    }
                }
            }
        }
        
        results
    }

    pub fn ray_face(origin: Point3, direction: Vector3, face: &FaceEntity) -> Option<Point3> {
        let ray = truck_geometry::Line::new(origin, origin + direction * 10000.0);
        
        if let Some(surface) = face.surface() {
            if let Some(intersections) = ray.intersection_with_surface(surface, 1e-6) {
                for t in intersections {
                    let point = ray.subs(t);
                    if face.face.contains_point(point, 1e-6) {
                        return Some(point);
                    }
                }
            }
        }
        
        None
    }

    pub fn ray_mesh(origin: Point3, direction: Vector3, mesh: &crate::MeshEntity) -> Option<(Point3, usize)> {
        let ray = truck_geometry::Line::new(origin, origin + direction * 10000.0);
        let mut closest_dist = f64::INFINITY;
        let mut closest_point = None;
        let mut closest_face = None;
        
        for (i, face) in mesh.mesh.faces().enumerate() {
            let plane = face.plane();
            let denom = direction.dot(&plane.normal);
            if denom.abs() < 1e-10 {
                continue;
            }
            
            let t = (plane.distance - origin.dot(&plane.normal)) / denom;
            if t < 0.0 {
                continue;
            }
            
            let point = origin + direction * t;
            
            if face.contains_point(point, 1e-6) {
                if t < closest_dist {
                    closest_dist = t;
                    closest_point = Some(point);
                    closest_face = Some(i);
                }
            }
        }
        
        closest_point.zip(closest_face)
    }

    pub fn bounding_boxes(a: &crate::BoundingBox, b: &crate::BoundingBox) -> bool {
        a.min.x <= b.max.x && a.max.x >= b.min.x &&
        a.min.y <= b.max.y && a.max.y >= b.min.y &&
        a.min.z <= b.max.z && a.max.z >= b.min.z
    }

    pub fn point_in_solid(point: Point3, solid: &SolidEntity, tolerance: f64) -> bool {
        let ray = truck_geometry::Line::new(point, point + Vector3::new(0.0, 0.0, 1.0) * 10000.0);
        let mut count = 0;
        
        for face in solid.faces() {
            if let Some(surface) = face.surface() {
                if let Some(intersections) = ray.intersection_with_surface(surface, tolerance) {
                    for t in intersections {
                        if t > tolerance {
                            let p = ray.subs(t);
                            if face.contains_point(p, tolerance) {
                                count += 1;
                            }
                        }
                    }
                }
            }
        }
        
        count % 2 == 1
    }

    pub fn curve_bounding_box(curve: &CurveEntity) -> crate::BoundingBox {
        curve.bounding_box()
    }

    pub fn surface_bounding_box(surface: &SurfaceEntity) -> crate::BoundingBox {
        surface.bounding_box()
    }

    pub fn solid_bounding_box(solid: &SolidEntity) -> crate::BoundingBox {
        solid.bounding_box()
    }

    pub fn project_point_to_surface(point: Point3, surface: &SurfaceEntity) -> Point3 {
        let (u, v) = surface.surface.parameter(point, None).unwrap_or((0.0, 0.0));
        surface.surface.subs(u, v)
    }

    pub fn project_point_to_solid(point: Point3, solid: &SolidEntity) -> Option<Point3> {
        let mut closest = None;
        let mut min_dist = f64::INFINITY;
        
        for face in solid.faces() {
            if let Some(surface) = face.surface() {
                let projected = Self::project_point_to_surface(point, &SurfaceEntity::new("".to_string(), Box::new(surface.clone())));
                let dist = (projected - point).norm();
                if dist < min_dist && face.contains_point(projected, 1e-6) {
                    min_dist = dist;
                    closest = Some(projected);
                }
            }
        }
        
        closest
    }

    pub fn distance_point_point(a: Point3, b: Point3) -> f64 {
        (a - b).norm()
    }

    pub fn distance_point_line(point: Point3, line_start: Point3, line_end: Point3) -> f64 {
        let line_vec = line_end - line_start;
        let point_vec = point - line_start;
        let line_len_sq = line_vec.norm_squared();
        
        if line_len_sq == 0.0 {
            return (point - line_start).norm();
        }
        
        let t = (point_vec.dot(&line_vec) / line_len_sq).clamp(0.0, 1.0);
        let closest = line_start + line_vec * t;
        (point - closest).norm()
    }

    pub fn distance_point_plane(point: Point3, plane_origin: Point3, plane_normal: Vector3) -> f64 {
        let n = plane_normal.normalize();
        (point - plane_origin).dot(&n).abs()
    }
}