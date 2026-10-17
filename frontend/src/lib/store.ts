import { create } from "zustand";
import type { AppOverview, PluginInfo, SceneData, Settings, ToolId } from "./types";

interface ArcState {
  overview: AppOverview | null;
  scene: SceneData | null;
  sceneVersion: number;
  tool: ToolId;
  settings: Settings | null;
  pluginsList: PluginInfo[];
  paletteOpen: boolean;
  settingsOpen: boolean;
  pluginsOpen: boolean;
  hoverEntity: string | null;
  selectionVersion: number;
  statusMessage: string;
  cursorWorld: [number, number, number];

  setOverview: (o: AppOverview) => void;
  setScene: (scene: SceneData) => void;
  setPlugins: (plugins: PluginInfo[]) => void;
  setTool: (tool: ToolId) => void;
  updateSettings: (settings: Settings) => void;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPluginsOpen: (open: boolean) => void;
  setHoverEntity: (id: string | null) => void;
  setStatusMessage: (msg: string) => void;
  setCursorWorld: (c: [number, number, number]) => void;
}

export const useArcStore = create<ArcState>((set) => ({
  overview: null,
  scene: null,
  sceneVersion: 0,
  tool: "select",
  settings: null,
  pluginsList: [],
  paletteOpen: false,
  settingsOpen: false,
  pluginsOpen: false,
  hoverEntity: null,
  selectionVersion: 0,
  statusMessage: "Ready",
  cursorWorld: [0, 0, 0],

  setOverview: (o) => set({ overview: o, settings: o.settings }),
  setScene: (scene) => set({ scene, sceneVersion: scene.version }),
  setPlugins: (pluginsList) => set({ pluginsList }),
  setTool: (tool) => set({ tool }),
  updateSettings: (settings) =>
    set((st) => ({
      settings,
      overview: st.overview ? { ...st.overview, settings } : st.overview,
    })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setPluginsOpen: (open) => set({ pluginsOpen: open }),
  setHoverEntity: (id) => set({ hoverEntity: id }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setCursorWorld: (c) => set({ cursorWorld: c }),
}));
