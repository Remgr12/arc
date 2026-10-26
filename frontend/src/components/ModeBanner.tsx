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
  Sparkles,
  DoorOpen,
  RotateCw,
  Minus,
  Plus,
  Columns,
  Armchair,
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
import {
  getActiveStorey,
  formatLengthUnit,
  WALL_PRESETS,
  WALL_LOCATION_LINES,
  setWallPresetIndex,
  cycleWallLocationLine,
  DOOR_PRESETS,
  setDoorPresetIndex,
  toggleDoorHand,
  toggleDoorFacing,
  WINDOW_PRESETS,
  setWindowPresetIndex,
  adjustWindowSill,
  ROOM_PRESETS,
  setRoomPresetIndex,
  ROOF_PITCH_PRESETS,
  setRoofPitchIndex,
  autoCreateBuildingRoof,
  autoCreateFloorSlab,
  COLUMN_PRESETS,
  setColumnPresetIndex,
  COMPONENT_SPECS,
  setActiveCompKind,
  rotateActiveComponent,
  getBimOptionsState,
  type ArchComponentKind,
} from "../tools/architecture";
import { ipc } from "../lib/ipc";
import { cn } from "./ui";
import type { ToolId } from "../lib/types";

// ---------------------------------------------------------------------------
// Sleek Mode Indicator & BIM Options Ribbon:
// - In CAD Mode: shows tool name and Degrees of Freedom (DoF) constraint info.
// - In BIM Sketch Mode: Footprint Edit Ribbon with storey workplane, Lucide icon
//   target element selector, loop validation, and Finish/Cancel controls.
// - In 3D BIM Mode: Revit / BIMCraft style contextual ribbon with storey datum,
//   chained wall presets, location line flipping, door/window hosting, 1-click
//   room/slab/roof creation.
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

