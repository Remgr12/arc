import { ipc } from "./ipc";
import { useArcStore } from "./store";

/**
 * Performant, non-intrusive auto-save service:
 * - Debounces file writes after 2 seconds of user inactivity.
 * - Caps max wait at 8 seconds under continuous editing.
 * - Flushes pending saves immediately on window blur or visibility change.
 * - Never shows annoying modal file pickers during auto-save.
 * - Performs background saves silently without disrupting status messages or UI framerate.
 */

const IDLE_DEBOUNCE_MS = 2000;
const MAX_WAIT_MS = 8000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
let isSaving = false;
let pendingDocId: string | null = null;
let pendingPath: string | null = null;

async function executeAutoSave(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (maxWaitTimer) {
    clearTimeout(maxWaitTimer);
    maxWaitTimer = null;
  }

  const docId = pendingDocId;
  const path = pendingPath;
  pendingDocId = null;
  pendingPath = null;

  if (!docId || isSaving) return;

  const st = useArcStore.getState();
  const autoSaveEnabled = st.settings?.auto_save ?? true;
  if (!autoSaveEnabled) return;

  const doc = st.overview?.documents.find((d) => d.id === docId);
  if (!doc || !doc.dirty) return;

  isSaving = true;
  try {
    await ipc.saveDocument(docId, path ?? undefined);
    const scene = useArcStore.getState().scene;
    if (scene && !scene.path && path) {
      useArcStore.setState({ scene: { ...scene, path } });
    }
  } catch (error) {
    console.warn("[autosave] background save skipped/failed:", error);
  } finally {
    isSaving = false;
  }
}

function scheduleAutoSave(docId: string, path: string | null): void {
  pendingDocId = docId;
  pendingPath = path;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void executeAutoSave();
  }, IDLE_DEBOUNCE_MS);

  if (!maxWaitTimer) {
    maxWaitTimer = setTimeout(() => {
      void executeAutoSave();
    }, MAX_WAIT_MS);
  }
}

/** Check if active or dirty document needs auto-saving. */
function checkAutoSave(): void {
  const st = useArcStore.getState();
  const autoSaveEnabled = st.settings?.auto_save ?? true;
  if (!autoSaveEnabled) return;

  const overview = st.overview;
  const activeId = overview?.active;
  if (!activeId) return;

  const doc = overview.documents.find((d) => d.id === activeId);
  if (!doc || !doc.dirty) return;

  // Resolve target path without prompting the user
  let path = doc.path ?? st.scene?.path ?? null;
  if (!path && st.workspaceFolder) {
    const safeName = doc.name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Untitled";
    const folder = st.workspaceFolder.replace(/[\\/]+$/, "");
    path = `${folder}/${safeName}.arc`;
  }

  // If no path is known and no workspace folder is configured, do NOT pop up a file picker!
  if (!path) return;

  scheduleAutoSave(activeId, path);
}

export function initAutoSave(): () => void {
  let lastDirty = false;
  let lastActiveDocId: string | null = null;

  const unsubscribeStore = useArcStore.subscribe((state) => {
    const activeId = state.overview?.active ?? null;
    const doc = activeId ? state.overview?.documents.find((d) => d.id === activeId) : null;
    const isDirty = Boolean(doc?.dirty);

    // If switching documents and the previous document had unsaved changes, flush it immediately
    if (lastActiveDocId && activeId !== lastActiveDocId && pendingDocId === lastActiveDocId) {
      void executeAutoSave();
    }

    lastActiveDocId = activeId;

    if (isDirty && (!lastDirty || pendingDocId !== activeId)) {
      checkAutoSave();
    }
    lastDirty = isDirty;
  });

  // Flush on window blur or when user switches tabs/apps
  const onBlurOrHide = () => {
    if (pendingDocId) {
      void executeAutoSave();
    }
  };

  window.addEventListener("blur", onBlurOrHide);
  document.addEventListener("visibilitychange", onBlurOrHide);

  return () => {
    unsubscribeStore();
    window.removeEventListener("blur", onBlurOrHide);
    document.removeEventListener("visibilitychange", onBlurOrHide);
    if (debounceTimer) clearTimeout(debounceTimer);
    if (maxWaitTimer) clearTimeout(maxWaitTimer);
    void executeAutoSave();
  };
}
