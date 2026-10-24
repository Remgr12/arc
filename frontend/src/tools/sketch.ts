import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { arcThrough3 } from "./geometry2d";
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

function activePlaneY(): number {
  return useArcStore.getState().sketchPlaneHeight ?? 0;
}

function sketchPlanePoint(
  ctx: ToolContext,
  event: PointerEvent | MouseEvent,
  overrideY?: number,
): THREE.Vector3 | null {
  const y = overrideY ?? activePlaneY();
  return ctx.planePoint(event, y);
}

/** Constrain `p` to the dominant axis of `from` when shift is held. */
function ortho(from: THREE.Vector3, p: THREE.Vector3, shift: boolean): THREE.Vector3 {
  if (!shift) return p;
  const dx = Math.abs(p.x - from.x);
  const dz = Math.abs(p.z - from.z);
  if (dx >= dz) return new THREE.Vector3(p.x, from.y, from.z);
  return new THREE.Vector3(from.x, from.y, p.z);
}

function pointAlongDirection(
  from: THREE.Vector3,
  cursor: THREE.Vector3 | null,
  length: number,
): THREE.Vector3 {
  if (!cursor) return new THREE.Vector3(from.x + length, from.y, from.z);
  const dx = cursor.x - from.x;
  const dz = cursor.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-6) return new THREE.Vector3(from.x + length, from.y, from.z);
  return new THREE.Vector3(
    from.x + (dx / dist) * length,
    from.y,
    from.z + (dz / dist) * length,
  );
}

function formatNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function lenLabel(a: THREE.Vector3, b: THREE.Vector3): string {
  return formatNum(distXZ(a, b));
}

