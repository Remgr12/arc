use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "2025-06-18";

struct Bridge {
    port: u16,
    token: String,
}

fn bridge_info_path() -> PathBuf {
    if let Ok(path) = env::var("ARC_BRIDGE_INFO") {
        return PathBuf::from(path);
    }
    base_data_dir().join("com.arc.cad").join("bridge.json")
}

fn base_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            return PathBuf::from(home).join("Library/Application Support");
        }
        PathBuf::from(".")
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = env::var("HOME").unwrap_or_default();
                PathBuf::from(home).join(".local/share")
            })
    }
    #[cfg(target_os = "windows")]
    {
        env::var("APPDATA").map(PathBuf::from).unwrap_or_default()
    }
}

impl Bridge {
    fn load() -> Result<Self, String> {
        if let Ok(port) = env::var("ARC_BRIDGE_PORT") {
            let port: u16 = port
                .parse()
                .map_err(|e| format!("bad ARC_BRIDGE_PORT: {e}"))?;
            // Token still comes from the info file for a port override.
            return match fs::read_to_string(bridge_info_path())
                .ok()
                .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            {
                Some(v) if v.get("token").and_then(|t| t.as_str()).is_some() => Ok(Bridge {
                    port,
                    token: v["token"].as_str().unwrap_or("").to_string(),
                }),
                _ => Err(format!(
                    "bridge info missing at {} (launch arc first)",
                    bridge_info_path().display()
                )),
            };
        }
        let path = bridge_info_path();
        let text = fs::read_to_string(&path)
            .map_err(|_| format!("bridge info missing at {} (launch arc first)", path.display()))?;
        let value: Value = serde_json::from_str(&text).map_err(|e| format!("corrupt bridge info: {e}"))?;
        let port = value
            .get("port")
            .and_then(|p| p.as_u64())
            .ok_or("corrupt bridge info: no port")? as u16;
        let token = value
            .get("token")
            .and_then(|t| t.as_str())
            .ok_or("corrupt bridge info: no token")?
            .to_string();
        Ok(Bridge { port, token })
    }

    fn call(&self, cmd: &str, params: Value) -> Result<Value, String> {
        let stream = TcpStream::connect(("127.0.0.1", self.port))
            .map_err(|e| format!("arc bridge connect failed on 127.0.0.1:{}: {e}", self.port))?;
        let _ = stream.set_nodelay(true);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
        let mut writer = stream.try_clone().map_err(|e| format!("socket clone: {e}"))?;
        let mut reader = BufReader::new(stream);

        let auth = json!({ "auth": self.token }).to_string();
        writeln!(writer, "{auth}").map_err(|e| format!("bridge auth write: {e}"))?;
        let mut ack = String::new();
        reader
            .read_line(&mut ack)
            .map_err(|e| format!("bridge auth read: {e}"))?;
        if !ack.contains("\"ok\":true") {
            return Err("bridge rejected auth token".into());
        }

        let line = json!({ "id": 1, "cmd": cmd, "params": params }).to_string();
        writeln!(writer, "{line}").map_err(|e| format!("bridge write: {e}"))?;
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .map_err(|e| format!("bridge read: {e}"))?;
        let value: Value =
            serde_json::from_str(response.trim()).map_err(|e| format!("bridge decode: {e}"))?;
        if value.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
            Ok(value
                .get("result")
                .cloned()
                .unwrap_or_else(|| json!(null)))
        } else {
            Err(value
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("bridge call failed")
                .to_string())
        }
    }
}

fn resolve_document_id(args: &Value, bridge: &Bridge) -> Result<String, String> {
    if let Some(id) = args.get("document_id").and_then(|v| v.as_str()) {
        return Ok(id.to_string());
    }
    let overview = bridge.call("get_state", json!({}))?;
    overview
        .get("active")
        .and_then(|a| a.as_str())
        .map(String::from)
        .ok_or_else(|| "no document_id given and no active document".into())
}

fn num(args: &Value, key: &str) -> Result<f64, String> {
    args.get(key)
        .and_then(|v| v.as_f64())
        .ok_or(format!("missing number param {key}"))
}

