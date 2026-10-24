import { ipc } from "./ipc";
import { useArcStore } from "./store";
import { MATERIALS } from "./materials";
import { DEFAULT_GEOMETRY } from "../data/tools";
import type { ToolId } from "./types";

function guard<A extends unknown[]>(
  action: (...args: A) => Promise<unknown>,
): (...args: A) => void {
  return (...args: A) => {
    void Promise.resolve(action(...args)).catch((e: unknown) => {
      useArcStore.getState().setStatusMessage(`Error: ${String(e)}`);
    });
  };
}

function requireDoc(): string {
  const id = useArcStore.getState().overview?.active;
  if (!id) throw new Error("no active document");
  return id;
}

export const actions = {  booleanApply: guard(async (operation: "union" | "difference" | "intersection") => {
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
    useArcStore.getState().setView("editor");
  }),

  /** Open a workspace project by path, reusing an already-open document. */
  openProjectPath: guard(async (path: string) => {
    if (!path) return;
    const overview = useArcStore.getState().overview;
    const existing = overview?.documents.find((d) => d.path === path);
    if (existing) {
      await ipc.setActiveDocument(existing.id);
      useArcStore.getState().setScene(await ipc.getScene(existing.id));
    } else {
      await ipc.openDocument(path);
      const next = await ipc.getState();
      useArcStore.getState().setOverview(next);
      if (next.active) {
        useArcStore.getState().setScene(await ipc.getScene(next.active));
      }
    }
    useArcStore.getState().setView("editor");
  }),

  /** Create a named project inside the workspace folder and open it. */
  createWorkspaceProject: guard(async (rawName: string) => {
    const name = rawName.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!name) return;
    let folder = useArcStore.getState().workspaceFolder;
    if (!folder) {
      useArcStore.getState().setStatusMessage("Set a workspace folder first");
      return;
    }
    folder = folder.replace(/[\\/]+$/, "");
    const doc = await ipc.newDocument(name);
    await ipc.saveDocument(doc.id, `${folder}/${name}.arc`);
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
    useArcStore.getState().setStatusMessage(`Created ${name}`);
    useArcStore.getState().setView("editor");
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
    useArcStore.getState().setView("editor");
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
    await maybeCaptureThumbnail(id);
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

  applyMaterial: guard(async (query: string) => {
    const docId = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene) return;
    if (scene.selection.length === 0) {
      useArcStore.getState().setStatusMessage("Select entities to apply a material");
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      useArcStore.getState().setStatusMessage("Usage: material <id or label>");
      return;
    }
    const material =
      MATERIALS.find((m) => m.id.toLowerCase() === q) ??
      MATERIALS.find((m) => m.label.toLowerCase() === q) ??
      MATERIALS.find(
        (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
      );
    if (!material) {
      useArcStore.getState().setStatusMessage(`No material matching "${query.trim()}"`);
      return;
    }
    for (const id of scene.selection) {
      await ipc.setEntityMaterial(docId, id, material.id);
    }
    useArcStore.getState().setScene(await ipc.getScene(docId));
    useArcStore
      .getState()
      .setStatusMessage(
        `Applied ${material.label} to ${scene.selection.length} ${scene.selection.length === 1 ? "entity" : "entities"}`,
      );
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

  /** Toggle isolation: hide everything not selected; off shows everything. */
  isolateSelection: guard(async () => {
    const id = requireDoc();
    const store = useArcStore.getState();
    const scene = store.scene;
    if (!scene) return;
    if (store.isolated) {
      for (const entity of scene.entities) {
        if (!entity.visible) {
          await ipc.setEntityProps(id, entity.id, { visible: true });
        }
      }
      store.setIsolated(false);
      return;
    }
    if (scene.selection.length === 0) {
      store.setStatusMessage("Select something to isolate");
      return;
    }
    for (const entity of scene.entities) {
      const hidden = !scene.selection.includes(entity.id);
      if (entity.visible === !hidden) continue;
      await ipc.setEntityProps(id, entity.id, { visible: entity.visible && false });
    }
    store.setIsolated(true);
    store.setStatusMessage(`Isolated ${scene.selection.length} entities`);
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

  openCommandLine: guard(async () => {
    useArcStore.getState().setCommandLineOpen(true);
  }),

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
  await maybeCaptureThumbnail(id);
}
/** Ask the viewport renderer for the current frame (downscaled PNG data URL). */
export function requestViewportThumbnail(): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 300);
    window.dispatchEvent(
      new CustomEvent("arc-capture-thumb", {
        detail: (url: string | null) => {
          window.clearTimeout(timer);
          resolve(url);
        },
      }),
    );
  });
}

/** Best-effort: capture the viewport and store it next to the saved file. */
async function maybeCaptureThumbnail(docId: string): Promise<void> {
  try {
    const scene = useArcStore.getState().scene;
    if (!scene || scene.entities.length === 0) {
      useArcStore.getState().setStatusMessage("Saved (thumbnail skipped: empty scene)");
      return;
    }
    const url = await requestViewportThumbnail();
    if (!url) {
      useArcStore.getState().setStatusMessage("Saved (thumbnail: no frame)");
      return;
    }
    await ipc.saveProjectThumbnail(docId, url);
  } catch (e) {
    useArcStore.getState().setStatusMessage(`Saved (thumbnail failed: ${String(e)})`);
  }
}

/** Create geometry for the active tool at a world point (creation tools). */
export function geometryForTool(tool: ToolId): { type: string } | null {
  return DEFAULT_GEOMETRY[tool] ?? null;
}
