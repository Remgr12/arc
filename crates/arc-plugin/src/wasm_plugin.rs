use crate::{Plugin, PluginManifest, PluginError, PluginContext, PluginRef};
use std::sync::Arc;
use parking_lot::RwLock;
use wasmtime::{Engine, Module, Store, Instance, Linker, Func, Val, ValType, ExternType};
use std::path::Path;

#[cfg(feature = "wasm")]
pub struct WasmPlugin {
    manifest: PluginManifest,
    engine: Engine,
    module: Module,
    store: Store<WasmPluginState>,
    instance: Instance,
    memory: Option<wasmtime::Memory>,
}

#[cfg(feature = "wasm")]
#[derive(Default)]
pub struct WasmPluginState {
    pub context_data: Vec<u8>,
    pub call_depth: u32,
}

#[cfg(feature = "wasm")]
impl WasmPlugin {
    pub fn new(manifest: PluginManifest, wasm_path: &Path) -> Result<Self, PluginError> {
        let engine = Engine::default();
        let module = Module::from_file(&engine, wasm_path)
            .map_err(|e| PluginError::Runtime(format!("Failed to load WASM module: {}", e)))?;
        
        let mut linker = Linker::new(&engine);
        Self::add_host_functions(&mut linker)?;
        
        let mut store = Store::new(&engine, WasmPluginState::default());
        let instance = linker.instantiate(&mut store, &module)
            .map_err(|e| PluginError::Runtime(format!("Failed to instantiate WASM module: {}", e)))?;
        
        let memory = instance.get_memory(&mut store, "memory").cloned();
        
        Ok(Self {
            manifest,
            engine,
            module,
            store,
            instance,
            memory,
        })
    }

    fn add_host_functions(linker: &mut Linker<WasmPluginState>) -> Result<(), PluginError> {
        linker.func_wrap("env", "log", |mut caller: wasmtime::Caller<'_, WasmPluginState>, level: i32, ptr: i32, len: i32| {
            if let Some(memory) = caller.get_export("memory").and_then(|e| e.into_memory()) {
                let data = memory.data(&caller);
                let slice = &data[ptr as usize..(ptr + len) as usize];
                if let Ok(msg) = std::str::from_utf8(slice) {
                    let level_str = match level {
                        0 => "TRACE",
                        1 => "DEBUG",
                        2 => "INFO",
                        3 => "WARN",
                        4 => "ERROR",
                        _ => "UNKNOWN",
                    };
                    println!("[WASM Plugin {}] {}", level_str, msg);
                }
            }
        })?;

        linker.func_wrap("env", "allocate", |mut caller: wasmtime::Caller<'_, WasmPluginState>, size: i32| -> i32 {
            0
        })?;

        linker.func_wrap("env", "deallocate", |_caller: wasmtime::Caller<'_, WasmPluginState>, _ptr: i32, _size: i32| {
        })?;

        Ok(())
    }

    fn call_wasm_func(&mut self, name: &str, args: &[Val]) -> Result<Vec<Val>, PluginError> {
        let func = self.instance.get_func(&mut self.store, name)
            .ok_or_else(|| PluginError::Runtime(format!("Function {} not found", name)))?;
        
        let mut results = vec![Val::I32(0); func.ty(&self.store).results().len()];
        func.call(&mut self.store, args, &mut results)
            .map_err(|e| PluginError::Runtime(format!("WASM call failed: {}", e)))?;
        
        Ok(results)
    }
}

#[cfg(feature = "wasm")]
impl Plugin for WasmPlugin {
    fn manifest(&self) -> &PluginManifest {
        &self.manifest
    }

    fn initialize(&mut self, context: &PluginContext) -> Result<(), PluginError> {
        let ctx_data = serde_json::to_vec(context)
            .map_err(|e| PluginError::Serialization(e))?;
        
        self.store.data_mut().context_data = ctx_data;
        
        self.call_wasm_func("initialize", &[])?;
        Ok(())
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        self.call_wasm_func("shutdown", &[])?;
        Ok(())
    }

    fn on_load(&mut self) -> Result<(), PluginError> {
        self.call_wasm_func("on_load", &[])?;
        Ok(())
    }

    fn on_unload(&mut self) -> Result<(), PluginError> {
        self.call_wasm_func("on_unload", &[])?;
        Ok(())
    }

