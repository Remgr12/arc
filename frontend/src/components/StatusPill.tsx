import { useArcStore } from "../lib/store";
import { cn } from "./ui";

const fmt = (n: number) => Math.round(n * 10) / 10;

// ---------------------------------------------------------------------------
// Bottom-center contextual status pill: what tools tell the user right now,
// plus live cursor coordinates. StatusBar keeps only counts / toggles.
// ---------------------------------------------------------------------------

export function StatusPill() {
  const statusMessage = useArcStore((s) => s.statusMessage);
  const scene = useArcStore((s) => s.scene);
  const cursorWorld = useArcStore((s) => s.cursorWorld);
  const selKind = useArcStore((s) => s.selKind);
  const selectionCount = scene?.selection.length ?? 0;
  const pending = statusMessage !== "Ready";

  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-40 -translate-x-1/2">
      <div
        className={cn(
          "flex items-center gap-3 rounded-full border border-base-200 px-3.5 py-1.5",
          "bg-base-50/95 shadow-lg shadow-black/10 backdrop-blur-md",
        )}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            selKind === "face" || selKind === "edge"
              ? "bg-accent-500"
              : pending
                ? "bg-accent-500/60"
                : "bg-base-400",
          )}
        />
        <span className="min-w-0 max-w-[26rem] truncate text-[12.5px] font-medium text-base-700">
          {statusMessage}
        </span>
        {selectionCount > 0 && (
          <span className="shrink-0 whitespace-nowrap rounded-full bg-accent-500/15 px-2 py-0.5 text-[11px] font-medium text-accent-400">
            {selectionCount} {selKind === "entity" ? "item" : selKind}
            {selectionCount === 1 ? "" : "s"}
          </span>
        )}
        <span className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-base-500" title="Cursor position">
          {fmt(cursorWorld[0])} · {fmt(cursorWorld[2])}
        </span>
      </div>
    </div>
  );
}
