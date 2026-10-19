import { cn } from "./ui";
import type { ToolId } from "../lib/types";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { useEffect, useState } from "react";

const DOCK_GROUPS = [
  {
    title: "Select & Transform",
    tools: ["select", "move"] as ToolId[],
  },
  {
    title: "Sketch",
    tools: ["line", "polyline", "rectangle", "circle", "arc", "polygon"] as ToolId[],
  },
  {
    title: "Modify",
    tools: ["offset", "trim", "extend", "fillet", "mirror"] as ToolId[],
  },
  {
    title: "Solid",
    tools: ["extrude", "revolve", "sweep", "loft"] as ToolId[],
  },
  {
    title: "Primitives",
    tools: ["box", "sphere", "cylinder", "cone", "torus", "plane"] as ToolId[],
  },
  {
    title: "Annotate",
    tools: ["dimension", "wall"] as ToolId[],
  },
];

export function Dock() {
  const tool = useArcStore((s) => s.tool);
  const setTool = useArcStore((s) => s.setTool);
  const scene = useArcStore((s) => s.scene);
  const activeToolCategory = useArcStore((s) => s.activeToolCategory);
  const setActiveToolCategory = useArcStore((s) => s.setActiveToolCategory);
  const [isVisible, setIsVisible] = useState(true);
  const [lastScrollY, setLastScrollY] = useState(0);

  const enabled = scene != null;

  // Handle scroll-based visibility
  useEffect(() => {
    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      if (Math.abs(currentScrollY - lastScrollY) > 50) {
        setIsVisible(currentScrollY < 100);
        setLastScrollY(currentScrollY);
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [lastScrollY]);

  // Handle context-sensitive visibility
  useEffect(() => {
    const handleContextChange = () => {
      if (tool && enabled) {
        const toolDef = TOOL_BY_ID.get(tool);
        if (toolDef) {
          const group = toolDef.group;
          setActiveToolCategory(group);
        }
      }
    };

    handleContextChange();
    window.addEventListener("arc-tool-change", handleContextChange);
    return () => window.removeEventListener("arc-tool-change", handleContextChange);
  }, [tool, enabled, setActiveToolCategory]);

  const filteredGroups = DOCK_GROUPS.map((group) => ({
    ...group,
    tools: group.tools.filter((toolId) => {
      if (!enabled) return false;
      const toolDef = TOOL_BY_ID.get(toolId);
      if (!toolDef) return false;
      return toolDef.group === activeToolCategory || activeToolCategory === "all";
    }),
  })).filter((group) => group.tools.length > 0);

  if (!enabled) return null;

  return (
    <div
      className={cn(
        "fixed bottom-4 left-1/2 z-40 flex -translate-x-1/2 transform-gpu flex-row items-center gap-2 rounded-2xl border border-base-200 bg-base-50/95 px-3 py-2 backdrop-blur-md transition-all duration-300",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-20 opacity-0",
        "shadow-lg shadow-black/10",
      )}
    >
      {filteredGroups.map((group, gi) => (
        <div key={group.title} className="flex flex-col items-center gap-1">
          {gi > 0 && <div className="h-px w-12 bg-base-200/60" />}
          {group.tools.map((id) => {
            const def = TOOL_BY_ID.get(id);
            if (!def) return null;
            const Icon = def.icon;
            const active = tool === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
                  active
                    ? "bg-accent-500 text-white shadow-sm"
                    : "text-base-600 hover:bg-base-100 hover:text-base-800",
                )}
                title={def.label}
              >
                <Icon size={18} strokeWidth={1.75} />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
