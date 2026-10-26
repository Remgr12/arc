import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { arcThrough3, computePlaneBasis, type PlaneBasis } from "./geometry2d";
import { useArcStore } from "../lib/store";

// ---------------------------------------------------------------------------
// Sketch draw tools. All follow the same interaction model:
//   click to set points (click-click), or press-drag-release to size;
//   Shift constrains to axes; Esc cancels; Enter finishes multi-point tools.
//   Supports live numeric keyboard entry while drawing!
// ---------------------------------------------------------------------------

interface ClickState {
  anchor: THREE.Vector3 | null;
  lastCursor: THREE.Vector3 | null;
  lastScreen: { x: number; y: number } | undefined;
  press: { x: number; y: number } | null;
  dragged: boolean;
  typed: string;
}

function freshState(): ClickState {
  return {
    anchor: null,
    lastCursor: null,
    lastScreen: undefined,
    press: null,
    dragged: false,
    typed: "",
  };
}

/** Safely evaluate math expressions like "25.4 * 2" or "100 / 4 + 5" for in-place dimension entry. */
export function evalMathExpr(input: string): number | null {
  const clean = input.trim().replace(/,/g, ".");
  if (!clean) return null;
  if (!/^[\d\s+\-*/().]+$/.test(clean)) return null;
  try {
    const val = Function(`"use strict"; return (${clean});`)();
    if (typeof val === "number" && Number.isFinite(val) && !Number.isNaN(val)) {
      return val;
    }
  } catch {
    // incomplete expression while typing
  }
  return null;
}

function activePlaneBasis(overrideOrigin?: THREE.Vector3): PlaneBasis {
  const st = useArcStore.getState();
  const nArr = st.sketchMode ? st.sketchPlaneNormal : ([0, 1, 0] as [number, number, number]);
  const oArr = st.sketchMode
    ? st.sketchPlaneOrigin
    : ([0, st.sketchPlaneHeight ?? 0, 0] as [number, number, number]);
  const normal = new THREE.Vector3(nArr[0], nArr[1], nArr[2]);
  const origin = overrideOrigin ? overrideOrigin.clone() : new THREE.Vector3(oArr[0], oArr[1], oArr[2]);
  return computePlaneBasis(normal, origin);
}

function sketchPlanePoint(
  ctx: ToolContext,
  event: PointerEvent | MouseEvent,
  anchor?: THREE.Vector3 | null,
): THREE.Vector3 | null {
  const basis = activePlaneBasis(anchor ?? undefined);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(basis.normal, basis.origin);
  const out = new THREE.Vector3();
  return ctx.rayAt(event).intersectPlane(plane, out) ? out : null;
}

async function createSketchEntity(
  ctx: ToolContext,
  geometry: Parameters<ToolContext["createEntity"]>[0],
  position: [number, number, number],
  basis: PlaneBasis,
): Promise<string | null> {
  const rot: [number, number, number, number] = basis.isHorizontal
    ? [0, 0, 0, 1]
    : [basis.quat.x, basis.quat.y, basis.quat.z, basis.quat.w];
  const id = await ctx.createEntity(geometry, position, undefined, rot);
  if (id) {
    await ctx.setSelection([id], id);
  }
  return id;
}

/** Constrain `p` to the dominant axis (`u` or `v`) of `from` when shift is held. */
function ortho(from: THREE.Vector3, p: THREE.Vector3, shift: boolean): THREE.Vector3 {
  if (!shift) return p;
  const basis = activePlaneBasis(from);
  const delta = p.clone().sub(from);
  const du = delta.dot(basis.u);
  const dv = delta.dot(basis.v);
  if (Math.abs(du) >= Math.abs(dv)) {
    return from.clone().addScaledVector(basis.u, du);
  }
  return from.clone().addScaledVector(basis.v, dv);
}

function pointAlongDirection(
  from: THREE.Vector3,
  cursor: THREE.Vector3 | null,
  length: number,
): THREE.Vector3 {
  const basis = activePlaneBasis(from);
  if (!cursor) return from.clone().addScaledVector(basis.u, length);
  const dir = cursor.clone().sub(from);
  const dist = dir.length();
  if (dist < 1e-6) return from.clone().addScaledVector(basis.u, length);
  return from.clone().addScaledVector(dir.normalize(), length);
}

function formatNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return a.distanceTo(b);
}

function lenLabel(a: THREE.Vector3, b: THREE.Vector3): string {
  return formatNum(distXZ(a, b));
}

function angleLabel(a: THREE.Vector3, b: THREE.Vector3): string {
  const basis = activePlaneBasis(a);
  const delta = b.clone().sub(a);
  const deg = (Math.atan2(delta.dot(basis.v), delta.dot(basis.u)) * 180) / Math.PI;
  return `${Math.round(deg * 10) / 10}°`;
}

export function previewLineMaterial(ctx: ToolContext): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false });
  mat.color.copy(ctx.palette.line);
  return mat;
}

