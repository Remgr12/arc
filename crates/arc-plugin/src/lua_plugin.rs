use crate::{Plugin, PluginManifest, PluginError, PluginContext, PluginRef};
use std::sync::Arc;
use parking_lot::RwLock;
use mlua::{Lua, Table, Value, Function, FromLua, IntoLua};

pub struct LuaPlugin {
    manifest: PluginManifest,
    lua: Lua,
    init_fn: Option<Function>,
    shutdown_fn: Option<Function>,
    on_load_fn: Option<Function>,
    on_unload_fn: Option<Function>,
    on_doc_created_fn: Option<Function>,
    on_doc_opened_fn: Option<Function>,
    on_doc_saved_fn: Option<Function>,
    on_doc_closed_fn: Option<Function>,
    on_selection_changed_fn: Option<Function>,
    on_command_fn: Option<Function>,
    on_ui_event_fn: Option<Function>,
    on_timer_fn: Option<Function>,
}

impl LuaPlugin {
    pub fn new(manifest: PluginManifest, script: &str) -> Result<Self, PluginError> {
        let lua = Lua::new();
        
        lua.globals().set("plugin", manifest.clone())?;
        lua.globals().set("print", lua.create_function(|_, msg: String| {
            println!("[Lua Plugin] {}", msg);
            Ok(())
        })?)?;
        
        lua.load(script).exec()?;
        
        let globals = lua.globals();
        
        let init_fn = globals.get::<_, Function>("initialize").ok();
        let shutdown_fn = globals.get::<_, Function>("shutdown").ok();
        let on_load_fn = globals.get::<_, Function>("on_load").ok();
        let on_unload_fn = globals.get::<_, Function>("on_unload").ok();
        let on_doc_created_fn = globals.get::<_, Function>("on_document_created").ok();
        let on_doc_opened_fn = globals.get::<_, Function>("on_document_opened").ok();
        let on_doc_saved_fn = globals.get::<_, Function>("on_document_saved").ok();
        let on_doc_closed_fn = globals.get::<_, Function>("on_document_closed").ok();
        let on_selection_changed_fn = globals.get::<_, Function>("on_selection_changed").ok();
        let on_command_fn = globals.get::<_, Function>("on_command").ok();
        let on_ui_event_fn = globals.get::<_, Function>("on_ui_event").ok();
        let on_timer_fn = globals.get::<_, Function>("on_timer").ok();
        
        Ok(Self {
            manifest,
            lua,
            init_fn,
            shutdown_fn,
            on_load_fn,
            on_unload_fn,
            on_doc_created_fn,
            on_doc_opened_fn,
            on_doc_saved_fn,
            on_doc_closed_fn,
            on_selection_changed_fn,
            on_command_fn,
            on_ui_event_fn,
            on_timer_fn,
        })
    }

    pub fn from_file(manifest: PluginManifest, path: &std::path::Path) -> Result<Self, PluginError> {
        let script = std::fs::read_to_string(path)?;
        Self::new(manifest, &script)
    }
}

impl Plugin for LuaPlugin {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn initialize(&mut self, context: &PluginContext) -> Result<(), PluginError> {
        if let Some(fn_) = &self.init_fn {
            let ctx_table = self.create_context_table(context)?;
            fn_.call(ctx_table)?;
        }
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        if let Some(fn_) = &self.shutdown_fn {
            fn_.call(())?;
        }
        Ok(())
    }

    fn on_load(&mut self) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_load_fn {
            fn_.call(())?;
        }
        Ok(())
    }

    fn on_unload(&mut self) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_unload_fn {
            fn_.call(())?;
        }
        Ok(())
    }

    fn on_document_created(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_doc_created_fn {
            let doc_table = self.create_document_table(document)?;
            fn_.call(doc_table)?;
        }
        Ok(())
    }

    fn on_document_opened(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_doc_opened_fn {
            let doc_table = self.create_document_table(document)?;
            fn_.call(doc_table)?;
        }
        Ok(())
    }

    fn on_document_saved(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_doc_saved_fn {
            let doc_table = self.create_document_table(document)?;
            fn_.call(doc_table)?;
        }
        Ok(())
    }

    fn on_document_closed(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_doc_closed_fn {
            let doc_table = self.create_document_table(document)?;
            fn_.call(doc_table)?;
        }
        Ok(())
    }

    fn on_selection_changed(&mut self, document: &crate::DocumentRef, selection: &crate::Selection) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_selection_changed_fn {
            let doc_table = self.create_document_table(document)?;
            let sel_table = self.create_selection_table(selection)?;
            fn_.call((doc_table, sel_table))?;
        }
        Ok(())
    }

    fn on_command(&mut self, command_id: &str, args: &serde_json::Value) -> Result<Option<serde_json::Value>, PluginError> {
        if let Some(fn_) = &self.on_command_fn {
            let args_table = self.json_to_lua(args)?;
            let result = fn_.call((command_id, args_table))?;
            Ok(self.lua_to_json(result)?)
        } else {
            Ok(None)
        }
    }

    fn on_ui_event(&mut self, event: &crate::UIEvent) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_ui_event_fn {
            let event_table = self.create_ui_event_table(event)?;
            fn_.call(event_table)?;
        }
        Ok(())
    }

    fn on_timer(&mut self, interval: f64) -> Result<(), PluginError> {
        if let Some(fn_) = &self.on_timer_fn {
            fn_.call(interval)?;
        }
        Ok(())
    }
}

