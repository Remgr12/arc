//! Snapshot-based undo/redo history.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::core::entity::Entity;
use crate::core::{EntityId, Layer};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Snapshot {
    pub entities: BTreeMap<EntityId, Entity>,
    pub layers: Vec<Layer>,
    pub active_layer: EntityId,
    pub selection: Vec<EntityId>,
    pub primary: Option<EntityId>,
}

#[derive(Debug, Clone)]
pub struct HistoryEntry {
    pub label: String,
    pub before: Snapshot,
    pub after: Snapshot,
}

/// Depth-limited linear history.
#[derive(Debug, Default)]
pub struct History {
    entries: Vec<HistoryEntry>,
    position: usize,
    limit: usize,
}

impl History {
    pub fn new(limit: usize) -> Self {
        Self {
            entries: Vec::new(),
            position: 0,
            limit: limit.max(1),
        }
    }

    /// Push a completed change. Must be called with before/after states.
    pub fn push(&mut self, label: String, before: Snapshot, after: Snapshot) {
        if self.position < self.entries.len() {
            self.entries.truncate(self.position);
        }
        self.entries.push(HistoryEntry {
            label,
            before,
            after,
        });
        if self.entries.len() > self.limit {
            self.entries.remove(0);
            self.position = self.position.saturating_sub(1);
        }
        self.position = self.entries.len();
    }

    pub fn can_undo(&self) -> bool {
        self.position > 0
    }

    pub fn can_redo(&self) -> bool {
        self.position < self.entries.len()
    }

    pub fn undo(&mut self) -> Option<Snapshot> {
        if self.can_undo() {
            self.position -= 1;
            Some(self.entries[self.position].before.clone())
        } else {
            None
        }
    }

    pub fn redo(&mut self) -> Option<Snapshot> {
        if self.can_redo() {
            let snap = self.entries[self.position].after.clone();
            self.position += 1;
            Some(snap)
        } else {
            None
        }
    }

    pub fn undo_label(&self) -> Option<&str> {
        if self.can_undo() {
            Some(self.entries[self.position - 1].label.as_str())
        } else {
            None
        }
    }

    pub fn redo_label(&self) -> Option<&str> {
        if self.can_redo() {
            Some(self.entries[self.position].label.as_str())
        } else {
            None
        }
    }

    pub fn position(&self) -> usize {
        self.position
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// Last applied label (current state description).
    pub fn current_label(&self) -> Option<&str> {
        if self.position > 0 {
            Some(self.entries[self.position - 1].label.as_str())
        } else {
            None
        }
    }
}
