import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { arcThrough3 } from "./geometry2d";

// ---------------------------------------------------------------------------
// Sketch draw tools. All follow the same interaction model:
//   click to set points (click-click), or press-drag-release to size;
//   Shift constrains to axes; Esc cancels; Enter finishes multi-point tools.
// ---------------------------------------------------------------------------

interface ClickState {
  anchor: THREE.Vector3 | null;
  press: { x: number; y: number } | null;
  dragged: boolean;
}

function freshState(): ClickState {
  return { anchor: null, press: null, dragged: false };
}

/** Constrain `p` to the dominant axis of `from` when shift is held. */
function ortho(from: THREE.Vector3, p: THREE.Vector3, shift: boolean): THREE.Vector3 {
  if (!shift) return p;
  const dx = Math.abs(p.x - from.x);
  const dz = Math.abs(p.z - from.z);
  if (dx >= dz) return new THREE.Vector3(p.x, from.y, from.z);
  return new THREE.Vector3(from.x, from.y, p.z);
}

function formatNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function lenLabel(a: THREE.Vector3, b: THREE.Vector3): string {
  return formatNum(Math.hypot(b.x - a.x, b.z - a.z));
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
      const raw = ctx.planePoint(event, 0);
      if (!raw) return true;
      const snapped = ctx.snap(raw).point;
      if (!state.anchor) {
        state.anchor = snapped;
        points = [snapped];
        state.press = { x: event.clientX, y: event.clientY };
        state.dragged = false;
        ctx.capturePointer(event);
        return true;
      }
      const target = ortho(points[points.length - 1], snapped, event.shiftKey);
      if (id === "line") {
        const [a] = points;
        void ctx.createEntity(
          { type: "line_curve", end: [target.x - a.x, target.y - a.y, target.z - a.z] },
          [a.x, a.y, a.z],
        );
        ctx.setStatus("Line created · continue from the endpoint");
        // Chain the next line from the last endpoint.
        points = [target];
        state = { anchor: target, press: null, dragged: false };
        ctx.clearPreview("draft");
        ctx.showMeasure(null);
        return true;
      }
      // Polyline: clicking the first point closes and finishes the loop.
      if (points.length >= 3 && target.distanceTo(points[0]) < ctx.settings.gridSize * 0.6) {
        const flat = [...points, points[0].clone()].map(
          (p) => [p.x, p.y, p.z] as [number, number, number],
        );
        void ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
        ctx.setStatus("Closed polyline created");
        reset(ctx);
        return true;
      }
      points.push(target);
      draftPreview(target, ctx);
      ctx.setStatus("Click to add points · Enter finishes · Esc cancels");
      return true;
    },
    onPointerMove(event, ctx) {
      const raw = ctx.planePoint(event, 0);
      if (!raw) return;
      const cursor = ctx.snap(raw).point;
      if (state.press && Math.hypot(event.clientX - state.press.x, event.clientY - state.press.y) > 5) {
        state.dragged = true;
      }
      if (points.length === 0) {
        ctx.showMeasure(null);
        return;
      }
      const from = points[points.length - 1];
      const constrained = ortho(from, cursor, event.shiftKey);
      draftPreview(constrained, ctx);
      ctx.showMeasure(`${lenLabel(from, constrained)} · ${angleLabel(from, constrained)}`, ctx.screenPoint(event));
    },
    onPointerUp(event, ctx) {
      if (!state.anchor || !state.dragged) {
        // Click without drag: clear the press so the next mousemove does not
        // flip `dragged` on right before a real pointerdown.
        state.press = null;
        state.dragged = false;
        return;
      }
      const raw = ctx.planePoint(event, 0);
      if (!raw) {
        ctx.releasePointer(event);
        return;
      }
      const target = ortho(points[points.length - 1], ctx.snap(raw).point, event.shiftKey);
      if (id === "line") {
        const [a] = points;
        void ctx.createEntity(
          { type: "line_curve", end: [target.x - a.x, target.y - a.y, target.z - a.z] },
          [a.x, a.y, a.z],
        );
        points = [target];
        state = { anchor: target, press: null, dragged: false };
        ctx.clearPreview("draft");
        ctx.showMeasure(null);
      } else {
        points.push(target);
        draftPreview(target, ctx);
        state = freshState();
      }
      ctx.releasePointer(event);
    },
    onEnter(ctx) {
      if (id === "polyline" && points.length >= 2) {
        const flat = points.map((p) => [p.x, p.y, p.z] as [number, number, number]);
        void ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
        ctx.setStatus("Polyline created");
        reset(ctx);
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
      if (points.length > 1) {
        points.pop();
        ctx.setPreview(previewLine(points, ctx), "draft");
      } else if (points.length === 1) {
        reset(ctx);
      }
    },
    hint: () =>
      id === "line"
        ? "Line · click start, then endpoint · Shift constrains axis"
        : "Polyline · click points · click first point to close · Enter finishes",
  };
}

