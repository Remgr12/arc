//! Assembly system for 3D modeling.
//!
//! Contains component-based assembly structures, transform hierarchies,
//! component references, and assembly-level operations.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::core::{EntityId, Transform};

/// Returns the current wall-clock time in milliseconds since the Unix epoch.
///
/// Uses `chrono` only when the optional `chrono` cargo feature is enabled; the
/// default stub build reports `0` so the kernel stays dependency-free.
#[allow(unexpected_cfgs)]
fn get_current_timestamp() -> u64 {
    #[cfg(feature = "chrono")]
    {
        chrono::Utc::now().timestamp_millis() as u64
    }
    #[cfg(not(feature = "chrono"))]
    {
        0u64
    }
}

/// Converts `[x, y, z, w]` rotation storage into a normalized nalgebra quaternion.
///
/// Degenerate input (all-zero, NaN or infinite components) degrades to the
/// identity rotation instead of propagating NaNs or panicking.
fn quat_from_xyzw(rotation: [f64; 4]) -> nalgebra::UnitQuaternion<f64> {
    let n2 = rotation[0] * rotation[0]
        + rotation[1] * rotation[1]
        + rotation[2] * rotation[2]
        + rotation[3] * rotation[3];
    if !n2.is_finite() || n2 <= 0.0 {
        return nalgebra::UnitQuaternion::identity();
    }
    nalgebra::UnitQuaternion::from_quaternion(nalgebra::Quaternion::new(
        rotation[3],
        rotation[0],
        rotation[1],
        rotation[2],
    ))
}

/// Composes a parent world transform with a child local transform (TRS composition).
///
/// Equivalent to the matrix product `parent_world * local`, where every
/// transform is `T(position) * R(rotation) * S(scale)`:
///
/// - rotation composes as the quaternion product `parent_rot * local_rot`
///   (never componentwise addition);
/// - scale composes componentwise, `parent_scale .* local_scale`;
/// - position is `parent_pos + parent_rot * (parent_scale .* local_pos)`.
pub fn compose_transform(parent: &Transform, local: &Transform) -> Transform {
    let parent_rot = quat_from_xyzw(parent.rotation);
    let local_rot = quat_from_xyzw(local.rotation);
    let world_rot = parent_rot * local_rot;
    let scaled_local = nalgebra::Vector3::new(
        local.position[0] * parent.scale[0],
        local.position[1] * parent.scale[1],
        local.position[2] * parent.scale[2],
    );
    let rotated_local = parent_rot * scaled_local;
    let q = world_rot.into_inner();
    Transform {
        position: [
            parent.position[0] + rotated_local.x,
            parent.position[1] + rotated_local.y,
            parent.position[2] + rotated_local.z,
        ],
        rotation: [q.coords.x, q.coords.y, q.coords.z, q.coords.w],
        scale: [
            parent.scale[0] * local.scale[0],
            parent.scale[1] * local.scale[1],
            parent.scale[2] * local.scale[2],
        ],
    }
}

/// Component structure for assemblies.
///
/// A component is either backed by a document entity (`entity_id`) or by an
/// external reference (`external_ref`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyComponent {
    /// Unique id of this component within the assembly.
    pub id: EntityId,
    /// Backing document entity, if the component is not an external reference.
    pub entity_id: Option<EntityId>,
    /// External file/reference path, if the component is a reference.
    pub external_ref: Option<String>,
    /// Display name.
    pub name: String,
    /// Local placement of the component.
    pub transform: Transform,
    /// Whether the component is shown.
    pub visible: bool,
    /// Whether the component is locked against edits.
    pub locked: bool,
    /// Per-channel overrides applied on top of `transform`.
    pub transform_overrides: TransformOverrides,
    /// True when the component represents an external reference.
    pub is_reference: bool,
}

impl AssemblyComponent {
    /// Creates a component bound to a document entity.
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

    /// Creates a component that references external content.
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

    /// Applies this component's overrides on top of a base transform.
    pub fn get_effective_transform(&self, base_transform: &Transform) -> Transform {
        self.transform_overrides.apply(base_transform)
    }
}

