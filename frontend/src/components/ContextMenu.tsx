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
        "anim-pop absolute z-50 w-48 rounded-lg border border-base-300 bg-base-100 py-1 shadow-xl",
      )}
      style={{ left: `${Math.max(4, menu.x)}px`, top: `${Math.max(4, menu.y)}px` }}
    >
      {menu.items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          disabled={item.disabled === true}
          onClick={() => {
            close();
            item.run();
          }}
          className="block w-full px-3 py-1.5 text-left text-[12.5px] text-base-700 transition-colors hover:bg-base-200 hover:text-base-800 disabled:pointer-events-none disabled:opacity-40"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
