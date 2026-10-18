import { useEffect, useRef, useState } from "react";
import { ChevronDown, Keyboard, Redo2, Settings, Undo2 } from "lucide-react";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { bindingHint, listKeybindInfos } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import { EXPORT_FORMATS } from "../data/tools";
import { Button, IconButton } from "./ui";
import { Logo } from "./Logo";

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
  return `Open Recent — ${name}`;
};

export function TopBar() {
  const scene = useArcStore((s) => s.scene);
  const overview = useArcStore((s) => s.overview);
  const keybindActiveId = useKeybindStore((s) => s.activeId);
  const keybindProfiles = useKeybindStore((s) => s.profiles);
  const [fileOpen, setFileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const fileRef = useOutsideClose(() => setFileOpen(false));
  const helpRef = useOutsideClose(() => setHelpOpen(false));
  // Rebuild hint strings whenever the profile set or active profile changes.
  void keybindActiveId;
  void keybindProfiles;

  const dirty = scene?.modified ?? false;
  const title = scene ? `${scene.name}${dirty ? " •" : ""}` : "arc";
  const docId = overview?.active ?? null;
  const doc = overview?.documents.find((d) => d.id === docId);
  const recents = (overview?.settings.recent_files ?? []).slice(0, 5);

  const fileItem = (label: string, actionId: string, fn: () => void) => (
    <button
      key={label}
      className="flex w-full items-center justify-between gap-6 rounded-md px-3 py-1.5 text-sm text-base-700 hover:bg-base-300 hover:text-base-50"
      onClick={() => {
        setFileOpen(false);
        fn();
      }}
    >
      <span>{label}</span>
      <span className="font-mono text-[10px] text-base-500">{bindingHint(actionId)}</span>
    </button>
  );

  return (
    <header className="flex h-11 shrink-0 items-center gap-1 border-b border-base-300 bg-base-100 px-2">
      <div className="flex items-center gap-2 pl-1 pr-2">
        <Logo size={18} />
        <span className="text-sm font-semibold lowercase tracking-wide text-base-100">arc</span>
      </div>

      <div className="relative" ref={fileRef}>
        <Button variant="ghost" onClick={() => setFileOpen((v) => !v)}>
          File <ChevronDown size={13} />
        </Button>
        {fileOpen && (
          <div className="absolute top-full left-0 z-50 mt-1 w-60 rounded-lg border border-base-400 bg-base-100 p-1 shadow-xl">
            {fileItem("New", "doc:new", () => void actions.newDocument())}
            {fileItem("Open…", "doc:open", actions.openDocument)}
            {fileItem("Import…", "doc:import", () => void actions.importFile())}
            {fileItem("Save", "doc:save", () => void actions.saveActive())}
            {fileItem("Save As…", "doc:saveAs", () => void actions.saveDocumentAs())}
            {recents.length > 0 && (
              <>
                <div className="my-1 border-t border-base-800" />
                {recents.map((path) =>
                  fileItem(
                    recentLabel(path),
                    "doc:open",
                    () => void actions.openRecent(path),
                  ),
                )}
              </>
            )}
            <div className="my-1 border-t border-base-800" />
            {EXPORT_FORMATS.map((f) =>
              fileItem(f.label, "doc:export", () => void actions.exportActive(f.id)),
            )}
          </div>
        )}
      </div>

      <IconButton
        icon={<Undo2 size={15} />}
        title={`Undo (${bindingHint("edit:undo")})`}
        disabled={!scene?.canUndo}
        onClick={() => void actions.undo()}
      />
      <IconButton
        icon={<Redo2 size={15} />}
        title={`Redo (${bindingHint("edit:redo")})`}
        disabled={!scene?.canRedo}
        onClick={() => void actions.redo()}
      />

      <div className="mx-2 h-5 w-px bg-base-300" />

      <IconButton
        icon={<Keyboard size={15} />}
        title={`Command palette (${bindingHint("app:palette")})`}
        onClick={() => useArcStore.getState().setPaletteOpen(true)}
      />

      <div className="flex-1 truncate text-center text-xs text-base-400">
        {docId
          ? `${doc ? `${doc.name}${doc.dirty ? " •" : ""}` : title}${scene?.path ? `: ${scene.path}` : ""}`
          : "No document open"}
      </div>

      <IconButton
        icon={<Settings size={15} />}
        title={`Settings (${bindingHint("app:settings")})`}
        onClick={actions.openSettings}
      />

      <div className="relative" ref={helpRef}>
        <IconButton icon={<ChevronDown size={15} />} title="Keybinds" onClick={() => setHelpOpen((v) => !v)} />
        {helpOpen && (
          <div className="absolute top-full right-0 z-50 mt-1 max-h-96 w-64 overflow-y-auto rounded-lg border border-base-400 bg-base-100 p-2 shadow-xl">
            <div className="mb-1 text-[11px] font-semibold text-base-500 uppercase">Keybinds</div>
            {listKeybindInfos().map((k) => (
              <div key={k.label + k.keys} className="flex items-center justify-between gap-3 px-1 py-0.5 text-xs">
                <span className="text-base-700">{k.label}</span>
                <span className="font-mono text-[10px] text-base-500">{k.keys}</span>
              </div>
            ))}
            <div className="mt-1 border-t border-base-800 pt-1.5">
              <button
                className="text-[10px] text-base-500 underline-offset-2 hover:text-base-300 hover:underline"
                onClick={() => {
                  setHelpOpen(false);
                  actions.openSettings();
                }}
              >
                Customize in settings…
              </button>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}

export function StatusBar() {
  const scene = useArcStore((s) => s.scene);
  const cursorWorld = useArcStore((s) => s.cursorWorld);
  const statusMessage = useArcStore((s) => s.statusMessage);
  const settings = useArcStore((s) => s.settings);

  const selectionCount = scene?.selection.length ?? 0;
  const fmt = (n: number) => Math.round(n * 10) / 10;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-base-300 bg-base-100 px-3 font-mono text-[10px] text-base-500">
      <span className="text-base-600">
        X {fmt(cursorWorld[0])}  Y {fmt(cursorWorld[2])}
      </span>
      <span>
        grid {settings ? `${settings.grid_size}${settings.units === "metric" ? "cm" : '"'}` : "-"}
        {settings?.snap_enabled ? " · snap" : ""}
      </span>
      <span className="flex-1 truncate text-center text-base-600">{statusMessage}</span>
      <span>
        {scene ? `${scene.entities.length} entities · ${selectionCount} selected` : ""}
      </span>
    </footer>
  );
}
