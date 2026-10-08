# ARC — Advanced CAD Application

ARC is a modern, multi-platform CAD (Computer-Aided Design) application built with the [Truck](https://github.com/gkokkonen/truck) geometric kernel. It features a Shapr3D-like intuitive interface suitable for general design, architecture, and interior design workflows.

## Features

- **Parametric Modeling** — Sketch-based 3D modeling with extrude, revolve, sweep, loft, and boolean operations
- **Architecture Tools** — Walls, doors, windows, stairs, roofs, slabs, columns, beams, rooms, and grids
- **Shaprs3D-inspired UI** — Gesture-based navigation, floating toolbars, and contextual panels
- **Plugin System** — Extend functionality with Lua or WebAssembly plugins
- **Multi-theme** — 8 built-in themes (Dark, Light, High Contrast, Shapr3D, AutoCAD, Blender, Monokai Pro, Solarized)
- **Keybind Presets** — Pre-configured keyboard shortcuts for Shapr3D, AutoCAD, and Blender workflows
- **Cross-platform** — Native desktop apps for Windows, macOS, and Linux

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Kernel | [Truck](https://github.com/gkokkonen/truck) + monstertruck |
| Backend | Rust + Tauri 2.0 |
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS |
| State | Zustand |
| Rendering | WGPU/WebGPU |
| Plugins | Lua (mlua) + WASM (wasmtime) |

## Project Structure

```
arc/
├── Cargo.toml          # Rust workspace configuration
├── tauri.conf.json     # Tauri app configuration
├── crates/
│   ├── arc-core/       # Core types: Entity, Document, Selection, Layers, History
│   ├── arc-geometry/   # Geometry: Curves, Surfaces, Solids, Meshes, Booleans
│   ├── arc-modeling/   # Parametric modeling, features, sketching
│   ├── arc-architecture/ # Architecture tools (walls, doors, stairs, etc.)
│   ├── arc-plugin/     # Plugin system (Lua + WASM)
│   ├── arc-commands/   # Command pattern framework
│   └── arc-app/        # Tauri application binary
└── frontend/
    ├── index.html
    ├── package.json
    ├── src/
    │   ├── App.tsx        # Root component
    │   ├── main.tsx       # Entry point
    │   ├── components/     # UI components
    │   ├── stores/         # Zustand state management
    │   ├── keybinds/       # Keyboard shortcut presets
    │   ├── themes/         # Theme definitions
    │   ├── types/          # TypeScript type definitions
    │   ├── data/           # Tools and commands data
    │   └── hooks/          # Custom React hooks
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tailwind.config.js
    └── postcss.config.js
```

## Building

### Prerequisites

- Rust toolchain (rustup)
- Node.js 18+ and npm

### Build the application

```bash
# Clone the repository
git clone https://github.com/moha-eu/arc.git
cd arc

# Install frontend dependencies
cd frontend
npm install
cd ..

# Build Rust backend and Tauri app
cargo tauri dev
```

For production:

```bash
cargo tauri build
```

## Architecture

### Rust Backend

The Rust crate handles all heavy computation, geometry processing, and file I/O. Communication with the frontend happens through Tauri's IPC layer.

- **arc-core**: Provides the fundamental entity-component architecture, document model, selection system, layers, constraints, and command history with undo/redo support.
- **arc-geometry**: Wraps the Truck kernel for curve/surface/solid operations including boolean operations, tessellation, and file format conversion (STEP, OBJ, STL, glTF, DXF).
- **arc-modeling**: Implements parametric features (extrude, revolve, sweep, loof) and a constraint-based sketch solver.
- **arc-architecture**: Architecture-specific tools including wall systems, door/window placement, stair generation, and room/space analytics.
- **arc-plugin**: Plugin manager supporting both Lua scripts and WASM modules with a unified API.
- **arc-app**: Tauri application entry point, AppState management, IPC command handlers, and renderer integration.

### Frontend

The frontend provides a responsive, themeable UI with real-time viewport interaction.

- **Components** are organized into panels (Project, Properties, Layers), toolbars, and overlay widgets.
- **State management** uses Zustand for a single source of truth across the application.
- **Theming** uses CSS custom properties with 8 built-in theme presets and the ability to create custom themes.
- **Shortcuts** are configurable with 4 built-in keybind presets matching popular CAD workflows.

## Plugin Development

Arc supports two plugin types:

### Lua Plugins

```lua
-- plugins/hello.lua
function on_init()
    arc.log("Hello from Lua plugin!")
end

function on_command(name, args)
    if name == "create_cube" then
        arc.create_entity("cube", { width = 10, height = 10, depth = 10 })
    end
    return { result = "success" }
end
```

### WASM Plugins

```rust
// plugins/my_plugin/src/lib.rs
#[no_mangle]
pub extern "C" fn arc_plugin_init() -> i32 {
    // Register commands, tools, etc.
    0
}
```

## License

Dual-licensed under MIT or Apache-2.0, at your option.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## Links

- [Truck Kernel](https://github.com/gokonko/truck)
- [Tauri Documentation](https://tauri.app)
- [Shapr3D](https://www.shapr3d.com/) (UI inspiration)