fn strs(args: &Value, key: &str) -> Result<Vec<Value>, String> {
    args.get(key)
        .and_then(|v| v.as_array())
        .cloned()
        .ok_or(format!("missing array param {key}"))
}

fn execute_tool(bridge: &Bridge, name: &str, args: &Value) -> Result<Value, String> {
    let doc = resolve_document_id(args, bridge).ok();
    let want_doc = |err: &str| -> Result<String, String> {
        doc.clone().ok_or_else(|| err.to_string())
    };
    match name {
        "arc_get_state" => bridge.call("get_state", json!({})),
        "arc_get_scene" => {
            bridge.call("get_scene", json!({ "document_id": want_doc("pass document_id or set one active")? }))
        }
        "arc_new_document" => bridge.call(
            "new_document",
            json!({ "name": args.get("name").and_then(|v| v.as_str()) }),
        ),
        "arc_open_document" => {
            let path = args
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or("missing string param path")?;
            bridge.call("open_document", json!({ "path": path }))
        }
        "arc_save_document" => bridge.call(
            "save_document",
            json!({
                "document_id": want_doc("pass document_id")?,
                "path": args.get("path").and_then(|v| v.as_str()),
            }),
        ),
        "arc_close_document" => {
            let id = args
                .get("document_id")
                .and_then(|v| v.as_str())
                .ok_or("missing string param document_id")?;
            bridge.call("close_document", json!({ "id": id }))
        }
        "arc_set_active_document" => {
            let id = args
                .get("document_id")
                .and_then(|v| v.as_str())
                .ok_or("missing string param document_id")?;
            bridge.call("set_active_document", json!({ "id": id }))
        }
        "arc_create_entity" => bridge.call(
            "create_entity",
            json!({
                "document_id": doc.clone().ok_or("pass document_id or set one active")?,
                "geometry": args.get("geometry").cloned().ok_or("missing object param geometry")?,
                "name": args.get("name").and_then(|v| v.as_str()),
            }),
        ),
        "arc_set_position" => {
            let document_id = want_doc("pass document_id or set one active")?;
            let id = args
                .get("entity_id")
                .and_then(|v| v.as_str())
                .ok_or("missing string param entity_id")?;
            let position = strs(args, "position")?;
            let transform = json!({
                "position": position,
                "rotation": [0, 0, 0, 1],
                "scale": [1, 1, 1],
            });
            bridge.call(
                "set_transform",
                json!({ "document_id": document_id, "updates": [{ "id": id, "transform": transform }], "record": true }),
            )
        }
        "arc_set_transform" => bridge.call(
            "set_transform",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "updates": strs(args, "updates")?,
                "record": args.get("record").and_then(|v| v.as_bool()).unwrap_or(true),
            }),
        ),
        "arc_update_geometry" => bridge.call(
            "update_geometry",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "entity_id": args.get("entity_id").and_then(|v| v.as_str()).ok_or("missing string param entity_id")?,
                "geometry": args.get("geometry").cloned().ok_or("missing object param geometry")?,
            }),
        ),
        "arc_delete_entities" => bridge.call(
            "delete_entities",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "entity_ids": strs(args, "entity_ids")?,
            }),
        ),
        "arc_duplicate_entities" => bridge.call(
            "duplicate_entities",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "entity_ids": strs(args, "entity_ids")?,
            }),
        ),
        "arc_explode_entities" => bridge.call(
            "explode_entities",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "entity_ids": strs(args, "entity_ids")?,
                "distance": num(args, "distance")?,
            }),
        ),
        "arc_set_entity_props" => bridge.call(
            "set_entity_props",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "entity_id": args.get("entity_id").and_then(|v| v.as_str()).ok_or("missing string param entity_id")?,
                "props": args.get("props").cloned().ok_or("missing object param props")?,
            }),
        ),
        "arc_add_selection" | "arc_set_selection" => {
            if name == "arc_add_selection" {
                return Err("use arc_set_selection".into());
            }
            bridge.call(
                "set_selection",
                json!({
                    "document_id": want_doc("pass document_id or set one active")?,
                    "ids": strs(args, "ids")?,
                    "primary": args.get("primary").and_then(|v| v.as_str()),
                }),
            )
        }
        "arc_raycast" => bridge.call(
            "raycast",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "origin": strs(args, "origin")?,
                "dir": strs(args, "dir")?,
                "tolerance": args.get("tolerance").and_then(|v| v.as_f64()).unwrap_or(1.0),
            }),
        ),
        "arc_undo" => bridge.call(
            "undo",
            json!({ "document_id": want_doc("pass document_id or set one active")? }),
        ),
        "arc_redo" => bridge.call(
            "redo",
            json!({ "document_id": want_doc("pass document_id or set one active")? }),
        ),
        "arc_add_layer" => bridge.call(
            "add_layer",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "name": args.get("name").and_then(|v| v.as_str()),
            }),
        ),
        "arc_delete_layer" => bridge.call(
            "delete_layer",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "layer_id": args.get("layer_id").and_then(|v| v.as_str()).ok_or("missing string param layer_id")?,
            }),
        ),
        "arc_rename_layer" => bridge.call(
            "rename_layer",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "layer_id": args.get("layer_id").and_then(|v| v.as_str()).ok_or("missing string param layer_id")?,
                "name": args.get("name").and_then(|v| v.as_str()).ok_or("missing string param name")?,
            }),
        ),
        "arc_set_layer_visible" => bridge.call(
            "set_layer_visible",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "layer_id": args.get("layer_id").and_then(|v| v.as_str()).ok_or("missing string param layer_id")?,
                "visible": args.get("visible").and_then(|v| v.as_bool()).ok_or("missing bool param visible")?,
            }),
        ),
        "arc_set_layer_locked" => bridge.call(
            "set_layer_locked",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "layer_id": args.get("layer_id").and_then(|v| v.as_str()).ok_or("missing string param layer_id")?,
                "locked": args.get("locked").and_then(|v| v.as_bool()).ok_or("missing bool param locked")?,
            }),
        ),
        "arc_set_layer_color" => bridge.call(
            "set_layer_color",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "layer_id": args.get("layer_id").and_then(|v| v.as_str()).ok_or("missing string param layer_id")?,
                "color": strs(args, "color")?,
            }),
        ),
        "arc_set_active_layer" => bridge.call(
            "set_active_layer",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "layer_id": args.get("layer_id").and_then(|v| v.as_str()).ok_or("missing string param layer_id")?,
            }),
        ),
        "arc_export_scene" => bridge.call(
            "export_scene",
            json!({
                "document_id": want_doc("pass document_id or set one active")?,
                "path": args.get("path").and_then(|v| v.as_str()).ok_or("missing string param path")?,
                "format": args.get("format").and_then(|v| v.as_str()).unwrap_or("obj"),
            }),
        ),
        "arc_get_plugins" => bridge.call("get_plugins", json!({})),
        "arc_reload_plugins" => bridge.call("reload_plugins", json!({})),
        "arc_set_plugin_enabled" => bridge.call(
            "set_plugin_enabled",
            json!({
                "name": args.get("name").and_then(|v| v.as_str()).ok_or("missing string param name")?,
                "enabled": args.get("enabled").and_then(|v| v.as_bool()).ok_or("missing bool param enabled")?,
            }),
        ),
        "arc_get_settings" => bridge.call("get_settings", json!({})),
        "arc_set_settings" => bridge.call(
            "set_settings",
            json!({ "settings": args.get("settings").cloned().ok_or("missing object param settings")? }),
        ),
        other => Err(format!("unknown tool {other}")),
    }
}

