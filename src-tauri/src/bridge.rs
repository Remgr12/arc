use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::commands;
use crate::state::TransformUpdate;

/// Start the local automation bridge: a localhost-only, line-delimited JSON
/// server exposing the same command surface as the webview IPC, so external
/// tooling can drive the editor while every mutation still emits events,
/// records undo history and fires plugin hooks.
pub fn start(app: AppHandle, info_path: PathBuf) {
    std::thread::spawn(move || run(app, info_path));
}

fn run(app: AppHandle, info_path: PathBuf) {
    let base: u16 = std::env::var("ARC_BRIDGE_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(3987);
    let token = make_token();

    let mut listener = None;
    let mut port = base;
    for candidate in base..=base.saturating_add(5) {
        match TcpListener::bind(("127.0.0.1", candidate)) {
            Ok(l) => {
                listener = Some(l);
                port = candidate;
                break;
            }
            Err(_) => continue,
        }
    }
    let Some(listener) = listener else {
        eprintln!("[arc-bridge] could not bind ports {base}..={}", base + 5);
        return;
    };

    let info = json!({ "port": port, "token": token });
    if let Some(parent) = info_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&info_path, serde_json::to_string(&info).unwrap_or_default());

    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let app = app.clone();
        let token = token.clone();
        let _ = std::thread::Builder::new()
            .name("arc-bridge-conn".into())
            .spawn(move || serve(app, token, stream));
    }
}

fn make_token() -> String {
    let mut state = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos() as u64 ^ (d.as_secs() << 20))
        .unwrap_or(0x9E37_79B9_7F4A_7C15)
        ^ ((std::process::id() as u64) << 32)
        | 1;
    let mut buf = String::new();
    for _ in 0..4 {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        buf.push_str(&format!("{:016x}", state));
    }
    buf
}

fn serve(app: AppHandle, token: String, stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let Ok(writer_stream) = stream.try_clone() else { return };
    let mut writer = writer_stream;
    let mut reader = BufReader::new(stream);
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let Ok(msg) = serde_json::from_str::<Value>(line.trim()) else { return };
        if let Some(auth) = msg.get("auth").and_then(|a| a.as_str()) {
            let ok = auth == token;
            let text = format!("{{\"ok\":{}}}\n", ok);
            if writer.write_all(text.as_bytes()).is_err() {
                return;
            }
            if !ok {
                return;
            }
            continue;
        }
        let Some(id) = msg.get("id").cloned() else { return };
        let cmd = msg
            .get("cmd")
            .and_then(|c| c.as_str())
            .unwrap_or("")
            .to_string();
        let params = msg.get("params").cloned().unwrap_or(json!({}));
        let payload = match dispatch(&app, &cmd, &params) {
            Ok(result) => json!({ "id": id, "ok": true, "result": result }),
            Err(error) => json!({ "id": id, "ok": false, "error": error }),
        };
        let mut text = serde_json::to_string(&payload).unwrap_or_default();
        text.push('\n');
        if writer.write_all(text.as_bytes()).is_err() {
            return;
        }
        let _ = writer.flush();
    }
}

