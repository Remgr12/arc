import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { bindingHint } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import { cn, Tip } from "./ui";
import type { ToolId } from "../lib/types";

/** Vertical layout of the tool rail. Groups separated by hairlines. */
const RAIL_GROUPS: { title: string; tools: ToolId[] }[] = [
  { title: "Select & transform", tools: ["select", "move"] },
  {
    title: "Sketch",
    tools: ["line", "polyline", "rectangle", "circle", "arc", "polygon"],
  },
  {
    title: "Modify",
    tools: ["offset", "trim", "extend", "fillet", "mirror"],
  },
  {
    title: "Solid",
    tools: ["extrude", "revolve", "sweep", "loft"],
  },
  { title: "Primitives", tools: ["box", "sphere", "cylinder", "cone", "torus", "plane"] },
  { title: "Annotate", tools: ["dimension", "wall"] },
];

export function ToolRail() {
  const tool = useArcStore((s) => s.tool);
  const setTool = useArcStore((s) => s.setTool);
  const scene = useArcStore((s) => s.scene);
  useKeybindStore((s) => s.profiles); // re-render when bindings change (tooltips show keys)

  const enabled = scene != null;

  return (
    <nav
      className="flex w-14 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-base-200 bg-base-50 py-2"
      aria-label="Tools"
    >
      {RAIL_GROUPS.map((group, gi) => (
        <div key={group.title} className="flex w-full flex-col items-center">
          {gi > 0 && <div className="my-1 h-px w-8 bg-base-200/60" />}
          {group.tools.map((id) => {
            const def = TOOL_BY_ID.get(id);
            if (!def) return null;
            const Icon = def.icon;
            const active = tool === id;
            const keys = bindingHint(`tool:${id}`);
            const button = (
              <button
                type="button"
                disabled={!enabled}
                onClick={() => setTool(id)}
                className={cn(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-all",
                  "disabled:pointer-events-none disabled:opacity-35",
                  active
                    ? "bg-accent-500 text-white shadow-sm ring-2 ring-accent-500/20"
                    : "text-base-600 hover:bg-base-100 hover:text-base-800",
                )}
              >
                <Icon size={18} strokeWidth={1.75} />
              </button>
            );
            return (
              <Tip key={id} label={def.label} keys={keys || undefined} side="right">
                {button}
              </Tip>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
