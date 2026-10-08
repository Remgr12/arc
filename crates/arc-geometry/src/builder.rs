use truck_modeling::*;
use truck_geometry::*;
use truck_topology::*;
use nalgebra::{Point3, Vector3, Matrix4};
use crate::{CurveEntity, SurfaceEntity, SolidEntity, FaceEntity, ShellEntity, MeshEntity, Polyline};
use crate::{GeometryId, GeometryType};

pub struct GeometryBuilder;

impl GeometryBuilder {
    pub fn vertex(point: Point3) -> Vertex {
        builder::vertex(point)
    }

    pub fn line(start: Point3, end: Point3) -> Edge {
        builder::line(&start, &end)
    }

    pub fn circle(center: Point3, normal: Vector3, radius: f64) -> Edge {
        builder::circle(center, normal, radius)
    }

    pub fn arc(center: Point3, normal: Vector3, radius: f64, start_angle: f64, end_angle: f64) -> Edge {
        builder::arc(center, normal, radius, start_angle, end_angle)
    }

    pub fn ellipse(center: Point3, major_axis: Vector3, minor_axis: Vector3, major_radius: f64, minor_radius: f64) -> Edge {
        builder::ellipse(center, major_axis, minor_axis, major_radius, minor_radius)
    }

    pub fn bspline_curve(control_points: Vec<Point3>, knots: Vec<f64>, degree: usize) -> Edge {
        builder::bspline_curve(control_points, knots, degree)
    }

