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
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-base-200 bg-base-50 px-4">
      <span className="min-w-0 flex-1 truncate text-[12px] text-base-700">{statusMessage}</span>

      <span className="hidden sm:block shrink-0 font-mono text-[11.5px] tabular-nums text-base-600" title="Cursor position">
        X {fmt(cursorWorld[0])}  Z {fmt(cursorWorld[2])}
      </span>

      <div className="flex items-center gap-2">
        <button
          type="button"
          title="Show grid"
          disabled={!settings}
          onClick={() => toggleSetting("show_grid")}
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors disabled:pointer-events-none disabled:opacity-30",
            settings?.show_grid ? "text-accent-600 bg-accent-500/10" : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Grid3x3 size={14} strokeWidth={1.75} />
          {gridLabel && <span className="font-mono">{gridLabel}</span>}
        </button>

        <button
          type="button"
          title="Snap to grid"
          disabled={!settings}
          onClick={() => toggleSetting("snap_enabled")}
          className={cn(
            "flex h-6 shrink-0 items-center gap-1.5 rounded-md px-2 text-[11.5px] transition-colors disabled:pointer-events-none disabled:opacity-30",
            settings?.snap_enabled ? "text-accent-600 bg-accent-500/10" : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Magnet size={14} strokeWidth={1.75} />
          Snap
        </button>
      </div>

      <span className="h-5 w-px bg-base-200" />

      <span className="shrink-0 text-[11.5px] tabular-nums text-base-600">
        {scene ? `${scene.entities.length} items · ${selectionCount} selected` : "no document"}
      </span>
    </footer>
  );
}
