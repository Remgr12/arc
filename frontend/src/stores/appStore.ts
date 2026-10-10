import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  AppSettings,
  Document,
  Entity,
  Selection,
  ViewportState,
  ViewportCamera,
  Plugin,
  Tool,
  Command,
  UIPanel,
  KeyboardShortcut,
  KeybindPreset,
  Theme,
  Layer,
} from '@/types';

interface AppState {
  // Core
  appName: string;
  version: string;
  initialized: boolean;
  
  // Documents
  documents: Document[];
  activeDocumentId: string | null;
  isLoading: boolean;
  isDirty: boolean;
  
  // Settings
  settings: AppSettings;
  
  // UI
  panels: Record<string, { visible: boolean; position: string; size: { width: number; height: number }; collapsed: boolean }>;
  activeTool: string | null;
  activeCommand: string | null;
  commandPaletteOpen: boolean;
  preferencesOpen: boolean;
  helpOpen: boolean;
  statusMessage: string | null;
  statusTimer: number | null;
  
  // Viewport
  viewportCameras: Record<string, ViewportCamera>;
  activeViewport: string;
  viewportLayout: 'single' | 'horizontal-split' | 'vertical-split' | 'quad' | 'three-horizontal' | 'three-vertical';
  
  // Selection
  selection: Selection;
  hoverEntity: Entity | null;
  
  // Tools & Commands
  tools: Record<string, Tool>;
  commands: Record<string, Command>;
  toolCategories: string[];
  
  // Input
  mousePosition: { x: number; y: number };
  mouseButtons: Record<string, boolean>;
  keysPressed: Set<string>;
  modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean };
  
  // Themes & Keybinds
  themes: Theme[];
  activeTheme: string;
  keybindPresets: KeybindPreset[];
  activeKeybindPreset: string;
  
  // Plugins
  plugins: Plugin[];
  
  // Layers
  layers: Layer[];
  activeLayerId: string | null;
  
  // History
  canUndo: boolean;
  canRedo: boolean;
  historyPosition: number;
  historyLength: number;
  
  // Actions - Documents
  setDocuments: (documents: Document[]) => void;
  setActiveDocument: (id: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  setIsDirty: (dirty: boolean) => void;
  
  // Actions - Settings
  setSettings: (settings: Partial<AppSettings>) => void;
  resetSettings: () => void;
  
  // Actions - UI
  setPanelVisibility: (panelId: string, visible: boolean) => void;
  setPanelPosition: (panelId: string, position: string) => void;
  setPanelSize: (panelId: string, size: { width: number; height: number }) => void;
  togglePanel: (panelId: string) => void;
  setPanelCollapsed: (panelId: string, collapsed: boolean) => void;
  setActiveTool: (toolId: string | null) => void;
  setActiveCommand: (commandId: string | null) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setPreferencesOpen: (open: boolean) => void;
  setHelpOpen: (open: boolean) => void;
  setStatusMessage: (message: string | null, duration?: number) => void;
  
  // Actions - Viewport
  setViewportCamera: (viewportId: string, camera: ViewportCamera) => void;
  setActiveViewport: (id: string) => void;
  setViewportLayout: (layout: AppState['viewportLayout']) => void;
  
  // Actions - Selection
  setSelection: (selection: Selection) => void;
  setHoverEntity: (entity: Entity | null) => void;
  
  // Actions - Tools & Commands
  registerTool: (tool: Tool) => void;
  registerCommand: (command: Command) => void;
  executeCommand: (commandId: string, args?: unknown) => Promise<unknown>;
  createDocument: () => Promise<void>;
  
  // Actions - Input
  setMousePosition: (pos: { x: number; y: number }) => void;
  setMouseButton: (button: string, pressed: boolean) => void;
  setKeyPressed: (key: string, pressed: boolean) => void;
  setModifiers: (modifiers: { shift: boolean; ctrl: boolean; alt: boolean; meta: boolean }) => void;
  
  // Actions - Themes & Keybinds
  setTheme: (themeId: string) => void;
  addCustomTheme: (theme: Theme) => void;
  setKeybindPreset: (presetId: string) => void;
  addCustomKeybindPreset: (preset: KeybindPreset) => void;
  
  // Actions - Plugins
  setPlugins: (plugins: Plugin[]) => void;
  togglePlugin: (pluginId: string, enabled: boolean) => void;
  
  // Actions - Layers
  setLayers: (layers: Layer[]) => void;
  setActiveLayer: (id: string | null) => void;
  
  // Actions - History
  undo: () => void;
  redo: () => void;
  setHistoryState: (canUndo: boolean, canRedo: boolean, position: number, length: number) => void;
  
  // Actions - General
  setInitialized: (initialized: boolean) => void;
}

