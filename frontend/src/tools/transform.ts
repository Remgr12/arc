import type { ToolHandler, GizmoMode } from "./types";
import { selectUnderCursor } from "./select";

// ---------------------------------------------------------------------------
// Transform tools. The viewport attaches a TransformControls gizmo to the
// primary selection while the tool is active; drags commit through the
// viewport's gizmo write-back. The handler owns selection, hints and the
// gizmo mode.
// ---------------------------------------------------------------------------

function centeredGizmoTool(id: string, mode: GizmoMode, label: string, tip: string): ToolHandler {
  return {
    id: id as ToolHandler["id"],
    onActivate(ctx) {
      const primary = ctx.selection()[ctx.selection().length - 1] ?? null;
      ctx.setGizmo(primary ? mode : null);
      ctx.setStatus(`${label} · drag the gizmo · click empty space to reselect`);
    },
    onDeactivate(ctx) {
      ctx.setGizmo(null);
    },
    onPointerDown(event, ctx) {
      if (event.button !== 0 || ctx.gizmoActive()) return false;
      const had = ctx.selection().length;
      selectUnderCursor(event, ctx);
      const primary = ctx.selection()[ctx.selection().length - 1] ?? null;
      ctx.setGizmo(primary ? mode : null);
      if (primary && ctx.selection().length === 1 && had <= 1) {
        ctx.setStatus(`${label} · drag the gizmo`);
      }
      return true;
    },
    onPointerMove(event, ctx) {
      if (ctx.isMarqueeActive()) ctx.moveMarquee(event);
    },
    onPointerUp(event, ctx) {
      if (ctx.isMarqueeActive()) ctx.finishMarquee(event);
    },
    hint: () => tip,
  };
}

export const moveTool: ToolHandler = centeredGizmoTool(
  "move",
  "translate",
  "Move",
  "Move · drag gizmo arrows/planes",
);
export const rotateTool: ToolHandler = centeredGizmoTool(
  "rotate",
  "rotate",
  "Rotate",
  "Rotate · drag the rotate gizmo",
);
export const scaleTool: ToolHandler = centeredGizmoTool(
  "scale",
  "scale",
  "Scale",
  "Scale · drag the scale gizmo",
);
