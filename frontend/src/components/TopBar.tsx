import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Command, Redo2, Settings, Undo2, ArrowLeft, ArrowRight } from "lucide-react";
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
        className="flex h-full items-center justify-center max-w-[320px] truncate px-2 text-center text-[12px] font-medium text-base-600 select-none cursor-default"
      >
        {view === "dashboard" ? "Projects" : docTitle}
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
                title="Return to editor"
                onClick={() => useArcStore.getState().setView("editor")}
                className="text-base-600 hover:bg-base-200"
              />
            )}
            <IconButton
              icon={<Command size={16} strokeWidth={1.75} />}
              title="Command palette"
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
              title="Return to projects dashboard"
              onClick={() => useArcStore.getState().setView("dashboard")}
              className="text-base-600 hover:bg-base-200"
            />

            {children}
            <IconButton
              icon={<Undo2 size={16} strokeWidth={1.75} />}
              disabled={!scene?.canUndo}
              onClick={() => void actions.undo()}
              className="text-base-600 hover:bg-base-200"
            />
            <IconButton
              icon={<Redo2 size={16} strokeWidth={1.75} />}
              disabled={!scene?.canRedo}
              onClick={() => void actions.redo()}
              className="text-base-600 hover:bg-base-200"
            />

            <div className="h-4 w-px bg-base-200 mx-0.5" />

            <IconButton
              icon={<Command size={16} strokeWidth={1.75} />}
              title="Command palette"
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