/// Transform override configuration for components.
///
/// Each channel (`position`, `rotation`, `scale`) can independently override
/// the base transform it is applied to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TransformOverrides {
    /// Whether the position channel overrides the base value.
    pub position_override: bool,
    /// Whether the rotation channel overrides the base value.
    pub rotation_override: bool,
    /// Whether the scale channel overrides the base value.
    pub scale_override: bool,
    /// Override value for the position channel.
    pub position: [f64; 3],
    /// Override value for the rotation channel.
    pub rotation: [f64; 4],
    /// Override value for the scale channel.
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
    /// True when at least one channel is overridden.
    pub fn has_overrides(&self) -> bool {
        self.position_override || self.rotation_override || self.scale_override
    }

    /// Returns `base_transform` with every enabled channel replaced.
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
    /// Component whose layer visibility/lock is overridden.
    pub component_id: EntityId,
    /// Layer the override applies to.
    pub layer_id: EntityId,
    /// Overridden visibility flag.
    pub visible: bool,
    /// Overridden lock flag.
    pub locked: bool,
}

/// Transform hierarchy node for a component.
///
/// Hierarchy links live here (`parent_id`); the parent chain is walked to
/// compute `global_transform` from `local_transform`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentTransform {
    /// Component this transform node belongs to.
    pub id: EntityId,
    /// Parent component, if any. `None` marks a hierarchy root.
    pub parent_id: Option<EntityId>,
    /// Placement relative to the parent.
    pub local_transform: Transform,
    /// Cached world placement, refreshed by [`Assembly::update_transforms`].
    pub global_transform: Transform,
    /// Legacy flag for absolute (world-space) placement.
    pub is_absolute: bool,
}

impl ComponentTransform {
    /// Creates a hierarchy node with identity transforms.
    pub fn new(id: EntityId, parent_id: Option<EntityId>) -> Self {
        Self {
            id,
            parent_id,
            local_transform: Transform::default(),
            global_transform: Transform::default(),
            is_absolute: false,
        }
    }

    /// Recomputes `global_transform` from the parent world transform
    /// (or copies `local_transform` when the node is a root).
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

    /// TRS-composes the parent world transform with this node's local transform.
    fn compute_global_transform(&self, parent_global: &Transform) -> Transform {
        compose_transform(parent_global, &self.local_transform)
    }
}

/// Component reference record (entity IDs, external references).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComponentReference {
    /// Component the reference belongs to.
    pub component_id: EntityId,
    /// Backing document entity, if any.
    pub entity_id: Option<EntityId>,
    /// External reference path, if any.
    pub external_path: Option<String>,
    /// Creation timestamp (milliseconds, `0` without the `chrono` feature).
    pub created_at: u64,
    /// Last modification timestamp (milliseconds, `0` without `chrono`).
    pub modified_at: u64,
}

/// Assembly metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AssemblyMetadata {
    /// Display name.
    pub name: String,
    /// Optional human-readable description.
    pub description: Option<String>,
    /// Whether the assembly is shown.
    pub visible: bool,
    /// Whether the assembly is locked against edits.
    pub locked: bool,
    /// Creation timestamp (milliseconds, `0` without the `chrono` feature).
    pub created_at: u64,
    /// Last modification timestamp (milliseconds, `0` without `chrono`).
    pub modified_at: u64,
    /// User-visible revision counter.
    pub version: u32,
}

impl Default for AssemblyMetadata {
    #[allow(unexpected_cfgs)]
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
///
/// Component identities live in [`Assembly::components`]; the parent/child
/// hierarchy and cached transforms live in
/// [`Assembly::component_transforms`]. A component may exist without a
/// hierarchy node (then it behaves as a standalone root whose world
/// transform is its own `transform` field).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Assembly {
    /// Unique id of the assembly itself.
    pub id: EntityId,
    /// Display metadata.
    pub metadata: AssemblyMetadata,
    /// All components by id.
    pub components: BTreeMap<EntityId, AssemblyComponent>,
    /// Hierarchy nodes and cached transforms by component id.
    pub component_transforms: BTreeMap<EntityId, ComponentTransform>,
    /// External/component reference records.
    pub component_references: Vec<ComponentReference>,
    /// Per-component layer visibility/lock overrides.
    pub layer_overrides: BTreeMap<EntityId, AssemblyLayerOverride>,
    /// True when the assembly is a top-level (root) assembly.
    pub is_root: bool,
}

impl Assembly {
    /// Creates an empty assembly with the given id and name.
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

