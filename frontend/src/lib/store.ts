import { create } from "zustand";

interface ArcState {
  overview: any;
  scene: any;
  sceneVersion: number;
  tool: string;
  drafting: boolean;
  settings: any;
  pluginsList: any[];
  paletteOpen: boolean;
  commandLineOpen: boolean;
  settingsOpen: boolean;
  pluginsOpen: boolean;
  materialsOpen: boolean;
  startupOpen: boolean;
  onboardingOpen: boolean;
  workspaceFolder: string | null;
  updateNotice: any;
  updateDismissedVersion: string | null;
  hoverEntity: string | null;
  hoverObj: any;
  selectionVersion: number;
  statusMessage: string;
  cursorWorld: [number, number, number];
  dashboardTransition: boolean;
  viewportReady: boolean;
  activeToolCategory: string;
  displayMode: "shaded" | "wireframe";
  isolated: boolean;
  contextMenu: {
    open: boolean;
    x: number;
    y: number;
    items: Array<{ label: string; run: () => void; disabled?: boolean }>;
  };
  view: "dashboard" | "editor";
  setView: (view: "dashboard" | "editor") => void;

  // topology selection state (for face/edge picking)
  selKind: "entity" | "face" | "edge";
  selFace: { entityId: string; face: number } | null;
  selEdge: { entityId: string; key: string } | null;

  setOverview: (o: any) => void;
  setScene: (scene: any) => void;
  setPlugins: (plugins: any[]) => void;
  setTool: (tool: string) => void;
  setDrafting: (drafting: boolean) => void;
  updateSettings: (settings: any) => void;
  setPaletteOpen: (open: boolean) => void;
  setCommandLineOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setPluginsOpen: (open: boolean) => void;
  setMaterialsOpen: (open: boolean) => void;
  setStartupOpen: (open: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;
  setWorkspaceFolder: (folder: string | null) => void;
  setUpdateNotice: (notice: any) => void;
  dismissUpdateNotice: (version: string) => void;
  setHoverEntity: (id: string | null) => void;
  setHoverObj: (obj: any) => void;
  setSelectionRef: (obj: any) => void;
  setStatusMessage: (msg: string) => void;
  setCursorWorld: (c: [number, number, number]) => void;
  setDashboardTransition: (transition: boolean) => void;
  setViewportReady: (ready: boolean) => void;
  setActiveToolCategory: (category: string) => void;
  setDisplayMode: (mode: "shaded" | "wireframe") => void;
  setIsolated: (isolated: boolean) => void;
  openContextMenu: (x: number, y: number, items: Array<{ label: string; run: () => void; disabled?: boolean }>) => void;
  closeContextMenu: () => void;
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
  hoverObj: null,
  selectionVersion: 0,
  statusMessage: "Ready",
  cursorWorld: [0, 0, 0],
  dashboardTransition: false,
  viewportReady: false,
  activeToolCategory: "all",
  displayMode: "shaded",
  isolated: false,
  contextMenu: { open: false, x: 0, y: 0, items: [] },
  view: "dashboard",

  // topology selection defaults
  selKind: "entity",
  selFace: null,
  selEdge: null,

  setOverview: (o) => set({ overview: o, settings: o.settings }),
  setScene: (scene) => set({ scene, sceneVersion: scene.version }),
  setPlugins: (pluginsList) => set({ pluginsList }),
  setTool: (tool) => set({ tool }),
  setDrafting: (drafting) => set({ drafting }),
  updateSettings: (settings) => set((st) => ({ settings, overview: st.overview ? { ...st.overview, settings } : st.overview })),
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
  setHoverEntity: (id) => set({ hoverEntity: id, hoverObj: null }),
  setHoverObj: (obj) => set({ hoverObj: obj, hoverEntity: obj ? obj.entityId : null }),
  setSelectionRef: (obj) => set((st) => ({
    selKind: obj ? obj.kind : "entity",
    selFace: obj && obj.kind === "face" && obj.face != null ? { entityId: obj.entityId, face: obj.face } : null,
    selEdge: obj && obj.kind === "edge" && obj.edge != null ? { entityId: obj.entityId, key: obj.edge } : null,
    selectionVersion: st.selectionVersion + 1,
  })),
  setStatusMessage: (msg) => set({ statusMessage: msg }),
  setCursorWorld: (c) => set({ cursorWorld: c }),
  setDashboardTransition: (transition) => set({ dashboardTransition: transition }),
  setViewportReady: (ready) => set({ viewportReady: ready }),
  setActiveToolCategory: (category) => set({ activeToolCategory: category }),
  setDisplayMode: (displayMode) => set({ displayMode }),
  setIsolated: (isolated) => set({ isolated }),
  setView: (view) => set({ view }),
  openContextMenu: (x, y, items) => set({ contextMenu: { open: true, x, y, items } }),
  closeContextMenu: () => set((st) => (st.contextMenu.open ? { contextMenu: { ...st.contextMenu, open: false } } : st)),
}));