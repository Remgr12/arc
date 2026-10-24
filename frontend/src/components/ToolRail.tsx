import { PencilRuler } from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { bindingHint } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import { cn, Tip } from "./ui";
import type { ToolId } from "../lib/types";

/** Vertical layout of the tool rail. Groups separated by hairlines. */
const RAIL_GROUPS: { title: string; tools: ToolId[] }[] = [
  { title: "Select & transform", tools: ["select", "move", "rotate", "scale"] },
  {
    title: "Sketch",
    tools: ["line", "polyline", "rectangle", "circle", "arc", "polygon"],
  },
  {
    title: "Modify 2D",
    tools: ["offset", "trim", "extend", "fillet", "mirror"],
  },
  {
    title: "Solid & Face",
    tools: ["extrude", "revolve", "sweep", "loft", "extrude-face", "offset-face", "fillet-edge"],
  },
  { title: "Primitives", tools: ["box", "cylinder", "sphere", "cone", "torus", "plane"] },
  { title: "Annotate", tools: ["dimension", "wall"] },
];

export function ToolRail() {
  const tool = useArcStore((s) => s.tool) as ToolId;
  const setTool = useArcStore((s) => s.setTool);
  const sketchMode = useArcStore((s) => s.sketchMode);
  const enterSketchMode = useArcStore((s) => s.enterSketchMode);
  const exitSketchMode = useArcStore((s) => s.exitSketchMode);
  const scene = useArcStore((s) => s.scene);
  useKeybindStore((s) => s.profiles);

  const enabled = scene != null;

  const toggleSketchMode = () => {
    const st = useArcStore.getState();
    if (st.sketchMode) {
      exitSketchMode();
    } else {
      // If a horizontal face is currently selected, use its Y height as the sketch plane!
      const hoverOrSelY =
        st.selKind === "face" && st.hoverObj?.point
          ? st.hoverObj.point[1]
          : undefined;
      enterSketchMode({ height: hoverOrSelY, tool: "line" });
      window.dispatchEvent(
        new CustomEvent("arc-focus-plane", { detail: { normal: [0, 1, 0] } }),
      );
    }
  };

  return (
    <nav
      className="flex w-13 shrink-0 flex-col items-center gap-0.5 border-r border-base-200 bg-base-50 py-2"
      aria-label="Tools"
    >
      <Tip
        label={sketchMode ? "Exit Sketch Mode" : "Enter 2D Sketch Mode (Top View)"}
        side="right"
      >
        <button
          type="button"
          disabled={!enabled}
          onClick={toggleSketchMode}
          className={cn(
            "mb-1 flex h-8 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
            "disabled:pointer-events-none disabled:opacity-35",
            sketchMode
              ? "border-accent-500 bg-accent-500/20 text-accent-500 shadow-xs"
              : "border-base-300 bg-base-100 text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <PencilRuler size={16} strokeWidth={1.8} />
        </button>
      </Tip>

      {RAIL_GROUPS.map((group, gi) => (
        <div key={group.title} className="flex w-full flex-col items-center">
          {gi > 0 && <div className="my-1 h-px w-7 bg-base-200" />}
          {group.tools.map((id) => {
            const def = TOOL_BY_ID.get(id);
            if (!def) return null;
            const Icon = def.icon;
            const active = tool === id;
            const keys = bindingHint(`tool:${id}`);
            return (
              <Tip key={id} label={def.label} keys={keys || undefined} side="right">
                <button
                  type="button"
                  disabled={!enabled}
                  onClick={() => setTool(id)}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors",
                    "disabled:pointer-events-none disabled:opacity-35",
                    active
                      ? "bg-accent-500 text-white shadow-xs"
                      : "text-base-600 hover:bg-base-200 hover:text-base-800",
                  )}
                >
                  <Icon size={16} strokeWidth={1.75} />
                </button>
              </Tip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
