use std::sync::Arc;
use parking_lot::RwLock;
use serde::{Serialize, Deserialize};

pub struct PluginSystem {
    loaded: Vec<PluginInfo>,
    available: Vec<PluginInfo>,
    search_paths: Vec<std::path::PathBuf>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub author: String,
    pub entry: String,
    pub enabled: bool,
    pub loaded: bool,
}

impl PluginSystem {
    pub fn new() -> Self {
        Self {
            loaded: Vec::new(),
            available: Vec::new(),
            search_paths: vec![
                "plugins".into(),
                "./plugins".into(),
            ],
        }
    }

    pub fn discover(&mut self) -> Result<Vec<PluginInfo>, String> {
        let mut discovered = Vec::new();
        
        for path in &self.search_paths {
            if path.exists() {
                if let Ok(entries) = std::fs::read_dir(path) {
                    for entry in entries.flatten() {
                        let entry_path = entry.path();
                        if entry_path.extension().map_or(false, |ext| ext == "json") {
                            if let Ok(content) = std::fs::read_to_string(&entry_path) {
                                if let Ok(info) = serde_json::from_str::<PluginInfo>(&content) {
                                    discovered.push(info);
                                }
                            }
                        }
                    }
                }
            }
        }
        
        self.available = discovered.clone();
        Ok(discovered)
    }

    pub fn load(&mut self, id: &str) -> Result<(), String> {
        let plugin = self.available.iter().find(|p| p.id == id)
            .ok_or_else(|| format!("Plugin not found: {}", id))?;
        
        let mut info = plugin.clone();
        info.loaded = true;
        self.loaded.push(info);
        
        Ok(())
    }

    pub fn unload(&mut self, id: &str) -> Result<(), String> {
        self.loaded.retain(|p| p.id != id);
        Ok(())
    }

    pub fn enable(&mut self, id: &str) -> Result<(), String> {
        for plugin in &mut self.available {
            if plugin.id == id {
                plugin.enabled = true;
            }
        }
        for plugin in &mut self.loaded {
            if plugin.id == id {
                plugin.enabled = true;
            }
        }
        Ok(())
    }

    pub fn disable(&mut self, id: &str) -> Result<(), String> {
        for plugin in &mut self.available {
            if plugin.id == id {
                plugin.enabled = false;
            }
        }
        for plugin in &mut self.loaded {
            if plugin.id == id {
                plugin.enabled = false;
            }
        }
        Ok(())
    }

    pub fn is_loaded(&self, id: &str) -> bool {
        self.loaded.iter().any(|p| p.id == id)
    }

    pub fn loaded_plugins(&self) -> &[PluginInfo] {
        &self.loaded
    }

    pub fn available_plugins(&self) -> &[PluginInfo] {
        &self.available
    }

    pub fn add_search_path(&mut self, path: std::path::PathBuf) {
        if !self.search_paths.contains(&path) {
            self.search_paths.push(path);
        }
    }
}

impl Default for PluginSystem {
    fn default() -> Self {
        Self::new()
    }
}