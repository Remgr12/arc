import {
  Box,
  Combine,
  Copy,
  Grid3X3,
  Layers,
  MoveHorizontal,
  MoveVertical,
  Orbit,
  Paintbrush,
  PencilRuler,
  Scissors,
  Slice,
  Square,
  Trash2,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { deriveSelectionContext, SKETCH_ENTITY_KINDS, type SelectionContext } from "../lib/selectionContext";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { TOOL_BY_ID } from "../data/tools";
import { bindingHint } from "../lib/keybinds";
import { armExtrudeSelectedSketch } from "../tools/solid";
import { facePlaneInfo } from "../tools/topology";
import type { EntityData, ToolId, Geometry } from "../lib/types";
import { cn, Tip } from "./ui";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Contextual action dock that appears next to the tool rail ONLY when an
// entity, face, edge, sketch profile, or multi-selection is active.
// Avoids duplicating the base ToolRail when nothing is selected.
// ---------------------------------------------------------------------------

interface DockItem {
  key: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  tip?: string;
  disabled?: boolean;
  run: () => void;
  needsRef?: boolean;
}

interface DockGroup {
  title: string;
  items: DockItem[];
}

function toolItem(id: ToolId, overrideKeys?: string, needsRef?: boolean): DockItem | null {
  const def = TOOL_BY_ID.get(id);
  if (!def) return null;
  const Icon = def.icon;
  return {
    key: id,
    label: def.label,
    icon: <Icon size={15} strokeWidth={1.75} />,
    keys: overrideKeys ?? (bindingHint(`tool:${id}`) || undefined),
    tip: def.tip,
    run: () => {
      if (id === "extrude") armExtrudeSelectedSketch();
      useArcStore.getState().setTool(id);
    },
    needsRef,
  };
}

function actionItem(
  key: string,
  label: string,
  icon: ReactNode,
  run: () => void,
  tip?: string,
  disabled?: boolean,
): DockItem {
  return { key, label, icon, run, tip, disabled };
}

function deleteItem(): DockItem {
  return actionItem(
    "delete",
    "Delete",
    <Trash2 size={15} strokeWidth={1.6} />,
    () => void actions.deleteSelection(),
    "Delete selection (Del)",
  );
}

function duplicateItem(): DockItem {
  return actionItem(
    "duplicate",
    "Duplicate",
    <Copy size={15} strokeWidth={1.6} />,
    () => void actions.duplicateSelection(),
    "Duplicate selection (Ctrl+D)",
  );
}

function sketchOnFaceItem(entity: EntityData | null, faceIndex: number | null): DockItem {
  return actionItem(
    "sketch-on-face",
    "Sketch on Face",
    <PencilRuler size={15} strokeWidth={1.6} />,
    () => {
      if (!entity) return;
      const info = facePlaneInfo(entity, faceIndex);
      useArcStore.getState().enterSketchMode({
        height: info.height,
        origin: info.origin,
        normal: info.normal,
        label: info.label,
        tool: "rectangle",
      });
      window.dispatchEvent(
        new CustomEvent("arc-focus-plane", { detail: { normal: info.normal } }),
      );
    },
    "Start 2D sketch on this face's plane (horizontal, vertical, or angled)",
  );
}

function shellItem(): DockItem {
  return actionItem(
    "shell",
    "Shell / Hollow",
    <Box size={15} strokeWidth={1.6} />,
    () => void actions.shellSelection(2),
    "Hollow out solid to 2 cm wall thickness",
  );
}

function linearPatternItem(): DockItem {
  return actionItem(
    "linear-pattern",
    "Linear Pattern",
    <Grid3X3 size={15} strokeWidth={1.6} />,
    () => void actions.linearPattern({ count: 3, spacing: 30, axis: "x" }),
    "Create 3× linear array along X",
  );
}

function circularPatternItem(): DockItem {
  return actionItem(
    "circular-pattern",
    "Circular Pattern",
    <Orbit size={15} strokeWidth={1.6} />,
    () => void actions.circularPattern({ count: 6, angleDeg: 360, axis: "y" }),
    "Create 6× circular array around Y",
  );
}

function dockGroups(
  context: SelectionContext,
  selectionCount: number,
  hasSketchSelected: boolean,
  primaryEntity: EntityData | null,
  faceIndex: number | null,
): DockGroup[] {
  const groups: DockGroup[] = [];

  if (context === "face") {
    groups.push({
      title: "Face Actions",
      items: [
        sketchOnFaceItem(primaryEntity, faceIndex),
        toolItem("extrude-face", "E", true),
        toolItem("offset-face", undefined, true),
        shellItem(),
        toolItem("move", "M"),
        toolItem("rotate"),
        toolItem("scale"),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  } else if (context === "edge") {
    groups.push({
      title: "Edge Actions",
      items: [
        toolItem("fillet-edge", "F", true),
        actionItem(
          "chamfer-edge",
          "Chamfer Edge (45°)",
          <Slice size={15} strokeWidth={1.6} />,
          () => void actions.chamferSelectedEdge(2),
          "Bevel selected edge at 45° (2 cm)",
        ),
        toolItem("move", "M"),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  } else if (context === "multi") {
    groups.push({
      title: `Combine (${selectionCount})`,
      items: [
        actionItem(
          "union",
          "Boolean Union",
          <Combine size={15} strokeWidth={1.6} />,
          () => void actions.booleanApply("union"),
          "Fuse selected solids together",
        ),
        actionItem(
          "difference",
          "Boolean Subtract",
          <Scissors size={15} strokeWidth={1.6} />,
          () => void actions.booleanApply("difference"),
          "Subtract second solid from first",
        ),
        actionItem(
          "intersection",
          "Boolean Intersect",
          <Layers size={15} strokeWidth={1.6} />,
          () => void actions.booleanApply("intersection"),
          "Keep shared volume of solids",
        ),
        linearPatternItem(),
        circularPatternItem(),
        duplicateItem(),
        deleteItem(),
      ],
    });
  } else if (context === "body") {
    groups.push({
      title: "Solid Body",
      items: [
        toolItem("move", "M"),
        toolItem("rotate"),
        toolItem("scale"),
        shellItem(),
        linearPatternItem(),
        circularPatternItem(),
        actionItem(
          "materials",
          "Material…",
          <Paintbrush size={15} strokeWidth={1.6} />,
          () =>
            window.dispatchEvent(
              new CustomEvent("arc-materials-toggle", { detail: true }),
            ),
          "Assign PBR material",
        ),
        duplicateItem(),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  } else if (context === "sketch" && hasSketchSelected) {
    const sketchItems: (DockItem | null)[] = [
      toolItem("extrude", "E"),
      toolItem("revolve", "V"),
      toolItem("sweep", "S"),
      toolItem("loft", "K"),
      toolItem("offset", "O"),
      toolItem("trim", "T"),
      toolItem("fillet", "F"),
      toolItem("mirror", "I"),
    ];

    if (primaryEntity && (primaryEntity.kind === "line" || primaryEntity.kind === "line_curve")) {
      sketchItems.push(
        actionItem(
          "horiz",
          "Horizontal",
          <MoveHorizontal size={15} strokeWidth={1.6} />,
          () => {
            const docId = useArcStore.getState().overview?.active;
            if (!docId) return;
            const g = primaryEntity.geometry as Record<string, unknown>;
            const end = (g.end as [number, number, number]) ?? [10, 0, 0];
            const len = Math.hypot(end[0], end[1], end[2]) || 10;
            const sign = end[0] < 0 ? -1 : 1;
            void ipc.updateGeometry(docId, primaryEntity.id, {
              ...g,
              end: [sign * len, 0, 0],
            } as unknown as Geometry);
          },
          "Horizontal (H)",
        ),
        actionItem(
          "vert",
          "Vertical",
          <MoveVertical size={15} strokeWidth={1.6} />,
          () => {
            const docId = useArcStore.getState().overview?.active;
            if (!docId) return;
            const g = primaryEntity.geometry as Record<string, unknown>;
            const end = (g.end as [number, number, number]) ?? [0, 0, 10];
            const len = Math.hypot(end[0], end[1], end[2]) || 10;
            const sign = end[2] < 0 ? -1 : 1;
            void ipc.updateGeometry(docId, primaryEntity.id, {
              ...g,
              end: [0, 0, sign * len],
            } as unknown as Geometry);
          },
          "Vertical (V)",
        ),
      );
    }

    if (primaryEntity && (primaryEntity.kind === "rectangle" || primaryEntity.kind === "rectangle_curve")) {
      sketchItems.push(
        actionItem(
          "square",
          "Square",
          <Square size={15} strokeWidth={1.6} />,
          () => {
            const docId = useArcStore.getState().overview?.active;
            if (!docId) return;
            const g = primaryEntity.geometry as Record<string, unknown>;
            const w = typeof g.width === "number" ? g.width : 10;
            void ipc.updateGeometry(docId, primaryEntity.id, {
              ...g,
              width: w,
              depth: w,
            } as unknown as Geometry);
          },
          "Square",
        ),
      );
    }

    sketchItems.push(
      actionItem(
        "construction",
        "Construction",
        <PencilRuler size={15} strokeWidth={1.6} />,
        () => void actions.toggleConstruction(),
        "Construction (X)",
      ),
    );

    sketchItems.push(
      linearPatternItem(),
      circularPatternItem(),
      duplicateItem(),
      deleteItem(),
    );

    groups.push({
      title: "Sketch Profile",
      items: sketchItems.filter((item): item is DockItem => item !== null),
    });
  }

  return groups.filter((group) => group.items.length > 0);
}

export function ContextDock() {
  const scene = useArcStore((s) => s.scene);
  const tool = useArcStore((s) => s.tool) as ToolId;
  const selKind = useArcStore((s) => s.selKind);
  const selFace = useArcStore((s) => s.selFace);
  const selEdge = useArcStore((s) => s.selEdge);
  const drafting = useArcStore((s) => s.drafting);
  const sketchMode = useArcStore((s) => s.sketchMode);

  const selection = scene?.selection ?? [];
  const primaryId = selection[selection.length - 1] ?? null;
  const primaryEntity = primaryId
    ? scene?.entities.find((e) => e.id === primaryId) ?? null
    : null;
  const primaryKind = primaryEntity?.kind ?? null;

  const context = deriveSelectionContext(
    selKind,
    selection.length,
    primaryKind,
    tool,
    drafting,
    sketchMode,
  );

  const hasSketchSelected = Boolean(
    primaryKind && (SKETCH_ENTITY_KINDS.has(primaryKind) || primaryEntity?.category === "sketch"),
  );

  const faceIndex =
    selKind === "face" && selFace && selFace.entityId === primaryEntity?.id
      ? selFace.face
      : null;

  const groups = dockGroups(context, selection.length, hasSketchSelected, primaryEntity, faceIndex);
  const hasRef = selFace !== null || selEdge !== null;

  if (!scene || groups.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-30 flex -translate-y-1/2 flex-col items-start gap-2">
      {groups.map((group) => (
        <div
          key={group.title}
          className="anim-slide-right pointer-events-auto w-fit rounded-xl border border-base-200 bg-base-50/95 p-1.5 shadow-lg shadow-black/20 backdrop-blur-md"
        >
          <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-base-500">
            {group.title}
          </div>
          <div className="flex flex-col gap-0.5">
            {group.items.map((item) => {
              const active = item.key === tool;
              const disabled =
                item.disabled === true || (item.needsRef === true && !hasRef);
              return (
                <Tip
                  key={item.key}
                  label={item.tip ?? item.label}
                  keys={item.keys}
                  side="right"
                  className="w-full"
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => item.run()}
                    className={cn(
                      "flex h-7 w-full min-w-[8.75rem] items-center gap-2 rounded-lg px-2.5 text-[12px] font-medium transition-all duration-150 active:scale-[0.98]",
                      "disabled:pointer-events-none disabled:opacity-35",
                      active
                        ? "bg-accent-500 text-white shadow-xs"
                        : "text-base-600 hover:bg-base-200 hover:text-base-800",
                    )}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                </Tip>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
