use crate::{PluginRegistry, PluginFactory, PluginRef, PluginManifest, PluginError, Plugin, PluginContext, PluginCategory};
use arc_core::{DocumentRef, Selection, UIEvent};
use std::sync::Arc;
use parking_lot::RwLock;
use std::collections::HashMap;

pub struct PluginManager {
    registry: PluginRegistry,
    factories: HashMap<String, Box<dyn PluginFactory>>,
    app_context: PluginContext,
    command_handlers: HashMap<String, Box<dyn Fn(&serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>>,
    ui_panels: HashMap<String, UIPanel>,
    toolbar_buttons: HashMap<String, ToolbarButton>,
    timers: HashMap<String, PluginTimer>,
}

#[derive(Debug, Clone)]
pub struct UIPanel {
    pub id: String,
    pub title: String,
    pub html: String,
    pub plugin_id: String,
    pub visible: bool,
}

#[derive(Debug, Clone)]
pub struct ToolbarButton {
    pub id: String,
    pub label: String,
    pub icon: String,
    pub tooltip: String,
    pub plugin_id: String,
    pub command: String,
    pub enabled: bool,
}

#[derive(Debug, Clone)]
pub struct PluginTimer {
    pub id: String,
    pub plugin_id: String,
    pub interval: f64,
    pub last_fire: std::time::Instant,
    pub repeating: bool,
}

impl PluginManager {
    pub fn new(app_context: PluginContext) -> Self {
        Self {
            registry: PluginRegistry::new(),
            factories: HashMap::new(),
            app_context,
            command_handlers: HashMap::new(),
            ui_panels: HashMap::new(),
            toolbar_buttons: HashMap::new(),
            timers: HashMap::new(),
        }
    }

    pub fn register_factory(&mut self, factory: Box<dyn PluginFactory>) {
        for typ in factory.supported_types() {
            self.factories.insert(typ, factory);
        }
    }

    pub fn add_plugin_dir(&mut self, dir: std::path::PathBuf) {
        self.registry.add_plugin_dir(dir);
    }

    pub fn discover_plugins(&mut self) -> Result<Vec<PluginManifest>, PluginError> {
        self.registry.discover_plugins()
    }

    pub fn load_all_plugins(&mut self) -> Result<Vec<String>, PluginError> {
        let mut loaded = Vec::new();
        
        for (id, manifest) in self.registry.plugins.iter() {
            if manifest.enabled && !manifest.loaded {
                if let Some(factory) = self.factories.get(&manifest.entry_point) {
                    match factory.create_plugin(manifest) {
                        Ok(plugin) => {
                            if let Err(e) = self.registry.load_plugin(id, plugin) {
                                eprintln!("Failed to load plugin {}: {}", id, e);
                            } else {
                                loaded.push(id.clone());
                                self.initialize_plugin_apis(id)?;
                            }
                        }
                        Err(e) => {
                            eprintln!("Failed to create plugin {}: {}", id, e);
                        }
                    }
                }
            }
        }
        
        Ok(loaded)
    }

    pub fn unload_all_plugins(&mut self) -> Result<(), PluginError> {
        self.registry.unload_all()?;
        self.command_handlers.clear();
        self.ui_panels.clear();
        self.toolbar_buttons.clear();
        self.timers.clear();
        Ok(())
    }

    fn initialize_plugin_apis(&mut self, plugin_id: &str) -> Result<(), PluginError> {
        if let Some(plugin_ref) = self.registry.get_plugin(plugin_id) {
            let mut plugin = plugin_ref.write();
            let context = self.create_plugin_context(plugin_id)?;
            
            plugin.on_document_created(&context.document.as_ref().unwrap())?;
        }
        Ok(())
    }

    fn create_plugin_context(&self, plugin_id: &str) -> Result<PluginContext, PluginError> {
        let manifest = self.registry.get_manifest(plugin_id)
            .ok_or_else(|| PluginError::Configuration("Plugin not found".to_string()))?;
        
        Ok(PluginContext {
            app: self.app_context.app.clone(),
            document: self.app_context.document.clone(),
            settings: crate::PluginSettings {
                config: manifest.configuration.clone().unwrap_or(serde_json::Value::Null),
                data_path: std::path::PathBuf::from(format!("./plugins_data/{}", plugin_id)),
            },
            logger: self.app_context.logger.clone(),
        })
    }

