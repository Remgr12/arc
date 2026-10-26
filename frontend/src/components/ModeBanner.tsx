import { useState, useRef, useEffect } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Compass,
  Eye,
  Slice,
  X,
  Check,
  Building2,
  BrickWall,
  PencilRuler,
  Layers,
  Home,
  Grid3X3,
  Tag,
  Box,
  ChevronDown,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { SKETCH_ENTITY_KINDS } from "../lib/selectionContext";
import {
  extractClosedBoundaries,
  commitBimBoundary,
  cancelBimBoundary,
  traceWallsToBoundary,
  type BimSketchTarget,
} from "../tools/bimSketch";
import { getActiveStorey } from "../tools/architecture";
import { cn } from "./ui";
import type { ToolId } from "../lib/types";

// ---------------------------------------------------------------------------
// Sleek Mode Indicator:
// - In CAD Mode: shows tool name and Degrees of Freedom (DoF) constraint info.
// - In BIM Mode: provides traditional Revit/BIMCraft Footprint Edit Ribbon
//   with storey workplane, Lucide icon target element selector, loop validation,
//   and Finish/Cancel controls.
// ---------------------------------------------------------------------------

interface TargetOption {
  id: BimSketchTarget;
  label: string;
  sub: string;
  icon: typeof Layers;
  color: string;
}