fn tool(name: &str, description: &str, properties: Value, required: Value) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    })
}

fn tool_catalog() -> Vec<Value> {
    let doc_id = json!({
        "type": "string",
        "description": "Document id. Omit when another tool call already made one active; omitting uses the active document."
    });
    let entity_id = json!({
        "type": "string",
        "description": "Entity id, as returned at creation or listed in arc_get_scene."
    });
    let layer_id = json!({
        "type": "string",
        "description": "Layer id, as listed in arc_get_scene."
    });
    let ids = |desc: &str| {
        json!({
            "type": "array",
            "items": { "type": "string" },
            "description": desc
        })
    };
    let geometry = json!({
        "type": "object",
        "description": "Geometry payload. Exactly one of these shapes: \
{\"type\":\"box\",\"width\":60,\"depth\":60,\"height\":20,\"corner_radius\":0} | \
{\"type\":\"sphere\",\"radius\":30,\"segments\":32} | \
{\"type\":\"cylinder\",\"radius\":20,\"height\":40,\"segments\":32} | \
{\"type\":\"cone\",\"radius\":20,\"height\":40,\"segments\":32} | \
{\"type\":\"torus\",\"radius\":30,\"tube\":8,\"segments\":32,\"tubular_segments\":16} | \
{\"type\":\"plane\",\"width\":200,\"depth\":200} | \
{\"type\":\"circle\",\"radius\":40,\"segments\":48} | \
{\"type\":\"line\",\"end\":[60,0,0]} | \
{\"type\":\"polyline\",\"points\":[[x,y,z],...]} | \
{\"type\":\"rectangle\",\"width\":80,\"depth\":50} | \
{\"type\":\"dimension\",\"start\":[0,0,0 ],\"end\":[80,0,0]} | \
{\"type\":\"wall\",\"path\":[[x,y,z],...],\"width\":10,\"height\":80}"
    });
    let transform = json!({
        "type": "object",
        "description": "Full spatial transform: {\"position\":[x,y,z],\"rotation\":[x,y,z,w] quaternion,\"scale\":[x,y,z]}",
        "properties": {
            "position": { "type": "array", "items": { "type": "number" } },
            "rotation": { "type": "array", "items": { "type": "number" } },
            "scale": { "type": "array", "items": { "type": "number" } }
        }
    });
    let props = json!({
        "type": "object",
        "description": "Entity property patch;",
        "properties": {
            "name": { "type": "string" },
            "visible": { "type": "boolean" },
            "locked": { "type": "boolean" },
            "color": {
                "oneOf": [
                    { "type": "null", "description": "clears the entity color" },
                    { "type": "array", "items": { "type": "number" }, "minItems": 4, "maxItems": 4, "description": "rgba 0..1" }
                ]
            },
            "layer_id": { "type": "string" }
        }
    });

    vec![
        tool(
            "arc_get_state",
            "Overview of the open arc session: every open document (name, id, path, modified flag) plus which one is active and the current editor settings. Call this first to discover document ids.",
            json!({}),
            json!([]),
        ),
        tool(
            "arc_get_scene",
            "Full snapshot of a document: entities (transforms, visibility, lock state, color, geometry, mesh data), layers, selection and history position.",
            json!({ "document_id": doc_id.clone() }),
            json!([]),
        ),
        tool(
            "arc_new_document",
            "Create a document, make it active and return its metadata.",
            json!({ "name": { "type": "string", "description": "Optional display name; defaults to Untitled N." } }),
            json!([]),
        ),
        tool(
            "arc_open_document",
            "Open a .arc JSON document from disk, make it active and return its metadata.",
            json!({ "path": { "type": "string", "description": "Absolute file path." } }),
            json!(["path"]),
        ),
        tool(
            "arc_save_document",
            "Save a document as .arc JSON. Give a path on first save; later saves can reuse the stored path.",
            json!({
                "document_id": doc_id.clone(),
                "path": { "type": "string", "description": "Optional target path; reuse the stored one when omitted." }
            }),
            json!([]),
        ),
        tool(
            "arc_close_document",
            "Close a document. The session always keeps one active document, creating a fresh Untitled when needed.",
            json!({ "document_id": doc_id.clone() }),
            json!(["document_id"]),
        ),
        tool(
            "arc_set_active_document",
            "Switch the active document in the running editor UI.",
            json!({ "document_id": doc_id.clone() }),
            json!(["document_id"]),
        ),
        tool(
            "arc_create_entity",
            "Create an entity from a geometry payload and return its id. The entity lands in the active layer at the origin; move it with arc_set_position or arc_set_transform. Emits a scene event so the open UI updates live.",
            json!({ "document_id": doc_id.clone(), "geometry": geometry, "name": { "type": "string", "description": "Optional name; defaults to Box 1, Sphere 2, ..." } }),
            json!(["geometry"]),
        ),
        tool(
            "arc_set_position",
            "Place one entity at a world position (identity rotation, unit scale).",
            json!({
                "document_id": doc_id.clone(),
                "entity_id": entity_id.clone(),
                "position": { "type": "array", "items": { "type": "number" }, "description": "[x, y, z]; y is up." }
            }),
            json!(["entity_id", "position"]),
        ),
        tool(
            "arc_set_transform",
            "Apply a full spatial transform to one or more entities in a single undo entry.",
            json!({
                "document_id": doc_id.clone(),
                "updates": { "type": "array", "items": { "type": "object", "properties": { "id": { "type": "string" }, "transform": transform.clone() } }, "description": "[{\"id\":\"...\",\"transform\":{...}}]" },
                "record": { "type": "boolean", "description": "Push onto the undo stack (default true); pass false during gesture churn." }
            }),
            json!(["updates"]),
        ),
        tool(
            "arc_update_geometry",
            "Replace the geometry of an existing entity (e.g. retune a box's size).",
            json!({
                "document_id": doc_id.clone(),
                "entity_id": entity_id.clone(),
                "geometry": geometry.clone()
            }),
            json!(["entity_id", "geometry"]),
        ),
        tool(
            "arc_delete_entities",
            "Delete entities permanently (undoable).",
            json!({ "document_id": doc_id.clone(), "entity_ids": ids("Entity ids to delete.") }),
            json!(["entity_ids"]),
        ),
        tool(
            "arc_duplicate_entities",
            "Duplicate entities in place and return the new ids.",
            json!({ "document_id": doc_id.clone(), "entity_ids": ids("Entity ids to duplicate.") }),
            json!(["entity_ids"]),
        ),
        tool(
            "arc_explode_entities",
            "Radially push selected entities apart from their centroid (a favorite for quickly separating models).",
            json!({ "document_id": doc_id.clone(), "entity_ids": ids("Entity ids to spread."), "distance": { "type": "number" } }),
            json!(["entity_ids", "distance"]),
        ),
        tool(
            "arc_set_entity_props",
            "Patch entity properties: name, visibility, lock, color or layer.",
            json!({
                "document_id": doc_id.clone(),
                "entity_id": entity_id.clone(),
                "props": props
            }),
            json!(["entity_id", "props"]),
        ),
        tool(
            "arc_set_selection",
            "Replace the editor selection (drives highlights, the properties panel and exports).",
            json!({
                "document_id": doc_id.clone(),
                "ids": ids("Entity ids, empty list clears the selection."),
                "primary": { "type": "string", "description": "Optional primary (last-clicked) entity id." }
            }),
            json!(["ids"]),
        ),
        tool(
            "arc_raycast",
            "Hit-test a document along a ray from an origin; returns the first entity within tolerance, or null.",
            json!({
                "document_id": doc_id.clone(),
                "origin": { "type": "array", "items": { "type": "number" }, "description": "[x,y,z] ray start." },
                "dir": { "type": "array", "items": { "type": "number" }, "description": "Ray direction, any length; normalized internally." },
                "tolerance": { "type": "number", "description": "Search tolerance, default 1.0 world units." }
            }),
            json!(["origin", "dir"]),
        ),
        tool(
            "arc_undo",
            "Undo the last operation and return its label (or null at the start of history).",
            json!({ "document_id": doc_id.clone() }),
            json!([]),
        ),
        tool(
            "arc_redo",
            "Redo the next operation and return its label (or null at the top of history).",
            json!({ "document_id": doc_id.clone() }),
            json!([]),
        ),
        tool(
            "arc_add_layer",
            "Add a layer and return its id.",
            json!({ "document_id": doc_id.clone(), "name": { "type": "string", "description": "Optional layer name." } }),
            json!([]),
        ),
        tool(
            "arc_delete_layer",
            "Remove a layer; entities on the default layer are kept.",
            json!({ "document_id": doc_id.clone(), "layer_id": layer_id.clone() }),
            json!(["layer_id"]),
        ),
        tool(
            "arc_rename_layer",
            "Rename a layer.",
            json!({ "document_id": doc_id.clone(), "layer_id": layer_id.clone(), "name": { "type": "string" } }),
            json!(["layer_id", "name"]),
        ),
        tool(
            "arc_set_layer_visible",
            "Show or hide every entity on a layer.",
            json!({ "document_id": doc_id.clone(), "layer_id": layer_id.clone(), "visible": { "type": "boolean" } }),
            json!(["layer_id", "visible"]),
        ),
        tool(
            "arc_set_layer_locked",
            "Lock or unlock a layer (locked entities cannot be picked in the viewport).",
            json!({ "document_id": doc_id.clone(), "layer_id": layer_id.clone(), "locked": { "type": "boolean" } }),
            json!(["layer_id", "locked"]),
        ),
        tool(
            "arc_set_layer_color",
            "Set the base color of a layer as [r, g, b, a] floats 0..1; entities without an override inherit it.",
            json!({ "document_id": doc_id.clone(), "layer_id": layer_id.clone(), "color": { "type": "array", "items": { "type": "number" } } }),
            json!(["layer_id", "color"]),
        ),
        tool(
            "arc_set_active_layer",
            "Make a layer active; new entities land there.",
            json!({ "document_id": doc_id.clone(), "layer_id": layer_id.clone() }),
            json!(["layer_id"]),
        ),
        tool(
            "arc_export_scene",
            "Export the document's visible solid geometry to disk as OBJ (.obj) or binary STL (.stl).",
            json!({
                "document_id": doc_id.clone(),
                "path": { "type": "string", "description": "Absolute output file path." },
                "format": { "type": "string", "description": "\"obj\" or \"stl\"; defaults to obj." }
            }),
            json!(["path"]),
        ),
        tool(
            "arc_get_plugins",
            "List discovered Lua plugins with their enabled state.",
            json!({}),
            json!([]),
        ),
        tool(
            "arc_reload_plugins",
            "Re-scan the plugin directories, reload every enabled script and replay their hooks.",
            json!({}),
            json!([]),
        ),
        tool(
            "arc_set_plugin_enabled",
            "Enable or disable a plugin by name and persist the choice.",
            json!({ "name": { "type": "string" }, "enabled": { "type": "boolean" } }),
            json!(["name", "enabled"]),
        ),
        tool(
            "arc_get_settings",
            "Read the editor settings payload (theme, grid size, snap, keybind profile, enabled plugins).",
            json!({}),
            json!([]),
        ),
        tool(
            "arc_set_settings",
            "Replace the editor settings payload and persist it. Fetch with arc_get_settings first, mutate the fields you need, send the full object back.",
            json!({ "settings": { "type": "object", "description": "Complete settings object as returned by arc_get_settings." } }),
            json!(["settings"]),
        ),
    ]
}

