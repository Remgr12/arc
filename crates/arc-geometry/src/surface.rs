use truck_modeling::*;
use truck_modeling::builder;
use std::result::Result;
use crate::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;
use crate::{GeometryId, GeometryType, Geometry, GeometryData, BoundingBox, Transform};
use crate::{CurveEntity, SolidEntity, FaceEntity, ShellEntity, MeshEntity, Polyline};

#[derive(Debug)]
pub struct SurfaceEntity {
    pub id: GeometryId,
    pub name: String,
    pub surface: Option<Box<dyn Geometry>>,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
    pub u_range: (f64, f64),
    pub v_range: (f64, f64),
}

impl Clone for SurfaceEntity {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            name: self.name.clone(),
            surface: self.surface.as_ref().map(|s| s.clone_box()),
            transform: self.transform,
            bounding_box: self.bounding_box,
            u_range: self.u_range,
            v_range: self.v_range,
        }
    }
}

impl SurfaceEntity {
    pub fn new(name: String, surface: Option<Box<dyn Geometry>>) -> Self {
        let bounds = surface.as_ref().map(|s| s.bounding_box()).unwrap_or(BoundingBox::empty());
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        
        Self {
            id: GeometryId::new(),
            name,
            surface,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn plane(origin: Point3, normal: Vector3, width: f64, height: f64) -> Self {
        let normal = nalgebra::Unit::new_normalize(normal);
        let x_axis = if normal.x.abs() > 0.9 {
            Vector3::new(0.0, 1.0, 0.0)
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };
        let x_axis = nalgebra::Unit::new_normalize(normal.cross(&x_axis));
        let y_axis = nalgebra::Unit::new_normalize(normal.cross(&*x_axis));
        
        let x_vec = *x_axis * width;
        let y_vec = *y_axis * height;
        
        Self {
            id: GeometryId::new(),
            name: "Plane".to_string(),
            surface: None,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::new(origin - x_vec - y_vec, origin + x_vec + y_vec),
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn cylinder(_origin: Point3, _axis: Vector3, _radius: f64, _height: f64) -> Self {
        Self {
            id: GeometryId::new(),
            name: "Cylinder".to_string(),
            surface: None,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn sphere(center: Point3, radius: f64) -> Self {
        let bbox_pt = nalgebra::Point3::new(center.x - radius, center.y - radius, center.z - radius);
        let bbox_max = nalgebra::Point3::new(center.x + radius, center.y + radius, center.z + radius);
        Self {
            id: GeometryId::new(),
            name: "Sphere".to_string(),
            surface: None,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::new(bbox_pt, bbox_max),
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn cone(_origin: Point3, _axis: Vector3, _radius: f64, _height: f64) -> Self {
        Self::sphere(_origin, _radius)
    }

    pub fn torus(_center: Point3, _axis: Vector3, _major_radius: f64, _minor_radius: f64) -> Self {
        let bbox_pt = nalgebra::Point3::new(
            _center.x - _major_radius - _minor_radius,
            _center.y - _major_radius - _minor_radius,
            _center.z - _major_radius - _minor_radius,
        );
        let bbox_max = nalgebra::Point3::new(
            _center.x + _major_radius + _minor_radius,
            _center.y + _major_radius + _minor_radius,
            _center.z + _major_radius + _minor_radius,
        );
        Self {
            id: GeometryId::new(),
            name: "Torus".to_string(),
            surface: None,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::new(bbox_pt, bbox_max),
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn bspline(_control_points: Vec<Vec<Point3>>, _u_knots: Vec<f64>, _v_knots: Vec<f64>, _u_degree: usize, _v_degree: usize) -> Self {
        Self {
            id: GeometryId::new(),
            name: "BSplineSurface".to_string(),
            surface: None,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn nurbs(_control_points: Vec<Vec<Point3>>, _weights: Vec<Vec<f64>>, _u_knots: Vec<f64>, _v_knots: Vec<f64>, _u_degree: usize, _v_degree: usize) -> Self {
        Self {
            id: GeometryId::new(),
            name: "NURBSSurface".to_string(),
            surface: None,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
            u_range: (0.0, 1.0),
            v_range: (0.0, 1.0),
        }
    }

    pub fn u_range(&self) -> (f64, f64) {
        self.u_range
    }

    pub fn v_range(&self) -> (f64, f64) {
        self.v_range
    }

    pub fn is_closed_u(&self) -> bool {
        false
    }

    pub fn is_closed_v(&self) -> bool {
        false
    }
}

impl Geometry for SurfaceEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Surface
    }

    fn name(&self) -> &str {
        &self.name
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
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Surface,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
    }
}

impl SurfaceEntity {
    fn update_bounding_box(&mut self) {
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}
