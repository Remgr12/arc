import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { previewLine } from "./sketch";

// ---------------------------------------------------------------------------
// Annotation tools: dimension and wall. Both collect points on the ground
// plane; dimension commits after two points, walls on Enter or double-click.
// ---------------------------------------------------------------------------

function flat(p: THREE.Vector3): [number, number, number] {
  return [p.x, p.y, p.z];
}

// ----------------------------------------------------------------- dimension

let dim: { points: THREE.Vector3[] } = { points: [] };

function resetDimension(ctx: ToolContext): void {
  dim = { points: [] };
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function commitDimension(ctx: ToolContext): boolean {
  if (dim.points.length < 2) return false;
  void ctx.createEntity(
    { type: "dimension", start: flat(dim.points[0]), end: flat(dim.points[1]) },
    [0, 0, 0],
  );
  ctx.setStatus("Dimension created");
  resetDimension(ctx);
  return true;
}

export const dimensionTool: ToolHandler = {
  id: "dimension",
  cursor: "crosshair",
  onActivate(ctx) {
    resetDimension(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetDimension,
  hasActivity: () => dim.points.length > 0,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    dim.points = [snapped];
    ctx.capturePointer(event);
    ctx.setStatus("Dimension · click the second point");
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || dim.points.length === 0) return;
    const cursor = ctx.snap(raw).point;
    const [a] = dim.points;
    ctx.setPreview(previewLine([a, cursor], ctx), "draft");
    ctx.showMeasure(a.distanceTo(cursor).toFixed(2), ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (dim.points.length === 0) return;
    const raw = ctx.planePoint(event, 0);
    ctx.releasePointer(event);
    if (!raw) return;
    const cursor = ctx.snap(raw).point;
    if (cursor.distanceTo(dim.points[0]) < 1e-3) return;
    dim.points.push(cursor);
    commitDimension(ctx);
  },
  onCancel(ctx) {
    if (dim.points.length > 0) resetDimension(ctx);
  },
  onBackspace: resetDimension,
  hint: () => "Dimension · click two points",
};

// ---------------------------------------------------------------------- wall

let wall: { points: THREE.Vector3[] } = { points: [] };

function resetWall(ctx: ToolContext): void {
  wall = { points: [] };
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function commitWall(ctx: ToolContext): boolean {
  if (wall.points.length < 2) return false;
  const path = wall.points.map((p) => [p.x, p.z] as [number, number]);
  void ctx.createEntity({ type: "wall", path, width: 10, height: 80 }, [0, 0, 0]);
  ctx.setStatus("Wall created");
  resetWall(ctx);
  return true;
}

function wallTotal(points: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += points[i].distanceTo(points[i - 1]);
  }
  return total;
}

export const wallTool: ToolHandler = {
  id: "wall",
  cursor: "crosshair",
  onActivate(ctx) {
    resetWall(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetWall,
  hasActivity: () => wall.points.length > 0,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    // Clicking the first point again finishes the loop.
    if (wall.points.length >= 2 && snapped.distanceTo(wall.points[0]) < ctx.settings.gridSize * 0.6) {
      wall.points.push(wall.points[0].clone());
      commitWall(ctx);
      return true;
    }
    wall.points.push(snapped);
    ctx.capturePointer(event);
    ctx.setStatus(`Wall · click to add points · Enter finishes (${wall.points.length})`);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || wall.points.length === 0) return;
    const cursor = ctx.snap(raw).point;
    const pts = [...wall.points, cursor];
    ctx.setPreview(previewLine(pts, ctx), "draft");
    ctx.showMeasure(wallTotal(pts).toFixed(2), ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (wall.points.length === 0) return;
    ctx.releasePointer(event);
  },
  onEnter(ctx) {
    return commitWall(ctx);
  },
  onDoubleClick(_event, ctx) {
    return commitWall(ctx);
  },
  onCancel(ctx) {
    if (wall.points.length > 0) {
      wall.points.pop();
      if (wall.points.length === 0) {
        ctx.clearPreview("draft");
        ctx.showMeasure(null);
      } else {
        ctx.setPreview(previewLine(wall.points, ctx), "draft");
      }
    }
  },
  onBackspace(ctx) {
    if (wall.points.length > 0) {
      wall.points.pop();
      if (wall.points.length === 0) {
        ctx.clearPreview("draft");
        ctx.showMeasure(null);
      } else {
        ctx.setPreview(previewLine(wall.points, ctx), "draft");
      }
    }
  },
  hint: () => "Wall · click path points · Enter or double-click finishes",
};
