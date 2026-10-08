import { Command } from '@/types';

export const commands: Command[] = [
  // File
  {
    id: 'new-document',
    name: 'New Document',
    description: 'Create a new document',
    category: 'File',
    shortcut: 'Ctrl+N',
    icon: 'FileText',
  },
  {
    id: 'open-document',
    name: 'Open',
    description: 'Open an existing document',
    category: 'File',
    shortcut: 'Ctrl+O',
    icon: 'FolderOpen',
  },
  {
    id: 'save-document',
    name: 'Save',
    description: 'Save the current document',
    category: 'File',
    shortcut: 'Ctrl+S',
    icon: 'Save',
  },
  {
    id: 'save-as',
    name: 'Save As',
    description: 'Save the document with a new name',
    category: 'File',
    shortcut: 'Ctrl+Shift+S',
    icon: 'Save',
  },
  {
    id: 'import',
    name: 'Import',
    description: 'Import a file',
    category: 'File',
    shortcut: 'Ctrl+I',
    icon: 'Upload',
  },
  {
    id: 'export',
    name: 'Export',
    description: 'Export the current view',
    category: 'File',
    shortcut: 'Ctrl+E',
    icon: 'Download',
  },
  {
    id: 'print',
    name: 'Print',
    description: 'Print the current view',
    category: 'File',
    shortcut: 'Ctrl+P',
    icon: 'Printer',
  },
  
  // Edit
  {
    id: 'undo',
    name: 'Undo',
    description: 'Undo the last operation',
    category: 'Edit',
    shortcut: 'Ctrl+Z',
  },
  {
    id: 'redo',
    name: 'Redo',
    description: 'Redo the last undone operation',
    category: 'Edit',
    shortcut: 'Ctrl+Y',
  },
  {
    id: 'cut',
    name: 'Cut',
    description: 'Cut the selected items',
    category: 'Edit',
    shortcut: 'Ctrl+X',
  },
  {
    id: 'copy',
    name: 'Copy',
    description: 'Copy the selected items',
    category: 'Edit',
    shortcut: 'Ctrl+C',
  },
  {
    id: 'paste',
    name: 'Paste',
    description: 'Paste from clipboard',
    category: 'Edit',
    shortcut: 'Ctrl+V',
  },
  {
    id: 'delete',
    name: 'Delete',
    description: 'Delete the selected items',
    category: 'Edit',
    shortcut: 'Delete',
  },
  {
    id: 'duplicate',
    name: 'Duplicate',
    description: 'Duplicate the selected items',
    category: 'Edit',
    shortcut: 'Ctrl+D',
  },
  {
    id: 'select-all',
    name: 'Select All',
    description: 'Select all entities',
    category: 'Edit',
    shortcut: 'Ctrl+A',
  },
  {
    id: 'group',
    name: 'Group',
    description: 'Group selected entities',
    category: 'Edit',
    shortcut: 'Ctrl+G',
  },
  {
    id: 'ungroup',
    name: 'Ungroup',
    description: 'Ungroup selected entities',
    category: 'Edit',
    shortcut: 'Ctrl+Shift+G',
  },
  
  // View
  {
    id: 'zoom-extents',
    name: 'Zoom Extents',
    description: 'Zoom to show everything',
    category: 'View',
    shortcut: 'F',
  },
  {
    id: 'zoom-window',
    name: 'Zoom Window',
    description: 'Zoom to a window area',
    category: 'View',
    shortcut: 'Ctrl+Z',
  },
  {
    id: 'zoom-prev',
    name: 'Zoom Previous',
    description: 'Zoom to previous view',
    category: 'View',
    shortcut: 'Ctrl+Shift+B',
  },
  {
    id: 'view-top',
    name: 'Top View',
    description: 'Switch to top view',
    category: 'View',
    shortcut: 'Ctrl+1',
  },
  {
    id: 'view-front',
    name: 'Front View',
    description: 'Switch to front view',
    category: 'View',
    shortcut: 'Ctrl+2',
  },
  {
    id: 'view-right',
    name: 'Right View',
    description: 'Switch to right view',
    category: 'View',
    shortcut: 'Ctrl+3',
  },
  {
    id: 'view-iso',
    name: 'Isometric View',
    description: 'Switch to isometric view',
    category: 'View',
    shortcut: 'Ctrl+4',
  },
  {
    id: 'view-perspective',
    name: 'Perspective',
    description: 'Toggle perspective mode',
    category: 'View',
    shortcut: 'Ctrl+5',
  },
  {
    id: 'toggle-grid',
    name: 'Toggle Grid',
    description: 'Show/hide the grid',
    category: 'View',
    shortcut: 'G',
  },
  {
    id: 'toggle-snap',
    name: 'Toggle Snap',
    description: 'Enable/disable snapping',
    category: 'View',
    shortcut: 'S',
  },
  {
    id: 'toggle-ortho',
    name: 'Toggle Ortho',
    description: 'Enable/disable ortho mode',
    category: 'View',
    shortcut: 'O',
  },
  
  // Sketch
  {
    id: 'sketch-line',
    name: 'Line',
    description: 'Draw a line',
    category: 'Sketch',
    shortcut: 'L',
  },
  {
    id: 'sketch-circle',
    name: 'Circle',
    description: 'Draw a circle',
    category: 'Sketch',
    shortcut: 'C',
  },
  {
    id: 'sketch-arc',
    name: 'Arc',
    description: 'Draw an arc',
    category: 'Sketch',
    shortcut: 'A',
  },
  {
    id: 'sketch-rectangle',
    name: 'Rectangle',
    description: 'Draw a rectangle',
    category: 'Sketch',
    shortcut: 'R',
  },
  {
    id: 'sketch-polyline',
    name: 'Polyline',
    description: 'Draw a polyline',
    category: 'Sketch',
    shortcut: 'P',
  },
  {
    id: 'sketch-spline',
    name: 'Spline',
    description: 'Draw a spline',
    category: 'Sketch',
    shortcut: 'S',
  },
  
  // Model
  {
    id: 'model-extrude',
    name: 'Extrude',
    description: 'Extrude a profile',
    category: 'Model',
    shortcut: 'E',
  },
  {
    id: 'model-revolve',
    name: 'Revolve',
    description: 'Revolve a profile',
    category: 'Model',
    shortcut: 'V',
  },
  {
    id: 'model-fillet',
    name: 'Fillet',
    description: 'Apply a fillet',
    category: 'Model',
    shortcut: 'F',
  },
  {
    id: 'model-chamfer',
    name: 'Chamfer',
    description: 'Apply a chamfer',
    category: 'Model',
    shortcut: 'H',
  },
  {
    id: 'model-loft',
    name: 'Loft',
    description: 'Create a loft',
    category: 'Model',
    shortcut: 'Ctrl+L',
  },
  {
    id: 'model-sweep',
    name: 'Sweep',
    description: 'Create a sweep',
    category: 'Model',
    shortcut: 'Ctrl+S',
  },
  {
    id: 'model-union',
    name: 'Union',
    description: 'Boolean union',
    category: 'Model',
    shortcut: 'Ctrl+U',
  },
  {
    id: 'model-difference',
    name: 'Subtract',
    description: 'Boolean subtraction',
    category: 'Model',
    shortcut: 'Ctrl+D',
  },
  {
    id: 'model-intersect',
    name: 'Intersect',
    description: 'Boolean intersection',
    category: 'Model',
    shortcut: 'Ctrl+I',
  },
  
  // Architecture
  {
    id: 'arch-wall',
    name: 'Wall',
    description: 'Draw a wall',
    category: 'Architecture',
    shortcut: 'W',
  },
  {
    id: 'arch-door',
    name: 'Door',
    description: 'Place a door',
    category: 'Architecture',
    shortcut: 'D',
  },
  {
    id: 'arch-window',
    name: 'Window',
    description: 'Place a window',
    category: 'Architecture',
    shortcut: 'N',
  },
  {
    id: 'arch-stair',
    name: 'Stair',
    description: 'Create stairs',
    category: 'Architecture',
    shortcut: 'R',
  },
  {
    id: 'arch-roof',
    name: 'Roof',
    description: 'Create a roof',
    category: 'Architecture',
    shortcut: 'F',
  },
  {
    id: 'arch-slab',
    name: 'Slab',
    description: 'Create a slab',
    category: 'Architecture',
    shortcut: 'B',
  },
  {
    id: 'arch-column',
    name: 'Column',
    description: 'Place a column',
    category: 'Architecture',
    shortcut: 'C',
  },
  {
    id: 'arch-beam',
    name: 'Beam',
    description: 'Place a beam',
    category: 'Architecture',
    shortcut: 'V',
  },
  {
    id: 'arch-room',
    name: 'Room',
    description: 'Define a room',
    category: 'Architecture',
  },
  {
    id: 'arch-dimension',
    name: 'Dimension',
    description: 'Add a dimension',
    category: 'Architecture',
    shortcut: 'D',
  },
  
  // Modify
  {
    id: 'modify-move',
    name: 'Move',
    description: 'Move entities',
    category: 'Modify',
    shortcut: 'M',
  },
  {
    id: 'modify-rotate',
    name: 'Rotate',
    description: 'Rotate entities',
    category: 'Modify',
  },
  {
    id: 'modify-scale',
    name: 'Scale',
    description: 'Scale entities',
    category: 'Modify',
    shortcut: 'S',
  },
  {
    id: 'modify-mirror',
    name: 'Mirror',
    description: 'Mirror entities',
    category: 'Modify',
    shortcut: 'Ctrl+M',
  },
  {
    id: 'modify-offset',
    name: 'Offset',
    description: 'Offset entities',
    category: 'Modify',
    shortcut: 'O',
  },
  {
    id: 'modify-pattern',
    name: 'Pattern',
    description: 'Create a pattern',
    category: 'Modify',
    shortcut: 'Ctrl+P',
  },
  {
    id: 'modify-trim',
    name: 'Trim',
    description: 'Trim entities',
    category: 'Modify',
  },
  
  // Annotate
  {
    id: 'annotate-text',
    name: 'Text',
    description: 'Add text',
    category: 'Annotate',
    shortcut: 'T',
  },
  {
    id: 'annotate-dimension',
    name: 'Dimension',
    description: 'Add a dimension',
    category: 'Annotate',
    shortcut: 'D',
  },
  {
    id: 'annotate-leader',
    name: 'Leader',
    description: 'Add a leader',
    category: 'Annotate',
    shortcut: 'L',
  },
  {
    id: 'annotate-tag',
    name: 'Tag',
    description: 'Add a tag',
    category: 'Annotate',
  },
  
  // Measure
  {
    id: 'measure-distance',
    name: 'Distance',
    description: 'Measure distance',
    category: 'Measure',
    shortcut: 'Shift+D',
  },
  {
    id: 'measure-angle',
    name: 'Angle',
    description: 'Measure angle',
    category: 'Measure',
    shortcut: 'Shift+A',
  },
  {
    id: 'measure-area',
    name: 'Area',
    description: 'Measure area',
    category: 'Measure',
    shortcut: 'Shift+R',
  },
  
  // Settings
  {
    id: 'settings',
    name: 'Settings',
    description: 'Open settings',
    category: 'Settings',
    shortcut: 'Ctrl+,',
  },
  {
    id: 'preferences',
    name: 'Preferences',
    description: 'Open preferences',
    category: 'Settings',
  },
  
  // Help
  {
    id: 'help-documentation',
    name: 'Documentation',
    description: 'Open documentation',
    category: 'Help',
    shortcut: 'F1',
  },
  {
    id: 'help-shortcuts',
    name: 'Keyboard Shortcuts',
    description: 'Show keyboard shortcuts',
    category: 'Help',
    shortcut: 'F1',
  },
  {
    id: 'help-feedback',
    name: 'Send Feedback',
    description: 'Send feedback to the team',
    category: 'Help',
  },
  {
    id: 'help-about',
    name: 'About',
    description: 'About ARC CAD',
    category: 'Help',
  },
];

export const getCommandById = (id: string): Command | undefined => {
  return commands.find((cmd) => cmd.id === id);
};

export const getCommandsByCategory = (): Record<string, Command[]> => {
  return commands.reduce((acc, cmd) => {
    const category = cmd.category || 'Other';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(cmd);
    return acc;
  }, {} as Record<string, Command[]>);
};