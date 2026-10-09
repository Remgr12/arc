import { KeybindPreset, KeyboardShortcut } from '@/types';
import { useAppStore } from '@/stores/appStore';
export const DEFAULT_KEYBINDS: KeyboardShortcut[] = [
  // Navigation
  { id: 'nav-pan', key: 'Space', modifiers: ['alt'], action: 'pan', description: 'Pan View' },
  { id: 'nav-orbit', key: 'Space', modifiers: ['alt', 'shift'], action: 'orbit', description: 'Orbit View' },
  { id: 'nav-zoom', key: 'Space', modifiers: ['alt', 'ctrl'], action: 'zoom', description: 'Zoom View' },
  { id: 'nav-zoom-in', key: '=', modifiers: ['ctrl'], action: 'zoom-in', description: 'Zoom In' },
  { id: 'nav-zoom-out', key: '-', modifiers: ['ctrl'], action: 'zoom-out', description: 'Zoom Out' },
  { id: 'nav-zoom-extents', key: 'F', action: 'zoom-extents', description: 'Zoom Extents' },
  { id: 'nav-zoom-window', key: 'Z', modifiers: ['ctrl'], action: 'zoom-window', description: 'Zoom Window' },
  { id: 'nav-zoom-prev', key: 'Z', modifiers: ['ctrl', 'shift'], action: 'zoom-prev', description: 'Zoom Previous' },
  
  // Selection
  { id: 'select-select', key: 'Q', action: 'select', description: 'Select Tool' },
  { id: 'select-window', key: 'A', modifiers: ['shift'], action: 'window-select', description: 'Window Select' },
  { id: 'select-crossing', key: 'C', modifiers: ['shift'], action: 'crossing-select', description: 'Crossing Select' },
  { id: 'select-all', key: 'A', modifiers: ['ctrl'], action: 'select-all', description: 'Select All' },
  { id: 'select-deselect', key: 'D', modifiers: ['ctrl'], action: 'deselect', description: 'Deselect' },
  { id: 'select-invert', key: 'I', modifiers: ['ctrl'], action: 'invert-selection', description: 'Invert Selection' },
  { id: 'select-lasso', key: 'L', modifiers: ['shift'], action: 'lasso-select', description: 'Lasso Select' },
  { id: 'select-circle', key: 'C', modifiers: ['ctrl'], action: 'circle-select', description: 'Circle Select' },
  
  // Sketching
  { id: 'sketch-line', key: 'L', action: 'sketch-line', description: 'Line' },
  { id: 'sketch-polyline', key: 'P', action: 'sketch-polyline', description: 'Polyline' },
  { id: 'sketch-circle', key: 'C', action: 'sketch-circle', description: 'Circle' },
  { id: 'sketch-arc', key: 'A', action: 'sketch-arc', description: 'Arc' },
  { id: 'sketch-rectangle', key: 'R', action: 'sketch-rectangle', description: 'Rectangle' },
  { id: 'sketch-polygon', key: 'G', action: 'sketch-polygon', description: 'Polygon' },
  { id: 'sketch-spline', key: 'S', action: 'sketch-spline', description: 'Spline' },
  { id: 'sketch-text', key: 'T', action: 'sketch-text', description: 'Text' },
  { id: 'sketch-equation', key: 'E', modifiers: ['shift'], action: 'sketch-equation', description: 'Equation Curve' },
  
  // Modeling
  { id: 'model-extrude', key: 'E', action: 'extrude', description: 'Extrude' },
  { id: 'model-revolve', key: 'V', action: 'revolve', description: 'Revolve' },
  { id: 'model-loft', key: 'L', modifiers: ['ctrl'], action: 'loft', description: 'Loft' },
  { id: 'model-sweep', key: 'S', modifiers: ['ctrl'], action: 'sweep', description: 'Sweep' },
  { id: 'model-fillet', key: 'F', action: 'fillet', description: 'Fillet' },
  { id: 'model-chamfer', key: 'H', action: 'chamfer', description: 'Chamfer' },
  { id: 'model-shell', key: 'S', modifiers: ['alt'], action: 'shell', description: 'Shell' },
  { id: 'model-draft', key: 'D', action: 'draft', description: 'Draft' },
  { id: 'model-hollow', key: 'W', action: 'hollow', description: 'Hollow' },
  
  // Boolean
  { id: 'model-union', key: 'U', modifiers: ['ctrl'], action: 'union', description: 'Union' },
  { id: 'model-difference', key: 'D', modifiers: ['ctrl'], action: 'difference', description: 'Difference' },
  { id: 'model-intersect', key: 'I', modifiers: ['ctrl'], action: 'intersect', description: 'Intersect' },
  { id: 'model-split', key: 'X', modifiers: ['ctrl'], action: 'split', description: 'Split' },
  
  // Modify
  { id: 'modify-move', key: 'M', action: 'move', description: 'Move' },
  { id: 'modify-rotate', key: 'R', modifiers: ['alt'], action: 'rotate', description: 'Rotate' },
  { id: 'modify-scale', key: 'S', action: 'scale', description: 'Scale' },
  { id: 'modify-mirror', key: 'M', modifiers: ['ctrl'], action: 'mirror', description: 'Mirror' },
  { id: 'modify-patterning', key: 'P', action: 'pattern', description: 'Pattern' },
  { id: 'modify-offset', key: 'O', modifiers: ['ctrl'], action: 'offset', description: 'Offset' },
  { id: 'modify-trim', key: 'T', action: 'trim', description: 'Trim' },
  { id: 'modify-extend', key: 'X', action: 'extend', description: 'Extend' },
  { id: 'modify-project', key: 'J', action: 'project', description: 'Project' },
  
  // Architecture
  { id: 'arch-wall', key: 'W', action: 'wall', description: 'Wall Tool' },
  { id: 'arch-door', key: 'D', action: 'door', description: 'Door Tool' },
  { id: 'arch-window', key: 'N', action: 'window', description: 'Window Tool' },
  { id: 'arch-stair', key: 'R', action: 'stair', description: 'Stair Tool' },
  { id: 'arch-roof', key: 'F', action: 'roof', description: 'Roof Tool' },
  { id: 'arch-slab', key: 'B', action: 'slab', description: 'Slab Tool' },
  { id: 'arch-column', key: 'C', action: 'column', description: 'Column Tool' },
  { id: 'arch-beam', key: 'V', action: 'beam', description: 'Beam Tool' },
  { id: 'arch-room', key: 'O', action: 'room', description: 'Room Tool' },
  { id: 'arch-grid', key: 'G', action: 'grid', description: 'Grid Tool' },
  { id: 'arch-dimensions', key: 'D', modifiers: ['shift'], action: 'dimension', description: 'Dimension Tool' },
  
  // View
  { id: 'view-top', key: '1', modifiers: ['ctrl'], action: 'view-top', description: 'Top View' },
  { id: 'view-front', key: '2', modifiers: ['ctrl'], action: 'view-front', description: 'Front View' },
  { id: 'view-right', key: '3', modifiers: ['ctrl'], action: 'view-right', description: 'Right View' },
  { id: 'view-isometric', key: '4', modifiers: ['ctrl'], action: 'view-iso', description: 'Isometric View' },
  { id: 'view-perspective', key: '5', modifiers: ['ctrl'], action: 'view-perspective', description: 'Perspective View' },
  { id: 'view-orbit', key: '6', modifiers: ['ctrl'], action: 'view-orbit', description: 'Orbit View' },
  { id: 'view-navigation', key: '7', modifiers: ['ctrl'], action: 'view-nav', description: 'Navigation View' },
  { id: 'view-section', key: '8', modifiers: ['ctrl'], action: 'view-section', description: 'Section View' },
  { id: 'view-elevations', key: '9', modifiers: ['ctrl'], action: 'view-elevations', description: 'Elevations View' },
  { id: 'view-swatch', key: '0', modifiers: ['ctrl'], action: 'view-swatch', description: 'Swatch View' },
  
  // File
  { id: 'file-new', key: 'N', modifiers: ['ctrl'], action: 'new-document', description: 'New Document' },
  { id: 'file-open', key: 'O', modifiers: ['ctrl'], action: 'open', description: 'Open' },
  { id: 'file-save', key: 'S', modifiers: ['ctrl'], action: 'save', description: 'Save' },
  { id: 'file-save-as', key: 'S', modifiers: ['ctrl', 'shift'], action: 'save-as', description: 'Save As' },
  { id: 'file-import', key: 'I', modifiers: ['ctrl'], action: 'import', description: 'Import' },
  { id: 'file-export', key: 'E', modifiers: ['ctrl'], action: 'export', description: 'Export' },
  { id: 'file-print', key: 'P', modifiers: ['ctrl'], action: 'print', description: 'Print' },
  { id: 'file-exit', key: 'Q', modifiers: ['ctrl'], action: 'exit', description: 'Exit' },
  
  // Edit
  { id: 'edit-undo', key: 'Z', modifiers: ['ctrl'], action: 'undo', description: 'Undo' },
  { id: 'edit-redo', key: 'Y', modifiers: ['ctrl'], action: 'redo', description: 'Redo' },
  { id: 'edit-redo-alt', key: 'Z', modifiers: ['ctrl', 'shift'], action: 'redo', description: 'Redo (Alt)' },
  { id: 'edit-cut', key: 'X', modifiers: ['ctrl'], action: 'cut', description: 'Cut' },
  { id: 'edit-copy', key: 'C', modifiers: ['ctrl'], action: 'copy', description: 'Copy' },
  { id: 'edit-paste', key: 'V', modifiers: ['ctrl'], action: 'paste', description: 'Paste' },
  { id: 'edit-delete', key: 'Delete', action: 'delete', description: 'Delete' },
  { id: 'edit-duplicate', key: 'D', action: 'duplicate', description: 'Duplicate' },
  { id: 'edit-group', key: 'G', action: 'group', description: 'Group' },
  { id: 'edit-ungroup', key: 'U', action: 'ungroup', description: 'Ungroup' },
  { id: 'edit-select-all', key: 'A', modifiers: ['ctrl'], action: 'select-all', description: 'Select All' },
  
  // Tools
  { id: 'tools-command-palette', key: 'P', modifiers: ['ctrl'], action: 'command-palette', description: 'Command Palette' },
  { id: 'tools-properties', key: 'P', modifiers: ['alt'], action: 'properties', description: 'Properties Panel' },
  { id: 'tools-layers', key: 'L', modifiers: ['alt'], action: 'layers', description: 'Layers Panel' },
  { id: 'tools-project', key: 'J', modifiers: ['alt'], action: 'project', description: 'Project Browser' },
  { id: 'tools-settings', key: ',', modifiers: ['ctrl'], action: 'settings', description: 'Settings' },
  { id: 'tools-help', key: 'F1', action: 'help', description: 'Help' },
  
  // Constraints
  { id: 'constraint-coincident', key: 'C', modifiers: ['shift'], action: 'constraint-coincident', description: 'Coincident Constraint' },
  { id: 'constraint-parallel', key: 'P', modifiers: ['shift'], action: 'constraint-parallel', description: 'Parallel Constraint' },
  { id: 'constraint-perpendicular', key: 'T', modifiers: ['shift'], action: 'constraint-perpendicular', description: 'Perpendicular Constraint' },
  { id: 'constraint-tangent', key: 'T', modifiers: ['ctrl'], action: 'constraint-tangent', description: 'Tangent Constraint' },
  { id: 'constraint-equal', key: 'E', modifiers: ['shift'], action: 'constraint-equal', description: 'Equal Constraint' },
  { id: 'constraint-horizontal', key: 'H', modifiers: ['shift'], action: 'constraint-horizontal', description: 'Horizontal Constraint' },
  { id: 'constraint-vertical', key: 'V', modifiers: ['shift'], action: 'constraint-vertical', description: 'Vertical Constraint' },
  { id: 'constraint-distance', key: 'D', modifiers: ['shift'], action: 'constraint-distance', description: 'Distance Constraint' },
  { id: 'constraint-angle', key: 'A', modifiers: ['shift'], action: 'constraint-angle', description: 'Angle Constraint' },
  { id: 'constraint-fix', key: 'F', modifiers: ['shift'], action: 'constraint-fix', description: 'Fix Constraint' },
  
  // Measurement
  { id: 'measure-distance', key: 'D', action: 'measure-distance', description: 'Measure Distance' },
  { id: 'measure-angle', key: 'A', action: 'measure-angle', description: 'Measure Angle' },
  { id: 'measure-area', key: 'R', modifiers: ['alt'], action: 'measure-area', description: 'Measure Area' },
  { id: 'measure-volume', key: 'V', modifiers: ['alt'], action: 'measure-volume', description: 'Measure Volume' },
  
  // Viewport
  { id: 'viewport-fullscreen', key: 'F', modifiers: ['ctrl'], action: 'viewport-fullscreen', description: 'Fullscreen Viewport' },
  { id: 'viewport-splits', key: 'S', modifiers: ['alt'], action: 'viewport-split', description: 'Split Viewport' },
  { id: 'viewport-next', key: 'Tab', action: 'viewport-next', description: 'Next Viewport' },
  { id: 'viewport-reset', key: 'A', modifiers: ['ctrl', 'shift'], action: 'viewport-reset', description: 'Reset Viewport' },
  { id: 'viewport-frame', key: 'F', action: 'viewport-frame', description: 'Frame Selection' },
  
  // Misc
  { id: 'toggle-wireframe', key: 'W', modifiers: ['ctrl'], action: 'toggle-wireframe', description: 'Toggle Wireframe' },
  { id: 'toggle-shading', key: 'S', modifiers: ['ctrl', 'shift'], action: 'toggle-shading', description: 'Toggle Shading' },
  { id: 'toggle-grid', key: 'G', action: 'toggle-grid', description: 'Toggle Grid' },
  { id: 'toggle-snap', key: 'S', action: 'toggle-snap', description: 'Toggle Snap' },
  { id: 'toggle-ortho', key: 'O', action: 'toggle-ortho', description: 'Toggle Ortho Mode' },
  { id: 'toggle-dynamic-input', key: 'D', modifiers: ['alt'], action: 'toggle-dynamic-input', description: 'Toggle Dynamic Input' },
];

