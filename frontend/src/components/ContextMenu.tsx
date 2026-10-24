import { useEffect, useRef } from "react";
import { useArcStore } from "../lib/store";
import { cn } from "./ui";

// ---------------------------------------------------------------------------
// React-rendered context menu. The viewport pushes items + host-relative
// coordinates into the store; dismissal is one-shot pointerdown outside.
// ---------------------------------------------------------------------------

export function ContextMenu() {
  const menu = useArcStore((s) => s.contextMenu);
  const close = useArcStore((s) => s.closeContextMenu);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu.open) return;
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) {
        close();
      }
    };
    window.addEventListener("pointerdown", dismiss, true);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointerdown", dismiss, true);
      window.removeEventListener("keydown", key);
    };
  }, [menu.open, close]);

  if (!menu.open) return null;

  return (
    <div
      ref={ref}
      className={cn(
        "anim-pop absolute z-50 min-w-52 rounded-xl border border-base-200 bg-base-50/95 p-1 shadow-2xl backdrop-blur-md",
      )}
      style={{ left: `${Math.max(8, menu.x)}px`, top: `${Math.max(8, menu.y)}px` }}
    >
      {menu.items.map((item, index) => {
        if (item.separator) {
          return <div key={`sep-${index}`} className="my-1 h-px bg-base-200/80" />;
        }
        return (
          <button
            key={`${item.label}-${index}`}
            type="button"
            disabled={item.disabled === true}
            onClick={() => {
              close();
              item.run();
            }}
            className={cn(
              "flex w-full items-center justify-between gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[12px] font-medium transition-colors",
              item.danger
                ? "text-danger-500 hover:bg-danger-500/10"
                : "text-base-700 hover:bg-base-200/80 hover:text-base-900",
              "disabled:pointer-events-none disabled:opacity-35",
            )}
          >
            <span className="flex items-center gap-2 truncate">
              {item.icon && <span className="text-base-500 shrink-0">{item.icon}</span>}
              <span className="truncate">{item.label}</span>
            </span>
            {item.shortcut && (
              <span className="rounded bg-base-200/80 px-1 py-0.2 font-mono text-[9.5px] font-medium text-base-500 shrink-0">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
