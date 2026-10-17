import { useArcStore } from "../lib/store";
import { TOOLS } from "../data/tools";
import { bindingHint } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import type { ToolId } from "../lib/types";

export function ToolPalette() {
  const tool = useArcStore((s) => s.tool);
  const setTool = useArcStore((s) => s.setTool);
  const scene = useArcStore((s) => s.scene);
  useKeybindStore((s) => s.profiles); // re-render when bindings change (tooltips show keys)

  const groups: { title: string; items: typeof TOOLS }[] = [
    { title: "Tools", items: TOOLS.filter((t) => t.id === "select" || t.id === "move") },
    { title: "Primitives", items: TOOLS.filter((t) => t.group === "primitives") },
    { title: "Sketch", items: TOOLS.filter((t) => t.group === "sketch") },
  ];

  return (
    <nav className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-base-300 bg-base-100 py-2">
      {groups.map(
        (group) =>
          group.items.length > 0 && (
            <div key={group.title} className="flex flex-col items-center gap-1">
              <div className="my-1 h-px w-6 bg-base-400" title={group.title} />
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = tool === item.id;
                const enabled = scene != null;
                const hint = bindingHint(`tool:${item.id}`);
                return (
                  <button
                    key={item.id}
                    title={`${item.label}${hint ? ` (${hint})` : ""}: ${item.tip}`}
                    onClick={() => setTool(item.id as ToolId)}
                    className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                      active
                        ? "bg-accent-600/25 text-accent-500 ring-1 ring-accent-600/60"
                        : enabled
                          ? "text-base-600 hover:bg-base-200 hover:text-base-800"
                          : "text-base-400"
                    }`}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
            </div>
          ),
      )}
    </nav>
  );
}
