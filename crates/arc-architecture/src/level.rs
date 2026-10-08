use arc_core::*;
use arc_geometry::*;
use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum LevelType {
    Story,
    Reference,
    Datum,
    Roof,
    Basement,
    Mezzanine,
    Penthouse,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Level {
    pub id: EntityId,
    pub name: String,
    pub elevation: f64,
    pub height: f64,
    pub level_type: LevelType,
    pub associated_plan: Option<String>,
    pub color: Color,
    pub show_in_3d: bool,
    pub show_in_plan: bool,
    pub transform: Transform,
    pub visible: bool,
    pub locked: bool,
    pub properties: std::collections::HashMap<String, serde_json::Value>,
}

impl Level {
    pub fn new(name: String, elevation: f64, height: f64) -> Self {
        Self {
            id: EntityId::new(),
            name,
            elevation,
            height,
            level_type: LevelType::Story,
            associated_plan: None,
            color: Color::BLUE,
            show_in_3d: true,
            show_in_plan: true,
            transform: Transform::identity(),
            visible: true,
            locked: false,
            properties: std::collections::HashMap::new(),
        }
    }

    pub fn story(name: String, elevation: f64, height: f64) -> Self {
        let mut level = Self::new(name, elevation, height);
        level.level_type = LevelType::Story;
        level
    }

    pub fn reference(name: String, elevation: f64) -> Self {
        let mut level = Self::new(name, elevation, 0.0);
        level.level_type = LevelType::Reference;
        level
    }

    pub fn roof(name: String, elevation: f64) -> Self {
        let mut level = Self::new(name, elevation, 0.0);
        level.level_type = LevelType::Roof;
        level.color = Color::RED;
        level
    }

    pub fn basement(name: String, elevation: f64, height: f64) -> Self {
        let mut level = Self::new(name, elevation, height);
        level.level_type = LevelType::Basement;
        level.color = Color::GRAY;
        level
    }

    pub fn set_plan(&mut self, plan_name: String) {
        self.associated_plan = Some(plan_name);
    }

    pub fn absolute_elevation(&self, relative: f64) -> f64 {
        self.elevation + relative
    }

    pub fn relative_elevation(&self, absolute: f64) -> f64 {
        absolute - self.elevation
    }
}

pub type LevelRef = Arc<RwLock<Level>>;

pub struct LevelBuilder {
    level: Level,
}

impl LevelBuilder {
    pub fn new(name: String, elevation: f64, height: f64) -> Self {
        Self {
            level: Level::new(name, elevation, height),
        }
    }

    pub fn level_type(mut self, level_type: LevelType) -> Self {
        self.level.level_type = level_type;
        self
    }

    pub fn color(mut self, color: Color) -> Self {
        self.level.color = color;
        self
    }

    pub fn associated_plan(mut self, plan_name: String) -> Self {
        self.level.associated_plan = Some(plan_name);
        self
    }

    pub fn show_in_3d(mut self, show: bool) -> Self {
        self.level.show_in_3d = show;
        self
    }

    pub fn show_in_plan(mut self, show: bool) -> Self {
        self.level.show_in_plan = show;
        self
    }

    pub fn visible(mut self, visible: bool) -> Self {
        self.level.visible = visible;
        self
    }

    pub fn locked(mut self, locked: bool) -> Self {
        self.level.locked = locked;
        self
    }

    pub fn build(mut self) -> Level {
        self.level
    }
}

pub fn level_builder(name: String, elevation: f64, height: f64) -> LevelBuilder {
    LevelBuilder::new(name, elevation, height)
}