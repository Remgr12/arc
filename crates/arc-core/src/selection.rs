use std::collections::HashSet;
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use nalgebra::{Point3, Vector3};
use crate::{EntityId, EntityRef, BoundingBox, Color};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Selection {
    pub selected_ids: HashSet<EntityId>,
    pub primary_id: Option<EntityId>,
    pub hover_id: Option<EntityId>,
    pub window_select_start: Option<Point3<f64>>,
    pub window_select_end: Option<Point3<f64>>,
    pub is_window_selecting: bool,
}

impl Selection {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn select(&mut self, id: EntityId, add_to_selection: bool) {
        if !add_to_selection {
            self.clear();
        }
        self.selected_ids.insert(id);
        self.primary_id = Some(id);
    }

    pub fn deselect(&mut self, id: EntityId) {
        self.selected_ids.remove(&id);
        if self.primary_id == Some(id) {
            self.primary_id = self.selected_ids.iter().next().copied();
        }
    }

    pub fn toggle(&mut self, id: EntityId) {
        if self.selected_ids.contains(&id) {
            self.deselect(id);
        } else {
            self.select(id, true);
        }
    }

    pub fn clear(&mut self) {
        self.selected_ids.clear();
        self.primary_id = None;
    }

    pub fn is_selected(&self, id: EntityId) -> bool {
        self.selected_ids.contains(&id)
    }

    pub fn count(&self) -> usize {
        self.selected_ids.len()
    }

    pub fn primary(&self) -> Option<EntityId> {
        self.primary_id
    }

    pub fn set_hover(&mut self, id: Option<EntityId>) {
        self.hover_id = id;
    }

    pub fn hover(&self) -> Option<EntityId> {
        self.hover_id
    }

    pub fn start_window_select(&mut self, start: Point3<f64>) {
        self.window_select_start = Some(start);
        self.window_select_end = Some(start);
        self.is_window_selecting = true;
    }

    pub fn update_window_select(&mut self, end: Point3<f64>) {
        self.window_select_end = Some(end);
    }

    pub fn end_window_select(&mut self) -> Option<(Point3<f64>, Point3<f64>)> {
        if self.is_window_selecting {
            self.is_window_selecting = false;
            if let (Some(start), Some(end)) = (self.window_select_start, self.window_select_end) {
                self.window_select_start = None;
                self.window_select_end = None;
                return Some((start, end));
            }
        }
        None
    }

    pub fn selected_entities<'a>(&self, entities: &'a crate::EntityContainer) -> Vec<EntityRef> {
        self.selected_ids.iter()
            .filter_map(|id| entities.get(*id))
            .collect()
    }

    pub fn get_bounding_box(&self, entities: &crate::EntityContainer) -> Option<BoundingBox> {
        let mut bbox = BoundingBox::empty();
        let mut has_entities = false;

        for id in &self.selected_ids {
            if let Some(entity) = entities.get(*id) {
                bbox.expand(&entity.read().bounding_box());
                has_entities = true;
            }
        }

        if has_entities {
            Some(bbox)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SelectionFilter {
    All,
    Sketch,
    Solid,
    Surface,
    Mesh,
    Architecture,
    Annotation,
    Reference,
    Group,
    Custom(fn(EntityId) -> bool),
}

impl Default for SelectionFilter {
    fn default() -> Self {
        Self::All
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SelectionSet {
    pub name: String,
    pub ids: HashSet<EntityId>,
    pub color: Color,
}

impl SelectionSet {
    pub fn new(name: String) -> Self {
        Self {
            name,
            ids: HashSet::new(),
            color: Color::BLUE,
        }
    }

    pub fn add(&mut self, id: EntityId) {
        self.ids.insert(id);
    }

    pub fn remove(&mut self, id: EntityId) {
        self.ids.remove(&id);
    }

    pub fn contains(&self, id: EntityId) -> bool {
        self.ids.contains(&id)
    }

    pub fn apply(&self, selection: &mut Selection) {
        for id in &self.ids {
            selection.select(*id, true);
        }
    }
}