export const SHAPR3D_KEYBINDS: KeyboardShortcut[] = [
  // Shapr3D-style navigation
  { id: 'nav-orbit', key: 'Alt', action: 'orbit', description: 'Orbit View' },
  { id: 'nav-pan', key: 'Shift', modifiers: ['alt'], action: 'pan', description: 'Pan View' },
  { id: 'nav-zoom', key: 'Ctrl', modifiers: ['alt'], action: 'zoom', description: 'Zoom View' },
  
  // Shapr3D uses 2-finger gestures on mobile, on desktop:
  { id: 'nav-orbit-right', key: 'Space', action: 'orbit', description: 'Orbit View' },
  
  // Selection
  { id: 'select', key: 'A', action: 'select', description: 'Select Tool' },
  { id: 'select-all', key: 'A', modifiers: ['ctrl'], action: 'select-all', description: 'Select All' },
  
  // Sketching (Shapr3D-style)
  { id: 'sketch-line', key: 'L', action: 'sketch-line', description: 'Line' },
  { id: 'sketch-circle', key: 'C', action: 'sketch-circle', description: 'Circle' },
  { id: 'sketch-rectangle', key: 'R', action: 'sketch-rectangle', description: 'Rectangle' },
  { id: 'sketch-arc', key: 'A', action: 'sketch-arc', description: 'Arc' },
  { id: 'sketch-spline', key: 'S', action: 'sketch-spline', description: 'Spline' },
  
  // Tools (Shapr3D-style single-key shortcuts)
  { id: 'tool-extrude', key: 'E', action: 'extrude', description: 'Extrude' },
  { id: 'tool-revolve', key: 'V', action: 'revolve', description: 'Revolve' },
  { id: 'tool-fillet', key: 'F', action: 'fillet', description: 'Fillet' },
  { id: 'tool-chamfer', key: 'H', action: 'chamfer', description: 'Chamfer' },
  { id: 'tool-move', key: 'M', action: 'move', description: 'Move' },
  { id: 'tool-rotate', key: 'R', modifiers: ['shift'], action: 'rotate', description: 'Rotate' },
  { id: 'tool-scale', key: 'S', action: 'scale', description: 'Scale' },
  
  // Boolean
  { id: 'tool-union', key: 'U', action: 'union', description: 'Union' },
  { id: 'tool-difference', key: 'D', action: 'difference', description: 'Difference' },
  { id: 'tool-intersect', key: 'I', action: 'intersect', description: 'Intersect' },
  
  // Architecture
  { id: 'arch-wall', key: 'W', action: 'wall', description: 'Wall Tool' },
  { id: 'arch-door', key: 'D', action: 'door', description: 'Door Tool' },
  { id: 'arch-window', key: 'N', action: 'window', description: 'Window Tool' },
  
  // View
  { id: 'view-top', key: '1', action: 'view-top', description: 'Top View' },
  { id: 'view-front', key: '2', action: 'view-front', description: 'Front View' },
  { id: 'view-right', key: '3', action: 'view-right', description: 'Right View' },
  { id: 'view-iso', key: '4', action: 'view-iso', description: 'Isometric View' },
  
  // File
  { id: 'file-new', key: 'N', modifiers: ['ctrl'], action: 'new-document', description: 'New Document' },
  { id: 'file-open', key: 'O', modifiers: ['ctrl'], action: 'open', description: 'Open' },
  { id: 'file-save', key: 'S', modifiers: ['ctrl'], action: 'save', description: 'Save' },
  
  // Edit
  { id: 'edit-undo', key: 'Z', modifiers: ['ctrl'], action: 'undo', description: 'Undo' },
  { id: 'edit-redo', key: 'Y', modifiers: ['ctrl'], action: 'redo', description: 'Redo' },
  { id: 'edit-copy', key: 'C', modifiers: ['ctrl'], action: 'copy', description: 'Copy' },
  { id: 'edit-paste', key: 'V', modifiers: ['ctrl'], action: 'paste', description: 'Paste' },
  { id: 'edit-delete', key: 'Delete', action: 'delete', description: 'Delete' },
  
  // Tools
  { id: 'tools-command-palette', key: 'P', modifiers: ['ctrl'], action: 'command-palette', description: 'Command Palette' },
  { id: 'tools-settings', key: ',', modifiers: ['ctrl'], action: 'settings', description: 'Settings' },
  { id: 'tools-help', key: 'F1', action: 'help', description: 'Help' },
];

