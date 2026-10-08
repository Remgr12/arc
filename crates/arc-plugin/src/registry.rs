use crate::{PluginManifest, PluginError, PluginRef, PluginCategory, PluginPermission};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct PluginRegistry {
    plugins: HashMap<String, PluginEntry>,
    load_order: Vec<String>,
    plugin_dirs: Vec<PathBuf>,
}

#[derive(Debug, Clone)]
struct PluginEntry {
    manifest: PluginManifest,
    plugin: Option<PluginRef>,
    loaded: bool,
    enabled: bool,
    error: Option<String>,
}

impl PluginRegistry {
    pub fn new() -> Self {
        Self {
            plugins: HashMap::new(),
            load_order: Vec::new(),
            plugin_dirs: Vec::new(),
        }
    }

    pub fn add_plugin_dir(&mut self, dir: PathBuf) {
        if !self.plugin_dirs.contains(&dir) {
            self.plugin_dirs.push(dir);
        }
    }

    pub fn discover_plugins(&mut self) -> Result<Vec<PluginManifest>, PluginError> {
        let mut discovered = Vec::new();
        
        for dir in &self.plugin_dirs {
            if dir.exists() {
                for entry in std::fs::read_dir(dir)? {
                    let entry = entry?;
                    let path = entry.path();
                    
                    if path.is_dir() {
                        let manifest_path = path.join("plugin.json");
                        if manifest_path.exists() {
                            let content = std::fs::read_to_string(&manifest_path)?;
                            let manifest: PluginManifest = serde_json::from_str(&content)?;
                            self.register_manifest(manifest.clone())?;
                            discovered.push(manifest);
                        }
                    } else if path.extension().map_or(false, |ext| ext == "json") {
                        let content = std::fs::read_to_string(&path)?;
                        let manifest: PluginManifest = serde_json::from_str(&content)?;
                        self.register_manifest(manifest.clone())?;
                        discovered.push(manifest);
                    }
                }
            }
        }
        
        Ok(discovered)
    }

    pub fn register_manifest(&mut self, manifest: PluginManifest) -> Result<(), PluginError> {
        if self.plugins.contains_key(&manifest.id) {
            return Err(PluginError::Configuration(format!("Plugin {} already registered", manifest.id)));
        }
        
        for dep in &manifest.dependencies {
            if !dep.optional && !self.plugins.contains_key(&dep.id) {
                return Err(PluginError::Dependency(format!("Missing required dependency: {}", dep.id)));
            }
        }
        
        let entry = PluginEntry {
            manifest: manifest.clone(),
            plugin: None,
            loaded: false,
            enabled: true,
            error: None,
        };
        
        self.plugins.insert(manifest.id.clone(), entry);
        self.update_load_order();
        
        Ok(())
    }

    pub fn unregister_plugin(&mut self, id: &str) -> Result<(), PluginError> {
        if let Some(entry) = self.plugins.remove(id) {
            if entry.loaded {
                if let Some(plugin) = entry.plugin {
                    plugin.write().shutdown()?;
                }
            }
            self.update_load_order();
        }
        Ok(())
    }

    pub fn get_manifest(&self, id: &str) -> Option<&PluginManifest> {
        self.plugins.get(id).map(|e| &e.manifest)
    }

    pub fn get_plugin(&self, id: &str) -> Option<PluginRef> {
        self.plugins.get(id).and_then(|e| e.plugin.clone())
    }

    pub fn is_loaded(&self, id: &str) -> bool {
        self.plugins.get(id).map(|e| e.loaded).unwrap_or(false)
    }

    pub fn is_enabled(&self, id: &str) -> bool {
        self.plugins.get(id).map(|e| e.enabled).unwrap_or(false)
    }

    pub fn set_enabled(&mut self, id: &str, enabled: bool) -> Result<(), PluginError> {
        if let Some(entry) = self.plugins.get_mut(id) {
            entry.enabled = enabled;
            if !enabled && entry.loaded {
                if let Some(plugin) = &entry.plugin {
                    plugin.write().shutdown()?;
                }
                entry.loaded = false;
                entry.plugin = None;
            }
        }
        Ok(())
    }

