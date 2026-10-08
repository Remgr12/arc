use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct Slab {
    pub id: EntityId,
    pub name: String,
    pub thickness: f64,
    pub outline: Vec<Point3>,
    pub bounding_box: BoundingBox,
}

impl Slab {
    pub fn new(name: String, thickness: f64, outline: Vec<Point3>) -> Self {
        let mut slab = Self {
            id: EntityId::new(),
            name,
            thickness,
            outline,
            bounding_box: BoundingBox::empty(),
        };
        slab.update_bounding_box();
        slab
    }

    pub fn update_bounding_box(&mut self) {
        let min = self.outline.iter().fold(Point3::new(f64::INFINITY, f64::INFINITY, f64::INFINITY), |acc, p| {
            Point3::new(acc.x.min(p.x), acc.y.min(p.y), acc.z.min(p.z))
        });
        let max = self.outline.iter().fold(Point3::new(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY), |acc, p| {
            Point3::new(acc.x.max(p.x), acc.y.max(p.y), acc.z.max(p.z))
        });
        self.bounding_box = BoundingBox::new(min, max);
    }
}

pub type SlabRef = Arc<RwLock<Slab>>;