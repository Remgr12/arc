import { create } from "zustand";
import type { AppOverview, SceneData, ToolId } from "./types";

interface ArcState {
  overview: AppOverview | null;
  scene: SceneData | null;
  sceneVersion: number;
  tool: ToolId;
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
   activeToolCategory: string;
  displayMode: "shaded" | "wireframe";
  isolated: boolean;
  isolatedHiddenIds: string[];
  sectionView: boolean;
  sectionOffset: number;
  sketchMode: boolean;
  sketchPlaneHeight: number;
  sketchPlaneLabel: string;
  polygonSides: number;
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

  setOverview: (o: AppOverview | null) => void;
  setScene: (scene: SceneData | null) => void;
  setPlugins: (plugins: any[]) => void;
  setTool: (tool: ToolId) => void;
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
  setActiveToolCategory: (category: string) => void;
  setDisplayMode: (mode: "shaded" | "wireframe") => void;
  setIsolated: (isolated: boolean) => void;
  setIsolatedHiddenIds: (ids: string[]) => void;
  setSectionView: (enabled: boolean) => void;
  setSectionOffset: (offset: number) => void;
  setSketchPlane: (height: number, label?: string) => void;
  enterSketchMode: (opts?: { height?: number; label?: string; tool?: ToolId }) => void;
  exitSketchMode: () => void;
  setPolygonSides: (sides: number) => void;
  openContextMenu: (x: number, y: number, items: Array<{ label: string; run: () => void; disabled?: boolean }>) => void;
  closeContextMenu: () => void;
}

const SKETCH_TOOL_SET = new Set<ToolId>([
  "line",
  "polyline",
  "rectangle",
  "circle",
  "arc",
  "polygon",
  "offset",
  "trim",
  "extend",
  "fillet",
  "mirror",
]);

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
  activeToolCategory: "all",
  displayMode: "shaded",
  isolated: false,
  isolatedHiddenIds: [],
  sectionView: false,
  sectionOffset: 0,
  sketchMode: false,
  sketchPlaneHeight: 0,
  sketchPlaneLabel: "Ground (Y = 0)",
  polygonSides: 6,
  contextMenu: { open: false, x: 0, y: 0, items: [] },
  view: "dashboard",

  // topology selection defaults
  selKind: "entity",
  selFace: null,
  selEdge: null,

  setOverview: (o: AppOverview | null) => set((_st) => ({ overview: o, settings: o?.settings })),
  setScene: (scene: SceneData | null) => set(({ scene, sceneVersion: scene?.version ?? 0 })),
  setPlugins: (pluginsList: any[]) => set({ pluginsList }),
  setTool: (tool: ToolId) =>
    set((st) => ({
      tool,
      sketchMode: SKETCH_TOOL_SET.has(tool) ? true : st.sketchMode,
    })),
  setDrafting: (drafting: boolean) => set({ drafting }),
  updateSettings: (settings: any) => set((_st) => ({ settings, overview: _st.overview ? { ..._st.overview, settings } : _st.overview })),
  setPaletteOpen: (open: boolean) => set({ paletteOpen: open }),
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
  setActiveToolCategory: (category) => set({ activeToolCategory: category }),
  setDisplayMode: (displayMode) => set({ displayMode }),
  setIsolated: (isolated) => set({ isolated }),
  setIsolatedHiddenIds: (isolatedHiddenIds) => set({ isolatedHiddenIds }),
  setSectionView: (sectionView) => set({ sectionView }),
  setSectionOffset: (sectionOffset) => set({ sectionOffset }),
  setSketchPlane: (height, label) =>
    set({
      sketchPlaneHeight: Math.round(height * 100) / 100,
      sketchPlaneLabel: label ?? (Math.abs(height) < 1e-4 ? "Ground (Y = 0)" : `Plane (Y = ${Math.round(height * 100) / 100})`),
    }),
  enterSketchMode: (opts) =>
    set((st) => {
      const h = opts?.height ?? st.sketchPlaneHeight;
      const rounded = Math.round(h * 100) / 100;
      const label =
        opts?.label ??
        (opts?.height !== undefined
          ? Math.abs(rounded) < 1e-4
            ? "Ground (Y = 0)"
            : `Face Plane (Y = ${rounded})`
          : st.sketchPlaneLabel);
      const nextTool = opts?.tool ?? (SKETCH_TOOL_SET.has(st.tool) ? st.tool : "line");
      return {
        sketchMode: true,
        sketchPlaneHeight: rounded,
        sketchPlaneLabel: label,
        tool: nextTool,
      };
    }),
  exitSketchMode: () =>
    set((st) => ({
      sketchMode: false,
      drafting: false,
      tool: SKETCH_TOOL_SET.has(st.tool) ? "select" : st.tool,
      statusMessage: "Exited sketch mode",
    })),
  setPolygonSides: (sides) => set({ polygonSides: Math.max(3, Math.min(32, Math.round(sides))) }),
  setView: (view) => set({ view }),
  openContextMenu: (x, y, items) => set({ contextMenu: { open: true, x, y, items } }),
  closeContextMenu: () => set((st) => (st.contextMenu.open ? { contextMenu: { ...st.contextMenu, open: false } } : st)),
}));