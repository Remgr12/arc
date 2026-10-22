import { X } from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import { cn } from "./ui";

// ---------------------------------------------------------------------------
// Top-center mode banner: shows the active tool while it is not Select (or
// while a draft is running), with a cancel button dispatching arc-draft-cancel.
// ---------------------------------------------------------------------------

export function ModeBanner() {
  const tool = useArcStore((s) => s.tool);
  const drafting = useArcStore((s) => s.drafting);
  const visible = tool !== "select" || drafting;
  if (!visible) return null;

  const def = TOOL_BY_ID.get(tool);
  const label = def?.label ?? (drafting ? "Drafting" : tool);

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2">
      <div
        className={cn(
          "pointer-events-auto flex items-center gap-2 rounded-full border border-base-200",
          "bg-base-50/95 px-3 py-1.5 shadow-lg shadow-black/10 backdrop-blur-md",
        )}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
        <span className="text-[12.5px] font-medium text-base-700">{label}</span>
        <button
          type="button"
          title={def?.tip ?? "Cancel (Esc)"}
          onClick={() => window.dispatchEvent(new CustomEvent("arc-draft-cancel"))}
          className="flex h-5 w-5 items-center justify-center rounded-full text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
        >
          <X size={13} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