    pub fn on_document_created(&mut self, document: &DocumentRef) -> Result<(), PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                plugin.on_document_created(document)?;
            }
        }
        Ok(())
    }

    pub fn on_document_opened(&mut self, document: &DocumentRef) -> Result<(), PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                plugin.on_document_opened(document)?;
            }
        }
        Ok(())
    }

    pub fn on_document_saved(&mut self, document: &DocumentRef) -> Result<(), PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                plugin.on_document_saved(document)?;
            }
        }
        Ok(())
    }

    pub fn on_document_closed(&mut self, document: &DocumentRef) -> Result<(), PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                plugin.on_document_closed(document)?;
            }
        }
        Ok(())
    }

    pub fn on_selection_changed(&mut self, document: &DocumentRef, selection: &Selection) -> Result<(), PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                plugin.on_selection_changed(document, selection)?;
            }
        }
        Ok(())
    }

    pub fn on_ui_event(&mut self, event: &UIEvent) -> Result<(), PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                plugin.on_ui_event(event)?;
            }
        }
        Ok(())
    }

    pub fn on_timer(&mut self, delta_time: f64) -> Result<(), PluginError> {
        let now = std::time::Instant::now();
        let mut to_fire = Vec::new();
        
        for (id, timer) in &self.timers {
            if now.duration_since(timer.last_fire).as_secs_f64() >= timer.interval {
                to_fire.push(id.clone());
            }
        }
        
        for id in to_fire {
            if let Some(timer) = self.timers.get_mut(&id) {
                timer.last_fire = now;
                if let Some(plugin_ref) = self.registry.get_plugin(&timer.plugin_id) {
                    let mut plugin = plugin_ref.write();
                    plugin.on_timer(timer.interval)?;
                }
                
                if !timer.repeating {
                    self.timers.remove(&id);
                }
            }
        }
        
        Ok(())
    }

    pub fn execute_command(&mut self, command_id: &str, args: serde_json::Value) -> Result<Option<serde_json::Value>, PluginError> {
        for plugin_id in self.registry.loaded_plugins() {
            if let Some(plugin_ref) = self.registry.get_plugin(&plugin_id) {
                let mut plugin = plugin_ref.write();
                if let Ok(Some(result)) = plugin.on_command(command_id, &args) {
                    return Ok(Some(result));
                }
            }
        }
        
        if let Some(handler) = self.command_handlers.get(command_id) {
            let result = handler(&args)?;
            return Ok(Some(result));
        }
        
        Ok(None)
    }

    pub fn register_command(&mut self, command_id: String, handler: Box<dyn Fn(&serde_json::Value) -> Result<serde_json::Value, String> + Send + Sync>) {
        self.command_handlers.insert(command_id, handler);
    }

    pub fn unregister_command(&mut self, command_id: &str) {
        self.command_handlers.remove(command_id);
    }

    pub fn add_ui_panel(&mut self, panel: UIPanel) -> Result<(), PluginError> {
        self.ui_panels.insert(panel.id.clone(), panel);
        Ok(())
    }

    pub fn remove_ui_panel(&mut self, panel_id: &str) -> Result<(), PluginError> {
        self.ui_panels.remove(panel_id);
        Ok(())
    }

    pub fn add_toolbar_button(&mut self, button: ToolbarButton) -> Result<(), PluginError> {
        self.toolbar_buttons.insert(button.id.clone(), button);
        Ok(())
    }

    pub fn remove_toolbar_button(&mut self, button_id: &str) -> Result<(), PluginError> {
        self.toolbar_buttons.remove(button_id);
        Ok(())
    }

    pub fn start_timer(&mut self, timer_id: String, plugin_id: String, interval: f64, repeating: bool) {
        self.timers.insert(timer_id.clone(), PluginTimer {
            id: timer_id,
            plugin_id,
            interval,
            last_fire: std::time::Instant::now(),
            repeating,
        });
    }

    pub fn stop_timer(&mut self, timer_id: &str) {
        self.timers.remove(timer_id);
    }

    pub fn get_plugin_manifest(&self, plugin_id: &str) -> Option<&PluginManifest> {
        self.registry.get_manifest(plugin_id)
    }

    pub fn is_plugin_loaded(&self, plugin_id: &str) -> bool {
        self.registry.is_loaded(plugin_id)
    }

    pub fn is_plugin_enabled(&self, plugin_id: &str) -> bool {
        self.registry.is_enabled(plugin_id)
    }

    pub fn enable_plugin(&mut self, plugin_id: &str) -> Result<(), PluginError> {
        self.registry.set_enabled(plugin_id, true)
    }

    pub fn disable_plugin(&mut self, plugin_id: &str) -> Result<(), PluginError> {
        self.registry.set_enabled(plugin_id, false)
    }

    pub fn get_all_plugins(&self) -> Vec<&PluginManifest> {
        self.registry.all_manifests()
    }

    pub fn get_loaded_plugins(&self) -> Vec<String> {
        self.registry.loaded_plugins()
    }

    pub fn get_plugins_by_category(&self, category: PluginCategory) -> Vec<&PluginManifest> {
        self.registry.plugins_by_category(category)
    }

    pub fn get_ui_panels(&self) -> Vec<&UIPanel> {
        self.ui_panels.values().collect()
    }

    pub fn get_toolbar_buttons(&self) -> Vec<&ToolbarButton> {
        self.toolbar_buttons.values().collect()
    }
}

impl Clone for PluginManager {
    fn clone(&self) -> Self {
        Self {
            registry: self.registry.clone(),
            factories: HashMap::new(),
            app_context: self.app_context.clone(),
            command_handlers: HashMap::new(),
            ui_panels: self.ui_panels.clone(),
            toolbar_buttons: self.toolbar_buttons.clone(),
            timers: self.timers.clone(),
        }
    }
}