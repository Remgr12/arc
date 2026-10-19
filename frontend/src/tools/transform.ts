import type { ToolHandler } from "./types";
import { selectUnderCursor } from "./select";

// ---------------------------------------------------------------------------
// Move tool. The viewport attaches a translate gizmo to the primary selection
// while this tool is active; drags commit through the viewport's gizmo
// write-back. This handler only owns selection and hints.
// ---------------------------------------------------------------------------

export const moveTool: ToolHandler = {
  id: "move",
  onActivate(ctx) {
    const primary = ctx.selection()[ctx.selection().length - 1] ?? null;
    ctx.setGizmo(primary ? "translate" : null);
    ctx.setStatus("Move · drag the arrows or planes · drag empty space to orbit-select");
  },
  onDeactivate(ctx) {
    ctx.setGizmo(null);
  },
  onPointerDown(event, ctx) {
    if (event.button !== 0 || ctx.gizmoActive()) return false;
    const had = ctx.selection().length;
    selectUnderCursor(event, ctx);
    const primary = ctx.selection()[ctx.selection().length - 1] ?? null;
    ctx.setGizmo(primary ? "translate" : null);
    if (primary && ctx.selection().length === 1 && had <= 1) {
      ctx.setStatus("Move · drag a gizmo arrow or plane");
    }
    return true;
  },
  onPointerMove(event, ctx) {
    if (ctx.isMarqueeActive()) ctx.moveMarquee(event);
  },
  onPointerUp(event, ctx) {
    if (ctx.isMarqueeActive()) ctx.finishMarquee(event);
  },
  hint: () => "Move · drag gizmo arrows/planes",
};