const ARCH_TOOLS = new Set<ToolId>([
  "wall",
  "door",
  "window",
  "slab",
  "roof",
  "column",
  "room",
  "stair",
  "beam",
  "component",
  "grid",
  "level",
]);

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

  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const bimRibbonRef = useRef<HTMLDivElement>(null);

  const [, setBimTick] = useState(0);

  const isArch = scene?.projectMode === "architecture";

  useEffect(() => {
    const handleUpdate = () => setBimTick((t) => t + 1);
    window.addEventListener("arc-bim-options-update", handleUpdate);
    return () => window.removeEventListener("arc-bim-options-update", handleUpdate);
  }, []);

  useEffect(() => {
    if (!targetMenuOpen && !activeDropdown) return;
    const handler = (e: MouseEvent) => {
      if (targetMenuRef.current && !targetMenuRef.current.contains(e.target as Node)) {
        setTargetMenuOpen(false);
      }
      if (bimRibbonRef.current && !bimRibbonRef.current.contains(e.target as Node)) {
        setActiveDropdown(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [targetMenuOpen, activeDropdown]);

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
  const bimState = getBimOptionsState();

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

  const docId = useArcStore.getState().overview?.active;
  const levels = scene?.levels ?? [];

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-3">
      {/* Traditional BIM Footprint / Boundary Edit Ribbon */}
      {isArch && sketchMode ? (
        <div className="anim-slide-down pointer-events-auto flex items-center gap-3.5 rounded-full border border-base-300 bg-base-100/98 px-5 py-2 shadow-xl backdrop-blur-md">
          {/* Storey Datum Workplane */}
          <div className="flex items-center gap-2 text-[12.5px] font-semibold text-base-900 pr-1">
            <Building2 size={14} className="text-accent-500" />
            <span>{activeStorey.name}</span>
            <span className="text-[11px] text-base-400 font-mono">
              (+{activeStorey.elevation}cm)
            </span>
          </div>

          <div className="h-5 w-px bg-base-300/80" />

          {/* Target Element Selector with Lucide-React Icons */}
          <div className="relative" ref={targetMenuRef}>
            <button
              type="button"
              onClick={() => setTargetMenuOpen(!targetMenuOpen)}
              className="flex h-8 items-center gap-2 rounded-xl border border-base-300 bg-base-50/90 px-3 text-[12px] font-medium text-base-800 outline-none hover:bg-base-200 transition-colors cursor-pointer shadow-2xs"
            >
              <ActiveIcon size={14} className={activeTarget.color} strokeWidth={2} />
              <span className="font-semibold text-base-800">{activeTarget.label}</span>
              <ChevronDown
                size={12}
                className={cn(
                  "text-base-400 transition-transform duration-150",
                  targetMenuOpen && "rotate-180",
                )}
              />
            </button>

            {targetMenuOpen && (
              <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-56 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
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
                          "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-accent-500/15 text-accent-600 font-semibold"
                            : "text-base-700 hover:bg-base-200 hover:text-base-900",
                        )}
                      >
                        <div
                          className={cn(
                            "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg",
                            isSelected ? "bg-accent-500/10" : "bg-base-200/60",
                          )}
                        >
                          <Icon size={14} className={opt.color} strokeWidth={2} />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <span className="leading-tight font-medium text-[12px]">{opt.label}</span>
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

          <div className="h-5 w-px bg-base-300/80" />

          {/* Boundary Diagnostic Badge */}
          <div className="flex items-center gap-2 text-xs whitespace-nowrap">
            {bimDiag?.hasClosedLoop ? (
              <div className="flex items-center gap-1.5 text-emerald-600 font-medium bg-emerald-500/10 px-3 py-1 rounded-xl text-[12px]">
                <CheckCircle2 size={13} strokeWidth={2.5} />
                <span>Closed Boundary ({bimDiag.totalAreaM2.toFixed(1)} m²)</span>
              </div>
            ) : bimDiag && bimDiag.openEndsCount > 0 ? (
              <div className="flex items-center gap-1.5 text-amber-600 font-medium bg-amber-500/10 px-3 py-1 rounded-xl text-[12px]">
                <AlertCircle size={13} strokeWidth={2.5} />
                <span>Open Loop (connect ends)</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-base-400 text-[11.5px] px-2 py-1">
                <PencilRuler size={13} />
                <span>Draw boundary lines</span>
              </div>
            )}
          </div>

          {/* Pick Walls Button */}
          <button
            type="button"
            title="Pick Walls: Trace existing walls on this storey into boundary (W)"
            onClick={() => void traceWallsToBoundary()}
            className="flex h-8 items-center gap-1.5 rounded-xl border border-base-300 bg-base-50 px-3 text-[12px] font-semibold text-base-700 hover:bg-base-200 transition-colors cursor-pointer shadow-2xs"
          >
            <BrickWall size={13} className="text-amber-500" />
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
            className="flex h-8 w-8 items-center justify-center rounded-xl text-base-500 hover:bg-base-200 hover:text-base-800 transition-colors cursor-pointer"
          >
            <Eye size={14} strokeWidth={2} />
          </button>

          <div className="h-5 w-px bg-base-300/80" />

          {/* Traditional BIM Green Finish Button */}
          <button
            type="button"
            title="Finish Boundary & Generate BIM Element (Enter)"
            onClick={() => void commitBimBoundary(bimSketchTarget)}
            className="flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-[12.5px] font-bold text-white shadow-sm hover:bg-emerald-500 active:scale-[0.98] transition-all cursor-pointer"
          >
            <Check size={14} strokeWidth={2.5} />
            <span>Finish</span>
          </button>

          {/* Traditional BIM Red Discard Button */}
          <button
            type="button"
            title="Cancel & Discard Boundary (Esc)"
            onClick={() => void cancelBimBoundary()}
            className="flex h-8 items-center gap-1.5 rounded-xl border border-base-300 px-3.5 text-[12.5px] font-medium text-base-600 hover:bg-rose-500/10 hover:text-rose-600 hover:border-rose-300 transition-colors cursor-pointer"
          >
            <X size={13} strokeWidth={2.2} />
            <span>Cancel</span>
          </button>
        </div>
      ) : isArch && ARCH_TOOLS.has(tool) ? (
        /* Revit / BIMCraft Contextual BIM Options Ribbon */
        <div
          ref={bimRibbonRef}
          className="anim-slide-down pointer-events-auto flex items-center gap-2.5 rounded-full border border-base-300 bg-base-100/98 px-3.5 py-1.5 shadow-xl backdrop-blur-md"
        >
          {/* Active Storey Level Selector */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setActiveDropdown(activeDropdown === "level" ? null : "level")}
              className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
            >
              <Building2 size={13} className="text-accent-500 shrink-0" />
              <span>{activeStorey.name}</span>
              <span className="text-[10px] text-base-400 font-mono">
                (+{formatLengthUnit(activeStorey.elevation)})
              </span>
              <ChevronDown size={11} className="text-base-400" />
            </button>

            {activeDropdown === "level" && levels.length > 0 && (
              <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-52 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                  Building Storeys
                </div>
                <div className="flex flex-col gap-0.5">
                  {levels.map((lvl) => {
                    const isSelected = lvl.id === (scene?.activeLevel ?? levels[0]?.id);
                    return (
                      <button
                        key={lvl.id}
                        type="button"
                        onClick={() => {
                          if (docId) void ipc.setActiveLevel(docId, lvl.id);
                          setActiveDropdown(null);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                          isSelected
                            ? "bg-accent-500/15 text-accent-600 font-semibold"
                            : "text-base-700 hover:bg-base-200 hover:text-base-900",
                        )}
                      >
                        <span className="font-medium">{lvl.name}</span>
                        <span className="text-[11px] font-mono text-base-400">
                          +{formatLengthUnit(lvl.elevation)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-4 w-px bg-base-300/80" />

          {/* Wall Tool Contextual Controls */}
          {tool === "wall" && (
            <>
              {/* Wall Preset Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDropdown(activeDropdown === "wallPreset" ? null : "wallPreset")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <BrickWall size={13} className="text-amber-500 shrink-0" />
                  <span>{bimState.wallPreset.label}</span>
                  <ChevronDown size={11} className="text-base-400" />
                </button>

                {activeDropdown === "wallPreset" && (
                  <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-60 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                      Wall Type Preset (1-5)
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {WALL_PRESETS.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setWallPresetIndex(idx);
                            setActiveDropdown(null);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                            idx === bimState.wallPresetIndex
                              ? "bg-accent-500/15 text-accent-600 font-semibold"
                              : "text-base-700 hover:bg-base-200 hover:text-base-900",
                          )}
                        >
                          <div className="flex flex-col">
                            <span className="font-semibold">{p.label}</span>
                            <span className="text-[10px] text-base-400">{p.desc}</span>
                          </div>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-600">
                            {idx + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Location Line Flip Button */}
              <button
                type="button"
                title="Cycle Wall Location Line: Centerline / Exterior / Interior (Space)"
                onClick={() => cycleWallLocationLine()}
                className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <span>
                  Line:{" "}
                  <strong className="text-base-900 capitalize">
                    {WALL_LOCATION_LINES.find((l) => l.id === bimState.wallLocationLine)?.label ??
                      "Centerline"}
                  </strong>
                </span>
                <span className="rounded bg-base-200/90 px-1 py-0.2 text-[9.5px] font-mono text-base-500">
                  Space
                </span>
              </button>

              {/* Height Indicator */}
              <div className="flex items-center gap-1 text-[11px] text-base-500 font-mono bg-base-200/50 px-2 py-0.5 rounded-lg">
                <span>H: {formatLengthUnit(activeStorey.height)}</span>
              </div>
            </>
          )}

          {/* Door Tool Contextual Controls */}
          {tool === "door" && (
            <>
              {/* Door Preset Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDropdown(activeDropdown === "doorPreset" ? null : "doorPreset")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <DoorOpen size={13} className="text-emerald-500 shrink-0" />
                  <span>{bimState.doorPreset.label}</span>
                  <ChevronDown size={11} className="text-base-400" />
                </button>

                {activeDropdown === "doorPreset" && (
                  <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-56 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                      Door Size Preset (1-5)
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {DOOR_PRESETS.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setDoorPresetIndex(idx);
                            setActiveDropdown(null);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                            idx === bimState.doorPresetIndex
                              ? "bg-accent-500/15 text-accent-600 font-semibold"
                              : "text-base-700 hover:bg-base-200 hover:text-base-900",
                          )}
                        >
                          <span className="font-semibold">{p.label}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-600">
                            {idx + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Hand Flip Button */}
              <button
                type="button"
                title="Flip Door Hand (Space)"
                onClick={() => toggleDoorHand()}
                className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2 text-[11.5px] font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <span>Hand: {bimState.doorHand ? "Right" : "Left"}</span>
                <span className="rounded bg-base-200/90 px-1 py-0.2 text-[9.5px] font-mono text-base-500">
                  Space
                </span>
              </button>

              {/* Facing Flip Button */}
              <button
                type="button"
                title="Flip Door Facing (F)"
                onClick={() => toggleDoorFacing()}
                className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2 text-[11.5px] font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <span>Facing: {bimState.doorFacing ? "Exterior" : "Interior"}</span>
                <span className="rounded bg-base-200/90 px-1 py-0.2 text-[9.5px] font-mono text-base-500">
                  F
                </span>
              </button>
            </>
          )}

          {/* Window Tool Contextual Controls */}
          {tool === "window" && (
            <>
              {/* Window Preset Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDropdown(activeDropdown === "winPreset" ? null : "winPreset")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <Grid3X3 size={13} className="text-blue-500 shrink-0" />
                  <span>{bimState.windowPreset.label}</span>
                  <ChevronDown size={11} className="text-base-400" />
                </button>

                {activeDropdown === "winPreset" && (
                  <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-56 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                      Window Size Preset (1-5)
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {WINDOW_PRESETS.map((p, idx) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            setWindowPresetIndex(idx);
                            setActiveDropdown(null);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                            idx === bimState.windowPresetIndex
                              ? "bg-accent-500/15 text-accent-600 font-semibold"
                              : "text-base-700 hover:bg-base-200 hover:text-base-900",
                          )}
                        >
                          <span className="font-semibold">{p.label}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-600">
                            {idx + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Sill Height Stepper */}
              <div className="flex items-center gap-1 rounded-xl border border-base-300/80 bg-base-50/80 px-1 py-0.5 text-[11px] font-medium text-base-700">
                <button
                  type="button"
                  title="Decrease Sill Height 10cm ([)"
                  onClick={() => adjustWindowSill(-10)}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <Minus size={11} />
                </button>
                <span className="px-1 font-mono">
                  Sill: {formatLengthUnit(bimState.windowSill)}
                </span>
                <button
                  type="button"
                  title="Increase Sill Height 10cm (])"
                  onClick={() => adjustWindowSill(10)}
                  className="flex h-5 w-5 items-center justify-center rounded hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <Plus size={11} />
                </button>
              </div>
            </>
          )}

          {/* Room / Space Tool Contextual Controls */}
          {tool === "room" && (
            <>
              {/* Room Template Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDropdown(activeDropdown === "roomPreset" ? null : "roomPreset")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <Tag size={13} className="text-emerald-500 shrink-0" />
                  <span>
                    {bimState.roomPreset.name} ({bimState.roomPreset.number})
                  </span>
                  <ChevronDown size={11} className="text-base-400" />
                </button>

                {activeDropdown === "roomPreset" && (
                  <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-52 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                      Room Template (1-9)
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {ROOM_PRESETS.map((p, idx) => (
                        <button
                          key={p.number}
                          type="button"
                          onClick={() => {
                            setRoomPresetIndex(idx);
                            setActiveDropdown(null);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                            idx === bimState.roomPresetIndex
                              ? "bg-accent-500/15 text-accent-600 font-semibold"
                              : "text-base-700 hover:bg-base-200 hover:text-base-900",
                          )}
                        >
                          <span className="font-semibold">{p.name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-600">
                            {p.number}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* 1-Click Room Auto-Detection Badge */}
              <div className="flex items-center gap-1.5 rounded-xl bg-emerald-500/10 px-2.5 py-1 text-[11px] font-medium text-emerald-600">
                <Sparkles size={12} strokeWidth={2.2} />
                <span>1-Click Auto-Detect</span>
              </div>
            </>
          )}

          {/* Slab / Floor Tool Contextual Controls */}
          {tool === "slab" && (
            <>
              {/* Fit All Walls Button */}
              <button
                type="button"
                title="Auto-create floor slab fitting the entire building footprint on this storey"
                onClick={() => void autoCreateFloorSlab()}
                className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <Layers size={13} className="text-blue-500 shrink-0" />
                <span>1-Click Fit to Walls</span>
              </button>

              <div className="flex items-center gap-1 text-[11px] text-base-500 font-mono bg-base-200/50 px-2 py-0.5 rounded-lg">
                <span>Thickness: 20cm</span>
              </div>
            </>
          )}

          {/* Roof Tool Contextual Controls */}
          {tool === "roof" && (
            <>
              {/* Pitch Preset Pills */}
              <div className="flex items-center gap-1 rounded-xl border border-base-300/80 bg-base-50/80 p-0.5 text-[11px] font-medium">
                {ROOF_PITCH_PRESETS.map((pitch, idx) => (
                  <button
                    key={pitch}
                    type="button"
                    onClick={() => setRoofPitchIndex(idx)}
                    className={cn(
                      "rounded-lg px-2 py-0.5 transition-colors cursor-pointer",
                      idx === bimState.roofPitchIndex
                        ? "bg-amber-500/20 text-amber-600 font-bold"
                        : "text-base-600 hover:bg-base-200",
                    )}
                  >
                    {pitch}°
                  </button>
                ))}
              </div>

              {/* Fit Building Roof Button */}
              <button
                type="button"
                title="Auto-create roof fitted over the entire building footprint"
                onClick={() => void autoCreateBuildingRoof()}
                className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <Home size={13} className="text-amber-500 shrink-0" />
                <span>1-Click Fit Building Roof</span>
              </button>
            </>
          )}

          {/* Column Tool Contextual Controls */}
          {tool === "column" && (
            <div className="relative">
              <button
                type="button"
                onClick={() =>
                  setActiveDropdown(activeDropdown === "colPreset" ? null : "colPreset")
                }
                className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <Columns size={13} className="text-purple-500 shrink-0" />
                <span>{bimState.columnPreset.label}</span>
                <ChevronDown size={11} className="text-base-400" />
              </button>

              {activeDropdown === "colPreset" && (
                <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-56 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                  <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                    Column Type Preset (1-4)
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {COLUMN_PRESETS.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          setColumnPresetIndex(idx);
                          setActiveDropdown(null);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                          idx === bimState.columnPresetIndex
                            ? "bg-accent-500/15 text-accent-600 font-semibold"
                            : "text-base-700 hover:bg-base-200 hover:text-base-900",
                        )}
                      >
                        <span className="font-semibold">{p.label}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-600">
                          {idx + 1}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Component / Furniture Tool Contextual Controls */}
          {tool === "component" && (
            <>
              {/* Furniture Kind Dropdown */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() =>
                    setActiveDropdown(activeDropdown === "compKind" ? null : "compKind")
                  }
                  className="flex h-7 items-center gap-1.5 rounded-xl border border-base-300/80 bg-base-50/80 px-2.5 text-[11.5px] font-semibold text-base-800 hover:bg-base-200 transition-colors cursor-pointer"
                >
                  <Armchair size={13} className="text-indigo-500 shrink-0" />
                  <span>{bimState.compSpec.label}</span>
                  <ChevronDown size={11} className="text-base-400" />
                </button>

                {activeDropdown === "compKind" && (
                  <div className="anim-pop absolute left-0 top-full mt-2 z-50 flex w-52 flex-col rounded-2xl border border-base-300 bg-base-100 p-1.5 shadow-2xl shadow-black/30">
                    <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-base-400">
                      Component Type (1-8)
                    </div>
                    <div className="flex flex-col gap-0.5">
                      {(Object.keys(COMPONENT_SPECS) as ArchComponentKind[]).map((k, idx) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setActiveCompKind(k);
                            setActiveDropdown(null);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                            k === bimState.compKind
                              ? "bg-accent-500/15 text-accent-600 font-semibold"
                              : "text-base-700 hover:bg-base-200 hover:text-base-900",
                          )}
                        >
                          <span className="font-semibold">{COMPONENT_SPECS[k].label}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-base-200 text-base-600">
                            {idx + 1}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Rotate Button */}
              <button
                type="button"
                title="Rotate 45° (Space)"
                onClick={() => rotateActiveComponent()}
                className="flex h-7 items-center gap-1 rounded-xl border border-base-300/80 bg-base-50/80 px-2 text-[11px] font-medium text-base-700 hover:bg-base-200 transition-colors cursor-pointer"
              >
                <RotateCw size={11} />
                <span>{bimState.compRotation}°</span>
                <span className="rounded bg-base-200/90 px-1 py-0.2 text-[9.5px] font-mono text-base-500">
                  Space
                </span>
              </button>
            </>
          )}

          {/* Stair Tool Contextual Info */}
          {tool === "stair" && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-base-600 px-1">
              <span>Optimal risers to meet storey height ({formatLengthUnit(activeStorey.height)})</span>
            </div>
          )}

          {/* Beam Tool Contextual Info */}
          {tool === "beam" && (
            <div className="flex items-center gap-1.5 text-[11.5px] text-base-600 px-1">
              <span>Ceiling framing beam (+{formatLengthUnit(activeStorey.elevation + activeStorey.height)})</span>
            </div>
          )}

          <div className="h-4 w-px bg-base-300/80" />

          {/* Exit Tool Button */}
          <button
            type="button"
            title="Exit Tool (Esc)"
            onClick={deselectTool}
            className="flex h-6 w-6 items-center justify-center rounded-lg text-base-400 hover:bg-base-200 hover:text-base-800 transition-colors cursor-pointer"
          >
            <X size={13} strokeWidth={2.2} />
          </button>
        </div>
      ) : (tool !== "select" || drafting || sketchMode) && (
        /* Standard CAD Mode Indicator */
        <div className="anim-slide-down pointer-events-auto flex items-center gap-3 rounded-full border border-base-300 bg-base-100/98 px-4 py-2 shadow-lg text-[12.5px]">
          <span className="font-semibold text-base-900 whitespace-nowrap">
            {sketchMode ? `Sketch: ${sketchPlaneLabel.split(" ")[0]}` : label}
          </span>
          {sketchMode && (
            <div className="flex items-center gap-2 border-l border-base-200 pl-2.5 text-[11.5px] whitespace-nowrap">
              {sketchEntities.length === 0 ? (
                <Compass size={14} className="text-base-400 shrink-0" strokeWidth={2} />
              ) : isFullyDefined ? (
                <CheckCircle2 size={14} className="text-emerald-400 shrink-0" strokeWidth={2.2} />
              ) : (
                <AlertCircle size={14} className="text-amber-400 shrink-0" strokeWidth={2.2} />
              )}
              <span className="font-mono text-[11px] font-medium text-base-600 truncate max-w-[200px]">
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
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-base-500 transition-colors hover:bg-base-200 hover:text-base-800 cursor-pointer"
            >
              <Eye size={13} strokeWidth={2.2} />
            </button>
          )}
          <button
            type="button"
            title="Exit"
            onClick={sketchMode ? exitSketchMode : deselectTool}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-base-500 transition-colors hover:bg-base-200 hover:text-base-800 cursor-pointer"
          >
            <X size={13} strokeWidth={2.2} />
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
