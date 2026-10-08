use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone)]
pub struct Beam {
    pub id: EntityId,
    pub name: String,
    pub start: Point3,
    pub end: Point3,
    pub cross_section: Vec<Point3>,
    pub bounding_box: BoundingBox,
}

impl Beam {
    pub fn new(name: String, start: Point3, end: Point3, cross_section: Vec<Point3>) -> Self {
        let mut beam = Self {
            id: EntityId::new(),
            name,
            start,
            end,
            cross_section,
            bounding_box: BoundingBox::empty(),
        };
        beam.update_bounding_box();
        beam
    }

    pub fn update_bounding_box(&mut self) {
        let min = Point3::new(
            self.start.x.min(self.end.x),
            self.start.y.min(self.end.y),
            self.start.z.min(self.end.z),
        );
        let max = Point3::new(
            self.start.x.max(self.end.x),
            self.start.y.max(self.end.y),
            self.start.z.max(self.end.z),
        );
        let min = Point3::new(
            min.x.min(self.cross_section.iter().map(|p| p.x).fold(f64::INFINITY, |a, b| a.min(b))),
            min.y.min(self.cross_section.iter().map(|p| p.y).fold(f64::INFINITY, |a, b| a.min(b))),
            min.z.min(self.cross_section.iter().map(|p| p.z).fold(f64::INFINITY, |a, b| a.min(b))),
        );
        let max = Point3::new(
            max.x.max(self.cross_section.iter().map(|p| p.x).fold(f64::NEG_INFINITY, |a, b| a.max(b))),
            max.y.max(self.cross_section.iter().map(|p| p.y).fold(f64::NEG_INFINITY, |a, b| a.max(b))),
            max.z.max(self.cross_section.iter().map(|p| p.z).fold(f64::NEG_INFINITY, |a, b| a.max(b))),
        );
        self.bounding_box = BoundingBox::new(min, max);
    }
}

pub type BeamRef = Arc<RwLock<Beam>>;