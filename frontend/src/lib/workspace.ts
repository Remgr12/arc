import { ipc } from "./ipc";
import { useArcStore } from "./store";

const WORKSPACE_KEY = "arc.workspace.v1";

export interface WorkspacePrefs {
  folder: string;
}

export function loadWorkspacePrefs(): WorkspacePrefs | null {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<WorkspacePrefs> | null;
    if (data && typeof data.folder === "string" && data.folder.length > 0) {
      return { folder: data.folder };
    }
  } catch {}
  return null;
}

export async function commitWorkspaceFolder(folder: string): Promise<void> {
  try {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ folder }));
  } catch {}
  const settings = useArcStore.getState().settings;
  if (settings) {
    const next = await ipc.setSettings({ ...settings, workspace_dir: folder });
    useArcStore.getState().updateSettings(next);
  }
  useArcStore.getState().setWorkspaceFolder(folder);
}

export function decideStartupFlow(): void {
  const st = useArcStore.getState();
  const prefs = loadWorkspacePrefs();
  const folder = prefs?.folder ?? st.settings?.workspace_dir ?? null;
  st.setWorkspaceFolder(folder);
  if (!folder) {
    st.setStartupOpen(false);
    st.setOnboardingOpen(true);
    return;
  }
  const overview = st.overview;
  const active = overview?.documents.find((d) => d.id === overview.active);
  const restored = Boolean(overview?.settings.reopen_last_session && active?.path);
  if (restored) st.setStartupOpen(false);
}
