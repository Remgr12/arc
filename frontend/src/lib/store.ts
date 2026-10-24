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
  sketchPlaneNormal: [number, number, number];
  sketchPlaneOrigin: [number, number, number];
  sketchPlaneLabel: string;
  polygonSides: number;
  /** Dimension & drag snap increment in world units (cm). 0 = free. */
  dimSnapStep: number;
  /** Laptop performance mode: disables shadows, IBL, and caps DPR at 1.0. */
  lowSpecMode: boolean;
  /** Left Items/Layers sidebar open state (Shapr3D Items toggle). */
  leftSidebarOpen: boolean;
  /** Right History/Properties sidebar open state (Shapr3D History toggle). */
  rightSidebarOpen: boolean;
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
  enterSketchMode: (opts?: {
    height?: number;
    origin?: [number, number, number];
    normal?: [number, number, number];
    label?: string;
    tool?: ToolId;
  }) => void;
  exitSketchMode: () => void;
  setPolygonSides: (sides: number) => void;
  setDimSnapStep: (step: number) => void;
  setLowSpecMode: (enabled: boolean) => void;
  setLeftSidebarOpen: (open: boolean) => void;
  setRightSidebarOpen: (open: boolean) => void;
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

const FAST_MODE_STORAGE_KEY = "arc:fast_mode";

function loadStoredFastMode(): boolean {
  try {
    const v = localStorage.getItem(FAST_MODE_STORAGE_KEY);
    if (v !== null) return v === "true";
  } catch {
    // ignore
  }
  return false;
}

function saveStoredFastMode(enabled: boolean): void {
  try {
    localStorage.setItem(FAST_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // ignore
  }
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
  activeToolCategory: "all",
  displayMode: "shaded",
  isolated: false,
  isolatedHiddenIds: [],
  sectionView: false,
  sectionOffset: 0,
  sketchMode: false,
  sketchPlaneHeight: 0,
  sketchPlaneNormal: [0, 1, 0],
  sketchPlaneOrigin: [0, 0, 0],
  sketchPlaneLabel: "Ground (Y = 0)",
  polygonSides: 6,
  dimSnapStep: 1,
  lowSpecMode: loadStoredFastMode(),
  leftSidebarOpen: true,
  rightSidebarOpen: true,
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
    set((st) => {
      let resolved = tool;
      if (st.selKind === "face" && st.selFace !== null) {
        if (tool === "extrude") resolved = "extrude-face";
        else if (tool === "offset") resolved = "offset-face";
      } else if (st.selKind === "edge" && st.selEdge !== null) {
        if (tool === "fillet") resolved = "fillet-edge";
      }
      return {
        tool: resolved,
        sketchMode: SKETCH_TOOL_SET.has(resolved) ? true : st.sketchMode,
      };
    }),
  setDrafting: (drafting: boolean) => set({ drafting }),
  updateSettings: (settings: any) =>
    set((_st) => {
      if (settings?.fast_mode !== undefined) {
        saveStoredFastMode(Boolean(settings.fast_mode));
      }
      return {
        settings,
        lowSpecMode:
          settings?.fast_mode !== undefined ? Boolean(settings.fast_mode) : _st.lowSpecMode,
        overview: _st.overview ? { ..._st.overview, settings } : _st.overview,
      };
    }),
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
    set((st) => {
      const rounded = Math.round(height * 100) / 100;
      const n = st.sketchPlaneNormal;
      const origin: [number, number, number] = [
        n[0] * rounded,
        n[1] * rounded,
        n[2] * rounded,
      ];
      return {
        sketchPlaneHeight: rounded,
        sketchPlaneOrigin: origin,
        sketchPlaneLabel:
          label ??
          (Math.abs(n[1]) >= 0.9
            ? Math.abs(rounded) < 1e-4
              ? "Top XZ (Y = 0)"
              : `Top XZ (Y = ${rounded})`
            : Math.abs(n[2]) >= 0.9
              ? `Front XY (Z = ${rounded})`
              : `Right YZ (X = ${rounded})`),
      };
    }),
  enterSketchMode: (opts) =>
    set((st) => {
      const rawN = opts?.normal ?? (opts?.height !== undefined ? [0, 1, 0] : st.sketchPlaneNormal);
      const len = Math.hypot(rawN[0], rawN[1], rawN[2]) || 1;
      const normal: [number, number, number] = [rawN[0] / len, rawN[1] / len, rawN[2] / len];
      const origin: [number, number, number] = opts?.origin
        ? [
            Math.round(opts.origin[0] * 100) / 100,
            Math.round(opts.origin[1] * 100) / 100,
            Math.round(opts.origin[2] * 100) / 100,
          ]
        : opts?.height !== undefined
          ? [0, Math.round(opts.height * 100) / 100, 0]
          : st.sketchPlaneOrigin;
      const offset =
        Math.round((origin[0] * normal[0] + origin[1] * normal[1] + origin[2] * normal[2]) * 100) /
        100;
      const autoLabel =
        Math.abs(normal[1]) >= 0.9
          ? Math.abs(offset) < 1e-4
            ? "Top XZ (Y = 0)"
            : `Face XZ (Y = ${offset})`
          : Math.abs(normal[2]) >= 0.9
            ? `Front XY (Z = ${offset})`
            : Math.abs(normal[0]) >= 0.9
              ? `Side YZ (X = ${offset})`
              : `Face Plane (${offset})`;
      const label = opts?.label ?? autoLabel;
      const nextTool = opts?.tool ?? (SKETCH_TOOL_SET.has(st.tool) ? st.tool : "line");
      return {
        sketchMode: true,
        sketchPlaneHeight: offset,
        sketchPlaneNormal: normal,
        sketchPlaneOrigin: origin,
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
  setDimSnapStep: (step) => set({ dimSnapStep: Math.max(0, step) }),
  setLowSpecMode: (lowSpecMode) => {
    saveStoredFastMode(lowSpecMode);
    set({ lowSpecMode });
  },
  setLeftSidebarOpen: (leftSidebarOpen) => set({ leftSidebarOpen }),
  setRightSidebarOpen: (rightSidebarOpen) => set({ rightSidebarOpen }),
  setView: (view) => set({ view }),
  openContextMenu: (x, y, items) => set({ contextMenu: { open: true, x, y, items } }),
  closeContextMenu: () => set((st) => (st.contextMenu.open ? { contextMenu: { ...st.contextMenu, open: false } } : st)),
}));