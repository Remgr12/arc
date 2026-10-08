use crate::{Point3, Vector3};
use crate::{CurveEntity, SolidEntity, FaceEntity, ShellEntity, SurfaceEntity};
use crate::{GeometryId, GeometryType, Geometry};

pub struct Intersection;

impl Intersection {
    pub fn curve_curve(_a: &CurveEntity, _b: &CurveEntity, _tolerance: f64) -> Vec<Point3> {
        Vec::new()
    }

    pub fn curve_surface(_curve: &CurveEntity, _surface: &SurfaceEntity, _tolerance: f64) -> Vec<Point3> {
        Vec::new()
    }

    pub fn curve_face(_curve: &CurveEntity, _face: &FaceEntity, _tolerance: f64) -> Vec<Point3> {
        Vec::new()
    }

    pub fn ray_solid(_origin: Point3, _direction: Vector3, _solid: &SolidEntity) -> Vec<Point3> {
        Vec::new()
    }

    pub fn ray_face(_origin: Point3, _direction: Vector3, _face: &FaceEntity) -> Option<Point3> {
        None
    }

    pub fn ray_mesh(_origin: Point3, _direction: Vector3, _mesh: &crate::MeshEntity) -> Option<(Point3, usize)> {
        None
    }

    pub fn bounding_boxes(a: &crate::BoundingBox, b: &crate::BoundingBox) -> bool {
        a.min.x <= b.max.x && a.max.x >= b.min.x &&
        a.min.y <= b.max.y && a.max.y >= b.min.y &&
        a.min.z <= b.max.z && a.max.z >= b.min.z
    }

    pub fn point_in_solid(_point: Point3, _solid: &SolidEntity, _tolerance: f64) -> bool {
        false
    }

    pub fn project_point_to_surface(_point: Point3, _surface: &SurfaceEntity, _tolerance: f64) -> Point3 {
        _point
    }

    pub fn closest_points_on_curves(_a: &CurveEntity, _b: &CurveEntity) -> (Point3, Point3, f64) {
        (Point3::origin(), Point3::origin(), 0.0)
    }
}

pub struct ClosestPoint;

impl ClosestPoint {
    pub fn to_curve(_curve: &CurveEntity, _point: Point3, _tolerance: f64) -> Point3 {
        _point
    }

    pub fn to_surface(_surface: &SurfaceEntity, _point: Point3, _tolerance: f64) -> Point3 {
        _point
    }

    pub fn to_solid(_solid: &SolidEntity, _point: Point3, _tolerance: f64) -> Point3 {
        _point
    }

    pub fn to_face(_face: &FaceEntity, _point: Point3, _tolerance: f64) -> Point3 {
        _point
    }

    pub fn between_curves(_a: &CurveEntity, _b: &CurveEntity) -> (Point3, Point3, f64) {
        (Point3::origin(), Point3::origin(), 0.0)
    }

    pub fn project_on_plane(_point: Point3, _plane_origin: Point3, _plane_normal: Vector3) -> Point3 {
        _point
    }
}

pub struct Line;

impl Line {
    pub fn line_ray_cast(_origin: Point3, _direction: Vector3, _mesh: &crate::MeshEntity) -> Option<Point3> {
        None
    }
}

pub fn distance_point_to_point(a: Point3, b: Point3) -> f64 {
    (a - b).norm()
}

pub fn distance_point_to_curve(_point: Point3, _curve: &CurveEntity) -> f64 {
    0.0
}

pub fn distance_point_to_surface(_point: Point3, _surface: &SurfaceEntity) -> f64 {
    0.0
}

pub fn angle_between_vectors(a: Vector3, b: Vector3) -> f64 {
    let a_n = a.normalize();
    let b_n = b.normalize();
    a_n.dot(&b_n).acos()
}