fn st<'a, T: Send + Sync + 'static>(app: &'a AppHandle) -> tauri::State<'a, T> {
    app.state::<T>()
}

fn dispatch(app: &AppHandle, cmd: &str, params: &Value) -> Result<Value, String> {
    let d = |k: &str| -> Result<String, String> {
        params
            .get(k)
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or(format!("missing param {k}"))
    };
    let opt = |k: &str| params.get(k).and_then(|v| v.as_str()).map(String::from);
    let arr = |k: &str| -> Result<Vec<String>, String> {
        params
            .get(k)
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .ok_or(format!("missing param {k}"))
    };
    let num = |k: &str| -> Result<f64, String> {
        params
            .get(k)
            .and_then(|v| v.as_f64())
            .ok_or(format!("missing param {k}"))
    };
    let boolean = |k: &str| -> Result<bool, String> {
        params
            .get(k)
            .and_then(|v| v.as_bool())
            .ok_or(format!("missing param {k}"))
    };
    let val = |k: &str| -> Result<Value, String> {
        params.get(k).cloned().ok_or(format!("missing param {k}"))
    };

    match cmd {
        "get_state" => to_json(Ok(commands::get_state(st(app), st(app)))),
        "get_plugins" => to_json(Ok(commands::get_plugins(st(app)))),
        "get_settings" => to_json(Ok(commands::get_settings(st(app)))),
        "set_settings" => to_json(Ok(commands::set_settings(
            app.clone(),
            st(app),
            serde_json::from_value(val("settings")?).map_err(|e| format!("bad settings: {e}"))?,
        ))),
        "new_document" => to_json(commands::new_document(
            app.clone(),
            st(app),
            st(app),
            opt("name"),
        )),
        "open_document" => to_json(commands::open_document(
            app.clone(),
            st(app),
            st(app),
            d("path")?,
        )),
        "save_document" => to_json(commands::save_document(
            app.clone(),
            st(app),
            st(app),
            d("document_id")?,
            opt("path"),
        )),
        "set_active_document" => to_json(commands::set_active_document(
            app.clone(),
            st(app),
            d("id")?,
        )),
        "close_document" => to_json(commands::close_document(app.clone(), st(app), d("id")?)),
        "get_scene" => to_json(commands::get_scene(st(app), d("document_id")?)),
        "create_entity" => to_json(commands::create_entity(
            app.clone(),
            st(app),
            d("document_id")?,
            val("geometry")?,
            opt("name"),
        )),
        "update_geometry" => to_json(commands::update_geometry(
            app.clone(),
            st(app),
            d("document_id")?,
            d("entity_id")?,
            val("geometry")?,
        )),
        "delete_entities" => to_json(commands::delete_entities(
            app.clone(),
            st(app),
            d("document_id")?,
            arr("entity_ids")?,
        )),
        "duplicate_entities" => to_json(commands::duplicate_entities(
            app.clone(),
            st(app),
            d("document_id")?,
            arr("entity_ids")?,
        )),
        "explode_entities" => to_json(commands::explode_entities(
            app.clone(),
            st(app),
            d("document_id")?,
            arr("entity_ids")?,
            num("distance")?,
        )),
        "set_transform" => to_json(commands::set_transform(
            app.clone(),
            st(app),
            d("document_id")?,
            serde_json::from_value::<Vec<TransformUpdate>>(val("updates")?)
                .map_err(|e| format!("bad updates: {e}"))?,
            params.get("record").and_then(|v| v.as_bool()).unwrap_or(true),
        )),
        "set_entity_props" => to_json(commands::set_entity_props(
            app.clone(),
            st(app),
            d("document_id")?,
            d("entity_id")?,
            serde_json::from_value(val("props")?).map_err(|e| format!("bad props: {e}"))?,
        )),
        "set_selection" => to_json(commands::set_selection(
            app.clone(),
            st(app),
            d("document_id")?,
            arr("ids")?,
            opt("primary"),
        )),
        "raycast" => to_json(commands::raycast(
            st(app),
            d("document_id")?,
            triple(params, "origin")?,
            triple(params, "dir")?,
            num("tolerance").unwrap_or(1.0),
        )),
        "undo" => to_json(commands::undo(app.clone(), st(app), d("document_id")?)),
        "redo" => to_json(commands::redo(app.clone(), st(app), d("document_id")?)),
        "add_layer" => to_json(commands::add_layer(
            app.clone(),
            st(app),
            d("document_id")?,
            opt("name"),
        )),
        "delete_layer" => to_json(commands::delete_layer(
            app.clone(),
            st(app),
            d("document_id")?,
            d("layer_id")?,
        )),
        "rename_layer" => to_json(commands::rename_layer(
            app.clone(),
            st(app),
            d("document_id")?,
            d("layer_id")?,
            d("name")?,
        )),
        "set_layer_visible" => to_json(commands::set_layer_visible(
            app.clone(),
            st(app),
            d("document_id")?,
            d("layer_id")?,
            boolean("visible")?,
        )),
        "set_layer_locked" => to_json(commands::set_layer_locked(
            app.clone(),
            st(app),
            d("document_id")?,
            d("layer_id")?,
            boolean("locked")?,
        )),
        "set_layer_color" => to_json(commands::set_layer_color(
            app.clone(),
            st(app),
            d("document_id")?,
            d("layer_id")?,
            quad(params, "color")?,
        )),
        "set_active_layer" => to_json(commands::set_active_layer(
            app.clone(),
            st(app),
            d("document_id")?,
            d("layer_id")?,
        )),
        "set_plugin_enabled" => to_json(commands::set_plugin_enabled(
            app.clone(),
            st(app),
            d("name")?,
            boolean("enabled")?,
        )),
        "reload_plugins" => to_json(Ok(commands::reload_plugins(app.clone(), st(app), st(app)))),
        "export_scene" => to_json(commands::export_scene(
            st(app),
            d("document_id")?,
            d("path")?,
            params.get("format").and_then(|v| v.as_str()).unwrap_or("obj").to_string(),
        )),
        other => Err(format!("unknown command {other}")),
    }
}

fn to_json<T: serde::Serialize>(value: Result<T, String>) -> Result<Value, String> {
    match value {
        Ok(v) => serde_json::to_value(v).map_err(|e| e.to_string()),
        Err(e) => Err(e),
    }
}

fn triple(params: &Value, key: &str) -> Result<[f64; 3], String> {
    let arr = params
        .get(key)
        .and_then(|v| v.as_array())
        .ok_or(format!("missing param {key}"))?;
    if arr.len() != 3 {
        return Err(format!("param {key} needs exactly 3 numbers"));
    }
    let mut out = [0.0f64; 3];
    for (slot, v) in out.iter_mut().zip(arr) {
        *slot = v.as_f64().ok_or(format!("param {key} has a non-number"))?;
    }
    Ok(out)
}

fn quad(params: &Value, key: &str) -> Result<[f64; 4], String> {
    let arr = params
        .get(key)
        .and_then(|v| v.as_array())
        .ok_or(format!("missing param {key}"))?;
    if arr.len() != 4 {
        return Err(format!("param {key} needs exactly 4 numbers"));
    }
    let mut out = [0.0f64; 4];
    for (slot, v) in out.iter_mut().zip(arr) {
        *slot = v.as_f64().ok_or(format!("param {key} has a non-number"))?;
    }
    Ok(out)
}
