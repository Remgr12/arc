use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::{EntityId, Color, EntityContainer, EntityRef};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: EntityId,
    pub name: String,
    pub visible: bool,
    pub locked: bool,
    pub color: Color,
    pub line_weight: f32,
    pub line_type: LineType,
    pub transparency: f32,
    pub plot_style: String,
    pub description: String,
    pub frozen: bool,
    pub vp_frozen: bool,
}

impl Layer {
    pub fn new(name: String, color: Option<Color>) -> Self {
        Self {
            id: EntityId::new(),
            name,
            visible: true,
            locked: false,
            color: color.unwrap_or(Color::WHITE),
            line_weight: 0.25,
            line_type: LineType::Continuous,
            transparency: 0.0,
            plot_style: "Normal".to_string(),
            description: String::new(),
            frozen: false,
            vp_frozen: false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LineType {
    Continuous,
    Dashed,
    Dotted,
    DashDot,
    DashDotDot,
    Border,
    Center,
    Hidden,
    Phantom,
}

impl Default for LineType {
    fn default() -> Self {
        Self::Continuous
    }
}

pub type LayerRef = Arc<RwLock<Layer>>;

#[derive(Debug, Default)]
pub struct LayerContainer {
    layers: dashmap::DashMap<EntityId, LayerRef>,
    order: Vec<EntityId>,
    active_layer: Option<EntityId>,
}

impl LayerContainer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create_layer(&self, name: String, color: Option<Color>) -> LayerRef {
        let layer = Arc::new(RwLock::new(Layer::new(name, color)));
        let id = layer.read().id;
        self.layers.insert(id, layer.clone());
        self.order.push(id);
        layer
    }

    pub fn get(&self, id: EntityId) -> Option<LayerRef> {
        self.layers.get(&id).map(|l| l.clone())
    }

    pub fn get_by_name(&self, name: &str) -> Option<LayerRef> {
        self.layers.iter().find(|l| l.read().name == name).map(|l| l.clone())
    }

    pub fn remove(&self, id: EntityId) -> Option<LayerRef> {
        self.order.retain(|lid| *lid != id);
        if self.active_layer == Some(id) {
            self.active_layer = self.order.first().copied();
        }
        self.layers.remove(&id).map(|(_, v)| v)
    }

    pub fn all(&self) -> Vec<LayerRef> {
        self.order.iter().filter_map(|id| self.layers.get(id).map(|l| l.clone())).collect()
    }

    pub fn ordered(&self) -> Vec<LayerRef> {
        self.order.iter().filter_map(|id| self.layers.get(id).map(|l| l.clone())).collect()
    }

    pub fn set_active(&mut self, id: EntityId) {
        if self.layers.contains_key(&id) {
            self.active_layer = Some(id);
        }
    }

    pub fn active(&self) -> Option<LayerRef> {
        self.active_layer.and_then(|id| self.layers.get(&id).map(|l| l.clone()))
    }

    pub fn active_id(&self) -> Option<EntityId> {
        self.active_layer
    }

    pub fn move_layer(&mut self, id: EntityId, new_index: usize) {
        if let Some(pos) = self.order.iter().position(|lid| *lid == id) {
            self.order.remove(pos);
            let new_index = new_index.min(self.order.len());
            self.order.insert(new_index, id);
        }
    }

    pub fn count(&self) -> usize {
        self.layers.len()
    }

    pub fn entities_on_layer(&self, entities: &EntityContainer, layer_id: EntityId) -> Vec<EntityRef> {
        entities.get_by_layer(layer_id)
    }

    pub fn set_layer_color(&self, id: EntityId, color: Color) {
        if let Some(layer) = self.layers.get(&id) {
            layer.write().color = color;
        }
    }

    pub fn set_layer_visible(&self, id: EntityId, visible: bool) {
        if let Some(layer) = self.layers.get(&id) {
            layer.write().visible = visible;
        }
    }

    pub fn set_layer_locked(&self, id: EntityId, locked: bool) {
        if let Some(layer) = self.layers.get(&id) {
            layer.write().locked = locked;
        }
    }
}