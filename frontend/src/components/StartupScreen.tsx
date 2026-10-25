import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, FolderOpen, Plus, RefreshCw } from "lucide-react";
import { Button, IconButton, Modal, TextField, cn } from "./ui";
import { ipc } from "../lib/ipc";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { commitWorkspaceFolder } from "../lib/workspace";
import type { ProjectSummary } from "../lib/types";

type SortKey = "name" | "modified" | "size";

interface SortState {
  key: SortKey;
  dir: 1 | -1;
}

const DEFAULT_SORT: SortState = { key: "name", dir: 1 };

export function StartupScreen() {
  const open = useArcStore((s) => s.startupOpen);
  const folder = useArcStore((s) => s.workspaceFolder);
  const projectsCache = useArcStore((s) => s.projectsCache);
  const cached = folder ? projectsCache[folder] : undefined;
  const settingsReady = useArcStore((s) => s.settings !== null);
  const [projects, setProjects] = useState<ProjectSummary[]>(() => cached ?? []);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);

  const close = useCallback(() => {
    useArcStore.getState().setStartupOpen(false);
  }, []);

  useEffect(() => {
    if (!open || !folder) {
      setProjects([]);
      return;
    }
    const hasCached = (useArcStore.getState().projectsCache[folder]?.length ?? 0) > 0;
    if (hasCached && projects.length === 0) {
      setProjects(useArcStore.getState().projectsCache[folder]!);
    }
    let cancelled = false;
    if (!hasCached) {
      setLoading(true);
    }
    ipc
      .listProjects(folder)
      .then((list) => {
        if (!cancelled) {
          setProjects(list);
          const sorted = [...list].sort((a, b) => b.modified - a.modified);
          useArcStore.getState().setProjectsCache(folder, sorted);
        }
      })
      .catch(() => {
        if (!cancelled && !hasCached) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, folder]);

  const sorted = useMemo(() => {
    const list = [...projects];
    list.sort((a, b) => {
      const cmp =
        sort.key === "name"
          ? a.name.localeCompare(b.name)
          : sort.key === "modified"
            ? a.modified - b.modified
            : a.size - b.size;
      return cmp * sort.dir;
    });
    return list;
  }, [projects, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === 1 ? -1 : 1 }
        : { key, dir: 1 },
    );
  };

  const openProject = async (project: ProjectSummary) => {
    if (opening) return;
    setOpening(project.path);
    try {
      await actions.openRecent(project.path);
      close();
    } finally {
      setOpening(null);
    }
  };

  const openOther = async () => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const picked = await openDialog({
      title: "Open document",
      filters: [{ name: "arc documents", extensions: ["arc", "json"] }],
    });
    if (!picked) return;
    close();
    await actions.openRecent(picked as string);
  };

  const changeFolder = async () => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const picked = await openDialog({
      title: "Choose a projects folder",
      directory: true,
    });
    if (typeof picked !== "string" || picked.length === 0) return;
    await commitWorkspaceFolder(picked);
  };

  const startBlank = () => {
    close();
    void actions.newDocument();
  };

  const createProject = async () => {
    const name = naming?.trim();
    if (!folder || !name || saving) return;
    setSaving(true);
    try {
      const doc = await ipc.newDocument(name);
      await ipc.saveDocument(doc.id, `${projectPath(folder)}/${name}.arc`);
      setNaming(null);
      close();
    } catch (error) {
      useArcStore.getState().setStatusMessage(`Save failed: ${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  if (!open || !settingsReady) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-base-50 backdrop-blur-sm">
      <div className="flex h-[540px] w-[820px] overflow-hidden rounded-xl border border-base-200 bg-base-100 shadow-xl">
        <div className="flex w-[220px] shrink-0 flex-col border-r border-base-200 bg-base-50 p-4">
          <div className="flex flex-1 flex-col gap-2">
            <Button variant="primary" onClick={() => setNaming("")}>
              <Plus size={16} /> New project
            </Button>
            <Button variant="ghost" onClick={() => void openOther()}>
              <FolderOpen size={16} /> Open other
            </Button>
            {folder && (
              <span
                className="truncate rounded bg-base-100 px-2 py-1.5 font-mono text-[11.5px] text-base-600"
                title={folder}
              >
                {folder}
              </span>
            )}
            <div className="mt-auto flex flex-col gap-2">
              <Button variant="ghost" onClick={() => void changeFolder()}>
                Change folder
              </Button>
              <Button variant="ghost" onClick={startBlank}>
                Start blank
              </Button>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-200 px-3">
            <span className="text-[11.5px] font-semibold uppercase tracking-wide text-base-600">
              Projects
            </span>
            <IconButton
              icon={<RefreshCw size={14} />}
              onClick={() => setSort({ ...DEFAULT_SORT })}
              title="Reset sort"
              className="hover:bg-base-200"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-base-100">
                <tr className="border-b border-base-200">
                  <SortHeader
                    label="Name"
                    active={sort.key === "name"}
                    dir={sort.dir}
                    onClick={() => toggleSort("name")}
                  />
                  <SortHeader
                    label="Modified"
                    active={sort.key === "modified"}
                    dir={sort.dir}
                    onClick={() => toggleSort("modified")}
                  />
                  <SortHeader
                    label="Size"
                    active={sort.key === "size"}
                    dir={sort.dir}
                    onClick={() => toggleSort("size")}
                  />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-3 py-8 text-center text-[13px] text-base-500"
                    >
                      Loading projects
                    </td>
                  </tr>
                ) : sorted.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center">
                      <div className="text-[13px] text-base-500">
                        No projects in this folder yet.
                      </div>
                      <div className="mt-4">
                        <Button variant="primary" onClick={() => setNaming("")}>
                          <Plus size={16} /> New project
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sorted.map((project) => (
                    <tr
                      key={project.path}
                      onClick={() => void openProject(project)}
                      className={cn(
                        "cursor-pointer border-b border-base-100 text-[13px] text-base-700 transition-colors hover:bg-base-100",
                        opening === project.path && "opacity-60",
                      )}
                    >
                      <td className="truncate px-3 py-2 font-medium text-base-900">
                        {project.name}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-base-600">
                        {formatDate(project.modified)}
                      </td>
                      <td className="px-3 py-2 font-mono text-[12px] text-base-600">
                        {formatSize(project.size)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <Modal
        open={naming !== null}
        onClose={() => !saving && setNaming(null)}
        title="New project"
        width="w-[380px]"
      >
        <div className="flex flex-col gap-4">
          <TextField
            value={naming ?? ""}
            onChange={(value) => setNaming(value)}
            placeholder="project name"
            mono
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNaming(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving || !naming?.trim()}
              onClick={() => void createProject()}
            >
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function SortHeader({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: 1 | -1;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "inline-flex items-center gap-1 text-[11.5px] font-semibold uppercase tracking-wide transition-colors",
          active ? "text-accent-400" : "text-base-600 hover:text-base-900",
        )}
      >
        {label}
        {active && (
          <span className="text-[11px]">
            {dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
          </span>
        )}
      </button>
    </th>
  );
}

function formatDate(modified: number): string {
  if (!modified) return "-";
  const date = new Date(modified * 1000);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return date.toLocaleDateString();
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function projectPath(folder: string): string {
  return folder.replace(/[\\/]+$/, "");
}
