use arc_core::*;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use async_trait::async_trait;

#[derive(Debug, Clone)]
pub struct Command {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub icon: Option<String>,
    pub shortcut: Option<String>,
    pub enabled: bool,
    pub visible: bool,
    pub async_: bool,
}

impl Command {
    pub fn new(id: String, name: String, description: String, category: String) -> Self {
        Self {
            id,
            name,
            description,
            category,
            icon: None,
            shortcut: None,
            enabled: true,
            visible: true,
            async_: false,
        }
    }

    pub fn icon(mut self, icon: String) -> Self {
        self.icon = Some(icon);
        self
    }

    pub fn shortcut(mut self, shortcut: String) -> Self {
        self.shortcut = Some(shortcut);
        self
    }

    pub fn enabled(mut self, enabled: bool) -> Self {
        self.enabled = enabled;
        self
    }

    pub fn visible(mut self, visible: bool) -> Self {
        self.visible = visible;
        self
    }

    pub fn async_(mut self) -> Self {
        self.async_ = true;
        self
    }
}

#[async_trait]
pub trait CommandHandler: Send + Sync {
    async fn execute(&self, args: serde_json::Value) -> Result<serde_json::Value, CommandError>;
    fn can_execute(&self, args: &serde_json::Value) -> bool;
    fn name(&self) -> &str;
}

#[derive(Debug, Clone, thiserror::Error, Serialize, Deserialize)]
pub enum CommandError {
    #[error("Command not found: {0}")]
    NotFound(String),
    #[error("Command failed: {0}")]
    Failed(String),
    #[error("Invalid arguments: {0}")]
    InvalidArgs(String),
    #[error("Permission denied: {0}")]
    PermissionDenied(String),
    #[error("IO error: {0}")]
    IO(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
    #[error("Unknown error: {0}")]
    Unknown(String),
}

pub struct CommandManager {
    commands: dashmap::DashMap<String, Arc<dyn CommandHandler>>,
    command_info: dashmap::DashMap<String, Command>,
    shortcut_map: dashmap::DashMap<String, String>,
    history: parking_lot::RwLock<CommandHistory>,
}

impl CommandManager {
    pub fn new() -> Self {
        Self {
            commands: dashmap::DashMap::new(),
            command_info: dashmap::DashMap::new(),
            shortcut_map: dashmap::DashMap::new(),
            history: parking_lot::RwLock::new(CommandHistory::new()),
        }
    }

    pub fn register(&self, command: Command, handler: Arc<dyn CommandHandler>) {
        let id = command.id.clone();
        self.command_info.insert(id.clone(), command.clone());
        
        if let Some(shortcut) = &command.shortcut {
            self.shortcut_map.insert(shortcut.clone(), id.clone());
        }
        
        self.commands.insert(id, handler);
    }

    pub fn unregister(&self, id: &str) {
        self.commands.remove(id);
        self.command_info.remove(id);
    }

    pub fn get_handler(&self, id: &str) -> Option<Arc<dyn CommandHandler>> {
        self.commands.get(id).map(|h| h.clone())
    }

    pub fn get_info(&self, id: &str) -> Option<Command> {
        self.command_info.get(id).map(|c| c.clone())
    }

    pub fn all_commands(&self) -> Vec<Command> {
        self.command_info.iter().map(|c| c.clone()).collect()
    }

    pub fn execute(&self, id: &str, args: serde_json::Value) -> Result<serde_json::Value, CommandError> {
        let handler = self.commands.get(id).ok_or(CommandError::NotFound(id.to_string()))?;
        let info = self.command_info.get(id).ok_or(CommandError::NotFound(id.to_string()))?;
        
        if !info.enabled {
            return Err(CommandError::Failed("Command is disabled".to_string()));
        }
        
        let args_clone = args.clone();
        let result = tokio::task::block_in_place(|| {
            tokio::runtime::Handle::current().block_on(async {
                handler.execute(args).await
            })
        });
        
        if result.is_ok() {
            self.history.write().push(id, args_clone);
        }
        
        result
    }

    pub fn execute_async(&self, id: &str, args: serde_json::Value) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<serde_json::Value, CommandError>> + Send + '_>> {
        let id = id.to_string();
        let handler = self.commands.get(&id).map(|h| h.clone());
        Box::pin(async move {
            let handler = handler.ok_or(CommandError::NotFound(id.clone()))?;
            handler.execute(args).await
        })
    }

