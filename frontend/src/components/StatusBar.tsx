import { Magnet, Grid3x3, PencilRuler, Ruler, Zap } from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { cn } from "./ui";

const fmt = (n: number) => Math.round(n * 10) / 10;
const SNAP_STEPS = [1, 2, 5, 10, 0.5];
const GRID_STEPS = [1, 2, 5, 10];

/** Toggles a boolean settings flag through the backend, mirroring SettingsDialog. */
function toggleSetting(key: "snap_enabled" | "show_grid") {
  const settings = useArcStore.getState().settings;
  if (!settings) return;
  void ipc
    .setSettings({ ...settings, [key]: !settings[key] })
    .then((next) => useArcStore.getState().updateSettings(next))
    .catch(() => undefined);
}

function cycleGridSize() {
  const settings = useArcStore.getState().settings;
  if (!settings) return;
  const idx = GRID_STEPS.indexOf(settings.grid_size);
  const nextGrid = GRID_STEPS[(idx + 1) % GRID_STEPS.length];
  void ipc
    .setSettings({ ...settings, grid_size: nextGrid })
    .then((next) => useArcStore.getState().updateSettings(next))
    .catch(() => undefined);
}

export function StatusBar() {
  const scene = useArcStore((s) => s.scene);
  const settings = useArcStore((s) => s.settings);
  const statusMessage = useArcStore((s) => s.statusMessage);
  const cursorWorld = useArcStore((s) => s.cursorWorld);
  const selKind = useArcStore((s) => s.selKind);
  const sketchMode = useArcStore((s) => s.sketchMode);
  const sketchPlaneLabel = useArcStore((s) => s.sketchPlaneLabel);
  const dimSnapStep = useArcStore((s) => s.dimSnapStep);
  const setDimSnapStep = useArcStore((s) => s.setDimSnapStep);
  const lowSpecMode = useArcStore((s) => s.lowSpecMode);
  const setLowSpecMode = useArcStore((s) => s.setLowSpecMode);

  const selectionCount = scene?.selection.length ?? 0;
  const isImperial =
    settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";
  const unit = isImperial ? "in" : "cm";
  const gridLabel = settings ? `${settings.grid_size} ${unit}` : null;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-base-200 bg-base-50 px-3 text-[11.5px]">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title="Toggle reference grid"
          disabled={!settings}
          onClick={() => toggleSetting("show_grid")}
          className={cn(
            "flex h-5.5 shrink-0 items-center gap-1 rounded px-2 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-30",
            settings?.show_grid
              ? "bg-accent-500/15 text-accent-500"
              : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Grid3x3 size={12} strokeWidth={1.75} />
          Grid
        </button>

        {gridLabel && (
          <button
            type="button"
            title="Click to cycle grid spacing (1 / 2 / 5 / 10 cm)"
            onClick={cycleGridSize}
            className="flex h-5.5 shrink-0 items-center rounded border border-base-200 bg-base-100 px-1.5 font-mono text-[10.5px] text-base-700 transition-colors hover:bg-base-200"
          >
            {gridLabel}
          </button>
        )}

        <button
          type="button"
          title="Toggle grid & dimension snapping"
          disabled={!settings}
          onClick={() => toggleSetting("snap_enabled")}
          className={cn(
            "flex h-5.5 shrink-0 items-center gap-1 rounded px-2 text-[11px] transition-colors disabled:pointer-events-none disabled:opacity-30",
            settings?.snap_enabled
              ? "bg-accent-500/15 text-accent-500"
              : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Magnet size={12} strokeWidth={1.75} />
          Snap
        </button>

        <div
          className="flex h-5.5 items-center gap-0.5 rounded border border-base-200 bg-base-100 px-1"
          title="Dimension snap increment (hold Alt while dragging for 0.1 cm fine step)"
        >
          <Ruler size={11} className="mr-0.5 text-base-500" />
          {SNAP_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setDimSnapStep(step)}
              className={cn(
                "h-4 rounded px-1 font-mono text-[10px] transition-colors",
                dimSnapStep === step
                  ? "bg-accent-500 font-semibold text-white"
                  : "text-base-600 hover:bg-base-200 hover:text-base-800",
              )}
            >
              {step}
              {dimSnapStep === step ? ` ${unit}` : ""}
            </button>
          ))}
        </div>
      </div>

      <span className="h-4 w-px bg-base-200" />

      {/* Active status / tool hint */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            sketchMode || selKind !== "entity" ? "bg-accent-500" : "bg-base-400",
          )}
        />
        <span className="truncate font-medium text-base-700">{statusMessage}</span>
      </div>

      {sketchMode && (
        <span className="flex shrink-0 items-center gap-1 rounded bg-accent-500/15 px-2 py-0.5 font-mono text-[10.5px] text-accent-500">
          <PencilRuler size={11} />
          {sketchPlaneLabel}
        </span>
      )}

      {selectionCount > 0 && (
        <span className="shrink-0 rounded bg-base-200 px-2 py-0.5 text-[11px] font-medium text-base-700">
          {selectionCount} {selKind === "entity" ? "selected" : selKind}
        </span>
      )}

      <span className="h-4 w-px bg-base-200" />

      <span
        className="shrink-0 font-mono text-[11px] tabular-nums text-base-500"
        title="Cursor X · Y · Z coordinates"
      >
        X {fmt(cursorWorld[0])} · Y {fmt(cursorWorld[1])} · Z {fmt(cursorWorld[2])}
      </span>

      <span className="h-4 w-px bg-base-200" />

        <span className="shrink-0 tabular-nums text-base-500">
        {scene ? `${scene.entities.length} items` : "no doc"}
      </span>

      <button
        type="button"
        onClick={() => setLowSpecMode(!lowSpecMode)}
        title="Toggle Laptop Performance Mode (1.0x pixel ratio, disables shadows & PBR IBL)"
        className={cn(
          "flex h-5.5 shrink-0 items-center gap-1 rounded px-2 text-[11px] font-medium transition-colors",
          lowSpecMode
            ? "bg-amber-500/20 text-amber-500"
            : "text-base-500 hover:bg-base-200 hover:text-base-800",
        )}
      >
        <Zap size={12} strokeWidth={1.9} />
        Fast
      </button>
    </footer>
  );
}