    pub fn nurbs_curve(control_points: Vec<Point3>, weights: Vec<f64>, knots: Vec<f64>, degree: usize) -> Edge {
        builder::nurbs_curve(control_points, weights, knots, degree)
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

    pub fn face_from_surface(surface: &SurfaceEntity, u_range: (f64, f64), v_range: (f64, f64)) -> Face {
        builder::face_from_surface(&surface.surface, u_range, v_range)
    }

    pub fn plane(origin: Point3, x_axis: Vector3, y_axis: Vector3) -> Face {
        builder::plane(origin, x_axis, y_axis)
    }

    pub fn rectangle(min: Point3, max: Point3) -> Face {
        let x_axis = Vector3::new(max.x - min.x, 0.0, 0.0);
        let y_axis = Vector3::new(0.0, max.y - min.y, 0.0);
        builder::plane(min, x_axis, y_axis)
    }

    pub fn polygon(vertices: Vec<Point3>) -> Face {
        let mut wire = Wire::new();
        for i in 1..vertices.len() {
            wire.push_back(builder::line(&vertices[i - 1], &vertices[i]));
        }
        if vertices.len() > 2 {
            wire.push_back(builder::line(&vertices.last().unwrap(), &vertices[0]));
        }
        builder::try_attach_plane(&[wire]).expect("Failed to create polygon face")
    }

    pub fn extrude(face: &Face, direction: Vector3, distance: f64) -> Solid {
        builder::tsweep(face, direction * distance)
    }

    pub fn extrude_tapered(face: &Face, direction: Vector3, distance: f64, taper_angle: f64) -> Solid {
        builder::tsweep_tapered(face, direction * distance, taper_angle)
    }

    pub fn revolve(face: &Face, axis_origin: Point3, axis_direction: Vector3, angle: f64) -> Solid {
        builder::rsweep(face, axis_origin, axis_direction, Rad(angle))
    }

    pub fn loft(faces: &[Face]) -> Result<Solid, String> {
        builder::loft(faces).map_err(|e| format!("Loft failed: {:?}", e))
    }

    pub fn sweep(face: &Face, path: &Edge) -> Result<Solid, String> {
        builder::sweep(face, path).map_err(|e| format!("Sweep failed: {:?}", e))
    }

    pub fn shell(solid: &Solid) -> Shell {
        solid.into_boundaries().pop().expect("Solid has no boundary")
    }

    pub fn hollow(solid: &Solid, thickness: f64) -> Result<Solid, String> {
        solid.hollow(thickness).map_err(|e| format!("Hollow failed: {:?}", e))
    }

    pub fn fillet(solid: &Solid, edges: &[Edge], radius: f64) -> Result<Solid, String> {
        truck_fillet::fillet(solid, edges, radius).map_err(|e| format!("Fillet failed: {:?}", e))
    }

    pub fn chamfer(solid: &Solid, edges: &[Edge], distance: f64) -> Result<Solid, String> {
        truck_fillet::chamfer(solid, edges, distance).map_err(|e| format!("Chamfer failed: {:?}", e))
    }

    pub fn boolean_union(a: &Solid, b: &Solid) -> Result<Solid, String> {
        let mut result = a.clone();
        result.union(b).map_err(|e| format!("Boolean union failed: {:?}", e))?;
        Ok(result)
    }

    pub fn boolean_difference(a: &Solid, b: &Solid) -> Result<Solid, String> {
        let mut result = a.clone();
        result.difference(b).map_err(|e| format!("Boolean difference failed: {:?}", e))?;
        Ok(result)
    }

    pub fn boolean_intersection(a: &Solid, b: &Solid) -> Result<Solid, String> {
        let mut result = a.clone();
        result.intersection(b).map_err(|e| format!("Boolean intersection failed: {:?}", e))?;
        Ok(result)
    }

    pub fn transform(entity: &mut dyn crate::Geometry, matrix: &Matrix4) {
        entity.apply_transform(crate::Transform::from_matrix(*matrix));
    }

    pub fn translate(entity: &mut dyn crate::Geometry, vector: Vector3) {
        let matrix = Matrix4::new_translation(&vector);
        Self::transform(entity, &matrix);
    }

    pub fn rotate(entity: &mut dyn crate::Geometry, axis: Vector3, angle: f64, center: Point3) {
        let rot = UnitQuaternion::from_axis_angle(&axis.normalize(), angle);
        let matrix = Matrix4::from_quaternion(&rot) * Matrix4::new_translation(&(center - Point3::origin())) 
            * Matrix4::new_translation(&-(center - Point3::origin()));
        Self::transform(entity, &matrix);
    }

    pub fn scale(entity: &mut dyn crate::Geometry, scale: Vector3, center: Point3) {
        let matrix = Matrix4::new_nonuniform_scaling(&scale) 
            * Matrix4::new_translation(&(center - Point3::origin())) 
            * Matrix4::new_translation(&-(center - Point3::origin()));
        Self::transform(entity, &matrix);
    }

    pub fn mirror(entity: &mut dyn crate::Geometry, plane_origin: Point3, plane_normal: Vector3) {
        let n = plane_normal.normalize();
        let d = -n.dot(&plane_origin.coords);
        let matrix = Matrix4::new(
            1.0 - 2.0 * n.x * n.x, -2.0 * n.x * n.y, -2.0 * n.x * n.z, -2.0 * n.x * d,
            -2.0 * n.y * n.x, 1.0 - 2.0 * n.y * n.y, -2.0 * n.y * n.z, -2.0 * n.y * d,
            -2.0 * n.z * n.x, -2.0 * n.z * n.y, 1.0 - 2.0 * n.z * n.z, -2.0 * n.z * d,
            0.0, 0.0, 0.0, 1.0,
        );
        Self::transform(entity, &matrix);
    }
}

pub struct SketchBuilder {
    plane_origin: Point3,
    plane_normal: Vector3,
    plane_x: Vector3,
    plane_y: Vector3,
    entities: Vec<SketchEntity>,
}

#[derive(Debug, Clone)]
pub enum SketchEntity {
    Point(Point3),
    Line(Point3, Point3),
    Arc(Point3, f64, f64, f64),
    Circle(Point3, f64),
    Ellipse(Point3, Vector3, Vector3, f64, f64),
    Rectangle(Point3, Point3),
    Polyline(Vec<Point3>, bool),
    Text(Point3, String, f64),
    Dimension(Point3, Point3, f64, String),
}

impl SketchBuilder {
    pub fn new(origin: Point3, normal: Vector3) -> Self {
        let normal = normal.normalize();
        let x_axis = if normal.x.abs() > 0.9 {
            Vector3::new(0.0, 1.0, 0.0)
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };
        let x_axis = normal.cross(&x_axis).normalize();
        let y_axis = normal.cross(&x_axis).normalize();
        
        Self {
            plane_origin: origin,
            plane_normal: normal,
            plane_x: x_axis,
            plane_y: y_axis,
            entities: Vec::new(),
        }
    }