    pub fn get_command_by_shortcut(&self, shortcut: &str) -> Option<String> {
        self.shortcut_map.get(shortcut).map(|s| s.clone())
    }

    pub fn can_undo(&self) -> bool {
        self.history.read().can_undo()
    }

    pub fn can_redo(&self) -> bool {
        self.history.read().can_redo()
    }

    pub fn undo(&self) -> Result<(), CommandError> {
        self.history.write().undo().map_err(|e| CommandError::Failed(e))?;
        Ok(())
    }

    pub fn redo(&self) -> Result<(), CommandError> {
        self.history.write().redo().map_err(|e| CommandError::Failed(e))?;
        Ok(())
    }

    pub fn register_core_commands(&self) {
        let cmds = [
            ("new-document", "New Document", "Create a new document", "File"),
            ("open-document", "Open", "Open an existing document", "File"),
            ("save-document", "Save", "Save the current document", "File"),
            ("export", "Export", "Export to file", "File"),
            ("undo", "Undo", "Undo the last operation", "Edit"),
            ("redo", "Redo", "Redo the last undone operation", "Edit"),
            ("copy", "Copy", "Copy selected items", "Edit"),
            ("cut", "Cut", "Cut selected items", "Edit"),
            ("paste", "Paste", "Paste from clipboard", "Edit"),
            ("delete", "Delete", "Delete selected items", "Edit"),
        ];

        for (id, name, desc, cat) in cmds {
            let cmd = Command::new(id.to_string(), name.to_string(), desc.to_string(), cat.to_string());
            self.register(cmd, Arc::new(NoopCommandHandler));
        }
    }

    pub fn register_modeling_commands(&self) {
        let cmds = [
            ("model-extrude", "Extrude", "Extrude a profile", "Model"),
            ("model-revolve", "Revolve", "Revolve a profile", "Model"),
            ("model-loft", "Loft", "Create a loft", "Model"),
            ("model-sweep", "Sweep", "Create a sweep", "Model"),
            ("model-fillet", "Fillet", "Apply a fillet", "Model"),
            ("model-chamfer", "Chamfer", "Apply a chamfer", "Model"),
            ("model-shell", "Shell", "Create a shell", "Model"),
            ("model-union", "Union", "Boolean union", "Model"),
            ("model-difference", "Difference", "Boolean difference", "Model"),
            ("model-intersect", "Intersect", "Boolean intersection", "Model"),
        ];

        for (id, name, desc, cat) in cmds {
            let cmd = Command::new(id.to_string(), name.to_string(), desc.to_string(), cat.to_string());
            self.register(cmd, Arc::new(NoopCommandHandler));
        }
    }

    pub fn register_architecture_commands(&self) {
        let cmds = [
            ("arch-wall", "Wall", "Draw a wall", "Architecture"),
            ("arch-door", "Door", "Place a door", "Architecture"),
            ("arch-window", "Window", "Place a window", "Architecture"),
            ("arch-stair", "Stair", "Create stairs", "Architecture"),
            ("arch-roof", "Roof", "Create a roof", "Architecture"),
            ("arch-slab", "Slab", "Create a slab", "Architecture"),
            ("arch-column", "Column", "Place a column", "Architecture"),
            ("arch-beam", "Beam", "Place a beam", "Architecture"),
            ("arch-room", "Room", "Define a room", "Architecture"),
        ];

        for (id, name, desc, cat) in cmds {
            let cmd = Command::new(id.to_string(), name.to_string(), desc.to_string(), cat.to_string());
            self.register(cmd, Arc::new(NoopCommandHandler));
        }
    }

    pub fn register_edit_commands(&self) {
        let cmds = [
            ("modify-move", "Move", "Move entities", "Modify"),
            ("modify-rotate", "Rotate", "Rotate entities", "Modify"),
            ("modify-scale", "Scale", "Scale entities", "Modify"),
            ("modify-mirror", "Mirror", "Mirror entities", "Modify"),
            ("modify-offset", "Offset", "Offset entities", "Modify"),
            ("modify-pattern", "Pattern", "Create a pattern", "Modify"),
            ("modify-trim", "Trim", "Trim entities", "Modify"),
        ];

        for (id, name, desc, cat) in cmds {
            let cmd = Command::new(id.to_string(), name.to_string(), desc.to_string(), cat.to_string());
            self.register(cmd, Arc::new(NoopCommandHandler));
        }
    }