const TARGET_OPTIONS: TargetOption[] = [
  {
    id: "slab",
    label: "Floor Slab",
    sub: "Horizontal floor plate",
    icon: Layers,
    color: "text-blue-500",
  },
  {
    id: "roof",
    label: "Roof Footprint",
    sub: "Pitched / flat roof",
    icon: Home,
    color: "text-amber-500",
  },
  {
    id: "ceiling",
    label: "Ceiling Plate",
    sub: "Interior ceiling plate",
    icon: Grid3X3,
    color: "text-indigo-500",
  },
  {
    id: "room",
    label: "Room Space",
    sub: "Zoned room space tag",
    icon: Tag,
    color: "text-emerald-500",
  },
  {
    id: "extrude",
    label: "Solid Extrude",
    sub: "Upward 3D extrusion",
    icon: Box,
    color: "text-purple-500",
  },
];

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
  const bimSketchTarget = useArcStore((s) => s.bimSketchTarget);
  const setBimSketchTarget = useArcStore((s) => s.setBimSketchTarget);

  const [targetMenuOpen, setTargetMenuOpen] = useState(false);
  const targetMenuRef = useRef<HTMLDivElement>(null);

  const isArch = scene?.projectMode === "architecture";

  useEffect(() => {
    if (!targetMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (targetMenuRef.current && !targetMenuRef.current.contains(e.target as Node)) {
        setTargetMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [targetMenuOpen]);

  const visible = tool !== "select" || drafting || sketchMode || sectionView;
  if (!visible) return null;

  const def = TOOL_BY_ID.get(tool);
  const label = def?.label ?? (drafting ? "Drafting" : tool);

  // Traditional BIM Boundary extraction and loop diagnostics
  const bimDiag = isArch && sketchMode ? extractClosedBoundaries(scene?.entities ?? []) : null;
  const activeStorey = getActiveStorey();
  const activeTarget =
    TARGET_OPTIONS.find((t) => t.id === bimSketchTarget) ?? TARGET_OPTIONS[0];
  const ActiveIcon = activeTarget.icon;

  // Mechanical CAD Degrees of Freedom (DoF) diagnostics
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
      {/* Traditional BIM Footprint / Boundary Edit Ribbon */}
      {isArch && sketchMode ? (
        <div className="anim-slide-down pointer-events-auto flex items-center gap-2.5 rounded-full border border-base-300 bg-base-100/95 px-3.5 py-1.5 shadow-lg backdrop-blur-md">
          {/* Storey Datum Workplane */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-base-900 pr-1">
            <Building2 size={13} className="text-accent-500" />
            <span>{activeStorey.name}</span>
            <span className="text-[10px] text-base-400 font-mono">
              (+{activeStorey.elevation}cm)
            </span>
          </div>

          <div className="h-4 w-px bg-base-300" />

          {/* Target Element Selector with Lucide-React Icons */}
          <div className="relative" ref={targetMenuRef}>
            <button
              type="button"
              onClick={() => setTargetMenuOpen(!targetMenuOpen)}
              className="flex h-6.5 items-center gap-1.5 rounded-md border border-base-300 bg-base-50/90 px-2 text-xs font-medium text-base-800 outline-none hover:bg-base-200 transition-colors cursor-pointer shadow-2xs"
            >
              <ActiveIcon size={12} className={activeTarget.color} strokeWidth={2} />
              <span className="font-semibold text-base-800">{activeTarget.label}</span>
              <ChevronDown
                size={11}
                className={cn(
                  "text-base-400 transition-transform duration-150",
                  targetMenuOpen && "rotate-180",
                )}
              />
            </button>

            {targetMenuOpen && (
              <div className="anim-pop absolute left-0 top-full mt-1.5 z-50 flex w-52 flex-col rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl shadow-black/40">
                <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                  Target BIM Element
                </div>
                <div className="flex flex-col gap-0.5">
                  {TARGET_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    const isSelected = opt.id === bimSketchTarget;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setBimSketchTarget(opt.id);
                          setTargetMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-accent-500/15 text-accent-600 font-semibold"
                            : "text-base-700 hover:bg-base-200 hover:text-base-900",
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded",
                            isSelected ? "bg-accent-500/10" : "bg-base-200/60",
                          )}
                        >
                          <Icon size={13} className={opt.color} strokeWidth={2} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="leading-tight font-medium">{opt.label}</span>
                          <span className="text-[10px] text-base-400 font-normal truncate">
                            {opt.sub}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-base-300" />

          {/* Boundary Diagnostic Badge */}
          <div className="flex items-center gap-1.5 text-xs whitespace-nowrap">
            {bimDiag?.hasClosedLoop ? (
              <div className="flex items-center gap-1 text-emerald-600 font-medium bg-emerald-500/10 px-2 py-0.5 rounded-md">
                <CheckCircle2 size={12} strokeWidth={2.5} />
                <span>Closed Boundary ({bimDiag.totalAreaM2.toFixed(1)} m²)</span>
              </div>
            ) : bimDiag && bimDiag.openEndsCount > 0 ? (
              <div className="flex items-center gap-1 text-amber-600 font-medium bg-amber-500/10 px-2 py-0.5 rounded-md">
                <AlertCircle size={12} strokeWidth={2.5} />
                <span>Open Loop (connect ends)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-base-400 text-[11px]">
                <PencilRuler size={12} />
                <span>Draw boundary lines</span>
              </div>
            )}
          </div>

          {/* Pick Walls Button */}
          <button
            type="button"
            title="Pick Walls: Trace existing walls on this storey into boundary (W)"
            onClick={() => void traceWallsToBoundary()}
            className="flex items-center gap-1 rounded border border-base-300 bg-base-50 px-2 py-0.5 text-xs font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer"
          >
            <BrickWall size={11} className="text-amber-500" />
            <span>Pick Walls</span>
          </button>

          {/* Focus Plan */}
          <button
            type="button"
            title="Focus Storey Workplane"
            onClick={() => {
              const n = useArcStore.getState().sketchPlaneNormal;
              window.dispatchEvent(new CustomEvent("arc-focus-plane", { detail: { normal: n } }));
            }}
            className="flex h-6 w-6 items-center justify-center rounded-full text-base-500 hover:bg-base-200 hover:text-base-800 transition-colors"
          >
            <Eye size={13} strokeWidth={2} />
          </button>

          <div className="h-4 w-px bg-base-300" />

          {/* Traditional BIM Green Finish Button */}
          <button
            type="button"
            title="Finish Boundary & Generate BIM Element (Enter)"
            onClick={() => void commitBimBoundary(bimSketchTarget)}
            className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1 text-xs font-semibold text-white shadow-2xs hover:bg-emerald-500 transition-colors cursor-pointer"
          >
            <Check size={13} strokeWidth={2.5} />
            <span>Finish</span>
          </button>

          {/* Traditional BIM Red Discard Button */}
          <button
            type="button"
            title="Cancel & Discard Boundary (Esc)"
            onClick={() => void cancelBimBoundary()}
            className="flex items-center gap-1 rounded-full border border-base-300 px-2.5 py-1 text-xs font-medium text-base-600 hover:bg-rose-500/10 hover:text-rose-600 hover:border-rose-300 transition-colors cursor-pointer"
          >
            <X size={12} strokeWidth={2.2} />
            <span>Cancel</span>
          </button>
        </div>
      ) : (tool !== "select" || drafting || sketchMode) && (
        /* Standard CAD Mode Indicator */
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