export function previewLine(
  points: THREE.Vector3[],
  ctx: ToolContext,
  closed = false,
): THREE.Line {
  const pts = closed ? [...points, points[0]] : points;
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const line = new THREE.Line(geometry, previewLineMaterial(ctx));
  line.renderOrder = 998;
  line.frustumCulled = false;
  return line;
}

export function previewRing(
  center: THREE.Vector3,
  radius: number,
  ctx: ToolContext,
  segments = 64,
): THREE.LineLoop {
  const basis = activePlaneBasis(center);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    pts.push(
      center
        .clone()
        .addScaledVector(basis.u, radius * Math.cos(a))
        .addScaledVector(basis.v, radius * Math.sin(a)),
    );
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const loop = new THREE.LineLoop(geometry, previewLineMaterial(ctx));
  loop.renderOrder = 998;
  loop.frustumCulled = false;
  return loop;
}

// ---------------------------------------------------------------------- line

/** Snap to any existing sketch vertex, intersection, quadrant, perpendicular, or polar ray so geometry connects cleanly. */
function snapToSketchVertex(
  raw: THREE.Vector3,
  ctx: ToolContext,
  chainPoints: THREE.Vector3[] = [],
  anchor?: THREE.Vector3 | null,
): THREE.Vector3 {
  // Use the full CAD precision snapping engine with active chain vertices prioritized
  return ctx.snap(raw, { anchor, extraPoints: chainPoints }).point;
}

/**
 * Inspect all open `line_curve` and open `polyline_curve` entities in the scene.
 * If the newly added segment completes a closed cycle of >= 3 vertices, merge
 * those connected segments into a single closed `polyline_curve` so it immediately
 * gets a shaded, extrudable face (Shapr3D style).
 */
async function tryMergeClosedLineLoop(
  ctx: ToolContext,
  seedEntityId: string,
): Promise<boolean> {
  const entities = ctx.scene()?.entities ?? [];
  const tol = Math.max(0.8, ctx.settings.gridSize * 0.45);

  interface ChainSeg {
    id: string;
    pts: THREE.Vector3[];
  }

  const segs: ChainSeg[] = [];
  for (const e of entities) {
    if (!e.visible || e.locked) continue;
    const pos = new THREE.Vector3(...e.transform.position);
    const quat = new THREE.Quaternion(...e.transform.rotation);
    const scale = new THREE.Vector3(...e.transform.scale);
    const toWorld = (lx: number, ly: number, lz: number) =>
      new THREE.Vector3(lx, ly, lz).multiply(scale).applyQuaternion(quat).add(pos);

    if (e.geometry.type === "line_curve" && Array.isArray(e.geometry.end)) {
      const end = e.geometry.end as [number, number, number];
      const p0 = toWorld(0, 0, 0);
      const p1 = toWorld(end[0], end[1], end[2]);
      if (p0.distanceTo(p1) > 1e-4) {
        segs.push({ id: e.id, pts: [p0, p1] });
      }
    } else if (
      e.geometry.type === "polyline_curve" &&
      Array.isArray(e.geometry.points) &&
      e.geometry.points.length >= 2
    ) {
      const pts = (e.geometry.points as [number, number, number][]).map((p) =>
        toWorld(p[0], p[1], p[2]),
      );
      if (pts[0].distanceTo(pts[pts.length - 1]) > tol) {
        segs.push({ id: e.id, pts });
      }
    }
  }

  const seed = segs.find((s) => s.id === seedEntityId);
  if (!seed) return false;

  const targetStart = seed.pts[0];
  const initialEnd = seed.pts[seed.pts.length - 1];

  // DFS from `initialEnd` back to `targetStart` using other open segments
  const visited = new Set<string>([seed.id]);
  const dfs = (
    cur: THREE.Vector3,
    accPts: THREE.Vector3[],
    usedIds: string[],
  ): { pts: THREE.Vector3[]; ids: string[] } | null => {
    if (accPts.length >= 3 && cur.distanceTo(targetStart) <= tol) {
      return { pts: accPts, ids: usedIds };
    }
    if (usedIds.length > 24) return null;
    for (const seg of segs) {
      if (visited.has(seg.id)) continue;
      const s0 = seg.pts[0];
      const s1 = seg.pts[seg.pts.length - 1];
      if (cur.distanceTo(s0) <= tol) {
        visited.add(seg.id);
        const res = dfs(
          s1,
          [...accPts, ...seg.pts.slice(1)],
          [...usedIds, seg.id],
        );
        if (res) return res;
        visited.delete(seg.id);
      } else if (cur.distanceTo(s1) <= tol) {
        visited.add(seg.id);
        const rev = [...seg.pts].reverse();
        const res = dfs(
          s0,
          [...accPts, ...rev.slice(1)],
          [...usedIds, seg.id],
        );
        if (res) return res;
        visited.delete(seg.id);
      }
    }
    return null;
  };

  const loop = dfs(initialEnd, [...seed.pts], [seed.id]);
  if (!loop || loop.pts.length < 3) return false;

  // Ensure exact closure [p0, p1, ..., p0]
  const closedPts = [...loop.pts];
  if (closedPts[0].distanceTo(closedPts[closedPts.length - 1]) <= tol) {
    closedPts[closedPts.length - 1] = closedPts[0].clone();
  } else {
    closedPts.push(closedPts[0].clone());
  }

  await ctx.deleteEntities(loop.ids);
  const flat = closedPts.map((p) => [p.x, p.y, p.z] as [number, number, number]);
  const closedId = await ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
  if (closedId) {
    await ctx.setSelection([closedId], closedId);
  }
  return true;
}

