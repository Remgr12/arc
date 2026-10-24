//! Lua plugin system. Each `.lua` file in a plugin directory is one plugin.
//
//! Plugins register lifecycle hooks with `arc.on(event, fn)` where event is
//! one of `start`, `new`, `open`, `save`, and use the editing API in the
//! `arc` global: `log`, `active_document`, `entities`, `add_entity`,
//! `raycast`, `set_transform`, `undo`, `redo`.
//!
//! Plugins live in their own managed state so editor commands never hold
//! the state lock while plugin code runs.

#[cfg(feature = "lua")]
mod imp {
    use crate::state::{PluginInfo, SharedState};
    use mlua::{Lua, LuaSerdeExt};
    use parking_lot::Mutex;
    use serde_json::Value as Json;
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Arc;
    use tauri::AppHandle;

    pub type HooksMap = HashMap<String, Vec<(String, mlua::Function)>>;

    /// Managed plugin runtime.
    pub struct PluginRuntime {
        pub lua: Lua,
        pub hooks: Arc<Mutex<HooksMap>>,
        pub infos: Vec<PluginInfo>,
        pub dirs: Vec<PathBuf>,
    }

    impl Default for PluginRuntime {
        fn default() -> Self {
            Self {
                lua: Lua::new(),
                hooks: Arc::new(Mutex::new(HashMap::new())),
                infos: vec![],
                dirs: vec![],
            }
        }
    }