export const AUTOCAD_KEYBINDS: KeyboardShortcut[] = [
  // AutoCAD-style navigation
  { id: 'nav-orbit', key: 'Shift', modifiers: ['ctrl'], action: 'orbit', description: 'Orbit View' },
  { id: 'nav-pan', key: 'Middle', action: 'pan', description: 'Pan View' },
  { id: 'nav-zoom', key: 'Ctrl', modifiers: ['ctrl'], action: 'zoom', description: 'Zoom View' },
  
  // Selection
  { id: 'select', key: 'Q', action: 'select', description: 'Select Tool' },
  { id: 'select-all', key: 'A', modifiers: ['ctrl'], action: 'select-all', description: 'Select All' },
  { id: 'select-window', key: 'P', action: 'window-select', description: 'Window Select' },
  
  // Sketching
  { id: 'sketch-line', key: 'L', action: 'sketch-line', description: 'Line' },
  { id: 'sketch-polyline', key: 'PL', action: 'sketch-polyline', description: 'Polyline' },
  { id: 'sketch-circle', key: 'C', action: 'sketch-circle', description: 'Circle' },
  { id: 'sketch-arc', key: 'A', action: 'sketch-arc', description: 'Arc' },
  { id: 'sketch-rectangle', key: 'RECT', action: 'sketch-rectangle', description: 'Rectangle' },
  { id: 'sketch-polygon', key: 'PGON', action: 'sketch-polygon', description: 'Polygon' },
  { id: 'sketch-spline', key: 'SPLINE', action: 'sketch-spline', description: 'Spline' },
  
  // Modeling
  { id: 'model-extrude', key: 'EXTRUDE', action: 'extrude', description: 'Extrude' },
  { id: 'model-revolve', key: 'REVOLVE', action: 'revolve', description: 'Revolve' },
  { id: 'model-fillet', key: 'FILLET', action: 'fillet', description: 'Fillet' },
  { id: 'model-chamfer', key: 'CHAMFER', action: 'chamfer', description: 'Chamfer' },
  { id: 'model-offset', key: 'OFFSET', action: 'offset', description: 'Offset' },
  { id: 'model-trim', key: 'TRIM', action: 'trim', description: 'Trim' },
  { id: 'model-extend', key: 'EXTEND', action: 'extend', description: 'Extend' },
  
  // Modify
  { id: 'modify-move', key: 'MOVE', action: 'move', description: 'Move' },
  { id: 'modify-rotate', key: 'ROTATE', action: 'rotate', description: 'Rotate' },
  { id: 'modify-scale', key: 'SCALE', action: 'scale', description: 'Scale' },
  { id: 'modify-mirror', key: 'MIRROR', action: 'mirror', description: 'Mirror' },
  
  // Architecture
  { id: 'arch-wall', key: 'WALL', action: 'wall', description: 'Wall Tool' },
  { id: 'arch-door', key: 'DOOR', action: 'door', description: 'Door Tool' },
  { id: 'arch-window', key: 'WINDOW', action: 'window', description: 'Window Tool' },
  { id: 'arch-stair', key: 'STAIR', action: 'stair', description: 'Stair Tool' },
  
  // View
  { id: 'view-top', key: '1', modifiers: ['ctrl', 'shift'], action: 'view-top', description: 'Top View' },
  { id: 'view-front', key: '2', modifiers: ['ctrl', 'shift'], action: 'view-front', description: 'Front View' },
  { id: 'view-right', key: '3', modifiers: ['ctrl', 'shift'], action: 'view-right', description: 'Right View' },
  { id: 'view-iso', key: '4', modifiers: ['ctrl', 'shift'], action: 'view-iso', description: 'Isometric View' },
  { id: 'view-zoom-extents', key: 'Z', modifiers: ['shift'], action: 'zoom-extents', description: 'Zoom Extents' },
  { id: 'view-zoom-window', key: 'ZW', action: 'zoom-window', description: 'Zoom Window' },
  
  // File
  { id: 'file-new', key: 'NEW', action: 'new-document', description: 'New Document' },
  { id: 'file-open', key: 'OPEN', action: 'open', description: 'Open' },
  { id: 'file-save', key: 'SAVE', action: 'save', description: 'Save' },
  
  // Edit
  { id: 'edit-undo', key: 'UNDO', action: 'undo', description: 'Undo' },
  { id: 'edit-redo', key: 'REDO', action: 'redo', description: 'Redo' },
  { id: 'edit-copy', key: 'COPY', action: 'copy', description: 'Copy' },
  { id: 'edit-paste', key: 'PASTE', action: 'paste', description: 'Paste' },
  { id: 'edit-delete', key: 'DELETE', action: 'delete', description: 'Delete' },
  
  // Tools
  { id: 'tools-command-line', key: 'Ctrl', modifiers: ['shift'], action: 'command-line', description: 'Command Line' },
  { id: 'tools-properties', key: 'PROPERTIES', action: 'properties', description: 'Properties Palette' },
  { id: 'tools-layers', key: 'LA', action: 'layers', description: 'Layer Manager' },
  
  // Measurement
  { id: 'measure-distance', key: 'DIST', action: 'measure-distance', description: 'Measure Distance' },
  { id: 'measure-angle', key: 'MEASUREGEOM', action: 'measure-angle', description: 'Measure Angle' },
  
  // Constraints
  { id: 'constraint-fix', key: 'F', action: 'constraint-fix', description: 'Fix' },
  { id: 'constraint-coincident', key: 'COINCIDENT', action: 'constraint-coincident', description: 'Coincident' },
  { id: 'constraint-parallel', key: 'PARALLEL', action: 'constraint-parallel', description: 'Parallel' },
  { id: 'constraint-perpendicular', key: 'PERPENDICULAR', action: 'constraint-perpendicular', description: 'Perpendicular' },
  { id: 'constraint-tangent', key: 'TAN', action: 'constraint-tangent', description: 'Tangent' },
  { id: 'constraint-equal', key: 'EQUAL', action: 'constraint-equal', description: 'Equal' },
  { id: 'constraint-horizontal', key: 'HOR', action: 'constraint-horizontal', description: 'Horizontal' },
  { id: 'constraint-vertical', key: 'VERT', action: 'constraint-vertical', description: 'Vertical' },
];

