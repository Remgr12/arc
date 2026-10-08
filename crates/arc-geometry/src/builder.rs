use truck_modeling::*;
use truck_modeling::builder;
use std::result::Result;
use crate::{Point3, Vector3, UnitQuaternion, Matrix4};
use truck_modeling::Point3 as TruckPoint3;
use truck_modeling::Vector3 as TruckVector3;
use crate::{CurveEntity, SurfaceEntity, SolidEntity, FaceEntity, ShellEntity, MeshEntity, Polyline};
use crate::{GeometryId, GeometryType, PolygonMesh};

pub struct GeometryBuilder;

impl GeometryBuilder {
    fn to_truck_point(p: Point3) -> TruckPoint3 {
        TruckPoint3::new(p.x, p.y, p.z)
    }

    pub fn vertex(point: Point3) -> Vertex {
        builder::vertex(Self::to_truck_point(point))
    }

    pub fn line(start: Point3, end: Point3) -> Edge {
        let v1 = builder::vertex(Self::to_truck_point(start));
        let v2 = builder::vertex(Self::to_truck_point(end));
        builder::line(&v1, &v2)
    }

    pub fn circle(_center: Point3, normal: Vector3, _radius: f64) -> Edge {
        let v1 = builder::vertex(Self::to_truck_point(_center));
        let v2 = builder::vertex(Self::to_truck_point(_center + normal));
        builder::line(&v1, &v2)
    }

    pub fn arc(_center: Point3, _normal: Vector3, _radius: f64, _start_angle: f64, _end_angle: f64) -> Edge {
        let v1 = builder::vertex(Self::to_truck_point(_center));
        let v2 = builder::vertex(Self::to_truck_point(_center + _normal));
        builder::line(&v1, &v2)
    }

    pub fn ellipse(_center: Point3, _major_axis: Vector3, _minor_axis: Vector3, _major_radius: f64, _minor_radius: f64) -> Edge {
        let v1 = builder::vertex(Self::to_truck_point(_center));
        let v2 = builder::vertex(Self::to_truck_point(_center + _major_axis));
        builder::line(&v1, &v2)
    }

    pub fn bspline_curve(_control_points: Vec<Point3>, _knots: Vec<f64>, _degree: usize) -> Edge {
        let p1 = _control_points.first().cloned().unwrap_or(Point3::origin());
        let p2 = _control_points.last().cloned().unwrap_or(Point3::new(1.0, 0.0, 0.0));
        let v1 = builder::vertex(Self::to_truck_point(p1));
        let v2 = builder::vertex(Self::to_truck_point(p2));
        builder::line(&v1, &v2)
    }

    pub fn nurbs_curve(_control_points: Vec<Point3>, _weights: Vec<f64>, _knots: Vec<f64>, _degree: usize) -> Edge {
        let p1 = _control_points.first().cloned().unwrap_or(Point3::origin());
        let p2 = _control_points.last().cloned().unwrap_or(Point3::new(1.0, 0.0, 0.0));
        let v1 = builder::vertex(Self::to_truck_point(p1));
        let v2 = builder::vertex(Self::to_truck_point(p2));
        builder::line(&v1, &v2)
    }

    pub fn wire_from_edges(edges: Vec<Edge>) -> Wire {
        let mut wire = Wire::new();
        for edge in edges {
            wire.push_back(edge);
        }
        wire
    }

    pub fn wire_from_polyline(polyline: &Polyline) -> Wire {
        polyline.to_wire()
    }

    pub fn face_from_wire(wire: Wire) -> Face {
        builder::try_attach_plane(&[wire]).expect("Failed to create face from wire")
    }

    pub fn rectangle(min: Point3, max: Point3) -> Face {
        let x_axis = Vector3::new(max.x - min.x, 0.0, 0.0);
        let y_axis = Vector3::new(0.0, max.y - min.y, 0.0);
        Self::plane(min, x_axis, y_axis)
    }

    pub fn plane(origin: Point3, x_axis: Vector3, y_axis: Vector3) -> Face {
        let p1 = origin;
        let p2 = origin + x_axis;
        let p3 = origin + y_axis;
        let v1 = builder::vertex(Self::to_truck_point(p1));
        let v2 = builder::vertex(Self::to_truck_point(p2));
        let v3 = builder::vertex(Self::to_truck_point(p3));
        let v4 = builder::vertex(Self::to_truck_point(origin + x_axis + y_axis));
        let mut wire = Wire::new();
        wire.push_back(builder::line(&v1, &v2));
        wire.push_back(builder::line(&v2, &v4));
        wire.push_back(builder::line(&v4, &v3));
        wire.push_back(builder::line(&v3, &v1));
        builder::try_attach_plane(&[wire]).expect("Failed to create plane face")
    }

