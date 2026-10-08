use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3, UnitQuaternion, Matrix4, Orthographic3, Perspective3};
use crate::{EntityId, ViewportState, ViewType, Transform};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Viewport {
    pub id: EntityId,
    pub name: String,
    pub state: ViewportState,
    pub render_settings: RenderSettings,
    pub grid_settings: GridSettings,
    pub background_color: crate::Color,
    pub active: bool,
}

impl Viewport {
    pub fn new(name: String, view_type: ViewType) -> Self {
        let mut state = ViewportState::default();
        state.view_type = view_type;
        
        Self {
            id: EntityId::new(),
            name,
            state,
            render_settings: RenderSettings::default(),
            grid_settings: GridSettings::default(),
            background_color: crate::Color::rgb(0.1, 0.1, 0.12),
            active: true,
        }
    }

    pub fn view_matrix(&self) -> Matrix4<f64> {
        self.state.view_matrix()
    }

    pub fn projection_matrix(&self) -> Matrix4<f64> {
        self.state.projection_matrix()
    }

    pub fn view_projection_matrix(&self) -> Matrix4<f64> {
        self.state.view_projection_matrix()
    }

    pub fn screen_to_world(&self, screen_pos: (f32, f32), screen_size: (f32, f32)) -> (Point3<f64>, Vector3<f64>) {
        let ndc_x = (screen_pos.0 / screen_size.0) * 2.0 - 1.0;
        let ndc_y = 1.0 - (screen_pos.1 / screen_size.1) * 2.0;
        
        let inv_vp = self.view_projection_matrix().try_inverse().unwrap_or(Matrix4::identity());
        
        let near = Point3::new(ndc_x as f64, ndc_y as f64, -1.0);
        let far = Point3::new(ndc_x as f64, ndc_y as f64, 1.0);
        
        let near_world = inv_vp.transform_point(&near);
        let far_world = inv_vp.transform_point(&far);
        
        let ray_dir = (far_world - near_world).normalize();
        
        (near_world, ray_dir)
    }