const defaultSettings: AppSettings = {
  theme: 'dark',
  keybindPreset: 'default',
  gridEnabled: true,
  gridSize: 1000,
  gridSubdivisions: 10,
  snapEnabled: true,
  orthoMode: false,
  polarTracking: true,
  objectSnap: true,
  dynamicInput: true,
  units: {
    system: 'Metric',
    length: 'Millimeter',
    angle: 'Degree',
    precision: 2,
    anglePrecision: 2,
  },
  autoSave: true,
  autoSaveInterval: 300,
  language: 'en',
  viewportBackground: '#0d0d0f',
  showNavigationCube: true,
  showGrid: true,
  showAxes: true,
  renderMode: 'ShadedWithEdges',
  msaaSamples: 4,
  ambientOcclusion: false,
  shadows: true,
  showSnapIndicator: true,
  snapTolerance: 10,
};

const defaultPanels = {
  viewport: { visible: true, position: 'center', size: { width: 1920, height: 1080 }, collapsed: false },
  toolbar: { visible: true, position: 'top', size: { width: 1920, height: 48 }, collapsed: false },
  properties: { visible: true, position: 'right', size: { width: 320, height: 1080 }, collapsed: false },
  layers: { visible: true, position: 'right', size: { width: 240, height: 1080 }, collapsed: false },
  project: { visible: true, position: 'left', size: { width: 280, height: 1080 }, collapsed: false },
  commandPalette: { visible: false, position: 'center', size: { width: 600, height: 400 }, collapsed: false },
  statusBar: { visible: true, position: 'bottom', size: { width: 1920, height: 24 }, collapsed: false },
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      appName: 'arc CAD',
      version: '0.1.0',
      initialized: false,
      
      documents: [],
      activeDocumentId: null,
      isLoading: false,
      isDirty: false,
      
      settings: defaultSettings,
      
      panels: defaultPanels,
      activeTool: 'select',
      activeCommand: null,
      commandPaletteOpen: false,
      preferencesOpen: false,
      helpOpen: false,
      statusMessage: null,
      statusTimer: null,
      
      viewportCameras: {},
      activeViewport: 'perspective',
      viewportLayout: 'single',
      
      selection: {
        selectedIds: [],
        primaryId: undefined,
        hoverId: undefined,
      },
      hoverEntity: null,
      
      tools: {},
      commands: {},
      toolCategories: ['Select', 'Sketch', 'Model', 'Architecture', 'Modify', 'Annotate', 'View', 'Measure'],
      
      mousePosition: { x: 0, y: 0 },
      mouseButtons: {},
      keysPressed: new Set(),
      modifiers: { shift: false, ctrl: false, alt: false, meta: false },
      
      themes: [
        { id: 'dark', name: 'Dark', description: 'Dark theme', colors: {}, isBuiltIn: true },
        { id: 'light', name: 'Light', description: 'Light theme', colors: {}, isBuiltIn: true },
        { id: 'high-contrast', name: 'High Contrast', description: 'High contrast theme', colors: {}, isBuiltIn: true },
      ],
      activeTheme: 'dark',
      keybindPresets: [],
      activeKeybindPreset: 'default',
      
      plugins: [],
      
      layers: [],
      activeLayerId: null,
      
      canUndo: false,
      canRedo: false,
      historyPosition: 0,
      historyLength: 0,
      
      setDocuments: (documents) => set({ documents }),
      setActiveDocument: (id) => set({ activeDocumentId: id }),
      setIsLoading: (loading) => set({ isLoading: loading }),
      setIsDirty: (dirty) => set({ isDirty: dirty }),
      
      setSettings: (settings) => set((state) => ({
        settings: { ...state.settings, ...settings },
      })),
      resetSettings: () => set({ settings: defaultSettings }),
      
      setPanelVisibility: (panelId, visible) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panelId]: { ...state.panels[panelId], visible },
          },
        })),
      setPanelPosition: (panelId, position) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panelId]: { ...state.panels[panelId], position },
          },
        })),
      setPanelSize: (panelId, size) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panelId]: { ...state.panels[panelId], size },
          },
        })),
      togglePanel: (panelId) =>
        set((state) => {
          const panel = state.panels[panelId];
          if (!panel) return state;
          return {
            panels: {
              ...state.panels,
              [panelId]: { ...panel, visible: !panel.visible },
            },
          };
        }),
      setPanelCollapsed: (panelId, collapsed) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panelId]: { ...state.panels[panelId], collapsed },
          },
        })),
      setActiveTool: (toolId) => set({ activeTool: toolId }),
      setActiveCommand: (commandId) => set({ activeCommand: commandId }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
      setPreferencesOpen: (open) => set({ preferencesOpen: open }),
      setHelpOpen: (open) => set({ helpOpen: open }),
      setStatusMessage: (message, duration) => {
        const state = get();
        if (state.statusTimer) {
          clearTimeout(state.statusTimer);
        }
        set({ statusMessage: message, statusTimer: null });
        if (duration && message) {
          const timer = window.setTimeout(() => {
            set({ statusMessage: null });
          }, duration);
          set({ statusTimer: timer });
        }
      },
      
      setViewportCamera: (viewportId, camera) =>
        set((state) => ({
          viewportCameras: {
            ...state.viewportCameras,
            [viewportId]: camera,
          },
        })),
      setActiveViewport: (id) => set({ activeViewport: id }),
      setViewportLayout: (layout) => set({ viewportLayout: layout }),
      
      setSelection: (selection) => set({ selection }),
      setHoverEntity: (entity) => set({ hoverEntity: entity }),
      
      registerTool: (tool) =>
        set((state) => ({
          tools: { ...state.tools, [tool.id]: tool },
        })),
      registerCommand: (command) =>
        set((state) => ({
          commands: { ...state.commands, [command.id]: command },
        })),
      executeCommand: async (commandId, args) => {
        const command = get().commands[commandId];
        if (command) {
          return command;
        }
        throw new Error(`Command not found: ${commandId}`);
      },
      createDocument: async () => {
        // Create new document via IPC
        await get().executeCommand('new_document');
      },
      
      setMousePosition: (pos) => set({ mousePosition: pos }),
      setMouseButton: (button, pressed) =>
        set((state) => ({
          mouseButtons: { ...state.mouseButtons, [button]: pressed },
        })),
      setKeyPressed: (key, pressed) =>
        set((state) => {
          const keys = new Set(state.keysPressed);
          if (pressed) {
            keys.add(key.toLowerCase());
          } else {
            keys.delete(key.toLowerCase());
          }
          return { keysPressed: keys };
        }),
      setModifiers: (modifiers) => set({ modifiers }),
      
      setTheme: (themeId) => set((state) => ({
        settings: { ...state.settings, theme: themeId as AppSettings['theme'] },
        activeTheme: themeId,
      })),
      addCustomTheme: (theme) =>
        set((state) => ({
          themes: [...state.themes, theme],
          activeTheme: theme.id,
          settings: { ...state.settings, theme: theme.id as AppSettings['theme'] },
        })),
      setKeybindPreset: (presetId) => set((state) => ({
        settings: { ...state.settings, keybindPreset: presetId as AppSettings['keybindPreset'] },
        activeKeybindPreset: presetId,
      })),
      addCustomKeybindPreset: (preset) =>
        set((state) => ({
          keybindPresets: [...state.keybindPresets, preset],
          activeKeybindPreset: preset.id,
          settings: { ...state.settings, keybindPreset: preset.id as AppSettings['keybindPreset'] },
        })),
      
      setPlugins: (plugins) => set({ plugins }),
      togglePlugin: (pluginId, enabled) =>
        set((state) => ({
          plugins: state.plugins.map((p) => (p.id === pluginId ? { ...p, enabled } : p)),
        })),
      
      setLayers: (layers) => set({ layers, activeLayerId: layers[0]?.id.uuid || null }),
      setActiveLayer: (id) => set({ activeLayerId: id }),
      
      undo: () => {
        const state = get();
        if (state.canUndo) {
          // Trigger undo via IPC
        }
      },
      redo: () => {
        const state = get();
        if (state.canRedo) {
          // Trigger redo via IPC
        }
      },
      setHistoryState: (canUndo, canRedo, position, length) =>
        set({ canUndo, canRedo, historyPosition: position, historyLength: length }),
      
      setInitialized: (initialized) => set({ initialized }),
    }),
    {
      name: 'arc-app-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
        panels: state.panels,
        themes: state.themes,
        activeTheme: state.activeTheme,
        keybindPresets: state.keybindPresets,
        activeKeybindPreset: state.activeKeybindPreset,
      }),
    }
  )
);

