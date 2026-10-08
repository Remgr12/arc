use arc_core::*;
use arc_geometry::*;
use arc_modeling::*;
use arc_architecture::*;
use serde::{Serialize, Deserialize};
use std::sync::Arc;
use parking_lot::RwLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginAPI {
    pub version: String,
    pub functions: Vec<APIFunction>,
    pub types: Vec<APIType>,
    pub constants: Vec<APIConstant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIFunction {
    pub name: String,
    pub description: String,
    pub parameters: Vec<APIParameter>,
    pub return_type: String,
    pub async_: bool,
    pub deprecated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIParameter {
    pub name: String,
    pub type_: String,
    pub description: String,
    pub required: bool,
    pub default: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIType {
    pub name: String,
    pub description: String,
    pub fields: Vec<APIField>,
    pub methods: Vec<APIMethod>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIField {
    pub name: String,
    pub type_: String,
    pub description: String,
    pub readonly: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIMethod {
    pub name: String,
    pub description: String,
    pub parameters: Vec<APIParameter>,
    pub return_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIConstant {
    pub name: String,
    pub type_: String,
    pub value: serde_json::Value,
    pub description: String,
}

pub fn generate_plugin_api() -> PluginAPI {
    PluginAPI {
        version: "1.0.0".to_string(),
        functions: vec![
            APIFunction {
                name: "createDocument".to_string(),
                description: "Create a new document".to_string(),
                parameters: vec![
                    APIParameter {
                        name: "name".to_string(),
                        type_: "string".to_string(),
                        description: "Document name".to_string(),
                        required: true,
                        default: None,
                    },
                ],
                return_type: "Document".to_string(),
                async_: false,
                deprecated: false,
            },
            APIFunction {
                name: "openDocument".to_string(),
                description: "Open an existing document".to_string(),
                parameters: vec![
                    APIParameter {
                        name: "path".to_string(),
                        type_: "string".to_string(),
                        description: "File path".to_string(),
                        required: true,
                        default: None,
                    },
                ],
                return_type: "Document".to_string(),
                async_: true,
                deprecated: false,
            },
            APIFunction {
                name: "saveDocument".to_string(),
                description: "Save the current document".to_string(),
                parameters: vec![
                    APIParameter {
                        name: "document".to_string(),
                        type_: "Document".to_string(),
                        description: "Document to save".to_string(),
                        required: true,
                        default: None,
                    },
                ],
                return_type: "void".to_string(),
                async_: true,
                deprecated: false,
            },
        ],
        types: vec![
            APIType {
                name: "Document".to_string(),
                description: "A CAD document".to_string(),
                fields: vec![
                    APIField { name: "id".to_string(), type_: "string".to_string(), description: "Document ID".to_string(), readonly: true },
                    APIField { name: "name".to_string(), type_: "string".to_string(), description: "Document name".to_string(), readonly: false },
                    APIField { name: "modified".to_string(), type_: "boolean".to_string(), description: "Whether document is modified".to_string(), readonly: true },
                    APIField { name: "version".to_string(), type_: "number".to_string(), description: "Document version".to_string(), readonly: true },
                ],
                methods: vec![
                    APIMethod { name: "getEntities".to_string(), description: "Get all entities".to_string(), parameters: vec![], return_type: "Entity[]".to_string() },
                    APIMethod { name: "addEntity".to_string(), description: "Add an entity".to_string(), parameters: vec![APIParameter { name: "entity".to_string(), type_: "Entity".to_string(), description: "Entity to add".to_string(), required: true, default: None }], return_type: "Entity".to_string() },
                    APIMethod { name: "removeEntity".to_string(), description: "Remove an entity".to_string(), parameters: vec![APIParameter { name: "id".to_string(), type_: "string".to_string(), description: "Entity ID".to_string(), required: true, default: None }], return_type: "void".to_string() },
                ],
            },
            APIType {
                name: "Entity".to_string(),
                description: "Base entity type".to_string(),
                fields: vec![
                    APIField { name: "id".to_string(), type_: "string".to_string(), description: "Entity ID".to_string(), readonly: true },
                    APIField { name: "name".to_string(), type_: "string".to_string(), description: "Entity name".to_string(), readonly: false },
                    APIField { name: "type".to_string(), type_: "string".to_string(), description: "Entity type".to_string(), readonly: true },
                    APIField { name: "visible".to_string(), type_: "boolean".to_string(), description: "Visibility".to_string(), readonly: false },
                    APIField { name: "locked".to_string(), type_: "boolean".to_string(), description: "Lock state".to_string(), readonly: false },
                ],
                methods: vec![],
            },
            APIType {
                name: "Point3".to_string(),
                description: "3D point".to_string(),
                fields: vec![
                    APIField { name: "x".to_string(), type_: "number".to_string(), description: "X coordinate".to_string(), readonly: false },
                    APIField { name: "y".to_string(), type_: "number".to_string(), description: "Y coordinate".to_string(), readonly: false },
                    APIField { name: "z".to_string(), type_: "number".to_string(), description: "Z coordinate".to_string(), readonly: false },
                ],
                methods: vec![
                    APIMethod { name: "distanceTo".to_string(), description: "Distance to another point".to_string(), parameters: vec![APIParameter { name: "other".to_string(), type_: "Point3".to_string(), description: "Other point".to_string(), required: true, default: None }], return_type: "number".to_string() },
                    APIField { name: "add".to_string(), type_: "Point3".to_string(), description: "Add vector".to_string(), readonly: false },
                    APIField { name: "subtract".to_string(), type_: "Point3".to_string(), description: "Subtract vector".to_string(), readonly: false },
                ],
            },
            APIType {
                name: "Vector3".to_string(),
                description: "3D vector".to_string(),
                fields: vec![
                    APIField { name: "x".to_string(), type_: "number".to_string(), description: "X component".to_string(), readonly: false },
                    APIField { name: "y".to_string(), type_: "number".to_string(), description: "Y component".to_string(), readonly: false },
                    APIField { name: "z".to_string(), type_: "number".to_string(), description: "Z component".to_string(), readonly: false },
                ],
                methods: vec![],
            },
            APIType {
                name: "Color".to_string(),
                description: "RGBA color".to_string(),
                fields: vec![
                    APIField { name: "r".to_string(), type_: "number".to_string(), description: "Red (0-1)".to_string(), readonly: false },
                    APIField { name: "g".to_string(), type_: "number".to_string(), description: "Green (0-1)".to_string(), readonly: false },
                    APIField { name: "b".to_string(), type_: "number".to_string(), description: "Blue (0-1)".to_string(), readonly: false },
                    APIField { name: "a".to_string(), type_: "number".to_string(), description: "Alpha (0-1)".to_string(), readonly: false },
                ],
                methods: vec![],
            },
        ],
        constants: vec![
            APIConstant { name: "PI".to_string(), type_: "number".to_string(), value: serde_json::Value::Number(serde_json::Number::from_f64(std::f64::consts::PI).unwrap()), description: "Pi constant".to_string() },
            APIConstant { name: "DEG_TO_RAD".to_string(), type_: "number".to_string(), value: serde_json::Value::Number(serde_json::Number::from_f64(std::f64::consts::PI / 180.0).unwrap()), description: "Degrees to radians".to_string() },
            APIConstant { name: "RAD_TO_DEG".to_string(), type_: "number".to_string(), value: serde_json::Value::Number(serde_json::Number::from_f64(180.0 / std::f64::consts::PI).unwrap()), description: "Radians to degrees".to_string() },
        ],
    }
}

#[derive(Debug, Clone)]
pub struct APIDocumentation {
    pub api: PluginAPI,
    pub markdown: String,
}

impl APIDocumentation {
    pub fn generate(api: &PluginAPI) -> Self {
        let mut md = String::new();
        
        md.push_str(&format!("# ARC Plugin API v{}\n\n", api.version));
        
        md.push_str("## Functions\n\n");
        for func in &api.functions {
            md.push_str(&format!("### `{}`\n", func.name));
            md.push_str(&format!("{}\n\n", func.description));
            md.push_str("**Parameters:**\n\n");
            for param in &func.parameters {
                let req = if param.required { " (required)" } else { " (optional)" };
                let def = param.default.as_ref().map(|d| format!(" = {}", d)).unwrap_or_default();
                md.push_str(&format!("- `{}: {}`{}{}\n", param.name, param.type_, req, def));
                md.push_str(&format!("  - {}\n", param.description));
            }
            md.push_str(&format!("\n**Returns:** `{}`\n\n", func.return_type));
            if func.async_ {
                md.push_str("*Async function*\n\n");
            }
            if func.deprecated {
                md.push_str("*Deprecated*\n\n");
            }
        }
        
        md.push_str("## Types\n\n");
        for typ in &api.types {
            md.push_str(&format!("### `{}`\n", typ.name));
            md.push_str(&format!("{}\n\n", typ.description));
            
            md.push_str("**Fields:**\n\n");
            for field in &typ.fields {
                let ro = if field.readonly { " (readonly)" } else { "" };
                md.push_str(&format!("- `{}: {}`{}\n", field.name, field.type_, ro));
                md.push_str(&format!("  - {}\n", field.description));
            }
            
            if !typ.methods.is_empty() {
                md.push_str("\n**Methods:**\n\n");
                for method in &typ.methods {
                    md.push_str(&format!("#### `{}`\n", method.name));
                    md.push_str(&format!("{}\n\n", method.description));
                    for param in &method.parameters {
                        let req = if param.required { " (required)" } else { " (optional)" };
                        md.push_str(&format!("- `{}: {}`{}\n", param.name, param.type_, req));
                    }
                    md.push_str(&format!("\n**Returns:** `{}`\n\n", method.return_type));
                }
            }
        }
        
        md.push_str("## Constants\n\n");
        for constant in &api.constants {
            md.push_str(&format!("- `{}: {} = {}`\n", constant.name, constant.type_, constant.value));
            md.push_str(&format!("  - {}\n", constant.description));
        }
        
        Self {
            api: api.clone(),
            markdown: md,
        }
    }

    pub fn to_markdown(&self) -> &str {
        &self.markdown
    }

    pub fn to_html(&self) -> String {
        let mut html = String::new();
        html.push_str("<!DOCTYPE html>\n<html>\n<head>\n");
        html.push_str("<title>ARC Plugin API</title>\n");
        html.push_str("<style>\n");
        html.push_str("body { font-family: system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }\n");
        html.push_str("code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }\n");
        html.push_str("pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }\n");
        html.push_str("h1, h2, h3, h4 { color: #333; }\n");
        html.push_str("table { border-collapse: collapse; width: 100%; }\n");
        html.push_str("th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }\n");
        html.push_str("th { background: #f4f4f4; }\n");
        html.push_str("</style>\n");
        html.push_str("</head>\n<body>\n");
        
        let parser = pulldown_cmark::Parser::new(&self.markdown);
        pulldown_cmark::html::push_html(&mut html, parser);
        
        html.push_str("</body>\n</html>");
        html
    }
}