import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ipc } from "./ipc";
import type { AppOverview, SceneData, Settings, PluginInfo } from "./types";
import { useArcStore } from "./store";

interface SceneEnvelope {
  documentId: string;
  scene: SceneData;
}

let refs = 0;
let active = false;
let bootPromise: Promise<void> | null = null;
let stopPolling: (() => void) | null = null;
const unlisteners: UnlistenFn[] = [];

function teardown() {
  unlisteners.splice(0).forEach((u) => u());
  stopPolling?.();
  stopPolling = null;
}

function release() {
  refs -= 1;
  if (refs === 0) {
    bootPromise = null;
    if (active) {
      active = false;
      teardown();
    }
  }
}

async function runBoot(): Promise<void> {
  unlisteners.splice(0).forEach((u) => u());
  unlisteners.push(
    ...(await Promise.all([
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
    ])),
  );

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
  void ipc.getPlugins().then((list) => useArcStore.setState({ pluginsList: list })).catch(() => {});
  if (!active) return;

  // Fallback sync: events can be starved in some WebKit environments, so poll
  // the invoke path and refresh the store when the snapshot version advances.
  let lastSceneVersion = -1;
  let lastOverview = "";
  let lastSettings = "";
  const tick = setInterval(() => {
    const state = useArcStore.getState();
    const active = state.overview?.active ?? null;
    if (active) {
      void ipc
        .getScene(active)
        .then((scene) => {
          if (scene.version !== lastSceneVersion) {
            lastSceneVersion = scene.version;
            useArcStore.getState().setScene(scene);
          }
        })
        .catch(() => {});
    }
    void ipc
      .getState()
      .then((next) => {
        const key = JSON.stringify(next);
        if (next && key !== lastOverview && state.overview) {
          lastOverview = key;
          useArcStore.getState().setOverview(next);
        }
      })
      .catch(() => {});
    void ipc
      .getSettings()
      .then((settings) => {
        const key = JSON.stringify(settings);
        if (key !== lastSettings && state.settings) {
          lastSettings = key;
          useArcStore.getState().updateSettings(settings);
        }
      })
      .catch(() => {});
  }, 1200);
  stopPolling = () => clearInterval(tick);
}

/** Attach backend event listeners and do the initial data load. Refcounted:
 * concurrent callers share one boot, and the last release tears it down, which
 * also keeps React StrictMode double mounting stable. */
export function initEvents(): Promise<() => void> {
  refs += 1;
  if (!bootPromise) {
    active = true;
    bootPromise = runBoot();
  }
  return (async () => {
    try {
      if (bootPromise) await bootPromise;
    } catch (error) {
      release();
      throw error;
    }
    return release;
  })();
}

export async function refreshOverview(): Promise<void> {
  const overview = await ipc.getState().catch(() => null);
  if (overview) useArcStore.getState().setOverview(overview);
}