export const lineTool = makeLineTool("line");
export const polylineTool = makeLineTool("polyline");

// ----------------------------------------------------------------- rectangle

let rect = freshState();

function rectCorners(a: THREE.Vector3, e: THREE.Vector3): THREE.Vector3[] {
  return [
    new THREE.Vector3(Math.min(a.x, e.x), 0, Math.min(a.z, e.z)),
    new THREE.Vector3(Math.max(a.x, e.x), 0, Math.min(a.z, e.z)),
    new THREE.Vector3(Math.max(a.x, e.x), 0, Math.max(a.z, e.z)),
    new THREE.Vector3(Math.min(a.x, e.x), 0, Math.max(a.z, e.z)),
  ];
}

function squareEnd(a: THREE.Vector3, cursor: THREE.Vector3): THREE.Vector3 {
  const dx = cursor.x - a.x;
  const dz = cursor.z - a.z;
  const s = Math.max(Math.abs(dx), Math.abs(dz));
  return new THREE.Vector3(a.x + Math.sign(dx || 1) * s, a.y, a.z + Math.sign(dz || 1) * s);
}

function resetRect(ctx: ToolContext): void {
  rect = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function commitRect(ctx: ToolContext, endRaw: THREE.Vector3, square: boolean): void {
  const a = rect.anchor!;
  const e = square ? squareEnd(a, endRaw) : endRaw;
  const w = Math.abs(e.x - a.x);
  const d = Math.abs(e.z - a.z);
  if (w > 1e-3 && d > 1e-3) {
    void ctx.createEntity(
      { type: "rectangle_curve", width: w, depth: d },
      [(a.x + e.x) / 2, 0, (a.z + e.z) / 2],
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
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (!rect.anchor) {
      rect.anchor = snapped;
      rect.press = { x: event.clientX, y: event.clientY };
      ctx.capturePointer(event);
      return true;
    }
    commitRect(ctx, snapped, event.shiftKey);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    if (rect.press && Math.hypot(event.clientX - rect.press.x, event.clientY - rect.press.y) > 5) {
      rect.dragged = true;
    }
    if (!rect.anchor) {
      ctx.showMeasure(null);
      return;
    }
    const e = event.shiftKey ? squareEnd(rect.anchor, ctx.snap(raw).point) : ctx.snap(raw).point;
    ctx.setPreview(previewLine(rectCorners(rect.anchor, e), ctx, true), "draft");
    ctx.showMeasure(
      `${formatNum(Math.abs(e.x - rect.anchor.x))} × ${formatNum(Math.abs(e.z - rect.anchor.z))}`,
      ctx.screenPoint(event),
    );
  },
  onPointerUp(event, ctx) {
    if (!rect.anchor || !rect.dragged) return;
    const raw = ctx.planePoint(event, 0);
    if (raw) commitRect(ctx, ctx.snap(raw).point, event.shiftKey);
    ctx.releasePointer(event);
  },
  onCancel: resetRect,
  hint: () => "Rectangle · drag or click two corners · Shift for square",
};

// -------------------------------------------------------------------- circle

let circ = freshState();

function resetCircle(ctx: ToolContext): void {
  circ = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function commitCircle(ctx: ToolContext, edge: THREE.Vector3): void {
  const c = circ.anchor!;
  const r = edge.distanceTo(c);
  if (r > 1e-3) {
    void ctx.createEntity({ type: "circle_curve", radius: r, segments: 64 }, [c.x, 0, c.z]);
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
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (!circ.anchor) {
      circ.anchor = snapped;
      circ.press = { x: event.clientX, y: event.clientY };
      ctx.capturePointer(event);
      return true;
    }
    commitCircle(ctx, snapped);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    if (circ.press && Math.hypot(event.clientX - circ.press.x, event.clientY - circ.press.y) > 5) {
      circ.dragged = true;
    }
    if (!circ.anchor) {
      ctx.showMeasure(null);
      return;
    }
    const r = ctx.snap(raw).point.distanceTo(circ.anchor);
    ctx.setPreview(previewRing(circ.anchor, r, ctx), "draft");
    ctx.showMeasure(`R ${formatNum(r)}`, ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (!circ.anchor || !circ.dragged) return;
    const raw = ctx.planePoint(event, 0);
    if (raw) commitCircle(ctx, ctx.snap(raw).point);
    ctx.releasePointer(event);
  },
  onCancel: resetCircle,
  hint: () => "Circle · drag or click center, then radius",
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
    const raw = ctx.planePoint(event, 0);
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
        [fit.center.x, 0, fit.center.z],
      );
      ctx.setStatus("Arc created");
    } else {
      ctx.setStatus("Arc points are collinear · try again");
    }
    resetArc(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
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
        new THREE.Vector3(fit.center.x + fit.radius * Math.cos(a), 0, fit.center.z + fit.radius * Math.sin(a)),
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

let polygonSides = 6;

export function getPolygonSides(): number {
  return polygonSides;
}

export function setPolygonSides(n: number): void {
  polygonSides = Math.max(3, Math.min(24, Math.round(n)));
}

let poly = freshState();

function resetPoly(ctx: ToolContext): void {
  poly = freshState();
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function commitPolygon(ctx: ToolContext, vertex: THREE.Vector3): void {
  const c = poly.anchor!;
  const r = vertex.distanceTo(c);
  if (r > 1e-3) {
    void ctx.createEntity(
      { type: "polygon_curve", radius: r, sides: polygonSides },
      [c.x, 0, c.z],
    );
    ctx.setStatus(`Polygon (${polygonSides}-gon) created`);
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
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (!poly.anchor) {
      poly.anchor = snapped;
      poly.press = { x: event.clientX, y: event.clientY };
      ctx.capturePointer(event);
      return true;
    }
    commitPolygon(ctx, snapped);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    if (poly.press && Math.hypot(event.clientX - poly.press.x, event.clientY - poly.press.y) > 5) {
      poly.dragged = true;
    }
    if (!poly.anchor) {
      ctx.showMeasure(null);
      return;
    }
    const r = ctx.snap(raw).point.distanceTo(poly.anchor);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i < polygonSides; i++) {
      const a = (Math.PI * 2 * i) / polygonSides - Math.PI / 2;
      pts.push(new THREE.Vector3(poly.anchor.x + r * Math.cos(a), 0, poly.anchor.z + r * Math.sin(a)));
    }
    ctx.setPreview(previewLine(pts, ctx, true), "draft");
    ctx.showMeasure(`R ${formatNum(r)} · ${polygonSides} sides`, ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (!poly.anchor || !poly.dragged) return;
    const raw = ctx.planePoint(event, 0);
    if (raw) commitPolygon(ctx, ctx.snap(raw).point);
    ctx.releasePointer(event);
  },
  onCancel: resetPoly,
  hint: () => "Polygon · drag or click center, then vertex",
};