    fn on_document_created(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        let doc_data = serde_json::to_vec(document)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&doc_data)?;
        self.call_wasm_func("on_document_created", &[Val::I32(ptr as i32), Val::I32(doc_data.len() as i32)])?;
        self.deallocate(ptr, doc_data.len())?;
        Ok(())
    }

    fn on_document_opened(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        let doc_data = serde_json::to_vec(document)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&doc_data)?;
        self.call_wasm_func("on_document_opened", &[Val::I32(ptr as i32), Val::I32(doc_data.len() as i32)])?;
        self.deallocate(ptr, doc_data.len())?;
        Ok(())
    }

    fn on_document_saved(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        let doc_data = serde_json::to_vec(document)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&doc_data)?;
        self.call_wasm_func("on_document_saved", &[Val::I32(ptr as i32), Val::I32(doc_data.len() as i32)])?;
        self.deallocate(ptr, doc_data.len())?;
        Ok(())
    }

    fn on_document_closed(&mut self, document: &crate::DocumentRef) -> Result<(), PluginError> {
        let doc_data = serde_json::to_vec(document)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&doc_data)?;
        self.call_wasm_func("on_document_closed", &[Val::I32(ptr as i32), Val::I32(doc_data.len() as i32)])?;
        self.deallocate(ptr, doc_data.len())?;
        Ok(())
    }

    fn on_selection_changed(&mut self, document: &crate::DocumentRef, selection: &crate::Selection) -> Result<(), PluginError> {
        let data = serde_json::json!({
            "document": document,
            "selection": selection,
        });
        let data_vec = serde_json::to_vec(&data)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&data_vec)?;
        self.call_wasm_func("on_selection_changed", &[Val::I32(ptr as i32), Val::I32(data_vec.len() as i32)])?;
        self.deallocate(ptr, data_vec.len())?;
        Ok(())
    }

    fn on_command(&mut self, command_id: &str, args: &serde_json::Value) -> Result<Option<serde_json::Value>, PluginError> {
        let data = serde_json::json!({
            "command": command_id,
            "args": args,
        });
        let data_vec = serde_json::to_vec(&data)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&data_vec)?;
        let results = self.call_wasm_func("on_command", &[Val::I32(ptr as i32), Val::I32(data_vec.len() as i32)])?;
        self.deallocate(ptr, data_vec.len())?;
        
        if let Some(Val::I32(result_ptr)) = results.first() {
            let result_data = self.read_memory(*result_ptr as usize, 1024)?;
            let result: serde_json::Value = serde_json::from_slice(&result_data)
                .map_err(|e| PluginError::Serialization(e))?;
            Ok(Some(result))
        } else {
            Ok(None)
        }
    }

    fn on_ui_event(&mut self, event: &crate::UIEvent) -> Result<(), PluginError> {
        let event_data = serde_json::to_vec(event)
            .map_err(|e| PluginError::Serialization(e))?;
        
        let ptr = self.allocate(&event_data)?;
        self.call_wasm_func("on_ui_event", &[Val::I32(ptr as i32), Val::I32(event_data.len() as i32)])?;
        self.deallocate(ptr, event_data.len())?;
        Ok(())
    }

    fn on_timer(&mut self, interval: f64) -> Result<(), PluginError> {
        self.call_wasm_func("on_timer", &[Val::F64(interval)])?;
        Ok(())
    }
}

#[cfg(feature = "wasm")]
impl WasmPlugin {
    fn allocate(&mut self, data: &[u8]) -> Result<usize, PluginError> {
        let memory = self.memory.as_ref()
            .ok_or_else(|| PluginError::Runtime("No memory exported".to_string()))?;
        
        let mut data_vec = self.store.data_mut().context_data.clone();
        let ptr = data_vec.len();
        data_vec.extend_from_slice(data);
        self.store.data_mut().context_data = data_vec;
        
        Ok(ptr)
    }

    fn deallocate(&mut self, ptr: usize, size: usize) -> Result<(), PluginError> {
        let mut data_vec = self.store.data_mut().context_data.clone();
        if ptr + size <= data_vec.len() {
            data_vec.drain(ptr..ptr + size);
            self.store.data_mut().context_data = data_vec;
        }
        Ok(())
    }

    fn read_memory(&mut self, ptr: usize, size: usize) -> Result<Vec<u8>, PluginError> {
        let memory = self.memory.as_ref()
            .ok_or_else(|| PluginError::Runtime("No memory exported".to_string()))?;
        
        let data = memory.data(&self.store);
        if ptr + size <= data.len() {
            Ok(data[ptr..ptr + size].to_vec())
        } else {
            Err(PluginError::Runtime("Memory read out of bounds".to_string()))
        }
    }
}

#[cfg(not(feature = "wasm"))]
pub struct WasmPlugin;

#[cfg(not(feature = "wasm"))]
impl WasmPlugin {
    pub fn new(_manifest: PluginManifest, _wasm_path: &Path) -> Result<Self, PluginError> {
        Err(PluginError::Runtime("WASM support not enabled. Compile with 'wasm' feature.".to_string()))
    }
}

#[cfg(not(feature = "wasm"))]
impl Plugin for WasmPlugin {
    fn manifest(&self) -> &PluginManifest {
        unimplemented!()
    }

    fn initialize(&mut self, _context: &PluginContext) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn shutdown(&mut self) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_load(&mut self) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_unload(&mut self) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_document_created(&mut self, _document: &crate::DocumentRef) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_document_opened(&mut self, _document: &crate::DocumentRef) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_document_saved(&mut self, _document: &crate::DocumentRef) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_document_closed(&mut self, _document: &crate::DocumentRef) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_selection_changed(&mut self, _document: &crate::DocumentRef, _selection: &crate::Selection) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_command(&mut self, _command_id: &str, _args: &serde_json::Value) -> Result<Option<serde_json::Value>, PluginError> {
        unimplemented!()
    }

    fn on_ui_event(&mut self, _event: &crate::UIEvent) -> Result<(), PluginError> {
        unimplemented!()
    }

    fn on_timer(&mut self, _interval: f64) -> Result<(), PluginError> {
        unimplemented!()
    }
}

pub struct WasmPluginFactory;

impl crate::PluginFactory for WasmPluginFactory {
    fn create_plugin(&self, manifest: &PluginManifest) -> Result<PluginRef, PluginError> {
        let wasm_path = manifest.configuration.as_ref()
            .and_then(|c| c.get("wasm_path"))
            .and_then(|s| s.as_str())
            .map(std::path::Path::new)
            .ok_or_else(|| PluginError::Configuration("Missing wasm_path in configuration".to_string()))?;
        
        let plugin = WasmPlugin::new(manifest.clone(), wasm_path)?;
        Ok(Arc::new(RwLock::new(plugin)))
    }

    fn supported_types(&self) -> Vec<String> {
        vec!["wasm".to_string()]
    }
}