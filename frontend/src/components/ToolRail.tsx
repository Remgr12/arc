import {
  Box,
  BrickWall,
  Check,
  Combine,
  Compass,
  Copy,
  DoorOpen,
  Eye,
  FolderKanban,
  Grid3X3,
  Home,
  Layers,
  Maximize2,
  Move,
  MoveHorizontal,
  MoveVertical,
  Orbit,
  Paintbrush,
  PencilRuler,
  Plus,
  Ruler,
  Scaling,
  Scissors,
  Search,
  Slice,
  Sparkles,
  Square,
  Table,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { armExtrudeSelectedSketch } from "../tools/solid";
import { facePlaneInfo } from "../tools/topology";
import { faceEditable } from "../tools/faceTools";
import { SKETCH_ENTITY_KINDS } from "../lib/selectionContext";
import { commitBimBoundary, cancelBimBoundary, traceWallsToBoundary } from "../tools/bimSketch";
import { cn } from "./ui";
import type { ToolId, Geometry } from "../lib/types";
import type { ReactNode } from "react";

interface ShaprRowProps {
  icon: ReactNode;
  label: string;
  sub?: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

/**
 * Shapr3D-style dock row: a 34×34 icon button on the left + a floating dark
 * translucent label pill right next to it.
 */
function ShaprRow({
  icon,
  label,
  sub,
  shortcut,
  active,
  disabled,
  danger,
  onClick,
}: ShaprRowProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group pointer-events-auto flex items-center gap-2 text-left transition-all duration-150 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-35",
      )}
    >
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors shadow-sm",
          active
            ? "border-accent-500 bg-accent-500 text-white"
            : danger
              ? "border-base-300 bg-base-100 text-base-600 group-hover:border-danger-500/60 group-hover:bg-danger-500/20 group-hover:text-danger-500"
              : "border-base-300/80 bg-base-100 text-base-700 group-hover:border-base-400 group-hover:bg-base-200 group-hover:text-base-900",
        )}
      >
        {icon}
      </span>
      <span
        className={cn(
          "flex flex-col justify-center rounded-lg border px-3 py-1.5 shadow-sm transition-colors",
          active
            ? "border-accent-500/60 bg-base-100 text-base-900"
            : "border-base-300/70 bg-base-100 text-base-800 group-hover:bg-base-200",
        )}
      >
        <span className="flex items-center gap-1.5 whitespace-nowrap text-[12px] font-semibold leading-tight">
          <span>{label}</span>
          {shortcut && (
            <span className="shrink-0 rounded bg-base-200 px-1.5 py-0.2 font-mono text-[9.5px] font-medium text-base-500 leading-none">
              {shortcut}
            </span>
          )}
        </span>
        {sub && (
          <span className="whitespace-nowrap text-[10px] leading-tight text-base-500">
            {sub}
          </span>
        )}
      </span>
    </button>
  );
}

const SKETCH_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "line", key: "L" },
  { id: "arc", key: "A" },
  { id: "polyline" },
  { id: "rectangle", key: "R" },
  { id: "circle", key: "C" },
  { id: "polygon", key: "G" },
  { id: "trim", key: "T" },
  { id: "offset", key: "O" },
  { id: "fillet", key: "F" },
  { id: "mirror", key: "I" },
];

const CONSTRUCT_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "box", key: "B" },
  { id: "cylinder", key: "Y" },
  { id: "sphere" },
  { id: "cone" },
  { id: "torus" },
];

const INSERT_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "plane" },
  { id: "wall", key: "W" },
  { id: "dimension", key: "D" },
];

const MODEL_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "extrude", key: "E" },
  { id: "extrude-face" },
  { id: "offset-face" },
  { id: "fillet-edge", key: "F" },
  { id: "revolve", key: "V" },
  { id: "sweep" },
  { id: "loft" },
];

const ARCH_STRUCTURE_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "wall", key: "W" },
  { id: "slab", key: "L" },
  { id: "roof", key: "R" },
  { id: "column", key: "C" },
  { id: "beam", key: "B" },
];

const ARCH_OPENING_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "door", key: "D" },
  { id: "window", key: "N" },
];

const ARCH_BUILD_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "stair", key: "S" },
  { id: "component", key: "F" },
  { id: "room", key: "M" },
];

