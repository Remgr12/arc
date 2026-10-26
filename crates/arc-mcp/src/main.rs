use std::collections::HashMap;
use std::env;
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

use serde_json::{json, Value};

const PROTOCOL_VERSION: &str = "2024-11-05";
const SERVER_NAME: &str = "arc-mcp";
const SERVER_VERSION: &str = "0.28.0";

// ============================================================================
// Bridge Connection & Auto-Discovery
// ============================================================================

struct Bridge {
    port: u16,
    token: String,
}

fn candidate_bridge_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(path) = env::var("ARC_BRIDGE_INFO") {
        paths.push(PathBuf::from(path));
    }
    // XDG / standard user data dir
    #[cfg(target_os = "macos")]
    {
        if let Ok(home) = env::var("HOME") {
            paths.push(PathBuf::from(&home).join("Library/Application Support/com.arc.cad/bridge.json"));
            paths.push(PathBuf::from(&home).join(".config/arc/bridge.json"));
        }
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Ok(xdg) = env::var("XDG_DATA_HOME") {
            paths.push(PathBuf::from(xdg).join("com.arc.cad/bridge.json"));
        }
        if let Ok(home) = env::var("HOME") {
            paths.push(PathBuf::from(&home).join(".local/share/com.arc.cad/bridge.json"));
            paths.push(PathBuf::from(&home).join(".config/arc/bridge.json"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(appdata) = env::var("APPDATA") {
            paths.push(PathBuf::from(appdata).join("com.arc.cad\\bridge.json"));
        }
    }
    paths.push(PathBuf::from("./bridge.json"));
    paths
}

impl Bridge {
    fn read_bridge_info() -> Result<Self, String> {
        if let Ok(port_str) = env::var("ARC_BRIDGE_PORT") {
            let port: u16 = port_str
                .parse()
                .map_err(|e| format!("invalid ARC_BRIDGE_PORT: {e}"))?;
            let token = env::var("ARC_BRIDGE_TOKEN").unwrap_or_default();
            if !token.is_empty() {
                return Ok(Bridge { port, token });
            }
            for path in candidate_bridge_paths() {
                if let Ok(text) = fs::read_to_string(&path) {
                    if let Ok(val) = serde_json::from_str::<Value>(&text) {
                        if let Some(t) = val.get("token").and_then(|v| v.as_str()) {
                            return Ok(Bridge {
                                port,
                                token: t.to_string(),
                            });
                        }
                    }
                }
            }
        }

        for path in candidate_bridge_paths() {
            if let Ok(text) = fs::read_to_string(&path) {
                if let Ok(val) = serde_json::from_str::<Value>(&text) {
                    let port = val.get("port").and_then(|p| p.as_u64()).map(|p| p as u16);
                    let token = val.get("token").and_then(|t| t.as_str()).map(String::from);
                    if let (Some(port), Some(token)) = (port, token) {
                        return Ok(Bridge { port, token });
                    }
                }
            }
        }

        Err("bridge.json not found".to_string())
    }

    fn find_arc_binary() -> Option<PathBuf> {
        if let Ok(path) = env::var("ARC_BINARY") {
            let p = PathBuf::from(path);
            if p.exists() {
                return Some(p);
            }
        }
        if let Ok(exe) = env::current_exe() {
            if let Some(dir) = exe.parent() {
                let candidate = dir.join(if cfg!(windows) { "arc.exe" } else { "arc" });
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
        for rel in &["target/release/arc", "target/debug/arc", "../target/release/arc", "../target/debug/arc"] {
            let p = PathBuf::from(rel);
            if p.exists() {
                return Some(p);
            }
        }
        None
    }

    fn launch_arc() -> Result<(), String> {
        let bin = Self::find_arc_binary().ok_or_else(|| {
            "Could not locate the Arc executable ('arc'). Please build or run Arc first.".to_string()
        })?;

        let is_headless_linux = cfg!(target_os = "linux")
            && env::var("DISPLAY").is_err()
            && env::var("WAYLAND_DISPLAY").is_err();

        let mut cmd = if is_headless_linux && PathBuf::from("/usr/bin/xvfb-run").exists() {
            let mut c = std::process::Command::new("/usr/bin/xvfb-run");
            c.arg("-a").arg(bin);
            c
        } else {
            std::process::Command::new(bin)
        };

        cmd.stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());

        cmd.spawn().map_err(|e| format!("Failed to spawn Arc desktop: {e}"))?;
        Ok(())
    }

    fn load() -> Result<Self, String> {
        // 1. If an existing bridge is responding, use it immediately
        if let Ok(bridge) = Self::read_bridge_info() {
            if TcpStream::connect(("127.0.0.1", bridge.port)).is_ok() {
                return Ok(bridge);
            }
        }

        // 2. Otherwise auto-launch Arc in background
        let _ = Self::launch_arc();

        // 3. Poll for up to 6 seconds for bridge to become ready
        let start = std::time::Instant::now();
        while start.elapsed() < Duration::from_secs(6) {
            std::thread::sleep(Duration::from_millis(150));
            if let Ok(bridge) = Self::read_bridge_info() {
                if TcpStream::connect(("127.0.0.1", bridge.port)).is_ok() {
                    return Ok(bridge);
                }
            }
        }

        Err(
            "Arc is not currently running or bridge.json was not found. Please start the Arc desktop app first."
                .to_string(),
        )
    }

    fn call(&self, cmd: &str, params: Value) -> Result<Value, String> {
        let stream = TcpStream::connect(("127.0.0.1", self.port)).map_err(|e| {
            format!(
                "Failed to connect to Arc automation bridge on 127.0.0.1:{}: {e}. Ensure Arc is open.",
                self.port
            )
        })?;
        let _ = stream.set_nodelay(true);
        let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
        let _ = stream.set_write_timeout(Some(Duration::from_secs(10)));
        let mut writer = stream.try_clone().map_err(|e| format!("Socket clone failed: {e}"))?;
        let mut reader = BufReader::new(stream);

        let auth = json!({ "auth": self.token }).to_string();
        writeln!(writer, "{auth}").map_err(|e| format!("Bridge auth write failed: {e}"))?;
        let mut ack = String::new();
        reader
            .read_line(&mut ack)
            .map_err(|e| format!("Bridge auth handshake read failed: {e}"))?;
        if !ack.contains("\"ok\":true") {
            return Err("Arc automation bridge rejected authentication token.".into());
        }

        let line = json!({ "id": 1, "cmd": cmd, "params": params }).to_string();
        writeln!(writer, "{line}").map_err(|e| format!("Bridge command write failed: {e}"))?;
        let mut response = String::new();
        reader
            .read_line(&mut response)
            .map_err(|e| format!("Bridge response read failed: {e}"))?;
        let value: Value = serde_json::from_str(response.trim())
            .map_err(|e| format!("Bridge JSON decode error: {e}"))?;

        if value.get("ok").and_then(|o| o.as_bool()).unwrap_or(false) {
            Ok(value.get("result").cloned().unwrap_or(json!(null)))
        } else {
            Err(value
                .get("error")
                .and_then(|e| e.as_str())
                .unwrap_or("Bridge command execution failed")
                .to_string())
        }
    }
}

// ============================================================================
// Automatic Document Resolution
// ============================================================================

fn resolve_or_create_doc(bridge: &Bridge, args: &Value) -> Result<String, String> {
    if let Some(id) = args.get("document_id").and_then(|v| v.as_str()) {
        if !id.trim().is_empty() {
            return Ok(id.to_string());
        }
    }
    let overview = bridge.call("get_state", json!({}))?;
    if let Some(active) = overview.get("active").and_then(|a| a.as_str()) {
        if !active.is_empty() {
            return Ok(active.to_string());
        }
    }
    // Check if there are any documents listed
    if let Some(docs) = overview.get("documents").and_then(|d| d.as_array()) {
        if let Some(first) = docs.first().and_then(|d| d.get("id")).and_then(|id| id.as_str()) {
            let _ = bridge.call("set_active_document", json!({ "id": first }));
            return Ok(first.to_string());
        }
    }
    // No documents open: automatically create one!
    let new_doc = bridge.call("new_document", json!({ "name": "Agent Project" }))?;
    if let Some(id) = new_doc.get("id").and_then(|id| id.as_str()) {
        return Ok(id.to_string());
    }
    Err("Failed to automatically create an active CAD document.".into())
}

fn resolve_entity_id(bridge: &Bridge, doc_id: &str, id_or_name: &str) -> String {
    let is_uuid = id_or_name.len() == 36
        && id_or_name
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-');
    if is_uuid {
        return id_or_name.to_string();
    }
    if let Ok(envelope) = bridge.call("get_scene", json!({ "document_id": doc_id })) {
        let scene = envelope.get("scene").unwrap_or(&envelope);
        if let Some(entities) = scene.get("entities").and_then(|e| e.as_array()) {
            for entity in entities {
                if let (Some(id), Some(name)) = (
                    entity.get("id").and_then(|v| v.as_str()),
                    entity.get("name").and_then(|v| v.as_str()),
                ) {
                    if name.eq_ignore_ascii_case(id_or_name)
                        || name.replace(' ', "_").eq_ignore_ascii_case(id_or_name)
                        || name.replace('-', "_").eq_ignore_ascii_case(id_or_name)
                    {
                        return id.to_string();
                    }
                }
            }
        }
    }
    id_or_name.to_string()
}

// ============================================================================
// Math & Transformation Helpers
// ============================================================================

fn parse_vec3(val: Option<&Value>, default: [f64; 3]) -> [f64; 3] {
    let Some(arr) = val.and_then(|v| v.as_array()) else {
        return default;
    };
    if arr.len() < 3 {
        return default;
    }
    [
        arr[0].as_f64().unwrap_or(default[0]),
        arr[1].as_f64().unwrap_or(default[1]),
        arr[2].as_f64().unwrap_or(default[2]),
    ]
}

/// Parses rotation given either as [pitch, yaw, roll] degrees or [x, y, z, w] quaternion.
fn parse_rotation_degrees_to_quat(val: Option<&Value>) -> [f64; 4] {
    let identity = [0.0, 0.0, 0.0, 1.0];
    let Some(arr) = val.and_then(|v| v.as_array()) else {
        return identity;
    };
    if arr.len() == 4 {
        return [
            arr[0].as_f64().unwrap_or(0.0),
            arr[1].as_f64().unwrap_or(0.0),
            arr[2].as_f64().unwrap_or(0.0),
            arr[3].as_f64().unwrap_or(1.0),
        ];
    }
    if arr.len() == 3 {
        let deg_to_rad = std::f64::consts::PI / 180.0;
        let rx = arr[0].as_f64().unwrap_or(0.0) * deg_to_rad * 0.5;
        let ry = arr[1].as_f64().unwrap_or(0.0) * deg_to_rad * 0.5;
        let rz = arr[2].as_f64().unwrap_or(0.0) * deg_to_rad * 0.5;

        let cx = rx.cos();
        let sx = rx.sin();
        let cy = ry.cos();
        let sy = ry.sin();
        let cz = rz.cos();
        let sz = rz.sin();

        let qw = cx * cy * cz - sx * sy * sz;
        let qx = sx * cy * cz + cx * sy * sz;
        let qy = cx * sy * cz - sx * cy * sz;
        let qz = cx * cy * sz + sx * sy * cz;
        return [qx, qy, qz, qw];
    }
    identity
}

/// Parses color from "#hex", [r,g,b], or [r,g,b,a] into normalized [f64; 4] (0.0 to 1.0).
fn parse_color(val: Option<&Value>) -> Option<[f64; 4]> {
    let val = val?;
    if let Some(s) = val.as_str() {
        let s = s.trim();
        match s.to_lowercase().as_str() {
            "red" => return Some([0.94, 0.27, 0.27, 1.0]),
            "green" => return Some([0.13, 0.77, 0.37, 1.0]),
            "blue" => return Some([0.23, 0.51, 0.96, 1.0]),
            "cyan" => return Some([0.02, 0.71, 0.83, 1.0]),
            "yellow" | "amber" => return Some([0.96, 0.62, 0.04, 1.0]),
            "orange" => return Some([0.98, 0.45, 0.09, 1.0]),
            "purple" => return Some([0.66, 0.33, 0.98, 1.0]),
            "white" => return Some([0.98, 0.98, 0.98, 1.0]),
            "black" => return Some([0.08, 0.08, 0.08, 1.0]),
            "gray" | "grey" => return Some([0.55, 0.58, 0.63, 1.0]),
            "steel" => return Some([0.45, 0.50, 0.58, 1.0]),
            _ => {}
        }
        let hex = s.strip_prefix('#').unwrap_or(s);
        if hex.len() == 6 || hex.len() == 8 {
            if let Ok(num) = u64::from_str_radix(hex, 16) {
                if hex.len() == 6 {
                    let r = ((num >> 16) & 0xFF) as f64 / 255.0;
                    let g = ((num >> 8) & 0xFF) as f64 / 255.0;
                    let b = (num & 0xFF) as f64 / 255.0;
                    return Some([r, g, b, 1.0]);
                } else {
                    let r = ((num >> 24) & 0xFF) as f64 / 255.0;
                    let g = ((num >> 16) & 0xFF) as f64 / 255.0;
                    let b = ((num >> 8) & 0xFF) as f64 / 255.0;
                    let a = (num & 0xFF) as f64 / 255.0;
                    return Some([r, g, b, a]);
                }
            }
        }
    } else if let Some(arr) = val.as_array() {
        if arr.len() >= 3 {
            let mut c = [0.0; 4];
            c[3] = 1.0;
            for i in 0..arr.len().min(4) {
                let mut v = arr[i].as_f64().unwrap_or(0.0);
                if v > 1.0 {
                    v /= 255.0;
                }
                c[i] = v.clamp(0.0, 1.0);
            }
            return Some(c);
        }
    }
    None
}

// ============================================================================
// Entity Creation & Setup Helper
// ============================================================================

fn apply_entity_styling(
    bridge: &Bridge,
    doc_id: &str,
    entity_id: &str,
    args: &Value,
) -> Result<(), String> {
    let pos = parse_vec3(args.get("position"), [0.0, 0.0, 0.0]);
    let rot = parse_rotation_degrees_to_quat(args.get("rotation"));
    let scale = parse_vec3(args.get("scale"), [1.0, 1.0, 1.0]);

    let needs_transform = pos != [0.0, 0.0, 0.0]
        || rot != [0.0, 0.0, 0.0, 1.0]
        || scale != [1.0, 1.0, 1.0];

    if needs_transform {
        bridge.call(
            "set_transform",
            json!({
                "document_id": doc_id,
                "updates": [{
                    "id": entity_id,
                    "transform": {
                        "position": pos,
                        "rotation": rot,
                        "scale": scale
                    }
                }],
                "record": false
            }),
        )?;
    }

    if let Some(color) = parse_color(args.get("color")) {
        bridge.call(
            "set_entity_props",
            json!({
                "document_id": doc_id,
                "entity_id": entity_id,
                "props": { "color": color }
            }),
        )?;
    }

    Ok(())
}

fn create_solid(
    bridge: &Bridge,
    args: &Value,
    geom: Value,
    default_name: &str,
) -> Result<Value, String> {
    let doc_id = resolve_or_create_doc(bridge, args)?;
    let name = args
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or(default_name);

    let res = bridge.call(
        "create_entity",
        json!({
            "document_id": doc_id,
            "geometry": geom,
            "name": name,
        }),
    )?;

    let entity_id = res
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or("Entity creation returned no ID")?
        .to_string();

    apply_entity_styling(bridge, &doc_id, &entity_id, args)?;

    Ok(json!({
        "status": "success",
        "entity_id": entity_id,
        "name": name,
        "document_id": doc_id
    }))
}

// ============================================================================
// Tool Execution Dispatch
// ============================================================================

fn execute_tool(
    bridge: &Bridge,
    name: &str,
    args: &Value,
    aliases: &mut HashMap<String, String>,
) -> Result<Value, String> {
    // Resolve alias references in string arguments (e.g., "$box" -> entity_id)
    let mut resolved_args = args.clone();
    if let Some(obj) = resolved_args.as_object_mut() {
        for (_, val) in obj.iter_mut() {
            if let Some(s) = val.as_str() {
                if let Some(alias) = s.strip_prefix('$') {
                    if let Some(real_id) = aliases.get(alias) {
                        *val = json!(real_id);
                    }
                }
            } else if let Some(arr) = val.as_array_mut() {
                for item in arr.iter_mut() {
                    if let Some(s) = item.as_str() {
                        if let Some(alias) = s.strip_prefix('$') {
                            if let Some(real_id) = aliases.get(alias) {
                                *item = json!(real_id);
                            }
                        }
                    }
                }
            }
        }
    }
    let args = &resolved_args;
    let tool_name = name.strip_prefix("arc_").unwrap_or(name);

    match tool_name {
        // --- 3D Primitives ---
        "box" | "create_box" => {
            let width = args.get("width").and_then(|v| v.as_f64()).ok_or("missing 'width'")?;
            let height = args.get("height").and_then(|v| v.as_f64()).ok_or("missing 'height'")?;
            let depth = args.get("depth").and_then(|v| v.as_f64()).ok_or("missing 'depth'")?;
            let corner_radius = args.get("corner_radius").and_then(|v| v.as_f64()).unwrap_or(0.0);
            let geom = json!({
                "type": "box",
                "width": width,
                "height": height,
                "depth": depth,
                "corner_radius": corner_radius,
            });
            create_solid(bridge, args, geom, "Box")
        }
        "cylinder" | "create_cylinder" => {
            let radius = args.get("radius").and_then(|v| v.as_f64()).ok_or("missing 'radius'")?;
            let height = args.get("height").and_then(|v| v.as_f64()).ok_or("missing 'height'")?;
            let segments = args.get("segments").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
            let geom = json!({
                "type": "cylinder",
                "radius": radius,
                "height": height,
                "segments": segments,
            });
            create_solid(bridge, args, geom, "Cylinder")
        }
        "sphere" | "create_sphere" => {
            let radius = args.get("radius").and_then(|v| v.as_f64()).ok_or("missing 'radius'")?;
            let segments = args.get("segments").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
            let geom = json!({
                "type": "sphere",
                "radius": radius,
                "segments": segments,
            });
            create_solid(bridge, args, geom, "Sphere")
        }
        "cone" | "create_cone" => {
            let radius = args.get("radius").and_then(|v| v.as_f64()).ok_or("missing 'radius'")?;
            let height = args.get("height").and_then(|v| v.as_f64()).ok_or("missing 'height'")?;
            let segments = args.get("segments").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
            let geom = json!({
                "type": "cone",
                "radius": radius,
                "height": height,
                "segments": segments,
            });
            create_solid(bridge, args, geom, "Cone")
        }
        "torus" | "create_torus" => {
            let radius = args.get("radius").and_then(|v| v.as_f64()).ok_or("missing 'radius'")?;
            let tube = args.get("tube").and_then(|v| v.as_f64()).ok_or("missing 'tube'")?;
            let segments = args.get("segments").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
            let tubular_segments = args.get("tubular_segments").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
            let geom = json!({
                "type": "torus",
                "radius": radius,
                "tube": tube,
                "segments": segments,
                "tubular_segments": tubular_segments,
            });
            create_solid(bridge, args, geom, "Torus")
        }
        "plane" | "create_plane" => {
            let width = args.get("width").and_then(|v| v.as_f64()).ok_or("missing 'width'")?;
            let depth = args.get("depth").and_then(|v| v.as_f64()).ok_or("missing 'depth'")?;
            let geom = json!({
                "type": "plane",
                "width": width,
                "depth": depth,
            });
            create_solid(bridge, args, geom, "Plane")
        }

        // --- Custom Profiles, Sweeps & Extrusions ---
        "extrude" | "create_extrude" => {
            let polygon = args.get("polygon").cloned().ok_or("missing 'polygon' [[x, y], ...]")?;
            let height = args.get("height").and_then(|v| v.as_f64()).ok_or("missing 'height'")?;
            let geom = json!({
                "type": "extrude",
                "polygon": polygon,
                "height": height,
            });
            create_solid(bridge, args, geom, "Extrusion")
        }
        "revolve" | "create_revolve" => {
            let profile = args.get("profile").cloned().ok_or("missing 'profile' [[x, z], ...]")?;
            let steps = args.get("steps").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
            let angle_deg = args.get("angle_deg").and_then(|v| v.as_f64()).unwrap_or(360.0);
            let geom = json!({
                "type": "revolve",
                "profile": profile,
                "steps": steps,
                "angle_deg": angle_deg,
            });
            create_solid(bridge, args, geom, "Revolve")
        }
        "sweep" | "create_sweep" => {
            let path = args.get("path").cloned().ok_or("missing 'path' [[x, y, z], ...]")?;
            let radius = args.get("radius").and_then(|v| v.as_f64()).ok_or("missing 'radius'")?;
            let sides = args.get("sides").and_then(|v| v.as_u64()).unwrap_or(16) as u32;
            let geom = json!({
                "type": "sweep",
                "path": path,
                "radius": radius,
                "sides": sides,
            });
            create_solid(bridge, args, geom, "Sweep")
        }
        "loft" | "create_loft" => {
            let sections = args.get("sections").cloned().ok_or("missing 'sections'")?;
            let geom = json!({
                "type": "loft",
                "sections": sections,
            });
            create_solid(bridge, args, geom, "Loft")
        }

        // --- Architectural Solids ---
        "wall" | "create_wall" => {
            let path = args.get("path").cloned().ok_or("missing 'path' [[x, y], ...]")?;
            let width = args.get("width").and_then(|v| v.as_f64()).ok_or("missing 'width'")?;
            let height = args.get("height").and_then(|v| v.as_f64()).ok_or("missing 'height'")?;
            let geom = json!({
                "type": "wall",
                "path": path,
                "width": width,
                "height": height,
            });
            create_solid(bridge, args, geom, "Wall")
        }
        "stair" | "create_stair" => {
            let width = args.get("width").and_then(|v| v.as_f64()).ok_or("missing 'width'")?;
            let rise = args.get("rise").and_then(|v| v.as_f64()).ok_or("missing 'rise'")?;
            let run = args.get("run").and_then(|v| v.as_f64()).ok_or("missing 'run'")?;
            let count = args.get("count").and_then(|v| v.as_u64()).ok_or("missing 'count'")? as u32;
            let geom = json!({
                "type": "stair",
                "width": width,
                "rise": rise,
                "run": run,
                "count": count,
            });
            create_solid(bridge, args, geom, "Stair")
        }
        "slab" | "create_slab" => {
            let polygon = args.get("polygon").cloned().ok_or("missing 'polygon' [[x, z], ...]")?;
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(20.0);
            let geom = json!({
                "type": "slab",
                "polygon": polygon,
                "height": height,
            });
            create_solid(bridge, args, geom, "Slab")
        }
        "roof" | "create_roof" => {
            let width = args.get("width").and_then(|v| v.as_f64()).ok_or("missing 'width'")?;
            let depth = args.get("depth").and_then(|v| v.as_f64()).ok_or("missing 'depth'")?;
            let pitch_deg = args.get("pitch_deg").and_then(|v| v.as_f64()).unwrap_or(30.0);
            let overhang = args.get("overhang").and_then(|v| v.as_f64()).unwrap_or(30.0);
            let geom = json!({
                "type": "roof",
                "width": width,
                "depth": depth,
                "pitch_deg": pitch_deg,
                "overhang": overhang,
            });
            create_solid(bridge, args, geom, "Roof")
        }
        "door" | "create_door" => {
            let width = args.get("width").and_then(|v| v.as_f64()).unwrap_or(90.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(210.0);
            let depth = args.get("depth").and_then(|v| v.as_f64()).unwrap_or(15.0);
            let swing_deg = args.get("swing_deg").and_then(|v| v.as_f64()).unwrap_or(90.0);
            let geom = json!({
                "type": "door",
                "width": width,
                "height": height,
                "depth": depth,
                "swing_deg": swing_deg,
            });
            create_solid(bridge, args, geom, "Door")
        }
        "window" | "create_window" => {
            let width = args.get("width").and_then(|v| v.as_f64()).unwrap_or(120.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(150.0);
            let depth = args.get("depth").and_then(|v| v.as_f64()).unwrap_or(15.0);
            let panes_x = args.get("panes_x").and_then(|v| v.as_u64()).unwrap_or(2) as u32;
            let panes_y = args.get("panes_y").and_then(|v| v.as_u64()).unwrap_or(2) as u32;
            let geom = json!({
                "type": "window",
                "width": width,
                "height": height,
                "depth": depth,
                "panes_x": panes_x,
                "panes_y": panes_y,
            });
            create_solid(bridge, args, geom, "Window")
        }
        "column" | "create_column" => {
            let radius = args.get("radius").and_then(|v| v.as_f64()).unwrap_or(20.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(300.0);
            let sides = args.get("sides").and_then(|v| v.as_u64()).unwrap_or(4) as u32;
            let geom = json!({
                "type": "column",
                "radius": radius,
                "height": height,
                "sides": sides,
            });
            create_solid(bridge, args, geom, "Column")
        }
        "beam" | "create_beam" => {
            let length = args.get("length").and_then(|v| v.as_f64()).ok_or("missing 'length'")?;
            let width = args.get("width").and_then(|v| v.as_f64()).unwrap_or(20.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(40.0);
            let geom = json!({
                "type": "beam",
                "length": length,
                "width": width,
                "height": height,
            });
            create_solid(bridge, args, geom, "Beam")
        }
        "room" | "create_room" => {
            let polygon = args.get("polygon").cloned().ok_or("missing 'polygon' [[x, z], ...]")?;
            let room_name = args.get("name").and_then(|v| v.as_str()).unwrap_or("Room").to_string();
            let room_number = args.get("number").and_then(|v| v.as_str()).unwrap_or("101").to_string();
            let geom = json!({
                "type": "room",
                "name": room_name,
                "number": room_number,
                "polygon": polygon,
            });
            create_solid(bridge, args, geom, "Room")
        }
        "component" | "create_component" => {
            let comp_type = args.get("component_type").and_then(|v| v.as_str()).unwrap_or("sofa");
            let width = args.get("width").and_then(|v| v.as_f64()).unwrap_or(200.0);
            let depth = args.get("depth").and_then(|v| v.as_f64()).unwrap_or(90.0);
            let height = args.get("height").and_then(|v| v.as_f64()).unwrap_or(80.0);
            let geom = json!({
                "type": "component",
                "component_type": comp_type,
                "width": width,
                "depth": depth,
                "height": height,
            });
            create_solid(bridge, args, geom, "Component")
        }
        "set_project_mode" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("architecture");
            bridge.call("set_project_mode", json!({ "document_id": doc_id, "mode": mode }))
        }
        "schedule" | "get_building_schedule" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            bridge.call("get_building_schedule", json!({ "document_id": doc_id }))
        }

        // --- Wireframe Curves & Sketches ---
        "sketch" | "create_sketch" => {
            let geom = if let Some(lines) = args.get("polyline") {
                json!({ "type": "polyline_curve", "points": lines })
            } else if let Some(circle) = args.get("circle") {
                let r = circle.get("radius").and_then(|v| v.as_f64()).unwrap_or(10.0);
                let segs = circle.get("segments").and_then(|v| v.as_u64()).unwrap_or(32) as u32;
                json!({ "type": "circle_curve", "radius": r, "segments": segs })
            } else if let Some(rect) = args.get("rectangle") {
                let w = rect.get("width").and_then(|v| v.as_f64()).unwrap_or(20.0);
                let d = rect.get("depth").and_then(|v| v.as_f64()).unwrap_or(20.0);
                json!({ "type": "rectangle_curve", "width": w, "depth": d })
            } else if let Some(end) = args.get("line") {
                json!({ "type": "line_curve", "end": end })
            } else {
                return Err("Specify 'polyline', 'circle', 'rectangle', or 'line'".into());
            };
            create_solid(bridge, args, geom, "Sketch")
        }

        // --- CSG Booleans ---
        "boolean" | "csg" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let op = args.get("operation").and_then(|v| v.as_str()).ok_or("missing 'operation' (union, difference, intersection)")?;
            let raw_first = args.get("first_id").and_then(|v| v.as_str()).ok_or("missing 'first_id'")?;
            let raw_second = args.get("second_id").and_then(|v| v.as_str()).ok_or("missing 'second_id'")?;
            let first_id = resolve_entity_id(bridge, &doc_id, raw_first);
            let second_id = resolve_entity_id(bridge, &doc_id, raw_second);

            let res = bridge.call(
                "csg_apply",
                json!({
                    "document_id": doc_id,
                    "operation": op,
                    "first_id": first_id,
                    "second_id": second_id,
                }),
            )?;

            Ok(json!({
                "status": "success",
                "operation": op,
                "result": res,
                "document_id": doc_id
            }))
        }

        // --- Entity Transforms & Modifications ---
        "transform" | "set_transform" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let raw_id = args.get("entity_id").and_then(|v| v.as_str()).ok_or("missing 'entity_id'")?;
            let entity_id = resolve_entity_id(bridge, &doc_id, raw_id);

            let pos = parse_vec3(args.get("position"), [0.0, 0.0, 0.0]);
            let rot = parse_rotation_degrees_to_quat(args.get("rotation"));
            let scale = parse_vec3(args.get("scale"), [1.0, 1.0, 1.0]);

            bridge.call(
                "set_transform",
                json!({
                    "document_id": doc_id,
                    "updates": [{
                        "id": entity_id,
                        "transform": {
                            "position": pos,
                            "rotation": rot,
                            "scale": scale
                        }
                    }],
                    "record": true
                }),
            )?;

            Ok(json!({ "status": "success", "entity_id": entity_id }))
        }

        "set_color" | "color" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let raw_id = args.get("entity_id").and_then(|v| v.as_str()).ok_or("missing 'entity_id'")?;
            let entity_id = resolve_entity_id(bridge, &doc_id, raw_id);
            let color = parse_color(args.get("color")).ok_or("invalid or missing 'color'")?;

            bridge.call(
                "set_entity_props",
                json!({
                    "document_id": doc_id,
                    "entity_id": entity_id,
                    "props": { "color": color }
                }),
            )?;

            Ok(json!({ "status": "success", "entity_id": entity_id, "color": color }))
        }

        "delete" | "delete_entities" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let ids: Vec<Value> = args
                .get("entity_ids")
                .and_then(|v| v.as_array())
                .cloned()
                .ok_or("missing array 'entity_ids'")?
                .into_iter()
                .map(|val| {
                    if let Some(s) = val.as_str() {
                        json!(resolve_entity_id(bridge, &doc_id, s))
                    } else {
                        val
                    }
                })
                .collect();
            bridge.call("delete_entities", json!({ "document_id": doc_id, "entity_ids": ids }))?;
            Ok(json!({ "status": "success", "deleted": ids }))
        }

        "duplicate" | "duplicate_entities" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let ids = args
                .get("entity_ids")
                .and_then(|v| v.as_array())
                .cloned()
                .ok_or("missing array 'entity_ids'")?;
            let res = bridge.call("duplicate_entities", json!({ "document_id": doc_id, "entity_ids": ids }))?;
            Ok(json!({ "status": "success", "duplicated": res }))
        }

        // --- Scene Inspection & Cleanup ---
        "inspect_scene" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let envelope = bridge.call("get_scene", json!({ "document_id": doc_id }))?;
            let scene = envelope.get("scene").unwrap_or(&envelope);
            let name = scene.get("name").and_then(|v| v.as_str()).unwrap_or("Untitled");
            let units = scene.get("units").and_then(|v| v.as_str()).unwrap_or("cm");

            let mut summary = Vec::new();
            if let Some(entities) = scene.get("entities").and_then(|e| e.as_array()) {
                for e in entities {
                    let id = e.get("id").and_then(|v| v.as_str()).unwrap_or("");
                    let ent_name = e.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let kind = e.get("kind").and_then(|v| v.as_str()).unwrap_or("solid");
                    let pos = e
                        .get("transform")
                        .and_then(|t| t.get("position"))
                        .cloned()
                        .unwrap_or(json!([0, 0, 0]));
                    let visible = e.get("visible").and_then(|v| v.as_bool()).unwrap_or(true);
                    let color = e.get("color").cloned().unwrap_or(json!(null));

                    summary.push(json!({
                        "id": id,
                        "name": ent_name,
                        "kind": kind,
                        "position": pos,
                        "visible": visible,
                        "color": color
                    }));
                }
            }

            Ok(json!({
                "document_id": doc_id,
                "document_name": name,
                "units": units,
                "entity_count": summary.len(),
                "entities": summary
            }))
        }

        "clear_scene" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let envelope = bridge.call("get_scene", json!({ "document_id": doc_id }))?;
            let scene = envelope.get("scene").unwrap_or(&envelope);
            let mut ids = Vec::new();
            if let Some(entities) = scene.get("entities").and_then(|e| e.as_array()) {
                for e in entities {
                    if let Some(id) = e.get("id").and_then(|v| v.as_str()) {
                        ids.push(id.to_string());
                    }
                }
            }
            if !ids.is_empty() {
                bridge.call("delete_entities", json!({ "document_id": doc_id, "entity_ids": ids }))?;
            }
            Ok(json!({ "status": "success", "cleared_entities": ids.len() }))
        }

        "get_scene" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            bridge.call("get_scene", json!({ "document_id": doc_id }))
        }

        "export" | "export_scene" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            let path = args.get("path").and_then(|v| v.as_str()).ok_or("missing 'path'")?;
            let format = args.get("format").and_then(|v| v.as_str()).unwrap_or("obj");
            bridge.call("export_scene", json!({ "document_id": doc_id, "path": path, "format": format }))
        }

        "new_document" => {
            let name = args.get("name").and_then(|v| v.as_str());
            bridge.call("new_document", json!({ "name": name }))
        }

        "undo" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            bridge.call("undo", json!({ "document_id": doc_id }))
        }

        "redo" => {
            let doc_id = resolve_or_create_doc(bridge, args)?;
            bridge.call("redo", json!({ "document_id": doc_id }))
        }

        // --- Batch Execution ---
        "batch" => {
            let ops = args
                .get("operations")
                .and_then(|v| v.as_array())
                .ok_or("missing array 'operations'")?;

            let mut results = Vec::new();
            for (idx, op) in ops.iter().enumerate() {
                let op_tool = op
                    .get("tool")
                    .and_then(|v| v.as_str())
                    .ok_or(format!("operation #{idx} missing 'tool'"))?;
                let op_args = op.get("args").cloned().unwrap_or(json!({}));
                let res = execute_tool(bridge, op_tool, &op_args, aliases)?;

                if let Some(alias) = op.get("alias").and_then(|v| v.as_str()) {
                    if let Some(id) = res.get("entity_id").and_then(|v| v.as_str()) {
                        aliases.insert(alias.to_string(), id.to_string());
                    }
                }
                results.push(json!({ "step": idx, "tool": op_tool, "result": res }));
            }
            Ok(json!({ "status": "success", "executed_operations": results.len(), "results": results }))
        }

        other => Err(format!("Unknown tool '{other}'. Check tools/list for available CAD operations.")),
    }
}

