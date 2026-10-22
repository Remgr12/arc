import { useState } from "react";
import {
  Box,
  History,
  Ruler,
  ScanEye,
  Slice,
  SquareCheck,
  StretchHorizontal,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { actions } from "../lib/actions";
import { cn, Tip } from "./ui";

// ---------------------------------------------------------------------------
// Right-floating utility rail: display modes, screenshot, isolate, section
// view (stub), measure. Unimplemented entries show a disabled tooltip.
// ---------------------------------------------------------------------------

export function UtilityRail() {
  const displayMode = useArcStore((s) => s.displayMode);
  const setDisplayMode = useArcStore((s) => s.setDisplayMode);
  const isolated = useArcStore((s) => s.isolated);
  const [modesOpen, setModesOpen] = useState(false);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative">
        {modesOpen && (
          <>
            <div
              className="fixed inset-0 z-30"
              onClick={() => setModesOpen(false)}
              aria-hidden
            />
            <div
              className={cn(
                "absolute right-full top-0 z-40 mr-1.5 flex flex-col gap-0.5",
                "rounded-xl border border-base-200 bg-base-50/95 p-1 shadow-lg shadow-black/10 backdrop-blur-md",
              )}
            >
              {(["shaded", "wireframe"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setDisplayMode(mode);
                    setModesOpen(false);
                  }}
                  className={cn(
                    "flex h-7 items-center gap-2 whitespace-nowrap rounded-lg px-2.5 text-left text-[12px] font-medium capitalize transition-colors",
                    displayMode === mode
                      ? "bg-accent-500/10 text-accent-600"
                      : "text-base-600 hover:bg-base-100 hover:text-base-800",
                  )}
                >
                  <Box size={13} strokeWidth={1.6} />
                  {mode}
                </button>
              ))}
            </div>
          </>
        )}
        <Tip label="Display modes" keys="Shaded / Wireframe" side="left">
          <button
            type="button"
            onClick={() => setModesOpen((open) => !open)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-all hover:bg-base-200 hover:text-base-800"
          >
            <StretchHorizontal size={17} strokeWidth={1.6} />
          </button>
        </Tip>
      </div>

      <Tip label="Screenshot" keys="PNG download" side="left">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("arc-capture"))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-all hover:bg-base-200 hover:text-base-800"
        >
          <ScanEye size={17} strokeWidth={1.6} />
        </button>
      </Tip>

      <Tip label="History (Ctrl+Alt+H)" keys="Not implemented yet" side="left">
        <button
          type="button"
          disabled
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-all disabled:pointer-events-none disabled:opacity-35"
        >
          <History size={17} strokeWidth={1.6} />
        </button>
      </Tip>

      <Tip
        label={isolated ? "Isolate on · click to show all" : "Isolate"}
        keys="Hide unselected"
        side="left"
      >
        <button
          type="button"
          onClick={() => void actions.isolateSelection()}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg transition-all",
            isolated
              ? "bg-accent-500/10 text-accent-600"
              : "text-base-600 hover:bg-base-200 hover:text-base-800",
          )}
        >
          <SquareCheck size={17} strokeWidth={1.6} />
        </button>
      </Tip>

      <Tip label="Section view" keys="Not implemented yet" side="left">
        <button
          type="button"
          disabled
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-all disabled:pointer-events-none disabled:opacity-35"
        >
          <Slice size={17} strokeWidth={1.6} />
        </button>
      </Tip>

      <Tip label="Measure" keys="Distance between two clicks" side="left">
        <button
          type="button"
          onClick={() => useArcStore.getState().setTool("dimension")}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-base-600 transition-all hover:bg-base-200 hover:text-base-800"
        >
          <Ruler size={17} strokeWidth={1.6} />
        </button>
      </Tip>
    </div>
  );
}
