use truck_modeling::*;
use truck_modeling::builder;
use std::result::Result;
use crate::{Point3, Vector3};
use truck_modeling::Point3 as TruckPoint3;
use truck_modeling::Vector3 as TruckVector3;
use crate::{SolidEntity, FaceEntity, ShellEntity, CurveEntity, MeshEntity, SurfaceEntity, Polyline, GeometryBuilder, LineCurve};
use crate::{GeometryId, GeometryType, Geometry};

pub struct Primitives;

impl Primitives {
    pub fn box_solid(min: Point3, max: Point3) -> SolidEntity {
        SolidEntity::box_solid(min, max)
    }

    pub fn box_centered(center: Point3, size: Vector3) -> SolidEntity {
        let half = size * 0.5;
        let min = center - half;
        let max = center + half;
        SolidEntity::box_solid(min, max)
    }

    pub fn cylinder(origin: Point3, axis: Vector3, radius: f64, height: f64) -> SolidEntity {
        SolidEntity::cylinder(origin, axis, radius, height)
    }

    pub fn cylinder_centered(center: Point3, axis: Vector3, radius: f64, height: f64) -> SolidEntity {
        let origin = center - axis.normalize() * (height * 0.5);
        SolidEntity::cylinder(origin, axis, radius, height)
    }

    pub fn sphere(center: Point3, radius: f64) -> SolidEntity {
        SolidEntity::sphere(center, radius)
    }

    pub fn cone(origin: Point3, axis: Vector3, radius: f64, height: f64) -> SolidEntity {
        SolidEntity::cone(origin, axis, radius, height)
    }

    pub fn cone_centered(center: Point3, axis: Vector3, radius: f64, height: f64) -> SolidEntity {
        let origin = center - axis.normalize() * (height * 0.5);
        SolidEntity::cone(origin, axis, radius, height)
    }

    pub fn torus(center: Point3, axis: Vector3, major_radius: f64, minor_radius: f64) -> SolidEntity {
        SolidEntity::torus(center, axis, major_radius, minor_radius)
    }

    pub fn wedge(origin: Point3, x_axis: Vector3, y_axis: Vector3, z_axis: Vector3, x_len: f64, y_len: f64, z_len: f64) -> SolidEntity {
        let max_x = TruckPoint3::new(origin.x + x_len, origin.y + y_len, origin.z + z_len);
        let min_x = TruckPoint3::new(origin.x, origin.y, origin.z);
        let v1 = Vertex::new(min_x);
        let v2 = Vertex::new(TruckPoint3::new(max_x.x, min_x.y, min_x.z));
        let v3 = Vertex::new(TruckPoint3::new(max_x.x, max_x.y, min_x.z));
        let v4 = Vertex::new(TruckPoint3::new(min_x.x, max_x.y, min_x.z));
        let v5 = Vertex::new(max_x);
        let mut wire = Wire::new();
        wire.push_back(builder::line(&v1, &v2));
        wire.push_back(builder::line(&v2, &v3));
        wire.push_back(builder::line(&v3, &v4));
        wire.push_back(builder::line(&v4, &v1));
        wire.push_back(builder::line(&v5, &v2));
        let face = builder::try_attach_plane(&[wire]).expect("Failed to create wedge face");
        let truck_z = TruckVector3::new(z_axis.x, z_axis.y, z_axis.z);
        let solid = builder::tsweep(&face, truck_z * z_len);
        SolidEntity::new("Wedge".to_string(), solid)
    }

    pub fn pyramid(_base_center: Point3, _base_normal: Vector3, _base_width: f64, _base_depth: f64, _height: f64) -> SolidEntity {
        SolidEntity::new("Pyramid".to_string(), Solid::new(vec![]))
    }

    pub fn prism(_base_face: &FaceEntity, _height: f64) -> SolidEntity {
        SolidEntity::new("Prism".to_string(), Solid::new(vec![]))
    }

    pub fn pipe(_path: &CurveEntity, _profile: &FaceEntity) -> Result<SolidEntity, String> {
        Err("Pipe not implemented".to_string())
    }

    pub fn plane_face(origin: Point3, normal: Vector3, width: f64, height: f64) -> FaceEntity {
        let surface = SurfaceEntity::plane(origin, normal, width, height);
        FaceEntity::from_surface(&surface, surface.u_range(), surface.v_range())
    }