export const BLENDER_KEYBINDS: KeyboardShortcut[] = [
  // Blender-style navigation (Emulate Numpad)
  { id: 'nav-orbit', key: 'Middle', modifiers: ['ctrl'], action: 'orbit', description: 'Orbit View' },
  { id: 'nav-pan', key: 'Shift', modifiers: ['ctrl', 'shift'], action: 'pan', description: 'Pan View' },
  { id: 'nav-zoom', key: 'Ctrl', modifiers: ['ctrl', 'shift'], action: 'zoom', description: 'Zoom View' },
  
  // View
  { id: 'view-top', key: '7', action: 'view-top', description: 'Top View' },
  { id: 'view-front', key: '1', action: 'view-front', description: 'Front View' },
  { id: 'view-right', key: '3', action: 'view-right', description: 'Right View' },
  { id: 'view-iso', key: '0', action: 'view-camera', description: 'Camera View' },
  { id: 'view-orbit', key: '9', action: 'view-orbit', description: 'Orbit Camera' },
  { id: 'view-elevations', key: '8', action: 'view-elevations', description: 'Elevations' },
  
  // Selection
  { id: 'select', key: 'A', action: 'select', description: 'Select Tool' },
  { id: 'select-all', key: 'A', action: 'select-all', description: 'Select All' },
  { id: 'select-box', key: 'B', action: 'box-select', description: 'Box Select' },
  { id: 'select-circle', key: 'C', action: 'circle-select', description: 'Circle Select' },
  { id: 'select-lasso', key: 'Ctrl', modifiers: ['ctrl'], action: 'lasso-select', description: 'Lasso Select' },
  
  // Mesh/Edit
  { id: 'edit-mode', key: 'Tab', action: 'toggle-edit', description: 'Toggle Edit Mode' },
  { id: 'select-mode', key: 'Tab', modifiers: ['ctrl'], action: 'select-mode', description: 'Select Mode' },
  
  // Modeling
  { id: 'model-add', key: 'A', modifiers: ['shift'], action: 'add', description: 'Add Menu' },
  { id: 'model-extrude', key: 'E', action: 'extrude', description: 'Extrude' },
  { id: 'model-inset', key: 'I', action: 'inset', description: 'Inset' },
  { id: 'model-bevel', key: 'B', modifiers: ['ctrl', 'shift'], action: 'bevel', description: 'Bevel' },
  { id: 'model-loop-cut', key: 'R', modifiers: ['ctrl'], action: 'loop-cut', description: 'Loop Cut' },
  { id: 'model-subdivide', key: '2', modifiers: ['ctrl'], action: 'subdivide', description: 'Subdivide' },
  { id: 'model-merge', key: 'M', modifiers: ['alt'], action: 'merge', description: 'Merge' },
  
  // Modify
  { id: 'modify-move', key: 'G', action: 'grab', description: 'Grab/Move' },
  { id: 'modify-rotate', key: 'R', action: 'rotate', description: 'Rotate' },
  { id: 'modify-scale', key: 'S', action: 'scale', description: 'Scale' },
  { id: 'modify-duplicate', key: 'D', modifiers: ['shift'], action: 'duplicate', description: 'Duplicate' },
  { id: 'modify-delete', key: 'X', action: 'delete', description: 'Delete' },
  
  // Architecture
  { id: 'arch-wall', key: 'W', modifiers: ['shift', 'ctrl'], action: 'wall', description: 'Wall Tool' },
  { id: 'arch-door', key: 'D', modifiers: ['shift', 'ctrl'], action: 'door', description: 'Door Tool' },
  { id: 'arch-window', key: 'N', modifiers: ['shift', 'ctrl'], action: 'window', description: 'Window Tool' },
  
  // File
  { id: 'file-save', key: 'S', modifiers: ['ctrl'], action: 'save', description: 'Save' },
  { id: 'file-save-as', key: 'S', modifiers: ['ctrl', 'shift'], action: 'save-as', description: 'Save As' },
  
  // Edit
  { id: 'edit-undo', key: 'Z', action: 'undo', description: 'Undo' },
  { id: 'edit-redo', key: 'Z', modifiers: ['shift'], action: 'redo', description: 'Redo' },
  { id: 'edit-copy', key: 'C', modifiers: ['ctrl'], action: 'copy', description: 'Copy' },
  { id: 'edit-paste', key: 'V', modifiers: ['ctrl'], action: 'paste', description: 'Paste' },
];