function angleLabel(a: THREE.Vector3, b: THREE.Vector3): string {
  const deg = (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI;
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
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    pts.push(new THREE.Vector3(center.x + radius * Math.cos(a), center.y, center.z + radius * Math.sin(a)));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(pts);
  const loop = new THREE.LineLoop(geometry, previewLineMaterial(ctx));
  loop.renderOrder = 998;
  loop.frustumCulled = false;
  return loop;
}

// ---------------------------------------------------------------------- line

function makeLineTool(id: "line" | "polyline"): ToolHandler {
  let state = freshState();
  let points: THREE.Vector3[] = [];

  const reset = (ctx: ToolContext): void => {
    state = freshState();
    points = [];
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  };

  const draftPreview = (cursor: THREE.Vector3, ctx: ToolContext): void => {
    ctx.setPreview(previewLine([...points, cursor], ctx), "draft");
  };

  const updateLinePreview = (ctx: ToolContext): void => {
    if (points.length === 0) return;
    const from = points[points.length - 1];
    let target = state.lastCursor ?? from;
    const parsed = state.typed ? Number.parseFloat(state.typed) : Number.NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      target = pointAlongDirection(from, state.lastCursor, parsed);
    }
    draftPreview(target, ctx);
    const label = state.typed
      ? `L ${state.typed}| · ${angleLabel(from, target)}`
      : `${lenLabel(from, target)} · ${angleLabel(from, target)}`;
    ctx.showMeasure(label, state.lastScreen);
  };

  const addSegmentTo = (target: THREE.Vector3, ctx: ToolContext): void => {
    if (id === "line") {
      const [a] = points;
      if (distXZ(a, target) > 1e-4) {
        void ctx.createEntity(
          { type: "line_curve", end: [target.x - a.x, target.y - a.y, target.z - a.z] },
          [a.x, a.y, a.z],
        );
        ctx.setStatus("Line created · continue from endpoint (Enter or Esc finishes chain)");
      }
      points = [target];
      state = {
        anchor: target,
        lastCursor: state.lastCursor,
        lastScreen: state.lastScreen,
        press: null,
        dragged: false,
        typed: "",
      };
      ctx.clearPreview("draft");
      ctx.showMeasure(null);
      return;
    }
    if (points.length >= 3 && distXZ(target, points[0]) < ctx.settings.gridSize * 0.6) {
      const flat = [...points, points[0].clone()].map(
        (p) => [p.x, p.y, p.z] as [number, number, number],
      );
      void ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
      ctx.setStatus("Closed polyline created");
      reset(ctx);
      return;
    }
    points.push(target);
    state.anchor = target;
    state.typed = "";
    draftPreview(target, ctx);
    ctx.setStatus("Click to add points (or type length + Enter) · Enter finishes · Esc cancels");
  };

  return {
    id,
    cursor: "crosshair",
    onActivate(ctx) {
      reset(ctx);
      ctx.setStatus(this.hint!(ctx));
    },
    onDeactivate(ctx) {
      reset(ctx);
    },
    hasActivity: () => points.length > 0,
    onPointerDown(event, ctx) {
      const raw = sketchPlanePoint(ctx, event, points[0]?.y);
      if (!raw) return true;
      const snapped = ctx.snap(raw).point;
      if (points.length === 0) {
        state.anchor = snapped;
        state.lastCursor = snapped.clone();
        state.lastScreen = ctx.screenPoint(event);
        points = [snapped];
        state.press = { x: event.clientX, y: event.clientY };
        state.dragged = false;
        state.typed = "";
        ctx.capturePointer(event);
        return true;
      }
      const from = points[points.length - 1];
      let target = ortho(from, snapped, event.shiftKey);
      const parsed = state.typed ? Number.parseFloat(state.typed) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        target = pointAlongDirection(from, target, parsed);
      }
      addSegmentTo(target, ctx);
      return true;
    },
    onPointerMove(event, ctx) {
      const raw = sketchPlanePoint(ctx, event, points[0]?.y);
      if (!raw) return;
      const cursor = ctx.snap(raw).point;
      state.lastScreen = ctx.screenPoint(event);
      if (state.press && Math.hypot(event.clientX - state.press.x, event.clientY - state.press.y) > 5) {
        state.dragged = true;
      }
      if (points.length === 0) {
        state.lastCursor = cursor;
        ctx.showMeasure(null);
        return;
      }
      const from = points[points.length - 1];
      state.lastCursor = ortho(from, cursor, event.shiftKey);
      updateLinePreview(ctx);
    },
    onPointerUp(event, ctx) {
      if (points.length === 0 || !state.dragged) {
        state.press = null;
        state.dragged = false;
        ctx.releasePointer(event);
        return;
      }
      const raw = sketchPlanePoint(ctx, event, points[0]?.y);
      if (!raw) {
        state.press = null;
        state.dragged = false;
        ctx.releasePointer(event);
        return;
      }
      const from = points[points.length - 1];
      let target = ortho(from, ctx.snap(raw).point, event.shiftKey);
      const parsed = state.typed ? Number.parseFloat(state.typed) : Number.NaN;
      if (Number.isFinite(parsed) && parsed > 0) {
        target = pointAlongDirection(from, target, parsed);
      }
      state.press = null;
      state.dragged = false;
      addSegmentTo(target, ctx);
      ctx.releasePointer(event);
    },
    onKey(event, ctx) {
      if (points.length === 0) return false;
      if (/^[0-9.]$/.test(event.key)) {
        state.typed += event.key;
        updateLinePreview(ctx);
        return true;
      }
      return false;
    },
    onEnter(ctx) {
      if (points.length > 0 && state.typed) {
        const parsed = Number.parseFloat(state.typed);
        if (Number.isFinite(parsed) && parsed > 0) {
          const from = points[points.length - 1];
          const target = pointAlongDirection(from, state.lastCursor, parsed);
          addSegmentTo(target, ctx);
          return true;
        }
      }
      if (id === "polyline" && points.length >= 2) {
        const flat = points.map((p) => [p.x, p.y, p.z] as [number, number, number]);
        void ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
        ctx.setStatus("Polyline created");
        reset(ctx);
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
        ctx.setStatus("Draft cancelled · click to start again");
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
        ? "Line · click start, then endpoint (or type length + Enter) · Shift constrains axis"
        : "Polyline · click points (or type length + Enter) · click first point to close · Enter finishes",
  };
}

export const lineTool = makeLineTool("line");
export const polylineTool = makeLineTool("polyline");

// ----------------------------------------------------------------- rectangle

let rect = freshState();

function rectCorners(a: THREE.Vector3, e: THREE.Vector3): THREE.Vector3[] {
  return [
    new THREE.Vector3(Math.min(a.x, e.x), a.y, Math.min(a.z, e.z)),
    new THREE.Vector3(Math.max(a.x, e.x), a.y, Math.min(a.z, e.z)),
    new THREE.Vector3(Math.max(a.x, e.x), a.y, Math.max(a.z, e.z)),
    new THREE.Vector3(Math.min(a.x, e.x), a.y, Math.max(a.z, e.z)),
  ];
}

function squareEnd(a: THREE.Vector3, cursor: THREE.Vector3): THREE.Vector3 {
  const dx = cursor.x - a.x;
  const dz = cursor.z - a.z;
  const s = Math.max(Math.abs(dx), Math.abs(dz));
  return new THREE.Vector3(a.x + Math.sign(dx || 1) * s, a.y, a.z + Math.sign(dz || 1) * s);
}

function rectTypedEnd(a: THREE.Vector3, cursor: THREE.Vector3 | null, typed: string): THREE.Vector3 | null {
  const parts = typed
    .trim()
    .split(/[\s,x×]+/i)
    .map((s) => Number.parseFloat(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return null;
  const w = parts[0];
  const d = parts[1] ?? parts[0];
  const sx = cursor && cursor.x < a.x ? -1 : 1;
  const sz = cursor && cursor.z < a.z ? -1 : 1;
  return new THREE.Vector3(a.x + sx * w, a.y, a.z + sz * d);
}

function resetRect(ctx: ToolContext): void {
  rect = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function updateRectPreview(ctx: ToolContext, shift = false): void {
  if (!rect.anchor) return;
  const cursor = rect.lastCursor ?? rect.anchor;
  const e =
    (rect.typed ? rectTypedEnd(rect.anchor, cursor, rect.typed) : null) ??
    (shift ? squareEnd(rect.anchor, cursor) : cursor);
  ctx.setPreview(previewLine(rectCorners(rect.anchor, e), ctx, true), "draft");
  const w = formatNum(Math.abs(e.x - rect.anchor.x));
  const d = formatNum(Math.abs(e.z - rect.anchor.z));
  ctx.showMeasure(rect.typed ? `${w} × ${d} [${rect.typed}|]` : `${w} × ${d}`, rect.lastScreen);
}

function commitRect(ctx: ToolContext, endRaw: THREE.Vector3, square: boolean): void {
  const a = rect.anchor!;
  const e =
    (rect.typed ? rectTypedEnd(a, endRaw, rect.typed) : null) ??
    (square ? squareEnd(a, endRaw) : endRaw);
  const w = Math.abs(e.x - a.x);
  const d = Math.abs(e.z - a.z);
  if (w > 1e-3 && d > 1e-3) {
    void ctx.createEntity(
      { type: "rectangle_curve", width: w, depth: d },
      [(a.x + e.x) / 2, a.y, (a.z + e.z) / 2],
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
    const raw = sketchPlanePoint(ctx, event, rect.anchor?.y);
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
    const raw = sketchPlanePoint(ctx, event, rect.anchor?.y);
    if (!raw) return;
    if (rect.press && Math.hypot(event.clientX - rect.press.x, event.clientY - rect.press.y) > 5) {
      rect.dragged = true;
    }
    rect.lastCursor = ctx.snap(raw).point;
    rect.lastScreen = ctx.screenPoint(event);
    if (!rect.anchor) {
      ctx.showMeasure(null);
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
    const raw = sketchPlanePoint(ctx, event, rect.anchor.y);
    if (raw) commitRect(ctx, ctx.snap(raw).point, event.shiftKey);
    ctx.releasePointer(event);
  },
  onKey(event, ctx) {
    if (!rect.anchor) return false;
    if (/^[0-9.]$/.test(event.key)) {
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
  hint: () => "Rectangle · drag or click two corners (or type W,D + Enter) · Shift for square",
};

// -------------------------------------------------------------------- circle

let circ = freshState();

function resetCircle(ctx: ToolContext): void {
  circ = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function circleRadius(c: THREE.Vector3, edge: THREE.Vector3 | null, typed: string): number {
  const parsed = typed ? Number.parseFloat(typed) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return edge ? distXZ(c, edge) : 0;
}

function updateCirclePreview(ctx: ToolContext): void {
  if (!circ.anchor) return;
  const r = circleRadius(circ.anchor, circ.lastCursor, circ.typed);
  ctx.setPreview(previewRing(circ.anchor, r, ctx), "draft");
  ctx.showMeasure(
    circ.typed ? `R ${circ.typed}|` : `R ${formatNum(r)}`,
    circ.lastScreen,
  );
}

function commitCircle(ctx: ToolContext, edge: THREE.Vector3 | null): void {
  const c = circ.anchor!;
  const r = circleRadius(c, edge, circ.typed);
  if (r > 1e-3) {
    void ctx.createEntity({ type: "circle_curve", radius: r, segments: 64 }, [c.x, c.y, c.z]);
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
    const raw = sketchPlanePoint(ctx, event, circ.anchor?.y);
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
    const raw = sketchPlanePoint(ctx, event, circ.anchor?.y);
    if (!raw) return;
    if (circ.press && Math.hypot(event.clientX - circ.press.x, event.clientY - circ.press.y) > 5) {
      circ.dragged = true;
    }
    circ.lastCursor = ctx.snap(raw).point;
    circ.lastScreen = ctx.screenPoint(event);
    if (!circ.anchor) {
      ctx.showMeasure(null);
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
    const raw = sketchPlanePoint(ctx, event, circ.anchor.y);
    if (raw) commitCircle(ctx, ctx.snap(raw).point);
    ctx.releasePointer(event);
  },
  onKey(event, ctx) {
    if (!circ.anchor) return false;
    if (/^[0-9.]$/.test(event.key)) {
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
  hint: () => "Circle · drag or click center, then radius (or type R + Enter)",
};

// ----------------------------------------------------------------------- arc

let arc: { points: THREE.Vector3[] } = { points: [] };

function resetArc(ctx: ToolContext): void {
  arc = { points: [] };
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
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
    const raw = sketchPlanePoint(ctx, event, arc.points[0]?.y);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    arc.points.push(snapped);
    if (arc.points.length < 3) {
      ctx.setStatus(arc.points.length === 1 ? "Arc · click endpoint" : "Arc · click to set the bulge");
      return true;
    }
    const [start, end, mid] = arc.points;
    const fit = arcThrough3(start, mid, end);
    if (fit) {
      void ctx.createEntity(
        {
          type: "arc_curve",
          radius: fit.radius,
          start_angle_deg: fit.startAngle,
          end_angle_deg: fit.endAngle,
          segments: 64,
        },
        [fit.center.x, start.y, fit.center.z],
      );
      ctx.setStatus("Arc created");
    } else {
      ctx.setStatus("Arc points are collinear · try again");
    }
    resetArc(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = sketchPlanePoint(ctx, event, arc.points[0]?.y);
    if (!raw || arc.points.length === 0) return;
    const cursor = ctx.snap(raw).point;
    if (arc.points.length === 1) {
      ctx.setPreview(previewLine([arc.points[0], cursor], ctx), "draft");
      ctx.showMeasure(lenLabel(arc.points[0], cursor), ctx.screenPoint(event));
      return;
    }
    const [start, end] = arc.points;
    const fit = arcThrough3(start, cursor, end);
    if (!fit) {
      ctx.setPreview(previewLine([start, end], ctx), "draft");
      return;
    }
    const pts: THREE.Vector3[] = [];
    const segs = Math.max(8, Math.min(96, Math.abs(Math.round(fit.endAngle - fit.startAngle))));
    for (let i = 0; i <= segs; i++) {
      const a = ((fit.startAngle + ((fit.endAngle - fit.startAngle) * i) / segs) * Math.PI) / 180;
      pts.push(
        new THREE.Vector3(fit.center.x + fit.radius * Math.cos(a), start.y, fit.center.z + fit.radius * Math.sin(a)),
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
  hint: () => "Arc · click start, endpoint, then bulge",
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
  const sides = getPolygonSides();
  const r = circleRadius(poly.anchor, poly.lastCursor, poly.typed);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (Math.PI * 2 * i) / sides;
    pts.push(
      new THREE.Vector3(poly.anchor.x + r * Math.cos(a), poly.anchor.y, poly.anchor.z + r * Math.sin(a)),
    );
  }
  ctx.setPreview(previewLine(pts, ctx, true), "draft");
  ctx.showMeasure(
    poly.typed ? `R ${poly.typed}| · ${sides} sides` : `R ${formatNum(r)} · ${sides} sides`,
    poly.lastScreen,
  );
}

function commitPolygon(ctx: ToolContext, vertex: THREE.Vector3 | null): void {
  const c = poly.anchor!;
  const sides = getPolygonSides();
  const r = circleRadius(c, vertex, poly.typed);
  if (r > 1e-3) {
    void ctx.createEntity(
      { type: "polygon_curve", radius: r, sides },
      [c.x, c.y, c.z],
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
    const raw = sketchPlanePoint(ctx, event, poly.anchor?.y);
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
    const raw = sketchPlanePoint(ctx, event, poly.anchor?.y);
    if (!raw) return;
    if (poly.press && Math.hypot(event.clientX - poly.press.x, event.clientY - poly.press.y) > 5) {
      poly.dragged = true;
    }
    poly.lastCursor = ctx.snap(raw).point;
    poly.lastScreen = ctx.screenPoint(event);
    if (!poly.anchor) {
      ctx.showMeasure(null);
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
    const raw = sketchPlanePoint(ctx, event, poly.anchor.y);
    if (raw) commitPolygon(ctx, ctx.snap(raw).point);
    ctx.releasePointer(event);
  },
  onKey(event, ctx) {
    if (event.key === "[" || event.key === "-") {
      setPolygonSides(getPolygonSides() - 1);
      ctx.setStatus(`Polygon · ${getPolygonSides()} sides`);
      updatePolyPreview(ctx);
      return true;
    }
    if (event.key === "]" || event.key === "=" || event.key === "+") {
      setPolygonSides(getPolygonSides() + 1);
      ctx.setStatus(`Polygon · ${getPolygonSides()} sides`);
      updatePolyPreview(ctx);
      return true;
    }
    if (!poly.anchor) return false;
    if (/^[0-9.]$/.test(event.key)) {
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
  hint: () => `Polygon (${getPolygonSides()} sides, [ / ] changes sides) · click center, then radius (or type R + Enter)`,
};
