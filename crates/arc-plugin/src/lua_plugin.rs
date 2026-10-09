use crate::{Plugin, PluginManifest, PluginError, PluginContext, DocumentRef, Selection, UIEvent};
use arc_geometry::{Point3, Vector3};
use std::sync::Arc;
use parking_lot::RwLock;
use mlua::{Lua, Table, Value, Function, FromLua, IntoLua, LuaSerdeExt};
use std::thread;
use std::sync::mpsc;
use serde_json;

mod oneshot {
    use std::sync::mpsc;
    use std::sync::Arc;
    use std::sync::Mutex;

    pub struct Sender<T> {
        tx: mpsc::Sender<T>,
    }

    pub struct Receiver<T> {
        rx: Arc<Mutex<mpsc::Receiver<T>>>,
    }

    pub fn channel<T>() -> (Sender<T>, Receiver<T>) {
        let (tx, rx) = mpsc::channel();
        (Sender { tx }, Receiver { rx: Arc::new(Mutex::new(rx)) })
    }

    impl<T> Sender<T> {
        pub fn send(self, value: T) -> Result<(), T> {
            self.tx.send(value).map_err(|e| e.0)
        }
    }

    impl<T> Clone for Sender<T> {
        fn clone(&self) -> Self {
            Self { tx: self.tx.clone() }
        }
    }

    impl<T> Receiver<T> {
        pub fn recv(&self) -> Result<T, mpsc::RecvError> {
            self.rx.lock().unwrap().recv()
        }
    }
}

enum LuaPluginMessage {
    Initialize(PluginContext, oneshot::Sender<Result<(), PluginError>>),
    Shutdown(oneshot::Sender<Result<(), PluginError>>),
    OnLoad(oneshot::Sender<Result<(), PluginError>>),
    OnUnload(oneshot::Sender<Result<(), PluginError>>),
    OnDocumentCreated(DocumentRef, oneshot::Sender<Result<(), PluginError>>),
    OnDocumentOpened(DocumentRef, oneshot::Sender<Result<(), PluginError>>),
    OnDocumentSaved(DocumentRef, oneshot::Sender<Result<(), PluginError>>),
    OnDocumentClosed(DocumentRef, oneshot::Sender<Result<(), PluginError>>),
    OnSelectionChanged(DocumentRef, Selection, oneshot::Sender<Result<(), PluginError>>),
    OnCommand(String, serde_json::Value, oneshot::Sender<Result<Option<serde_json::Value>, PluginError>>),
    OnUIEvent(UIEvent, oneshot::Sender<Result<(), PluginError>>),
    OnTimer(f64, oneshot::Sender<Result<(), PluginError>>),
    GetManifest(oneshot::Sender<PluginManifest>),
}

#[derive(Debug)]
pub struct LuaPlugin {
    manifest: PluginManifest,
    lua_script: String,
    sender: mpsc::Sender<LuaPluginMessage>,
    _thread_handle: Option<thread::JoinHandle<()>>,
}

