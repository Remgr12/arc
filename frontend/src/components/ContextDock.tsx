import { Combine, Layers, Paintbrush, Scissors, Trash2, X } from "lucide-react";
import { useArcStore } from "../lib/store";
import { deriveSelectionContext, type SelectionContext } from "../lib/selectionContext";
import { actions } from "../lib/actions";
import { TOOL_BY_ID } from "../data/tools";
import { bindingHint } from "../lib/keybinds";
import type { ToolId } from "../lib/types";
import { cn, Tip } from "./ui";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shapr-style floating contextual tool dock. Contents follow the selection:
// face → move/rotate/scale + face tools, edge → fillet, body → booleans etc.,
// sketch mode → sketch tools, nothing/multi → base modeling groups.
// ---------------------------------------------------------------------------

interface DockItem {
  key: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  tip?: string;
  disabled?: boolean;
  run: () => void;
  /** True when the item needs a face/edge ref to act on. */
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
    icon: <Icon size={16} strokeWidth={1.75} />,
    keys: overrideKeys ?? (bindingHint(`tool:${id}`) || undefined),
    tip: def.tip,
    run: () => useArcStore.getState().setTool(id),
    needsRef,
  };
}

function actionItem(
  key: string,
  label: string,
  icon: ReactNode,
  run: () => void,
  tip?: string,
): DockItem {
  return { key, label, icon, run, tip };
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

function fitItem(): DockItem {
  return actionItem(
    "fit",
    "Fit view",
    <Layers size={15} strokeWidth={1.6} />,
    () => actions.fitView(),
    "Fit view",
  );
}

function dockGroups(context: SelectionContext): DockGroup[] {
  const isFace = context === "face";
  const isEdge = context === "edge";
  const isBody = context === "body";
  const isSketch = context === "sketch";
  const showBase = !isFace && !isEdge && !isSketch;

  const groups: DockGroup[] = [];

  if (isFace) {
    groups.push({
      title: "Face",
      items: [
        toolItem("move"),
        toolItem("rotate"),
        toolItem("scale"),
        toolItem("extrude-face", "E", true),
        toolItem("offset-face", undefined, true),
        toolItem("fillet-edge", "F", true),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  } else if (isEdge) {
    groups.push({
      title: "Edge",
      items: [
        toolItem("fillet-edge", "F", true),
        toolItem("offset-face", undefined, undefined),
        toolItem("move"),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  } else if (isBody) {
    groups.push({
      title: "Body",
      items: [
        toolItem("move", "M"),
        toolItem("extrude-face", "E"),
        toolItem("offset-face"),
        toolItem("fillet-edge", "F"),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
    groups.push({
      title: "Booleans & materials",
      items: [
        actionItem(
          "union",
          "Union",
          <Combine size={15} strokeWidth={1.6} />,
          () => void actions.booleanApply("union"),
          "Boolean union (two solids selected)",
        ),
        actionItem(
          "difference",
          "Difference",
          <Scissors size={15} strokeWidth={1.6} />,
          () => void actions.booleanApply("difference"),
          "Boolean difference",
        ),
        actionItem(
          "intersection",
          "Intersect",
          <Layers size={15} strokeWidth={1.6} />,
          () => void actions.booleanApply("intersection"),
          "Boolean intersection",
        ),
        actionItem(
          "materials",
          "Materials",
          <Paintbrush size={15} strokeWidth={1.6} />,
          () =>
            window.dispatchEvent(
              new CustomEvent("arc-materials-toggle", { detail: true }),
            ),
          "Materials panel",
        ),
      ],
    });
  } else if (isSketch) {
    groups.push({
      title: "Sketching",
      items: [
        actionItem(
          "exit",
          "Exit Sketching",
          <X size={15} strokeWidth={1.6} />,
          () => useArcStore.getState().setTool("select"),
          "Exit sketch mode (Esc)",
        ),
        toolItem("line", "L"),
        toolItem("arc", "A"),
        toolItem("rectangle", "R"),
        toolItem("circle", "C"),
        toolItem("trim", "T"),
        deleteItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  }

  if (showBase) {
    groups.push({
      title: "Modeling",
      items: [
        toolItem("select", "Esc"),
        toolItem("move", "M"),
        toolItem("extrude", "E"),
        toolItem("sweep", "S"),
        toolItem("box", "B"),
        toolItem("sphere", "G"),
        toolItem("cylinder", "Q"),
        toolItem("cone", "Z"),
        toolItem("torus", "Y"),
        fitItem(),
      ].filter((item): item is DockItem => item !== null),
    });
  }

  return groups.filter((group) => group.items.length > 0);
}

export function ContextDock() {
  const scene = useArcStore((s) => s.scene) as any;
  const tool = useArcStore((s) => s.tool) as ToolId;
  const selKind = useArcStore((s) => s.selKind);
  const selFace = useArcStore((s) => s.selFace);
  const selEdge = useArcStore((s) => s.selEdge);
  const drafting = useArcStore((s) => s.drafting);

  const selection = scene?.selection ?? [];
  const primaryId = selection[selection.length - 1] ?? null;
  const primaryKind = primaryId
    ? scene?.entities.find((e: { id: string; kind?: string }) => e.id === primaryId)?.kind ?? null
    : null;
  const context = deriveSelectionContext(
    selKind,
    selection.length,
    primaryKind,
    tool,
    drafting,
  );
  const groups = dockGroups(context);
  const hasRef = selFace !== null || selEdge !== null;

  if (!scene || groups.length === 0) return null;

  return (
    <div className="pointer-events-none absolute left-3 top-1/2 z-40 flex max-h-[92%] -translate-y-1/2 flex-col items-start gap-2 overflow-y-auto">
      {groups.map((group) => (
        <div
          key={group.title}
          className="pointer-events-auto w-fit max-w-[13rem] rounded-2xl border border-base-200 bg-base-50/95 px-1.5 py-1.5 shadow-lg shadow-black/10 backdrop-blur-md"
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
                  side="bottom"
                  className="w-full"
                >
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => item.run()}
                    className={cn(
                      "flex h-8 w-full min-w-[9.5rem] items-center gap-2 rounded-xl px-2.5 text-[12.5px] font-medium transition-all",
                      "disabled:pointer-events-none disabled:opacity-35",
                      active
                        ? "bg-accent-500 text-white shadow-sm ring-2 ring-accent-500/20"
                        : "text-base-600 hover:bg-base-100 hover:text-base-800",
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
