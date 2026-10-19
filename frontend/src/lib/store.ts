import { create } from "zustand";
import type {
  AppOverview,
  PluginInfo,
  SceneData,
  Settings,
  ToolId,
  UpdateNotice,
} from "./types";

interface ArcState {
  overview: AppOverview | null;
  scene: SceneData | null;
  sceneVersion: number;
  tool: ToolId;
  drafting: boolean;
  settings: Settings | null;
  pluginsList: PluginInfo[];
  paletteOpen: boolean;
  commandLineOpen: boolean;
  settingsOpen: boolean;
  pluginsOpen: boolean;
  materialsOpen: boolean;
  startupOpen: boolean;
  onboardingOpen: boolean;
  workspaceFolder: string | null;
  updateNotice: UpdateNotice | null;
  updateDismissedVersion: string | null;
  hoverEntity: string | null;
  selectionVersion: number;
  statusMessage: string;
  cursorWorld: [number, number, number];

  setOverview: (o: AppOverview) => void;
  setScene: (scene: SceneData) => void;
  setPlugins: (plugins: PluginInfo[]) => void;
  setTool: (tool: ToolId) => void;
  setDrafting: (drafting: boolean) => void;
  updateSettings: (settings: Settings) => void;
  setPaletteOpen: (open: boolean) => void;
  setCommandLineOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPluginsOpen: (open: boolean) => void;
  setMaterialsOpen: (open: boolean) => void;
  setStartupOpen: (open: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;
  setWorkspaceFolder: (folder: string | null) => void;
  setUpdateNotice: (notice: UpdateNotice | null) => void;
  dismissUpdateNotice: (version: string) => void;
  setHoverEntity: (id: string | null) => void;
  setStatusMessage: (msg: string) => void;
  setCursorWorld: (c: [number, number, number]) => void;
}

export const useArcStore = create<ArcState>((set) => ({
  overview: null,
  scene: null,
  sceneVersion: 0,
  tool: "select",
  drafting: false,
  settings: null,
  pluginsList: [],
  paletteOpen: false,
  commandLineOpen: false,
  settingsOpen: false,
  pluginsOpen: false,
  materialsOpen: false,
  startupOpen: true,
  onboardingOpen: false,
  workspaceFolder: null,
  updateNotice: null,
  updateDismissedVersion: null,
  hoverEntity: null,
  selectionVersion: 0,
  statusMessage: "Ready",
  cursorWorld: [0, 0, 0],

  setOverview: (o) => set({ overview: o, settings: o.settings }),
  setScene: (scene) => set({ scene, sceneVersion: scene.version }),
  setPlugins: (pluginsList) => set({ pluginsList }),
  setTool: (tool) => set({ tool }),
  setDrafting: (drafting) => set({ drafting }),
  updateSettings: (settings) =>
    set((st) => ({
      settings,
      overview: st.overview ? { ...st.overview, settings } : st.overview,
    })),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setCommandLineOpen: (open) => set({ commandLineOpen: open }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setPluginsOpen: (open) => set({ pluginsOpen: open }),
  setMaterialsOpen: (open) => set({ materialsOpen: open }),
  setStartupOpen: (open) => set({ startupOpen: open }),
  setOnboardingOpen: (open) => set({ onboardingOpen: open }),
  setWorkspaceFolder: (folder) => set({ workspaceFolder: folder }),
  setUpdateNotice: (updateNotice) => set({ updateNotice }),
  dismissUpdateNotice: (version) => set({ updateNotice: null, updateDismissedVersion: version }),
  setHoverEntity: (id) => set({ hoverEntity: id }),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setCursorWorld: (c) => set({ cursorWorld: c }),
}));
