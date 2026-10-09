use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3};
use crate::{EntityId, EntityRef, BoundingBox, Transform, Color};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SnapSettings {
    pub enabled: bool,
    pub grid_snap: bool,
    pub grid_spacing: f64,
    pub endpoint_snap: bool,
    pub midpoint_snap: bool,
    pub center_snap: bool,
    pub intersection_snap: bool,
    pub perpendicular_snap: bool,
    pub tangent_snap: bool,
    pub nearest_snap: bool,
    pub apparent_intersection_snap: bool,
    pub extension_snap: bool,
    pub parallel_snap: bool,
    pub quadrant_snap: bool,
    pub insert_snap: bool,
    pub node_snap: bool,
    pub snap_radius: f64,
    pub aperture: f64,
    pub snap_to_grid_only: bool,
}

impl SnapSettings {
    pub fn new() -> Self {
        Self {
            enabled: true,
            grid_snap: true,
            grid_spacing: 1000.0,
            endpoint_snap: true,
            midpoint_snap: true,
            center_snap: true,
            intersection_snap: true,
            perpendicular_snap: true,
            tangent_snap: true,
            nearest_snap: true,
            apparent_intersection_snap: true,
            extension_snap: true,
            parallel_snap: true,
            quadrant_snap: true,
            insert_snap: true,
            node_snap: true,
            snap_radius: 10.0,
            aperture: 10.0,
            snap_to_grid_only: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SnapResult {
    pub point: Point3<f64>,
    pub entity_id: Option<EntityId>,
    pub snap_type: SnapType,
    pub distance: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SnapType {
    None,
    Endpoint,
    Midpoint,
    Center,
    Intersection,
    Perpendicular,
    Tangent,
    Nearest,
    ApparentIntersection,
    Extension,
    Parallel,
    Quadrant,
    Insert,
    Node,
    Grid,
}

impl Default for SnapResult {
    fn default() -> Self {
        Self {
            point: Point3::origin(),
            entity_id: None,
            snap_type: SnapType::None,
            distance: f64::INFINITY,
        }
    }
}

impl SnapResult {
    pub fn is_valid(&self) -> bool {
        self.snap_type != SnapType::None && self.distance < f64::INFINITY
    }
}

use parking_lot::Mutex;

pub struct SnapEngine {
    settings: SnapSettings,
    snap_cache: Mutex<Vec<SnapPoint>>,
}

#[derive(Debug, Clone)]
struct SnapPoint {
    point: Point3<f64>,
    entity_id: EntityId,
    snap_type: SnapType,
}

impl SnapEngine {
    pub fn new(settings: SnapSettings) -> Self {
        Self {
            settings,
            snap_cache: Mutex::new(Vec::new()),
        }
    }

    pub fn update_settings(&mut self, settings: SnapSettings) {
        self.settings = settings;
    }

    pub fn settings(&self) -> &SnapSettings {
        &self.settings
    }

    pub fn find_snap(&self, screen_point: Point3<f64>, viewport: &crate::ViewportState, entities: &crate::EntityContainer) -> SnapResult {
        if !self.settings.enabled {
            return SnapResult::default();
        }

        self.build_cache(entities);
        
        let mut best = SnapResult::default();
        let screen_radius = self.settings.snap_radius;

        for snap_point in self.snap_cache.lock().iter() {
            let distance = self.screen_distance(screen_point, snap_point.point, viewport);
            if distance < screen_radius && distance < best.distance {
                best = SnapResult {
                    point: snap_point.point,
                    entity_id: Some(snap_point.entity_id),
                    snap_type: snap_point.snap_type,
                    distance,
                };
            }
        }

        if self.settings.grid_snap && best.snap_type == SnapType::None {
            let grid_point = self.snap_to_grid(screen_point);
            let distance = self.screen_distance(screen_point, grid_point, viewport);
            if distance < screen_radius {
                best = SnapResult {
                    point: grid_point,
                    entity_id: None,
                    snap_type: SnapType::Grid,
                    distance,
                };
            }
        }

        best
    }

    fn build_cache(&self, entities: &crate::EntityContainer) {
        self.snap_cache.lock().clear();
        
        for entity_ref in entities.iter() {
            let entity = entity_ref.read();
            if !entity.visible() || entity.locked() {
                continue;
            }
            
            self.cache_entity_snap_points(&*entity);
        }
    }

    fn cache_entity_snap_points(&self, entity: &dyn crate::Entity) {
        match entity.entity_type() {
            crate::EntityType::Point => {
                if self.settings.node_snap {
                    self.snap_cache.lock().push(SnapPoint {
                        point: entity.bounding_box().center(),
                        entity_id: entity.id(),
                        snap_type: SnapType::Node,
                    });
                }
            }
            crate::EntityType::Line => {
                if self.settings.endpoint_snap {
                    let bbox = entity.bounding_box();
                    self.snap_cache.lock().push(SnapPoint {
                        point: bbox.min,
                        entity_id: entity.id(),
                        snap_type: SnapType::Endpoint,
                    });
                    self.snap_cache.lock().push(SnapPoint {
                        point: bbox.max,
                        entity_id: entity.id(),
                        snap_type: SnapType::Endpoint,
                    });
                }
                if self.settings.midpoint_snap {
                    let bbox = entity.bounding_box();
                    let mid = Point3::new(
                        (bbox.min.x + bbox.max.x) * 0.5,
                        (bbox.min.y + bbox.max.y) * 0.5,
                        (bbox.min.z + bbox.max.z) * 0.5,
                    );
                    self.snap_cache.lock().push(SnapPoint {
                        point: mid,
                        entity_id: entity.id(),
                        snap_type: SnapType::Midpoint,
                    });
                }
            }
            crate::EntityType::Circle | crate::EntityType::Arc => {
                if self.settings.center_snap {
                    let center = entity.bounding_box().center();
                    self.snap_cache.lock().push(SnapPoint {
                        point: center,
                        entity_id: entity.id(),
                        snap_type: SnapType::Center,
                    });
                }
                if self.settings.quadrant_snap {
                    let center = entity.bounding_box().center();
                    let radius = (entity.bounding_box().size().x * 0.5).abs();
                    for angle in [0.0_f64, 90.0, 180.0, 270.0].iter() {
                        let rad = angle.to_radians();
                        let point = Point3::new(
                            center.x + radius * rad.cos(),
                            center.y + radius * rad.sin(),
                            center.z,
                        );
                        self.snap_cache.lock().push(SnapPoint {
                            point,
                            entity_id: entity.id(),
                            snap_type: SnapType::Quadrant,
                        });
                    }
                }
            }
            _ => {}
        }
    }

    fn snap_to_grid(&self, point: Point3<f64>) -> Point3<f64> {
        let spacing = self.settings.grid_spacing;
        Point3::new(
            (point.x / spacing).round() * spacing,
            (point.y / spacing).round() * spacing,
            (point.z / spacing).round() * spacing,
        )
    }

    fn screen_distance(&self, p1: Point3<f64>, p2: Point3<f64>, viewport: &crate::ViewportState) -> f64 {
        let vp1 = viewport.view_projection_matrix().transform_point(&p1);
        let vp2 = viewport.view_projection_matrix().transform_point(&p2);
        let dx = vp1.x - vp2.x;
        let dy = vp1.y - vp2.y;
        (dx * dx + dy * dy).sqrt()
    }
}