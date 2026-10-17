# arc - Advanced CAD Application

arc is a modern, multi-platform CAD (Computer-Aided Design) application built around a mesh-based geometry kernel written in Rust. It features a Shapr3D-like intuitive interface for general design, architecture, and interior design workflows.

## Features

- **Primitive modeling** - box, sphere, cylinder, cone, torus, and plane primitives with editable parameters
- **Sketch tools** - circle, line, polyline, rectangle, dimension, and wall drawing on the ground plane with grid snapping
- **Solid generation** - extrude, revolve, sweep, and loft profiles into solids
- **Architecture tools** - walls, stairs, slabs, roofs, columns, beams, doors, and windows
- **Layers** - visibility, locking, colors, and per-entity overrides
- **Undo/redo** - full command history with every editing operation
- **Multi-document** - work on several documents at once with live switching
- **Plugin system** - extend functionality with Lua scripts
- **File formats** - native `.arc` (JSON) documents plus OBJ and binary STL export
- **Cross-platform** - native desktop apps for Windows, macOS, and Linux

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Kernel | Rust (`crates/arc-core`) - mesh generation, raycast picking, documents, history |
| Backend | Rust + Tauri 2 |
| Frontend | React 19 + TypeScript 7 + Vite 8 |
| Styling | Tailwind CSS 4 |
| State | Zustand 5 |
| Rendering | three.js (WebGL) |
| Icons | lucide-react |
| Plugins | Lua (mlua) |

## Project Structure

```
arc/
├── Cargo.toml          # Rust workspace configuration
├── crates/
│   └── arc-core/       # Geometry kernel: mesh generation, entity/document model,
│                       #   layers, selection, history, winding, raycast picking
├── src-tauri/          # Tauri application
│   ├── src/            # Commands, app state, plugin runtime
│   ├── plugins/        # Lua plugin directory
│   ├── tauri.conf.json # Tauri app configuration
│   └── icons/          # App icons
└── frontend/
    ├── src/
    │   ├── App.tsx         # Root layout
    │   ├── main.tsx        # Entry point
    │   ├── lib/            # Store, IPC bindings, events, actions, keybinds
    │   ├── data/tools.ts   # Tool definitions and default geometry
    │   └── components/     # Viewport (three.js), panels, dialogs
    ├── vite.config.ts
    └── tsconfig.json
```

## Keybinds

| Keys | Action |
|------|--------|
| `V` / `M` | Select / Move tool |
| `B` `Y` `C` `O` `T` `P` | Box, sphere, cylinder, cone, torus, plane |
| `G` `L` `J` `R` `D` `H` | Circle, line, polyline, rectangle, dimension, wall |
| `Ctrl K` | Command palette |
| `Ctrl Z` / `Ctrl Shift Z` | Undo / redo |
| `Ctrl N` / `Ctrl O` / `Ctrl S` / `Ctrl E` | New, open, save, export |
| `Ctrl A` / `Ctrl D` | Select all / duplicate |
| `Delete` | Delete selection |
| `F` | Fit view to selection |
| `Esc` | Clear selection / cancel close menus |

Navigation: middle-drag orbits, right-drag pans, wheel zooms. Double-click an entity to zoom to it.

## Building

### Prerequisites

- Rust toolchain (rustup)
- Node.js 20+ and npm

### Development

```bash
git clone https://github.com/Remgr12/arc.git
cd arc

# Install frontend dependencies
cd frontend
npm install
cd ..

# Run the app in development mode
cargo tauri dev
```

### Production build

```bash
cargo tauri build
```

For platform matrix builds use `scripts/build.sh`, push a tag for CI (`scripts/release.sh`), or build the Flatpak manifest in `flatpak/`.

## Architecture

### Rust backend

- **`crates/arc-core`** provides the geometry kernel: an entity/document model with layers, selection state, and undoable command history. Geometry is described by typed payloads (serde JSON) and turned into triangle/line buffers (positions + normals) cached per entity. Raycast picking works against the generated meshes and returns hits with distance and normal.
- **`src-tauri`** hosts the Tauri commands (~30 IPC endpoints) that map frontend operations onto the kernel: create/edit/delete/duplicate/explode entities, transforms, selection, layers, undo/redo, document open/save, settings, plugin loading, and OBJ/STL export. State is a shared document map with an active-document pointer; scene updates are pushed to the frontend via the `arc://scene`, `arc://documents`, `arc://settings`, and `arc://plugins` events.

### Frontend

- The **Viewport** component runs a three.js scene synced from the backend scene snapshots. Each entity is an `Object3D` built from its mesh buffer; selection/hover states use emissive highlighting; the move tool drags entities on the ground plane with grid snapping and a single history record per gesture.
- **Panels**: project/documents + entity outline, layers, and a properties editor (name, layer, color, transform, per-type geometry parameters). A `Ctrl K` command palette and settings/plugins dialog round out the chrome.
- State flows one way: backend events update the Zustand store, components re-render, and user actions invoke commands over Tauri IPC.

## Plugin Development

Write a Lua file and drop it in one of the plugin directories (`<app data>/plugins`, `<app dir>/plugins`). Plugins receive the `arc` API and are enabled/disabled per settings.

```lua
-- plugins/hello.lua
arc.on("start", function()
  arc.log("hello from Lua")
end)

arc.on("new", function()
  local id = arc.add_entity({ type = "box", width = 60, depth = 40, height = 20 }, "Plugin box")
  arc.log("created " .. tostring(id))
end)
```

Available hooks: `"start"`, `"new"`, `"open"`, `"save"`.
API: `arc.log(msg)`, `arc.active_document()`, `arc.entities()`, `arc.add_entity(geometry, name?)`, `arc.raycast(...)`, `arc.set_transform(...)`, `arc.undo()`, `arc.redo()`.

## License

Dual-licensed under MIT or Apache-2.0, at your option.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Links

- [Tauri Documentation](https://tauri.app)
- [three.js](https://threejs.org)
- [Shapr3D](https://www.shapr3d.com/) (UI inspiration)