impl LuaPlugin {
    fn create_context_table(&self, context: &PluginContext) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("app", self.create_app_table())?;
        table.set("settings", self.create_settings_table(&context.settings)?)?;
        table.set("logger", self.create_logger_table(&context.logger)?)?;
        
        Ok(table)
    }

    fn create_app_table(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("documents", self.create_documents_api()?)?;
        table.set("geometry", self.create_geometry_api()?)?;
        table.set("modeling", self.create_modeling_api()?)?;
        table.set("architecture", self.create_architecture_api()?)?;
        table.set("ui", self.create_ui_api()?)?;
        table.set("commands", self.create_commands_api()?)?;
        table.set("settings", self.create_settings_api()?)?;
        table.set("files", self.create_files_api()?)?;
        
        Ok(table)
    }

    fn create_documents_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("create", self.lua.create_function(|_, name: String| {
            Ok(format!("Document: {}", name))
        })?)?;
        
        table.set("active", self.lua.create_function(|_, ()| {
            Ok("Active Document")
        })?)?;
        
        Ok(table)
    }

    fn create_geometry_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("point", self.lua.create_function(|_, (x, y, z): (f64, f64, f64)| {
            Ok(format!("Point({},{},{})", x, y, z))
        })?)?;
        
        table.set("line", self.lua.create_function(|_, (x1, y1, z1, x2, y2, z2): (f64, f64, f64, f64, f64, f64)| {
            Ok(format!("Line({},{},{},{},{},{})", x1, y1, z1, x2, y2, z2))
        })?)?;
        
        table.set("circle", self.lua.create_function(|_, (x, y, z, nx, ny, nz, r): (f64, f64, f64, f64, f64, f64, f64)| {
            Ok(format!("Circle({},{},{},{},{},{},{})", x, y, z, nx, ny, nz, r))
        })?)?;
        
        Ok(table)
    }

    fn create_modeling_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("extrude", self.lua.create_function(|_, (profile, distance): (String, f64)| {
            Ok(format!("Extrude({}, {})", profile, distance))
        })?)?;
        
        Ok(table)
    }

    fn create_architecture_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("wall", self.lua.create_function(|_, (name, width, height): (String, f64, f64)| {
            Ok(format!("Wall({}, {}, {})", name, width, height))
        })?)?;
        
        table.set("door", self.lua.create_function(|_, (name, width, height): (String, f64, f64)| {
            Ok(format!("Door({}, {}, {})", name, width, height))
        })?)?;
        
        table.set("window", self.lua.create_function(|_, (name, width, height): (String, f64, f64)| {
            Ok(format!("Window({}, {}, {})", name, width, height))
        })?)?;
        
        Ok(table)
    }

    fn create_ui_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("addPanel", self.lua.create_function(|_, (id, title, html): (String, String, String)| {
            println!("Adding panel: {} - {}", id, title);
            Ok(())
        })?)?;
        
        table.set("showMessage", self.lua.create_function(|_, (msg, typ): (String, String)| {
            println!("Message [{}]: {}", typ, msg);
            Ok(())
        })?)?;
        
        Ok(table)
    }

    fn create_commands_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("register", self.lua.create_function(|_, (id, name, _callback): (String, String, mlua::Function)| {
            println!("Registering command: {} - {}", id, name);
            Ok(())
        })?)?;
        
        table.set("execute", self.lua.create_function(|_, (id, args): (String, String)| {
            Ok(format!("Executed: {} with {}", id, args))
        })?)?;
        
        Ok(table)
    }

    fn create_settings_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("get", self.lua.create_function(|_, key: String| {
            Ok(serde_json::Value::Null)
        })?)?;
        
        table.set("set", self.lua.create_function(|_, (key, value): (String, String)| {
            println!("Setting {} = {}", key, value);
            Ok(())
        })?)?;
        
        Ok(table)
    }

    fn create_files_api(&self) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("read", self.lua.create_function(|_, path: String| {
            std::fs::read_to_string(path).map_err(|e| mlua::Error::RuntimeError(e.to_string()))
        })?)?;
        
        table.set("write", self.lua.create_function(|_, (path, content): (String, String)| {
            std::fs::write(path, content).map_err(|e| mlua::Error::RuntimeError(e.to_string()))
        })?)?;
        
        Ok(table)
    }

    fn create_settings_table(&self, settings: &crate::PluginSettings) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        table.set("config", self.json_to_lua(&settings.config)?)?;
        Ok(table)
    }

    fn create_logger_table(&self, logger: &crate::PluginLogger) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("log", self.lua.create_function(|_, (level, msg): (String, String)| {
            println!("[{}] {}", level, msg);
            Ok(())
        })?)?;
        
        Ok(table)
    }

    fn create_document_table(&self, document: &crate::DocumentRef) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        let doc = document.read();
        table.set("id", doc.id.0.to_string())?;
        table.set("name", doc.name.clone())?;
        table.set("modified", doc.modified)?;
        table.set("version", doc.version)?;
        
        Ok(table)
    }

    fn create_selection_table(&self, selection: &crate::Selection) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("count", selection.count())?;
        table.set("primary", selection.primary().map(|id| id.0.to_string()).unwrap_or_default())?;
        
        let ids: Vec<String> = selection.selected_ids.iter().map(|id| id.0.to_string()).collect();
        table.set("ids", ids)?;
        
        Ok(table)
    }

    fn create_ui_event_table(&self, event: &crate::UIEvent) -> Result<Table, PluginError> {
        let table = self.lua.create_table()?;
        
        table.set("type", format!("{:?}", event.event_type))?;
        table.set("componentId", event.component_id.clone())?;
        table.set("data", self.json_to_lua(&event.data)?)?;
        
        Ok(table)
    }

    fn json_to_lua(&self, value: &serde_json::Value) -> Result<Value, PluginError> {
        match value {
            serde_json::Value::Null => Ok(Value::Nil),
            serde_json::Value::Bool(b) => Ok(Value::Boolean(*b)),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    Ok(Value::Integer(i))
                } else if let Some(f) = n.as_f64() {
                    Ok(Value::Number(f))
                } else {
                    Ok(Value::Nil)
                }
            }
            serde_json::Value::String(s) => Ok(Value::String(self.lua.create_string(s)?)),
            serde_json::Value::Array(arr) => {
                let table = self.lua.create_table()?;
                for (i, v) in arr.iter().enumerate() {
                    table.set(i + 1, self.json_to_lua(v)?)?;
                }
                Ok(Value::Table(table))
            }
            serde_json::Value::Object(obj) => {
                let table = self.lua.create_table()?;
                for (k, v) in obj {
                    table.set(k, self.json_to_lua(v)?)?;
                }
                Ok(Value::Table(table))
            }
        }
    }

    fn lua_to_json(&self, value: Value) -> Result<Option<serde_json::Value>, PluginError> {
        match value {
            Value::Nil => Ok(None),
            Value::Boolean(b) => Ok(Some(serde_json::Value::Bool(b))),
            Value::Integer(i) => Ok(Some(serde_json::Value::Number(i.into()))),
            Value::Number(f) => Ok(Some(serde_json::Value::Number(serde_json::Number::from_f64(f).unwrap()))),
            Value::String(s) => Ok(Some(serde_json::Value::String(s.to_str()?.to_string()))),
            Value::Table(t) => {
                let is_array = t.len() > 0 && t.raw_get(1).is_ok();
                if is_array {
                    let mut arr = Vec::new();
                    for i in 1..=t.len() {
                        arr.push(self.lua_to_json(t.raw_get(i)?)?.unwrap_or(serde_json::Value::Null));
                    }
                    Ok(Some(serde_json::Value::Array(arr)))
                } else {
                    let mut obj = serde_json::Map::new();
                    for pair in t.pairs::<String, Value>() {
                        let (k, v) = pair?;
                        obj.insert(k, self.lua_to_json(v)?.unwrap_or(serde_json::Value::Null));
                    }
                    Ok(Some(serde_json::Value::Object(obj)))
                }
            }
            _ => Ok(None),
        }
    }
}

pub struct LuaPluginFactory;

impl crate::PluginFactory for LuaPluginFactory {
    fn create_plugin(&self, manifest: &PluginManifest) -> Result<PluginRef, PluginError> {
        let script = manifest.configuration.as_ref()
            .and_then(|c| c.get("script"))
            .and_then(|s| s.as_str())
            .unwrap_or("");
        
        let plugin = LuaPlugin::new(manifest.clone(), script)?;
        Ok(Arc::new(RwLock::new(plugin)))
    }

    fn supported_types(&self) -> Vec<String> {
        vec!["lua".to_string()]
    }
}