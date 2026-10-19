use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    pub id: Uuid,
    pub name: String,
    pub geometry: EntityGeometry,
    pub transform: [f64; 12],
    pub layer: Option<Uuid>,
    pub visible: bool,
    pub locked: bool,
    pub color: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum EntityGeometry {
    Mesh(Mesh),
    NURBSCurve(NURBSCurve),
    NURBSSurface(NURBSSurface),
    SheetMetal(SheetMetal),
    CSG(CSG),
}

impl Entity {
    pub fn new(id: Uuid, name: String, geometry: EntityGeometry) -> Self {
        Entity {
            id,
            name,
            geometry,
            transform: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0],
            layer: None,
            visible: true,
            locked: false,
            color: [0.7, 0.7, 0.7],
        }
    }

    pub fn id(&self) -> Uuid {
        self.id
    }

    pub fn new_box(width: f64, height: f64, depth: f64) -> Self {
        let mut mesh = Mesh::new();
        Entity::create_box(&mut mesh, width, height, depth);
        Entity::new(Uuid::new_v4(), "Box".to_string(), EntityGeometry::Mesh(mesh))
    }

    pub fn new_sphere(center_x: f64, center_y: f64, center_z: f64, radius: f64) -> Self {
        let mut mesh = Mesh::new();
        Entity::create_sphere(&mut mesh, center_x, center_y, center_z, radius);
        Entity::new(Uuid::new_v4(), "Sphere".to_string(), EntityGeometry::Mesh(mesh))
    }

    pub fn new_cylinder(center_x: f64, center_y: f64, center_z: f64, axis_x: f64, axis_y: f64, axis_z: f64, radius: f64, height: f64) -> Self {
        let mut mesh = Mesh::new();
        Entity::create_cylinder(&mut mesh, center_x, center_y, center_z, axis_x, axis_y, axis_z, radius, height);
        Entity::new(Uuid::new_v4(), "Cylinder".to_string(), EntityGeometry::Mesh(mesh))
    }

    pub fn new_cone(base_center_x: f64, base_center_y: f64, base_center_z: f64, base_radius: f64, tip_center_x: f64, tip_center_y: f64, tip_center_z: f64, tip_radius: f64) -> Self {
        let mut mesh = Mesh::new();
        Entity::create_cone(&mut mesh, base_center_x, base_center_y, base_center_z, base_radius, tip_center_x, tip_center_y, tip_center_z, tip_radius);
        Entity::new(Uuid::new_v4(), "Cone".to_string(), EntityGeometry::Mesh(mesh))
    }

    pub fn new_plane(normal_x: f64, normal_y: f64, normal_z: f64, distance: f64) -> Self {
        let mut mesh = Mesh::new();
        Entity::create_plane(&mut mesh, normal_x, normal_y, normal_z, distance);
        Entity::new(Uuid::new_v4(), "Plane".to_string(), EntityGeometry::Mesh(mesh))
    }

    fn create_box(mesh: &mut Mesh, width: f64, height: f64, depth: f64) {
        let half_w = width / 2.0;
        let half_h = height / 2.0;
        let half_d = depth / 2.0;

        mesh.vertices = vec![
            [-half_w, -half_h, -half_d],
            [half_w, -half_h, -half_d],
            [half_w, half_h, -half_d],
            [-half_w, half_h, -half_d],
            [-half_w, -half_h, half_d],
            [half_w, -half_h, half_d],
            [half_w, half_h, half_d],
            [-half_w, half_h, half_d],
        ];

        mesh.indices = vec![0, 1, 2, 2, 3, 0, 4, 5, 6, 6, 7, 4, 0, 1, 5, 5, 4, 0, 1, 2, 6, 6, 5, 1, 2, 3, 7, 7, 6, 2, 3, 0, 4, 4, 7, 3];
    }

    fn create_sphere(mesh: &mut Mesh, center_x: f64, center_y: f64, center_z: f64, radius: f64) {
        let stacks = 12;
        let slices = 24;

        for i in 0..=stacks {
            let lat = std::f64::consts::PI * (i as f64) / (stacks as f64);
            let sin_lat = lat.sin();
            let cos_lat = lat.cos();

            for j in 0..=slices {
                let long = 2.0 * std::f64::consts::PI * (j as f64) / (slices as f64);
                let sin_long = long.sin();
                let cos_long = long.cos();

                let x = center_x + radius * sin_lat * cos_long;
                let y = center_y + radius * sin_lat * sin_long;
                let z = center_z + radius * cos_lat;

                mesh.vertices.push([x, y, z]);
            }
        }

        let mut indices = Vec::new();
        for i in 0..stacks {
            for j in 0..slices {
                let current = i * (slices + 1) + j;
                let next = current + slices + 1;

                if i != 0 {
                    indices.extend(&[current, current + 1, next]);
                }
                if i != stacks - 1 {
                    indices.extend(&[next, current + 1, next + 1]);
                }
            }
        }

        mesh.indices = indices;
    }

    fn create_cylinder(mesh: &mut Mesh, center_x: f64, center_y: f64, center_z: f64, axis_x: f64, axis_y: f64, axis_z: f64, radius: f64, height: f64) {
        let top_center = [center_x + axis_x * height / 2.0, center_y + axis_y * height / 2.0, center_z + axis_z * height / 2.0];
        let bottom_center = [center_x - axis_x * height / 2.0, center_y - axis_y * height / 2.0, center_z - axis_z * height / 2.0];

        let slices = 24;
        let mut top_vertices = Vec::new();
        let mut bottom_vertices = Vec::new();

        for i in 0..=slices {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (slices as f64);
            let cos_angle = angle.cos();
            let sin_angle = angle.sin();

            let offset_x = radius * cos_angle;
            let offset_y = radius * sin_angle;

            let normal_top = [offset_x, offset_y, 0.0];
            let normal_bottom = [offset_x, offset_y, 0.0];

            let top_vertex = [
                top_center[0] + normal_top[0],
                top_center[1] + normal_top[1],
                top_center[2] + normal_top[2],
            ];

            let bottom_vertex = [
                bottom_center[0] + normal_bottom[0],
                bottom_center[1] + normal_bottom[1],
                bottom_center[2] + normal_bottom[2],
            ];

            top_vertices.push(top_vertex);
            bottom_vertices.push(bottom_vertex);
        }

        let mut all_vertices = top_vertices;
        all_vertices.extend(bottom_vertices);

        let mut indices = Vec::new();
        for i in 0..slices {
            let top_current = i;
            let top_next = (i + 1) % (slices + 1);
            let bottom_current = top_current + slices + 1;
            let bottom_next = top_next + slices + 1;

            indices.extend(&[top_current, top_next, bottom_current]);
            indices.extend(&[top_next, bottom_next, bottom_current]);
        }

        let mut caps_indices = Vec::new();
        for i in 0..slices {
            let top_current = i;
            let top_next = (i + 1) % (slices + 1);
            let bottom_current = top_current + slices + 1;
            let bottom_next = top_next + slices + 1;

            caps_indices.extend(&[0, top_next, top_current]);
            caps_indices.extend(&[1, bottom_current, bottom_next]);
        }

        mesh.vertices = all_vertices;
        mesh.indices = indices;
    }

    fn create_cone(base_center_x: f64, base_center_y: f64, base_center_z: f64, base_radius: f64, tip_center_x: f64, tip_center_y: f64, tip_center_z: f64, tip_radius: f64) -> Mesh {
        let mut mesh = Mesh::new();
        let slices = 24;

        for i in 0..=slices {
            let angle = 2.0 * std::f64::consts::PI * (i as f64) / (slices as f64);
            let cos_angle = angle.cos();
            let sin_angle = angle.sin();

            let base_x = base_center_x + base_radius * cos_angle;
            let base_y = base_center_y + base_radius * sin_angle;

            let tip_x = tip_center_x + tip_radius * cos_angle;
            let tip_y = tip_center_y + tip_radius * sin_angle;

            mesh.vertices.push([base_x, base_y, base_center_z]);
            mesh.vertices.push([tip_x, tip_y, tip_center_z]);
        }

        let mut indices = Vec::new();
        for i in 0..slices {
            let base_current = i * 2;
            let base_next = (i + 1) * 2;
            let tip_current = base_current + 1;
            let tip_next = base_next + 1;

            indices.extend(&[base_current, base_next, tip_current]);
            indices.extend(&[base_next, tip_next, tip_current]);
        }

        mesh.indices = indices;
        mesh
    }

    fn create_plane(mesh: &mut Mesh, normal_x: f64, normal_y: f64, normal_z: f64, distance: f64) {
        let size = 10.0;
        let steps = 10;

        for i in 0..=steps {
            let u = size * (i as f64) / (steps as f64);
            for j in 0..=steps {
                let v = size * (j as f64) / (steps as f64);

                let point = [
                    u - size / 2.0,
                    v - size / 2.0,
                    -distance,
                ];

                mesh.vertices.push(point);
            }
        }

        let mut indices = Vec::new();
        for i in 0..steps {
            for j in 0..steps {
                let current = i * (steps + 1) + j;
                let next = current + 1;
                let bottom = current + (steps + 1);
                let bottom_next = next + (steps + 1);

                indices.extend(&[current, next, bottom]);
                indices.extend(&[next, bottom_next, bottom]);
            }
        }

        mesh.indices = indices;
    }
}
