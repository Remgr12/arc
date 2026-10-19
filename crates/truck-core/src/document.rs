use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Document {
    pub id: DocumentId,
    pub name: String,
    pub entities: Vec<EntityId>,
    pub layers: Vec<Layer>,
    pub history: Vec<Command>,
    pub units: Units,
    pub metadata: DocumentMetadata,
}

type DocumentId = Uuid;
type EntityId = Uuid;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Layer {
    pub id: Uuid,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: [f64; 3],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DocumentMetadata {
    pub author: Option<String>,
    pub created: String,
    pub modified: String,
    pub version: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Command {
    pub id: Uuid,
    pub name: String,
    pub timestamp: String,
    pub entities_changed: Vec<EntityId>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Units {
    Millimeters,
    Centimeters,
    Meters,
    Inches,
    Feet,
    Custom(f64),
}

impl Document {
    pub fn new(id: DocumentId, name: String) -> Self {
        Document {
            id,
            name,
            entities: Vec::new(),
            layers: Vec::new(),
            history: Vec::new(),
            units: Units::Millimeters,
            metadata: DocumentMetadata {
                author: None,
                created: String::new(),
                modified: String::new(),
                version: "1.0".to_string(),
            },
        }
    }

    pub fn add_entity(&mut self, entity_id: EntityId) {
        self.entities.push(entity_id);
    }

    pub fn add_layer(&mut self, layer: Layer) {
        self.layers.push(layer);
    }

    pub fn add_command(&mut self, command: Command) {
        self.history.push(command);
    }
}