    pub fn rectangle_face(min: Point3, max: Point3) -> FaceEntity {
        let face = GeometryBuilder::rectangle(min, max);
        FaceEntity::new("Rectangle".to_string(), face)
    }

    pub fn circle_face(center: Point3, normal: Vector3, radius: f64) -> FaceEntity {
        let surface = SurfaceEntity::cylinder(center, normal, radius, 0.0);
        FaceEntity::from_surface(&surface, surface.u_range(), (0.0, 1.0))
    }

    pub fn polygon_face(vertices: Vec<Point3>) -> FaceEntity {
        let face = GeometryBuilder::polygon(vertices);
        FaceEntity::new("Polygon".to_string(), face)
    }

    pub fn disk(center: Point3, normal: Vector3, radius: f64) -> FaceEntity {
        let surface = SurfaceEntity::plane(center, normal, radius * 2.0, radius * 2.0);
        FaceEntity::from_surface(&surface, (-1.0, 1.0), (-1.0, 1.0))
    }

    pub fn annulus(_center: Point3, _normal: Vector3, _inner_radius: f64, _outer_radius: f64) -> FaceEntity {
        let surface = SurfaceEntity::plane(_center, _normal, _outer_radius * 2.0, _outer_radius * 2.0);
        FaceEntity::from_surface(&surface, surface.u_range(), surface.v_range())
    }

    pub fn line_curve(start: Point3, end: Point3) -> CurveEntity {
        CurveEntity::line(start, end)
    }

    pub fn circle_curve(center: Point3, normal: Vector3, radius: f64) -> CurveEntity {
        CurveEntity::circle(center, normal, radius)
    }

    pub fn arc_curve(center: Point3, normal: Vector3, radius: f64, start_angle: f64, end_angle: f64) -> CurveEntity {
        CurveEntity::arc(center, normal, radius, start_angle, end_angle)
    }

    pub fn ellipse_curve(center: Point3, major_axis: Vector3, minor_axis: Vector3, major_radius: f64, minor_radius: f64) -> CurveEntity {
        CurveEntity::ellipse(center, major_axis, minor_axis, major_radius, minor_radius)
    }

    pub fn polyline_curve(points: Vec<Point3>, closed: bool) -> Polyline {
        Polyline::new("Polyline".to_string(), points, closed)
    }

    pub fn rectangle_curve(min: Point3, max: Point3) -> Polyline {
        Polyline::from_rectangle(min, max)
    }

    pub fn helix(origin: Point3, axis: Vector3, radius: f64, pitch: f64, turns: f64) -> CurveEntity {
        let points: Vec<Point3> = (0..=((turns * 360.0) as usize))
            .map(|i| {
                let t = i as f64 / (turns * 360.0);
                let angle = t * turns * 2.0 * std::f64::consts::PI;
                let z = t * pitch * turns;
                Point3::new(
                    origin.x + radius * angle.cos(),
                    origin.y + radius * angle.sin(),
                    origin.z + z,
                )
            })
            .collect();
        
        let curve = LineCurve::new(points[0], points[1]);
        CurveEntity::new("Helix".to_string(), Box::new(curve))
    }

    pub fn mesh_box(min: Point3, max: Point3, subdivisions: (u32, u32, u32)) -> MeshEntity {
        MeshEntity::box_mesh(min, max, subdivisions)
    }

    pub fn mesh_sphere(center: Point3, radius: f64, u_div: u32, v_div: u32) -> MeshEntity {
        MeshEntity::sphere_mesh(center, radius, u_div, v_div)
    }

    pub fn mesh_cylinder(origin: Point3, axis: Vector3, radius: f64, height: f64, radial_div: u32, height_div: u32) -> MeshEntity {
        MeshEntity::cylinder_mesh(origin, axis, radius, height, radial_div, height_div)
    }

    pub fn mesh_plane(origin: Point3, x_axis: Vector3, y_axis: Vector3, width: f64, height: f64, u_div: u32, v_div: u32) -> MeshEntity {
        MeshEntity::plane_mesh(origin, x_axis, y_axis, width, height, u_div, v_div)
    }

