use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IPCMessage {
    pub id: String,
    pub r#type: IPCMessageType,
    pub method: String,
    pub params: serde_json::Value,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IPCMessageType {
    Request,
    Response,
    Event,
    Error,
}

pub struct IPCHandler;

impl IPCHandler {
    pub fn new() -> Self {
        Self
    }

    pub fn process(&self, message: IPCMessage) -> Result<IPCResponse, IPCError> {
        match message.r#type {
            IPCMessageType::Request => self.handle_request(&message.method, &message.params),
            IPCMessageType::Event => Ok(IPCResponse::event(message.method, serde_json::Value::Null)),
            _ => Err(IPCError::InvalidMessage),
        }
    }

    fn handle_request(&self, method: &str, params: &serde_json::Value) -> Result<IPCResponse, IPCError> {
        match method {
            "new_document" => {
                let name = params.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled");
                Ok(IPCResponse::success(serde_json::json!({ "document_id": "doc_123", "name": name })))
            }
            "open_document" => {
                let path = params.get("path").and_then(|v| v.as_str()).unwrap_or("");
                Ok(IPCResponse::success(serde_json::json!({ "document_id": "doc_456", "path": path })))
            }
            "save_document" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "execute_command" => {
                let command_id = params.get("command_id").and_then(|v| v.as_str()).unwrap_or("");
                let args = params.get("args").cloned().unwrap_or_default();
                Ok(IPCResponse::success(serde_json::json!({ "result": command_id })))
            }
            "get_documents" => {
                Ok(IPCResponse::success(serde_json::json!({ "documents": [] })))
            }
            "get_settings" => {
                Ok(IPCResponse::success(serde_json::json!({ "settings": {} })))
            }
            "set_setting" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "get_plugins" => {
                Ok(IPCResponse::success(serde_json::json!({ "plugins": [] })))
            }
            "create_entity" => {
                let entity_type = params.get("entity_type").and_then(|v| v.as_str()).unwrap_or("");
                Ok(IPCResponse::success(serde_json::json!({ "entity_id": "entity_123", "type": entity_type })))
            }
            "delete_entity" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "update_entity" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "get_selection" => {
                Ok(IPCResponse::success(serde_json::json!({ "selection": [] })))
            }
            "set_selection" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "get_viewport" => {
                Ok(IPCResponse::success(serde_json::json!({ "camera": { "position": [0, 0, 10], "target": [0, 0, 0], "up": [0, 0, 1] } })))
            }
            "set_viewport" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "raycast" => {
                Ok(IPCResponse::success(serde_json::json!({ "hit": null })))
            }
            "get_snap_point" => {
                Ok(IPCResponse::success(serde_json::json!({ "snap": null })))
            }
            "undo" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "redo" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "can_undo" => {
                Ok(IPCResponse::success(serde_json::json!({ "can_undo": false })))
            }
            "can_redo" => {
                Ok(IPCResponse::success(serde_json::json!({ "can_redo": false })))
            }
            "enable_plugin" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            "disable_plugin" => {
                Ok(IPCResponse::success(serde_json::json!({ "success": true })))
            }
            _ => Err(IPCError::MethodNotFound),
        }
    }
}

impl Default for IPCHandler {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IPCResponse {
    pub id: String,
    pub r#type: IPCMessageType,
    pub success: bool,
    pub data: serde_json::Value,
    pub error: Option<String>,
}

impl IPCResponse {
    pub fn success(data: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: IPCMessageType::Response,
            success: true,
            data,
            error: None,
        }
    }

    pub fn error(message: String) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: IPCMessageType::Error,
            success: false,
            data: serde_json::Value::Null,
            error: Some(message),
        }
    }

    pub fn event(method: String, data: serde_json::Value) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            r#type: IPCMessageType::Event,
            success: true,
            data,
            error: None,
        }
    }
}

#[derive(Debug)]
pub enum IPCError {
    InvalidMessage,
    MethodNotFound,
    InternalError(String),
}

impl std::fmt::Display for IPCError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IPCError::InvalidMessage => write!(f, "Invalid IPC message"),
            IPCError::MethodNotFound => write!(f, "IPC method not found"),
            IPCError::InternalError(msg) => write!(f, "Internal error: {}", msg),
        }
    }
}

impl std::error::Error for IPCError {}