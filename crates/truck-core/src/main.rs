//!/usr/bin/env rust

pub mod annotation;
pub mod assembly;
pub mod constraints;
pub mod csg;
pub mod document;
pub mod entity;
pub mod formats;
pub mod history;
pub mod mesh;
pub mod meshgen;
pub mod nurbs;
pub mod sheetmetal;
pub mod units;

pub use assembly::{Assembly, PartDef};
pub use csg::CSG;
pub use constraints::{Constraint, ConstraintSolver};
pub use document::{Document, DocumentId};
pub use entity::{Entity, EntityId};
pub use mesh::{Mesh, Vertex};
pub use nurbs::{NURBSCurve, NURBSSurface};
pub use sheetmetal::{SheetMetal, BendInfo};
pub use units::Units;

pub struct TruckCore {
    documents: RwLock<std::collections::HashMap<DocumentId, Document>>,
    entities: RwLock<std::collections::HashMap<EntityId, Entity>>,
}

impl TruckCore {
    pub fn new() -> Self {
        info!("Initializing Truck Core geometry kernel");
        TruckCore {
            documents: RwLock::new(std::collections::HashMap::new()),
            entities: RwLock::new(std::collections::HashMap::new()),
        }
    }

    pub fn get_document(&self, id: DocumentId) -> Option<Document> {
        self.documents.read().get(&id).cloned()
    }

    pub fn create_document(&self, name: &str) -> DocumentId {
        let id = DocumentId::new();
        let mut docs = self.documents.write();
        let doc = Document::new(id, name);
        docs.insert(id, doc);
        debug!("Created document with id: {:?}", id);
        id
    }

    pub fn add_entity(&self, document_id: DocumentId, entity: Entity) -> Result<EntityId, String> {
        let id = entity.id();
        let mut docs = self.documents.write();
        let doc_opt = docs.get_mut(&document_id);
        match doc_opt {
            Some(doc) => {
                doc.add_entity(entity);
                let mut entities = self.entities.write();
                entities.insert(id, entity);
                debug!("Added entity with id: {:?}", id);
                Ok(id)
            }
            None => {
                error!("Document not found: {:?}", document_id);
                Err(format!("Document not found: {:?}", document_id))
            }
        }
    }

    pub fn get_entity(&self, id: EntityId) -> Option<Entity> {
        self.entities.read().get(&id).cloned()
    }

    pub fn export_document(&self, id: DocumentId) -> Result<String, String> {
        let docs = self.documents.read();
        let doc = docs.get(&id).ok_or_else(|| format!("Document not found: {:?}", id))?;
        // For now, export as JSON
        let json_str = serde_json::to_string(doc).map_err(|e| format!("Export failed: {}", e))?;
        debug!("Exported document {:?}", id);
        Ok(json_str)
    }

    pub fn import_document(&self, json_str: &str) -> Result<DocumentId, String> {
        let doc: Document = serde_json::from_str(json_str).map_err(|e| format!("Import failed: {}", e))?;
        let doc_id = doc.id();
        let mut docs = self.documents.write();
        docs.insert(doc_id, doc);
        debug!("Imported document with id: {:?}", doc_id);
        Ok(doc_id)
    }

    pub fn create_primitive(&self, primitive_type: &str, params: &[f64]) -> Result<Entity, String> {
        match primitive_type.to_lowercase().as_str() {
            "box" => {
                if params.len() >= 6 {
                    let entity = Entity::new_box(params[0], params[1], params[2]);
                    Ok(entity)
                } else {
                    Err("Box requires 3 dimensions".to_string())
                }
            }
            "sphere" => {
                if params.len() >= 4 {
                    let entity = Entity::new_sphere(params[0], params[1], params[2], params[3]);
                    Ok(entity)
                } else {
                    Err("Sphere requires center (x,y,z) and radius".to_string())
                }
            }
            "cylinder" => {
                if params.len() >= 5 {
                    let entity = Entity::new_cylinder(params[0], params[1], params[2], params[3], params[4]);
                    Ok(entity)
                } else {
                    Err("Cylinder requires center (x,y,z), axis (dx,dy,dz), radius, and height".to_string())
                }
            }
            "cone" => {
                if params.len() >= 7 {
                    let entity = Entity::new_cone(params[0], params[1], params[2], params[3], params[4], params[5], params[6]);
                    Ok(entity)
                } else {
                    Err("Cone requires base center (x,y,z), base radius, tip center (x,y,z), tip radius".to_string())
                }
            }
            "plane" => {
                if params.len() >= 4 {
                    let entity = Entity::new_plane(params[0], params[1], params[2], params[3]);
                    Ok(entity)
                } else {
                    Err("Plane requires normal (nx,ny,nz) and distance from origin".to_string())
                }
            }
            _ => {
                Err(format!("Unsupported primitive type: {}", primitive_type))
            }
        }
    }
}

impl fmt::Display for TruckCore {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let docs = self.documents.read();
        let entities = self.entities.read();
        write!(f, "TruckCore {{ Documents: {}, Entities: {} }}", docs.len(), entities.len())
    }
}

fn main() {
    println!("Truck Core Kernel - Geometric Kernel Implementation");
    let core = TruckCore::new();
    println!("Core initialized: {}", core);

    // Create a test document
    let doc_id = core.create_document("Test Document");
    println!("Created document: {:?}", doc_id);

    // Create and add a test entity
    match core.create_primitive("box", &[1.0, 2.0, 3.0]) {
        Ok(entity) => {
            match core.add_entity(doc_id, entity) {
                Ok(entity_id) => println!("Added entity: {:?}", entity_id),
                Err(e) => println!("Failed to add entity: {}", e),
            }
        }
        Err(e) => println!("Failed to create primitive: {}", e),
    }

    println!("Truck Core is operational");
}