    #[derive(Debug)]
    struct LuaApiError(String);
    impl std::fmt::Display for LuaApiError {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            self.0.fmt(f)
        }
    }
    impl std::error::Error for LuaApiError {}

    fn api_err(msg: impl Into<String>) -> mlua::Error {
        mlua::Error::ExternalError(Arc::new(LuaApiError(msg.into())))
    }

    fn triple(v: &[f64]) -> [f64; 3] {
        [
            v.first().copied().unwrap_or(0.0),
            v.get(1).copied().unwrap_or(0.0),
            v.get(2).copied().unwrap_or(0.0),
        ]
    }

    fn active_or_err(state: &SharedState) -> Result<String, mlua::Error> {
        state
            .lock()
            .active
            .clone()
            .ok_or_else(|| api_err("no active document"))
    }

    impl PluginRuntime {
        #[allow(dead_code)]
        pub fn new(dirs: Vec<PathBuf>) -> Self {
            Self {
                dirs,
                ..Default::default()
            }
        }

        pub fn info(&self) -> Vec<PluginInfo> {
            self.infos.clone()
        }

        /// Discover + evaluate all plugin scripts. Only enabled plugins keep
        /// their hooks active.
        pub fn reload(&mut self, state: &SharedState, app: &AppHandle) -> Vec<PluginInfo> {
            self.lua = Lua::new();
            let hooks = Arc::new(Mutex::new(HashMap::new()));
            let mut infos: Vec<PluginInfo> = Vec::new();
            let enabled: std::collections::HashSet<String> = state
                .lock()
                .settings
                .enabled_plugins
                .iter()
                .cloned()
                .collect();

            for (name, path) in self.discover() {
                let mut info = PluginInfo {
                    name: name.clone(),
                    path: path.display().to_string(),
                    enabled: false,
                    ok: false,
                    error: None,
                };
                match std::fs::read_to_string(&path) {
                    Ok(source) => match self.install(state, app, hooks.clone(), &name, &source) {
                        Ok(()) => {
                            info.ok = true;
                            info.enabled = enabled.contains(&name);
                        }
                        Err(e) => info.error = Some(e),
                    },
                    Err(e) => info.error = Some(format!("read failed: {e}")),
                }
                infos.push(info);
            }
            infos.sort_by(|a, b| a.name.cmp(&b.name));
            self.hooks = hooks;
            self.infos = infos.clone();
            infos
        }

        fn discover(&self) -> Vec<(String, PathBuf)> {
            let mut found: Vec<(String, PathBuf)> = Vec::new();
            for dir in &self.dirs {
                let entries = match std::fs::read_dir(dir) {
                    Ok(e) => e,
                    Err(_) => continue,
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().and_then(|e| e.to_str()) != Some("lua") {
                        continue;
                    }
                    let name = path
                        .file_stem()
                        .and_then(|e| e.to_str())
                        .unwrap_or("plugin")
                        .to_string();
                    if found.iter().any(|(n, _)| n == &name) {
                        continue;
                    }
                    found.push((name, path));
                }
            }
            found
        }

        fn install(
            &self,
            state: &SharedState,
            app: &AppHandle,
            hooks: Arc<Mutex<HooksMap>>,
            plugin: &str,
            source: &str,
        ) -> Result<(), String> {
            let lua = &self.lua;
            let api = self.build_arc_api(lua, state, app, hooks.clone(), plugin);
            lua.globals().set("arc", api).map_err(|e| e.to_string())?;
            lua.load(source).call::<()>(()).map_err(|e| e.to_string())?;
            Ok(())
        }

        fn build_arc_api(
            &self,
            lua: &Lua,
            state: &SharedState,
            app: &AppHandle,
            hooks: Arc<Mutex<HooksMap>>,
            plugin: &str,
        ) -> mlua::Table {
            let table = lua.create_table().expect("table");
            let ctx_state = state.clone();
            let ctx_app = app.clone();

            // arc.on(event, function)
            {
                let hm = hooks.clone();
                let plugin_name = plugin.to_string();
                let on = lua
                    .create_function(move |_lua, (event, func): (String, mlua::Function)| {
                        if !["start", "new", "open", "save"].contains(&event.as_str()) {
                            return Err(api_err(format!("unknown hook '{event}'")));
                        }
                        hm.lock()
                            .entry(event.clone())
                            .or_default()
                            .push((plugin_name.clone(), func.clone()));
                        Ok(())
                    })
                    .unwrap();
                table.set("on", on).unwrap();
            }

            // arc.log(msg)
            let log = lua
                .create_function(move |_lua, msg: mlua::LuaString| {
                    tracing::info!(target: "plugin", "{}", msg.to_str()?);
                    Ok(())
                })
                .unwrap();
            table.set("log", log).unwrap();

            // arc.active_document() -> id or nil
            {
                let st = ctx_state.clone();
                let f = lua
                    .create_function(move |_lua, ()| Ok(st.lock().active.clone()))
                    .unwrap();
                table.set("active_document", f).unwrap();
            }

            // arc.entities() -> { {id,name,kind,position,visible}, ... }
            {
                let context = ctx_state.clone();
                let f = lua
                    .create_function(move |lua, ()| {
                        let doc_id = active_or_err(&context)?;
                        let list: Vec<Json> = {
                            let st = context.lock();
                            let doc = st
                                .documents
                                .get(&doc_id)
                                .ok_or_else(|| api_err("no document"))?;
                            doc.entities
                                .values()
                                .map(|e| {
                                    serde_json::json!({
                                        "id": e.id.as_string(),
                                        "name": e.name,
                                        "kind": e.kind.type_name().to_lowercase(),
                                        "position": e.transform.position,
                                        "visible": e.visible,
                                    })
                                })
                                .collect()
                        };
                        Ok(lua.to_value(&list).unwrap_or(mlua::Value::Nil))
                    })
                    .unwrap();
                table.set("entities", f).unwrap();
            }

            // arc.add_entity(geometry, name?) -> id
            {
                let context = ctx_state.clone();
                let context_app = ctx_app.clone();
                let f = lua
                    .create_function(
                        move |lua, (geometry, name): (mlua::Value, Option<String>)| {
                            let payload: Json = if let Ok(sql) =
                                lua.from_value::<String>(geometry.clone())
                            {
                                serde_json::from_str(&sql).map_err(|e| api_err(e.to_string()))?
                            } else {
                                lua.from_value(geometry)
                                    .map_err(|e| api_err(e.to_string()))?
                            };
                            let doc_id = active_or_err(&context)?;
                            let id = crate::commands::helpers_add_entity(
                                &context_app,
                                &context,
                                &doc_id,
                                &payload,
                                name.as_deref(),
                            )
                            .map_err(api_err)?;
                            Ok(id)
                        },
                    )
                    .unwrap();
                table.set("add_entity", f).unwrap();
            }

            // arc.raycast(ox,oy,oz,dx,dy,dz[, tolerance]) -> hit or nil
            {
                let context = ctx_state.clone();
                let f = lua
                    .create_function(move |lua, (o, d, tol): (Vec<f64>, Vec<f64>, Option<f64>)| {
                        let doc_id = active_or_err(&context)?;
                        let st = context.lock();
                        let doc = st
                            .documents
                            .get(&doc_id)
                            .ok_or_else(|| api_err("no document"))?;
                        let hit = doc.raycast(triple(&o), triple(&d), tol.unwrap_or(1.0));
                        Ok(hit.map(|h| {
                            lua.to_value(&serde_json::json!({
                                "entity_id": h.entity_id.as_string(),
                                "point": h.point,
                                "normal": h.normal,
                                "distance": h.distance,
                            }))
                            .unwrap_or(mlua::Value::Nil)
                        }))
                    })
                    .unwrap();
                table.set("raycast", f).unwrap();
            }

            // arc.set_transform(id, transform)
            {
                let context = ctx_state.clone();
                let context_app = ctx_app.clone();
                let f = lua
                    .create_function(move |lua, (id, transform): (String, mlua::Value)| {
                        let payload: Json = lua
                            .from_value(transform)
                            .map_err(|e| api_err(e.to_string()))?;
                        let doc_id = active_or_err(&context)?;
                        crate::commands::helpers_set_transform(
                            &context_app,
                            &context,
                            &doc_id,
                            &payload,
                            &[&id],
                            true,
                        )
                        .map_err(api_err)?;
                        Ok(())
                    })
                    .unwrap();
                table.set("set_transform", f).unwrap();
            }

            // arc.undo() / arc.redo() -> undo label or nil
            for (name, do_undo) in [("undo", true), ("redo", false)] {
                let context = ctx_state.clone();
                let context_app = ctx_app.clone();
                let f = lua
                    .create_function(move |_lua, ()| {
                        let doc_id = active_or_err(&context)?;
                        let label = {
                            let mut st = context.lock();
                            let doc = st
                                .documents
                                .get_mut(&doc_id)
                                .ok_or_else(|| api_err("no document"))?;
                            if do_undo { doc.undo() } else { doc.redo() }
                        };
                        crate::commands::emit_scene(&context_app, &context, &doc_id);
                        Ok(label)
                    })
                    .unwrap();
                table.set(name, f).unwrap();
            }

            table
        }

        /// Call every hook registered for `hook`. Only enabled plugins fire.
        pub fn fire(&self, state: &SharedState, hook: &str, arg: &Json) {
            let enabled: std::collections::HashSet<String> = state
                .lock()
                .settings
                .enabled_plugins
                .iter()
                .cloned()
                .collect();
            let funcs: Vec<mlua::Function> = self
                .hooks
                .lock()
                .get(hook)
                .map(|v| {
                    v.iter()
                        .filter(|(plugin, _)| enabled.contains(plugin))
                        .map(|(_, f)| f.clone())
                        .collect()
                })
                .unwrap_or_default();
            for func in funcs {
                let value = self.lua.to_value(arg).unwrap_or(mlua::Value::Nil);
                let _ = func.call::<()>(value);
            }
        }
    }
}

#[cfg(feature = "lua")]
pub use imp::PluginRuntime;

#[cfg(not(feature = "lua"))]
pub struct PluginRuntime;

#[cfg(not(feature = "lua"))]
impl PluginRuntime {
    pub fn info(&self) -> Vec<PluginInfo> {
        vec![]
    }
}

/// Managed wrapper: Tauri-managed handle for the plugin runtime.
pub type PluginLock = parking_lot::Mutex<PluginRuntime>;