    /// Inserts a component, rejecting duplicate component ids.
    pub fn add_component(&mut self, component: AssemblyComponent) -> Result<(), String> {
        if self.components.contains_key(&component.id) {
            return Err("Component with this ID already exists".to_string());
        }
        self.components.insert(component.id, component);
        self.metadata.modified_at = get_current_timestamp();
        Ok(())
    }

    /// Wraps a document entity in a new component and returns its component id.
    pub fn add_entity_component(&mut self, entity_id: EntityId, name: String) -> Result<EntityId, String> {
        let component_id = EntityId::new();
        let component = AssemblyComponent::new_entity_component(component_id, entity_id, name);
        self.add_component(component)?;
        Ok(component_id)
    }

    /// Adds a component referencing external content and returns its component id.
    pub fn add_reference_component(&mut self, external_ref: String, name: String) -> Result<EntityId, String> {
        let component_id = EntityId::new();
        let component = AssemblyComponent::new_reference_component(component_id, external_ref, name);
        self.add_component(component)?;
        Ok(component_id)
    }

    /// Replaces a component's local placement transform.
    pub fn set_component_transform(&mut self, component_id: EntityId, transform: Transform) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.transform = transform;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    /// Replaces a component's transform override configuration.
    pub fn set_component_overrides(&mut self, component_id: EntityId, overrides: TransformOverrides) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.transform_overrides = overrides;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    /// Removes a component together with its hierarchy node and layer overrides.
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

    /// Explodes the assembly: every component's world transform is offset by
    /// `offset`, the hierarchy is flattened (all components become roots) and
    /// the resulting world placements are returned as `(component_id, transform)`
    /// pairs in ascending component-id order.
    pub fn explode(&mut self, offset: [f64; 3]) -> Vec<(EntityId, Transform)> {
        let component_ids: Vec<EntityId> = self.components.keys().copied().collect();
        let mut current_worlds: Vec<(EntityId, Transform)> = Vec::with_capacity(component_ids.len());
        for id in component_ids {
            let current = match self.world_transform(id) {
                Ok(world) => world,
                Err(_) => self.components.get(&id).map(|c| c.transform).unwrap_or_default(),
            };
            current_worlds.push((id, current));
        }
        let mut moved: Vec<(EntityId, Transform)> = Vec::with_capacity(current_worlds.len());
        for (id, current) in current_worlds {
            let mut target = current;
            target.position[0] += offset[0];
            target.position[1] += offset[1];
            target.position[2] += offset[2];
            if let Some(node) = self.component_transforms.get_mut(&id) {
                node.parent_id = None;
                node.local_transform = target;
                node.global_transform = target;
            }
            if let Some(component) = self.components.get_mut(&id) {
                component.transform = target;
            }
            moved.push((id, target));
        }
        self.metadata.modified_at = get_current_timestamp();
        moved
    }

    /// Refreshes every cached `global_transform` from the local transforms.
    ///
    /// Nodes are evaluated roots-first (preorder), so a parent's freshly
    /// computed world transform is always used for its children.
    pub fn update_transforms(&mut self) {
        let order = self.transform_node_preorder();
        let mut globals: BTreeMap<EntityId, Transform> = BTreeMap::new();
        for id in order {
            let local = self
                .component_transforms
                .get(&id)
                .map(|node| node.local_transform)
                .unwrap_or_default();
            let global = match self.hierarchy_parent_of(id) {
                Some(parent) => match globals.get(&parent) {
                    Some(parent_global) => compose_transform(parent_global, &local),
                    None => local,
                },
                None => local,
            };
            globals.insert(id, global);
        }
        for (id, node) in self.component_transforms.iter_mut() {
            if let Some(global) = globals.get(id) {
                node.global_transform = *global;
            }
        }
        self.metadata.modified_at = get_current_timestamp();
    }

    /// Number of components in the assembly.
    pub fn component_count(&self) -> usize {
        self.components.len()
    }

    /// Direct children of `component_id` in the transform hierarchy,
    /// in ascending component-id order. Unknown ids yield an empty vector.
    pub fn children_of(&self, component_id: EntityId) -> Vec<EntityId> {
        self.component_transforms
            .values()
            .filter(|node| node.parent_id == Some(component_id))
            .map(|node| node.id)
            .collect()
    }

