use arc_core::*;
use arc_geometry::*;
use crate::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;
use crate::level::{Level, LevelType, LevelRef, LevelBuilder};

#[derive(Debug, Clone)]
pub struct Grid {
    pub id: EntityId,
    pub name: String,
    pub grid_type: GridType,
    pub origin: Point3,
    pub x_axis: Vector3,
    pub y_axis: Vector3,
    pub spacing_x: f64,
    pub spacing_y: f64,
    pub count_x: usize,
    pub count_y: usize,
    pub offset_x: f64,
    pub offset_y: f64,
    pub bubble_size: f64,
    pub bubble_text_height: f64,
    pub show_bubbles: bool,
    pub show_dimensions: bool,
    pub label_prefix: String,
    pub label_start: usize,
    pub label_increment: usize,
    pub transform: Transform,
    pub bounding_box: BoundingBox,
    pub visible: bool,
    pub locked: bool,
    pub layer_name: String,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GridType {
    Rectangular,
    Radial,
    Triangular,
    Custom,
}

impl Grid {
    pub fn new(name: String, origin: Point3, x_axis: Vector3, y_axis: Vector3, spacing_x: f64, spacing_y: f64, count_x: usize, count_y: usize) -> Self {
        let mut grid = Self {
            id: EntityId::new(),
            name,
            grid_type: GridType::Rectangular,
            origin,
            x_axis: x_axis.normalize(),
            y_axis: y_axis.normalize(),
            spacing_x,
            spacing_y,
            count_x,
            count_y,
            offset_x: 0.0,
            offset_y: 0.0,
            bubble_size: 300.0,
            bubble_text_height: 200.0,
            show_bubbles: true,
            show_dimensions: true,
            label_prefix: "".to_string(),
            label_start: 1,
            label_increment: 1,
            transform: Transform::identity(),
            bounding_box: BoundingBox::empty(),
            visible: true,
            locked: false,
            layer_name: "A-GRID".to_string(),
            properties: std::collections::HashMap::new(),
        };
        grid.update_bounds();
        grid
    }

    pub fn rectangular(name: String, origin: Point3, x_axis: Vector3, y_axis: Vector3, spacing_x: f64, spacing_y: f64, count_x: usize, count_y: usize) -> Self {
        Self::new(name, origin, x_axis, y_axis, spacing_x, spacing_y, count_x, count_y)
    }

    pub fn radial(name: String, center: Point3, radius: f64, radial_count: usize, angular_count: usize) -> Self {
        let mut grid = Self::new(name, center, Vector3::new(1.0, 0.0, 0.0), Vector3::new(0.0, 1.0, 0.0), radius, 0.0, radial_count, angular_count);
        grid.grid_type = GridType::Radial;
        grid.update_bounds();
        grid
    }

    pub fn set_labels(&mut self, prefix: String, start: usize, increment: usize) {
        self.label_prefix = prefix;
        self.label_start = start;
        self.label_increment = increment;
    }

    pub fn set_bubble_style(&mut self, size: f64, text_height: f64) {
        self.bubble_size = size;
        self.bubble_text_height = text_height;
    }

    pub fn set_offsets(&mut self, x: f64, y: f64) {
        self.offset_x = x;
        self.offset_y = y;
    }

    pub fn grid_lines(&self) -> Vec<(Point3, Point3)> {
        let mut lines = Vec::new();
        
        match self.grid_type {
            GridType::Rectangular => {
                let x_axis = self.x_axis * self.spacing_x;
                let y_axis = self.y_axis * self.spacing_y;
                
                for i in 0..=self.count_x {
                    let x = self.offset_x + i as f64 * self.spacing_x;
                    let start = self.origin + self.x_axis * x - self.y_axis * (self.count_y as f64 * self.spacing_y + self.offset_y) * 0.5;
                    let end = start + self.y_axis * (self.count_y as f64 * self.spacing_y + self.offset_y);
                    lines.push((start, end));
                }
                
                for j in 0..=self.count_y {
                    let y = self.offset_y + j as f64 * self.spacing_y;
                    let start = self.origin - self.x_axis * (self.count_x as f64 * self.spacing_x + self.offset_x) * 0.5 + self.y_axis * y;
                    let end = start + self.x_axis * (self.count_x as f64 * self.spacing_x + self.offset_x);
                    lines.push((start, end));
                }
            }
            GridType::Radial => {
                for i in 0..self.count_x {
                    let r = i as f64 * self.spacing_x / self.count_x as f64 * self.spacing_x;
                    for j in 0..self.count_y {
                        let angle = j as f64 * 2.0 * std::f64::consts::PI / self.count_y as f64;
                        let x = r * angle.cos();
                        let y = r * angle.sin();
                        let start = self.origin + self.x_axis * x + self.y_axis * y;
                        let next_r = (i + 1) as f64 * self.spacing_x / self.count_x as f64 * self.spacing_x;
                        let next_x = next_r * angle.cos();
                        let next_y = next_r * angle.sin();
                        let end = self.origin + self.x_axis * next_x + self.y_axis * next_y;
                        lines.push((start, end));
                    }
                }
            }
            _ => {}
        }
        
        lines
    }

