use std::sync::Arc;
use parking_lot::Mutex;

#[repr(C)]
#[derive(Copy, Clone, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Vertex {
    pub position: [f32; 3],
    pub normal: [f32; 3],
    pub uv: [f32; 2],
    pub color: [f32; 4],
}

pub struct Renderer {
    pub initialized: bool,
    pub width: u32,
    pub height: u32,
    pub clear_color: [f32; 4],
    pub camera_pos: [f32; 4],
}

impl Renderer {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            initialized: true,
            width,
            height,
            clear_color: [0.05, 0.05, 0.07, 1.0],
            camera_pos: [0.0, 0.0, 0.0, 0.0],
        }
    }
    
    pub fn resize(&mut self, width: u32, height: u32) {
        self.width = width;
        self.height = height;
    }
    
    pub fn set_clear_color(&mut self, color: [f32; 4]) {
        self.clear_color = color;
    }
    
    pub fn set_camera_position(&mut self, pos: [f32; 4]) {
        self.camera_pos = pos;
    }
    
    pub fn clear(&self) {
        // Clear the viewport
        // In a full implementation, this would clear the framebuffer
    }
    
    pub fn render_frame(&self) -> Result<(), String> {
        // In a full implementation, this would render all entities
        Ok(())
    }
    
    pub fn draw_mesh(&self, vertices: &[Vertex], indices: &[u32]) {
        // Draw mesh primitives
    }
    
    pub fn draw_grid(&self, grid_size: f32, subdivisions: u32) {
        // Draw grid in viewport
    }
    
    pub fn draw_gizmo(&self) {
        // Draw transform gizmo
    }
    
    pub fn draw_selection_box(&self, x: f32, y: f32, w: f32, h: f32) {
        // Draw selection rectangle
    }
}