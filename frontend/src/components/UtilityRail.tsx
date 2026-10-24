import { useState } from "react";
import {
  Box,
  History,
  Maximize2,
  Redo2,
  Ruler,
  ScanEye,
  Slice,
  SquareCheck,
  StretchHorizontal,
  Undo2,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { actions } from "../lib/actions";
import { cn, Tip } from "./ui";

// ---------------------------------------------------------------------------
// Right-floating utility rail: display modes, screenshot, history popover,
// isolate, section view (live clipping plane), fit view, measure.
// ---------------------------------------------------------------------------

export function UtilityRail() {
  const displayMode = useArcStore((s) => s.displayMode);
  const setDisplayMode = useArcStore((s) => s.setDisplayMode);
  const isolated = useArcStore((s) => s.isolated);
  const sectionView = useArcStore((s) => s.sectionView);
  const setSectionView = useArcStore((s) => s.setSectionView);
  const scene = useArcStore((s) => s.scene);
  const tool = useArcStore((s) => s.tool);
  const [modesOpen, setModesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Display Mode Switcher */}
      <div className="relative">
        {modesOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setModesOpen(false)}
              aria-hidden
            />
            <div
              className={cn(
                "anim-pop absolute right-full top-0 z-40 mr-2 flex flex-col gap-0.5",
                "rounded-xl border border-base-200 bg-base-50/95 p-1 shadow-lg shadow-black/20 backdrop-blur-md",
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
                      ? "bg-accent-500/15 text-accent-500"
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
        <Tip label="Display Mode" keys={displayMode} side="left">
          <button
            type="button"
            onClick={() => {
              setHistoryOpen(false);
              setModesOpen((open) => !open);
            }}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              displayMode === "wireframe"
                ? "bg-accent-500/15 text-accent-500"
                : "text-base-600 hover:bg-base-200 hover:text-base-800",
            )}
          >
            <StretchHorizontal size={16} strokeWidth={1.6} />
          </button>
        </Tip>
      </div>

      {/* Fit View */}
      <Tip label="Fit View" keys="F" side="left">
        <button
          type="button"
          onClick={() => actions.fitView()}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-colors hover:bg-base-200 hover:text-base-800"
        >
          <Maximize2 size={15} strokeWidth={1.6} />
        </button>
      </Tip>

      {/* History / Undo-Redo Popover */}
      <div className="relative">
        {historyOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setHistoryOpen(false)}
              aria-hidden
            />
            <div
              className={cn(
                "anim-pop absolute right-full top-0 z-40 mr-2 flex w-44 flex-col gap-1",
                "rounded-xl border border-base-200 bg-base-50/95 p-2 shadow-lg shadow-black/20 backdrop-blur-md",
              )}
            >
              <div className="px-1 text-[10px] font-semibold uppercase tracking-wider text-base-500">
                History
              </div>
              <button
                type="button"
                disabled={!scene?.canUndo}
                onClick={() => void actions.undo()}
                className="flex h-7 items-center justify-between rounded-lg px-2 text-[12px] text-base-700 hover:bg-base-200 disabled:pointer-events-none disabled:opacity-35"
              >
                <span className="flex items-center gap-1.5">
                  <Undo2 size={13} /> Undo
                </span>
                <span className="font-mono text-[10px] text-base-500">Ctrl+Z</span>
              </button>
              <button
                type="button"
                disabled={!scene?.canRedo}
                onClick={() => void actions.redo()}
                className="flex h-7 items-center justify-between rounded-lg px-2 text-[12px] text-base-700 hover:bg-base-200 disabled:pointer-events-none disabled:opacity-35"
              >
                <span className="flex items-center gap-1.5">
                  <Redo2 size={13} /> Redo
                </span>
                <span className="font-mono text-[10px] text-base-500">Ctrl+Y</span>
              </button>
            </div>
          </>
        )}
        <Tip label="Undo / Redo History" side="left">
          <button
            type="button"
            onClick={() => {
              setModesOpen(false);
              setHistoryOpen((open) => !open);
            }}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
              historyOpen
                ? "bg-accent-500/15 text-accent-500"
                : "text-base-600 hover:bg-base-200 hover:text-base-800",
            )}
          >
            <History size={16} strokeWidth={1.6} />
          </button>
        </Tip>
      </div>

      {/* Isolate Selection */}
      <Tip
        label={isolated ? "Isolate ON · click to restore" : "Isolate Selection"}
        keys="Hide unselected"
        side="left"
      >
        <button
          type="button"
          onClick={() => void actions.isolateSelection()}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            isolated
              ? "bg-accent-500/15 text-accent-500"
              : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <SquareCheck size={16} strokeWidth={1.6} />
        </button>
      </Tip>

      {/* Section View (Live Clipping Plane) */}
      <Tip
        label={sectionView ? "Section View ON" : "Section View"}
        keys="Cut plane"
        side="left"
      >
        <button
          type="button"
          onClick={() => setSectionView(!sectionView)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            sectionView
              ? "bg-accent-500/15 text-accent-500"
              : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Slice size={16} strokeWidth={1.6} />
        </button>
      </Tip>

      {/* Measure / Dimension Tool */}
      <Tip label="Measure Distance" keys="D" side="left">
        <button
          type="button"
          onClick={() => useArcStore.getState().setTool("dimension")}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
            tool === "dimension"
              ? "bg-accent-500/15 text-accent-500"
              : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <Ruler size={16} strokeWidth={1.6} />
        </button>
      </Tip>

      {/* Screenshot */}
      <Tip label="Capture Screenshot" keys="PNG" side="left">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("arc-capture"))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-colors hover:bg-base-200 hover:text-base-800"
        >
          <ScanEye size={16} strokeWidth={1.6} />
        </button>
      </Tip>
    </div>
  );
}
