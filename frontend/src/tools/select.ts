import type { ToolContext, ToolHandler } from "./types";

// ---------------------------------------------------------------------------
// Selection tool. Click picks, Shift toggles, empty space rubber-band marquee.
// The move tool shares helperOutSelection and adds the translate gizmo.
// ---------------------------------------------------------------------------

export function selectUnderCursor(event: PointerEvent, ctx: ToolContext): void {
  const scene = ctx.scene();
  const hit = ctx.pickEntity(event);
  const entity = hit ? scene?.entities.find((e) => e.id === hit) ?? null : null;
  if (hit && entity && !entity.locked) {
    let selection = ctx.selection();
    if (event.shiftKey) {
      selection = selection.includes(hit)
        ? selection.filter((id) => id !== hit)
        : [...selection, hit];
    } else if (!selection.includes(hit)) {
      selection = [hit];
    }
    const primary = selection[selection.length - 1] ?? null;
    void ctx.setSelection(selection, primary);
    ctx.setStatus(`${selection.length} selected`);
    return;
  }
  if (!ctx.isMarqueeActive()) ctx.startMarquee(event);
}

export const selectTool: ToolHandler = {
  id: "select",
  onActivate(ctx) {
    ctx.setGizmo(null);
    ctx.setStatus(
      ctx.selection().length > 0
        ? `${ctx.selection().length} selected · click to reselect, Shift toggles`
        : "Select · click to pick · Shift toggles · drag for a rubber band",
    );
  },
  onPointerDown(event, ctx) {
    if (event.button !== 0) return false;
    selectUnderCursor(event, ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    if (ctx.isMarqueeActive()) ctx.moveMarquee(event);
  },
  onPointerUp(event, ctx) {
    if (ctx.isMarqueeActive()) ctx.finishMarquee(event);
  },
  hint: () => "Select · click to pick · Shift toggles · drag rubber band",
};