function makeLineTool(id: "line" | "polyline"): ToolHandler {
  let state = freshState();
  let points: THREE.Vector3[] = [];
  let chainIds: string[] = [];

  const reset = (ctx: ToolContext): void => {
    state = freshState();
    points = [];
    chainIds = [];
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  };

  const draftPreview = (cursor: THREE.Vector3, ctx: ToolContext): void => {
    if (id === "line" && points.length > 0) {
      ctx.setPreview(previewLine([points[points.length - 1], cursor], ctx), "draft");
    } else {
      ctx.setPreview(previewLine([...points, cursor], ctx), "draft");
    }
  };

  const updateLinePreview = (ctx: ToolContext): void => {
    if (points.length === 0) return;
    const from = points[points.length - 1];
    let target = state.lastCursor ?? from;
    const parsed = evalMathExpr(state.typed) ?? (state.typed ? Number.parseFloat(state.typed) : Number.NaN);
    if (Number.isFinite(parsed) && parsed > 0) {
      target = pointAlongDirection(from, state.lastCursor, parsed);
    }
    draftPreview(target, ctx);
    const u = ctx.settings.unitLabel;

    // SolveSpace-style Auto-constraint inference
    const basis = activePlaneBasis(from);
    const delta = target.clone().sub(from);
    const du = delta.dot(basis.u);
    const dv = delta.dot(basis.v);
    const deg = (Math.atan2(dv, du) * 180) / Math.PI;
    const isHoriz = Math.abs(deg) <= 1.5 || Math.abs(Math.abs(deg) - 180) <= 1.5;
    const isVert = Math.abs(Math.abs(deg) - 90) <= 1.5;
    const constraintTag = isHoriz ? " [H]" : isVert ? " [V]" : "";

    const label = state.typed
      ? (Number.isFinite(parsed) && parsed > 0 && String(parsed) !== state.typed.trim()
          ? `L: ${state.typed} = ${formatNum(parsed)} ${u}${constraintTag} [Enter]`
          : `L: ${state.typed}| ${u}${constraintTag} [Enter]`)
      : `L: ${lenLabel(from, target)} ${u}${constraintTag}   ∠ ${angleLabel(from, target)}`;
    ctx.showMeasure(label, state.lastScreen);
  };

  const addSegmentTo = (target: THREE.Vector3, ctx: ToolContext): void => {
    const closeTol = Math.max(1.2, ctx.settings.gridSize * 0.65);

    if (id === "line") {
      const from = points[points.length - 1];
      if (distXZ(from, target) <= 1e-4) return;

      // If this segment closes the current chain of >= 3 points back to points[0],
      // replace the chain's individual lines with a closed extrudable polyline face!
      if (points.length >= 3 && distXZ(target, points[0]) <= closeTol) {
        const closedChain = [...points, points[0].clone()].map(
          (p) => [p.x, p.y, p.z] as [number, number, number],
        );
        const idsToRemove = [...chainIds];
        reset(ctx);
        void (async () => {
          if (idsToRemove.length > 0) await ctx.deleteEntities(idsToRemove);
          const closedId = await ctx.createEntity(
            { type: "polyline_curve", points: closedChain },
            [0, 0, 0],
          );
          if (closedId) await ctx.setSelection([closedId], closedId);
        })();
        return;
      }

      const startPt = from.clone();
      const endPt = target.clone();
      points.push(endPt);
      state = {
        anchor: endPt,
        lastCursor: state.lastCursor,
        lastScreen: state.lastScreen,
        press: null,
        dragged: false,
        typed: "",
      };
      ctx.clearPreview("draft");
      ctx.showMeasure(null);

      void (async () => {
        const lineId = await ctx.createEntity(
          {
            type: "line_curve",
            end: [endPt.x - startPt.x, endPt.y - startPt.y, endPt.z - startPt.z],
          },
          [startPt.x, startPt.y, startPt.z],
        );
        if (lineId) {
          chainIds.push(lineId);
          const merged = await tryMergeClosedLineLoop(ctx, lineId);
          if (merged) {
            reset(ctx);
          }
        }
      })();
      return;
    }

    if (points.length >= 3 && distXZ(target, points[0]) <= closeTol) {
      const flat = [...points, points[0].clone()].map(
        (p) => [p.x, p.y, p.z] as [number, number, number],
      );
      void (async () => {
        const closedId = await ctx.createEntity(
          { type: "polyline_curve", points: flat },
          [0, 0, 0],
        );
        if (closedId) await ctx.setSelection([closedId], closedId);
      })();
      reset(ctx);
      return;
    }
    points.push(target);
    state.anchor = target;
    state.typed = "";
    draftPreview(target, ctx);
  };

  return {
    id,
    cursor: "crosshair",
    onActivate(ctx) {
      reset(ctx);
    },
    onDeactivate(ctx) {
      reset(ctx);
    },
    hasActivity: () => points.length > 0,
    onPointerDown(event, ctx) {
      const raw = sketchPlanePoint(ctx, event, points[0]);
      if (!raw) return true;
      const snapped = snapToSketchVertex(raw, ctx, points);
      if (points.length === 0) {
        state.anchor = snapped;
        state.lastCursor = snapped.clone();
        state.lastScreen = ctx.screenPoint(event);
        points = [snapped];
        chainIds = [];
        state.press = { x: event.clientX, y: event.clientY };
        state.dragged = false;
        state.typed = "";
        ctx.capturePointer(event);
        return true;
      }
      const from = points[points.length - 1];
      let target = ortho(from, snapped, event.shiftKey);
      const parsed = evalMathExpr(state.typed) ?? (state.typed ? Number.parseFloat(state.typed) : Number.NaN);
      if (Number.isFinite(parsed) && parsed > 0) {
        target = pointAlongDirection(from, target, parsed);
      }
      addSegmentTo(target, ctx);
      return true;
    },
    onPointerMove(event, ctx) {
      const raw = sketchPlanePoint(ctx, event, points[0]);
      if (!raw) return;
      const from = points.length > 0 ? points[points.length - 1] : null;
      const cursor = snapToSketchVertex(raw, ctx, points, from);
      state.lastScreen = ctx.screenPoint(event);
      if (state.press && Math.hypot(event.clientX - state.press.x, event.clientY - state.press.y) > 5) {
        state.dragged = true;
      }
      if (points.length === 0) {
        state.lastCursor = cursor;
        const basis = activePlaneBasis();
        const delta = cursor.clone().sub(basis.origin);
        const u = delta.dot(basis.u);
        const v = delta.dot(basis.v);
        const uLabel = ctx.settings.unitLabel;
        ctx.showMeasure(`X: ${formatNum(u)}  Y: ${formatNum(v)} ${uLabel}`, state.lastScreen);
        return;
      }
      state.lastCursor = ortho(from!, cursor, event.shiftKey);
      updateLinePreview(ctx);
    },
    onPointerUp(event, ctx) {
      if (points.length === 0 || !state.dragged) {
        state.press = null;
        state.dragged = false;
        ctx.releasePointer(event);
        return;
      }
      const raw = sketchPlanePoint(ctx, event, points[0]);
      if (!raw) {
        state.press = null;
        state.dragged = false;
        ctx.releasePointer(event);
        return;
      }
      const from = points[points.length - 1];
      let target = ortho(from, snapToSketchVertex(raw, ctx, points, from), event.shiftKey);
      const parsed = evalMathExpr(state.typed) ?? (state.typed ? Number.parseFloat(state.typed) : Number.NaN);
      if (Number.isFinite(parsed) && parsed > 0) {
        target = pointAlongDirection(from, target, parsed);
      }
      const isSingleLineDrag = id === "line" && points.length === 1;
      state.press = null;
      state.dragged = false;
      addSegmentTo(target, ctx);
      ctx.releasePointer(event);
      if (isSingleLineDrag) {
        reset(ctx);
        ctx.setStatus("Line created - drag or click to draw next");
      }
    },
    onKey(event, ctx) {
      if (points.length === 0) return false;
      if (/^[0-9.+\-*/\s()]$/.test(event.key)) {
        state.typed += event.key;
        updateLinePreview(ctx);
        return true;
      }
      return false;
    },
    onEnter(ctx) {
      if (points.length > 0 && state.typed) {
        const parsed = evalMathExpr(state.typed) ?? Number.parseFloat(state.typed);
        if (Number.isFinite(parsed) && parsed > 0) {
          const from = points[points.length - 1];
          const target = pointAlongDirection(from, state.lastCursor, parsed);
          addSegmentTo(target, ctx);
          return true;
        }
      }
      if (id === "polyline" && points.length >= 2) {
        const flat = points.map((p) => [p.x, p.y, p.z] as [number, number, number]);
        reset(ctx);
        void (async () => {
          const polyId = await ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
          if (polyId) {
            await tryMergeClosedLineLoop(ctx, polyId);
          }
        })();
        return true;
      }
      if (id === "line" && points.length > 0) {
        reset(ctx);
        ctx.setStatus("Line chain finished");
        return true;
      }
      return false;
    },
    onCancel(ctx) {
      if (points.length > 0) {
        reset(ctx);
        ctx.setStatus("Draft cancelled - click to start again");
      }
    },
    onBackspace(ctx) {
      if (state.typed.length > 0) {
        state.typed = state.typed.slice(0, -1);
        updateLinePreview(ctx);
        return;
      }
      if (points.length > 1) {
        points.pop();
        state.anchor = points[points.length - 1];
        ctx.setPreview(previewLine(points, ctx), "draft");
      } else if (points.length === 1) {
        reset(ctx);
      }
    },
    hint: () =>
      id === "line"
        ? "Line - click start, then endpoint (or type length + Enter) - Shift constrains axis"
        : "Polyline - click points (or type length + Enter) - click first point to close - Enter finishes",
  };
}

