import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "./ipc";
import type { AppOverview, SceneData, Settings, PluginInfo } from "./types";
import { useArcStore } from "./store";

let unlisteners: UnlistenFn[] = [];
let started = false;

/** Attach backend event listeners and do the initial data load. */
export async function initEvents(): Promise<() => void> {
  if (started) return () => {};
  started = true;

  unlisteners = await Promise.all([
    listen<SceneEnvelope>("arc://scene", (e) => {
      const { documentId, scene } = e.payload;
      const active = useArcStore.getState().overview?.active ?? null;
      if (active && documentId === active) {
        useArcStore.getState().setScene(scene);
      } else if (active === null) {
        useArcStore.getState().setScene(scene);
        void refreshOverview();
      }
    }),
    listen<AppOverview>("arc://documents", (e) => {
      useArcStore.getState().setOverview(e.payload);
      const active = e.payload.active;
      if (active) {
        void ipc
          .getScene(active)
          .then((scene) => useArcStore.getState().setScene(scene))
          .catch(() => useArcStore.setState({ scene: null }));
      } else {
        useArcStore.setState({ scene: null });
      }
    }),
    listen<Settings>("arc://settings", (e) => {
      useArcStore.getState().updateSettings(e.payload);
    }),
    listen<PluginInfo[]>("arc://plugins", (e) => {
      useArcStore.setState({ pluginsList: e.payload });
    }),
  ]);

  const overview = await ipc.getState().catch(() => null);
  if (overview) {
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      await ipc
        .getScene(overview.active)
        .then((scene) => useArcStore.getState().setScene(scene))
        .catch(() => {});
    }
  }

  return () => {
    unlisteners.forEach((u) => u());
    unlisteners = [];
    started = false;
  };
}

interface SceneEnvelope {
  documentId: string;
  scene: SceneData;
}

export async function refreshOverview(): Promise<void> {
  const overview = await ipc.getState().catch(() => null);
  if (overview) useArcStore.getState().setOverview(overview);
}
