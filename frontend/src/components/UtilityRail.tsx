import { useState } from "react";
import {
  Axis3D,
  Box,
  Camera,
  History,
  Magnet,
  StretchHorizontal,
  Zap,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { cn } from "./ui";

// ---------------------------------------------------------------------------
// Shapr3D Right-Side Floating Controls (Screenshots 192241 – 192529):
// 1. Top-Right Vertical Pill (next to the 3D ViewCube):
//    - Snap Magnet toggle
//    - Tiny stacked `2` / `cm` grid scale box (cycles 1, 2, 5, 10 cm)
//    - Axes / Grid visibility toggle
// 2. Below ViewCube Shapr3D Rows (label pill on left + icon button on right):
//    - Display Modes
//    - Screenshot
//    - History (hides/shows the right-hand History & Inspector sidebar)
// ---------------------------------------------------------------------------

function RightShaprRow({
  icon,
  label,
  sub,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  sub?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group pointer-events-auto flex items-center justify-end gap-2 text-right outline-none"
    >
      <span
        className={cn(
          "flex h-9.5 items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] font-medium shadow-sm transition-colors",
          active
            ? "border-accent-500/50 bg-base-100 text-accent-500"
            : "border-base-300/70 bg-base-100 text-base-700 group-hover:border-base-400 group-hover:bg-base-200 group-hover:text-base-900",
        )}
      >
        <span className="flex flex-col items-end leading-tight">
          <span className="whitespace-nowrap">{label}</span>
          {sub && (
            <span className="whitespace-nowrap text-[9.5px] font-normal text-base-500">
              {sub}
            </span>
          )}
        </span>
      </span>
      <span
        className={cn(
          "flex h-9.5 w-9.5 shrink-0 items-center justify-center rounded-xl border shadow-sm transition-colors",
          active
            ? "border-accent-500 bg-accent-500 text-white shadow-accent-500/25"
            : "border-base-300/70 bg-base-100 text-base-700 group-hover:border-base-400 group-hover:bg-base-200 group-hover:text-base-900",
        )}
      >
        {icon}
      </span>
    </button>
  );
}

export function UtilityRail() {
  const settings = useArcStore((s) => s.settings);
  const displayMode = useArcStore((s) => s.displayMode);
  const setDisplayMode = useArcStore((s) => s.setDisplayMode);
  const rightSidebarOpen = useArcStore((s) => s.rightSidebarOpen);
  const setRightSidebarOpen = useArcStore((s) => s.setRightSidebarOpen);
  const lowSpecMode = useArcStore((s) => s.lowSpecMode);
  const setLowSpecMode = useArcStore((s) => s.setLowSpecMode);
  const [modesOpen, setModesOpen] = useState(false);

  const snapOn = settings?.snap_enabled ?? true;
  const gridOn = settings?.show_grid ?? true;
  const gridSize = settings?.grid_size ?? 1;
  const isImperial =
    settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";
  const unit = isImperial ? "in" : "cm";

  const toggleSnap = () => {
    if (!settings) return;
    void ipc
      .setSettings({ ...settings, snap_enabled: !settings.snap_enabled })
      .then((next) => useArcStore.getState().updateSettings(next))
      .catch(() => undefined);
  };

  const cycleGridSize = () => {
    if (!settings) return;
    const steps = [1, 2, 5, 10];
    const current = settings.grid_size;
    const idx = steps.indexOf(current);
    const nextSize = idx >= 0 ? steps[(idx + 1) % steps.length] : 2;
    void ipc
      .setSettings({ ...settings, grid_size: nextSize })
      .then((next) => useArcStore.getState().updateSettings(next))
      .catch(() => undefined);
  };

  const toggleGrid = () => {
    if (!settings) return;
    void ipc
      .setSettings({
        ...settings,
        show_grid: !settings.show_grid,
        show_axes: !settings.show_grid,
      })
      .then((next) => useArcStore.getState().updateSettings(next))
      .catch(() => undefined);
  };

  const toggleFastMode = () => {
    const next = !lowSpecMode;
    setLowSpecMode(next);
    if (settings) {
      void ipc
        .setSettings({ ...settings, fast_mode: next })
        .then((s) => useArcStore.getState().updateSettings(s))
        .catch(() => undefined);
    }
  };

  return (
    <>
      {/* 1. Top-Right Vertical Shapr3D Pill (next to the 3D ViewCube) */}
      <div className="pointer-events-auto absolute right-3 top-2.5 z-30 flex flex-col items-center gap-2 rounded-2xl border border-base-300/80 bg-base-100 p-2 shadow-md">
        <button
          type="button"
          onClick={toggleSnap}
          title={snapOn ? "Snap on" : "Snap off"}
          className={cn(
            "flex h-8.5 w-8.5 items-center justify-center rounded-xl transition-colors",
            snapOn
              ? "bg-accent-500/18 text-accent-500"
              : "text-base-500 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Magnet size={16} strokeWidth={1.9} />
        </button>

        {/* Stacked "2 / cm" grid scale indicator box */}
        <button
          type="button"
          onClick={cycleGridSize}
          title="Grid size"
          className="flex h-9 w-8.5 flex-col items-center justify-center rounded-xl border border-base-300 bg-base-200/80 leading-none text-base-800 transition-colors hover:border-accent-500/60 hover:text-accent-500"
        >
          <span className="font-mono text-[11.5px] font-bold leading-none">
            {gridSize}
          </span>
          <span className="mt-0.5 font-mono text-[9px] text-base-500 leading-none">
            {unit}
          </span>
        </button>

        <button
          type="button"
          onClick={toggleGrid}
          title={gridOn ? "Grid visible" : "Grid hidden"}
          className={cn(
            "flex h-8.5 w-8.5 items-center justify-center rounded-xl transition-colors",
            gridOn
              ? "bg-accent-500/18 text-accent-500"
              : "text-base-500 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Axis3D size={16} strokeWidth={1.9} />
        </button>

        <button
          type="button"
          onClick={toggleFastMode}
          title={
            lowSpecMode
              ? "Fast mode ON (Surface / low-spec potato optimization active)"
              : "Fast mode OFF (Click to boost performance on Surface / weak GPU)"
          }
          className={cn(
            "flex h-8.5 w-8.5 items-center justify-center rounded-xl transition-colors",
            lowSpecMode
              ? "bg-amber-500/20 text-amber-500"
              : "text-base-500 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Zap size={16} strokeWidth={1.9} />
        </button>
      </div>

      {/* 2. Below ViewCube Shapr3D Rows (Display Modes, Screenshot, History) */}
      <div className="pointer-events-none absolute right-3 top-[164px] z-30 flex flex-col items-end gap-1.5">
        <div className="relative">
          {modesOpen && (
            <>
              <div
                className="pointer-events-auto fixed inset-0 z-30"
                onClick={() => setModesOpen(false)}
                aria-hidden
              />
              <div
                className={cn(
                  "anim-pop pointer-events-auto absolute right-full top-0 z-40 mr-2 flex flex-col gap-0.5",
                  "rounded-xl border border-base-300/70 bg-base-100 p-1 shadow-lg shadow-black/30",
                )}
              >
                {(["shaded", "wireframe"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setDisplayMode(mode);
                      setModesOpen(false);
                    }}
                    className={cn(
                      "flex h-7 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-left text-[12px] font-medium capitalize transition-colors",
                      displayMode === mode
                        ? "bg-accent-500/18 text-accent-500"
                        : "text-base-600 hover:bg-base-200 hover:text-base-800",
                    )}
                  >
                    <Box size={13} strokeWidth={1.6} />
                    {mode}
                  </button>
                ))}
              </div>
            </>
          )}
          <RightShaprRow
            icon={<StretchHorizontal size={15} strokeWidth={1.75} />}
            label="Display Modes"
            active={displayMode === "wireframe"}
            onClick={() => setModesOpen((o) => !o)}
          />
        </div>

        <RightShaprRow
          icon={<Camera size={15} strokeWidth={1.75} />}
          label="Screenshot"
          onClick={() => window.dispatchEvent(new CustomEvent("arc-capture"))}
        />

        <RightShaprRow
          icon={<History size={15} strokeWidth={1.75} />}
          label="History"
          sub={rightSidebarOpen ? "Shown" : "Hidden"}
          active={rightSidebarOpen}
          onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
        />
      </div>
    </>
  );
}