    pub fn load_plugin(&mut self, id: &str, plugin: PluginRef) -> Result<(), PluginError> {
        if let Some(entry) = self.plugins.get_mut(id) {
            if entry.loaded {
                return Err(PluginError::Runtime("Plugin already loaded".to_string()));
            }
            
            if !entry.enabled {
                return Err(PluginError::Runtime("Plugin is disabled".to_string()));
            }
            
            let context = self.create_context(&entry.manifest)?;
            plugin.write().initialize(&context)?;
            plugin.write().on_load()?;
            
            entry.plugin = Some(plugin);
            entry.loaded = true;
            entry.error = None;
        }
        Ok(())
    }

    pub fn unload_plugin(&mut self, id: &str) -> Result<(), PluginError> {
        if let Some(entry) = self.plugins.get_mut(id) {
            if entry.loaded {
                if let Some(plugin) = &entry.plugin {
                    plugin.write().on_unload()?;
                    plugin.write().shutdown()?;
                }
                entry.plugin = None;
                entry.loaded = false;
            }
        }
        Ok(())
    }

    pub fn reload_plugin(&mut self, id: &str, plugin: PluginRef) -> Result<(), PluginError> {
        self.unload_plugin(id)?;
        self.load_plugin(id, plugin)
    }

    pub fn load_all(&mut self, factory: &dyn PluginFactory) -> Result<Vec<String>, PluginError> {
        let mut loaded = Vec::new();
        let mut errors = Vec::new();
        
        for id in &self.load_order.clone() {
            if let Some(entry) = self.plugins.get(id) {
                if entry.enabled && !entry.loaded {
                    match factory.create_plugin(&entry.manifest) {
                        Ok(plugin) => {
                            if let Err(e) = self.load_plugin(id, plugin) {
                                errors.push(format!("{}: {}", id, e));
                            } else {
                                loaded.push(id.clone());
                            }
                        }
                        Err(e) => {
                            errors.push(format!("{}: {}", id, e));
                        }
                    }
                }
            }
        }
        
        if !errors.is_empty() {
            return Err(PluginError::Runtime(errors.join("; ")));
        }
        
        Ok(loaded)
    }

    pub fn unload_all(&mut self) -> Result<(), PluginError> {
        for id in self.load_order.iter().rev() {
            self.unload_plugin(id)?;
        }
        Ok(())
    }

    pub fn all_manifests(&self) -> Vec<&PluginManifest> {
        self.plugins.values().map(|e| &e.manifest).collect()
    }

    pub fn loaded_plugins(&self) -> Vec<String> {
        self.plugins.iter()
            .filter(|(_, e)| e.loaded)
            .map(|(id, _)| id.clone())
            .collect()
    }

    pub fn plugins_by_category(&self, category: PluginCategory) -> Vec<&PluginManifest> {
        self.plugins.values()
            .filter(|e| e.manifest.categories.contains(&category))
            .map(|e| &e.manifest)
            .collect()
    }

    fn update_load_order(&mut self) {
        self.load_order.clear();
        
        let mut visited = std::collections::HashSet::new();
        let mut visiting = std::collections::HashSet::new();
        
        fn visit(
            id: &str,
            plugins: &HashMap<String, PluginEntry>,
            visited: &mut std::collections::HashSet<String>,
            visiting: &mut std::collections::HashSet<String>,
            order: &mut Vec<String>,
        ) -> Result<(), String> {
            if visiting.contains(id) {
                return Err(format!("Circular dependency detected: {}", id));
            }
            if visited.contains(id) {
                return Ok(());
            }
            
            visiting.insert(id.to_string());
            
            if let Some(entry) = plugins.get(id) {
                for dep in &entry.manifest.dependencies {
                    if !dep.optional {
                        visit(&dep.id, plugins, visited, visiting, order)?;
                    }
                }
            }
            
            visiting.remove(id);
            visited.insert(id.to_string());
            order.push(id.to_string());
            
            Ok(())
        }
        
        for id in self.plugins.keys().cloned().collect::<Vec<_>>() {
            if !visited.contains(&id) {
                if let Err(e) = visit(&id, &self.plugins, &mut visited, &mut visiting, &mut self.load_order) {
                    eprintln!("Warning: {}", e);
                }
            }
        }
    }