fn resources_list(bridge: &Bridge) -> Result<Vec<Value>, String> {
    let overview = bridge.call("get_state", json!({}))?;
    Ok(overview
        .get("documents")
        .and_then(|d| d.as_array())
        .map(|docs| {
            docs.iter()
                .map(|d| {
                    let uri = format!("arc://doc/{}", d.get("id").and_then(|i| i.as_str()).unwrap_or(""));
                    let name = d.get("name").and_then(|n| n.as_str()).unwrap_or("document");
                    json!({
                        "uri": uri,
                        "name": name,
                        "description": format!("Live scene snapshot of the open document \"{name}\""),
                        "mimeType": "application/json"
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

fn respond(out: &mut impl Write, id: Value, result: Value) {
    let value = json!({ "jsonrpc": "2.0", "id": id, "result": result });
    writeln!(out, "{value}").ok();
    out.flush().ok();
}

fn respond_error(out: &mut impl Write, id: Value, code: i64, message: &str) {
    let value = json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    });
    writeln!(out, "{value}").ok();
    out.flush().ok();
}

fn main() {
    let next_id = AtomicU64::new(1);
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    loop {
        let mut line = String::new();
        match stdin.lock().read_line(&mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let msg: Value = match serde_json::from_str(line.trim()) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(id) = msg.get("id").cloned() else { continue };
        let method = msg
            .get("method")
            .and_then(|m| m.as_str())
            .unwrap_or("")
            .to_string();
        let params = msg.get("params").cloned().unwrap_or(json!({}));

        match method.as_str() {
            "initialize" => {
                let client_version = params
                    .get("protocolVersion")
                    .and_then(|v| v.as_str())
                    .unwrap_or(PROTOCOL_VERSION);
                let version = ["2024-11-05", "2025-03-26", "2025-06-18"]
                    .contains(&client_version)
                    .then(|| client_version.to_string())
                    .unwrap_or_else(|| {
                        params
                            .get("protocolVersion")
                            .and_then(|v| v.as_str())
                            .unwrap_or(PROTOCOL_VERSION)
                            .to_string()
                    });
                respond(
                    &mut stdout,
                    id,
                    json!({
                        "protocolVersion": version,
                        "capabilities": {
                            "tools": { "listChanged": false },
                            "resources": { "listChanged": false }
                        },
                        "serverInfo": { "name": "arc", "title": "Arc CAD session", "version": env!("CARGO_PKG_VERSION") },
                        "instructions": "Drives a running Arc CAD editor session over the local automation bridge. Start arc first, then call arc_get_state to discover documents. Entities are created with arc_create_entity (see the geometry description for the exact payload shapes); position/scale/rotate them with arc_set_position or arc_set_transform (quaternion rotation). Omit document_id to operate on the active document; pass ids discovered in arc_get_scene (entities and layers section) for precise edits. Every mutation is undoable (arc_undo / arc_redo) and the open UI stays in sync."
                    }),
                );
            }
            "ping" => respond(&mut stdout, id, json!({})),
            "tools/list" => {
                let next = next_id.fetch_add(1, Ordering::SeqCst);
                if next == u64::MAX {
                    respond(&mut stdout, id, json!({ "tools": [] }));
                    continue;
                }
                respond(&mut stdout, id, json!({ "tools": tool_catalog() }));
            }
            "tools/call" => {
                let name = params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let args = params.get("arguments").cloned().unwrap_or(json!({}));
                match Bridge::load().and_then(|bridge| execute_tool(&bridge, &name, &args)) {
                    Ok(result) => {
                        let text = serde_json::to_string_pretty(&result).unwrap_or_default();
                        respond(
                            &mut stdout,
                            id,
                            json!({
                                "content": [ { "type": "text", "text": text } ],
                                "isError": false
                            }),
                        );
                    }
                    Err(error) => {
                        respond(
                            &mut stdout,
                            id,
                            json!({
                                "content": [ { "type": "text", "text": error } ],
                                "isError": true
                            }),
                        );
                    }
                }
            }
            "resources/list" => match Bridge::load().and_then(|bridge| resources_list(&bridge)) {
                Ok(items) => respond(&mut stdout, id, json!({ "resources": items })),
                Err(error) => respond(&mut stdout, id, json!({ "resources": [], "_meta": { "error": error } })),
            },
            "resources/read" => {
                let uri = params
                    .get("uri")
                    .and_then(|u| u.as_str())
                    .unwrap_or("")
                    .to_string();
                let document_id = uri.trim_start_matches("arc://doc/").to_string();
                if document_id.is_empty() || uri == document_id {
                    respond_error(&mut stdout, id, -32602, "expected arc://doc/<document_id> uri");
                    continue;
                }
                match Bridge::load().and_then(|bridge| {
                    bridge.call("get_scene", json!({ "document_id": document_id }))
                }) {
                    Ok(scene) => {
                        let text = serde_json::to_string_pretty(&scene).unwrap_or_default();
                        respond(
                            &mut stdout,
                            id,
                            json!({
                                "contents": [ {
                                    "uri": uri,
                                    "mimeType": "application/json",
                                    "text": text
                                } ]
                            }),
                        );
                    }
                    Err(error) => respond_error(&mut stdout, id, -32000, &error),
                }
            }
            "resources/templates/list" => {
                respond(&mut stdout, id, json!({ "resourceTemplates": [] }));
            }
            "prompts/list" => {
                respond(&mut stdout, id, json!({ "prompts": [] }));
            }
            _ => respond_error(
                &mut stdout,
                id,
                -32601,
                &format!("method not supported: {method}"),
            ),
        }
    }
}
