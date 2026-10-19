import { cn } from "./ui";
import type { ToolId } from "../lib/types";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { useEffect } from "react";

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
  const selectedEntityId = useArcStore((s) => s.scene?.selection[s.scene.selection.length - 1] ?? null);

  const enabled = scene != null;

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

  // Determine active tool based on selected entity
  const getToolForEntity = (entity: { id: string; category?: string } | null): ToolId => {
    if (!entity) return "select";
    
    const category = entity.category || "primitive";
    
    switch (category) {
      case "sketch":
      case "solid":
        return "select";
      case "line":
      case "polyline":
        return "line";
      case "rectangle":
        return "rectangle";
      case "circle":
        return "circle";
      case "extrude":
      case "revolve":
      case "sweep":
      case "loft":
        return "extrude";
      case "box":
        return "box";
      case "sphere":
        return "sphere";
      case "cylinder":
        return "cylinder";
      case "cone":
        return "cone";
      case "torus":
        return "torus";
      case "dimension":
        return "dimension";
      case "wall":
        return "wall";
      default:
        return "select";
    }
  };

  const getActiveToolForSelection = (): ToolId => {
    if (selectedEntityId) {
      const entity = scene?.entities.find((e) => e.id === selectedEntityId);
      if (entity) {
        return getToolForEntity(entity);
      }
    }
    return tool;
  };

  const activeTool = getActiveToolForSelection();

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
        "fixed right-4 bottom-1/2 z-40 flex -translate-y-1/2 transform-gpu flex-row items-center gap-2 rounded-2xl border border-base-200 bg-base-50/95 px-3 py-2 backdrop-blur-md transition-all duration-300",
        "shadow-lg shadow-black/10",
      )}
    >
      {filteredGroups.map((group, gi) => (
        <div key={group.title} className="flex flex-row items-center gap-1">
          {gi > 0 && <div className="h-8 w-px bg-base-200/60" />}
          {group.tools.map((id) => {
            const def = TOOL_BY_ID.get(id);
            if (!def) return null;
            const Icon = def.icon;
            const isActive = activeTool === id;

            return (
              <button
                key={id}
                type="button"
                onClick={() => setTool(id)}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-xl transition-all",
                  isActive
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
