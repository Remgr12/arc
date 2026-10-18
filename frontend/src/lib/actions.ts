import { ipc } from "./ipc";
import { useArcStore } from "./store";
import { DEFAULT_GEOMETRY } from "../data/tools";
import type { ToolId } from "./types";

function guard<A extends unknown[]>(
  action: (...args: A) => Promise<unknown>,
): (...args: A) => void {
  return (...args: A) => {
    void Promise.resolve(action(...args)).catch((e) => {
      useArcStore.getState().setStatusMessage(`Error: ${String(e)}`);
    });
  };
}

function requireDoc(): string {
  const id = useArcStore.getState().overview?.active;
  if (!id) throw new Error("no active document");
  return id;
}

export const actions = {
  booleanApply: guard(async (operation: "union" | "difference" | "intersection") => {
    const docId = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene) return;
    const [first, second] = scene.selection;
    if (!first || !second) {
      useArcStore.getState().setStatusMessage("Select exactly two solid entities to combine");
      return;
    }
    try {
      const result = await ipc.csgApply(docId, operation, first, second);
      const overview = await ipc.getState();
      useArcStore.getState().setOverview(overview);
      useArcStore.getState().setScene(await ipc.getScene(docId));
      await ipc.setSelection(docId, [result.id], result.id);
      useArcStore
        .getState()
        .setStatusMessage(`${operation[0].toUpperCase()}${operation.slice(1)} created`);
    } catch (error) {
      useArcStore.getState().setStatusMessage(`Boolean failed: ${String(error)}`);
    }
  }),

  refresh: guard(async () => {
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
  }),

  newDocument: guard(async () => {
    await ipc.newDocument();
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
  }),

  openDocument: guard(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      title: "Open document",
      filters: [{ name: "arc documents", extensions: ["arc", "json"] }],
    });
    if (!path) return;
    await actions.openRecent(path as string);
  }),

  openRecent: guard(async (path: string) => {
    if (!path) return;
    await ipc.openDocument(path);
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
  }),

  importFile: guard(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      title: "Import geometry",
      filters: [{ name: "Geometry (STL / OBJ / DXF)", extensions: ["stl", "obj", "dxf"] }],
    });
    if (!path) return;
    const docId = requireDoc();
    const result = await ipc.importFile(docId, path as string);
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
    useArcStore
      .getState()
      .setStatusMessage(`Imported ${result.entities_created.length} entities from ${result.format.toUpperCase()}`);
  }),

  saveActive: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    const existing = scene?.path ?? undefined;
    if (existing) {
      await ipc.saveDocument(id, existing);
    } else {
      await saveDocumentAs();
    }
    useArcStore.getState().setStatusMessage("Saved");
  }),

  saveDocumentAs: guard(async () => {
    await saveDocumentAs();
  }),

  closeActive: guard(async () => {
    const id = requireDoc();
    await ipc.closeDocument(id);
  }),

  switchDocument: guard(async (id?: string) => {
    if (!id) return;
    await ipc.setActiveDocument(id);
  }),

  undo: guard(async () => {
    const id = requireDoc();
    await ipc.undo(id);
  }),

  redo: guard(async () => {
    const id = requireDoc();
    await ipc.redo(id);
  }),

  duplicateSelection: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length === 0) return;
    const created = await ipc.duplicateEntities(id, scene.selection);
    if (created.length > 0) {
      await ipc.setSelection(id, created, created[0]);
    }
  }),

  deleteSelection: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length === 0) return;
    await ipc.deleteEntities(id, scene.selection);
    await ipc.setSelection(id, [], null);
  }),

  explodeSelection: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length < 2) {
      useArcStore.getState().setStatusMessage("Explode needs two or more selected entities");
      return;
    }
    await ipc.explodeEntities(id, scene.selection, 40);
  }),

  selectAll: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.entities.length === 0) return;
    const ids = scene.entities.filter((e) => !e.locked).map((e) => e.id);
    await ipc.setSelection(id, ids, ids[ids.length - 1] ?? null);
  }),

  clearSelection: guard(async () => {
    const id = requireDoc();
    await ipc.setSelection(id, [], null);
  }),

  setTool: (tool: ToolId) => {
    useArcStore.getState().setTool(tool);
  },

  setLayerActive: guard(async (layerId?: string) => {
    const id = requireDoc();
    if (!layerId) return;
    await ipc.setActiveLayer(id, layerId);
  }),

  addLayer: guard(async () => {
    const id = requireDoc();
    await ipc.addLayer(id);
  }),

  exportActive: guard(async (format?: string) => {
    const fmt = (format ?? "obj") as string;
    const id = requireDoc();
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext = fmt === "gltf" ? "gltf" : fmt === "obj" ? "obj" : "stl";
    const path = await save({
      title: `Export ${fmt === "stl_ascii" ? "STL ASCII" : fmt.toUpperCase()}`,
      filters: [{ name: fmt === "stl_ascii" ? "STL ASCII" : fmt.toUpperCase(), extensions: [ext] }],
      defaultPath: `${useArcStore.getState().scene?.name ?? "scene"}.${ext}`,
    });
    if (!path) return;
    await ipc.exportScene(id, path as string, fmt);
    useArcStore.getState().setStatusMessage(`Exported ${(path as string).slice(-40)}`);
  }),

  fitView: () => {
    window.dispatchEvent(new CustomEvent("arc-fit-view"));
  },

  togglePalette: () => {
    const st = useArcStore.getState();
    st.setPaletteOpen(!st.paletteOpen);
  },

  openSettings: () => {
    useArcStore.getState().setSettingsOpen(true);
  },

  openPlugins: () => {
    useArcStore.getState().setPluginsOpen(true);
  },

  reloadPlugins: guard(async () => {
    const list = await ipc.reloadPlugins();
    useArcStore.getState().setPlugins(list);
  }),

  focusEntity: (entityId: string) => {
    window.dispatchEvent(
      new CustomEvent("arc-focus-entity", { detail: { entityId } }),
    );
  },
};

async function saveDocumentAs(): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const id = requireDoc();
  const scene = useArcStore.getState().scene;
  const path = await save({
    title: "Save document",
    filters: [{ name: "arc documents", extensions: ["arc", "json"] }],
    defaultPath: `${scene?.name ?? "Untitled"}.arc`,
  });
  if (!path) return;
  await ipc.saveDocument(id, path as string);
}

/** Create geometry for the active tool at a world point (creation tools). */
export function geometryForTool(tool: ToolId): { type: string } | null {
  return DEFAULT_GEOMETRY[tool] ?? null;
}
