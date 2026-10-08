use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use crate::AppState;

pub struct UIManager {
    ui_state: UiState,
    panels: Vec<UiPanel>,
    notifications: Vec<Notification>,
    dialogs: Vec<Dialog>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UiState {
    pub sidebar_collapsed: bool,
    pub toolbar_visible: bool,
    pub statusbar_visible: bool,
    pub command_palette_open: bool,
    pub preferences_open: bool,
    pub help_open: bool,
    pub dark_mode: bool,
    pub language: String,
    pub ui_scale: f32,
    pub animation_speed: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiPanel {
    pub id: String,
    pub title: String,
    pub component: String,
    pub position: String,
    pub size: UiSize,
    pub min_size: Option<UiSize>,
    pub max_size: Option<UiSize>,
    pub visible: bool,
    pub collapsed: bool,
    pub dockable: bool,
    pub floating: bool,
    pub z_index: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiSize {
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Notification {
    pub id: String,
    pub title: String,
    pub message: String,
    pub severity: NotificationSeverity,
    pub duration: Option<f64>,
    pub dismissible: bool,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum NotificationSeverity {
    Info,
    Success,
    Warning,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Dialog {
    pub id: String,
    pub title: String,
    pub message: String,
    pub dialog_type: DialogType,
    pub buttons: Vec<DialogButton>,
    pub data: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DialogType {
    Alert,
    Confirm,
    Prompt,
    Custom,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DialogButton {
    pub id: String,
    pub label: String,
    pub style: ButtonStyle,
    pub action: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ButtonStyle {
    Default,
    Primary,
    Secondary,
    Danger,
    Success,
    Warning,
}

impl UIManager {
    pub fn new() -> Self {
        Self {
            ui_state: UiState::default(),
            panels: Vec::new(),
            notifications: Vec::new(),
            dialogs: Vec::new(),
        }
    }
    
    pub fn state(&self) -> &UiState {
        &self.ui_state
    }
    
    pub fn state_mut(&mut self) -> &mut UiState {
        &mut self.ui_state
    }
    
    pub fn add_panel(&mut self, panel: UiPanel) {
        self.panels.push(panel);
    }
    
    pub fn remove_panel(&mut self, id: &str) {
        self.panels.retain(|p| p.id != id);
    }
    
    pub fn get_panel(&self, id: &str) -> Option<&UiPanel> {
        self.panels.iter().find(|p| p.id == id)
    }
    
    pub fn set_panel_visibility(&mut self, id: &str, visible: bool) {
        for panel in &mut self.panels {
            if panel.id == id {
                panel.visible = visible;
            }
        }
    }
    
    pub fn toggle_panel(&mut self, id: &str) {
        for panel in &mut self.panels {
            if panel.id == id {
                panel.visible = !panel.visible;
            }
        }
    }
    
    pub fn add_notification(&mut self, notification: Notification) {
        self.notifications.push(notification);
    }
    
    pub fn remove_notification(&mut self, id: &str) {
        self.notifications.retain(|n| n.id != id);
    }
    
    pub fn show_notification(
        &mut self,
        title: String,
        message: String,
        severity: NotificationSeverity,
        duration: Option<f64>,
    ) {
        let id = format!("notif_{}", std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis());
            
        let notification = Notification {
            id,
            title,
            message,
            severity,
            duration,
            dismissible: true,
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as u64,
        };
        
        self.add_notification(notification);
    }
    
    pub fn show_dialog(&mut self, dialog: Dialog) -> String {
        let id = dialog.id.clone();
        self.dialogs.push(dialog);
        id
    }
    
    pub fn close_dialog(&mut self, id: &str) -> Option<Dialog> {
        let pos = self.dialogs.iter().position(|d| d.id == id)?;
        Some(self.dialogs.remove(pos))
    }
    
    pub fn arrange_panels(&mut self, layout: &str) {
        match layout {
            "sidebar-left" => {
                for panel in &mut self.panels {
                    if panel.id == "project" {
                        panel.position = "left".to_string();
                        panel.visible = true;
                    }
                }
            }
            "sidebar-right" => {
                for panel in &mut self.panels {
                    if panel.id == "properties" {
                        panel.position = "right".to_string();
                        panel.visible = true;
                    }
                }
            }
            _ => {}
        }
    }
}

impl Default for UIManager {
    fn default() -> Self {
        Self::new()
    }
}