    pub fn world_to_screen(&self, world_pos: Point3<f64>, screen_size: (f32, f32)) -> Option<(f32, f32)> {
        let clip = self.view_projection_matrix() * nalgebra::Vector4::new(world_pos.x, world_pos.y, world_pos.z, 1.0);
        
        if clip.w == 0.0 {
            return None;
        }
        
        let ndc = nalgebra::Vector3::new(clip.x / clip.w, clip.y / clip.w, clip.z / clip.w);
        
        if ndc.z < -1.0 || ndc.z > 1.0 {
            return None;
        }
        
        let x = ((ndc.x + 1.0) * 0.5) * screen_size.0 as f64;
        let y = ((1.0 - ndc.y) * 0.5) * screen_size.1 as f64;
        
        Some((x as f32, y as f32))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderSettings {
    pub wireframe: bool,
    pub show_edges: bool,
    pub show_vertices: bool,
    pub show_normals: bool,
    pub backface_culling: bool,
    pub depth_test: bool,
    pub msaa_samples: u32,
    pub ambient_occlusion: bool,
    pub shadows: bool,
    pub shadow_bias: f32,
    pub shadow_map_size: u32,
}

impl Default for RenderSettings {
    fn default() -> Self {
        Self {
            wireframe: false,
            show_edges: true,
            show_vertices: false,
            show_normals: false,
            backface_culling: true,
            depth_test: true,
            msaa_samples: 4,
            ambient_occlusion: false,
            shadows: true,
            shadow_bias: 0.005,
            shadow_map_size: 2048,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridSettings {
    pub enabled: bool,
    pub spacing: f64,
    pub subdivisions: u32,
    pub major_color: crate::Color,
    pub minor_color: crate::Color,
    pub axis_color: crate::Color,
    pub snap_to_grid: bool,
    pub adaptive: bool,
}

impl Default for GridSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            spacing: 1000.0,
            subdivisions: 10,
            major_color: crate::Color::rgb(0.3, 0.3, 0.35),
            minor_color: crate::Color::rgb(0.2, 0.2, 0.25),
            axis_color: crate::Color::rgb(0.5, 0.5, 0.5),
            snap_to_grid: true,
            adaptive: true,
        }
    }
}

pub type ViewportRef = Arc<RwLock<Viewport>>;

#[derive(Debug, Default)]
pub struct ViewportManager {
    viewports: Vec<ViewportRef>,
    active_index: usize,
}

impl ViewportManager {
    pub fn new() -> Self {
        let mut manager = Self::default();
        manager.create_viewport("Perspective".to_string(), ViewType::Perspective);
        manager.create_viewport("Top".to_string(), ViewType::Top);
        manager.create_viewport("Front".to_string(), ViewType::Front);
        manager.create_viewport("Right".to_string(), ViewType::Right);
        manager
    }

    pub fn create_viewport(&mut self, name: String, view_type: ViewType) -> ViewportRef {
        let viewport = Arc::new(RwLock::new(Viewport::new(name, view_type)));
        self.viewports.push(viewport.clone());
        viewport
    }

    pub fn remove_viewport(&mut self, index: usize) -> Option<ViewportRef> {
        if index < self.viewports.len() && self.viewports.len() > 1 {
            let viewport = self.viewports.remove(index);
            if self.active_index >= index && self.active_index > 0 {
                self.active_index -= 1;
            }
            Some(viewport)
        } else {
            None
        }
    }

    pub fn active_viewport(&self) -> Option<ViewportRef> {
        self.viewports.get(self.active_index).cloned()
    }

    pub fn set_active(&mut self, index: usize) {
        if index < self.viewports.len() {
            self.active_index = index;
        }
    }

    pub fn viewports(&self) -> &[ViewportRef] {
        &self.viewports
    }

    pub fn count(&self) -> usize {
        self.viewports.len()
    }

    pub fn set_view_type(&self, index: usize, view_type: ViewType) {
        if let Some(viewport) = self.viewports.get(index) {
            viewport.write().state.view_type = view_type;
        }
    }
}

pub struct CameraController {
    pub target: Point3<f64>,
    pub distance: f64,
    pub yaw: f64,
    pub pitch: f64,
    pub pan_speed: f64,
    pub rotate_speed: f64,
    pub zoom_speed: f64,
    pub min_distance: f64,
    pub max_distance: f64,
    pub min_pitch: f64,
    pub max_pitch: f64,
}

impl CameraController {
    pub fn new() -> Self {
        Self {
            target: Point3::origin(),
            distance: 50.0,
            yaw: 45.0_f64.to_radians(),
            pitch: 30.0_f64.to_radians(),
            pan_speed: 0.01,
            rotate_speed: 0.005,
            zoom_speed: 0.1,
            min_distance: 0.1,
            max_distance: 10000.0,
            min_pitch: -89.0_f64.to_radians(),
            max_pitch: 89.0_f64.to_radians(),
        }
    }

    pub fn position(&self) -> Point3<f64> {
        let x = self.distance * self.pitch.cos() * self.yaw.cos();
        let y = self.distance * self.pitch.cos() * self.yaw.sin();
        let z = self.distance * self.pitch.sin();
        self.target + Vector3::new(x, y, z)
    }

    pub fn update_viewport(&self, viewport: &mut Viewport) {
        let pos = self.position();
        viewport.state.camera_position = pos;
        viewport.state.camera_target = self.target;
        viewport.state.camera_up = Vector3::new(0.0, 0.0, 1.0);
    }

    pub fn pan(&mut self, dx: f64, dy: f64) {
        let right = Vector3::new(-self.yaw.sin(), self.yaw.cos(), 0.0);
        let up = Vector3::new(0.0, 0.0, 1.0);
        self.target += right * (dx * self.distance * self.pan_speed) + up * (dy * self.distance * self.pan_speed);
    }

    pub fn orbit(&mut self, dx: f64, dy: f64) {
        self.yaw += dx * self.rotate_speed;
        self.pitch = (self.pitch + dy * self.rotate_speed).clamp(self.min_pitch, self.max_pitch);
    }

    pub fn zoom(&mut self, delta: f64) {
        self.distance = (self.distance * (1.0 - delta * self.zoom_speed)).clamp(self.min_distance, self.max_distance);
    }

    pub fn set_target(&mut self, target: Point3<f64>) {
        self.target = target;
    }

    pub fn frame_bounds(&mut self, min: Point3<f64>, max: Point3<f64>) {
        self.target = Point3::new(
            (min.x + max.x) * 0.5,
            (min.y + max.y) * 0.5,
            (min.z + max.z) * 0.5,
        );
        
        let size = (max - min).norm();
        self.distance = size * 1.5;
        self.distance = self.distance.clamp(self.min_distance, self.max_distance);
    }
}

impl Default for CameraController {
    fn default() -> Self {
        Self::new()
    }
}