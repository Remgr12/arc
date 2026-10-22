import type { ToolContext, ToolHandler } from "./types";
import { useArcStore } from "../lib/store";
import type { RefObject } from "../lib/types";

// ---------------------------------------------------------------------------
// Selection tool. Click picks (face/edge first, whole entity as fallback),
// Shift toggles, empty space rubber-band marquee. The move tool derives from
// the same helpers and adds the translate gizmo.
// ---------------------------------------------------------------------------

/** Compose the entity-id list after toggling/additive face/edge selection. */
function commitRefSelection(
  refObj: RefObject | null,
  event: PointerEvent,
  ctx: ToolContext,
): void {
  const store = useArcStore.getState();
  store.setSelectionRef(refObj);
  if (!refObj) return;
  const entityId = refObj.entityId;
  let selection = ctx.selection();
  if (event.shiftKey) {
    selection = selection.includes(entityId)
      ? selection.filter((id) => id !== entityId)
      : [...selection, entityId];
  } else if (!selection.includes(entityId)) {
    selection = [entityId];
  }
  const primary = selection[selection.length - 1] ?? null;
  void ctx.setSelection(selection, primary);
  const label =
    refObj.kind === "face"
      ? `${selection.length} selected · face ${refObj.face}`
      : refObj.kind === "edge"
        ? `${selection.length} selected · edge`
        : `${selection.length} selected`;
  ctx.setStatus(label);
}

export function selectUnderCursor(event: PointerEvent, ctx: ToolContext): void {
  // Face pick first (tagged entities only), then nearby edges, then the
  // whole entity. Failing all three falls back to the marquee.
  const face = ctx.pickFace(event);
  if (face) {
    commitRefSelection(
      {
        entityId: face.entityId,
        kind: "face",
        face: face.faceIndex,
        edge: null,
        point: face.point,
        normal: face.normal,
      },
      event,
      ctx,
    );
    return;
  }
  const edge = ctx.pickEdge(event);
  if (edge) {
    commitRefSelection(
      {
        entityId: edge.entityId,
        kind: "edge",
        face: null,
        edge: edge.key,
        point: edge.point,
        normal: [0, 0, 0],
      },
      event,
      ctx,
    );
    return;
  }
  const id = ctx.pickEntity(event);
  const entity = id ? ctx.entityById(id) : null;
  if (id && entity && !entity.locked) {
    commitRefSelection(
      {
        entityId: id,
        kind: "entity",
        face: null,
        edge: null,
        point: [0, 0, 0],
        normal: [0, 1, 0],
      },
      event,
      ctx,
    );
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
