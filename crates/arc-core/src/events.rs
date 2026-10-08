use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3};
use crate::{EntityId, EntityType, ViewportState, Transform};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AppEvent {
    // Document events
    DocumentCreated { document_id: EntityId },
    DocumentOpened { document_id: EntityId, path: String },
    DocumentSaved { document_id: EntityId, path: String },
    DocumentClosed { document_id: EntityId },
    DocumentModified { document_id: EntityId },
    
    // Entity events
    EntityCreated { entity_id: EntityId, entity_type: EntityType, document_id: EntityId },
    EntityDeleted { entity_id: EntityId, document_id: EntityId },
    EntityModified { entity_id: EntityId, document_id: EntityId },
    EntityTransformed { entity_id: EntityId, old_transform: Transform, new_transform: Transform },
    EntityPropertyChanged { entity_id: EntityId, property: String, old_value: serde_json::Value, new_value: serde_json::Value },
    EntitySelected { entity_id: EntityId, add_to_selection: bool },
    EntityDeselected { entity_id: EntityId },
    SelectionCleared { document_id: EntityId },
    
    // Layer events
    LayerCreated { layer_id: EntityId, document_id: EntityId },
    LayerDeleted { layer_id: EntityId, document_id: EntityId },
    LayerModified { layer_id: EntityId, document_id: EntityId },
    ActiveLayerChanged { layer_id: EntityId, document_id: EntityId },
    
    // Viewport events
    ViewportChanged { viewport_index: usize, old_state: ViewportState, new_state: ViewportState },
    ViewportViewTypeChanged { viewport_index: usize, view_type: crate::ViewType },
    ViewportRenderModeChanged { viewport_index: usize, render_mode: crate::RenderMode },
    ActiveViewportChanged { viewport_index: usize },
    
    // Tool events
    ToolActivated { tool_id: String },
    ToolDeactivated { tool_id: String },
    ToolOptionChanged { tool_id: String, option: String, value: serde_json::Value },
    
    // Command events
    CommandExecuted { command_id: String, success: bool, result: Option<serde_json::Value> },
    CommandUndone { command_id: String },
    CommandRedone { command_id: String },
    
    // Input events
    MouseDown { position: (f32, f32), button: MouseButton, modifiers: Modifiers },
    MouseUp { position: (f32, f32), button: MouseButton, modifiers: Modifiers },
    MouseMove { position: (f32, f32), delta: (f32, f32), modifiers: Modifiers },
    MouseWheel { position: (f32, f32), delta: (f32, f32), modifiers: Modifiers },
    KeyDown { key: Key, modifiers: Modifiers },
    KeyUp { key: Key, modifiers: Modifiers },
    
    // Snap events
    SnapFound { point: Point3<f64>, snap_type: crate::SnapType, entity_id: Option<EntityId> },
    SnapLost,
    
    // Constraint events
    ConstraintAdded { constraint_id: EntityId },
    ConstraintRemoved { constraint_id: EntityId },
    ConstraintSolved { success: bool, errors: Vec<String> },
    
    // UI events
    PanelOpened { panel_id: String },
    PanelClosed { panel_id: String },
    TabChanged { tab_id: String, tab_index: usize },
    ContextMenuRequested { position: (f32, f32) },
    
    // File events
    ImportRequested { path: String, format: String },
    ExportRequested { path: String, format: String, entities: Vec<EntityId> },
    
    // Custom events
    Custom { event_type: String, data: serde_json::Value },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum MouseButton {
    Left,
    Right,
    Middle,
    Back,
    Forward,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Key {
    Unknown,
    Escape,
    Enter,
    Tab,
    Space,
    Backspace,
    Delete,
    Home,
    End,
    PageUp,
    PageDown,
    Left,
    Right,
    Up,
    Down,
    F1, F2, F3, F4, F5, F6, F7, F8, F9, F10, F11, F12,
    A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P, Q, R, S, T, U, V, W, X, Y, Z,
    D0, D1, D2, D3, D4, D5, D6, D7, D8, D9,
    Numpad0, Numpad1, Numpad2, Numpad3, Numpad4, Numpad5, Numpad6, Numpad7, Numpad8, Numpad9,
    NumpadAdd, NumpadSubtract, NumpadMultiply, NumpadDivide, NumpadEnter, NumpadDecimal,
    Shift, Control, Alt, Meta,
    CapsLock, NumLock, ScrollLock,
    PrintScreen, Pause, Insert,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct Modifiers {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub meta: bool,
}

impl Modifiers {
    pub fn any(&self) -> bool {
        self.shift || self.ctrl || self.alt || self.meta
    }

    pub fn none(&self) -> bool {
        !self.any()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InputState {
    pub mouse_position: (f32, f32),
    pub mouse_delta: (f32, f32),
    pub mouse_buttons: std::collections::HashSet<MouseButton>,
    pub keys: std::collections::HashSet<Key>,
    pub modifiers: Modifiers,
    pub wheel_delta: (f32, f32),
}

impl Default for InputState {
    fn default() -> Self {
        Self {
            mouse_position: (0.0, 0.0),
            mouse_delta: (0.0, 0.0),
            mouse_buttons: std::collections::HashSet::new(),
            keys: std::collections::HashSet::new(),
            modifiers: Modifiers::default(),
            wheel_delta: (0.0, 0.0),
        }
    }
}

impl InputState {
    pub fn is_mouse_down(&self, button: MouseButton) -> bool {
        self.mouse_buttons.contains(&button)
    }

    pub fn is_key_down(&self, key: Key) -> bool {
        self.keys.contains(&key)
    }

    pub fn is_modifier_down(&self, key: Key) -> bool {
        match key {
            Key::Shift => self.modifiers.shift,
            Key::Control => self.modifiers.ctrl,
            Key::Alt => self.modifiers.alt,
            Key::Meta => self.modifiers.meta,
            _ => false,
        }
    }
}

pub trait EventHandler: Send + Sync {
    fn handle_event(&mut self, event: &AppEvent);
}

pub struct EventBus {
    subscribers: Vec<Box<dyn EventHandler>>,
    event_queue: Vec<AppEvent>,
    processing: bool,
}

impl EventBus {
    pub fn new() -> Self {
        Self {
            subscribers: Vec::new(),
            event_queue: Vec::new(),
            processing: false,
        }
    }

    pub fn subscribe(&mut self, handler: Box<dyn EventHandler>) {
        self.subscribers.push(handler);
    }

    pub fn publish(&mut self, event: AppEvent) {
        if self.processing {
            self.event_queue.push(event);
        } else {
            self.process_event(event);
        }
    }

    pub fn publish_batch(&mut self, events: Vec<AppEvent>) {
        for event in events {
            self.publish(event);
        }
    }

    fn process_event(&mut self, event: AppEvent) {
        self.processing = true;
        
        for subscriber in &mut self.subscribers {
            subscriber.handle_event(&event);
        }
        
        self.processing = false;
        
        while !self.event_queue.is_empty() {
            let next_event = self.event_queue.remove(0);
            self.process_event(next_event);
        }
    }
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

pub struct EventLogger {
    events: Vec<AppEvent>,
    max_events: usize,
}

impl EventLogger {
    pub fn new(max_events: usize) -> Self {
        Self {
            events: Vec::new(),
            max_events,
        }
    }

    pub fn log(&mut self, event: AppEvent) {
        self.events.push(event);
        if self.events.len() > self.max_events {
            self.events.remove(0);
        }
    }

    pub fn events(&self) -> &[AppEvent] {
        &self.events
    }

    pub fn clear(&mut self) {
        self.events.clear();
    }
}

impl EventHandler for EventLogger {
    fn handle_event(&mut self, event: &AppEvent) {
        self.log(event.clone());
    }
}

#[macro_export]
macro_rules! event {
    ($event_type:ident { $($field:ident),* $(,)? }) => {
        crate::events::AppEvent::$event_type { $($field: $field),* }
    };
    ($event_type:ident) => {
        crate::events::AppEvent::$event_type
    };
}

pub fn document_created(document_id: EntityId) -> AppEvent {
    event!(DocumentCreated { document_id })
}

pub fn entity_created(entity_id: EntityId, entity_type: EntityType, document_id: EntityId) -> AppEvent {
    event!(EntityCreated { entity_id, entity_type, document_id })
}

pub fn entity_deleted(entity_id: EntityId, document_id: EntityId) -> AppEvent {
    event!(EntityDeleted { entity_id, document_id })
}

pub fn entity_selected(entity_id: EntityId, add_to_selection: bool) -> AppEvent {
    event!(EntitySelected { entity_id, add_to_selection })
}

pub fn selection_cleared(document_id: EntityId) -> AppEvent {
    event!(SelectionCleared { document_id })
}

pub fn command_executed(command_id: String, success: bool, result: Option<serde_json::Value>) -> AppEvent {
    event!(CommandExecuted { command_id, success, result })
}

pub fn viewport_changed(viewport_index: usize, old_state: ViewportState, new_state: ViewportState) -> AppEvent {
    event!(ViewportChanged { viewport_index, old_state, new_state })
}