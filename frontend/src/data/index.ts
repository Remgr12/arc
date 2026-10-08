import { useAppStore } from '@/stores/appStore';
import { Tool } from '@/types';

export const registerTools = (store: typeof useAppStore) => {
  const tools: Record<string, Tool> = {
    select: {
      id: 'select',
      name: 'Select',
      icon: '🖱️',
      category: 'Select',
    },
    'sketch-line': {
      id: 'sketch-line',
      name: 'Line',
      icon: '📏',
      category: 'Sketch',
    },
    'sketch-circle': {
      id: 'sketch-circle',
      name: 'Circle',
      icon: '⭕',
      category: 'Sketch',
    },
    'model-extrude': {
      id: 'model-extrude',
      name: 'Extrude',
      icon: '⬆️',
      category: 'Model',
    },
    'arch-wall': {
      id: 'arch-wall',
      name: 'Wall',
      icon: '🧱',
      category: 'Architecture',
    },
    'arch-door': {
      id: 'arch-door',
      name: 'Door',
      icon: '🚪',
      category: 'Architecture',
    },
    'arch-window': {
      id: 'arch-window',
      name: 'Window',
      icon: '🪟',
      category: 'Architecture',
    },
    'arch-stair': {
      id: 'arch-stair',
      name: 'Stair',
      icon: '🪜',
      category: 'Architecture',
    },
    'modify-move': {
      id: 'modify-move',
      name: 'Move',
      icon: '➡️',
      category: 'Modify',
    },
    'modify-rotate': {
      id: 'modify-rotate',
      name: 'Rotate',
      icon: '↻',
      category: 'Modify',
    },
    'measure-distance': {
      id: 'measure-distance',
      name: 'Distance',
      icon: '📏',
      category: 'Measure',
    },
  };
  
  Object.values(tools).forEach((tool) => {
    store.getState().registerTool(tool);
  });
};

export const toolIcons = {
  MousePointerClick: '🖱️',
  PenLine: '✏️',
  LineChart: '📈',
  Circle: '⭕',
  Activity: '≈',
  Square: '▢',
  Polygon: '⬡',
  Spline: '~',
  Type: 'T',
  Box: '📦',
  Rotate3D: '🔄',
  GitMerge: '🔀',
  Move: '➡️',
  RefreshCw: '↻',
  Sliders: '🎚️',
  Scissors: '✂️',
  Copy: '📋',
  Trash2: '🗑️',
  Shield: '🛡️',
  Home: '🏠',
  DoorOpen: '🚪',
  Window: '🪟',
  Stairs: '🪜',
  Roof: ' roof',
  BarChart3: '📊',
  Ruler: '📏',
  Grid3x3: '🌐',
  Layout: '📐',
  Maximize2: '🔍',
};