export const useSettings = () => {
  const settings = useAppStore((state) => state.settings);
  const setSettings = useAppStore((state) => state.setSettings);
  return [settings, setSettings] as const;
};

export const useDocuments = () => {
  const documents = useAppStore((state) => state.documents);
  const activeDocumentId = useAppStore((state) => state.activeDocumentId);
  const setDocuments = useAppStore((state) => state.setDocuments);
  const setActiveDocument = useAppStore((state) => state.setActiveDocument);
  const isLoading = useAppStore((state) => state.isLoading);
  const isDirty = useAppStore((state) => state.isDirty);
  
  return {
    documents,
    activeDocument: activeDocumentId ? documents.find((d) => d.id.uuid === activeDocumentId) : null,
    activeDocumentId,
    isLoading,
    isDirty,
    setDocuments,
    setActiveDocument,
  };
};

export const useUI = () => {
  const panels = useAppStore((state) => state.panels);
  const activeTool = useAppStore((state) => state.activeTool);
  const commandPaletteOpen = useAppStore((state) => state.commandPaletteOpen);
  const statusMessage = useAppStore((state) => state.statusMessage);
  const setPanelVisibility = useAppStore((state) => state.setPanelVisibility);
  const togglePanel = useAppStore((state) => state.togglePanel);
  const setPanelCollapsed = useAppStore((state) => state.setPanelCollapsed);
  const setActiveTool = useAppStore((state) => state.setActiveTool);
  const setCommandPaletteOpen = useAppStore((state) => state.setCommandPaletteOpen);
  const setStatusMessage = useAppStore((state) => state.setStatusMessage);
  
  return {
    panels,
    activeTool,
    commandPaletteOpen,
    statusMessage,
    setPanelVisibility,
    togglePanel,
    setPanelCollapsed,
    setActiveTool,
    setCommandPaletteOpen,
    setStatusMessage,
  };
};

