use truck_geometry::*;
use truck_topology::*;
use nalgebra::{Point3, Vector3, Matrix4};
use crate::{GeometryId, GeometryType, Geometry, GeometryData};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct SurfaceEntity {
    pub id: GeometryId,
    pub name: String,
    pub surface: Box<dyn ParametricSurface3D>,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
    pub u_range: (f64, f64),
    pub v_range: (f64, f64),
}

impl SurfaceEntity {
    pub fn new(name: String, surface: Box<dyn ParametricSurface3D>) -> Self {
        let bounds = surface.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        
        let u_range = (surface.u_range().0, surface.u_range().1);
        let v_range = (surface.v_range().0, surface.v_range().1);
        
        Self {
            id: GeometryId::new(),
            name,
            surface,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
            u_range,
            v_range,
        }
    }

    pub fn plane(origin: Point3, normal: Vector3, width: f64, height: f64) -> Self {
        let x_axis = if normal.x.abs() > 0.9 {
            Vector3::new(0.0, 1.0, 0.0)
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };
        let x_axis = (normal.cross(&x_axis)).normalize();
        let y_axis = normal.cross(&x_axis).normalize();
        
        let surface = truck_geometry::Plane::new(origin, x_axis * width, y_axis * height);
        Self::new("Plane".to_string(), Box::new(surface))
    }

    pub fn cylinder(origin: Point3, axis: Vector3, radius: f64, height: f64) -> Self {
        let surface = truck_geometry::Cylinder::new(origin, axis, radius, height);
        Self::new("Cylinder".to_string(), Box::new(surface))
    }

    pub fn sphere(center: Point3, radius: f64) -> Self {
        let surface = truck_geometry::Sphere::new(center, radius);
        Self::new("Sphere".to_string(), Box::new(surface))
    }

    pub fn cone(origin: Point3, axis: Vector3, radius: f64, height: f64) -> Self {
        let surface = truck_geometry::Cone::new(origin, axis, radius, height);
        Self::new("Cone".to_string(), Box::new(surface))
    }

    pub fn torus(center: Point3, axis: Vector3, major_radius: f64, minor_radius: f64) -> Self {
        let surface = truck_geometry::Torus::new(center, axis, major_radius, minor_radius);
        Self::new("Torus".to_string(), Box::new(surface))
    }

    pub fn bspline(control_points: Vec<Vec<Point3>>, u_knots: Vec<f64>, v_knots: Vec<f64>, u_degree: usize, v_degree: usize) -> Self {
        let surface = truck_geometry::BSplineSurface::new(control_points, u_knots, v_knots, u_degree, v_degree);
        Self::new("BSplineSurface".to_string(), Box::new(surface))
    }

    pub fn nurbs(control_points: Vec<Vec<Point3>>, weights: Vec<Vec<f64>>, u_knots: Vec<f64>, v_knots: Vec<f64>, u_degree: usize, v_degree: usize) -> Self {
        let surface = truck_geometry::NurbsSurface::new(control_points, weights, u_knots, v_knots, u_degree, v_degree);
        Self::new("NURBSSurface".to_string(), Box::new(surface))
    }

    pub fn evaluate(&self, u: f64, v: f64) -> Point3 {
        self.surface.subs(u, v)
    }

    pub fn normal(&self, u: f64, v: f64) -> Vector3 {
        self.surface.normal(u, v).normalize()
    }

    pub fn derivative_u(&self, u: f64, v: f64) -> Vector3 {
        self.surface.uder(u, v)
    }

    pub fn derivative_v(&self, u: f64, v: f64) -> Vector3 {
        self.surface.vder(u, v)
    }

    pub fn u_range(&self) -> (f64, f64) {
        self.u_range
    }

    pub fn v_range(&self) -> (f64, f64) {
        self.v_range
    }

    pub fn is_closed_u(&self) -> bool {
        self.surface.is_u_closed()
    }

    pub fn is_closed_v(&self) -> bool {
        self.surface.is_v_closed()
    }
}

impl Geometry for SurfaceEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Surface
    }

    fn bounding_box(&self) -> crate::BoundingBox {
        self.bounding_box
    }

    fn transform(&self) -> crate::Transform {
        self.transform
    }

    fn set_transform(&mut self, transform: crate::Transform) {
        self.transform = transform;
        self.update_bounding_box();
    }

    fn apply_transform(&mut self, transform: crate::Transform) {
        let matrix = transform.to_matrix();
        let new_surface = self.surface.transformed(&matrix);
        self.surface = Box::new(new_surface);
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl SurfaceEntity {
    fn update_bounding_box(&mut self) {
        let bounds = self.surface.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type SurfaceRef = Arc<RwLock<SurfaceEntity>>;

#[derive(Debug, Clone)]
pub struct FaceEntity {
    pub id: GeometryId,
    pub name: String,
    pub face: Face,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl FaceEntity {
    pub fn new(name: String, face: Face) -> Self {
        let bounds = face.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        
        Self {
            id: GeometryId::new(),
            name,
            face,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
        }
    }

    pub fn from_surface(surface: &SurfaceEntity, u_range: (f64, f64), v_range: (f64, f64)) -> Self {
        let face = truck_modeling::builder::face_from_surface(&surface.surface, u_range, v_range);
        Self::new("Face".to_string(), face)
    }

    pub fn from_wire(wire: Wire, surface: Option<&SurfaceEntity>) -> Self {
        let face = if let Some(surf) = surface {
            truck_modeling::builder::face_from_surface(&surf.surface, surf.u_range, surf.v_range)
        } else {
            truck_modeling::builder::try_attach_plane(&[wire]).expect("Failed to create face from wire")
        };
        Self::new("Face".to_string(), face)
    }

    pub fn outer_wire(&self) -> &Wire {
        self.face.outer()
    }

    pub fn inner_wires(&self) -> &[Wire] {
        self.face.inner()
    }

    pub fn add_inner_wire(&mut self, wire: Wire) {
        self.face.add_boundary(wire);
        self.update_bounding_box();
    }

    pub fn surface(&self) -> Option<&dyn ParametricSurface3D> {
        self.face.surface().map(|s| s.as_ref())
    }
}

impl Geometry for FaceEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Face
    }

    fn bounding_box(&self) -> crate::BoundingBox {
        self.bounding_box
    }

    fn transform(&self) -> crate::Transform {
        self.transform
    }

    fn set_transform(&mut self, transform: crate::Transform) {
        self.transform = transform;
        self.update_bounding_box();
    }

    fn apply_transform(&mut self, transform: crate::Transform) {
        let matrix = transform.to_matrix();
        let new_face = self.face.transformed(&matrix);
        self.face = new_face;
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl FaceEntity {
    fn update_bounding_box(&mut self) {
        let bounds = self.face.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type FaceRef = Arc<RwLock<FaceEntity>>;