export const lineTool = makeLineTool("line");
export const polylineTool = makeLineTool("polyline");

// ----------------------------------------------------------------- rectangle

let rect = freshState();

function rectCorners(a: THREE.Vector3, e: THREE.Vector3, basis: PlaneBasis): THREE.Vector3[] {
  const delta = e.clone().sub(a);
  const du = delta.dot(basis.u);
  const dv = delta.dot(basis.v);
  return [
    a.clone(),
    a.clone().addScaledVector(basis.u, du),
    a.clone().addScaledVector(basis.u, du).addScaledVector(basis.v, dv),
    a.clone().addScaledVector(basis.v, dv),
  ];
}

function squareEnd(a: THREE.Vector3, cursor: THREE.Vector3, basis: PlaneBasis): THREE.Vector3 {
  const delta = cursor.clone().sub(a);
  const du = delta.dot(basis.u);
  const dv = delta.dot(basis.v);
  const s = Math.max(Math.abs(du), Math.abs(dv));
  return a
    .clone()
    .addScaledVector(basis.u, Math.sign(du || 1) * s)
    .addScaledVector(basis.v, Math.sign(dv || 1) * s);
}

function rectTypedEnd(
  a: THREE.Vector3,
  cursor: THREE.Vector3 | null,
  typed: string,
  basis: PlaneBasis,
): THREE.Vector3 | null {
  const parts = typed
    .trim()
    .split(/[\s,x×]+/i)
    .map((s) => evalMathExpr(s) ?? Number.parseFloat(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return null;
  const w = parts[0];
  const d = parts[1] ?? parts[0];
  const delta = cursor ? cursor.clone().sub(a) : new THREE.Vector3();
  const su = delta.dot(basis.u) < 0 ? -1 : 1;
  const sv = delta.dot(basis.v) < 0 ? -1 : 1;
  return a
    .clone()
    .addScaledVector(basis.u, su * w)
    .addScaledVector(basis.v, sv * d);
}

function resetRect(ctx: ToolContext): void {
  rect = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function snappedRectEnd(
  a: THREE.Vector3,
  cursor: THREE.Vector3,
  square: boolean,
  ctx: ToolContext,
  basis: PlaneBasis,
): THREE.Vector3 {
  const raw = square ? squareEnd(a, cursor, basis) : cursor;
  const delta = raw.clone().sub(a);
  const du = delta.dot(basis.u);
  const dv = delta.dot(basis.v);
  const w = Math.max(0.5, ctx.snapDim(Math.abs(du)));
  const d = square ? w : Math.max(0.5, ctx.snapDim(Math.abs(dv)));
  const su = du < 0 ? -1 : 1;
  const sv = dv < 0 ? -1 : 1;
  return a
    .clone()
    .addScaledVector(basis.u, su * w)
    .addScaledVector(basis.v, sv * d);
}

function updateRectPreview(ctx: ToolContext, shift = false): void {
  if (!rect.anchor) return;
  const basis = activePlaneBasis(rect.anchor);
  const cursor = rect.lastCursor ?? rect.anchor;
  const e =
    (rect.typed ? rectTypedEnd(rect.anchor, cursor, rect.typed, basis) : null) ??
    snappedRectEnd(rect.anchor, cursor, shift, ctx, basis);
  ctx.setPreview(previewLine(rectCorners(rect.anchor, e, basis), ctx, true), "draft");
  const delta = e.clone().sub(rect.anchor);
  const w = formatNum(Math.abs(delta.dot(basis.u)));
  const d = formatNum(Math.abs(delta.dot(basis.v)));
  const u = ctx.settings.unitLabel;
  ctx.showMeasure(rect.typed ? `${w} × ${d} ${u} [${rect.typed}|]` : `${w} × ${d} ${u}`, rect.lastScreen);
}

function commitRect(ctx: ToolContext, endRaw: THREE.Vector3, square: boolean): void {
  const a = rect.anchor!;
  const basis = activePlaneBasis(a);
  const e =
    (rect.typed ? rectTypedEnd(a, endRaw, rect.typed, basis) : null) ??
    snappedRectEnd(a, endRaw, square, ctx, basis);
  const delta = e.clone().sub(a);
  const du = delta.dot(basis.u);
  const dv = delta.dot(basis.v);
  const w = Math.abs(du);
  const d = Math.abs(dv);
  if (w > 1e-3 && d > 1e-3) {
    const center = a
      .clone()
      .addScaledVector(basis.u, du / 2)
      .addScaledVector(basis.v, dv / 2);
    void createSketchEntity(
      ctx,
      { type: "rectangle_curve", width: w, depth: d },
      [center.x, center.y, center.z],
      basis,
    );
    ctx.setStatus("Rectangle created");
  }
  resetRect(ctx);
}

export const rectangleTool: ToolHandler = {
  id: "rectangle",
  cursor: "crosshair",
  onActivate(ctx) {
    resetRect(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetRect,
  hasActivity: () => rect.anchor !== null,
  onPointerDown(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, rect.anchor);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (!rect.anchor) {
      rect.anchor = snapped;
      rect.lastCursor = snapped.clone();
      rect.lastScreen = ctx.screenPoint(event);
      rect.press = { x: event.clientX, y: event.clientY };
      ctx.capturePointer(event);
      return true;
    }
    commitRect(ctx, snapped, event.shiftKey);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, rect.anchor);
    if (!raw) return;
    if (rect.press && Math.hypot(event.clientX - rect.press.x, event.clientY - rect.press.y) > 5) {
      rect.dragged = true;
    }
    rect.lastCursor = ctx.snap(raw, { anchor: rect.anchor }).point;
    rect.lastScreen = ctx.screenPoint(event);
    if (!rect.anchor) {
      const basis = activePlaneBasis();
      const delta = rect.lastCursor.clone().sub(basis.origin);
      ctx.showMeasure(`X: ${formatNum(delta.dot(basis.u))}  Y: ${formatNum(delta.dot(basis.v))} ${ctx.settings.unitLabel}`, rect.lastScreen);
      return;
    }
    updateRectPreview(ctx, event.shiftKey);
  },
  onPointerUp(event, ctx) {
    if (!rect.anchor) return;
    if (!rect.dragged) {
      rect.press = null;
      ctx.releasePointer(event);
      return;
    }
    const raw = sketchPlanePoint(ctx, event, rect.anchor);
    if (raw) commitRect(ctx, ctx.snap(raw, { anchor: rect.anchor }).point, event.shiftKey);
    ctx.releasePointer(event);
  },
  onKey(event, ctx) {
    if (!rect.anchor) return false;
    if (/^[0-9.+\-*/\s()]$/.test(event.key)) {
      rect.typed += event.key;
      updateRectPreview(ctx, event.shiftKey);
      return true;
    }
    if (event.key === "," || event.key === "Tab") {
      event.preventDefault();
      if (!rect.typed.includes(",")) rect.typed += ",";
      updateRectPreview(ctx, event.shiftKey);
      return true;
    }
    return false;
  },
  onBackspace(ctx) {
    if (rect.anchor && rect.typed.length > 0) {
      rect.typed = rect.typed.slice(0, -1);
      updateRectPreview(ctx);
    }
  },
  onEnter(ctx) {
    if (!rect.anchor) return false;
    const end = rect.lastCursor ?? rect.anchor;
    commitRect(ctx, end, false);
    return true;
  },
  onCancel: resetRect,
  hint: () => "Rectangle - drag or click two corners (or type W,D + Enter) - Shift for square",
};

// -------------------------------------------------------------------- circle

let circ = freshState();

function resetCircle(ctx: ToolContext): void {
  circ = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function circleRadius(c: THREE.Vector3, edge: THREE.Vector3 | null, typed: string, ctx: ToolContext): number {
  const parsed = evalMathExpr(typed) ?? (typed ? Number.parseFloat(typed) : Number.NaN);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  if (!edge) return 0;
  return Math.max(0.5, ctx.snapDim(distXZ(c, edge)));
}

function updateCirclePreview(ctx: ToolContext): void {
  if (!circ.anchor) return;
  const r = circleRadius(circ.anchor, circ.lastCursor, circ.typed, ctx);
  ctx.setPreview(previewRing(circ.anchor, r, ctx), "draft");
  const u = ctx.settings.unitLabel;
  ctx.showMeasure(
    circ.typed
      ? `R ${circ.typed}| ${u}`
      : `R: ${formatNum(r)} ${u}   Dia: ${formatNum(r * 2)} ${u}`,
    circ.lastScreen,
  );
}

function commitCircle(ctx: ToolContext, edge: THREE.Vector3 | null): void {
  const c = circ.anchor!;
  const basis = activePlaneBasis(c);
  const r = circleRadius(c, edge, circ.typed, ctx);
  if (r > 1e-3) {
    void createSketchEntity(
      ctx,
      { type: "circle_curve", radius: r, segments: 64 },
      [c.x, c.y, c.z],
      basis,
    );
    ctx.setStatus("Circle created");
  }
  resetCircle(ctx);
}

export const circleTool: ToolHandler = {
  id: "circle",
  cursor: "crosshair",
  onActivate(ctx) {
    resetCircle(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetCircle,
  hasActivity: () => circ.anchor !== null,
  onPointerDown(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, circ.anchor);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (!circ.anchor) {
      circ.anchor = snapped;
      circ.lastCursor = snapped.clone();
      circ.lastScreen = ctx.screenPoint(event);
      circ.press = { x: event.clientX, y: event.clientY };
      ctx.capturePointer(event);
      return true;
    }
    commitCircle(ctx, snapped);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, circ.anchor);
    if (!raw) return;
    if (circ.press && Math.hypot(event.clientX - circ.press.x, event.clientY - circ.press.y) > 5) {
      circ.dragged = true;
    }
    circ.lastCursor = ctx.snap(raw, { anchor: circ.anchor }).point;
    circ.lastScreen = ctx.screenPoint(event);
    if (!circ.anchor) {
      const basis = activePlaneBasis();
      const delta = circ.lastCursor.clone().sub(basis.origin);
      ctx.showMeasure(`Center X: ${formatNum(delta.dot(basis.u))}  Y: ${formatNum(delta.dot(basis.v))} ${ctx.settings.unitLabel}`, circ.lastScreen);
      return;
    }
    updateCirclePreview(ctx);
  },
  onPointerUp(event, ctx) {
    if (!circ.anchor) return;
    if (!circ.dragged) {
      circ.press = null;
      ctx.releasePointer(event);
      return;
    }
    const raw = sketchPlanePoint(ctx, event, circ.anchor);
    if (raw) commitCircle(ctx, ctx.snap(raw, { anchor: circ.anchor }).point);
    ctx.releasePointer(event);
  },
  onKey(event, ctx) {
    if (!circ.anchor) return false;
    if (/^[0-9.+\-*/\s()]$/.test(event.key)) {
      circ.typed += event.key;
      updateCirclePreview(ctx);
      return true;
    }
    return false;
  },
  onBackspace(ctx) {
    if (circ.anchor && circ.typed.length > 0) {
      circ.typed = circ.typed.slice(0, -1);
      updateCirclePreview(ctx);
    }
  },
  onEnter(ctx) {
    if (!circ.anchor) return false;
    commitCircle(ctx, circ.lastCursor);
    return true;
  },
  onCancel: resetCircle,
  hint: () => "Circle - drag or click center, then radius (or type R + Enter)",
};

// ----------------------------------------------------------------------- arc

let arc: { points: THREE.Vector3[] } = { points: [] };

function resetArc(ctx: ToolContext): void {
  arc = { points: [] };
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function projectToBasis2D(pt: THREE.Vector3, ref: THREE.Vector3, basis: PlaneBasis): THREE.Vector3 {
  const d = pt.clone().sub(ref);
  return new THREE.Vector3(d.dot(basis.u), 0, d.dot(basis.v));
}

export const arcTool: ToolHandler = {
  id: "arc",
  cursor: "crosshair",
  onActivate(ctx) {
    resetArc(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetArc,
  hasActivity: () => arc.points.length > 0,
  onPointerDown(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, arc.points[0]);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    arc.points.push(snapped);
    if (arc.points.length < 3) {
      ctx.setStatus(arc.points.length === 1 ? "Arc - click endpoint" : "Arc - click to set the bulge");
      return true;
    }
    const [start, end, mid] = arc.points;
    const basis = activePlaneBasis(start);
    const s2 = projectToBasis2D(start, start, basis);
    const m2 = projectToBasis2D(mid, start, basis);
    const e2 = projectToBasis2D(end, start, basis);
    const fit = arcThrough3(s2, m2, e2);
    if (fit) {
      const center3D = start
        .clone()
        .addScaledVector(basis.u, fit.center.x)
        .addScaledVector(basis.v, fit.center.z);
      void createSketchEntity(
        ctx,
        {
          type: "arc_curve",
          radius: fit.radius,
          start_angle_deg: fit.startAngle,
          end_angle_deg: fit.endAngle,
          segments: 64,
        },
        [center3D.x, center3D.y, center3D.z],
        basis,
      );
      ctx.setStatus("Arc created");
    } else {
      ctx.setStatus("Arc points are collinear - try again");
    }
    resetArc(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, arc.points[0]);
    if (!raw || arc.points.length === 0) return;
    const cursor = ctx.snap(raw).point;
    if (arc.points.length === 1) {
      ctx.setPreview(previewLine([arc.points[0], cursor], ctx), "draft");
      ctx.showMeasure(lenLabel(arc.points[0], cursor), ctx.screenPoint(event));
      return;
    }
    const [start, end] = arc.points;
    const basis = activePlaneBasis(start);
    const s2 = projectToBasis2D(start, start, basis);
    const c2 = projectToBasis2D(cursor, start, basis);
    const e2 = projectToBasis2D(end, start, basis);
    const fit = arcThrough3(s2, c2, e2);
    if (!fit) {
      ctx.setPreview(previewLine([start, end], ctx), "draft");
      return;
    }
    const center3D = start
      .clone()
      .addScaledVector(basis.u, fit.center.x)
      .addScaledVector(basis.v, fit.center.z);
    const pts: THREE.Vector3[] = [];
    const segs = Math.max(8, Math.min(96, Math.abs(Math.round(fit.endAngle - fit.startAngle))));
    for (let i = 0; i <= segs; i++) {
      const a = ((fit.startAngle + ((fit.endAngle - fit.startAngle) * i) / segs) * Math.PI) / 180;
      pts.push(
        center3D
          .clone()
          .addScaledVector(basis.u, fit.radius * Math.cos(a))
          .addScaledVector(basis.v, fit.radius * Math.sin(a)),
      );
    }
    ctx.setPreview(previewLine(pts, ctx), "draft");
    ctx.showMeasure(`R ${formatNum(fit.radius)}`, ctx.screenPoint(event));
  },
  onCancel(ctx) {
    if (arc.points.length > 0) {
      arc.points.pop();
      if (arc.points.length === 0) ctx.clearPreview("draft");
    }
  },
  hint: () => "Arc - click start, endpoint, then bulge",
};

// ------------------------------------------------------------------- polygon

export function getPolygonSides(): number {
  return useArcStore.getState().polygonSides ?? 6;
}

export function setPolygonSides(n: number): void {
  useArcStore.getState().setPolygonSides(n);
}

let poly = freshState();

function resetPoly(ctx: ToolContext): void {
  poly = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function updatePolyPreview(ctx: ToolContext): void {
  if (!poly.anchor) return;
  const basis = activePlaneBasis(poly.anchor);
  const sides = getPolygonSides();
  const r = circleRadius(poly.anchor, poly.lastCursor, poly.typed, ctx);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides;
    pts.push(
      poly.anchor
        .clone()
        .addScaledVector(basis.u, r * Math.cos(a))
        .addScaledVector(basis.v, r * Math.sin(a)),
    );
  }
  ctx.setPreview(previewLine(pts, ctx, true), "draft");
  const u = ctx.settings.unitLabel;
  ctx.showMeasure(
    poly.typed ? `R ${poly.typed}| ${u} - ${sides} sides` : `R ${formatNum(r)} ${u} - ${sides} sides`,
    poly.lastScreen,
  );
}

function commitPolygon(ctx: ToolContext, vertex: THREE.Vector3 | null): void {
  const c = poly.anchor!;
  const basis = activePlaneBasis(c);
  const sides = getPolygonSides();
  const r = circleRadius(c, vertex, poly.typed, ctx);
  if (r > 1e-3) {
    void createSketchEntity(
      ctx,
      { type: "polygon_curve", radius: r, sides },
      [c.x, c.y, c.z],
      basis,
    );
    ctx.setStatus(`Polygon (${sides}-gon) created`);
  }
  resetPoly(ctx);
}

export const polygonTool: ToolHandler = {
  id: "polygon",
  cursor: "crosshair",
  onActivate(ctx) {
    resetPoly(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetPoly,
  hasActivity: () => poly.anchor !== null,
  onPointerDown(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, poly.anchor);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (!poly.anchor) {
      poly.anchor = snapped;
      poly.lastCursor = snapped.clone();
      poly.lastScreen = ctx.screenPoint(event);
      poly.press = { x: event.clientX, y: event.clientY };
      ctx.capturePointer(event);
      return true;
    }
    commitPolygon(ctx, snapped);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, poly.anchor);
    if (!raw) return;
    if (poly.press && Math.hypot(event.clientX - poly.press.x, event.clientY - poly.press.y) > 5) {
      poly.dragged = true;
    }
    poly.lastCursor = ctx.snap(raw).point;
    poly.lastScreen = ctx.screenPoint(event);
    if (!poly.anchor) {
      const basis = activePlaneBasis();
      const delta = poly.lastCursor.clone().sub(basis.origin);
      ctx.showMeasure(`Center X: ${formatNum(delta.dot(basis.u))}  Y: ${formatNum(delta.dot(basis.v))} ${ctx.settings.unitLabel}`, poly.lastScreen);
      return;
    }
    updatePolyPreview(ctx);
  },
  onPointerUp(event, ctx) {
    if (!poly.anchor) return;
    if (!poly.dragged) {
      poly.press = null;
      ctx.releasePointer(event);
      return;
    }
    const raw = sketchPlanePoint(ctx, event, poly.anchor);
    if (raw) commitPolygon(ctx, ctx.snap(raw).point);
    ctx.releasePointer(event);
  },
  onKey(event, ctx) {
    if (event.key === "[" || event.key === "-") {
      setPolygonSides(getPolygonSides() - 1);
      ctx.setStatus(`Polygon - ${getPolygonSides()} sides`);
      updatePolyPreview(ctx);
      return true;
    }
    if (event.key === "]" || event.key === "=" || event.key === "+") {
      setPolygonSides(getPolygonSides() + 1);
      ctx.setStatus(`Polygon - ${getPolygonSides()} sides`);
      updatePolyPreview(ctx);
      return true;
    }
    if (!poly.anchor) return false;
    if (/^[0-9.+\-*/\s()]$/.test(event.key)) {
      poly.typed += event.key;
      updatePolyPreview(ctx);
      return true;
    }
    return false;
  },
  onBackspace(ctx) {
    if (poly.anchor && poly.typed.length > 0) {
      poly.typed = poly.typed.slice(0, -1);
      updatePolyPreview(ctx);
    }
  },
  onEnter(ctx) {
    if (!poly.anchor) return false;
    commitPolygon(ctx, poly.lastCursor);
    return true;
  },
  onCancel: resetPoly,
  hint: () => `Polygon (${getPolygonSides()} sides, [ / ] changes sides) - click center, then radius (or type R + Enter)`,
};
