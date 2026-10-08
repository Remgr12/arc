use std::collections::VecDeque;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::{EntityId, EntityRef};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct History {
    pub undo_stack: VecDeque<HistoryEntry>,
    pub redo_stack: VecDeque<HistoryEntry>,
    pub max_size: usize,
    pub group_depth: usize,
    pub current_group: Option<HistoryGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: EntityId,
    pub action_type: HistoryActionType,
    pub description: String,
    pub timestamp: u64,
    pub data: HistoryData,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HistoryActionType {
    Create,
    Delete,
    Modify,
    Transform,
    PropertyChange,
    Group,
    Ungroup,
    Import,
    Export,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HistoryData {
    EntityCreated { entity_id: EntityId, entity_data: Vec<u8> },
    EntityDeleted { entity_id: EntityId, entity_data: Vec<u8> },
    EntityModified { entity_id: EntityId, old_data: Vec<u8>, new_data: Vec<u8> },
    TransformChanged { entity_id: EntityId, old_transform: crate::Transform, new_transform: crate::Transform },
    PropertyChanged { entity_id: EntityId, property: String, old_value: serde_json::Value, new_value: serde_json::Value },
    SelectionChanged { old_selection: Vec<EntityId>, new_selection: Vec<EntityId> },
    ViewChanged { old_view: crate::ViewportState, new_view: crate::ViewportState },
    LayerChanged { layer_id: EntityId, old_data: Vec<u8>, new_data: Vec<u8> },
    Custom { data: Vec<u8> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryGroup {
    pub id: EntityId,
    pub description: String,
    pub entries: Vec<HistoryEntry>,
    pub timestamp: u64,
}

impl History {
    pub fn new() -> Self {
        Self {
            undo_stack: VecDeque::new(),
            redo_stack: VecDeque::new(),
            max_size: 100,
            group_depth: 0,
            current_group: None,
        }
    }

    pub fn with_max_size(max_size: usize) -> Self {
        Self {
            undo_stack: VecDeque::new(),
            redo_stack: VecDeque::new(),
            max_size,
            group_depth: 0,
            current_group: None,
        }
    }

    pub fn push(&mut self, entry: HistoryEntry) {
        if self.group_depth > 0 {
            if let Some(ref mut group) = self.current_group {
                group.entries.push(entry);
                return;
            }
        }

        self.undo_stack.push_back(entry);
        self.redo_stack.clear();
        
        if self.undo_stack.len() > self.max_size {
            self.undo_stack.pop_front();
        }
    }

    pub fn begin_group(&mut self, description: String) {
        if self.group_depth == 0 {
            self.current_group = Some(HistoryGroup {
                id: EntityId::new(),
                description,
                entries: Vec::new(),
                timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as u64,
            });
        }
        self.group_depth += 1;
    }

    pub fn end_group(&mut self) {
        if self.group_depth > 0 {
            self.group_depth -= 1;
            if self.group_depth == 0 {
                if let Some(group) = self.current_group.take() {
                    if !group.entries.is_empty() {
                        let group_entry = HistoryEntry {
                            id: group.id,
                            action_type: HistoryActionType::Group,
                            description: group.description,
                            timestamp: group.timestamp,
                            data: HistoryData::Custom { 
                                data: serde_json::to_vec(&group.entries).unwrap_or_default() 
                            },
                        };
                        self.push(group_entry);
                    }
                }
            }
        }
    }

    pub fn undo(&mut self) -> Option<HistoryEntry> {
        if let Some(entry) = self.undo_stack.pop_back() {
            self.redo_stack.push_back(entry.clone());
            Some(entry)
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<HistoryEntry> {
        if let Some(entry) = self.redo_stack.pop_back() {
            self.undo_stack.push_back(entry.clone());
            Some(entry)
        } else {
            None
        }
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    pub fn undo_description(&self) -> Option<String> {
        self.undo_stack.back().map(|e| e.description.clone())
    }

    pub fn redo_description(&self) -> Option<String> {
        self.redo_stack.back().map(|e| e.description.clone())
    }

    pub fn clear(&mut self) {
        self.undo_stack.clear();
        self.redo_stack.clear();
        self.current_group = None;
        self.group_depth = 0;
    }

    pub fn undo_count(&self) -> usize {
        self.undo_stack.len()
    }

    pub fn redo_count(&self) -> usize {
        self.redo_stack.len()
    }
}

impl Default for History {
    fn default() -> Self {
        Self::new()
    }
}

pub struct HistoryManager {
    history: History,
    listeners: Vec<Box<dyn HistoryListener>>,
}

pub trait HistoryListener: Send + Sync {
    fn on_undo(&self, entry: &HistoryEntry);
    fn on_redo(&self, entry: &HistoryEntry);
    fn on_push(&self, entry: &HistoryEntry);
    fn on_clear(&self);
}

impl HistoryManager {
    pub fn new() -> Self {
        Self {
            history: History::new(),
            listeners: Vec::new(),
        }
    }

    pub fn history(&self) -> &History {
        &self.history
    }

    pub fn history_mut(&mut self) -> &mut History {
        &mut self.history
    }

    pub fn add_listener(&mut self, listener: Box<dyn HistoryListener>) {
        self.listeners.push(listener);
    }

    pub fn push(&mut self, entry: HistoryEntry) {
        for listener in &self.listeners {
            listener.on_push(&entry);
        }
        self.history.push(entry);
    }

    pub fn undo(&mut self) -> Option<HistoryEntry> {
        if let Some(entry) = self.history.undo() {
            for listener in &self.listeners {
                listener.on_undo(&entry);
            }
            Some(entry)
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<HistoryEntry> {
        if let Some(entry) = self.history.redo() {
            for listener in &self.listeners {
                listener.on_redo(&entry);
            }
            Some(entry)
        } else {
            None
        }
    }

    pub fn begin_group(&mut self, description: String) {
        self.history.begin_group(description);
    }

    pub fn end_group(&mut self) {
        self.history.end_group();
    }
}

impl Default for HistoryManager {
    fn default() -> Self {
        Self::new()
    }
}