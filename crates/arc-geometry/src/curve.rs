use truck_modeling::*;
use truck_modeling::builder;
use std::result::Result;
use std::sync::Arc;
use parking_lot::RwLock;
use crate::{Point3, Vector3};
use crate::{GeometryId, GeometryType, Geometry, GeometryData, BoundingBox, Transform};
use crate::{SurfaceEntity, SolidEntity, FaceEntity, ShellEntity, MeshEntity};

#[derive(Debug)]
pub struct CurveEntity {
    pub id: GeometryId,
    pub name: String,
    pub curve: Box<dyn Geometry>,
    pub transform: crate::Transform,
    pub bounding_box: crate::BoundingBox,
}

impl Clone for CurveEntity {
    fn clone(&self) -> Self {
        Self {
            id: self.id,
            name: self.name.clone(),
            curve: self.curve.clone_box(),
            transform: self.transform,
            bounding_box: self.bounding_box,
        }
    }
}

#[derive(Debug, Clone)]
pub struct LineCurve {
    pub start: Point3,
    pub end: Point3,
}

impl LineCurve {
    pub fn new(start: Point3, end: Point3) -> Self {
        Self { start, end }
    }
}

impl Geometry for LineCurve {
    fn id(&self) -> GeometryId { GeometryId::new() }
    fn geometry_type(&self) -> GeometryType { GeometryType::Curve }
    fn name(&self) -> &str { "Line" }
    fn bounding_box(&self) -> crate::BoundingBox { crate::BoundingBox::new(self.start, self.end) }
    fn transform(&self) -> crate::Transform { crate::Transform::identity() }
    fn set_transform(&mut self, _transform: crate::Transform) {}
    fn apply_transform(&mut self, transform: crate::Transform) {
        let matrix = transform.to_matrix();
        self.start = matrix.transform_point(&self.start);
        self.end = matrix.transform_point(&self.end);
    }
    fn clone_box(&self) -> Box<dyn Geometry> { Box::new(self.clone()) }
    fn as_data(&self) -> GeometryData { GeometryData { id: GeometryId::new(), name: "Line".to_string(), geometry_type: GeometryType::Curve, data: Vec::new(), bounding_box: crate::BoundingBox::new(self.start, self.end), transform: crate::Transform::identity() } }
}

impl CurveEntity {
    pub fn new(name: String, curve: Box<dyn Geometry>) -> Self {
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
        let curve = LineCurve { start, end };
        Self::new("Line".to_string(), Box::new(curve))
    }

    pub fn circle(_center: Point3, _normal: Vector3, _radius: f64) -> Self {
        let curve = LineCurve { start: _center, end: _center + _normal };
        Self::new("Circle".to_string(), Box::new(curve))
    }

    pub fn arc(_center: Point3, _normal: Vector3, _radius: f64, _start_angle: f64, _end_angle: f64) -> Self {
        let curve = LineCurve { start: _center, end: _center + _normal };
        Self::new("Arc".to_string(), Box::new(curve))
    }

    pub fn ellipse(_center: Point3, _major_axis: Vector3, _minor_axis: Vector3, _major_radius: f64, _minor_radius: f64) -> Self {
        let curve = LineCurve { start: _center, end: _center + _major_axis };
        Self::new("Ellipse".to_string(), Box::new(curve))
    }

    pub fn bspline(control_points: Vec<Point3>, _knots: Vec<f64>, _degree: usize) -> Self {
        if control_points.len() >= 2 {
            let curve = LineCurve { start: control_points[0], end: control_points[control_points.len() - 1] };
            Self::new("BSpline".to_string(), Box::new(curve))
        } else {
            let curve = LineCurve { start: Point3::origin(), end: Point3::new(1.0, 0.0, 0.0) };
            Self::new("BSpline".to_string(), Box::new(curve))
        }
    }

    pub fn nurbs(control_points: Vec<Point3>, _weights: Vec<f64>, _knots: Vec<f64>, _degree: usize) -> Self {
        if control_points.len() >= 2 {
            let curve = LineCurve { start: control_points[0], end: control_points[control_points.len() - 1] };
            Self::new("NURBS".to_string(), Box::new(curve))
        } else {
            let curve = LineCurve { start: Point3::origin(), end: Point3::new(1.0, 0.0, 0.0) };
            Self::new("NURBS".to_string(), Box::new(curve))
        }
    }

    pub fn evaluate(&self, _t: f64) -> Point3 {
        Point3::origin()
    }

    pub fn derivative(&self, _t: f64, _order: usize) -> Vector3 {
        Vector3::zeros()
    }

    pub fn parameter_range(&self) -> (f64, f64) {
        (0.0, 1.0)
    }

    pub fn length(&self) -> f64 {
        0.0
    }

    pub fn closest_parameter(&self, _point: Point3) -> f64 {
        0.0
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
        self.transform = self.transform.mul(&transform);
        self.update_bounding_box();
    }

    fn clone_box(&self) -> Box<dyn Geometry> {
        Box::new(self.clone())
    }

    fn name(&self) -> &str {
        &self.name
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Curve,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
    }
}

impl CurveEntity {
    fn update_bounding_box(&mut self) {
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
            let v1 = builder::vertex(truck_modeling::cgmath::Point3::new(
                self.vertices[i - 1].x,
                self.vertices[i - 1].y,
                self.vertices[i - 1].z,
            ));
            let v2 = builder::vertex(truck_modeling::cgmath::Point3::new(
                self.vertices[i].x,
                self.vertices[i].y,
                self.vertices[i].z,
            ));
            let edge = builder::line(&v1, &v2);
            wire.push_back(edge);
        }
        if self.closed && self.vertices.len() > 2 {
            let last = self.vertices.last().unwrap();
            let v1 = builder::vertex(truck_modeling::cgmath::Point3::new(last.x, last.y, last.z));
            let v2 = builder::vertex(truck_modeling::cgmath::Point3::new(
                self.vertices[0].x,
                self.vertices[0].y,
                self.vertices[0].z,
            ));
            let edge = builder::line(&v1, &v2);
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

    fn name(&self) -> &str {
        &self.name
    }

    fn as_data(&self) -> GeometryData {
        GeometryData {
            id: self.id,
            name: self.name.clone(),
            geometry_type: GeometryType::Wire,
            data: Vec::new(),
            bounding_box: self.bounding_box,
            transform: self.transform,
        }
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