    pub fn register_view_commands(&self) {
        let cmds = [
            ("view-top", "Top View", "Switch to top view", "View"),
            ("view-front", "Front View", "Switch to front view", "View"),
            ("view-right", "Right View", "Switch to right view", "View"),
            ("view-iso", "Isometric", "Switch to isometric view", "View"),
            ("zoom-extents", "Zoom Extents", "Zoom to show everything", "View"),
            ("toggle-grid", "Toggle Grid", "Show/hide the grid", "View"),
            ("toggle-snap", "Toggle Snap", "Enable/disable snapping", "View"),
            ("toggle-ortho", "Toggle Ortho", "Enable/disable ortho mode", "View"),
        ];

        for (id, name, desc, cat) in cmds {
            let cmd = Command::new(id.to_string(), name.to_string(), desc.to_string(), cat.to_string());
            self.register(cmd, Arc::new(NoopCommandHandler));
        }
    }

    pub fn commands(&self) -> Vec<Command> {
        self.command_info.iter().map(|c| c.clone()).collect()
    }
}

impl Default for CommandManager {
    fn default() -> Self {
        Self::new()
    }
}

struct NoopCommandHandler;

#[async_trait]
impl CommandHandler for NoopCommandHandler {
    async fn execute(&self, _args: serde_json::Value) -> Result<serde_json::Value, crate::CommandError> {
        Ok(serde_json::Value::Null)
    }

    fn can_execute(&self, _args: &serde_json::Value) -> bool {
        true
    }

    fn name(&self) -> &str {
        "noop"
    }
}

use std::collections::VecDeque;
use chrono::{DateTime, Utc};
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandHistoryEntry {
    pub command_id: String,
    pub args: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub result: Result<serde_json::Value, CommandError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommandHistory {
    entries: VecDeque<CommandHistoryEntry>,
    max_entries: usize,
    undo_stack: VecDeque<CommandHistoryEntry>,
    redo_stack: VecDeque<CommandHistoryEntry>,
}

impl CommandHistory {
    pub fn new() -> Self {
        Self::with_capacity(1000)
    }

    pub fn with_capacity(max_entries: usize) -> Self {
        Self {
            entries: VecDeque::with_capacity(max_entries),
            max_entries: 1000,
            undo_stack: VecDeque::new(),
            redo_stack: VecDeque::new(),
        }
    }

    pub fn push(&mut self, command_id: &str, args: serde_json::Value) {
        if self.entries.len() >= self.max_entries {
            self.entries.pop_front();
        }
        
        self.entries.push_back(CommandHistoryEntry {
            command_id: command_id.to_string(),
            args,
            timestamp: chrono::Utc::now(),
            result: Ok(serde_json::Value::Null),
        });
        
        self.redo_stack.clear();
    }

    pub fn complete(&mut self, result: Result<serde_json::Value, CommandError>) {
        if let Some(entry) = self.entries.back_mut() {
            entry.result = result;
            if entry.result.is_ok() {
                self.undo_stack.push_back(entry.clone());
                if self.undo_stack.len() > 100 {
                    self.undo_stack.pop_front();
                }
            }
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn undo(&mut self) -> Result<Option<String>, String> {
        if let Some(entry) = self.undo_stack.pop_back() {
            self.redo_stack.push_back(entry.clone());
            Ok(Some(entry.command_id))
        } else {
            Err("Nothing to undo".to_string())
        }
    }

    pub fn redo(&mut self) -> Result<Option<String>, String> {
        if let Some(entry) = self.redo_stack.pop_back() {
            self.undo_stack.push_back(entry.clone());
            Ok(Some(entry.command_id))
        } else {
            Err("Nothing to redo".to_string())
        }
    }

    pub fn clear(&mut self) {
        self.entries.clear();
        self.undo_stack.clear();
        self.redo_stack.clear();
    }
}

impl Default for CommandHistory {
    fn default() -> Self {
        Self::new()
    }
}