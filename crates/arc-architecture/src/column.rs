use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct Column {
    pub id: EntityId,
    pub name: String,
    pub cross_section: Vec<Point3>,
    pub height: f64,
    pub bounding_box: BoundingBox,
}

impl Column {
    pub fn new(name: String, cross_section: Vec<Point3>, height: f64) -> Self {
        let mut column = Self {
            id: EntityId::new(),
            name,
            cross_section,
            height,
            bounding_box: BoundingBox::empty(),
        };
        column.update_bounding_box();
        column
    }

    pub fn update_bounding_box(&mut self) {
        let min = self.cross_section.iter().fold(Point3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY), |acc, p| {
            Point3::new(acc.x.min(p.x), acc.y.min(p.y), acc.z.min(p.z))
        });
        let max = self.cross_section.iter().fold(Point3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY), |acc, p| {
            Point3::new(acc.x.max(p.x), acc.y.max(p.y), acc.z.max(p.z))
        });
        let min_z = Point3::new(min.x, min.y, 0.0);
        let max_z = Point3::new(max.x, max.y, self.height);
        self.bounding_box = BoundingBox::new(min_z, max_z);
    }
}

pub type ColumnRef = Arc<RwLock<Column>>;