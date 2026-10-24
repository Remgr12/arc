import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  FolderOpen,
  HardDriveDownload,
  Plus,
  Search,
  Settings,
  Upload,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { Button, IconButton, Modal, TextField, cn } from "./ui";
import type { ProjectSummary } from "../lib/types";

export function Dashboard() {
  const folder = useArcStore((s) => s.workspaceFolder);
  const overview = useArcStore((s) => s.overview);
  const openDocuments = useMemo(
    () => (overview?.documents ?? []).filter((d) => d.path),
    [overview],
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(() => {
    if (!folder) {
      setProjects([]);
      setThumbs({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    ipc
      .listProjects(folder)
      .then(async (list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => b.modified - a.modified);
        setProjects(sorted);
        for (const project of sorted.slice(0, 24)) {
          const b64 = await ipc
            .readProjectThumbnail(project.path)
            .catch(() => null);
          if (cancelled) return;
          if (b64) {
            setThumbs((current) => ({
              ...current,
              [project.path]: `data:image/png;base64,${b64}`,
            }));
          }
        }
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  useEffect(() => refresh(), [refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => p.name.toLowerCase().includes(q));
  }, [projects, query]);

  const openProject = async (project: ProjectSummary) => {
    if (opening) return;
    setOpening(project.path);
    try {
      await actions.openProjectPath(project.path);
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
    await actions.openRecent(picked as string);
  };

  const createProject = async () => {
    const name = naming?.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await actions.createWorkspaceProject(name);
      setNaming(null);
    } finally {
      setSaving(false);
    }
  };

  const empty = projects.length === 0;

  return (
    <div className="flex h-full">
      {/* Workspace sidebar */}
      <aside className="flex w-[220px] shrink-0 flex-col border-r border-base-200 bg-base-100">
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-3 pt-4">
          <section className="flex flex-col gap-1">
            <SectionLabel>Workspace</SectionLabel>
            <span
              className="truncate rounded bg-base-50 px-2 py-1.5 font-mono text-[11px] text-base-600"
              title={folder ?? undefined}
            >
              {folder ?? "No workspace folder"}
            </span>
            <DashButton icon={<FolderOpen size={14} />} onClick={() => useArcStore.getState().setStartupOpen(true)}>
              Browse projects…
            </DashButton>
          </section>
          <section className="flex flex-col gap-1">
            <SectionLabel>Open documents</SectionLabel>
            {openDocuments.length === 0 ? (
              <span className="px-2 py-1 text-[11.5px] text-base-500">None</span>
            ) : (
              openDocuments.map((doc) => (
                <button
                  key={doc.id}
                  type="button"
                  onClick={() => void actions.openProjectPath(doc.path as string)}
                  className={cn(
                    "flex items-center justify-between gap-2 truncate rounded px-2 py-1.5 text-left text-[12px] transition-colors",
                    overview?.active === doc.id
                      ? "bg-accent-600/10 text-accent-600"
                      : "text-base-700 hover:bg-base-200",
                  )}
                >
                  <span className="truncate">{doc.name}</span>
                  {doc.dirty && <span className="text-[10px] text-accent-500">•</span>}
                </button>
              ))
            )}
          </section>
        </div>
        <div className="flex flex-col gap-1 border-t border-base-200 p-3">
          {overview?.active && (
            <DashButton
              icon={<ArrowRight size={14} className="text-accent-500" />}
              onClick={() => useArcStore.getState().setView("editor")}
            >
              Return to editor
            </DashButton>
          )}
          <DashButton
            icon={<Settings size={14} />}
            onClick={() => actions.openSettings()}
          >
            Settings…
          </DashButton>
          <DashButton
            icon={<ArrowLeft size={14} />}
            onClick={() => useArcStore.getState().setOnboardingOpen(true)}
          >
            Set up workspace…
          </DashButton>
        </div>
      </aside>

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-base-200 px-6 py-4">
          <div className="flex min-w-0 flex-col">
            <h1 className="text-[16px] font-semibold leading-tight text-base-900">Projects</h1>
            <span className="truncate text-[11.5px] text-base-600">
              {folder
                ? `${projects.length} in ${folder}`
                : "Choose a workspace folder to see your projects"}
            </span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex h-8 w-56 items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-2.5 transition-all focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20">
              <Search size={14} className="shrink-0 text-base-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                className="w-full min-w-0 bg-transparent text-[12px] text-base-800 outline-none placeholder:text-base-500"
              />
            </label>
            <Button
              variant="ghost"
              onClick={() => void (async () => {
                if (!folder) {
                  useArcStore.getState().setOnboardingOpen(true);
                  return;
                }
                await openOther();
              })()}
            >
              <FolderOpen size={14} /> Open…
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void (async () => {
                  if (!folder) {
                    useArcStore.getState().setOnboardingOpen(true);
                    return;
                  }
                  await actions.importFile();
                })()
              }
            >
              <Upload size={14} /> Import
            </Button>
            <Button variant="primary" disabled={!folder} onClick={() => setNaming("")}>
              <Plus size={14} /> New project
            </Button>
            <span className="mx-0.5 h-5 w-px bg-base-200" />
            <IconButton
              icon={<Settings size={16} strokeWidth={1.75} />}
              title="Settings"
              onClick={() => actions.openSettings()}
              className="border border-base-300 bg-base-100 text-base-700 hover:bg-base-200"
            />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {empty ? (
            <EmptyState
              loading={loading}
              hasFolder={Boolean(folder)}
              onNew={() => setNaming("")}
              onImport={() => void actions.importFile()}
              onOpen={() => void (async () => {
                if (!folder) {
                  useArcStore.getState().setOnboardingOpen(true);
                  return;
                }
                await openOther();
              })()}
            />
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
              {filtered.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  onClick={() => void openProject(project)}
                  className={cn(
                    "view-fade-in group flex flex-col overflow-hidden rounded-xl border border-base-200 bg-base-100 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-500/60 hover:shadow-lg active:scale-[0.99]",
                    opening === project.path && "opacity-60",
                  )}
                >
                  <div className="relative aspect-[4/3] w-full overflow-hidden bg-base-50">
                    <ThumbImage
                      project={project}
                      src={thumbs[project.path] ?? null}
                    />
                  </div>
                  <div className="w-full border-t border-base-200 px-3 py-2.5">
                    <div className="truncate text-[12.5px] font-medium text-base-900 transition-colors group-hover:text-accent-500">
                      {project.name}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 font-mono text-[11px] text-base-500">
                      <span className="truncate">{formatDate(project.modified)}</span>
                      <span className="shrink-0">{formatSize(project.size)}</span>
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <span className="col-span-full py-6 text-center text-[12px] text-base-500">
                  No projects match “{query.trim()}”.
                </span>
              )}
            </div>
          )}
        </main>
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

/** Thumbnail PNG or a fallback rendered from the project name. */
function ThumbImage({
  project,
  src,
}: {
  project: ProjectSummary;
  src: string | null;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        draggable={false}
        className="h-full w-full object-cover"
      />
    );
  }
  const initials = project.name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(120%_120%_at_50%_0%,color-mix(in_oklch,var(--color-accent-600)_14%,transparent),transparent)]">
      <span className="text-[28px] font-semibold text-base-400">
        {initials || <HardDriveDownload size={22} />}
      </span>
    </div>
  );
}

function EmptyState({
  loading,
  hasFolder,
  onNew,
  onImport,
  onOpen,
}: {
  loading: boolean;
  hasFolder: boolean;
  onNew: () => void;
  onImport: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 rounded-xl border border-base-300 border-dashed p-10 text-center">
      <div className="flex flex-col gap-1">
        <span className="text-[13px] font-medium text-base-800">
          {loading
            ? "Loading projects…"
            : hasFolder
              ? "No projects yet"
              : "No workspace folder set"}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="primary" onClick={onNew} disabled={!hasFolder}>
          <Plus size={14} /> New project
        </Button>
        <Button variant="ghost" onClick={onImport}>
          <Upload size={14} /> Import geometry
        </Button>        <Button variant="ghost" onClick={onOpen}>
          <FolderOpen size={14} /> Open other…
        </Button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="px-2 text-[10.5px] font-semibold uppercase tracking-wide text-base-500">
      {children}
    </span>
  );
}

function DashButton({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-base-700 transition-colors hover:bg-base-200"
    >
      {icon}
      {children}
    </button>
  );
}

function formatDate(modified: number): string {
  if (!modified) return "—";
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