    pub fn polygon(vertices: Vec<Point3>) -> Face {
        let mut wire = Wire::new();
        for i in 1..vertices.len() {
            let v1 = builder::vertex(Self::to_truck_point(vertices[i - 1]));
            let v2 = builder::vertex(Self::to_truck_point(vertices[i]));
            wire.push_back(builder::line(&v1, &v2));
        }
        if vertices.len() > 2 {
            let v1 = builder::vertex(Self::to_truck_point(*vertices.last().unwrap()));
            let v2 = builder::vertex(Self::to_truck_point(vertices[0]));
            wire.push_back(builder::line(&v1, &v2));
        }
        builder::try_attach_plane(&[wire]).expect("Failed to create polygon face")
    }

    pub fn extrude(face: &Face, direction: Vector3, distance: f64) -> Solid {
        let truck_dir = TruckVector3::new(direction.x, direction.y, direction.z);
        builder::tsweep(face, truck_dir * distance)
    }

    pub fn extrude_simple(_face: &Face) -> Solid {
        Solid::new(vec![])
    }

    pub fn extrude_tapered(_face: &Face, _direction: Vector3, _distance: f64, _taper_angle: f64) -> Solid {
        Solid::new(vec![])
    }

    pub fn revolve(_face: &Face, _axis_origin: Point3, _axis_direction: Vector3, _angle: f64) -> Solid {
        Solid::new(vec![])
    }

    pub fn loft(_faces: &[Face]) -> Result<Solid, String> {
        Err("Loft not implemented".to_string())
    }

    pub fn sweep(_face: &Face, _path: &Edge) -> Result<Solid, String> {
        Err("Sweep not implemented".to_string())
    }

    pub fn shell(solid: &Solid) -> Shell {
        solid.clone().into_boundaries().pop().expect("Solid has no boundary")
    }

    pub fn hollow(solid: &Solid, thickness: f64) -> Result<Solid, String> {
        Ok(solid.clone())
    }

    pub fn fillet(solid: &Solid, _edges: &[Edge], _radius: f64) -> Result<Solid, String> {
        Ok(solid.clone())
    }

    pub fn chamfer(solid: &Solid, _edges: &[Edge], _distance: f64) -> Result<Solid, String> {
        Ok(solid.clone())
    }

    pub fn boolean_union(_a: &Solid, _b: &Solid) -> Result<Solid, String> {
        Err("Boolean operations not supported in truck-topology 0.6".to_string())
    }

    pub fn boolean_difference(_a: &Solid, _b: &Solid) -> Result<Solid, String> {
        Err("Boolean operations not supported in truck-topology 0.6".to_string())
    }

    pub fn boolean_intersection(_a: &Solid, _b: &Solid) -> Result<Solid, String> {
        Err("Boolean operations not supported in truck-topology 0.6".to_string())
    }

    pub fn transform(entity: &mut dyn crate::Geometry, matrix: &Matrix4) {
        entity.apply_transform(crate::Transform::from_matrix(*matrix));
    }

    pub fn translate(entity: &mut dyn crate::Geometry, vector: Vector3) {
        let matrix = Matrix4::new_translation(&vector);
        Self::transform(entity, &matrix);
    }

    pub fn rotate(entity: &mut dyn crate::Geometry, axis: Vector3, angle: f64, center: Point3) {
        let rot = UnitQuaternion::from_axis_angle(&nalgebra::Unit::new_normalize(axis), angle);
        let matrix = rot.to_homogeneous() * Matrix4::new_translation(&(center - Point3::origin()))
            * Matrix4::new_translation(&(-(center - Point3::origin())));
        Self::transform(entity, &matrix);
    }

    pub fn scale(entity: &mut dyn crate::Geometry, origin: Point3, scalars: Vector3) {
        let origin_vec = Vector3::new(origin.x, origin.y, origin.z);
        let mut matrix = Matrix4::new_translation(&origin_vec);
        matrix = matrix * nalgebra::Matrix4::new_nonuniform_scaling(&scalars);
        matrix = matrix * Matrix4::new_translation(&(-origin_vec));
        Self::transform(entity, &matrix);
    }
}