    /// Reparents `child` under `new_parent`.
    ///
    /// Accepts a plain `EntityId`, `Some(id)` or `None` (detaches the child,
    /// making it a root). Rejects unknown components, self-parenting and any
    /// reparenting that would create a cycle (including corrupt pre-existing
    /// cycles encountered while walking ancestors). A missing hierarchy node
    /// is created lazily with an identity local transform.
    pub fn set_parent(
        &mut self,
        child: EntityId,
        new_parent: impl Into<Option<EntityId>>,
    ) -> Result<(), String> {
        let new_parent = new_parent.into();
        if !self.components.contains_key(&child) {
            return Err("Component not found".to_string());
        }
        if let Some(parent) = new_parent {
            if !self.components.contains_key(&parent) {
                return Err("Parent component not found".to_string());
            }
            if parent == child {
                return Err("Cannot set a component as its own parent".to_string());
            }
            let mut visited = BTreeSet::new();
            let mut cursor = Some(parent);
            while let Some(ancestor) = cursor {
                if !visited.insert(ancestor) {
                    break;
                }
                if ancestor == child {
                    return Err("Reparenting would create a cycle".to_string());
                }
                cursor = self.hierarchy_parent_of(ancestor);
            }
        }
        let node = self
            .component_transforms
            .entry(child)
            .or_insert_with(|| ComponentTransform::new(child, None));
        node.parent_id = new_parent;
        self.metadata.modified_at = get_current_timestamp();
        Ok(())
    }

    /// Recomputes the world transform of `component_id` by walking and
    /// composing the whole parent chain.
    ///
    /// Missing hierarchy nodes contribute their component's `transform` field
    /// (or identity). Fails for unknown ids and for corrupt hierarchy cycles.
    pub fn world_transform(&self, component_id: EntityId) -> Result<Transform, String> {
        if !self.components.contains_key(&component_id)
            && !self.component_transforms.contains_key(&component_id)
        {
            return Err("Component not found".to_string());
        }
        let mut chain = Vec::new();
        let mut visited = BTreeSet::new();
        let mut cursor = Some(component_id);
        while let Some(id) = cursor {
            if !visited.insert(id) {
                return Err("Transform hierarchy contains a cycle".to_string());
            }
            chain.push(id);
            cursor = self.hierarchy_parent_of(id);
        }
        chain.reverse();
        let mut world = Transform::default();
        for id in chain {
            world = compose_transform(&world, &self.effective_local_transform(id));
        }
        Ok(world)
    }

    /// Renames a component.
    pub fn rename_component(&mut self, component_id: EntityId, name: String) -> Result<(), String> {
        match self.components.get_mut(&component_id) {
            Some(component) => {
                component.name = name;
                self.metadata.modified_at = get_current_timestamp();
                Ok(())
            }
            None => Err("Component not found".to_string()),
        }
    }

    /// Duplicates a component (and its hierarchy node, keeping the same
    /// parent) under a fresh id named `"<name> (copy)"`.
    pub fn duplicate_component(&mut self, component_id: EntityId) -> Result<EntityId, String> {
        let mut copy = self
            .components
            .get(&component_id)
            .cloned()
            .ok_or_else(|| "Component not found".to_string())?;
        copy.id = EntityId::new();
        copy.name = format!("{} (copy)", copy.name);
        let new_id = copy.id;
        self.components.insert(new_id, copy);
        if let Some(node) = self.component_transforms.get(&component_id).cloned() {
            let mut copied_node = node;
            copied_node.id = new_id;
            self.component_transforms.insert(new_id, copied_node);
        }
        self.metadata.modified_at = get_current_timestamp();
        Ok(new_id)
    }

    /// Walks the assembly depth-first, roots first.
    ///
    /// Hierarchy nodes are visited preorder with children in ascending
    /// component-id order (a node whose parent is missing counts as a root);
    /// components without a hierarchy node are appended afterwards, also in
    /// ascending id order. Corrupt cycles cannot make the walk diverge.
    pub fn walk_preorder(&self) -> Vec<EntityId> {
        let mut order = self.transform_node_preorder();
        for id in self.components.keys() {
            if !self.component_transforms.contains_key(id) {
                order.push(*id);
            }
        }
        order
    }

