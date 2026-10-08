use std::collections::HashMap;
use std::sync::Arc;
use parking_lot::RwLock;
use serde_json::Value;
use arc_core::{Document, EntityId, EntityType, Selection};
use crate::app_state::AppState;

pub struct CommandProcessor {
    commands: HashMap<String, CommandEntry>,
}

pub struct CommandEntry {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub icon: Option<String>,
    pub shortcut: Option<String>,
    pub handler: Arc<dyn CommandHandler>,
}

pub trait CommandHandler: Send + Sync {
    fn execute(&self, args: Value) -> Result<Value, String>;
    fn can_execute(&self, args: &Value) -> bool;
}

pub struct CommandContext {
    pub document: Option<Arc<RwLock<Document>>>,
    pub selection: Option<Selection>,
    pub app_state: Arc<RwLock<AppState>>,
}

pub type AppStateRef = Arc<RwLock<AppState>>;

impl CommandProcessor {
    pub fn new() -> Self {
        Self {
            commands: HashMap::new(),
        }
    }

    pub fn register(&mut self, id: String, name: String, description: String, handler: Arc<dyn CommandHandler>) {
        self.commands.insert(id.clone(), CommandEntry {
            id,
            name,
            description,
            category: "General".to_string(),
            icon: None,
            shortcut: None,
            handler,
        });
    }

    pub fn execute(&self, id: &str, args: Value) -> Result<Value, String> {
        let entry = self.commands.get(id)
            .ok_or_else(|| format!("Command not found: {}", id))?;

        if !entry.handler.can_execute(&args) {
            return Err("Command cannot be executed in current context".to_string());
        }

        entry.handler.execute(args)
    }

    pub fn can_execute(&self, id: &str, args: &Value) -> bool {
        self.commands.get(id)
            .map(|e| e.handler.can_execute(args))
            .unwrap_or(false)
    }

    pub fn list(&self) -> Vec<(&String, &CommandEntry)> {
        self.commands.iter().collect()
    }
}

impl Default for CommandProcessor {
    fn default() -> Self {
        Self::new()
    }
}