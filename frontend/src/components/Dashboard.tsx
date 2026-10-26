import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Box,
  Building2,
  Clock,
  DraftingCompass,
  Folder,
  FolderOpen,
  FolderSync,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { commitWorkspaceFolder } from "../lib/workspace";
import { Button, Modal, TextField, cn } from "./ui";
import type { ProjectMode, ProjectSummary } from "../lib/types";

type ViewMode = "grid" | "list";
type FilterTab = "all" | "recent" | "cad" | "arch";
type SortField = "modified" | "name" | "size" | "category";
type SortDir = "asc" | "desc";

interface ProjectMeta {
  category?: string;
  tags?: string[];
  mode?: ProjectMode;
}

const META_STORAGE_KEY = "arc_project_meta_v1";

const DEFAULT_CATEGORIES = [
  "Mechanical",
  "Architecture",
  "3D Printing",
  "Electronics",
  "Drafts",
  "General",
];

interface CategoryTheme {
  dot: string;
  badge: string;
  text: string;
}

const CATEGORY_THEMES: Record<string, CategoryTheme> = {
  Mechanical: {
    dot: "bg-sky-400",
    badge: "bg-sky-500/10 text-sky-500 border-sky-500/25",
    text: "text-sky-500",
  },
  Architecture: {
    dot: "bg-amber-400",
    badge: "bg-amber-500/10 text-amber-500 border-amber-500/25",
    text: "text-amber-500",
  },
  "3D Printing": {
    dot: "bg-emerald-400",
    badge: "bg-emerald-500/10 text-emerald-500 border-emerald-500/25",
    text: "text-emerald-500",
  },
  Electronics: {
    dot: "bg-purple-400",
    badge: "bg-purple-500/10 text-purple-500 border-purple-500/25",
    text: "text-purple-500",
  },
  Drafts: {
    dot: "bg-zinc-400",
    badge: "bg-base-200 text-base-600 border-base-300",
    text: "text-base-600",
  },
  General: {
    dot: "bg-accent-500",
    badge: "bg-accent-500/10 text-accent-500 border-accent-500/25",
    text: "text-accent-500",
  },
};

function getCategoryTheme(cat: string): CategoryTheme {
  return (
    CATEGORY_THEMES[cat] ?? {
      dot: "bg-accent-500",
      badge: "bg-accent-500/10 text-accent-500 border-accent-500/25",
      text: "text-accent-500",
    }
  );
}