    /// Shows or hides a component.
    pub fn set_component_visibility(&mut self, component_id: EntityId, visible: bool) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.visible = visible;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    /// Locks or unlocks a component.
    pub fn set_component_lock(&mut self, component_id: EntityId, locked: bool) -> Result<(), String> {
        if let Some(component) = self.components.get_mut(&component_id) {
            component.locked = locked;
            self.metadata.modified_at = get_current_timestamp();
            Ok(())
        } else {
            Err("Component not found".to_string())
        }
    }

    /// All visible components, in ascending id order.
    pub fn get_visible_components(&self) -> Vec<&AssemblyComponent> {
        self.components.values().filter(|c| c.visible).collect()
    }

    /// All locked components, in ascending id order.
    pub fn get_locked_components(&self) -> Vec<&AssemblyComponent> {
        self.components.values().filter(|c| c.locked).collect()
    }

    /// Parent of `id` according to the transform hierarchy, if any.
    fn hierarchy_parent_of(&self, id: EntityId) -> Option<EntityId> {
        self.component_transforms.get(&id).and_then(|node| node.parent_id)
    }

    /// Local placement contribution of `id`: its hierarchy node's
    /// `local_transform`, falling back to the component's `transform` field,
    /// falling back to identity.
    fn effective_local_transform(&self, id: EntityId) -> Transform {
        if let Some(node) = self.component_transforms.get(&id) {
            node.local_transform
        } else if let Some(component) = self.components.get(&id) {
            component.transform
        } else {
            Transform::default()
        }
    }

    /// Preorder over the transform hierarchy only: roots first, then children
    /// in ascending id order. Unreachable nodes (corrupt cycles) are appended
    /// sorted so the walk always covers every node exactly once.
    fn transform_node_preorder(&self) -> Vec<EntityId> {
        let mut parents: BTreeMap<EntityId, Option<EntityId>> = BTreeMap::new();
        for (id, node) in &self.component_transforms {
            parents.insert(*id, node.parent_id);
        }
        let mut children: BTreeMap<EntityId, Vec<EntityId>> = BTreeMap::new();
        for (id, parent) in &parents {
            if let Some(parent_id) = parent {
                if parents.contains_key(parent_id) {
                    children.entry(*parent_id).or_default().push(*id);
                }
            }
        }
        let roots: Vec<EntityId> = parents
            .iter()
            .filter_map(|(id, parent)| match parent {
                None => Some(*id),
                Some(parent_id) if parents.contains_key(parent_id) => None,
                Some(_) => Some(*id),
            })
            .collect();
        let mut order: Vec<EntityId> = Vec::with_capacity(parents.len());
        let mut visited: BTreeSet<EntityId> = BTreeSet::new();
        for root in roots {
            let mut stack = vec![root];
            while let Some(id) = stack.pop() {
                if !visited.insert(id) {
                    continue;
                }
                order.push(id);
                if let Some(kids) = children.get(&id) {
                    for kid in kids.iter().rev() {
                        if !visited.contains(kid) {
                            stack.push(*kid);
                        }
                    }
                }
            }
        }
        for id in parents.keys() {
            if !visited.contains(id) {
                order.push(*id);
            }
        }
        order
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOL: f64 = 1e-9;

    /// Deterministic entity id (uuid 00000000-0000-0000-0000-00000000000NN).
    fn fid(n: u64) -> EntityId {
        EntityId::parse(&format!("00000000-0000-0000-0000-{n:012}")).expect("valid test id")
    }

    fn component(id: u64, name: &str) -> AssemblyComponent {
        AssemblyComponent::new_entity_component(fid(id), fid(id + 500), name.to_string())
    }

    fn node(id: u64, parent: Option<u64>) -> ComponentTransform {
        ComponentTransform::new(fid(id), parent.map(fid))
    }

    fn assert_slice_close(actual: &[f64], expected: &[f64], context: &str) {
        assert_eq!(actual.len(), expected.len(), "{context}");
        for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
            assert!((a - e).abs() < TOL, "{context}: [{i}] {a} vs {e}");
        }
    }

    fn assert_quat_close(actual: [f64; 4], expected: [f64; 4], context: &str) {
        let direct = (0..4)
            .map(|i| (actual[i] - expected[i]).abs())
            .fold(0.0f64, f64::max);
        let negated = (0..4)
            .map(|i| (actual[i] + expected[i]).abs())
            .fold(0.0f64, f64::max);
        assert!(
            direct.min(negated) < TOL,
            "{context}: {actual:?} vs {expected:?} (q and -q both accepted)"
        );
    }

