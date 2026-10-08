use truck_geometry::*;
use truck_topology::*;
use truck_modeling::*;
use truck_stepio::*;
use truck_meshalgo::*;
use nalgebra::{Point3, Vector3, Matrix4};
use crate::{CurveEntity, SurfaceEntity, SolidEntity, FaceEntity, ShellEntity, MeshEntity, Polyline, GeometryId, GeometryType};
use std::path::Path;
use std::fs;

pub struct Conversion;

impl Conversion {
    pub fn curve_to_wire(curve: &CurveEntity) -> Wire {
        let mut wire = Wire::new();
        wire.push_back(truck_modeling::builder::edge_from_curve(&curve.curve));
        wire
    }

    pub fn wire_to_curves(wire: &Wire) -> Vec<CurveEntity> {
        wire.iter().map(|edge| {
            let curve = edge.curve().clone();
            CurveEntity::new("FromWire".to_string(), curve)
        }).collect()
    }

    pub fn face_to_surface(face: &FaceEntity) -> Option<SurfaceEntity> {
        face.surface().map(|s| {
            SurfaceEntity::new("FromFace".to_string(), Box::new(s.clone()))
        })
    }

    pub fn surface_to_face(surface: &SurfaceEntity) -> FaceEntity {
        FaceEntity::from_surface(surface, surface.u_range(), surface.v_range())
    }

    pub fn solid_to_shells(solid: &SolidEntity) -> Vec<ShellEntity> {
        solid.solid.boundaries().iter().map(|shell| {
            ShellEntity::new("FromSolid".to_string(), shell.clone())
        }).collect()
    }

    pub fn shell_to_faces(shell: &ShellEntity) -> Vec<FaceEntity> {
        shell.faces().iter().map(|face| {
            FaceEntity::new("FromShell".to_string(), face.clone())
        }).collect()
    }

    pub fn mesh_to_polygon_mesh(mesh: &MeshEntity) -> &PolygonMesh {
        &mesh.mesh
    }

    pub fn polygon_mesh_to_mesh(mesh: PolygonMesh) -> MeshEntity {
        MeshEntity::new("FromPolygonMesh".to_string(), mesh)
    }

    pub fn polyline_to_wire(polyline: &Polyline) -> Wire {
        polyline.to_wire()
    }

    pub fn wire_to_polyline(wire: &Wire) -> Polyline {
        let mut points = Vec::new();
        for edge in wire.iter() {
            let curve = edge.curve();
            let start = curve.subs(curve.parameter_range().0);
            points.push(start);
        }
        if let Some(edge) = wire.iter().last() {
            let curve = edge.curve();
            let end = curve.subs(curve.parameter_range().1);
            points.push(end);
        }
        Polyline::from_points(points)
    }

    pub fn to_step(solid: &SolidEntity, path: &Path) -> Result<(), String> {
        let compressed = solid.solid.compress_for_step();
        let display = CompleteStepDisplay::new(StepModel::from(&compressed), Default::default());
        fs::write(path, display.to_string()).map_err(|e| e.to_string())
    }

    pub fn to_step_shell(shell: &ShellEntity, path: &Path) -> Result<(), String> {
        let compressed = shell.shell.compress_for_step();
        let display = CompleteStepDisplay::new(StepModel::from(&compressed), Default::default());
        fs::write(path, display.to_string()).map_err(|e| e.to_string())
    }

    pub fn from_step(path: &Path) -> Result<Vec<SolidEntity>, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let model = StepModel::from_string(&content).map_err(|e| format!("STEP parse error: {:?}", e))?;
        
        let mut solids = Vec::new();
        for solid_data in model.solids() {
            let solid = solid_data.into_solid().map_err(|e| format!("STEP to solid error: {:?}", e))?;
            solids.push(SolidEntity::new("FromSTEP".to_string(), solid));
        }
        
