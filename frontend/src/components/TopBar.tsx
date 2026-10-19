import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Command, Redo2, Settings, Undo2 } from "lucide-react";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { bindingHint } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import { EXPORT_FORMATS } from "../data/tools";
import { ipc } from "../lib/ipc";
import { cn, IconButton } from "./ui";
import type { Settings as SettingsData } from "../lib/types";
import { Logo } from "./Logo";

type MenuId = "file" | "edit" | "view";

interface MenuItem {
  label: string;
  keys?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

type MenuEntry = MenuItem | "-";

function useOutsideClose(onClose: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", handler), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);
  return ref;
}

const recentLabel = (path: string) => {
  const name = path.split(/[\\/]/).pop() ?? path;
  return `Open recent — ${name}`;
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
  const ref = useOutsideClose(() => onOpen(null));
  const isOpen = open === id;
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseEnter={() => {
          if (open !== null && open !== id) onOpen(id);
        }}
        onClick={() => onOpen(isOpen ? null : id)}
        className={cn(
          "flex h-6 items-center gap-0.5 rounded px-2 text-[12px] transition-colors",
          isOpen ? "bg-base-200 text-base-800" : "text-base-600 hover:bg-base-200 hover:text-base-800",
        )}
      >
        {label}
        <ChevronDown size={11} className="text-base-500" />
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 z-50 mt-1 flex w-60 flex-col rounded-md border border-base-300 bg-base-150 p-1 shadow-lg shadow-black/40">
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
                  "flex w-full items-center justify-between gap-6 rounded px-2 py-1 text-left text-[12px] transition-colors",
                  "disabled:pointer-events-none disabled:opacity-35",
                  "text-base-600 hover:bg-base-300 hover:text-base-200",
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

/** Minimal top bar: logo mark, File/Edit/View menus, centered document name, undo/redo, palette, settings. */
export function TopBar({ children }: { children?: ReactNode }) {
  const scene = useArcStore((s) => s.scene);
  const overview = useArcStore((s) => s.overview);
  const settings = useArcStore((s) => s.settings);
  const keybindActiveId = useKeybindStore((s) => s.activeId);
  const keybindProfiles = useKeybindStore((s) => s.profiles);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  // Rebuild hint strings whenever the profile set or active profile changes.
  void keybindActiveId;
  void keybindProfiles;

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
    { label: "Open…", keys: bindingHint("doc:open"), onSelect: () => void actions.openDocument() },
    { label: "Import…", disabled: !hasDoc, onSelect: () => void actions.importFile() },
    "-",
    { label: "Save", keys: bindingHint("doc:save"), disabled: !hasDoc, onSelect: () => void actions.saveActive() },
    { label: "Save as…", disabled: !hasDoc, onSelect: () => void actions.saveDocumentAs() },
    ...(recents.length > 0
      ? (["-", ...recents.map((path) => ({
          label: recentLabel(path),
          keys: bindingHint("doc:open"),
          onSelect: () => void actions.openRecent(path),
        }))] as MenuEntry[])
      : []),
    "-",
    ...EXPORT_FORMATS.map<MenuEntry>((f) => ({
      label: f.label.replace("Export ", "Export "),
      keys: bindingHint("doc:export"),
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
    <header className="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-base-300 bg-base-100 pr-1.5 pl-2">
      <div className="mr-1 flex items-center text-accent-500">
        <Logo size={17} />
      </div>

      <Menu id="file" label="File" open={openMenu} onOpen={setOpenMenu} entries={fileMenu} />
      <Menu id="edit" label="Edit" open={openMenu} onOpen={setOpenMenu} entries={editMenu} />
      <Menu id="view" label="View" open={openMenu} onOpen={setOpenMenu} entries={viewMenu} />

      <div
        className="pointer-events-none absolute left-1/2 top-0 flex h-full -translate-x-1/2 items-center px-4"
        title={scene?.path ?? undefined}
      >
        <span className="max-w-[320px] truncate text-[12px] font-medium text-base-500">{docTitle}</span>
      </div>

      <div className="ml-auto flex items-center gap-0.5">{children}
        <IconButton
          icon={<Undo2 size={15} strokeWidth={1.75} />}
          title={`Undo${bindingHint("edit:undo") ? ` (${bindingHint("edit:undo")})` : ""}`}
          disabled={!scene?.canUndo}
          onClick={() => void actions.undo()}
        />
        <IconButton
          icon={<Redo2 size={15} strokeWidth={1.75} />}
          title={`Redo${bindingHint("edit:redo") ? ` (${bindingHint("edit:redo")})` : ""}`}
          disabled={!scene?.canRedo}
          onClick={() => void actions.redo()}
        />

        <div className="mx-1 h-4 w-px bg-base-300" />

        <IconButton
          icon={<Command size={15} strokeWidth={1.75} />}
          title={`Command palette${bindingHint("app:palette") ? ` (${bindingHint("app:palette")})` : ""}`}
          onClick={() => useArcStore.getState().setPaletteOpen(true)}
        />
        <IconButton
          icon={<Settings size={15} strokeWidth={1.75} />}
          title={`Settings${bindingHint("app:settings") ? ` (${bindingHint("app:settings")})` : ""}`}
          onClick={actions.openSettings}
        />
      </div>
    </header>
  );
}
