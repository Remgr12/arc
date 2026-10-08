use truck_geometry::*;
use truck_topology::*;
use nalgebra::{Point3, Vector3};
use crate::{GeometryId, GeometryType, Geometry, GeometryData};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct CurveEntity {
    pub id: GeometryId,
    pub name: String,
    pub curve: Box<dyn ParametricCurve3D>,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl CurveEntity {
    pub fn new(name: String, curve: Box<dyn ParametricCurve3D>) -> Self {
        let bounds = curve.bounding_box();
        let bbox = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        
        Self {
            id: GeometryId::new(),
            name,
            curve,
            transform: crate::Transform::identity(),
            bounding_box: bbox,
        }
    }

    pub fn line(start: Point3, end: Point3) -> Self {
        let curve = truck_geometry::Line::new(start, end);
        Self::new("Line".to_string(), Box::new(curve))
    }

    pub fn circle(center: Point3, normal: Vector3, radius: f64) -> Self {
        let circle = truck_geometry::Circle::new(center, normal, radius);
        Self::new("Circle".to_string(), Box::new(circle))
    }

    pub fn arc(center: Point3, normal: Vector3, radius: f64, start_angle: f64, end_angle: f64) -> Self {
        let arc = truck_geometry::Arc::new(center, normal, radius, start_angle, end_angle);
        Self::new("Arc".to_string(), Box::new(arc))
    }

    pub fn ellipse(center: Point3, major_axis: Vector3, minor_axis: Vector3, major_radius: f64, minor_radius: f64) -> Self {
        let ellipse = truck_geometry::Ellipse::new(center, major_axis, minor_axis, major_radius, minor_radius);
        Self::new("Ellipse".to_string(), Box::new(ellipse))
    }

    pub fn bspline(control_points: Vec<Point3>, knots: Vec<f64>, degree: usize) -> Self {
        let bspline = truck_geometry::BSplineCurve::new(control_points, knots, degree);
        Self::new("BSpline".to_string(), Box::new(bspline))
    }

    pub fn nurbs(control_points: Vec<Point3>, weights: Vec<f64>, knots: Vec<f64>, degree: usize) -> Self {
        let nurbs = truck_geometry::NurbsCurve::new(control_points, weights, knots, degree);
        Self::new("NURBS".to_string(), Box::new(nurbs))
    }

    pub fn evaluate(&self, t: f64) -> Point3 {
        self.curve.subs(t)
    }

    pub fn derivative(&self, t: f64, order: usize) -> Vector3 {
        self.curve.der(t).der_n(order - 1).subs(t)
    }

    pub fn parameter_range(&self) -> (f64, f64) {
        (self.curve.parameter_range().0, self.curve.parameter_range().1)
    }

    pub fn length(&self) -> f64 {
        self.curve.length(self.curve.parameter_range().0, self.curve.parameter_range().1)
    }

    pub fn closest_parameter(&self, point: Point3) -> f64 {
        self.curve.parameter(point, None).unwrap_or(0.0)
    }

    pub fn project(&self, point: Point3) -> Point3 {
        let t = self.closest_parameter(point);
        self.evaluate(t)
    }
}

impl Geometry for CurveEntity {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Curve
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
        let new_curve = self.curve.transformed(&matrix);
        self.curve = Box::new(new_curve);
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl CurveEntity {
    fn update_bounding_box(&mut self) {
        let bounds = self.curve.bounding_box();
        self.bounding_box = crate::BoundingBox::new(
            Point3::new(bounds.min.x, bounds.min.y, bounds.min.z),
            Point3::new(bounds.max.x, bounds.max.y, bounds.max.z),
        );
        self.bounding_box = self.transform.transform_bounding_box(&self.bounding_box);
    }
}

pub type CurveRef = Arc<RwLock<CurveEntity>>;

#[derive(Debug, Clone)]
pub struct Polyline {
    pub id: GeometryId,
    pub name: String,
    pub vertices: Vec<Point3>,
    pub closed: bool,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl Polyline {
    pub fn new(name: String, vertices: Vec<Point3>, closed: bool) -> Self {
        let mut polyline = Self {
            id: GeometryId::new(),
            name,
            vertices,
            closed,
            transform: crate::Transform::identity(),
            bounding_box: crate::BoundingBox::empty(),
        };
        polyline.update_bounding_box();
        polyline
    }

    pub fn from_points(points: Vec<Point3>) -> Self {
        Self::new("Polyline".to_string(), points, false)
    }

    pub fn from_rectangle(min: Point3, max: Point3) -> Self {
        let points = vec![
            Point3::new(min.x, min.y, min.z),
            Point3::new(max.x, min.y, min.z),
            Point3::new(max.x, max.y, min.z),
            Point3::new(min.x, max.y, min.z),
        ];
        Self::new("Rectangle".to_string(), points, true)
    }

    pub fn add_vertex(&mut self, point: Point3) {
        self.vertices.push(point);
        self.update_bounding_box();
    }

    pub fn insert_vertex(&mut self, index: usize, point: Point3) {
        if index <= self.vertices.len() {
            self.vertices.insert(index, point);
            self.update_bounding_box();
        }
    }

    pub fn remove_vertex(&mut self, index: usize) -> Option<Point3> {
        if index < self.vertices.len() {
            let v = self.vertices.remove(index);
            self.update_bounding_box();
            Some(v)
        } else {
            None
        }
    }

    pub fn vertex_count(&self) -> usize {
        self.vertices.len()
    }

    pub fn length(&self) -> f64 {
        let mut len = 0.0;
        for i in 1..self.vertices.len() {
            len += (self.vertices[i] - self.vertices[i - 1]).norm();
        }
        if self.closed && self.vertices.len() > 2 {
            len += (self.vertices[0] - self.vertices.last().unwrap()).norm();
        }
        len
    }

    pub fn to_wire(&self) -> Wire {
        let mut wire = Wire::new();
        for i in 1..self.vertices.len() {
            let edge = truck_modeling::builder::line(&self.vertices[i - 1], &self.vertices[i]);
            wire.push_back(edge);
        }
        if self.closed && self.vertices.len() > 2 {
            let edge = truck_modeling::builder::line(&self.vertices.last().unwrap(), &self.vertices[0]);
            wire.push_back(edge);
        }
        wire
    }
}

impl Geometry for Polyline {
    fn id(&self) -> GeometryId {
        self.id
    }

    fn geometry_type(&self) -> GeometryType {
        GeometryType::Wire
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
        for v in &mut self.vertices {
            *v = matrix.transform_point(v);
        }
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }
}

impl Polyline {
    fn update_bounding_box(&mut self) {
        self.bounding_box = crate::BoundingBox::empty();
        for v in &self.vertices {
            let transformed = self.transform.to_matrix().transform_point(v);
            self.bounding_box.expand_point(transformed);
        }
    }
}

pub type PolylineRef = Arc<RwLock<Polyline>>;