    fn quarter_turn_z() -> Transform {
        Transform::from_axis_angle([0.0, 0.0, 1.0], std::f64::consts::FRAC_PI_2)
    }

    #[test]
    fn compose_translation_adds_parent_position() {
        let parent = Transform::at(10.0, 20.0, 30.0);
        let local = Transform::at(1.0, 2.0, 3.0);
        let world = compose_transform(&parent, &local);
        assert_slice_close(&world.position, &[11.0, 22.0, 33.0], "translation");
    }

    #[test]
    fn compose_two_90deg_z_rotations_equal_180deg() {
        let parent = quarter_turn_z();
        let local = quarter_turn_z();
        let world = compose_transform(&parent, &local);
        assert_quat_close(world.rotation, [0.0, 0.0, 1.0, 0.0], "two quarter turns");
        assert_slice_close(
            &world.transform_point([1.0, 0.0, 0.0]),
            &[-1.0, 0.0, 0.0],
            "180deg rotates +x to -x",
        );
    }

    #[test]
    fn compose_scale_multiplies_componentwise() {
        let mut parent = Transform::default();
        parent.scale = [2.0, 3.0, 4.0];
        let mut local = Transform::default();
        local.scale = [10.0, 0.5, 1.0];
        let world = compose_transform(&parent, &local);
        assert_slice_close(&world.scale, &[20.0, 1.5, 4.0], "scale product");
    }

    #[test]
    fn compose_position_applies_parent_scale_then_rotation() {
        let mut parent = quarter_turn_z();
        parent.position = [10.0, 0.0, 0.0];
        parent.scale = [2.0, 1.0, 1.0];
        let mut local = Transform::default();
        local.position = [1.0, 0.0, 0.0];
        let world = compose_transform(&parent, &local);
        assert_slice_close(&world.position, &[10.0, 2.0, 0.0], "scale then rotate then translate");
    }

    #[test]
    fn component_transform_update_global_matches_composition() {
        let mut node = ComponentTransform::new(fid(7), None);
        node.parent_id = Some(fid(6));
        node.local_transform = Transform::at(1.0, 2.0, 3.0);
        let parent_global = Transform::at(10.0, 20.0, 30.0);
        node.update_global(Some(&parent_global));
        assert_slice_close(&node.global_transform.position, &[11.0, 22.0, 33.0], "global position");
        node.update_global(None);
        assert_eq!(node.global_transform, node.local_transform, "root copies local");
    }

    #[test]
    fn zero_quaternion_degrades_to_identity_instead_of_nan() {
        let parent = Transform::default();
        let mut local = Transform::default();
        local.rotation = [0.0, 0.0, 0.0, 0.0];
        local.scale = [2.0, 2.0, 2.0];
        let world = compose_transform(&parent, &local);
        assert!(world.rotation.iter().all(|v| v.is_finite()), "finite rotation");
        assert_quat_close(world.rotation, [0.0, 0.0, 0.0, 1.0], "identity fallback");
        assert_slice_close(&world.scale, &[2.0, 2.0, 2.0], "scale still composes");
    }

    fn hierarchy_fixture() -> Assembly {
        let mut asm = Assembly::new(fid(1), "fixture".to_string());
        for (id, name) in [(10u64, "root"), (11, "mid"), (12, "leaf")] {
            asm.components.insert(fid(id), component(id, name));
        }
        let mut root_node = node(10, None);
        root_node.local_transform = quarter_turn_z();
        root_node.local_transform.position = [100.0, 0.0, 0.0];
        let mut mid_node = node(11, Some(10));
        mid_node.local_transform = Transform::at(1.0, 0.0, 0.0);
        let mut leaf_node = node(12, Some(11));
        leaf_node.local_transform = quarter_turn_z();
        leaf_node.local_transform.position = [1.0, 0.0, 0.0];
        asm.component_transforms.insert(fid(10), root_node);
        asm.component_transforms.insert(fid(11), mid_node);
        asm.component_transforms.insert(fid(12), leaf_node);
        asm
    }

