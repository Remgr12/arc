import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Box,
  Clock,
  Folder,
  FolderOpen,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings,
  Sliders,
  Upload,
  X,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { Logo } from "./Logo";
import { Button, Modal, TextField, cn } from "./ui";
import type { ProjectSummary } from "../lib/types";

type ViewMode = "grid" | "list";
type FilterTab = "all" | "recent";

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
  const [tab, setTab] = useState<FilterTab>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
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
  }, [folder]);

  useEffect(() => refresh(), [refresh]);

  const filtered = useMemo(() => {
    let result = projects;
    if (tab === "recent") {
      const sevenDaysAgo = Date.now() / 1000 - 7 * 86400;
      result = result.filter((p) => p.modified >= sevenDaysAgo);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter((p) => p.name.toLowerCase().includes(q));
    }
    return result;
  }, [projects, query, tab]);

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

  const folderName = folder ? folder.split(/[\\/]/).pop() || folder : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-base-50 text-base-800 select-none">
      {/* Sleek Workspace Sidebar */}
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-base-200 bg-base-50">
        {/* Workspace Brand / Header */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-base-200 px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-500/10 text-accent-500">
              <Logo size={14} />
            </div>
            <span className="text-[12.5px] font-semibold tracking-tight text-base-900">
              Workspace
            </span>
          </div>
          {projects.length > 0 && (
            <span className="rounded-full bg-base-200 px-2 py-0.5 font-mono text-[10px] font-medium text-base-600">
              {projects.length}
            </span>
          )}
        </div>

        {/* Sidebar Content */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {/* Workspace Folder Card */}
          <section className="flex flex-col gap-1.5 rounded-xl border border-base-200 bg-base-100/50 p-3 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-medium text-base-500">
              <span className="flex items-center gap-1.5">
                <Folder size={12} className="text-accent-500" />
                Folder
              </span>
              <button
                type="button"
                onClick={() => useArcStore.getState().setStartupOpen(true)}
                className="text-[11px] font-medium text-accent-500 transition-colors hover:text-accent-600 hover:underline cursor-pointer"
              >
                Change
              </button>
            </div>
            <div className="min-w-0">
              <div
                className="truncate text-[12.5px] font-semibold text-base-900"
                title={folder ?? undefined}
              >
                {folderName ?? "No workspace folder"}
              </div>
              {folder && (
                <div
                  className="truncate font-mono text-[10.5px] text-base-500"
                  title={folder}
                >
                  {folder}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => useArcStore.getState().setStartupOpen(true)}
              className="mt-1 flex h-7 items-center justify-center gap-1.5 rounded-lg border border-base-300 bg-base-50 px-2 text-[11.5px] font-medium text-base-700 transition-colors hover:bg-base-200 hover:text-base-900 cursor-pointer"
            >
              <FolderOpen size={13} />
              Browse projects
            </button>
          </section>

          {/* Navigation Filters */}
          <section className="flex flex-col gap-0.5">
            <SectionLabel>Filter</SectionLabel>
            <SidebarNavButton
              active={tab === "all"}
              onClick={() => setTab("all")}
              badge={projects.length}
            >
              All projects
            </SidebarNavButton>
            <SidebarNavButton
              active={tab === "recent"}
              onClick={() => setTab("recent")}
            >
              Recent (7 days)
            </SidebarNavButton>
          </section>

          {/* Open Documents in Editor */}
          {openDocuments.length > 0 && (
            <section className="flex flex-col gap-0.5">
              <SectionLabel>Active in editor</SectionLabel>
              {openDocuments.map((doc) => {
                const isActive = overview?.active === doc.id;
                return (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => {
                      void actions.openProjectPath(doc.path as string);
                      useArcStore.getState().setView("editor");
                    }}
                    className={cn(
                      "group flex h-8 items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[12px] transition-colors cursor-pointer",
                      isActive
                        ? "bg-accent-500/15 font-medium text-accent-500 border border-accent-500/30"
                        : "text-base-700 hover:bg-base-200 hover:text-base-900",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          isActive ? "bg-accent-500 shadow-xs shadow-accent-500" : "bg-base-400",
                        )}
                      />
                      <span className="truncate">{doc.name}</span>
                    </span>
                    {doc.dirty && (
                      <span className="rounded bg-accent-500/20 px-1 font-mono text-[9px] font-bold text-accent-500">
                        dirty
                      </span>
                    )}
                  </button>
                );
              })}
            </section>
          )}
        </div>

        {/* Sidebar Footer Actions */}
        <div className="flex flex-col gap-1 border-t border-base-200 p-3">
          {overview?.active && (
            <button
              type="button"
              onClick={() => useArcStore.getState().setView("editor")}
              className="flex h-8 items-center justify-center gap-2 rounded-lg bg-accent-500 font-medium text-white shadow-xs transition-all hover:bg-accent-600 active:scale-[0.98] cursor-pointer text-[12px]"
            >
              Return to editor
              <ArrowRight size={13} strokeWidth={2} />
            </button>
          )}
          <SidebarFooterButton
            icon={<Settings size={14} />}
            onClick={() => actions.openSettings()}
          >
            Settings
          </SidebarFooterButton>
          <SidebarFooterButton
            icon={<Sliders size={14} />}
            onClick={() => useArcStore.getState().setOnboardingOpen(true)}
          >
            Set up workspace
          </SidebarFooterButton>
        </div>
      </aside>

      {/* Main Project Explorer */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header Action Bar */}
        <header
          data-tauri-drag-region
          className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-base-200 bg-base-50/80 px-6 backdrop-blur-md"
        >
          {/* Title & Count */}
          <div data-tauri-drag-region className="flex items-center gap-3">
            <h1 className="text-[15px] font-semibold text-base-900">Projects</h1>
            <span className="rounded-md bg-base-200 px-2 py-0.5 font-mono text-[11px] font-medium text-base-600">
              {filtered.length}
            </span>
          </div>

          {/* Right Toolbar Controls */}
          <div className="flex items-center gap-2.5">
            {/* Search Input */}
            <label className="relative flex h-8 w-60 items-center gap-2 rounded-lg border border-base-300 bg-base-100/90 px-2.5 transition-all focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20">
              <Search size={13} className="shrink-0 text-base-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects"
                className="w-full min-w-0 bg-transparent text-[12px] text-base-800 outline-none placeholder:text-base-500"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  className="text-base-400 hover:text-base-700 cursor-pointer"
                >
                  <X size={12} />
                </button>
              )}
            </label>

            {/* View Mode Toggle */}
            <div className="flex items-center rounded-lg border border-base-300 bg-base-100 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Grid view"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer",
                  viewMode === "grid"
                    ? "bg-base-250 text-base-900 shadow-xs"
                    : "text-base-500 hover:text-base-800",
                )}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="List view"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md transition-colors cursor-pointer",
                  viewMode === "list"
                    ? "bg-base-250 text-base-900 shadow-xs"
                    : "text-base-500 hover:text-base-800",
                )}
              >
                <List size={14} />
              </button>
            </div>

            <div className="h-4 w-px bg-base-300" />

            {/* Actions */}
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
              <FolderOpen size={14} />
              Open file
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
              <Upload size={14} />
              Import
            </Button>
            <Button
              variant="primary"
              disabled={!folder}
              onClick={() => setNaming("")}
            >
              <Plus size={14} strokeWidth={2.2} />
              New project
            </Button>
          </div>
        </header>

        {/* Content Explorer Area */}
        <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
          {projects.length === 0 ? (
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
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4">
              {filtered.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  onClick={() => void openProject(project)}
                  className={cn(
                    "group flex flex-col overflow-hidden rounded-xl border border-base-200 bg-base-100/70 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent-500/50 hover:bg-base-100 hover:shadow-lg hover:shadow-black/25 active:scale-[0.99] cursor-pointer",
                    opening === project.path && "opacity-50 pointer-events-none",
                  )}
                >
                  {/* Thumbnail / CAD Blueprint preview */}
                  <div className="relative aspect-[16/10] w-full overflow-hidden border-b border-base-200 bg-base-150">
                    <ThumbImage
                      project={project}
                      src={thumbs[project.path] ?? null}
                    />
                  </div>
                  {/* Info footer */}
                  <div className="flex w-full flex-col gap-1.5 p-3">
                    <div className="truncate text-[13px] font-medium text-base-900 transition-colors group-hover:text-accent-500">
                      {project.name}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-base-500">
                      <span className="flex items-center gap-1">
                        <Clock size={11} className="text-base-400" />
                        {formatDate(project.modified)}
                      </span>
                      <span className="font-mono text-[10.5px]">
                        {formatSize(project.size)}
                      </span>
                    </div>
                  </div>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full py-16 text-center text-[12.5px] text-base-500">
                  No projects match “{query.trim()}”.
                </div>
              )}
            </div>
          ) : (
            /* Sleek List View */
            <div className="flex flex-col overflow-hidden rounded-xl border border-base-200 bg-base-100/60">
              <div className="flex h-9 items-center border-b border-base-200 bg-base-150/60 px-4 text-[11px] font-semibold uppercase tracking-wider text-base-500">
                <span className="flex-1">Name</span>
                <span className="w-40 text-left">Last Modified</span>
                <span className="w-24 text-right">Size</span>
              </div>
              <div className="divide-y divide-base-200">
                {filtered.map((project) => (
                  <button
                    key={project.path}
                    type="button"
                    onClick={() => void openProject(project)}
                    className={cn(
                      "group flex h-11 w-full items-center px-4 text-left text-[12.5px] transition-colors hover:bg-base-200/70 cursor-pointer",
                      opening === project.path && "opacity-50 pointer-events-none",
                    )}
                  >
                    <span className="flex flex-1 min-w-0 items-center gap-2.5">
                      <Box size={14} className="shrink-0 text-accent-500" />
                      <span className="truncate font-medium text-base-900 group-hover:text-accent-500 transition-colors">
                        {project.name}
                      </span>
                    </span>
                    <span className="w-40 shrink-0 text-[11.5px] text-base-500">
                      {formatDate(project.modified)}
                    </span>
                    <span className="w-24 shrink-0 text-right font-mono text-[11px] text-base-500">
                      {formatSize(project.size)}
                    </span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <div className="py-12 text-center text-[12.5px] text-base-500">
                    No projects match “{query.trim()}”.
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* New Project Modal */}
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
            placeholder="Project name"
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

/** Thumbnail preview or CAD blueprint placeholder */
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
        alt={project.name}
        draggable={false}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
    <div className="relative flex h-full w-full items-center justify-center bg-base-100 overflow-hidden">
      {/* Subtle CAD grid pattern */}
      <div
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
          backgroundSize: "16px 16px",
        }}
      />
      {/* Subtle radial accent illumination */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,color-mix(in_oklch,var(--color-accent-500)_15%,transparent),transparent_70%)]" />

      {/* Floating CAD badge */}
      <div className="relative flex flex-col items-center gap-1.5 rounded-xl border border-base-250 bg-base-50/80 px-3.5 py-2 shadow-sm backdrop-blur-sm transition-transform duration-300 group-hover:scale-105">
        <Box size={18} className="text-accent-500" />
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-base-700">
          {initials || "CAD"}
        </span>
      </div>
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
    <div className="flex h-full min-h-[300px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-base-300 bg-base-100/30 p-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-base-250 bg-base-100 text-accent-500 shadow-sm">
        <Box size={24} strokeWidth={1.75} />
      </div>
      <div className="flex flex-col gap-1 max-w-sm">
        <span className="text-[14px] font-semibold text-base-900">
          {loading
            ? "Loading projects"
            : hasFolder
              ? "No projects in this workspace"
              : "No workspace folder selected"}
        </span>
        <span className="text-[12px] text-base-500">
          {hasFolder
            ? "Create a new project or import existing 3D geometry to start designing."
            : "Choose a workspace directory to manage your CAD documents and models."}
        </span>
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button variant="primary" onClick={onNew} disabled={!hasFolder}>
          <Plus size={14} />
          New project
        </Button>
        <Button variant="default" onClick={onImport}>
          <Upload size={14} />
          Import geometry
        </Button>
        <Button variant="default" onClick={onOpen}>
          <FolderOpen size={14} />
          Open file
        </Button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <span className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-wider text-base-500">
      {children}
    </span>
  );
}

function SidebarNavButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-8 items-center justify-between rounded-lg px-2.5 text-left text-[12px] transition-colors cursor-pointer",
        active
          ? "bg-base-200 font-medium text-base-900"
          : "text-base-600 hover:bg-base-150 hover:text-base-800",
      )}
    >
      <span>{children}</span>
      {typeof badge === "number" && (
        <span className="rounded-full bg-base-200 px-1.5 py-0.2 font-mono text-[10px] text-base-600">
          {badge}
        </span>
      )}
    </button>
  );
}

function SidebarFooterButton({
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
      className="flex h-7 items-center gap-2 rounded-lg px-2 text-left text-[11.5px] text-base-600 transition-colors hover:bg-base-200 hover:text-base-900 cursor-pointer"
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