export const KEYBIND_PRESETS: KeybindPreset[] = [
  {
    id: 'default',
    name: 'Default',
    description: 'Default keybinds optimized for CAD workflows',
    shortcuts: DEFAULT_KEYBINDS,
  },
  {
    id: 'shapr3d',
    name: 'Shapr3D',
    description: 'Shapr3D-style keybinds for intuitive design',
    shortcuts: SHAPR3D_KEYBINDS,
  },
  {
    id: 'autocad',
    name: 'AutoCAD',
    description: 'AutoCAD-style command-line keybinds',
    shortcuts: AUTOCAD_KEYBINDS,
  },
  {
    id: 'blender',
    name: 'Blender',
    description: 'Blender-style keybinds for 3D modeling',
    shortcuts: BLENDER_KEYBINDS,
  },
];

export const useKeybinds = () => {
  const { activeKeybindPreset, setKeybindPreset } = useAppStore();
  const presets = useAppStore((state) => state.keybindPresets);
  
  const activePreset = [...KEYBIND_PRESETS, ...presets].find((p) => p.id === activeKeybindPreset) || KEYBIND_PRESETS[0];
  
  const getShortcuts = () => activePreset.shortcuts;
  
  const getShortcut = (actionId: string) => {
    return activePreset.shortcuts.find((s) => s.id === actionId || s.action === actionId);
  };
  
  const getShortcutLabel = (actionId: string): string => {
    const shortcut = getShortcut(actionId);
    if (!shortcut) return '';
    
    const parts: string[] = [];
    if (shortcut.modifiers?.includes('ctrl')) parts.push('Ctrl');
    if (shortcut.modifiers?.includes('shift')) parts.push('Shift');
    if (shortcut.modifiers?.includes('alt')) parts.push('Alt');
    if (shortcut.modifiers?.includes('meta')) parts.push('Cmd');
    parts.push(shortcut.key);
    
    return parts.join(' + ');
  };
  
  const matchesShortcut = (event: KeyboardEvent, actionId: string): boolean => {
    const shortcut = getShortcut(actionId);
    if (!shortcut) return false;
    
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcutKey = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key.toLowerCase();
    
    if (key !== shortcutKey) return false;
    
    const ctrl = event.ctrlKey;
    const shift = event.shiftKey;
    const alt = event.altKey;
    const meta = event.metaKey;
    
    return (
      shortcut.modifiers?.includes('ctrl') === ctrl &&
      shortcut.modifiers?.includes('shift') === shift &&
      shortcut.modifiers?.includes('alt') === alt &&
      shortcut.modifiers?.includes('meta') === meta
    );
  };
  
  return {
    preset: activePreset,
    presets: [...KEYBIND_PRESETS, ...presets],
    setPreset: setKeybindPreset,
    getShortcuts,
    getShortcut,
    getShortcutLabel,
    matchesShortcut,
  };
}