    #[test]
    fn world_transform_recomputes_whole_chain() {
        let asm = hierarchy_fixture();
        let leaf_world = asm.world_transform(fid(12)).expect("leaf exists");
        assert_slice_close(&leaf_world.position, &[100.0, 2.0, 0.0], "chained position");
        assert_quat_close(leaf_world.rotation, [0.0, 0.0, 1.0, 0.0], "chained rotation");
        let root_world = asm.world_transform(fid(10)).expect("root exists");
        assert_slice_close(&root_world.position, &[100.0, 0.0, 0.0], "root position");
        assert!(asm.world_transform(fid(999)).is_err(), "unknown id errors");
    }

    #[test]
    fn update_transforms_propagates_in_hierarchy_order() {
        let mut asm = hierarchy_fixture();
        asm.update_transforms();
        let leaf = &asm.component_transforms[&fid(12)];
        assert_slice_close(&leaf.global_transform.position, &[100.0, 2.0, 0.0], "leaf global");
        assert_quat_close(leaf.global_transform.rotation, [0.0, 0.0, 1.0, 0.0], "leaf rotation");
        let mid = &asm.component_transforms[&fid(11)];
        assert_slice_close(&mid.global_transform.position, &[100.0, 1.0, 0.0], "mid global");
    }

    #[test]
    fn set_parent_rejects_cycles_and_self_parenting() {
        let mut asm = Assembly::new(fid(1), "cycles".to_string());
        for id in [10u64, 11, 12] {
            asm.components.insert(fid(id), component(id, "c"));
        }
        asm.set_parent(fid(11), fid(10)).expect("attach 11 under 10");
        asm.set_parent(fid(12), fid(11)).expect("attach 12 under 11");

        let cycle = asm.set_parent(fid(10), fid(12));
        assert!(cycle.is_err(), "grandparent reparent must be rejected");
        let self_parent = asm.set_parent(fid(10), fid(10));
        assert!(self_parent.is_err(), "self-parenting must be rejected");
        let unknown = asm.set_parent(fid(10), fid(99));
        assert!(unknown.is_err(), "unknown parent must be rejected");

        assert_eq!(
            asm.component_transforms.get(&fid(10)).map(|n| n.parent_id),
            None,
            "failed reparenting leaves the graph untouched"
        );
        assert_eq!(asm.children_of(fid(10)), vec![fid(11)], "graph unchanged");
    }

    #[test]
    fn children_of_lists_direct_children_sorted() {
        let mut asm = Assembly::new(fid(1), "children".to_string());
        for id in [10u64, 11, 12, 13] {
            asm.components.insert(fid(id), component(id, "c"));
            asm.component_transforms.insert(fid(id), node(id, None));
        }
        asm.set_parent(fid(12), fid(10)).expect("12 under 10");
        asm.set_parent(fid(11), fid(10)).expect("11 under 10");
        asm.set_parent(fid(13), fid(12)).expect("13 under 12");

        assert_eq!(asm.children_of(fid(10)), vec![fid(11), fid(12)]);
        assert_eq!(asm.children_of(fid(12)), vec![fid(13)]);
        assert!(asm.children_of(fid(13)).is_empty(), "leaves have no children");
        assert!(asm.children_of(fid(77)).is_empty(), "unknown ids yield no children");

        asm.set_parent(fid(12), None).expect("detach 12");
        assert_eq!(asm.children_of(fid(10)), vec![fid(11)], "detached child is gone");
        assert_eq!(
            asm.component_transforms.get(&fid(12)).map(|n| n.parent_id),
            Some(None),
            "detached node becomes a root"
        );
    }

    #[test]
    fn walk_preorder_is_depth_first_roots_first() {
        let mut asm = Assembly::new(fid(1), "walk".to_string());
        for (id, parent) in [(20u64, None), (21, Some(20u64)), (23, Some(20u64)), (22, Some(21u64)), (30, None)] {
            asm.components.insert(fid(id), component(id, "c"));
            asm.component_transforms.insert(fid(id), node(id, parent));
        }
        assert_eq!(
            asm.walk_preorder(),
            vec![fid(20), fid(21), fid(22), fid(23), fid(30)],
            "root, its subtree depth-first, then the sibling root"
        );
    }

    #[test]
    fn walk_preorder_appends_components_without_hierarchy_nodes() {
        let mut asm = Assembly::new(fid(1), "orphans".to_string());
        asm.components.insert(fid(40), component(40, "orphan"));
        asm.components.insert(fid(41), component(41, "attached"));
        asm.component_transforms.insert(fid(41), node(41, None));
        assert_eq!(asm.walk_preorder(), vec![fid(41), fid(40)]);
    }