    pub fn bubble_positions(&self) -> Vec<(Point3, String)> {
        let mut bubbles = Vec::new();
        
        match self.grid_type {
            GridType::Rectangular => {
                let x_axis = self.x_axis * self.spacing_x;
                let y_axis = self.y_axis * self.spacing_y;
                
                for i in 0..=self.count_x {
                    let label = format!("{}{}", self.label_prefix, self.label_start + i * self.label_increment);
                    let x = self.offset_x + i as f64 * self.spacing_x;
                    let pos = self.origin + self.x_axis * x - self.y_axis * (self.count_y as f64 * self.spacing_y + self.offset_y + self.bubble_size);
                    bubbles.push((pos, label));
                }
                
                for j in 0..=self.count_y {
                    let label = format!("{}{}", self.label_prefix, self.label_start + j * self.label_increment);
                    let y = self.offset_y + j as f64 * self.spacing_y;
                    let pos = self.origin - self.x_axis * (self.count_x as f64 * self.spacing_x + self.offset_x + self.bubble_size) + self.y_axis * y;
                    bubbles.push((pos, label));
                }
            }
            _ => {}
        }
        
        bubbles
    }

    pub fn intersection_points(&self) -> Vec<Point3> {
        let mut points = Vec::new();
        
        match self.grid_type {
            GridType::Rectangular => {
                for i in 0..=self.count_x {
                    for j in 0..=self.count_y {
                        let x = self.offset_x + i as f64 * self.spacing_x;
                        let y = self.offset_y + j as f64 * self.spacing_y;
                        let pos = self.origin + self.x_axis * x + self.y_axis * y;
                        points.push(pos);
                    }
                }
            }
            _ => {}
        }
        
        points
    }

    pub fn update_bounds(&mut self) {
        let lines = self.grid_lines();
        self.bounding_box = BoundingBox::empty();
        for (start, end) in lines {
            self.bounding_box.expand_point(start);
            self.bounding_box.expand_point(end);
        }
    }
}

pub type GridRef = Arc<RwLock<Grid>>;

pub struct GridBuilder {
    grid: Grid,
}

impl GridBuilder {
    pub fn new(name: String, origin: Point3, x_axis: Vector3, y_axis: Vector3, spacing_x: f64, spacing_y: f64, count_x: usize, count_y: usize) -> Self {
        Self {
            grid: Grid::new(name, origin, x_axis, y_axis, spacing_x, spacing_y, count_x, count_y),
        }
    }

    pub fn grid_type(mut self, grid_type: GridType) -> Self {
        self.grid.grid_type = grid_type;
        self
    }

    pub fn labels(mut self, prefix: String, start: usize, increment: usize) -> Self {
        self.grid.set_labels(prefix, start, increment);
        self
    }

    pub fn bubble_style(mut self, size: f64, text_height: f64) -> Self {
        self.grid.set_bubble_style(size, text_height);
        self
    }

    pub fn offsets(mut self, x: f64, y: f64) -> Self {
        self.grid.set_offsets(x, y);
        self
    }

    pub fn show_bubbles(mut self, show: bool) -> Self {
        self.grid.show_bubbles = show;
        self
    }

    pub fn show_dimensions(mut self, show: bool) -> Self {
        self.grid.show_dimensions = show;
        self
    }

    pub fn layer_name(mut self, layer_name: String) -> Self {
        self.grid.layer_name = layer_name;
        self
    }

    pub fn build(mut self) -> Grid {
        self.grid.update_bounds();
        self.grid
    }
}

pub fn grid_builder(name: String, origin: Point3, x_axis: Vector3, y_axis: Vector3, spacing_x: f64, spacing_y: f64, count_x: usize, count_y: usize) -> GridBuilder {
    GridBuilder::new(name, origin, x_axis, y_axis, spacing_x, spacing_y, count_x, count_y)
}