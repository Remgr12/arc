/// Bridge between arc-core and truck CAD kernels
/// 
/// This bridge provides a unified interface for both arc-core and truck,
/// allowing gradual migration from arc-core to truck while maintaining
/// backward compatibility.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use arc_core::{Color, Document, Entity, EntityId, Geometry, MeshBuffer, RayHit, Transform};

use crate::adapter::ArcTruckAdapter;

/// Document interface that can work with either arc-core or truck
#[derive(Debug, Clone)]
pub struct DocumentAdapter {
    /// The actual document implementation
    inner: DocumentImpl,
}

#[derive(Debug, Clone)]
enum DocumentImpl {
    ArcCore(arc_core::Document),
    Truck(TruckDocument),
}

#[derive(Debug, Clone)]
struct TruckDocument {
    /// Truck-specific representation
    pub entities: HashMap<EntityId, TruckEntity>,
    pub layers: HashMap<EntityId, Layer>,
    pub active_layer: EntityId,
    pub scene_data: SceneData,
}

#[derive(Debug, Clone)]
struct TruckEntity {
    pub id: EntityId,
    pub name: String,
    pub layer: EntityId,
    pub visible: bool,
    pub locked: bool,
    pub color: Option<Color>,
    pub transform: Transform,
    pub geometry: Geometry,
    pub material: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: EntityId,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Color,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneData {
    pub entities: Vec<(EntityId, EntityData)>,
    pub lights: Vec<LightData>,
    pub camera: CameraData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EntityData {
    pub name: String,
    pub position: [f64; 3],
    pub rotation: [f64; 4],
    pub scale: [f64; 3],
    pub geometry_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LightData {
    pub position: [f64; 3],
    pub color: [f64; 3],
    pub intensity: f64,
    pub radius: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraData {
    pub position: [f64; 3],
    pub target: [f64; 3],
    pub up: [f64; 3],
    pub fov: f64,
}

impl DocumentAdapter {
    /// Create a new document adapter with truck backend
    pub fn new_truck() -> Self {
        let truck_doc = TruckDocument {
            entities: HashMap::new(),
            layers: HashMap::new(),
            active_layer: EntityId::nil(),
            scene_data: SceneData {
                entities: Vec::new(),
                lights: Vec::new(),
                camera: CameraData::default(),
            },
        };
        Self {
            inner: DocumentImpl::Truck(truck_doc),
        }
    }
    
    /// Create a new document adapter with arc-core backend
    pub fn new_arc_core() -> Self {
        let arc_doc = arc_core::Document::new("Default".to_string());
        Self {
            inner: DocumentImpl::ArcCore(arc_doc),
        }
    }
    
    /// Get the document reference for operations
    pub fn doc_ref<F, R>(&mut self, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut arc_core::Document) -> R,
    {
        match &mut self.inner {
            DocumentImpl::ArcCore(doc) => Ok(f(doc)),
            DocumentImpl::Truck(_) => Err("Truck backend not yet supported for this operation".to_string()),
        }
    }
    
    /// Get mutable document reference for operations
    pub fn doc_mut<F, R>(&mut self, label: &str, f: F) -> Result<R, String>
    where
        F: FnOnce(&mut arc_core::Document) -> R,
    {
        match &mut self.inner {
            DocumentImpl::ArcCore(doc) => Ok(f(doc)),
            DocumentImpl::Truck(_) => Err("Truck backend not yet supported for this operation".to_string()),
        }
    }
    
    /// Convert to scene data for export
    pub fn scene_data(&self) -> SceneEnvelope {
        match &self.inner {
            DocumentImpl::ArcCore(doc) => doc.scene_data(),
            DocumentImpl::Truck(truck_doc) => {
                let entities: Vec<(EntityId, EntityData)> = truck_doc
                    .entities
                    .values()
                    .map(|entity| {
                        let transform = entity.transform;
                        (
                            entity.id,
                            EntityData {
                                name: entity.name.clone(),
                                position: transform.position,
                                rotation: transform.rotation,
                                scale: transform.scale,
                                geometry_type: "unsupported".to_string(),
                            },
                        )
                    })
                    .collect();
                
                SceneEnvelope {
                    document_id: "temp".to_string(),
                    scene: SceneData {
                        entities,
                        lights: truck_doc.scene_data.lights.clone(),
                        camera: truck_doc.scene_data.camera.clone(),
                    },
                }
            }
        }
    }
    
    /// Add an entity using the adapter
    pub fn add_entity(
        &mut self,
        entity: Entity,
        adapter: &ArcTruckAdapter,
    ) -> Result<(EntityId, Result<(), String>), String> {
        match &mut self.inner {
            DocumentImpl::ArcCore(doc) => {
                let (id, res) = doc.add_entity(entity);
                Ok((id, res))
            }
            DocumentImpl::Truck(_) => {
                // Convert arc-core entity to truck entity
                // This is a placeholder for future implementation
                Err("Truck backend entity creation not yet implemented".to_string())
            }
        }
    }
    
    /// Check if we have a truck backend available
    pub fn has_truck_support(&self) -> bool {
        matches!(&self.inner, DocumentImpl::Truck(_))
    }
}

impl Default for CameraData {
    fn default() -> Self {
        Self {
            position: [0.0, 10.0, 10.0],
            target: [0.0, 0.0, 0.0],
            up: [0.0, 1.0, 0.0],
            fov: 45.0,
        }
    }
}

impl From<arc_core::Document> for DocumentAdapter {
    fn from(doc: arc_core::Document) -> Self {
        Self {
            inner: DocumentImpl::ArcCore(doc),
        }
    }
}
