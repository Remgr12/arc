import { AlertCircle, CheckCircle2, Compass, Eye, Slice, X } from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { SKETCH_ENTITY_KINDS } from "../lib/selectionContext";
import type { ToolId } from "../lib/types";

// ---------------------------------------------------------------------------
// Sleek, minimal horizontal indicator: shows active tool name and compact controls.
// ---------------------------------------------------------------------------

export function ModeBanner() {
  const tool = useArcStore((s) => s.tool) as ToolId;
  const drafting = useArcStore((s) => s.drafting);
  const sketchMode = useArcStore((s) => s.sketchMode);
  const sketchPlaneLabel = useArcStore((s) => s.sketchPlaneLabel);
  const exitSketchMode = useArcStore((s) => s.exitSketchMode);
  const sectionView = useArcStore((s) => s.sectionView);
  const sectionOffset = useArcStore((s) => s.sectionOffset);
  const setSectionOffset = useArcStore((s) => s.setSectionOffset);
  const setSectionView = useArcStore((s) => s.setSectionView);
  const scene = useArcStore((s) => s.scene);

  const visible = tool !== "select" || drafting || sketchMode || sectionView;
  if (!visible) return null;

  const def = TOOL_BY_ID.get(tool);
  const label = def?.label ?? (drafting ? "Drafting" : tool);

  // SolveSpace & FreeCAD inspired Degrees of Freedom (DoF) and constraint diagnostics
  const sketchEntities =
    scene?.entities.filter(
      (e) => e.visible && (e.category === "sketch" || SKETCH_ENTITY_KINDS.has(e.kind)),
    ) ?? [];
  const openLineSegments = sketchEntities.filter(
    (e) => e.kind === "line" || e.kind === "line_curve",
  ).length;
  const closedLoops = sketchEntities.filter((e) => {
    if (
      e.kind === "circle" ||
      e.kind === "circle_curve" ||
      e.kind === "rectangle" ||
      e.kind === "rectangle_curve" ||
      e.kind === "polygon" ||
      e.kind === "polygon_curve"
    ) {
      return true;
    }
    if (e.kind === "polyline_curve" || e.kind === "polyline") {
      const g = e.geometry as Record<string, unknown>;
      const pts = (g.points as [number, number, number][]) ?? [];
      return (
        pts.length > 2 &&
        Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][2] - pts[pts.length - 1][2]) < 0.1
      );
    }
    return false;
  }).length;

  const isFullyDefined = sketchEntities.length > 0 && openLineSegments === 0 && closedLoops > 0;
  const dofCount = openLineSegments * 2;
  const dofStatusText =
    sketchEntities.length === 0
      ? "Empty Plane"
      : isFullyDefined
        ? `Fully Defined (${closedLoops} ${closedLoops === 1 ? "profile" : "profiles"})`
        : `${dofCount} DoF (Under-constrained)`;

  const deselectTool = () => {
    window.dispatchEvent(new CustomEvent("arc-draft-cancel"));
    useArcStore.getState().setTool("select");
    useArcStore.getState().setDrafting(false);
  };

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2">
      {/* Small horizontal tool indicator */}
      {(tool !== "select" || drafting || sketchMode) && (
        <div className="anim-slide-down pointer-events-auto flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3.5 py-1.5 shadow-md">
          <span className="text-[12px] font-semibold text-base-900 whitespace-nowrap">
            {sketchMode ? `Sketch · ${sketchPlaneLabel.split(" ")[0]}` : label}
          </span>
          {sketchMode && (
            <div className="flex items-center gap-1.5 border-l border-base-200 pl-2 text-[11px] whitespace-nowrap">
              {sketchEntities.length === 0 ? (
                <Compass size={13} className="text-base-400 shrink-0" strokeWidth={2} />
              ) : isFullyDefined ? (
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" strokeWidth={2.2} />
              ) : (
                <AlertCircle size={13} className="text-amber-400 shrink-0" strokeWidth={2.2} />
              )}
              <span className="font-mono text-[10.5px] font-medium text-base-600 truncate max-w-[200px]">
                {dofStatusText}
              </span>
            </div>
          )}
          {sketchMode && (
            <button
              type="button"
              title="Focus plane"
              onClick={() => {
                const n = useArcStore.getState().sketchPlaneNormal;
                window.dispatchEvent(
                  new CustomEvent("arc-focus-plane", { detail: { normal: n } }),
                );
              }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
            >
              <Eye size={12} strokeWidth={2.2} />
            </button>
          )}
          <button
            type="button"
            title="Exit"
            onClick={sketchMode ? exitSketchMode : deselectTool}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {/* Compact section view slider */}
      {sectionView && (
        <div className="anim-slide-down pointer-events-auto flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3.5 py-1.5 shadow-md">
          <Slice size={13} className="text-accent-500 shrink-0" />
          <span className="text-[11.5px] font-medium text-base-700 whitespace-nowrap">Section</span>
          <input
            type="range"
            min={-60}
            max={120}
            step={1}
            value={sectionOffset}
            onChange={(e) => setSectionOffset(Number(e.target.value))}
            className="h-1.5 w-20 cursor-pointer accent-accent-500"
          />
          <button
            type="button"
            title="Close"
            onClick={() => setSectionView(false)}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-base-500 hover:bg-base-200 hover:text-base-800"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}
