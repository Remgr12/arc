//! Assembly system for 3D modeling.
//!
//! Contains component-based assembly structures, transform hierarchies,
//! component references, and assembly-level operations.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{Color, EntityId, Transform};

/// Get current timestamp in milliseconds.
fn get_current_timestamp() -> u64 {
    #[cfg(feature = "chrono")]
    return chrono::Utc::now().timestamp_millis() as u64;
    #[cfg(not(feature = "chrono"))]
    return 0u64;
}

/// Component structure for assemblies.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyComponent {
    pub id: EntityId,
    pub entity_id: Option<EntityId>,
    pub external_ref: Option<String>,
    pub name: String,
    pub transform: Transform,
    pub visible: bool,
    pub locked: bool,
    pub transform_overrides: TransformOverrides,
    pub is_reference: bool,
}

impl AssemblyComponent {
    pub fn new_entity_component(id: EntityId, entity_id: EntityId, name: String) -> Self {
        Self {
            id,
            entity_id: Some(entity_id),
            external_ref: None,
            name,
            transform: Transform::default(),
            visible: true,
            locked: false,
            transform_overrides: TransformOverrides::default(),
            is_reference: false,
        }
    }

    pub fn new_reference_component(id: EntityId, external_ref: String, name: String) -> Self {
        Self {
            id,
            entity_id: None,
            external_ref: Some(external_ref),
            name,
            transform: Transform::default(),
            visible: true,
            locked: false,
            transform_overrides: TransformOverrides::default(),
            is_reference: true,
        }
    }

    pub fn get_effective_transform(&self, base_transform: &Transform) -> Transform {
        self.transform_overrides.apply(base_transform)
    }
}

/// Transform override configuration for components.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransformOverrides {
    pub position_override: bool,
    pub rotation_override: bool,
    pub scale_override: bool,
    pub position: [f64; 3],
    pub rotation: [f64; 4],
    pub scale: [f64; 3],
}

impl Default for TransformOverrides {
    fn default() -> Self {
        Self {
            position_override: false,
            rotation_override: false,
            scale_override: false,
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
        }
    }
}

impl TransformOverrides {
    pub fn has_overrides(&self) -> bool {
        self.position_override || self.rotation_override || self.scale_override
    }

    pub fn apply(&self, base_transform: &Transform) -> Transform {
        Transform {
            position: if self.position_override { self.position } else { base_transform.position },
            rotation: if self.rotation_override { self.rotation } else { base_transform.rotation },
            scale: if self.scale_override { self.scale } else { base_transform.scale },
        }
    }
}

/// Component hierarchy override for layers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyLayerOverride {
    pub component_id: EntityId,
    pub layer_id: EntityId,
    pub visible: bool,
    pub locked: bool,
}

/// Transform hierarchy for components.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentTransform {
    pub id: EntityId,
    pub parent_id: Option<EntityId>,
    pub local_transform: Transform,
    pub global_transform: Transform,
    pub is_absolute: bool,
}

impl ComponentTransform {
    pub fn new(id: EntityId, parent_id: Option<EntityId>) -> Self {
        Self {
            id,
            parent_id,
            local_transform: Transform::default(),
            global_transform: Transform::default(),
            is_absolute: false,
        }
    }

    pub fn update_global(&mut self, parent_global: Option<&Transform>) {
        match parent_global {
            Some(parent) => {
                self.global_transform = self.compute_global_transform(parent);
            }
            None => {
                self.global_transform = self.local_transform;
            }
        }
    }

    fn compute_global_transform(&self, parent_global: &Transform) -> Transform {
        Transform {
            position: [
                parent_global.position[0] + self.local_transform.position[0],
                parent_global.position[1] + self.local_transform.position[1],
                parent_global.position[2] + self.local_transform.position[2],
            ],
            rotation: [
                parent_global.rotation[0] + self.local_transform.rotation[0],
                parent_global.rotation[1] + self.local_transform.rotation[1],
                parent_global.rotation[2] + self.local_transform.rotation[2],
                parent_global.rotation[3] + self.local_transform.rotation[3],
            ],
            scale: [
                parent_global.scale[0] * self.local_transform.scale[0],
                parent_global.scale[1] * self.local_transform.scale[1],
                parent_global.scale[2] * self.local_transform.scale[2],
            ],
        }
    }
}

