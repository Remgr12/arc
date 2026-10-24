import { Check, Compass, Minus, Plus, RotateCcw, Slice, X } from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { cn } from "./ui";
import type { ToolId } from "../lib/types";

// ---------------------------------------------------------------------------
// Top-center mode banner: shows active tool controls, Sketch Mode plane &
// camera alignment, Polygon sides stepper, and Section View offset slider.
// ---------------------------------------------------------------------------

export function ModeBanner() {
  const tool = useArcStore((s) => s.tool) as ToolId;
  const drafting = useArcStore((s) => s.drafting);
  const sketchMode = useArcStore((s) => s.sketchMode);
  const sketchPlaneHeight = useArcStore((s) => s.sketchPlaneHeight);
  const sketchPlaneNormal = useArcStore((s) => s.sketchPlaneNormal);
  const sketchPlaneLabel = useArcStore((s) => s.sketchPlaneLabel);
  const setSketchPlane = useArcStore((s) => s.setSketchPlane);
  const enterSketchMode = useArcStore((s) => s.enterSketchMode);
  const exitSketchMode = useArcStore((s) => s.exitSketchMode);
  const polygonSides = useArcStore((s) => s.polygonSides);
  const setPolygonSides = useArcStore((s) => s.setPolygonSides);
  const sectionView = useArcStore((s) => s.sectionView);
  const sectionOffset = useArcStore((s) => s.sectionOffset);
  const setSectionOffset = useArcStore((s) => s.setSectionOffset);
  const setSectionView = useArcStore((s) => s.setSectionView);

  const visible = tool !== "select" || drafting || sketchMode || sectionView;
  if (!visible) return null;

  const def = TOOL_BY_ID.get(tool);
  const label = def?.label ?? (drafting ? "Drafting" : tool);

  const alignNormalView = (normal: [number, number, number] = sketchPlaneNormal) => {
    window.dispatchEvent(
      new CustomEvent("arc-focus-plane", { detail: { normal } }),
    );
  };

  const switchPlane = (normal: [number, number, number], name: string) => {
    enterSketchMode({ origin: [0, 0, 0], normal, label: name, tool });
    alignNormalView(normal);
  };

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 flex-wrap items-center justify-center gap-2">
      {(tool !== "select" || drafting || sketchMode) && (
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full border border-base-200",
            "bg-base-50/95 px-3 py-1 shadow-lg shadow-black/20 backdrop-blur-md",
          )}
        >
          <span className="h-2 w-2 rounded-full bg-accent-500" />
          <span className="text-[12px] font-semibold text-base-800">{label}</span>

          {sketchMode && (
            <>
              <span className="h-3.5 w-px bg-base-200" />
              <div className="flex items-center gap-0.5 rounded bg-base-150 p-0.5 text-[10.5px]">
                <button
                  type="button"
                  onClick={() => switchPlane([0, 1, 0], "Top XZ (Y = 0)")}
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono transition-colors",
                    Math.abs(sketchPlaneNormal[1]) >= 0.9
                      ? "bg-accent-500 font-semibold text-white"
                      : "text-base-600 hover:bg-base-200",
                  )}
                  title="Sketch on Horizontal Top Plane (XZ)"
                >
                  XZ
                </button>
                <button
                  type="button"
                  onClick={() => switchPlane([0, 0, 1], "Front XY (Z = 0)")}
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono transition-colors",
                    Math.abs(sketchPlaneNormal[2]) >= 0.9
                      ? "bg-accent-500 font-semibold text-white"
                      : "text-base-600 hover:bg-base-200",
                  )}
                  title="Sketch on Vertical Front Plane (XY)"
                >
                  XY
                </button>
                <button
                  type="button"
                  onClick={() => switchPlane([1, 0, 0], "Side YZ (X = 0)")}
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono transition-colors",
                    Math.abs(sketchPlaneNormal[0]) >= 0.9
                      ? "bg-accent-500 font-semibold text-white"
                      : "text-base-600 hover:bg-base-200",
                  )}
                  title="Sketch on Vertical Side Plane (YZ)"
                >
                  YZ
                </button>
              </div>
              <span className="rounded bg-accent-500/15 px-1.5 py-0.5 font-mono text-[11px] text-accent-500">
                {sketchPlaneLabel}
              </span>
              {Math.abs(sketchPlaneHeight) > 1e-4 && (
                <button
                  type="button"
                  title="Reset sketch plane offset to 0"
                  onClick={() => setSketchPlane(0)}
                  className="flex h-5 items-center gap-1 rounded px-1.5 text-[11px] text-base-600 hover:bg-base-200 hover:text-base-800"
                >
                  <RotateCcw size={11} />
                  0
                </button>
              )}
              <button
                type="button"
                title="Align camera normal to active sketch plane"
                onClick={() => alignNormalView()}
                className="flex h-5 items-center gap-1 rounded bg-base-200 px-2 text-[11px] font-medium text-base-700 transition-colors hover:bg-base-300 hover:text-base-900"
              >
                <Compass size={11} />
                Normal View
              </button>
            </>
          )}

          {tool === "polygon" && (
            <>
              <span className="h-3.5 w-px bg-base-200" />
              <div className="flex items-center gap-1 text-[11px] text-base-700">
                <span className="text-base-500">Sides:</span>
                <button
                  type="button"
                  onClick={() => setPolygonSides(polygonSides - 1)}
                  className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
                  title="Decrease sides ([)"
                >
                  <Minus size={11} />
                </button>
                <span className="min-w-[1.25rem] text-center font-mono font-semibold text-base-800">
                  {polygonSides}
                </span>
                <button
                  type="button"
                  onClick={() => setPolygonSides(polygonSides + 1)}
                  className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
                  title="Increase sides (])"
                >
                  <Plus size={11} />
                </button>
              </div>
            </>
          )}

          {sketchMode ? (
            <button
              type="button"
              title="Finish Sketch (Esc)"
              onClick={exitSketchMode}
              className="ml-1 flex h-5 items-center gap-1 rounded-full bg-accent-500 px-2 text-[11px] font-medium text-white transition-colors hover:bg-accent-600"
            >
              <Check size={11} strokeWidth={2.2} />
              Done
            </button>
          ) : (
            <button
              type="button"
              title={def?.tip ?? "Cancel (Esc)"}
              onClick={() => window.dispatchEvent(new CustomEvent("arc-draft-cancel"))}
              className="flex h-5 w-5 items-center justify-center rounded-full text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
            >
              <X size={13} strokeWidth={1.75} />
            </button>
          )}
        </div>
      )}

      {sectionView && (
        <div
          className={cn(
            "pointer-events-auto flex items-center gap-2 rounded-full border border-base-200",
            "bg-base-50/95 px-3 py-1 shadow-lg shadow-black/20 backdrop-blur-md",
          )}
        >
          <Slice size={13} className="text-accent-500" />
          <span className="text-[11.5px] font-medium text-base-700">Section Y:</span>
          <input
            type="range"
            min={-60}
            max={120}
            step={1}
            value={sectionOffset}
            onChange={(e) => setSectionOffset(Number(e.target.value))}
            className="h-1.5 w-24 cursor-pointer accent-accent-500"
          />
          <span className="w-8 font-mono text-[11px] tabular-nums text-base-600">
            {sectionOffset}
          </span>
          <button
            type="button"
            title="Close section view"
            onClick={() => setSectionView(false)}
            className="flex h-5 w-5 items-center justify-center rounded-full text-base-500 hover:bg-base-200 hover:text-base-800"
          >
            <X size={12} />
          </button>
        </div>
      )}
    </div>
  );
}