    pub fn to_world(&self, local: Point3) -> Point3 {
        self.plane_origin + self.plane_x * local.x + self.plane_y * local.y + self.plane_normal * local.z
    }

    pub fn to_local(&self, world: Point3) -> Point3 {
        let diff = world - self.plane_origin;
        Point3::new(
            diff.dot(&self.plane_x),
            diff.dot(&self.plane_y),
            diff.dot(&self.plane_normal),
        )
    }

    pub fn add_point(&mut self, local: Point3) -> Point3 {
        let world = self.to_world(local);
        self.entities.push(SketchEntity::Point(world));
        world
    }

    pub fn add_line(&mut self, start: Point3, end: Point3) -> (Point3, Point3) {
        let world_start = self.to_world(start);
        let world_end = self.to_world(end);
        self.entities.push(SketchEntity::Line(world_start, world_end));
        (world_start, world_end)
    }

    pub fn add_arc(&mut self, center: Point3, radius: f64, start_angle: f64, end_angle: f64) -> (Point3, f64, f64) {
        let world_center = self.to_world(center);
        self.entities.push(SketchEntity::Arc(world_center, radius, start_angle, end_angle));
        (world_center, radius, start_angle)
    }

    pub fn add_circle(&mut self, center: Point3, radius: f64) -> (Point3, f64) {
        let world_center = self.to_world(center);
        self.entities.push(SketchEntity::Circle(world_center, radius));
        (world_center, radius)
    }

    pub fn add_rectangle(&mut self, min: Point3, max: Point3) -> (Point3, Point3) {
        let world_min = self.to_world(min);
        let world_max = self.to_world(max);
        self.entities.push(SketchEntity::Rectangle(world_min, world_max));
        (world_min, world_max)
    }

    pub fn add_polyline(&mut self, points: Vec<Point3>, closed: bool) -> Vec<Point3> {
        let world_points: Vec<_> = points.iter().map(|p| self.to_world(*p)).collect();
        self.entities.push(SketchEntity::Polyline(world_points.clone(), closed));
        world_points
    }

    pub fn entities(&self) -> &[SketchEntity] {
        &self.entities
    }

    pub fn to_wires(&self) -> Vec<Wire> {
        self.entities.iter().filter_map(|e| {
            match e {
                SketchEntity::Line(start, end) => {
                    Some(builder::wire_from_edges(vec![builder::line(start, end)]))
                }
                SketchEntity::Arc(center, radius, start_a, end_a) => {
                    let arc = builder::arc(*center, self.plane_normal, *radius, *start_a, *end_a);
                    Some(builder::wire_from_edges(vec![arc]))
                }
                SketchEntity::Circle(center, radius) => {
                    let circle = builder::circle(*center, self.plane_normal, *radius);
                    Some(builder::wire_from_edges(vec![circle]))
                }
                SketchEntity::Rectangle(min, max) => {
                    let p1 = *min;
                    let p2 = Point3::new(max.x, min.y, min.z);
                    let p3 = *max;
                    let p4 = Point3::new(min.x, max.y, min.z);
                    Some(builder::wire_from_edges(vec![
                        builder::line(&p1, &p2),
                        builder::line(&p2, &p3),
                        builder::line(&p3, &p4),
                        builder::line(&p4, &p1),
                    ]))
                }
                SketchEntity::Polyline(points, closed) => {
                    let mut edges = Vec::new();
                    for i in 1..points.len() {
                        edges.push(builder::line(&points[i - 1], &points[i]));
                    }
                    if *closed && points.len() > 2 {
                        edges.push(builder::line(&points.last().unwrap(), &points[0]));
                    }
                    Some(builder::wire_from_edges(edges))
                }
                _ => None,
            }
        }).collect()
    }

    pub fn to_faces(&self) -> Vec<Face> {
        self.to_wires().into_iter()
            .filter_map(|wire| builder::try_attach_plane(&[wire]))
            .collect()
    }
}

impl Default for SketchBuilder {
    fn default() -> Self {
        Self::new(Point3::origin(), Vector3::new(0.0, 0.0, 1.0))
    }
}