    fn create_context(&self, manifest: &PluginManifest) -> Result<crate::PluginContext, PluginError> {
        Ok(crate::PluginContext {
            app: crate::AppAPI {
                documents: crate::DocumentAPI {
                    create_document: Box::new(|_| unimplemented!()),
                    open_document: Box::new(|_| unimplemented!()),
                    save_document: Box::new(|_| unimplemented!()),
                    close_document: Box::new(|_| unimplemented!()),
                    active_document: Box::new(|| unimplemented!()),
                },
                geometry: crate::GeometryAPI {
                    create_point: Box::new(|_| unimplemented!()),
                    create_line: Box::new(|_, _| unimplemented!()),
                    create_circle: Box::new(|_, _, _| unimplemented!()),
                    create_arc: Box::new(|_, _, _, _, _| unimplemented!()),
                    create_polyline: Box::new(|_, _| unimplemented!()),
                    create_box: Box::new(|_, _| unimplemented!()),
                    create_cylinder: Box::new(|_, _, _, _| unimplemented!()),
                    create_sphere: Box::new(|_, _| unimplemented!()),
                    boolean_union: Box::new(|_, _| unimplemented!()),
                    boolean_difference: Box::new(|_, _| unimplemented!()),
                    boolean_intersection: Box::new(|_, _| unimplemented!()),
                },
                modeling: crate::ModelingAPI {
                    create_sketch: Box::new(|_| unimplemented!()),
                    create_extrusion: Box::new(|_, _, _| unimplemented!()),
                    create_revolution: Box::new(|_, _, _, _| unimplemented!()),
                    create_loft: Box::new(|_| unimplemented!()),
                    create_sweep: Box::new(|_, _| unimplemented!()),
                    create_fillet: Box::new(|_, _, _| unimplemented!()),
                    create_chamfer: Box::new(|_, _, _| unimplemented!()),
                },
                architecture: crate::ArchitectureAPI {
                    create_wall: Box::new(|_, _, _| unimplemented!()),
                    create_door: Box::new(|_, _, _, _| unimplemented!()),
                    create_window: Box::new(|_, _, _, _| unimplemented!()),
                    create_stair: Box::new(|_, _, _, _, _| unimplemented!()),
                    create_roof: Box::new(|_, _| unimplemented!()),
                    create_slab: Box::new(|_, _, _| unimplemented!()),
                    create_column: Box::new(|_, _, _| unimplemented!()),
                    create_beam: Box::new(|_, _, _, _| unimplemented!()),
                    create_room: Box::new(|_, _| unimplemented!()),
                    create_grid: Box::new(|_, _, _, _, _, _, _| unimplemented!()),
                    create_level: Box::new(|_, _, _| unimplemented!()),
                },
                ui: crate::UIAPI {
                    add_panel: Box::new(|_, _, _| unimplemented!()),
                    remove_panel: Box::new(|_| unimplemented!()),
                    add_toolbar_button: Box::new(|_, _, _, _| unimplemented!()),
                    remove_toolbar_button: Box::new(|_| unimplemented!()),
                    show_message: Box::new(|_, _| unimplemented!()),
                    show_dialog: Box::new(|_, _| unimplemented!()),
                    set_status_bar: Box::new(|_| unimplemented!()),
                },
                commands: crate::CommandAPI {
                    register_command: Box::new(|_, _, _| unimplemented!()),
                    unregister_command: Box::new(|_| unimplemented!()),
                    execute_command: Box::new(|_, _| unimplemented!()),
                },
                settings: crate::SettingsAPI {
                    get: Box::new(|_| unimplemented!()),
                    set: Box::new(|_, _| unimplemented!()),
                    register: Box::new(|_, _, _| unimplemented!()),
                },
                files: crate::FileAPI {
                    read_file: Box::new(|_| unimplemented!()),
                    write_file: Box::new(|_, _| unimplemented!()),
                    list_directory: Box::new(|_| unimplemented!()),
                    file_dialog: Box::new(|_| unimplemented!()),
                },
            },
            document: None,
            settings: crate::PluginSettings {
                config: manifest.configuration.clone().unwrap_or(serde_json::Value::Null),
                data_path: PathBuf::new(),
            },
            logger: crate::PluginLogger {
                log: Box::new(|_, _| {}),
            },
        })
    }
}

impl Default for PluginRegistry {
    fn default() -> Self {
        Self::new()
    }
}

pub trait PluginFactory: Send + Sync {
    fn create_plugin(&self, manifest: &PluginManifest) -> Result<PluginRef, PluginError>;
    fn supported_types(&self) -> Vec<String>;
}