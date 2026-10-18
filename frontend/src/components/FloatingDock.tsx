import { useCallback, useEffect, useRef, useState } from "react";
import { Boxes, ChevronsLeft, GripVertical } from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOLS } from "../data/tools";
import { bindingHint } from "../lib/keybinds";
import { useKeybindStore } from "../lib/keybindProfiles";
import { cn } from "./ui";
import type { ToolId } from "../lib/types";

const STORAGE_KEY = "arc.dock.v1";
const MIN_W = 160;
const MIN_H = 180;
const PILL = 40;

interface Persisted {
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed: boolean;
  open: Record<string, boolean>;
}

const DEFAULTS: Persisted = {
  x: 12,
  y: 0, // recomputed below once window height is known
  w: 176,
  h: 340,
  collapsed: false,
  open: { tools: true, create: true, sketch: true },
};

function defaults(): Persisted {
  const h = 340;
  return { ...DEFAULTS, y: Math.max(8, window.innerHeight - h - 84) };
}

function clampTo(state: Persisted, vw = window.innerWidth, vh = window.innerHeight): Persisted {
  const w = state.collapsed ? PILL : state.w;
  const h = state.collapsed ? PILL : state.h;
  return {
    ...state,
    x: Math.min(Math.max(state.x, 4), Math.max(4, vw - w - 4)),
    y: Math.min(Math.max(state.y, 4), Math.max(4, vh - h - 4)),
  };
}

function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return clampTo(defaults());
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return clampTo({ ...defaults(), ...parsed, open: { ...DEFAULTS.open, ...parsed.open } });
  } catch {
    return clampTo(defaults());
  }
}

const CREATE_EXTRAS = new Set(["circle", "rectangle"]);

export function FloatingDock() {
  const [{ x, y, w, h, collapsed, open }, setState] = useState<Persisted>(load);
  const tool = useArcStore((s) => s.tool);
  const setTool = useArcStore((s) => s.setTool);
  const scene = useArcStore((s) => s.scene);
  useKeybindStore((s) => s.profiles); // re-render when bindings change (tooltips show keys)

  const dragRef = useRef<{ ox: number; oy: number } | null>(null);
  const resizeRef = useRef<{ px: number; py: number; w: number; h: number } | null>(null);

  const update = useCallback((patch: Partial<Persisted> | ((s: Persisted) => Persisted)) => {
    setState((s) => {
      const next = typeof patch === "function" ? patch(s) : { ...s, ...patch };
      return clampTo(next);
    });
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ x, y, w, h, collapsed, open }));
    } catch {
      // persistence is best-effort
    }
  }, [x, y, w, h, collapsed, open]);

  useEffect(() => {
    const onResize = () => update((s) => s);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [update]);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (collapsed) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { ox: e.clientX - x, oy: e.clientY - y };
  };
  const onHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    update({ x: e.clientX - d.ox, y: e.clientY - d.oy });
  };
  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizeRef.current = { px: e.clientX, py: e.clientY, w, h };
  };
  const onResizePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeRef.current;
    if (!r) return;
    update({
      w: Math.max(MIN_W, Math.min(window.innerWidth - x - 4, r.w + e.clientX - r.px)),
      h: Math.max(MIN_H, Math.min(window.innerHeight - y - 4, r.h + e.clientY - r.py)),
    });
  };
  const endResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const groups: { key: string; title: string; items: typeof TOOLS }[] = [
    {
      key: "tools",
      title: "Tools",
      items: TOOLS.filter((t) => t.group === "selectors"),
    },
    {
      key: "create",
      title: "Create",
      items: TOOLS.filter((t) => t.group === "primitives" || CREATE_EXTRAS.has(t.id)),
    },
    {
      key: "sketch",
      title: "Sketch",
      items: TOOLS.filter((t) => t.group === "sketch" && !CREATE_EXTRAS.has(t.id)),
    },
  ];

  const enabled = scene != null;

  if (collapsed) {
    return (
      <button
        type="button"
        title="Show dock"
        onClick={() => update({ collapsed: false })}
        className={cn(
          "fixed z-40 flex h-10 w-10 items-center justify-center rounded-full",
          "border border-base-300 bg-base-900/85 text-base-600 shadow-lg backdrop-blur",
          "transition-colors hover:border-base-400 hover:text-base-800",
        )}
        style={{ left: x, top: y }}
      >
        <Boxes size={18} />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden rounded-xl",
        "border border-base-300 bg-base-900/85 shadow-lg backdrop-blur",
      )}
      style={{ left: x, top: y, width: w, height: h }}
    >
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => update({ collapsed: true })}
        title="Drag to move - double-click to hide"
        className="flex h-7 shrink-0 cursor-grab touch-none items-center gap-1 border-b border-base-300/70 px-1.5 active:cursor-grabbing"
      >
        <GripVertical size={12} className="shrink-0 text-base-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-base-600">
          Tools
        </span>
        <button
          type="button"
          title="Hide dock"
          onClick={() => update({ collapsed: true })}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded text-base-500 transition-colors hover:bg-base-300/30 hover:text-base-800"
        >
          <ChevronsLeft size={13} />
        </button>
      </div>

      <div
        className="absolute bottom-0 right-0 z-10 cursor-nwse-resize touch-none p-1.5"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={endResize}
        onPointerCancel={endResize}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="pointer-events-none text-base-500">
          <path d="M9 1 L1 9 M9 5 L5 9 M9 8 L8 9" stroke="currentColor" strokeWidth="1" fill="none" />
        </svg>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
        {groups.map(
          (group) =>
            group.items.length > 0 && (
              <div key={group.key} className="mb-0.5">
                <button
                  type="button"
                  title={open[group.key] === false ? `Expand ${group.title}` : `Collapse ${group.title}`}
                  onClick={() => update((s) => ({ ...s, open: { ...s.open, [group.key]: !s.open[group.key] } }))}
                  className="flex h-6 w-full items-center gap-1 rounded px-0.5 text-left text-[11px] font-semibold uppercase tracking-wide text-base-600 transition-colors hover:text-base-800"
                >
                  <span className="h-px flex-1 bg-base-400/60" />
                  {group.title}
                  <span className="h-px flex-1 bg-base-400/60" />
                </button>
                {open[group.key] !== false && (
                  <div className="flex flex-col">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = tool === item.id;
                      const hint = bindingHint(`tool:${item.id}`);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={`${item.label}${hint ? ` (${hint})` : ""}: ${item.tip}`}
                          onClick={() => setTool(item.id as ToolId)}
                          className={cn(
                            "flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left transition-colors",
                            active
                              ? "bg-accent-600/25 text-accent-500 ring-1 ring-accent-600/60"
                              : enabled
                                ? "text-base-600 hover:bg-base-200/60 hover:text-base-800"
                                : "text-base-400",
                          )}
                        >
                          <Icon size={14} className="shrink-0" />
                          <span className="truncate text-[11px]">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ),
        )}
      </div>
    </div>
  );
}
