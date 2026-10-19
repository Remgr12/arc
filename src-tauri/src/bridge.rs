use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use arc_core::{Color, EntityId, Transform};
use serde::{Deserialize, Serialize};

use crate::adapter::ArcTruckAdapter;

/// Bridge between arc-core and truck CAD kernels
/// 
/// This bridge provides a unified interface for both arc-core and truck,
/// allowing gradual migration from arc-core to truck while maintaining
/// backward compatibility.
pub struct ArcCoreBridge {
    /// Adapter for geometry conversion
    adapter: ArcTruckAdapter,
    
    /// Whether to use truck kernel when available
    use_truck: bool,
    
    /// Documents managed by this bridge
    documents: HashMap<String, DocumentAdapter>,
}

impl ArcCoreBridge {
    /// Create a new bridge with default configuration
    pub fn new() -> Self {
        Self {
            adapter: ArcTruckAdapter::new(),
            use_truck: true,
            documents: HashMap::new(),
        }
    }
    
    /// Create a bridge that prefers arc-core (for testing compatibility)
    pub fn with_arc_core_fallback() -> Self {
        Self {
            adapter: ArcTruckAdapter::new(),
            use_truck: false,
            documents: HashMap::new(),
        }
    }
    
    /// Add an entity using the most appropriate kernel
    pub fn add_entity(
        &mut self,
        geometry: arc_core::Geometry,
        name: String,
        document_id: &str,
    ) -> Result<String, String> {
        // Ensure document exists
        if !self.documents.contains_key(document_id) {
            return Err(format!("Document {} not found", document_id));
        }
        
        let doc = self.documents.get_mut(document_id).unwrap();
        
        // Try truck kernel if enabled and supported
        if self.use_truck && self.adapter.is_truck_supported(&geometry) {
            // Convert geometry to truck-compatible format
            let truck_geometry = self.adapter.convert_to_truck(&geometry)
                .map_err(|e| format!("Failed to convert geometry: {}", e))?;
            
            // For now, fall back to arc-core since truck entities are different
            // TODO: Implement truck entity creation
            return Err("Truck entity creation not yet implemented".to_string());
        }
        
        // Fall back to arc-core
        doc.doc_mut("Add", |doc_core| {
            let entity = arc_core::Entity::new(
                arc_core::EntityId::new(), 
                name.clone(), 
                doc_core.active_layer, 
                geometry.clone()
            );
            let (id, res) = doc_core.add_entity(entity);
            if res.is_ok() {
                Ok(id.as_string())
            } else {
                Err("Entity creation failed".to_string())
            }
        })
    }
    
    /// Export an entity to GLTF format
    pub fn export_gltf(&mut self, entity_id: &str, document_id: &str) -> Result<String, String> {
        if !self.documents.contains_key(document_id) {
            return Err(format!("Document {} not found", document_id));
        }
        
        let doc = self.documents.get_mut(document_id).unwrap();
        
        // Try to get entity from document
        match doc.doc_ref(|doc_core| {
            doc_core.get(&arc_core::EntityId::parse(entity_id).ok_or_else(|| "Invalid entity ID".to_string())?)
        }) {
            Ok(Some(entity)) => {
                // Try truck export if available
                if self.use_truck {
                    match self.adapter.export_gltf(entity.id) {
                        Ok(gltf) => return Ok(gltf),
                        Err(e) => return Err(format!("Truck GLTF export failed: {}", e)),
                    }
                }
                
                // Fall back to arc-core export
                // For now, just return a placeholder
                Ok("placeholder gltf content".to_string())
            }
            Ok(None) => Err("Entity not found".to_string()),
            Err(e) => Err(e),
        }
    }
    
    /// Create a new document
    pub fn new_document(&mut self, name: String) -> String {
        let doc_id = format!("doc-{}", self.documents.len());
        
        // Create document using truck if enabled
        if self.use_truck {
            let adapter = DocumentAdapter::new_truck();
            self.documents.insert(doc_id.clone(), adapter);
        } else {
            let adapter: DocumentAdapter = arc_core::Document::new(name).into();
            self.documents.insert(doc_id.clone(), adapter);
        }
        
        doc_id
    }
    
    /// Enable/disable truck kernel usage
    pub fn set_use_truck(&mut self, use_truck: bool) {
        self.use_truck = use_truck;
    }
    
    /// Check if truck kernel is available and supported for the given geometry
    pub fn is_truck_supported(&self, geometry: &arc_core::Geometry) -> bool {
        self.adapter.is_truck_supported(geometry)
    }
}