    #[test]
    fn duplicate_component_makes_named_copy_under_same_parent() {
        let mut asm = Assembly::new(fid(1), "dup".to_string());
        for id in [10u64, 11] {
            asm.components.insert(fid(id), component(id, "bracket"));
            asm.component_transforms.insert(fid(id), node(id, None));
        }
        asm.set_parent(fid(11), fid(10)).expect("11 under 10");

        let copy_id = asm.duplicate_component(fid(11)).expect("duplicate succeeds");
        assert_ne!(copy_id, fid(11), "copy gets a fresh id");
        assert_eq!(asm.component_count(), 3);
        let copy = &asm.components[&copy_id];
        assert_eq!(copy.name, "bracket (copy)", "copy name carries the (copy) suffix");
        let copy_node = &asm.component_transforms[&copy_id];
        assert_eq!(copy_node.parent_id, Some(fid(10)), "copy shares the parent");
        assert_eq!(copy_node.local_transform, asm.component_transforms[&fid(11)].local_transform);
        assert!(asm.duplicate_component(fid(99)).is_err(), "unknown id errors");
    }

    #[test]
    fn rename_component_updates_display_name() {
        let mut asm = Assembly::new(fid(1), "rename".to_string());
        asm.components.insert(fid(10), component(10, "old"));
        asm.rename_component(fid(10), "new".to_string()).expect("rename succeeds");
        assert_eq!(asm.components[&fid(10)].name, "new");
        assert!(asm.rename_component(fid(77), "nope".to_string()).is_err());
    }

    #[test]
    fn explode_offsets_every_component_from_its_global_and_flattens() {
        let mut asm = Assembly::new(fid(1), "explode".to_string());
        asm.components.insert(fid(10), component(10, "parent"));
        asm.components.insert(fid(11), component(11, "child"));
        asm.component_transforms.insert(fid(10), node(10, None));
        let mut child_node = node(11, Some(10));
        child_node.local_transform = Transform::at(5.0, 0.0, 0.0);
        asm.component_transforms.insert(fid(11), child_node);
        asm.update_transforms();

        let moved = asm.explode([10.0, 20.0, 30.0]);
        assert_eq!(moved.len(), 2, "one pair per component");
        assert_eq!(moved[0].0, fid(10), "ascending component id order");
        assert_slice_close(&moved[0].1.position, &[10.0, 20.0, 30.0], "parent moved from its global");
        assert_eq!(moved[1].0, fid(11));
        assert_slice_close(&moved[1].1.position, &[15.0, 20.0, 30.0], "child moved from its global");

        let child_node = &asm.component_transforms[&fid(11)];
        assert_eq!(child_node.parent_id, None, "explode flattens the hierarchy");
        assert_slice_close(&child_node.local_transform.position, &[15.0, 20.0, 30.0], "local equals moved world");
        asm.update_transforms();
        assert_slice_close(
            &asm.component_transforms[&fid(11)].global_transform.position,
            &[15.0, 20.0, 30.0],
            "flattened layout survives a transform refresh",
        );
    }

    #[test]
    fn component_count_tracks_components_map() {
        let mut asm = Assembly::new(fid(1), "count".to_string());
        assert_eq!(asm.component_count(), 0);
        asm.components.insert(fid(10), component(10, "a"));
        asm.components.insert(fid(11), component(11, "b"));
        assert_eq!(asm.component_count(), 2);
        asm.remove_component(fid(10)).expect("remove succeeds");
        assert_eq!(asm.component_count(), 1);
    }

    #[test]
    fn assembly_round_trips_through_json() {
        let mut asm = hierarchy_fixture();
        asm.component_references.push(ComponentReference {
            component_id: fid(12),
            entity_id: None,
            external_path: Some("./part.step".to_string()),
            created_at: 0,
            modified_at: 0,
        });
        asm.layer_overrides.insert(
            fid(12),
            AssemblyLayerOverride {
                component_id: fid(12),
                layer_id: fid(2),
                visible: false,
                locked: true,
            },
        );
        let json = serde_json::to_string(&asm).expect("serializes");
        let parsed: Assembly = serde_json::from_str(&json).expect("deserializes");
        assert_eq!(parsed, asm, "full assembly round-trips losslessly");
    }
}
