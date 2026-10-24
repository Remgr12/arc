import { Slice, X } from "lucide-react";
import { useArcStore } from "../lib/store";
import { TOOL_BY_ID } from "../data/tools";
import type { ToolId } from "../lib/types";

// ---------------------------------------------------------------------------
// Sleek, minimal horizontal indicator: shows active tool name and compact controls.
// ---------------------------------------------------------------------------

export function ModeBanner() {
  const tool = useArcStore((s) => s.tool) as ToolId;
  const drafting = useArcStore((s) => s.drafting);
  const sketchMode = useArcStore((s) => s.sketchMode);
  const sketchPlaneLabel = useArcStore((s) => s.sketchPlaneLabel);
  const exitSketchMode = useArcStore((s) => s.exitSketchMode);
  const sectionView = useArcStore((s) => s.sectionView);
  const sectionOffset = useArcStore((s) => s.sectionOffset);
  const setSectionOffset = useArcStore((s) => s.setSectionOffset);
  const setSectionView = useArcStore((s) => s.setSectionView);

  const visible = tool !== "select" || drafting || sketchMode || sectionView;
  if (!visible) return null;

  const def = TOOL_BY_ID.get(tool);
  const label = def?.label ?? (drafting ? "Drafting" : tool);

  const deselectTool = () => {
    window.dispatchEvent(new CustomEvent("arc-draft-cancel"));
    useArcStore.getState().setTool("select");
    useArcStore.getState().setDrafting(false);
  };

  return (
    <div className="pointer-events-none absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2">
      {/* Small horizontal tool indicator */}
      {(tool !== "select" || drafting || sketchMode) && (
        <div className="anim-slide-down pointer-events-auto flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1 shadow-md">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#28b5f5]" />
          <span className="text-[12px] font-semibold text-base-900">
            {sketchMode ? `Sketch · ${sketchPlaneLabel.split(" ")[0]}` : label}
          </span>
          <button
            type="button"
            title={sketchMode ? "Exit sketch" : "Deselect tool (Esc)"}
            onClick={sketchMode ? exitSketchMode : deselectTool}
            className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}

      {/* Compact section view slider */}
      {sectionView && (
        <div className="anim-slide-down pointer-events-auto flex items-center gap-2 rounded-full border border-base-300 bg-base-100 px-3 py-1 shadow-md">
          <Slice size={13} className="text-[#28b5f5]" />
          <span className="text-[11.5px] font-medium text-base-700">Section</span>
          <input
            type="range"
            min={-60}
            max={120}
            step={1}
            value={sectionOffset}
            onChange={(e) => setSectionOffset(Number(e.target.value))}
            className="h-1.5 w-20 cursor-pointer accent-[#28b5f5]"
          />
          <button
            type="button"
            title="Close section view"
            onClick={() => setSectionView(false)}
            className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-base-500 hover:bg-base-200 hover:text-base-800"
          >
            <X size={12} strokeWidth={2.2} />
          </button>
        </div>
      )}
    </div>
  );
}
