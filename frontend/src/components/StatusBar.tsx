import { Magnet, Grid3x3 } from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { cn } from "./ui";

const fmt = (n: number) => Math.round(n * 10) / 10;

/** Toggles a boolean settings flag through the backend, mirroring SettingsDialog. */
function toggleSetting(key: "snap_enabled" | "show_grid") {
  const settings = useArcStore.getState().settings;
  if (!settings) return;
  void ipc
    .setSettings({ ...settings, [key]: !settings[key] })
    .then((next) => useArcStore.getState().updateSettings(next))
    .catch(() => undefined);
}

/** Bottom status bar: status message, cursor position, grid/snap, entity count. */
export function StatusBar() {
  const scene = useArcStore((s) => s.scene);
  const cursorWorld = useArcStore((s) => s.cursorWorld);
  const statusMessage = useArcStore((s) => s.statusMessage);
  const settings = useArcStore((s) => s.settings);

  const selectionCount = scene?.selection.length ?? 0;
  const gridLabel = settings
    ? `${settings.grid_size}${settings.units === "metric" ? "cm" : '"'}`
    : null;

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-base-300 bg-base-100 px-3">
      <span className="min-w-0 flex-1 truncate text-[11px] text-base-600">{statusMessage}</span>

      <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-base-500" title="Cursor position">
        X {fmt(cursorWorld[0])}  Z {fmt(cursorWorld[2])}
      </span>

      <span className="h-3.5 w-px bg-base-300" />

      <button
        type="button"
        title="Show grid"
        disabled={!settings}
        onClick={() => toggleSetting("show_grid")}
        className={cn(
          "flex h-5 shrink-0 items-center gap-1 rounded px-1 text-[10.5px] transition-colors disabled:pointer-events-none disabled:opacity-30",
          settings?.show_grid ? "text-accent-500" : "text-base-500 hover:bg-base-200 hover:text-base-700",
        )}
      >
        <Grid3x3 size={12} strokeWidth={1.75} />
        {gridLabel && <span className="font-mono">{gridLabel}</span>}
      </button>

      <button
        type="button"
        title="Snap to grid"
        disabled={!settings}
        onClick={() => toggleSetting("snap_enabled")}
        className={cn(
          "flex h-5 shrink-0 items-center gap-1 rounded px-1 text-[10.5px] transition-colors disabled:pointer-events-none disabled:opacity-30",
          settings?.snap_enabled ? "text-accent-500" : "text-base-500 hover:bg-base-200 hover:text-base-700",
        )}
      >
        <Magnet size={12} strokeWidth={1.75} />
        Snap
      </button>

      <span className="h-3.5 w-px bg-base-300" />

      <span className="shrink-0 text-[10.5px] tabular-nums text-base-500">
        {scene ? `${scene.entities.length} items · ${selectionCount} selected` : "no document"}
      </span>
    </footer>
  );
}
