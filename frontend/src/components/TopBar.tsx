import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Command, Redo2, Settings, Undo2, ArrowLeft, ArrowRight, Layers, Plus, Table, DraftingCompass, Building2 } from "lucide-react";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { bindingHint } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import { EXPORT_FORMATS } from "../data/tools";
import { ipc } from "../lib/ipc";
import { cn, IconButton } from "./ui";
import { useWindowControlsStyle } from "../lib/platform";
import { WindowControls } from "./WindowControls";
import type { Settings as SettingsData } from "../lib/types";

type MenuId = "file" | "edit" | "view";

interface MenuItem {
  label: string;
  keys?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

type MenuEntry = MenuItem | "-";

const recentLabel = (path: string) => {
  const name = path.split(/[\\/]/).pop() ?? path;
  return `Open recent ${name}`;
};

function Menu({
  id,
  label,
  open,
  onOpen,
  entries,
}: {
  id: MenuId;
  label: string;
  open: MenuId | null;
  onOpen: (id: MenuId | null) => void;
  entries: MenuEntry[];
}) {
  const isOpen = open === id;
  return (
    <div className="relative">
      <button
        type="button"
        onMouseEnter={() => {
          if (open !== null && open !== id) onOpen(id);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onOpen(isOpen ? null : id);
        }}
        className={cn(
          "flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] transition-colors",
          isOpen ? "bg-base-200 text-base-800" : "text-base-600 hover:bg-base-200 hover:text-base-800",
        )}
      >
        {label}
        <ChevronDown size={11} className="text-base-500" />
      </button>
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="anim-pop absolute top-full left-0 z-50 mt-1 flex w-60 flex-col rounded-lg border border-base-300 bg-base-100 p-1.5 shadow-lg shadow-black/40"
        >
          {entries.map((entry, index) =>
            entry === "-" ? (
              <div key={`sep-${index}`} className="mx-2 my-1 border-t border-base-300" />
            ) : (
              <button
                key={entry.label}
                type="button"
                disabled={entry.disabled}
                onClick={() => {
                  onOpen(null);
                  entry.onSelect();
                }}
                className={cn(
                  "flex w-full items-center justify-between gap-6 rounded px-2.5 py-1.5 text-left text-[12px] transition-colors",
                  "disabled:pointer-events-none disabled:opacity-35",
                  "text-base-700 hover:bg-base-200 hover:text-base-900",
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <Check
                    size={12}
                    strokeWidth={2.25}
                    className={cn("shrink-0 text-accent-500", entry.checked ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{entry.label}</span>
                </span>
                {entry.keys && (
                  <span className="shrink-0 font-mono text-[10px] text-base-500">{entry.keys}</span>
                )}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function LevelSelector({ docId }: { docId: string }) {
  const scene = useArcStore((s) => s.scene);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newLevelName, setNewLevelName] = useState("");
  const [newElevation, setNewElevation] = useState(300);
  const popoverRef = useRef<HTMLDivElement>(null);

  const levels = scene?.levels ?? [];
  const activeLevel = levels.find((l) => l.id === scene?.activeLevel) ?? levels[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleAddLevel = async () => {
    if (!newLevelName.trim()) return;
    try {
      await ipc.addLevel(docId, newLevelName.trim(), Number(newElevation), 300);
      setNewLevelName("");
      setAdding(false);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="relative" ref={popoverRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex h-7 items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-2 text-[11px] font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer shadow-2xs"
      >
        <Layers size={12} className="text-accent-500" />
        <span className="font-semibold text-base-900">{activeLevel?.name ?? "Storey"}</span>
        <span className="text-[10px] text-base-500">({activeLevel?.elevation ?? 0} cm)</span>
        <ChevronDown size={11} className="text-base-400" />
      </button>

      {open && (
        <div className="anim-pop absolute left-0 top-full mt-1 z-50 flex w-56 flex-col rounded-lg border border-base-300 bg-base-100 p-1.5 shadow-lg shadow-black/40">
          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
            Storeys & Levels
          </div>
          <div className="flex flex-col gap-0.5">
            {levels.map((lvl) => {
              const isActive = lvl.id === scene?.activeLevel;
              return (
                <button
                  key={lvl.id}
                  type="button"
                  onClick={() => {
                    void ipc.setActiveLevel(docId, lvl.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded px-2 py-1 text-left text-[11.5px] transition-colors cursor-pointer",
                    isActive
                      ? "bg-accent-500/15 text-accent-600 font-semibold"
                      : "text-base-700 hover:bg-base-200 hover:text-base-900",
                  )}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 rounded-full",
                        isActive ? "bg-accent-500" : "bg-base-300",
                      )}
                    />
                    <span>{lvl.name}</span>
                  </span>
                  <span className="font-mono text-[10px] text-base-500">{lvl.elevation} cm</span>
                </button>
              );
            })}
          </div>

          <div className="my-1 border-t border-base-200" />

          {adding ? (
            <div className="flex flex-col gap-1.5 p-1">
              <input
                type="text"
                placeholder="Level name (e.g. Level 3)"
                value={newLevelName}
                onChange={(e) => setNewLevelName(e.target.value)}
                className="h-6 rounded border border-base-300 bg-base-50 px-2 text-[11px] text-base-800"
                autoFocus
              />
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  placeholder="Elevation (cm)"
                  value={newElevation}
                  onChange={(e) => setNewElevation(Number(e.target.value))}
                  className="h-6 w-24 rounded border border-base-300 bg-base-50 px-2 font-mono text-[11px] text-base-800"
                />
                <button
                  type="button"
                  onClick={() => void handleAddLevel()}
                  className="flex-1 rounded bg-accent-500 h-6 text-[11px] font-semibold text-white hover:bg-accent-600 cursor-pointer"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true);
                const maxElev = levels.reduce((m, l) => Math.max(m, l.elevation), 0);
                setNewElevation(maxElev + 300);
                setNewLevelName(`Level ${levels.length + 1}`);
              }}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-medium text-accent-500 hover:bg-accent-500/10 cursor-pointer"
            >
              <Plus size={12} />
              <span>Add New Level…</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ArchViewSelector() {
  const archViewMode = useArcStore((s) => s.archViewMode);
  const setArchViewMode = useArcStore((s) => s.setArchViewMode);

  return (
    <div className="flex items-center rounded-md border border-base-300 bg-base-100 p-0.5 shadow-2xs">
      <button
        type="button"
        onClick={() => setArchViewMode("3d")}
        className={cn(
          "rounded px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
          archViewMode === "3d"
            ? "bg-base-300 text-base-900 font-semibold"
            : "text-base-600 hover:text-base-900",
        )}
      >
        3D
      </button>
      <button
        type="button"
        onClick={() => setArchViewMode("floorplan")}
        className={cn(
          "rounded px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
          archViewMode === "floorplan"
            ? "bg-base-300 text-base-900 font-semibold"
            : "text-base-600 hover:text-base-900",
        )}
      >
        Floor Plan
      </button>
      <button
        type="button"
        onClick={() => setArchViewMode("elevation")}
        className={cn(
          "rounded px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
          archViewMode === "elevation"
            ? "bg-base-300 text-base-900 font-semibold"
            : "text-base-600 hover:text-base-900",
        )}
      >
        Elevation
      </button>
    </div>
  );
}

export function TopBar({ children }: { children?: ReactNode }) {
  const view = useArcStore((s) => s.view);
  const scene = useArcStore((s) => s.scene);
  const overview = useArcStore((s) => s.overview);
  const settings = useArcStore((s) => s.settings);
  const leftSidebarOpen = useArcStore((s) => s.leftSidebarOpen);
  const setLeftSidebarOpen = useArcStore((s) => s.setLeftSidebarOpen);
  const rightSidebarOpen = useArcStore((s) => s.rightSidebarOpen);
  const setRightSidebarOpen = useArcStore((s) => s.setRightSidebarOpen);
  const keybindActiveId = useKeybindStore((s) => s.activeId);
  const keybindProfiles = useKeybindStore((s) => s.profiles);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const { effectiveStyle } = useWindowControlsStyle();
  void keybindActiveId;
  void keybindProfiles;

  const handleToggleMaximize = async (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, select, [role='button']")) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().toggleMaximize();
    } catch {
      // ignore in preview/unsupported environments
    }
  };

  useEffect(() => {
    if (!openMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuBarRef.current && !menuBarRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenu]);

  const patchSettings = (updates: Partial<SettingsData>) => {
    if (!settings) return;
    void ipc
      .setSettings({ ...settings, ...updates })
      .then((next) => useArcStore.getState().updateSettings(next))
      .catch(() => undefined);
  };

  const hasDoc = scene != null || overview?.active != null;
  const docId = overview?.active ?? null;
  const doc = overview?.documents.find((d) => d.id === docId);
  const docTitle = doc ? `${doc.name}${doc.dirty ? " •" : ""}` : "No document";
  const recents = (overview?.settings.recent_files ?? []).slice(0, 5);

  const fileMenu: MenuEntry[] = [
    { label: "New", keys: bindingHint("doc:new"), onSelect: () => void actions.newDocument() },
    { label: "Open", keys: bindingHint("doc:open"), onSelect: () => void actions.openDocument() },
    { label: "Import", disabled: !hasDoc, onSelect: () => void actions.importFile() },
    "-",
    { label: "Save", keys: bindingHint("doc:save"), disabled: !hasDoc, onSelect: () => void actions.saveActive() },
    { label: "Save as", disabled: !hasDoc, onSelect: () => void actions.saveDocumentAs() },
    ...(recents.length > 0
      ? (["-", ...recents.map((path) => ({
          label: recentLabel(path),
          keys: bindingHint("doc:open"),
          onSelect: () => void actions.openRecent(path),
        }))] as MenuEntry[])
      : []),
    "-",
    ...EXPORT_FORMATS.map<MenuEntry>((f) => ({
      label: f.label,
      keys: f.id === "obj" ? bindingHint("doc:export") : undefined,
      disabled: !hasDoc,
      onSelect: () => void actions.exportActive(f.id),
    })),
  ];

  const editMenu: MenuEntry[] = [
    {
      label: "Undo",
      keys: bindingHint("edit:undo"),
      disabled: !scene?.canUndo,
      onSelect: () => void actions.undo(),
    },
    {
      label: "Redo",
      keys: bindingHint("edit:redo"),
      disabled: !scene?.canRedo,
      onSelect: () => void actions.redo(),
    },
    "-",
    {
      label: "Select all",
      keys: bindingHint("edit:selectAll"),
      disabled: !scene || scene.entities.length === 0,
      onSelect: () => void actions.selectAll(),
    },
    {
      label: "Duplicate",
      keys: bindingHint("edit:duplicate"),
      disabled: !scene || scene.selection.length === 0,
      onSelect: () => void actions.duplicateSelection(),
    },
    {
      label: "Delete",
      keys: bindingHint("edit:delete"),
      disabled: !scene || scene.selection.length === 0,
      onSelect: () => void actions.deleteSelection(),
    },
    {
      label: "Explode",
      keys: bindingHint("edit:explode"),
      disabled: !scene || scene.selection.length < 2,
      onSelect: () => void actions.explodeSelection(),
    },
  ];

  const viewMenu: MenuEntry[] = [
    {
      label: "Fit view",
      keys: bindingHint("view:fit"),
      disabled: !hasDoc,
      onSelect: () => actions.fitView(),
    },
    "-",
    {
      label: "Show grid",
      checked: settings?.show_grid ?? false,
      onSelect: () => patchSettings({ show_grid: !settings?.show_grid }),
    },
    {
      label: "Show axes",
      checked: settings?.show_axes ?? false,
      onSelect: () => patchSettings({ show_axes: !settings?.show_axes }),
    },
    {
      label: "Snap to grid",
      checked: settings?.snap_enabled ?? false,
      onSelect: () => patchSettings({ snap_enabled: !settings?.snap_enabled }),
    },
    "-",
    {
      label: "Items sidebar",
      checked: leftSidebarOpen,
      onSelect: () => setLeftSidebarOpen(!leftSidebarOpen),
    },
    {
      label: "History sidebar",
      checked: rightSidebarOpen,
      onSelect: () => setRightSidebarOpen(!rightSidebarOpen),
    },
    "-",
    {
      label: "Command line",
      keys: bindingHint("app:commandLine"),
      onSelect: () => void actions.openCommandLine(),
    },
    {
      label: "Reload plugins",
      keys: bindingHint("app:plugins"),
      onSelect: () => void actions.reloadPlugins(),
    },
  ];

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={handleToggleMaximize}
      className={cn(
        "relative flex h-10 shrink-0 items-center border-b border-base-200 bg-base-50 select-none",
        effectiveStyle === "windows" ? "pl-3 pr-0" : "px-3",
      )}
    >
      {/* macOS traffic lights on the far left */}
      {effectiveStyle === "macos" && (
        <div className="flex items-center">
          <WindowControls variant="macos" />
          <div className="h-4 w-px bg-base-200 ml-1 mr-2" />
        </div>
      )}

      {/* Menus */}
      <div ref={menuBarRef} className="flex items-center gap-1.5">
        <Menu id="file" label="File" open={openMenu} onOpen={setOpenMenu} entries={fileMenu} />
        {view === "editor" && (
          <>
            <Menu id="edit" label="Edit" open={openMenu} onOpen={setOpenMenu} entries={editMenu} />
            <Menu id="view" label="View" open={openMenu} onOpen={setOpenMenu} entries={viewMenu} />
          </>
        )}
      </div>

      {view === "editor" && docId && (
        <div className="flex items-center gap-2 ml-1">
          {/* Workbench Switcher */}
          <div className="flex items-center rounded-lg border border-base-300 bg-base-100 p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => void ipc.setProjectMode(docId, "cad")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
                (scene?.projectMode ?? "cad") === "cad"
                  ? "bg-accent-500 text-white shadow-2xs"
                  : "text-base-600 hover:text-base-900",
              )}
            >
              <DraftingCompass size={12} strokeWidth={2} />
              <span>CAD</span>
            </button>
            <button
              type="button"
              onClick={() => void ipc.setProjectMode(docId, "architecture")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all cursor-pointer",
                scene?.projectMode === "architecture"
                  ? "bg-accent-500 text-white shadow-2xs"
                  : "text-base-600 hover:text-base-900",
              )}
            >
              <Building2 size={12} strokeWidth={2} />
              <span>Architecture</span>
            </button>
          </div>

          {/* Architecture Workbench Controls */}
          {scene?.projectMode === "architecture" && (
            <div className="flex items-center gap-1.5">
              <LevelSelector docId={docId} />
              <ArchViewSelector />
              <button
                type="button"
                onClick={() => useArcStore.getState().setBuildingScheduleOpen(true)}
                className="flex items-center gap-1 rounded-md border border-base-300 bg-base-100 px-2 py-1 text-[11px] font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer shadow-2xs"
              >
                <Table size={12} className="text-accent-500" />
                <span>Schedule</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Draggable spacer left of title */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="flex-1 h-full min-w-4 cursor-default"
      />

      {/* Document title (or Projects in dashboard) */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="flex h-full items-center justify-center max-w-[320px] min-w-0 px-2 text-center text-[12px] font-medium text-base-600 select-none cursor-default"
      >
        <span className="truncate">{view === "dashboard" ? "Projects" : docTitle}</span>
      </div>

      {/* Draggable spacer right of title */}
      <div
        data-tauri-drag-region
        onDoubleClick={handleToggleMaximize}
        className="flex-1 h-full min-w-4 cursor-default"
      />

      {/* Right actions */}
      <div className="flex h-full items-center gap-1.5">
        {view === "dashboard" ? (
          <>
            {overview?.active && (
              <IconButton
                icon={<ArrowRight size={16} strokeWidth={1.75} />}
                title="Editor"
                onClick={() => useArcStore.getState().setView("editor")}
                className="text-base-600 hover:bg-base-200"
              />
            )}
            <IconButton
              icon={<Command size={16} strokeWidth={1.75} />}
              title="Commands"
              onClick={() => useArcStore.getState().setPaletteOpen(true)}
              className="text-base-600 hover:bg-base-200"
            />
            <IconButton
              icon={<Settings size={16} strokeWidth={1.75} />}
              title="Settings"
              onClick={actions.openSettings}
              className="text-base-600 hover:bg-base-200"
            />
          </>
        ) : (
          <>
            <IconButton
              icon={<ArrowLeft size={16} strokeWidth={1.75} />}
              title="Projects"
              onClick={() => useArcStore.getState().setView("dashboard")}
              className="text-base-600 hover:bg-base-200"
            />

            {children}
            <IconButton
              icon={<Undo2 size={16} strokeWidth={1.75} />}
              title="Undo"
              disabled={!scene?.canUndo}
              onClick={() => void actions.undo()}
              className="text-base-600 hover:bg-base-200"
            />
            <IconButton
              icon={<Redo2 size={16} strokeWidth={1.75} />}
              title="Redo"
              disabled={!scene?.canRedo}
              onClick={() => void actions.redo()}
              className="text-base-600 hover:bg-base-200"
            />

            <div className="h-4 w-px bg-base-200 mx-0.5" />

            <IconButton
              icon={<Command size={16} strokeWidth={1.75} />}
              title="Commands"
              onClick={() => useArcStore.getState().setPaletteOpen(true)}
              className="text-base-600 hover:bg-base-200"
            />
            <IconButton
              icon={<Settings size={16} strokeWidth={1.75} />}
              title="Settings"
              onClick={actions.openSettings}
              className="text-base-600 hover:bg-base-200"
            />
          </>
        )}

        {/* Windows and Linux window controls on the right */}
        {effectiveStyle !== "macos" && (
          <>
            <div className="h-4 w-px bg-base-200 mx-1" />
            <WindowControls variant={effectiveStyle} className="h-full self-stretch" />
          </>
        )}
      </div>
    </header>
  );
}
