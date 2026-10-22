import { Magnet, Grid3x3 } from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { cn } from "./ui";

/** Toggles a boolean settings flag through the backend, mirroring SettingsDialog. */
function toggleSetting(key: "snap_enabled" | "show_grid") {
  const settings = useArcStore.getState().settings;
  if (!settings) return;
  void ipc
    .setSettings({ ...settings, [key]: !settings[key] })
    .then((next) => useArcStore.getState().updateSettings(next))
    .catch(() => undefined);
}

// Slim status bar: live status text lives in the floating StatusPill; this
// footer keeps units/grid/snap toggles and counts only.
export function StatusBar() {
  const scene = useArcStore((s) => s.scene);
  const settings = useArcStore((s) => s.settings);

  const selectionCount = scene?.selection.length ?? 0;
  const gridLabel = settings
    ? `${settings.grid_size}${settings.units === "metric" ? "cm" : '"'}`
    : null;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-base-200 bg-base-50 px-4">
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

      <span className="min-w-0 flex-1 truncate text-[11.5px] tabular-nums text-base-600">
        {scene ? `${scene.entities.length} items · ${selectionCount} selected` : "no document"}
      </span>

      {settings && (
        <span className="shrink-0 text-[11.5px] font-medium text-base-500">
          {settings.units === "metric" ? "cm" : '"'}
        </span>
      )}
    </footer>
  );
}