const ARCH_DATUM_TOOLS: { id: ToolId; sub?: string; key?: string }[] = [
  { id: "grid", key: "G" },
  { id: "level", key: "V" },
];

export function ToolRail() {
  const tool = useArcStore((s) => s.tool) as ToolId;
  const setTool = useArcStore((s) => s.setTool);
  const sketchMode = useArcStore((s) => s.sketchMode);
  const enterSketchMode = useArcStore((s) => s.enterSketchMode);
  const exitSketchMode = useArcStore((s) => s.exitSketchMode);
  const scene = useArcStore((s) => s.scene);
  const overview = useArcStore((s) => s.overview);
  const selKind = useArcStore((s) => s.selKind);
  const selFace = useArcStore((s) => s.selFace);
  const selEdge = useArcStore((s) => s.selEdge);
  const isolated = useArcStore((s) => s.isolated);
  const sectionView = useArcStore((s) => s.sectionView);
  const setSectionView = useArcStore((s) => s.setSectionView);
  const leftSidebarOpen = useArcStore((s) => s.leftSidebarOpen);
  const setLeftSidebarOpen = useArcStore((s) => s.setLeftSidebarOpen);
  const activeCat = useArcStore((s) => s.activeToolCategory);
  const setActiveCat = useArcStore((s) => s.setActiveToolCategory);
  const bimSketchTarget = useArcStore((s) => s.bimSketchTarget);

  const targetLabel =
    bimSketchTarget === "slab"
      ? "Floor Slab"
      : bimSketchTarget === "roof"
        ? "Roof"
        : bimSketchTarget === "ceiling"
          ? "Ceiling"
          : bimSketchTarget === "room"
            ? "Room"
            : "Extrude";

  const docId = overview?.active ?? "";
  const selection = scene?.selection ?? [];
  const primaryId =
    (selKind === "face" && selFace?.entityId) ||
    (selKind === "edge" && selEdge?.entityId) ||
    scene?.primary ||
    selection[selection.length - 1] ||
    null;
  const primaryEntity = primaryId
    ? scene?.entities.find((e) => e.id === primaryId) ?? null
    : null;
  const isSketchEntity = Boolean(
    primaryEntity &&
      (SKETCH_ENTITY_KINDS.has(primaryEntity.kind) || primaryEntity.category === "sketch"),
  );

  const startSketch = (faceEntity = primaryEntity, faceIdx = selFace?.face ?? null) => {
    if (selKind === "face" && faceEntity && faceIdx !== null) {
      const info = facePlaneInfo(faceEntity, faceIdx);
      enterSketchMode({
        height: info.height,
        origin: info.origin,
        normal: info.normal,
        label: info.label,
        tool: "line",
      });
      window.dispatchEvent(
        new CustomEvent("arc-focus-plane", { detail: { normal: info.normal } }),
      );
    } else {
      enterSketchMode({ tool: "line" });
      window.dispatchEvent(
        new CustomEvent("arc-focus-plane", { detail: { normal: [0, 1, 0] } }),
      );
    }
  };

  const deselectAll = () => {
    useArcStore.getState().setSelectionRef(null);
    setTool("select");
    if (docId) void ipc.setSelection(docId, [], null);
  };

  const selectionSub =
    selKind === "face"
      ? "1 face"
      : selKind === "edge"
        ? "1 edge"
        : selection.length === 1
          ? primaryEntity?.name || "1 item"
          : `${selection.length} items`;

  const renderToolList = (items: { id: ToolId; sub?: string; key?: string }[]) =>
    items.map((item) => {
      const def = TOOL_BY_ID.get(item.id);
      if (!def) return null;
      const Icon = def.icon;
      return (
        <ShaprRow
          key={item.id}
          icon={<Icon size={15} strokeWidth={1.75} />}
          label={def.label}
          sub={item.sub}
          shortcut={item.key}
          active={tool === item.id}
          onClick={() => {
            if (item.id === "extrude") armExtrudeSelectedSketch();
            setTool(item.id);
          }}
        />
      );
    });

  const toggleCat = (cat: string) => {
    setActiveCat(activeCat === cat ? "all" : cat);
  };

  return (
    <aside
      aria-label="Workspace Tools"
      className="pointer-events-none absolute bottom-3 left-3 top-3 z-30 flex flex-col justify-between gap-2"
    >
      {/* Top: Project & Items sidebar toggle (Shapr3D top-left) */}
      <div className="flex flex-col gap-1.5">
        <ShaprRow
          icon={<FolderKanban size={15} strokeWidth={1.75} />}
          label="Project"
          sub="Modeling"
          onClick={() => useArcStore.getState().setView("dashboard")}
        />
        <ShaprRow
          icon={<Layers size={15} strokeWidth={1.75} />}
          label="Items"
          active={leftSidebarOpen}
          onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
        />
      </div>

      {/* Middle: Dynamic Shapr3D Mode / Selection / Category Dock */}
      <div className="no-scrollbar flex min-h-0 flex-col gap-1.5 overflow-y-auto py-1 pr-1">
        <ShaprRow
          icon={<Search size={15} strokeWidth={1.75} />}
          label="Search"
          shortcut="Ctrl F"
          onClick={() => useArcStore.getState().setPaletteOpen(true)}
        />

        {sketchMode ? (
          /* ---- SKETCHING MODE DOCK ---- */
          <>
            {scene?.projectMode === "architecture" ? (
              <>
                <ShaprRow
                  icon={<Check size={15} strokeWidth={2.5} className="text-emerald-500" />}
                  label="Finish Boundary"
                  sub={`Create ${targetLabel}`}
                  shortcut="Enter"
                  onClick={() => void commitBimBoundary(bimSketchTarget)}
                />
                <ShaprRow
                  icon={<X size={15} strokeWidth={2} className="text-rose-500" />}
                  label="Cancel Boundary"
                  sub="Discard Sketch"
                  shortcut="Esc"
                  onClick={() => void cancelBimBoundary()}
                />
                <ShaprRow
                  icon={<BrickWall size={15} strokeWidth={1.8} className="text-amber-500" />}
                  label="Pick Walls"
                  sub="Trace Footprint"
                  shortcut="W"
                  onClick={() => void traceWallsToBoundary()}
                />
                <div className="my-0.5 h-px w-8 bg-base-300/60" />
              </>
            ) : (
              <>
                <ShaprRow
                  icon={<X size={15} strokeWidth={2} />}
                  label="Exit Sketching"
                  sub="Sketch Plane"
                  shortcut="Esc"
                  onClick={() => exitSketchMode()}
                />
                <div className="my-0.5 h-px w-8 bg-base-300/60" />
              </>
            )}
            {renderToolList(SKETCH_TOOLS)}
            {selection.length > 0 && (
              <ShaprRow
                icon={<Trash2 size={15} strokeWidth={1.75} />}
                label="Delete"
                danger
                onClick={() => void actions.deleteSelection()}
              />
            )}
          </>
        ) : selection.length > 0 ? (
          /* ---- CONTEXTUAL SELECTION DOCK (Screenshots 192418 / 192434 / 192501) ---- */
          <>
            <ShaprRow
              icon={<X size={15} strokeWidth={1.9} />}
              label="Deselect All"
              sub={selectionSub}
              onClick={deselectAll}
            />
            <div className="my-0.5 h-px w-8 bg-base-300/60" />

            {selKind === "face" && (
              <>
                <ShaprRow
                  icon={<PencilRuler size={15} strokeWidth={1.75} />}
                  label="Sketch"
                  sub="On Face"
                  shortcut="W"
                  onClick={() => startSketch()}
                />
                <ShaprRow
                  icon={<Move size={15} strokeWidth={1.75} />}
                  label="Move/Rotate"
                  shortcut="M"
                  active={tool === "move"}
                  onClick={() => setTool("move")}
                />
                <ShaprRow
                  icon={<Scaling size={15} strokeWidth={1.75} />}
                  label="Scale"
                  shortcut="S"
                  active={tool === "scale"}
                  onClick={() => setTool("scale")}
                />
                {primaryEntity && faceEditable(primaryEntity.kind) && (
                  <>
                    <ShaprRow
                      icon={< Compass size={15} strokeWidth={1.75} />}
                      label="Offset Face"
                      active={tool === "offset-face"}
                      onClick={() => setTool("offset-face")}
                    />
                    <ShaprRow
                      icon={<Maximize2 size={15} strokeWidth={1.75} />}
                      label="Extrude"
                      shortcut="E"
                      active={tool === "extrude-face"}
                      onClick={() => setTool("extrude-face")}
                    />
                  </>
                )}
                <ShaprRow
                  icon={<Box size={15} strokeWidth={1.75} />}
                  label="Shell"
                  sub="Hollow 2 cm"
                  onClick={() => void actions.shellSelection(2)}
                />
              </>
            )}

            {selKind === "edge" && (
              <>
                <ShaprRow
                  icon={<Move size={15} strokeWidth={1.75} />}
                  label="Move/Rotate"
                  shortcut="M"
                  active={tool === "move"}
                  onClick={() => setTool("move")}
                />
                <ShaprRow
                  icon={<Sparkles size={15} strokeWidth={1.75} />}
                  label="Chamfer/Fillet"
                  sub="Round Edge"
                  shortcut="F"
                  active={tool === "fillet-edge"}
                  onClick={() => setTool("fillet-edge")}
                />
                <ShaprRow
                  icon={<Slice size={15} strokeWidth={1.75} />}
                  label="Chamfer 45°"
                  sub="Bevel 2 cm"
                  onClick={() => void actions.chamferSelectedEdge(2)}
                />
              </>
            )}

            {selKind === "entity" && isSketchEntity && (
              <>
                <ShaprRow
                  icon={<Maximize2 size={15} strokeWidth={1.75} />}
                  label="Extrude"
                  sub="Add or Cut"
                  shortcut="E"
                  active={tool === "extrude"}
                  onClick={() => {
                    armExtrudeSelectedSketch();
                    setTool("extrude");
                  }}
                />
                {renderToolList([
                  { id: "revolve", key: "V" },
                  { id: "sweep" },
                  { id: "loft" },
                  { id: "offset", key: "O" },
                  { id: "trim", key: "T" },
                ])}
                {primaryEntity && (primaryEntity.kind === "line" || primaryEntity.kind === "line_curve") && (
                  <>
                    <ShaprRow
                      icon={<MoveHorizontal size={15} strokeWidth={1.75} />}
                      label="Horizontal"
                      shortcut="H"
                      onClick={() => {
                        const g = primaryEntity.geometry as Record<string, unknown>;
                        const end = (g.end as [number, number, number]) ?? [10, 0, 0];
                        const len = Math.hypot(end[0], end[1], end[2]) || 10;
                        const sign = end[0] < 0 ? -1 : 1;
                        void ipc.updateGeometry(docId, primaryEntity.id, {
                          ...g,
                          end: [sign * len, 0, 0],
                        } as unknown as Geometry);
                      }}
                    />
                    <ShaprRow
                      icon={<MoveVertical size={15} strokeWidth={1.75} />}
                      label="Vertical"
                      shortcut="V"
                      onClick={() => {
                        const g = primaryEntity.geometry as Record<string, unknown>;
                        const end = (g.end as [number, number, number]) ?? [0, 0, 10];
                        const len = Math.hypot(end[0], end[1], end[2]) || 10;
                        const sign = end[2] < 0 ? -1 : 1;
                        void ipc.updateGeometry(docId, primaryEntity.id, {
                          ...g,
                          end: [0, 0, sign * len],
                        } as unknown as Geometry);
                      }}
                    />
                  </>
                )}
                {primaryEntity && (primaryEntity.kind === "rectangle" || primaryEntity.kind === "rectangle_curve") && (
                  <ShaprRow
                    icon={<Square size={15} strokeWidth={1.75} />}
                    label="Square"
                    onClick={() => {
                      const g = primaryEntity.geometry as Record<string, unknown>;
                      const w = typeof g.width === "number" ? g.width : 10;
                      void ipc.updateGeometry(docId, primaryEntity.id, {
                        ...g,
                        width: w,
                        depth: w,
                      } as unknown as Geometry);
                    }}
                  />
                )}
                <ShaprRow
                  icon={<PencilRuler size={15} strokeWidth={1.75} />}
                  label="Construction"
                  shortcut="X"
                  onClick={() => void actions.toggleConstruction()}
                />
                <ShaprRow
                  icon={<Move size={15} strokeWidth={1.75} />}
                  label="Move/Rotate"
                  shortcut="M"
                  active={tool === "move"}
                  onClick={() => setTool("move")}
                />
              </>
            )}

            {selKind === "entity" && !isSketchEntity && (
              <>
                <ShaprRow
                  icon={<PencilRuler size={15} strokeWidth={1.75} />}
                  label="Sketch"
                  onClick={() => startSketch()}
                />
                <ShaprRow
                  icon={<Move size={15} strokeWidth={1.75} />}
                  label="Move/Rotate"
                  shortcut="M"
                  active={tool === "move"}
                  onClick={() => setTool("move")}
                />
                <ShaprRow
                  icon={<Scaling size={15} strokeWidth={1.75} />}
                  label="Scale"
                  shortcut="S"
                  active={tool === "scale"}
                  onClick={() => setTool("scale")}
                />
                {selection.length >= 2 && (
                  <>
                    <ShaprRow
                      icon={<Combine size={15} strokeWidth={1.75} />}
                      label="Union"
                      onClick={() => void actions.booleanApply("union")}
                    />
                    <ShaprRow
                      icon={<Scissors size={15} strokeWidth={1.75} />}
                      label="Subtract"
                      onClick={() => void actions.booleanApply("difference")}
                    />
                  </>
                )}
                <ShaprRow
                  icon={<Box size={15} strokeWidth={1.75} />}
                  label="Shell"
                  onClick={() => void actions.shellSelection(2)}
                />
                <ShaprRow
                  icon={<Grid3X3 size={15} strokeWidth={1.75} />}
                  label="Pattern"
                  onClick={() =>
                    void actions.linearPattern({ count: 3, spacing: 30, axis: "x" })
                  }
                />
                <ShaprRow
                  icon={<Paintbrush size={15} strokeWidth={1.75} />}
                  label="Visualize"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("arc-materials-toggle", { detail: true }),
                    )
                  }
                />
                <ShaprRow
                  icon={<Copy size={15} strokeWidth={1.75} />}
                  label="Duplicate"
                  onClick={() => void actions.duplicateSelection()}
                />
              </>
            )}

            <ShaprRow
              icon={<Trash2 size={15} strokeWidth={1.75} />}
              label="Delete"
              danger
              onClick={() => void actions.deleteSelection()}
            />
          </>
        ) : scene?.projectMode === "architecture" ? (
          /* ---- ARCHITECTURE BIM WORKBENCH DOCK ---- */
          <>
            <ShaprRow
              icon={<BrickWall size={15} strokeWidth={1.75} />}
              label="Structure"
              active={activeCat === "arch-structure" || activeCat === "insert"}
              onClick={() => toggleCat("arch-structure")}
            />
            {(activeCat === "arch-structure" || activeCat === "insert") && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(ARCH_STRUCTURE_TOOLS)}
              </div>
            )}

            <ShaprRow
              icon={<DoorOpen size={15} strokeWidth={1.75} />}
              label="Openings"
              active={activeCat === "arch-openings"}
              onClick={() => toggleCat("arch-openings")}
            />
            {activeCat === "arch-openings" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(ARCH_OPENING_TOOLS)}
              </div>
            )}

            <ShaprRow
              icon={<Home size={15} strokeWidth={1.75} />}
              label="Build & Space"
              active={activeCat === "arch-build"}
              onClick={() => toggleCat("arch-build")}
            />
            {activeCat === "arch-build" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(ARCH_BUILD_TOOLS)}
              </div>
            )}

            <ShaprRow
              icon={<Layers size={15} strokeWidth={1.75} />}
              label="Datums"
              active={activeCat === "arch-datums"}
              onClick={() => toggleCat("arch-datums")}
            />
            {activeCat === "arch-datums" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(ARCH_DATUM_TOOLS)}
              </div>
            )}

            <ShaprRow
              icon={<Table size={15} strokeWidth={1.75} />}
              label="Schedule"
              onClick={() => useArcStore.getState().setBuildingScheduleOpen(true)}
            />

            <ShaprRow
              icon={<Move size={15} strokeWidth={1.75} />}
              label="Transform"
              active={activeCat === "transform"}
              onClick={() => toggleCat("transform")}
            />
            {activeCat === "transform" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                <ShaprRow
                  icon={<Move size={14} strokeWidth={1.75} />}
                  label="Move"
                  shortcut="M"
                  active={tool === "move"}
                  onClick={() => setTool("move")}
                />
                <ShaprRow
                  icon={<Orbit size={14} strokeWidth={1.75} />}
                  label="Rotate"
                  active={tool === "rotate"}
                  onClick={() => setTool("rotate")}
                />
                <ShaprRow
                  icon={<Scaling size={14} strokeWidth={1.75} />}
                  label="Scale"
                  shortcut="S"
                  active={tool === "scale"}
                  onClick={() => setTool("scale")}
                />
              </div>
            )}

            <ShaprRow
              icon={<PencilRuler size={15} strokeWidth={1.75} />}
              label="Sketch"
              sub="2D Sketching"
              onClick={() => startSketch()}
            />

            <ShaprRow
              icon={<Paintbrush size={15} strokeWidth={1.75} />}
              label="Visualize"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("arc-materials-toggle", { detail: true }),
                )
              }
            />
          </>
        ) : (
          /* ---- DEFAULT 3D MODELING DOCK (Screenshot 192241.PNG) ---- */
          <>
            <ShaprRow
              icon={<PencilRuler size={15} strokeWidth={1.75} />}
              label="Sketch"
              onClick={() => startSketch()}
            />

            <ShaprRow
              icon={<Plus size={15} strokeWidth={1.75} />}
              label="Insert"
              active={activeCat === "insert"}
              onClick={() => toggleCat("insert")}
            />
            {activeCat === "insert" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(INSERT_TOOLS)}
              </div>
            )}

            <ShaprRow
              icon={<Box size={15} strokeWidth={1.75} />}
              label="Construct"
              active={activeCat === "construct"}
              onClick={() => toggleCat("construct")}
            />
            {activeCat === "construct" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(CONSTRUCT_TOOLS)}
              </div>
            )}

            <ShaprRow
              icon={<Move size={15} strokeWidth={1.75} />}
              label="Transform"
              active={activeCat === "transform"}
              onClick={() => toggleCat("transform")}
            />
            {activeCat === "transform" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                <ShaprRow
                  icon={<Move size={14} strokeWidth={1.75} />}
                  label="Move"
                  shortcut="M"
                  active={tool === "move"}
                  onClick={() => setTool("move")}
                />
                <ShaprRow
                  icon={<Orbit size={14} strokeWidth={1.75} />}
                  label="Rotate"
                  active={tool === "rotate"}
                  onClick={() => setTool("rotate")}
                />
                <ShaprRow
                  icon={<Scaling size={14} strokeWidth={1.75} />}
                  label="Scale"
                  shortcut="S"
                  active={tool === "scale"}
                  onClick={() => setTool("scale")}
                />
              </div>
            )}

            <ShaprRow
              icon={<Wrench size={15} strokeWidth={1.75} />}
              label="Tools"
              active={activeCat === "tools"}
              onClick={() => toggleCat("tools")}
            />
            {activeCat === "tools" && (
              <div className="anim-slide-right flex flex-col gap-1 pl-3">
                {renderToolList(MODEL_TOOLS)}
                <ShaprRow
                  icon={<Box size={14} strokeWidth={1.75} />}
                  label="Shell"
                  onClick={() => void actions.shellSelection(2)}
                />
                <ShaprRow
                  icon={<Combine size={14} strokeWidth={1.75} />}
                  label="Union"
                  onClick={() => void actions.booleanApply("union")}
                />
                <ShaprRow
                  icon={<Scissors size={14} strokeWidth={1.75} />}
                  label="Subtract"
                  onClick={() => void actions.booleanApply("difference")}
                />
              </div>
            )}

            <ShaprRow
              icon={<Paintbrush size={15} strokeWidth={1.75} />}
              label="Visualize"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("arc-materials-toggle", { detail: true }),
                )
              }
            />
          </>
        )}
      </div>

      {/* Bottom: Isolate, Section View, Measure (Shapr3D bottom-left) */}
      <div className="flex flex-col gap-1.5">
        {selection.length > 0 && (
          <ShaprRow
            icon={<Eye size={15} strokeWidth={1.75} />}
            label="Isolate"
            sub={isolated ? "On" : "Off"}
            active={isolated}
            onClick={() => void actions.isolateSelection()}
          />
        )}
        <ShaprRow
          icon={<Slice size={15} strokeWidth={1.75} />}
          label="Section View"
          sub={sectionView ? "On" : "Off"}
          active={sectionView}
          onClick={() => setSectionView(!sectionView)}
        />
        <ShaprRow
          icon={<Ruler size={15} strokeWidth={1.75} />}
          label="Measure"
          active={tool === "dimension"}
          onClick={() => setTool(tool === "dimension" ? "select" : "dimension")}
        />
      </div>
    </aside>
  );
}