        Ok(solids)
    }

    pub fn to_obj(mesh: &MeshEntity, path: &Path) -> Result<(), String> {
        let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
        obj::write(&mesh.mesh, &mut file).map_err(|e| format!("OBJ write error: {:?}", e))
    }

    pub fn from_obj(path: &Path) -> Result<MeshEntity, String> {
        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mesh = obj::read(&mut file).map_err(|e| format!("OBJ read error: {:?}", e))?;
        Ok(MeshEntity::new("FromOBJ".to_string(), mesh))
    }

    pub fn to_stl(mesh: &MeshEntity, path: &Path, binary: bool) -> Result<(), String> {
        let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
        if binary {
            stl::write_binary(&mesh.mesh, &mut file).map_err(|e| format!("STL write error: {:?}", e))
        } else {
            stl::write_ascii(&mesh.mesh, &mut file).map_err(|e| format!("STL write error: {:?}", e))
        }
    }

    pub fn from_stl(path: &Path) -> Result<MeshEntity, String> {
        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mesh = stl::read(&mut file).map_err(|e| format!("STL read error: {:?}", e))?;
        Ok(MeshEntity::new("FromSTL".to_string(), mesh))
    }

    pub fn to_gltf(mesh: &MeshEntity, path: &Path) -> Result<(), String> {
        let mut file = fs::File::create(path).map_err(|e| e.to_string())?;
        gltf::export::export_mesh(&mesh.mesh, &mut file).map_err(|e| format!("glTF write error: {:?}", e))
    }

    pub fn from_gltf(path: &Path) -> Result<Vec<MeshEntity>, String> {
        let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
        let meshes = gltf::import::import_meshes(&mut file).map_err(|e| format!("glTF read error: {:?}", e))?;
        Ok(meshes.into_iter().enumerate().map(|(i, m)| MeshEntity::new(format!("FromGLTF_{}", i), m)).collect())
    }

    pub fn to_dxf(entities: &[&dyn crate::Geometry], path: &Path) -> Result<(), String> {
        let mut doc = dxf::Drawing::new();
        
        for entity in entities {
            match entity.geometry_type() {
                GeometryType::Curve => {
                    if let Some(curve) = entity.as_any().downcast_ref::<CurveEntity>() {
                        Self::curve_to_dxf(&mut doc, curve);
                    }
                }
                GeometryType::Wire | GeometryType::Face => {
                    if let Some(face) = entity.as_any().downcast_ref::<FaceEntity>() {
                        Self::face_to_dxf(&mut doc, face);
                    }
                }
                _ => {}
            }
        }
        
        doc.save_file(path).map_err(|e| e.to_string())
    }

    fn curve_to_dxf(doc: &mut dxf::Drawing, curve: &CurveEntity) {
        let curve_obj = &curve.curve;
        if let Some(line) = curve_obj.as_any().downcast_ref::<truck_geometry::Line>() {
            let start = line.start();
            let end = line.end();
            doc.add_entity(dxf::entities::Entity::Line(dxf::entities::Line {
                p1: dxf::Point3::new(start.x, start.y, start.z),
                p2: dxf::Point3::new(end.x, end.y, end.z),
                ..Default::default()
            }));
        } else if let Some(circle) = curve_obj.as_any().downcast_ref::<truck_geometry::Circle>() {
            let center = circle.center();
            let radius = circle.radius();
            doc.add_entity(dxf::entities::Entity::Circle(dxf::entities::Circle {
                center: dxf::Point3::new(center.x, center.y, center.z),
                radius,
                ..Default::default()
            }));
        }
    }

    fn face_to_dxf(doc: &mut dxf::Drawing, face: &FaceEntity) {
        for wire in face.face.boundaries() {
            let mut points = Vec::new();
            for edge in wire.iter() {
                let curve = edge.curve();
                let start = curve.subs(curve.parameter_range().0);
                points.push(dxf::Point3::new(start.x, start.y, start.z));
            }
            if points.len() > 1 {
                doc.add_entity(dxf::entities::Entity::Polyline(dxf::entities::Polyline {
                    vertices: points.into_iter().map(|p| dxf::entities::Vertex { location: p, ..Default::default() }).collect(),
                    closed: true,
                    ..Default::default()
                }));
            }
        }
    }

    pub fn from_dxf(path: &Path) -> Result<Vec<CurveEntity>, String> {
        let doc = dxf::Drawing::load_file(path).map_err(|e| e.to_string())?;
        let mut curves = Vec::new();
        
        for entity in doc.entities() {
            match entity.specific() {
                dxf::entities::EntityType::Line(line) => {
                    let start = Point3::new(line.p1.x, line.p1.y, line.p1.z);
                    let end = Point3::new(line.p2.x, line.p2.y, line.p2.z);
                    curves.push(CurveEntity::line(start, end));
                }
                dxf::entities::EntityType::Circle(circle) => {
                    let center = Point3::new(circle.center.x, circle.center.y, circle.center.z);
                    curves.push(CurveEntity::circle(center, Vector3::new(0.0, 0.0, 1.0), circle.radius));
                }
                dxf::entities::EntityType::Arc(arc) => {
                    let center = Point3::new(arc.center.x, arc.center.y, arc.center.z);
                    curves.push(CurveEntity::arc(center, Vector3::new(0.0, 0.0, 1.0), arc.radius, arc.start_angle, arc.end_angle));
                }
                dxf::entities::EntityType::Polyline(poly) => {
                    let points: Vec<Point3> = poly.vertices().iter().map(|v| Point3::new(v.location.x, v.location.y, v.location.z)).collect();
                    if points.len() > 1 {
                        let mut curve = CurveEntity::new("Polyline".to_string(), Box::new(truck_geometry::Line::new(points[0], points[1])));
                        curve.curve = Box::new(truck_geometry::BSplineCurve::interpolate(&points, 3));
                        curves.push(curve);
                    }
                }
                _ => {}
            }
        }
        
        Ok(curves)
    }

    pub fn to_json(entity: &dyn crate::Geometry) -> String {
        serde_json::to_string_pretty(entity).unwrap_or_default()
    }

    pub fn from_json(json: &str) -> Result<Box<dyn crate::Geometry>, String> {
        serde_json::from_str(json).map_err(|e| e.to_string())
    }
}

impl std::any::Any for dyn crate::Geometry {
    fn type_id(&self) -> std::any::TypeId {
        std::any::TypeId::of::<dyn crate::Geometry>()
    }
}

trait GeometryExt {
    fn as_any(&self) -> &dyn std::any::Any;
}

impl GeometryExt for dyn crate::Geometry {
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}