// ============================================================================
// Tool Catalog Schema Definition
// ============================================================================

fn make_tool_def(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    let req: Vec<Value> = required.iter().map(|s| json!(s)).collect();
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": req,
        }
    })
}

fn tool_catalog() -> Vec<Value> {
    let doc_id_prop = json!({
        "type": "string",
        "description": "Target document ID. Optional; if omitted, automatically uses the active document or creates one."
    });
    let pos_prop = json!({
        "type": "array",
        "items": { "type": "number" },
        "description": "3D translation [x, y, z] in world units (default [0, 0, 0])."
    });
    let rot_prop = json!({
        "type": "array",
        "items": { "type": "number" },
        "description": "Euler angles [pitch, yaw, roll] in degrees (or quaternion [x, y, z, w]). Default [0, 0, 0]."
    });
    let scale_prop = json!({
        "type": "array",
        "items": { "type": "number" },
        "description": "Scale factors [sx, sy, sz] (default [1, 1, 1])."
    });
    let color_prop = json!({
        "type": "string",
        "description": "Hex color string (e.g. '#3b82f6'), color name ('red', 'blue', 'steel', etc.), or RGBA array."
    });
    let name_prop = json!({
        "type": "string",
        "description": "Descriptive name for the entity in the CAD tree (e.g. 'bracket_flange')."
    });

    vec![
        make_tool_def(
            "arc_create_box",
            "Create a 3D solid box with width (X), height (Y), and depth (Z).",
            json!({
                "width": { "type": "number", "description": "Size along X axis" },
                "height": { "type": "number", "description": "Size along Y axis" },
                "depth": { "type": "number", "description": "Size along Z axis" },
                "corner_radius": { "type": "number", "description": "Optional corner bevel radius" },
                "position": pos_prop,
                "rotation": rot_prop,
                "scale": scale_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["width", "height", "depth"],
        ),
        make_tool_def(
            "arc_create_cylinder",
            "Create a 3D solid cylinder aligned with the Y axis.",
            json!({
                "radius": { "type": "number", "description": "Radius of the cylinder" },
                "height": { "type": "number", "description": "Height along Y axis" },
                "segments": { "type": "integer", "description": "Radial tessellation divisions (default 32)" },
                "position": pos_prop,
                "rotation": rot_prop,
                "scale": scale_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["radius", "height"],
        ),
        make_tool_def(
            "arc_create_sphere",
            "Create a 3D solid UV sphere.",
            json!({
                "radius": { "type": "number", "description": "Radius of the sphere" },
                "segments": { "type": "integer", "description": "Tessellation divisions (default 32)" },
                "position": pos_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["radius"],
        ),
        make_tool_def(
            "arc_create_cone",
            "Create a 3D solid cone tapering to an apex along +Y.",
            json!({
                "radius": { "type": "number", "description": "Base radius" },
                "height": { "type": "number", "description": "Height along Y" },
                "segments": { "type": "integer", "description": "Radial divisions (default 32)" },
                "position": pos_prop,
                "rotation": rot_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["radius", "height"],
        ),
        make_tool_def(
            "arc_create_torus",
            "Create a 3D solid donut/torus in the XZ plane.",
            json!({
                "radius": { "type": "number", "description": "Major radius from center to tube center" },
                "tube": { "type": "number", "description": "Cross-section tube radius" },
                "position": pos_prop,
                "rotation": rot_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["radius", "tube"],
        ),
        make_tool_def(
            "arc_create_plane",
            "Create a rectangular 2D planar surface in the XZ plane.",
            json!({
                "width": { "type": "number", "description": "Width along X" },
                "depth": { "type": "number", "description": "Depth along Z" },
                "position": pos_prop,
                "rotation": rot_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["width", "depth"],
        ),
        make_tool_def(
            "arc_create_extrude",
            "Extrude a closed 2D polygon vertically along Y into a 3D solid. Perfect for custom brackets, gears, structural shapes.",
            json!({
                "polygon": {
                    "type": "array",
                    "items": { "type": "array", "items": { "type": "number" } },
                    "description": "List of [x, y] 2D vertex pairs defining the closed profile"
                },
                "height": { "type": "number", "description": "Extrusion depth along Y" },
                "position": pos_prop,
                "rotation": rot_prop,
                "scale": scale_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["polygon", "height"],
        ),
        make_tool_def(
            "arc_create_revolve",
            "Revolve a 2D profile [x, z] around the central Y axis into a solid of revolution (vases, pulleys, bottles, shafts, domes).",
            json!({
                "profile": {
                    "type": "array",
                    "items": { "type": "array", "items": { "type": "number" } },
                    "description": "List of [x, z] points defining the half-cross-section profile"
                },
                "angle_deg": { "type": "number", "description": "Degrees of revolution (default 360 for full body)" },
                "steps": { "type": "integer", "description": "Rotational segments (default 32)" },
                "position": pos_prop,
                "rotation": rot_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["profile"],
        ),
        make_tool_def(
            "arc_create_sweep",
            "Sweep a circular pipe/tube profile along a 3D path polyline.",
            json!({
                "path": {
                    "type": "array",
                    "items": { "type": "array", "items": { "type": "number" } },
                    "description": "List of 3D points [[x, y, z], ...] guiding the sweep spine"
                },
                "radius": { "type": "number", "description": "Pipe outer radius" },
                "sides": { "type": "integer", "description": "Pipe cross-section sides (default 16)" },
                "position": pos_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["path", "radius"],
        ),
        make_tool_def(
            "arc_create_wall",
            "Create an architectural wall along a 2D polyline footprint.",
            json!({
                "path": {
                    "type": "array",
                    "items": { "type": "array", "items": { "type": "number" } },
                    "description": "List of [x, y] coordinates for the wall centerline"
                },
                "width": { "type": "number", "description": "Thickness of the wall" },
                "height": { "type": "number", "description": "Height of the wall" },
                "position": pos_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["path", "width", "height"],
        ),
        make_tool_def(
            "arc_create_stair",
            "Create a parametric 3D staircase with defined step count, rise, and run.",
            json!({
                "width": { "type": "number", "description": "Width of each step" },
                "rise": { "type": "number", "description": "Height of each individual step" },
                "run": { "type": "number", "description": "Depth of each individual step" },
                "count": { "type": "integer", "description": "Total number of steps" },
                "position": pos_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &["width", "rise", "run", "count"],
        ),
        make_tool_def(
            "arc_create_sketch",
            "Create a 2D or 3D wireframe sketch curve (polyline, circle, rectangle, or line).",
            json!({
                "polyline": {
                    "type": "array",
                    "items": { "type": "array", "items": { "type": "number" } },
                    "description": "Points [[x, y, z], ...] for a connected polyline"
                },
                "circle": {
                    "type": "object",
                    "properties": {
                        "radius": { "type": "number" },
                        "segments": { "type": "integer" }
                    },
                    "description": "Circle curve in XZ plane"
                },
                "rectangle": {
                    "type": "object",
                    "properties": {
                        "width": { "type": "number" },
                        "depth": { "type": "number" }
                    },
                    "description": "Rectangle wireframe in XZ plane"
                },
                "position": pos_prop,
                "color": color_prop,
                "name": name_prop,
                "document_id": doc_id_prop
            }),
            &[],
        ),
        make_tool_def(
            "arc_boolean",
            "Perform CSG constructive solid geometry operations: 'union' (merge solids), 'difference' (cut holes/subtract second from first), or 'intersection'.",
            json!({
                "operation": {
                    "type": "string",
                    "enum": ["union", "difference", "intersection"],
                    "description": "CSG operation to apply"
                },
                "first_id": { "type": "string", "description": "Base entity ID" },
                "second_id": { "type": "string", "description": "Tool/cutter entity ID to boolean with first" },
                "document_id": doc_id_prop
            }),
            &["operation", "first_id", "second_id"],
        ),
        make_tool_def(
            "arc_transform",
            "Move, rotate, or scale an existing CAD entity.",
            json!({
                "entity_id": { "type": "string", "description": "Target entity ID" },
                "position": pos_prop,
                "rotation": rot_prop,
                "scale": scale_prop,
                "document_id": doc_id_prop
            }),
            &["entity_id"],
        ),
        make_tool_def(
            "arc_set_color",
            "Set the display color of an entity (e.g. '#3b82f6', 'red', 'steel', or [r, g, b, a]).",
            json!({
                "entity_id": { "type": "string", "description": "Target entity ID" },
                "color": color_prop,
                "document_id": doc_id_prop
            }),
            &["entity_id", "color"],
        ),
        make_tool_def(
            "arc_delete",
            "Delete one or more entities from the scene.",
            json!({
                "entity_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "List of entity IDs to delete"
                },
                "document_id": doc_id_prop
            }),
            &["entity_ids"],
        ),
        make_tool_def(
            "arc_inspect_scene",
            "Get a clean, context-friendly summary of all entities in the active CAD document (IDs, names, types, positions, colors).",
            json!({ "document_id": doc_id_prop }),
            &[],
        ),
        make_tool_def(
            "arc_clear_scene",
            "Delete all entities from the active document to start fresh with an empty scene.",
            json!({ "document_id": doc_id_prop }),
            &[],
        ),
        make_tool_def(
            "arc_export",
            "Export the current 3D CAD scene to STL, OBJ, or STEP file.",
            json!({
                "path": { "type": "string", "description": "Destination file path" },
                "format": { "type": "string", "enum": ["stl", "obj", "step"], "description": "Export format (default 'obj')" },
                "document_id": doc_id_prop
            }),
            &["path"],
        ),
        make_tool_def(
            "arc_batch",
            "Execute a sequence of CAD operations atomically in a single turn. Operations can define aliases ('alias': 'base') and subsequent operations can reference them as '$base'.",
            json!({
                "operations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "tool": { "type": "string", "description": "Tool name (e.g. 'create_box', 'create_cylinder', 'boolean')" },
                            "args": { "type": "object", "description": "Arguments for the tool" },
                            "alias": { "type": "string", "description": "Optional variable name to bind to the resulting entity ID" }
                        },
                        "required": ["tool", "args"]
                    },
                    "description": "List of operations to execute in order"
                },
                "document_id": doc_id_prop
            }),
            &["operations"],
        ),
    ]
}

// ============================================================================
// MCP JSON-RPC 2.0 Stdio Loop
// ============================================================================

fn respond(stdout: &mut io::Stdout, id: Value, result: Value) {
    let resp = json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result
    });
    let mut s = serde_json::to_string(&resp).unwrap_or_default();
    s.push('\n');
    let _ = stdout.write_all(s.as_bytes());
    let _ = stdout.flush();
}

fn respond_error(stdout: &mut io::Stdout, id: Value, code: i64, message: &str) {
    let resp = json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": {
            "code": code,
            "message": message
        }
    });
    let mut s = serde_json::to_string(&resp).unwrap_or_default();
    s.push('\n');
    let _ = stdout.write_all(s.as_bytes());
    let _ = stdout.flush();
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let msg: Value = match serde_json::from_str(trimmed) {
            Ok(m) => m,
            Err(_) => {
                respond_error(&mut stdout, json!(null), -32700, "Parse error");
                continue;
            }
        };

        let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
        let id = msg.get("id").cloned().unwrap_or(json!(null));
        let params = msg.get("params").cloned().unwrap_or(json!({}));

        match method {
            "initialize" => {
                respond(
                    &mut stdout,
                    id,
                    json!({
                        "protocolVersion": PROTOCOL_VERSION,
                        "capabilities": {
                            "tools": {},
                            "resources": {},
                            "prompts": {}
                        },
                        "serverInfo": {
                            "name": SERVER_NAME,
                            "version": SERVER_VERSION
                        }
                    }),
                );
            }
            "notifications/initialized" => {
                // Notification, no reply expected
            }
            "ping" => {
                respond(&mut stdout, id, json!({}));
            }
            "tools/list" => {
                respond(&mut stdout, id, json!({ "tools": tool_catalog() }));
            }
            "tools/call" => {
                let name = params
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string();
                let args = params.get("arguments").cloned().unwrap_or(json!({}));

                let mut aliases = HashMap::new();
                match Bridge::load().and_then(|bridge| execute_tool(&bridge, &name, &args, &mut aliases)) {
                    Ok(result) => {
                        let text = serde_json::to_string_pretty(&result).unwrap_or_default();
                        respond(
                            &mut stdout,
                            id,
                            json!({
                                "content": [{ "type": "text", "text": text }],
                                "isError": false
                            }),
                        );
                    }
                    Err(error) => {
                        respond(
                            &mut stdout,
                            id,
                            json!({
                                "content": [{ "type": "text", "text": error }],
                                "isError": true
                            }),
                        );
                    }
                }
            }
            "resources/list" => {
                respond(&mut stdout, id, json!({ "resources": [] }));
            }
            "prompts/list" => {
                respond(&mut stdout, id, json!({ "prompts": [] }));
            }
            _ => {
                if !id.is_null() {
                    respond_error(
                        &mut stdout,
                        id,
                        -32601,
                        &format!("Method '{method}' not found"),
                    );
                }
            }
        }
    }
}
