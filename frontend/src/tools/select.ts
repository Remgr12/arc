import type { ToolContext, ToolHandler } from "./types";
import { useArcStore } from "../lib/store";
import type { RefObject } from "../lib/types";
import { faceEditable } from "./faceTools";
import { armExtrudeSelectedSketch } from "./solid";

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
  } else {
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
  // Check nearby edges first (since edges lie on face boundaries), then tagged
  // faces, then whole entities. Failing all three falls back to the marquee.
  const edge = ctx.pickEdge(event, 7);
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
  onDoubleClick(event, ctx) {
    const edge = ctx.pickEdge(event, 8);
    if (edge) {
      ctx.setSelectionRef({
        entityId: edge.entityId,
        kind: "edge",
        face: null,
        edge: edge.key,
        point: edge.point,
        normal: [0, 0, 0],
      });
      void ctx.setSelection([edge.entityId], edge.entityId);
      useArcStore.getState().setTool("fillet-edge");
      return true;
    }
    const face = ctx.pickFace(event);
    if (face) {
      const entity = ctx.entityById(face.entityId);
      if (entity && faceEditable(entity.kind)) {
        ctx.setSelectionRef({
          entityId: face.entityId,
          kind: "face",
          face: face.faceIndex,
          edge: null,
          point: face.point,
          normal: face.normal,
        });
        void ctx.setSelection([face.entityId], face.entityId);
        useArcStore.getState().setTool("extrude-face");
        return true;
      }
    }
    const id = ctx.pickEntity(event);
    const entity = id ? ctx.entityById(id) : null;
    if (id && entity && entity.category === "sketch") {
      void ctx.setSelection([id], id);
      armExtrudeSelectedSketch();
      useArcStore.getState().setTool("extrude");
      return true;
    }
    return false;
  },
  hint: () => "Select · click to pick (double-click face/sketch to extrude) · Shift toggles · drag rubber band",
};