/// Component reference (entity IDs, external references).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentReference {
    pub component_id: EntityId,
    pub entity_id: Option<EntityId>,
    pub external_path: Option<String>,
    pub created_at: u64,
    pub modified_at: u64,
}

/// Assembly metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyMetadata {
    pub name: String,
    pub description: Option<String>,
    pub visible: bool,
    pub locked: bool,
    pub created_at: u64,
    pub modified_at: u64,
    pub version: u32,
}

impl Default for AssemblyMetadata {
    fn default() -> Self {
        #[cfg(feature = "chrono")]
        let now = chrono::Utc::now().timestamp_millis() as u64;
        #[cfg(not(feature = "chrono"))]
        let now = 0u64;

        Self {
            name: "New Assembly".to_string(),
            description: None,
            visible: true,
            locked: false,
            created_at: now,
            modified_at: now,
            version: 1,
        }
    }
}

/// Main assembly structure containing components, hierarchy, and metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assembly {
    pub id: EntityId,
    pub metadata: AssemblyMetadata,
    pub components: BTreeMap<EntityId, AssemblyComponent>,
    pub component_transforms: BTreeMap<EntityId, ComponentTransform>,
    pub component_references: Vec<ComponentReference>,
    pub layer_overrides: BTreeMap<EntityId, AssemblyLayerOverride>,
    pub is_root: bool,
}

    pub fn new(id: EntityId, name: String) -> Self {
        let now = get_current_timestamp();

        let mut metadata = AssemblyMetadata::default();
        metadata.name = name;
        metadata.created_at = now;
        metadata.modified_at = now;

        Self {
            id,
            metadata,
            components: BTreeMap::new(),
            component_transforms: BTreeMap::new(),
            component_references: Vec::new(),
            layer_overrides: BTreeMap::new(),
            is_root: true,
        }
    }

    pub fn add_component(&mut self, component: AssemblyComponent) -> Result<(), String> {
        if self.components.contains_key(&component.id) {
            return Err("Component with this ID already exists".to_string());
        }
        self.components.insert(component.id, component);
        self.metadata.modified_at = get_current_timestamp();
        Ok(())
    }

    pub fn add_entity_component(&mut self, entity_id: EntityId, name: String) -> Result<EntityId, String> {
        let component_id = EntityId::new();
        let component = AssemblyComponent::new_entity_component(component_id, entity_id, name);
        self.add_component(component)?;
        Ok(component_id)
    }

    pub fn add_reference_component(&mut self, external_ref: String, name: String) -> Result<EntityId, String> {
        let component_id = EntityId::new();
        let component = AssemblyComponent::new_reference_component(component_id, external_ref, name);
        self.add_component(component)?;
        Ok(component_id)
    }

    pub fn set_component_transform(&mut self, component_id: EntityId, transform: Transform) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.transform = transform;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    pub fn set_component_overrides(&mut self, component_id: EntityId, overrides: TransformOverrides) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.transform_overrides = overrides;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    pub fn remove_component(&mut self, component_id: EntityId) -> Result<(), String> {
        if self.components.remove(&component_id).is_some() {
            self.component_transforms.remove(&component_id);
            self.layer_overrides.remove(&component_id);
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    pub fn explode(&mut self) -> Vec<EntityId> {
        let mut entity_ids = Vec::new();
        for component in self.components.values() {
            if let Some(entity_id) = component.entity_id {
                entity_ids.push(entity_id);
            }
        }
        self.components.clear();
        self.component_transforms.clear();
        entity_ids
    }

    pub fn update_transforms(&mut self) {
        for (component_id, component_transform) in &mut self.component_transforms {
            let parent_global = component_transform.parent_id.and_then(|pid| {
                self.component_transforms.get(&pid).map(|t| &t.global_transform)
            });
            component_transform.update_global(parent_global);
        }
        self.metadata.modified_at = get_current_timestamp();
    }

    pub fn set_component_visibility(&mut self, component_id: EntityId, visible: bool) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.visible = visible;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    pub fn set_component_lock(&mut self, component_id: EntityId, locked: bool) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.locked = locked;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    pub fn get_visible_components(&self) -> Vec<&AssemblyComponent> {
        self.components.values().filter(|c| c.visible).collect()
    }

    pub fn get_locked_components(&self) -> Vec<&AssemblyComponent> {
        self.components.values().filter(|c| c.locked).collect()
    }
}