    pub fn grid(origin: Point3, normal: Vector3, size: Vector3, divisions: (u32, u32)) -> MeshEntity {
        let x_axis = if normal.x.abs() > 0.9 {
            Vector3::new(0.0, 1.0, 0.0)
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };
        let x_axis = normal.cross(&x_axis).normalize();
        let y_axis = normal.cross(&x_axis).normalize();
        
        let mut mesh = MeshEntity::plane_mesh(origin, x_axis * size.x, y_axis * size.y, size.x, size.y, divisions.0, divisions.1);
        mesh.name = "Grid".to_string();
        mesh
    }
}

pub struct ArchitecturePrimitives;

impl ArchitecturePrimitives {
    pub fn wall(start: Point3, end: Point3, height: f64, thickness: f64, base_height: f64) -> SolidEntity {
        let direction = (end - start).normalize();
        let normal = Vector3::new(-direction.y, direction.x, 0.0);
        
        let base = Point3::new(start.x, start.y, base_height);
        let top = base + Vector3::new(0.0, 0.0, height);
        
        let p1 = base + normal * (thickness * 0.5);
        let p2 = base - normal * (thickness * 0.5);
        let p3 = Point3::new(end.x, end.y, base_height) - normal * (thickness * 0.5);
        let p4 = Point3::new(end.x, end.y, base_height) + normal * (thickness * 0.5);
        
        let face = FaceEntity::polygon_face(vec![p1, p2, p3, p4]);
        SolidEntity::extrude(&face, Vector3::new(0.0, 0.0, 1.0), height)
    }

    pub fn wall_curved(center: Point3, radius: f64, start_angle: f64, end_angle: f64, height: f64, thickness: f64, base_height: f64) -> SolidEntity {
        let outer_arc = CurveEntity::arc(center, Vector3::new(0.0, 0.0, 1.0), radius + thickness * 0.5, start_angle, end_angle);
        let inner_arc = CurveEntity::arc(center, Vector3::new(0.0, 0.0, 1.0), radius - thickness * 0.5, start_angle, end_angle);
        
        let outer_face = FaceEntity::from_surface(&SurfaceEntity::cylinder(
            Point3::new(center.x, center.y, base_height),
            Vector3::new(0.0, 0.0, 1.0),
            radius + thickness * 0.5,
            height,
        ), outer_arc.parameter_range(), (0.0, 1.0));
        
        let inner_face = FaceEntity::from_surface(&SurfaceEntity::cylinder(
            Point3::new(center.x, center.y, base_height),
            Vector3::new(0.0, 0.0, 1.0),
            radius - thickness * 0.5,
            height,
        ), inner_arc.parameter_range(), (0.0, 1.0));
        
        let mut shell = ShellEntity::new("Wall".to_string(), Shell::new());
        shell.add_face(outer_face.face);
        shell.add_face(inner_face.face);
        
        let solid = SolidEntity::new("Wall".to_string(), Solid::new(vec![shell.shell]));
        solid
    }

    pub fn door(opening: &SolidEntity, width: f64, height: f64, thickness: f64) -> SolidEntity {
        let bbox = opening.bounding_box();
        let center = Point3::new(
            (bbox.min.x + bbox.max.x) * 0.5,
            (bbox.min.y + bbox.max.y) * 0.5,
            bbox.min.z + height * 0.5,
        );
        
        let door = SolidEntity::box_centered(center, Vector3::new(width, thickness, height));
        door
    }

    pub fn window(opening: &SolidEntity, width: f64, height: f64, sill_height: f64, thickness: f64) -> SolidEntity {
        let bbox = opening.bounding_box();
        let center = Point3::new(
            (bbox.min.x + bbox.max.x) * 0.5,
            (bbox.min.y + bbox.max.y) * 0.5,
            bbox.min.z + sill_height + height * 0.5,
        );
        
        let window = SolidEntity::box_centered(center, Vector3::new(width, thickness, height));
        window
    }

    pub fn slab(outline: &[Point3], thickness: f64, base_height: f64) -> SolidEntity {
        let face = FaceEntity::polygon_face(outline.to_vec());
        SolidEntity::extrude(&face, Vector3::new(0.0, 0.0, 1.0), thickness)
    }