export const useViewport = () => {
  const cameras = useAppStore((state) => state.viewportCameras);
  const activeViewport = useAppStore((state) => state.activeViewport);
  const layout = useAppStore((state) => state.viewportLayout);
  const setViewportCamera = useAppStore((state) => state.setViewportCamera);
  const setActiveViewport = useAppStore((state) => state.setActiveViewport);
  const setViewportLayout = useAppStore((state) => state.setViewportLayout);
  
  return {
    cameras,
    activeViewport,
    layout,
    setViewportCamera,
    setActiveViewport,
    setViewportLayout,
  };
};

export const useInput = () => {
  const mousePosition = useAppStore((state) => state.mousePosition);
  const mouseButtons = useAppStore((state) => state.mouseButtons);
  const keysPressed = useAppStore((state) => state.keysPressed);
  const modifiers = useAppStore((state) => state.modifiers);
  const setMousePosition = useAppStore((state) => state.setMousePosition);
  const setMouseButton = useAppStore((state) => state.setMouseButton);
  const setKeyPressed = useAppStore((state) => state.setKeyPressed);
  const setModifiers = useAppStore((state) => state.setModifiers);
  
  const isKeyDown = (key: string) => keysPressed.has(key.toLowerCase());
  const isModifierDown = (mod_: 'shift' | 'ctrl' | 'alt' | 'meta') => modifiers[mod_];
  
  return {
    mousePosition,
    mouseButtons,
    keysPressed,
    modifiers,
    isKeyDown,
    isModifierDown,
    setMousePosition,
    setMouseButton,
    setKeyPressed,
    setModifiers,
  };
};