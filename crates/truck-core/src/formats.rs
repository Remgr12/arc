use super::document::Document;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Format {
    pub name: String,
    pub extensions: Vec<String>,
    pub version: String,
}

pub struct FormatWriter;

impl FormatWriter {
    pub fn write_document(doc: &Document, path: &str) -> Result<(), String> {
        let json = serde_json::to_string(doc).map_err(|e| format!("Failed to serialize document: {}", e))?;
        std::fs::write(path, json).map_err(|e| format!("Failed to write document: {}", e))?;
        Ok(())
    }
}

pub struct FormatReader;

impl FormatReader {
    pub fn read_document(path: &str) -> Result<Document, String> {
        let content = std::fs::read_to_string(path).map_err(|e| format!("Failed to read document: {}", e))?;
        let doc = serde_json::from_str(&content).map_err(|e| format!("Failed to parse document: {}", e))?;
        Ok(doc)
    }
}

pub struct DocumentFormats;

impl DocumentFormats {
    pub fn supported_formats() -> Vec<Format> {
        let mut formats = Vec::new();
        formats.push(Format {
            name: "ARC Native".to_string(),
            extensions: vec!["arc".to_string()],
            version: "1.0".to_string(),
        });
        formats.push(Format {
            name: "OBJ".to_string(),
            extensions: vec!["obj".to_string()],
            version: "2.0".to_string(),
        });
        formats.push(Format {
            name: "STL".to_string(),
            extensions: vec!["stl".to_string()],
            version: "ASCII".to_string(),
        });
        formats
    }
}