    pub fn column(center: Point3, radius: f64, height: f64, base_height: f64) -> SolidEntity {
        let origin = Point3::new(center.x, center.y, base_height);
        SolidEntity::cylinder(origin, Vector3::new(0.0, 0.0, 1.0), radius, height)
    }

    pub fn column_rectangular(center: Point3, width: f64, depth: f64, height: f64, base_height: f64) -> SolidEntity {
        let min = Point3::new(center.x - width * 0.5, center.y - depth * 0.5, base_height);
        let max = Point3::new(center.x + width * 0.5, center.y + depth * 0.5, base_height + height);
        SolidEntity::box_solid(min, max)
    }

    pub fn beam(start: Point3, end: Point3, width: f64, height: f64) -> SolidEntity {
        let direction = (end - start).normalize();
        let length = (end - start).norm();
        
        let x_axis = if direction.x.abs() > 0.9 {
            Vector3::new(0.0, 1.0, 0.0)
        } else {
            Vector3::new(1.0, 0.0, 0.0)
        };
        let y_axis = direction.cross(&x_axis).normalize() * (width * 0.5);
        let z_axis = x_axis.cross(&direction).normalize() * (height * 0.5);
        
        let p1 = start + y_axis + z_axis;
        let p2 = start - y_axis + z_axis;
        let p3 = start - y_axis - z_axis;
        let p4 = start + y_axis - z_axis;
        let p5 = end + y_axis + z_axis;
        let p6 = end - y_axis + z_axis;
        let p7 = end - y_axis - z_axis;
        let p8 = end + y_axis - z_axis;
        
        let solid = Solid::new(vec![]);
        SolidEntity::new("Beam".to_string(), solid)
    }

    pub fn stair_run(start: Point3, direction: Vector3, run: f64, rise: f64, width: f64, tread_depth: f64, tread_count: usize) -> Vec<SolidEntity> {
        let mut stairs = Vec::new();
        let dir = direction.normalize();
        let right = Vector3::new(-dir.y, dir.x, 0.0);
        
        for i in 0..tread_count {
            let tread_start = start + dir * (i as f64 * tread_depth);
            let tread_end = tread_start + dir * tread_depth;
            let tread_height = rise * (i as f64);
            
            let min = Point3::new(
                tread_start.x - right.x * width * 0.5,
                tread_start.y - right.y * width * 0.5,
                tread_height,
            );
            let max = Point3::new(
                tread_end.x + right.x * width * 0.5,
                tread_end.y + right.y * width * 0.5,
                tread_height + rise,
            );
            
            stairs.push(SolidEntity::box_solid(min, max));
        }
        
        stairs
    }

    pub fn roof_flat(outline: &[Point3], thickness: f64, base_height: f64) -> SolidEntity {
        Self::slab(outline, thickness, base_height)
    }

    pub fn roof_gable(outline: &[Point3], ridge_height: f64, base_height: f64) -> SolidEntity {
        let face = FaceEntity::polygon_face(outline.to_vec());
        let center = Point3::origin();
        
        let mut roof_faces = Vec::new();
        for wire in face.face.boundaries() {
            for edge in wire.iter() {
                let v1 = edge.front().point();
                let v2 = edge.back().point();
                let ridge = Point3::new(center.x, center.y, base_height + ridge_height);
                let v1_n = Point3::new(v1.x, v1.y, v1.z);
                let v2_n = Point3::new(v2.x, v2.y, v2.z);
                
                let tri_face = GeometryBuilder::polygon(vec![v1_n, v2_n, ridge]);
                roof_faces.push(FaceEntity::new("RoofFace".to_string(), tri_face));
            }
        }
        
        let mut shell = ShellEntity::new("GableRoof".to_string(), Shell::new());
        for rf in roof_faces {
            shell.add_face(rf.face);
        }
        
        if let Some(solid) = shell.to_solid() {
            solid
        } else {
            SolidEntity::new("GableRoof".to_string(), Solid::new(vec![shell.shell]))
        }
    }

    pub fn roof_hip(outline: &[Point3], ridge_height: f64, base_height: f64) -> SolidEntity {
        Self::roof_gable(outline, ridge_height, base_height)
    }
}