function loadMetaMap(): Record<string, ProjectMeta> {
  try {
    const raw = localStorage.getItem(META_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveMetaMap(map: Record<string, ProjectMeta>): void {
  try {
    localStorage.setItem(META_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function Dashboard() {
  const folder = useArcStore((s) => s.workspaceFolder);
  const projectsCache = useArcStore((s) => s.projectsCache);
  const overview = useArcStore((s) => s.overview);

  const openDocuments = useMemo(
    () => (overview?.documents ?? []).filter((d) => d.path),
    [overview],
  );

  const cachedProjects = useMemo(() => {
    if (!folder) return [];
    return projectsCache[folder] ?? [];
  }, [folder, projectsCache]);

  const [projects, setProjects] = useState<ProjectSummary[]>(() => cachedProjects);
  const [metaMap, setMetaMap] = useState<Record<string, ProjectMeta>>(() => loadMetaMap());
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<FilterTab>("all");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("modified");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [naming, setNaming] = useState<string | null>(null);
  const [newProjectType, setNewProjectType] = useState<ProjectMode>("cad");
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync with cached projects if available and state is empty
  useEffect(() => {
    if (cachedProjects.length > 0 && projects.length === 0) {
      setProjects(cachedProjects);
    }
  }, [cachedProjects, projects.length]);

  // Editing category and tags for a project
  const [editingMeta, setEditingMeta] = useState<{
    path: string;
    name: string;
    category: string;
    tags: string[];
  } | null>(null);
  const [newTagInput, setNewTagInput] = useState("");
  const [customCategoryInput, setCustomCategoryInput] = useState("");

  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDeleteProject = async (p: ProjectSummary) => {
    try {
      setDeleting(true);
      await ipc.deleteProject(p.path);
      useArcStore.getState().removeProjectFromCache(p.path);
      setProjects((prev) => prev.filter((item) => item.path !== p.path));
      setMetaMap((prev) => {
        const next = { ...prev };
        delete next[p.path];
        saveMetaMap(next);
        return next;
      });
      setDeletingProject(null);
    } catch (err) {
      console.error("Failed to delete project:", err);
    } finally {
      setDeleting(false);
    }
  };

  const refresh = useCallback(() => {
    if (!folder) {
      setProjects([]);
      return;
    }
    let cancelled = false;
    const hasCached = (useArcStore.getState().projectsCache[folder]?.length ?? 0) > 0;
    if (!hasCached) {
      setLoading(true);
    }
    ipc
      .listProjects(folder)
      .then((list) => {
        if (cancelled) return;
        const sorted = [...list].sort((a, b) => b.modified - a.modified);
        setProjects(sorted);
        useArcStore.getState().setProjectsCache(folder, sorted);
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
  }, [folder]);

  useEffect(() => refresh(), [refresh]);

  // Compute category counts for sidebar
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      const cat = metaMap[p.path]?.category?.trim() || "General";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return counts;
  }, [projects, metaMap]);

  // Compute popular tags for sidebar
  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) {
      const tags = metaMap[p.path]?.tags ?? [];
      for (const t of tags) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [projects, metaMap]);

  // Counts by mode
  const cadCount = useMemo(() => {
    return projects.filter((p) => {
      const cat = metaMap[p.path]?.category?.toLowerCase();
      return cat !== "architecture";
    }).length;
  }, [projects, metaMap]);

  const archCount = useMemo(() => {
    return projects.filter((p) => {
      const cat = metaMap[p.path]?.category?.toLowerCase();
      return cat === "architecture";
    }).length;
  }, [projects, metaMap]);

  // Filter and sort projects
  const filteredAndSorted = useMemo(() => {
    let result = projects.map((p) => {
      const meta = metaMap[p.path] ?? {};
      const category = meta.category?.trim() || "General";
      const tags = meta.tags ?? [];
      return { ...p, category, tags };
    });

    if (tab === "recent") {
      const sevenDaysAgo = Date.now() / 1000 - 7 * 86400;
      result = result.filter((p) => p.modified >= sevenDaysAgo);
    } else if (tab === "cad") {
      result = result.filter((p) => p.category.toLowerCase() !== "architecture");
    } else if (tab === "arch") {
      result = result.filter((p) => p.category.toLowerCase() === "architecture");
    }

    if (selectedCategory) {
      result = result.filter(
        (p) => p.category.toLowerCase() === selectedCategory.toLowerCase(),
      );
    }

    if (selectedTag) {
      result = result.filter((p) =>
        p.tags.some((t) => t.toLowerCase() === selectedTag.toLowerCase()),
      );
    }

    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }

    const factor = sortDir === "asc" ? 1 : -1;
    result.sort((a, b) => {
      if (sortField === "category") {
        const c = a.category.localeCompare(b.category);
        if (c !== 0) return c * factor;
        return a.name.localeCompare(b.name);
      }
      if (sortField === "name") {
        return a.name.localeCompare(b.name) * factor;
      }
      if (sortField === "size") {
        return (a.size - b.size) * factor;
      }
      return (a.modified - b.modified) * factor;
    });

    return result;
  }, [
    projects,
    metaMap,
    tab,
    selectedCategory,
    selectedTag,
    query,
    sortField,
    sortDir,
  ]);

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

  const changeFolder = async () => {
    const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
    const picked = await openDialog({
      title: "Choose a projects folder",
      directory: true,
      defaultPath: folder ?? undefined,
    });
    if (typeof picked === "string" && picked.length > 0) {
      await commitWorkspaceFolder(picked);
      refresh();
    }
  };

  const createProject = async () => {
    const name = naming?.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await actions.createWorkspaceProject(name, newProjectType);
      const curFolder = useArcStore.getState().workspaceFolder;
      if (curFolder) {
        const filePath = `${curFolder.replace(/[\\/]+$/, "")}/${name}.arc`;
        const cat = newProjectType === "architecture" ? "Architecture" : "Mechanical";
        const tag = newProjectType === "architecture" ? "BIM" : "CAD";
        const updated = {
          ...metaMap,
          [filePath]: { category: cat, tags: [tag] },
        };
        setMetaMap(updated);
        saveMetaMap(updated);
      }
      setNaming(null);
    } finally {
      setSaving(false);
    }
  };

  const saveEditedMeta = () => {
    if (!editingMeta) return;
    const finalCat = customCategoryInput.trim() || editingMeta.category || "General";
    const updated = {
      ...metaMap,
      [editingMeta.path]: {
        category: finalCat,
        tags: editingMeta.tags,
      },
    };
    setMetaMap(updated);
    saveMetaMap(updated);
    setEditingMeta(null);
  };

  const folderName = folder ? folder.split(/[\\/]/).filter(Boolean).pop() || folder : null;

  return (
    <div className="flex h-full w-full overflow-hidden bg-base-50 text-base-800 select-none">
      {/* Refined Minimalist Sidebar */}
      <aside className="flex w-[268px] shrink-0 flex-col border-r border-base-200/80 bg-base-50">
        {/* Workspace Header - Clean with no logo */}
        <div
          data-tauri-drag-region
          className="flex h-13 shrink-0 items-center justify-between border-b border-base-200/80 px-4"
        >
          <span className="text-[13px] font-semibold tracking-tight text-base-900">
            Workspace
          </span>
          {projects.length > 0 && (
            <span className="rounded-full bg-base-200 px-2 py-0.5 font-mono text-[10px] font-medium text-base-600">
              {projects.length}
            </span>
          )}
        </div>

        {/* Sidebar Body */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {/* Workspace Folder Card */}
          <section className="flex flex-col gap-1.5 rounded-xl border border-base-200/90 bg-base-100/70 p-3 shadow-xs">
            <div className="flex items-center justify-between text-[11px] font-medium text-base-500">
              <span className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider text-base-400">
                <Folder size={12} className="text-accent-500" />
                Workspace
              </span>
              <button
                type="button"
                onClick={() => void changeFolder()}
                className="flex items-center gap-1 text-[11px] font-medium text-accent-500 hover:text-accent-600 transition-colors cursor-pointer"
              >
                <FolderSync size={11} />
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
                  className="truncate font-mono text-[10px] text-base-400"
                  title={folder}
                >
                  {folder}
                </div>
              )}
            </div>
          </section>

          {/* Primary Action Buttons */}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => setNaming("")}
              disabled={!folder}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-xl bg-accent-500 px-3 text-[12.5px] font-medium text-white shadow-sm shadow-accent-500/25 transition-all hover:bg-accent-600 active:scale-[0.98] disabled:opacity-50 cursor-pointer"
            >
              <Plus size={15} strokeWidth={2.5} />
              New Project
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    if (!folder) {
                      useArcStore.getState().setOnboardingOpen(true);
                      return;
                    }
                    await actions.importFile();
                  })()
                }
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-base-200/90 bg-base-100 px-2 text-[11.5px] font-medium text-base-700 transition-colors hover:bg-base-200 hover:text-base-900 cursor-pointer"
              >
                <Upload size={12} strokeWidth={2} />
                Import
              </button>
              <button
                type="button"
                onClick={() =>
                  void (async () => {
                    if (!folder) {
                      useArcStore.getState().setOnboardingOpen(true);
                      return;
                    }
                    await openOther();
                  })()
                }
                className="flex h-8 items-center justify-center gap-1.5 rounded-lg border border-base-200/90 bg-base-100 px-2 text-[11.5px] font-medium text-base-700 transition-colors hover:bg-base-200 hover:text-base-900 cursor-pointer"
              >
                <FolderOpen size={12} strokeWidth={2} />
                Open File
              </button>
            </div>
          </div>

          {/* Navigation Views */}
          <section className="flex flex-col gap-0.5">
            <SectionLabel>Library</SectionLabel>
            <SidebarNavButton
              icon={<LayoutGrid size={14} />}
              active={tab === "all" && !selectedCategory && !selectedTag}
              onClick={() => {
                setTab("all");
                setSelectedCategory(null);
                setSelectedTag(null);
              }}
              badge={projects.length}
            >
              All Projects
            </SidebarNavButton>
            <SidebarNavButton
              icon={<Clock size={14} />}
              active={tab === "recent" && !selectedCategory && !selectedTag}
              onClick={() => {
                setTab("recent");
                setSelectedCategory(null);
                setSelectedTag(null);
              }}
            >
              Recent (7 days)
            </SidebarNavButton>
            <SidebarNavButton
              icon={<DraftingCompass size={14} />}
              active={tab === "cad" && !selectedCategory && !selectedTag}
              onClick={() => {
                setTab("cad");
                setSelectedCategory(null);
                setSelectedTag(null);
              }}
              badge={cadCount}
            >
              CAD Models
            </SidebarNavButton>
            <SidebarNavButton
              icon={<Building2 size={14} />}
              active={tab === "arch" && !selectedCategory && !selectedTag}
              onClick={() => {
                setTab("arch");
                setSelectedCategory(null);
                setSelectedTag(null);
              }}
              badge={archCount}
            >
              Architecture
            </SidebarNavButton>
          </section>

          {/* Categories */}
          {categoryCounts.size > 0 && (
            <section className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between px-2 pb-1">
                <SectionLabel>Categories</SectionLabel>
                {selectedCategory && (
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    className="text-[10px] text-accent-500 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
              {[...categoryCounts.entries()].map(([cat, count]) => {
                const theme = getCategoryTheme(cat);
                const isSelected = selectedCategory?.toLowerCase() === cat.toLowerCase();
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(isSelected ? null : cat)}
                    className={cn(
                      "group flex h-7.5 w-full items-center justify-between rounded-lg px-2 text-left text-[11.5px] transition-all cursor-pointer",
                      isSelected
                        ? "bg-base-200/90 font-medium text-base-900 shadow-xs"
                        : "text-base-600 hover:bg-base-150 hover:text-base-900",
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0 mr-1">
                      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", theme.dot)} />
                      <span className="truncate">{cat}</span>
                    </span>
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.2 text-[9.5px] font-mono shrink-0",
                        isSelected
                          ? "bg-base-300 text-base-900 font-semibold"
                          : "bg-base-200 text-base-500",
                      )}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </section>
          )}

          {/* Tags */}
          {allTags.length > 0 && (
            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-2 pb-0.5">
                <SectionLabel>Tags</SectionLabel>
                {selectedTag && (
                  <button
                    type="button"
                    onClick={() => setSelectedTag(null)}
                    className="text-[10px] text-accent-500 hover:underline cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1 px-1">
                {allTags.slice(0, 16).map(([tag, count]) => {
                  const isSelected = selectedTag?.toLowerCase() === tag.toLowerCase();
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => setSelectedTag(isSelected ? null : tag)}
                      className={cn(
                        "inline-flex max-w-full items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors cursor-pointer",
                        isSelected
                          ? "bg-accent-500 text-white shadow-xs"
                          : "border border-base-200/90 bg-base-100 text-base-600 hover:border-base-300 hover:bg-base-200 hover:text-base-900",
                      )}
                    >
                      <span className={cn("shrink-0", isSelected ? "text-white/80" : "text-base-400")}>#</span>
                      <span className="truncate">{tag}</span>
                      <span className={cn("text-[9px] shrink-0 opacity-70")}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {/* Active Documents in Editor */}
          {openDocuments.length > 0 && (
            <section className="flex flex-col gap-1">
              <SectionLabel>Open in Editor</SectionLabel>
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
                      "group flex h-7.5 items-center justify-between gap-2 rounded-lg px-2 text-left text-[11.5px] transition-colors cursor-pointer",
                      isActive
                        ? "bg-accent-500/15 font-medium text-accent-500 border border-accent-500/30"
                        : "text-base-700 hover:bg-base-200 hover:text-base-900",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          isActive
                            ? "bg-accent-500 shadow-xs shadow-accent-500"
                            : "bg-base-400",
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

        {/* Sidebar Footer */}
        <div className="flex flex-col gap-1 border-t border-base-200/80 p-3">
          {overview?.active && (
            <button
              type="button"
              onClick={() => useArcStore.getState().setView("editor")}
              className="flex h-8 items-center justify-center gap-2 rounded-lg bg-accent-500 text-[12px] font-medium text-white shadow-xs transition-all hover:bg-accent-600 active:scale-[0.98] cursor-pointer"
            >
              <span>Return to 3D View</span>
              <ArrowRight size={13} strokeWidth={2} />
            </button>
          )}
          <SidebarFooterButton
            icon={<Settings size={14} />}
            onClick={() => actions.openSettings()}
          >
            Settings
          </SidebarFooterButton>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Control Bar */}
        <header
          data-tauri-drag-region
          className="flex h-13 shrink-0 items-center justify-between gap-4 border-b border-base-200/80 bg-base-50/90 px-6 backdrop-blur-md"
        >
          {/* Breadcrumb & Filter Indicators */}
          <div data-tauri-drag-region className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <h1 className="text-[15px] font-semibold text-base-900 tracking-tight">
                {selectedCategory
                  ? selectedCategory
                  : selectedTag
                    ? `#${selectedTag}`
                    : tab === "recent"
                      ? "Recent Projects"
                      : tab === "cad"
                        ? "CAD Models"
                        : tab === "arch"
                          ? "Architecture"
                          : "All Projects"}
              </h1>
              <span className="rounded-full bg-base-200 px-2 py-0.5 font-mono text-[10.5px] font-medium text-base-600">
                {filteredAndSorted.length}
              </span>
            </div>

            {/* Filter chip dismiss buttons */}
            {selectedCategory && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 border border-accent-500/30 px-2.5 py-0.5 text-[11px] font-medium text-accent-500">
                <span>{selectedCategory}</span>
                <button
                  type="button"
                  onClick={() => setSelectedCategory(null)}
                  className="hover:text-accent-600 cursor-pointer"
                  title="Clear category filter"
                >
                  <X size={11} />
                </button>
              </span>
            )}
            {selectedTag && (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent-500/15 border border-accent-500/30 px-2.5 py-0.5 font-mono text-[11px] font-medium text-accent-500">
                <span>#{selectedTag}</span>
                <button
                  type="button"
                  onClick={() => setSelectedTag(null)}
                  className="hover:text-accent-600 cursor-pointer"
                  title="Clear tag filter"
                >
                  <X size={11} />
                </button>
              </span>
            )}
          </div>

          {/* Toolbar Controls */}
          <div className="flex items-center gap-2.5">
            {/* Search Input */}
            <label className="relative flex h-8 w-60 items-center gap-2 rounded-xl border border-base-300/80 bg-base-100 px-2.5 transition-all focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/15">
              <Search size={13} className="shrink-0 text-base-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects, tags..."
                className="w-full min-w-0 bg-transparent text-[12px] text-base-800 outline-none placeholder:text-base-400"
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

            {/* Sort Dropdown & Direction */}
            <div className="flex items-center rounded-xl border border-base-300/80 bg-base-100 p-0.5">
              <select
                value={sortField}
                onChange={(e) => setSortField(e.target.value as SortField)}
                className="h-7 bg-transparent px-2 text-[11.5px] font-medium text-base-700 outline-none cursor-pointer"
              >
                <option value="modified">Date Modified</option>
                <option value="name">Name</option>
                <option value="size">Size</option>
                <option value="category">Category</option>
              </select>
              <button
                type="button"
                onClick={() => setSortDir(sortDir === "asc" ? "desc" : "asc")}
                title={sortDir === "asc" ? "Ascending" : "Descending"}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-base-500 hover:bg-base-200 hover:text-base-900 transition-colors cursor-pointer"
              >
                {sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              </button>
            </div>

            {/* View Mode Switch */}
            <div className="flex items-center rounded-xl border border-base-300/80 bg-base-100 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode("grid")}
                title="Grid view"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
                  viewMode === "grid"
                    ? "bg-base-200 text-base-900 shadow-xs font-semibold"
                    : "text-base-400 hover:text-base-800",
                )}
              >
                <LayoutGrid size={13} />
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                title="List view"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
                  viewMode === "list"
                    ? "bg-base-200 text-base-900 shadow-xs font-semibold"
                    : "text-base-400 hover:text-base-800",
                )}
              >
                <List size={13} />
              </button>
            </div>
          </div>
        </header>

        {/* Content Explorer Area */}
        <main className="min-h-0 flex-1 overflow-y-auto p-6">
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
            /* Clean Compact Cards */
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
              {filteredAndSorted.map((project) => {
                const catTheme = getCategoryTheme(project.category);
                const isArch = project.category.toLowerCase() === "architecture";
                return (
                  <div
                    key={project.path}
                    onClick={() => void openProject(project)}
                    className={cn(
                      "group flex flex-col justify-between rounded-xl border border-base-200/90 bg-base-100 p-4 transition-all duration-150 hover:-translate-y-0.5 hover:border-accent-500/40 hover:shadow-md hover:shadow-black/5 cursor-pointer",
                      opening === project.path && "opacity-50 pointer-events-none",
                    )}
                  >
                    <div>
                      {/* Top Row: Category Pill, Mode Badge & Actions */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedCategory(
                                selectedCategory === project.category ? null : project.category,
                              );
                            }}
                            className={cn(
                              "inline-flex max-w-[140px] items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10.5px] font-medium transition-all cursor-pointer shadow-xs",
                              catTheme.badge,
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", catTheme.dot)} />
                            <span className="truncate">{project.category}</span>
                          </button>

                          <span className="rounded border border-base-200 bg-base-150/70 px-1.5 py-0.2 font-mono text-[9px] font-bold text-base-500 tracking-wider">
                            {isArch ? "BIM" : "CAD"}
                          </span>
                        </div>

                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingMeta({
                                path: project.path,
                                name: project.name,
                                category: project.category,
                                tags: [...project.tags],
                              });
                              setCustomCategoryInput("");
                              setNewTagInput("");
                            }}
                            title="Edit tags & category"
                            className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-base-400 hover:bg-base-200 hover:text-base-800 transition-colors cursor-pointer"
                          >
                            <Pencil size={11} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeletingProject(project);
                            }}
                            title="Delete project"
                            className="flex h-6.5 w-6.5 items-center justify-center rounded-lg text-base-400 hover:bg-red-500/15 hover:text-red-500 transition-colors cursor-pointer"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </div>

                      {/* Project Name & Icon */}
                      <div className="mt-3 flex items-center gap-2.5">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-base-200/90 bg-base-150/60 transition-colors group-hover:border-accent-500/30 group-hover:bg-accent-500/10">
                          {isArch ? (
                            <Building2 size={14} className="text-amber-500" strokeWidth={2} />
                          ) : (
                            <Box size={14} className="text-accent-500" strokeWidth={2} />
                          )}
                        </div>
                        <div className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-base-900 group-hover:text-accent-500 transition-colors">
                          {project.name}
                        </div>
                      </div>

                      {/* Tags */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-1 min-h-[20px]">
                        {project.tags.map((t) => (
                          <span
                            key={t}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTag(selectedTag === t ? null : t);
                            }}
                            className={cn(
                              "inline-flex max-w-[130px] items-center gap-0.5 rounded px-1.5 py-0.2 font-mono text-[9.5px] transition-colors cursor-pointer",
                              selectedTag === t
                                ? "bg-accent-500 text-white font-medium shadow-xs"
                                : "border border-base-200 bg-base-150/50 text-base-600 hover:border-base-300 hover:bg-base-200 hover:text-base-900",
                            )}
                          >
                            <span className={cn("shrink-0", selectedTag === t ? "text-white/80" : "text-base-400")}>#</span>
                            <span className="truncate">{t}</span>
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Card Footer */}
                    <div className="mt-3.5 flex items-center justify-between border-t border-base-200/70 pt-2.5 text-[11px] text-base-500">
                      <span className="flex items-center gap-1.5 text-base-400">
                        <Clock size={11} />
                        <span>{formatDate(project.modified)}</span>
                      </span>
                      <span className="font-mono text-[10px] text-base-400">
                        {formatSize(project.size)}
                      </span>
                    </div>
                  </div>
                );
              })}
              {filteredAndSorted.length === 0 && (
                <div className="col-span-full py-16 text-center text-[12.5px] text-base-500">
                  No projects match your current filters.
                </div>
              )}
            </div>
          ) : (
            /* Sleek List View */
            <div className="flex flex-col overflow-hidden rounded-2xl border border-base-200/90 bg-base-100 shadow-xs">
              <div className="flex h-9 items-center border-b border-base-200/80 bg-base-150/40 px-4 text-[10.5px] font-semibold uppercase tracking-wider text-base-400">
                <span className="flex-1">Name</span>
                <span className="w-36 text-left">Category</span>
                <span className="w-48 text-left">Tags</span>
                <span className="w-36 text-left">Last Modified</span>
                <span className="w-20 text-right">Size</span>
                <span className="w-16 text-right"></span>
              </div>
              <div className="divide-y divide-base-200/70">
                {filteredAndSorted.map((project) => {
                  const catTheme = getCategoryTheme(project.category);
                  const isArch = project.category.toLowerCase() === "architecture";
                  return (
                    <div
                      key={project.path}
                      onClick={() => void openProject(project)}
                      className={cn(
                        "group flex h-11 w-full items-center px-4 text-left text-[12.5px] transition-colors hover:bg-base-150/50 cursor-pointer",
                        opening === project.path && "opacity-50 pointer-events-none",
                      )}
                    >
                      <span className="flex flex-1 min-w-0 items-center gap-2.5 pr-2">
                        {isArch ? (
                          <Building2 size={14} className="shrink-0 text-amber-500" />
                        ) : (
                          <Box size={14} className="shrink-0 text-accent-500" />
                        )}
                        <span className="truncate font-medium text-base-900 group-hover:text-accent-500 transition-colors">
                          {project.name}
                        </span>
                      </span>
                      <span className="w-36 shrink-0 min-w-0 pr-2">
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedCategory(
                              selectedCategory === project.category ? null : project.category,
                            );
                          }}
                          className={cn(
                            "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all hover:opacity-85 cursor-pointer shadow-xs",
                            catTheme.badge,
                          )}
                        >
                          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", catTheme.dot)} />
                          <span className="truncate">{project.category}</span>
                        </span>
                      </span>
                      <span className="w-48 shrink-0 flex flex-wrap items-center gap-1 overflow-hidden pr-2">
                        {project.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedTag(selectedTag === tag ? null : tag);
                            }}
                            className="inline-flex max-w-[120px] items-center gap-0.5 rounded border border-base-200 bg-base-150/70 px-1.5 py-0.2 text-[9.5px] font-mono text-base-600 hover:border-base-300 hover:bg-base-200 hover:text-base-900 cursor-pointer"
                          >
                            <span className="text-base-400 shrink-0">#</span>
                            <span className="truncate">{tag}</span>
                          </span>
                        ))}
                        {project.tags.length > 3 && (
                          <span className="text-[9.5px] font-medium text-base-400 shrink-0">
                            +{project.tags.length - 3}
                          </span>
                        )}
                      </span>
                      <span className="w-36 shrink-0 text-[11px] text-base-500">
                        {formatDate(project.modified)}
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-[10.5px] text-base-400">
                        {formatSize(project.size)}
                      </span>
                      <span className="w-16 shrink-0 flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingMeta({
                              path: project.path,
                              name: project.name,
                              category: project.category,
                              tags: [...project.tags],
                            });
                            setCustomCategoryInput("");
                            setNewTagInput("");
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-base-400 hover:bg-base-200 hover:text-base-800 rounded-md transition-all cursor-pointer"
                          title="Edit"
                        >
                          <Pencil size={12} />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeletingProject(project);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-base-400 hover:bg-red-500/15 hover:text-red-500 rounded-md transition-all cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={12} />
                        </button>
                      </span>
                    </div>
                  );
                })}
                {filteredAndSorted.length === 0 && (
                  <div className="py-12 text-center text-[12.5px] text-base-500">
                    No projects match your current filters.
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
        width="w-[440px]"
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-base-700">Project Type</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewProjectType("cad")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all cursor-pointer",
                  newProjectType === "cad"
                    ? "border-accent-500 bg-accent-500/10 shadow-xs ring-1 ring-accent-500/30"
                    : "border-base-300 bg-base-100 hover:border-base-400 hover:bg-base-200",
                )}
              >
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-base-900">
                  <DraftingCompass size={14} className="text-accent-500" strokeWidth={2} />
                  <span>CAD Model</span>
                </div>
                <span className="text-[10.5px] text-base-500 leading-tight">
                  Mechanical parts, solids, sketches & CSG
                </span>
              </button>

              <button
                type="button"
                onClick={() => setNewProjectType("architecture")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all cursor-pointer",
                  newProjectType === "architecture"
                    ? "border-accent-500 bg-accent-500/10 shadow-xs ring-1 ring-accent-500/30"
                    : "border-base-300 bg-base-100 hover:border-base-400 hover:bg-base-200",
                )}
              >
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold text-base-900">
                  <Building2 size={14} className="text-accent-500" strokeWidth={2} />
                  <span>Architecture</span>
                </div>
                <span className="text-[10.5px] text-base-500 leading-tight">
                  Storeys, mitered walls, openings, stairs & IFC
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-[11px] font-semibold text-base-700">Project Name</label>
            <TextField
              value={naming ?? ""}
              onChange={(value) => setNaming(value)}
              placeholder="e.g. Modern-Villa or Bracket-Mount"
              mono
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setNaming(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving || !naming?.trim()}
              onClick={() => void createProject()}
            >
              {saving ? "Creating…" : "Create project"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Category & Tags Modal */}
      <Modal
        open={editingMeta !== null}
        onClose={() => setEditingMeta(null)}
        title="Category & Tags"
        width="w-[420px]"
      >
        {editingMeta && (
          <div className="flex flex-col gap-4 text-[12px]">
            <div className="text-base-500">
              Project:{" "}
              <strong className="text-base-900 font-medium">{editingMeta.name}</strong>
            </div>

            {/* Category selection */}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-base-700">Category</label>
              <div className="flex flex-wrap gap-1.5">
                {DEFAULT_CATEGORIES.map((cat) => {
                  const theme = getCategoryTheme(cat);
                  const isChosen = editingMeta.category === cat && !customCategoryInput;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => {
                        setEditingMeta({ ...editingMeta, category: cat });
                        setCustomCategoryInput("");
                      }}
                      className={cn(
                        "inline-flex max-w-[160px] items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-all cursor-pointer",
                        isChosen
                          ? "bg-accent-500 text-white border-accent-600 font-semibold shadow-xs"
                          : "border-base-300 bg-base-100 text-base-700 hover:bg-base-200",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 shrink-0 rounded-full",
                          isChosen ? "bg-white" : theme.dot,
                        )}
                      />
                      <span className="truncate">{cat}</span>
                    </button>
                  );
                })}
              </div>
              <input
                value={customCategoryInput}
                onChange={(e) => {
                  setCustomCategoryInput(e.target.value);
                  setEditingMeta({
                    ...editingMeta,
                    category: e.target.value || "General",
                  });
                }}
                placeholder="Or enter custom category…"
                className="mt-1 h-8 rounded-lg border border-base-300 bg-base-50 px-3 text-[12px] outline-none focus:border-accent-500 transition-colors"
              />
            </div>

            {/* Tags editing */}
            <div className="flex flex-col gap-2">
              <label className="font-semibold text-base-700">Tags</label>
              <div className="flex flex-wrap items-center gap-1.5 min-h-[38px] rounded-lg border border-base-300 bg-base-50 p-2">
                {editingMeta.tags.map((tag, idx) => (
                  <span
                    key={tag}
                    className="inline-flex max-w-[180px] items-center gap-1 rounded-md border border-base-300 bg-base-200 px-2 py-0.5 text-[11px] font-medium text-base-700 shadow-xs"
                  >
                    <span className="text-base-400 shrink-0">#</span>
                    <span className="truncate">{tag}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = [...editingMeta.tags];
                        next.splice(idx, 1);
                        setEditingMeta({ ...editingMeta, tags: next });
                      }}
                      className="ml-0.5 shrink-0 text-base-400 hover:text-base-800 cursor-pointer"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
                <input
                  value={newTagInput}
                  onChange={(e) => setNewTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      const clean = newTagInput.trim().replace(/^#/, "").toLowerCase();
                      if (clean && !editingMeta.tags.includes(clean)) {
                        setEditingMeta({
                          ...editingMeta,
                          tags: [...editingMeta.tags, clean],
                        });
                        setNewTagInput("");
                      }
                    }
                  }}
                  placeholder={
                    editingMeta.tags.length === 0
                      ? "Type tag & press Enter…"
                      : "Add tag…"
                  }
                  className="flex-1 min-w-[120px] bg-transparent px-1 text-[11.5px] outline-none placeholder:text-base-400"
                />
              </div>
              <span className="text-[10.5px] text-base-400">
                Press Enter or comma to add tags
              </span>
            </div>

            {/* Modal actions */}
            <div className="mt-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditingMeta(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={saveEditedMeta}>
                Save
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Project Confirmation Modal */}
      <Modal
        open={deletingProject !== null}
        onClose={() => !deleting && setDeletingProject(null)}
        title="Delete project"
        width="w-[400px]"
      >
        {deletingProject && (
          <div className="flex flex-col gap-4 text-[12.5px]">
            <p className="text-base-600">
              Are you sure you want to delete{" "}
              <strong className="text-base-900 font-semibold">{deletingProject.name}</strong>?
              This will permanently delete the project file from your workspace.
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                onClick={() => setDeletingProject(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                disabled={deleting}
                onClick={() => void handleDeleteProject(deletingProject)}
              >
                <Trash2 size={13} />
                {deleting ? "Deleting…" : "Delete project"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
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
    <div className="flex h-full min-h-[340px] flex-col items-center justify-center gap-4 rounded-3xl border border-dashed border-base-200/90 bg-base-100/40 p-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-500/10 text-accent-500">
        <Sparkles size={24} />
      </div>
      <div className="flex flex-col gap-1 max-w-sm">
        <span className="text-[15px] font-semibold text-base-900 tracking-tight">
          {loading
            ? "Loading projects..."
            : hasFolder
              ? "No projects in this workspace"
              : "No workspace folder selected"}
        </span>
        <span className="text-[12px] text-base-500">
          {hasFolder
            ? "Create a new 3D project or import an existing model (STL, OBJ, DXF) to start designing."
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
          Import model
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
    <span className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-base-400">
      {children}
    </span>
  );
}

function SidebarNavButton({
  icon,
  active,
  onClick,
  badge,
  children,
}: {
  icon?: ReactNode;
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
        "flex h-8 w-full items-center justify-between rounded-xl px-2.5 text-left text-[12px] transition-colors cursor-pointer",
        active
          ? "bg-base-200/90 font-medium text-base-900 shadow-xs"
          : "text-base-600 hover:bg-base-150 hover:text-base-800",
      )}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        {icon && <span className={cn(active ? "text-accent-500" : "text-base-400")}>{icon}</span>}
        <span className="truncate">{children}</span>
      </span>
      {typeof badge === "number" && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.2 font-mono text-[9.5px]",
            active ? "bg-base-300 text-base-900 font-semibold" : "bg-base-200 text-base-500",
          )}
        >
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
      className="flex h-7.5 items-center gap-2 rounded-lg px-2 text-left text-[11.5px] text-base-600 transition-colors hover:bg-base-200 hover:text-base-900 cursor-pointer"
    >
      {icon}
      {children}
    </button>
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