impl LuaPlugin {
    pub fn new(manifest: PluginManifest, script: &str) -> Result<Self, PluginError> {
        let lua_script = script.to_string();
        let (tx, rx) = mpsc::channel();

        let manifest_clone = manifest.clone();
        let script_clone = lua_script.clone();

        let thread_handle = thread::spawn(move || {
            let lua = Lua::new();

            // Set up print function using a simple closure that doesn't capture Lua
            let print_fn = lua.create_function(|_, msg: String| {
                println!("[Lua Plugin] {}", msg);
                Ok(())
            }).ok();
            if let Some(f) = print_fn {
                lua.globals().set("print", f).ok();
            }

            lua.load(&script_clone).exec().ok();

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

            while let Ok(msg) = rx.recv() {
                match msg {
                    LuaPluginMessage::Initialize(ctx, resp) => {
                        let result = if let Some(f) = &init_fn {
                            let ctx_table = create_context_table(&lua, &ctx);
                            f.call::<Table, ()>(ctx_table).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::Shutdown(resp) => {
                        let result = if let Some(f) = &shutdown_fn {
                            f.call::<(), ()>(()).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnLoad(resp) => {
                        let result = if let Some(f) = &on_load_fn {
                            f.call::<(), ()>(()).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnUnload(resp) => {
                        let result = if let Some(f) = &on_unload_fn {
                            f.call::<(), ()>(()).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnDocumentCreated(doc, resp) => {
                        let result = if let Some(f) = &on_doc_created_fn {
                            let doc_table = doc_to_table(&lua, &doc);
                            f.call::<Table, ()>(doc_table).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnDocumentOpened(doc, resp) => {
                        let result = if let Some(f) = &on_doc_opened_fn {
                            let doc_table = doc_to_table(&lua, &doc);
                            f.call::<Table, ()>(doc_table).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnDocumentSaved(doc, resp) => {
                        let result = if let Some(f) = &on_doc_saved_fn {
                            let doc_table = doc_to_table(&lua, &doc);
                            f.call::<Table, ()>(doc_table).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnDocumentClosed(_doc, resp) => {
                        let result = if let Some(f) = &on_doc_closed_fn {
                            f.call::<(), ()>(()).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnSelectionChanged(doc, sel, resp) => {
                        let result = if let Some(f) = &on_selection_changed_fn {
                            let doc_table = doc_to_table(&lua, &doc);
                            let sel_table = selection_to_table(&lua, &sel);
                            f.call::<(Table, Table), ()>((doc_table, sel_table)).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnCommand(cmd_id, args, resp) => {
                        let result = if let Some(f) = &on_command_fn {
                            let args_table = lua.create_table().ok();
                            if let Some(t) = &args_table {
                                if let serde_json::Value::Object(map) = &args {
                                    for (k, v) in map {
                                        let _ = t.set(k.as_str(), lua.to_value(v).ok());
                                    }
                                }
                            }
                            let lua_result: Result<Value, _> = f.call((cmd_id, args_table));
                            lua_result.map(|v| {
                                // Convert mlua::Value to serde_json::Value
                                serde_json::to_value(v).ok()
                            }).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(None) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnUIEvent(event, resp) => {
                        let result = if let Some(f) = &on_ui_event_fn {
                            let event_table = ui_event_to_table(&lua, &event);
                            f.call::<Table, ()>(event_table).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::OnTimer(delta, resp) => {
                        let result = if let Some(f) = &on_timer_fn {
                            f.call::<f64, ()>(delta).map_err(|e| PluginError::Internal(e.to_string()))
                        } else { Ok(()) };
                        resp.send(result).ok();
                    }
                    LuaPluginMessage::GetManifest(resp) => {
                        resp.send(manifest_clone.clone()).ok();
                    }
                }
            }
        });

        Ok(Self {
            manifest,
            lua_script,
            sender: tx,
            _thread_handle: Some(thread_handle),
        })
    }

    pub fn from_file(manifest: PluginManifest, path: &std::path::Path) -> Result<Self, PluginError> {
        let script = std::fs::read_to_string(path)?;
        Self::new(manifest, &script)
    }

    fn send<F, R>(&self, msg_fn: F) -> Result<R, PluginError>
    where
        F: FnOnce(oneshot::Sender<Result<R, PluginError>>) -> LuaPluginMessage,
        R: Send + 'static,
    {
        let (resp_tx, resp_rx) = oneshot::channel();
        self.sender.send(msg_fn(resp_tx)).map_err(|_| PluginError::Internal("Lua thread died".to_string()))?;
        resp_rx.recv().map_err(|_| PluginError::Internal("Lua thread response failed".to_string()))?
    }
}

impl Plugin for LuaPlugin {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn initialize(&mut self, context: &PluginContext) -> Result<(), PluginError> {
        let ctx = PluginContext {
            app: context.app.clone(),
            document: context.document.clone(),
            selection: context.selection.clone(),
            settings: crate::PluginSettings {
                config: context.settings.config.clone(),
                data_path: context.settings.data_path.clone(),
            },
            logger: crate::PluginLogger {
                log: Arc::new(|level, msg| {
                    let level_str = match level {
                        crate::LogLevel::Trace => "TRACE",
                        crate::LogLevel::Debug => "DEBUG",
                        crate::LogLevel::Info => "INFO",
                        crate::LogLevel::Warn => "WARN",
                        crate::LogLevel::Error => "ERROR",
                    };
                    println!("[Lua Plugin] [{}] {}", level_str, msg);
                }),
            },
        };
        self.send(|resp| LuaPluginMessage::Initialize(ctx, resp))
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::Shutdown(resp))
    }

    fn on_load(&mut self) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnLoad(resp))
    }

    fn on_unload(&mut self) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnUnload(resp))
    }

    fn on_document_created(&mut self, doc: &DocumentRef) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnDocumentCreated(doc.clone(), resp))
    }

    fn on_document_opened(&mut self, doc: &DocumentRef) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnDocumentOpened(doc.clone(), resp))
    }

    fn on_document_saved(&mut self, doc: &DocumentRef) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnDocumentSaved(doc.clone(), resp))
    }

    fn on_document_closed(&mut self, doc: &DocumentRef) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnDocumentClosed(doc.clone(), resp))
    }

    fn on_selection_changed(&mut self, document: &DocumentRef, selection: &Selection) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnSelectionChanged(document.clone(), selection.clone(), resp))
    }

    fn on_command(&mut self, command_id: &str, args: &serde_json::Value) -> Result<Option<serde_json::Value>, PluginError> {
        self.send(|resp| LuaPluginMessage::OnCommand(command_id.to_string(), args.clone(), resp))
    }

    fn on_ui_event(&mut self, event: &UIEvent) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnUIEvent(event.clone(), resp))
    }

    fn on_timer(&mut self, delta_time: f64) -> Result<(), PluginError> {
        self.send(|resp| LuaPluginMessage::OnTimer(delta_time, resp))
    }
}

fn create_context_table<'lua>(lua: &'lua Lua, context: &PluginContext) -> Table<'lua> {
    let table = lua.create_table().unwrap();
    if let Some(doc) = &context.document {
        table.set("document", doc_to_table(lua, doc)).ok();
    }
    table.set("selection", selection_to_table(lua, &context.selection)).ok();
    table
}

fn doc_to_table<'lua>(lua: &'lua Lua, doc: &DocumentRef) -> Table<'lua> {
    let table = lua.create_table().unwrap();
    let doc_guard = doc.read();
    table.set("id", doc_guard.id.0.to_string()).ok();
    table.set("name", doc_guard.name.clone()).ok();
    table
}

fn selection_to_table<'lua>(lua: &'lua Lua, selection: &Selection) -> Table<'lua> {
    let table = lua.create_table().unwrap();
    table.set("count", selection.count()).ok();
    table
}

fn ui_event_to_table<'lua>(lua: &'lua Lua, event: &UIEvent) -> Table<'lua> {
    let table = lua.create_table().unwrap();
    table.set("type", format!("{:?}", event.event_type)).ok();
    table.set("component_id", event.component_id.clone()).ok();
    table.set("data", serde_json::to_string(&event.data).unwrap_or_default()).ok();
    table
}

struct NoopCommandHandler;

#[async_trait::async_trait]
impl arc_commands::CommandHandler for NoopCommandHandler {
    async fn execute(&self, _args: serde_json::Value) -> Result<serde_json::Value, arc_commands::CommandError> {
        Ok(serde_json::Value::Null)
    }

    fn can_execute(&self, _args: &serde_json::Value) -> bool {
        true
    }

    fn name(&self) -> &str {
        "noop"
    }
}