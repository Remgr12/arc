import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { previewLine } from "./sketch";
import { previewMaterial } from "./primitives";

// ---------------------------------------------------------------------------
// Annotation tools: dimension and wall. Both collect points on the ground
// plane; dimension commits after two points, walls on Enter or double-click.
// ---------------------------------------------------------------------------

function flat(p: THREE.Vector3): [number, number, number] {
  return [p.x, p.y, p.z];
}

// ----------------------------------------------------------------- dimension

let dim: {
  points: THREE.Vector3[];
  press: { x: number; y: number } | null;
  dragged: boolean;
} = { points: [], press: null, dragged: false };

function resetDimension(ctx: ToolContext): void {
  dim = { points: [], press: null, dragged: false };
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
    const raw = ctx.planePoint(event, dim.points[0]?.y);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    if (dim.points.length === 0) {
      dim.points = [snapped];
      dim.press = { x: event.clientX, y: event.clientY };
      dim.dragged = false;
      ctx.capturePointer(event);
      ctx.setStatus("Dimension · click the second point");
      return true;
    }
    if (snapped.distanceTo(dim.points[0]) > 1e-3) {
      dim.points.push(snapped);
      commitDimension(ctx);
    }
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, dim.points[0]?.y);
    if (!raw || dim.points.length === 0) return;
    if (dim.press && Math.hypot(event.clientX - dim.press.x, event.clientY - dim.press.y) > 5) {
      dim.dragged = true;
    }
    const cursor = ctx.snap(raw).point;
    const [a] = dim.points;
    ctx.setPreview(previewLine([a, cursor], ctx), "draft");
    ctx.showMeasure(a.distanceTo(cursor).toFixed(2), ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (dim.points.length === 0) return;
    ctx.releasePointer(event);
    if (!dim.dragged) {
      dim.press = null;
      return;
    }
    const raw = ctx.planePoint(event, dim.points[0]?.y);
    dim.press = null;
    dim.dragged = false;
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
  hint: () => "Dimension · click or drag two points",
};

// ---------------------------------------------------------------------- wall

const WALL_WIDTH = 10;
const WALL_HEIGHT = 80;

let wall: { points: THREE.Vector3[] } = { points: [] };

function resetWall(ctx: ToolContext): void {
  wall = { points: [] };
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function buildWallPreview(points: THREE.Vector3[], ctx: ToolContext): THREE.Object3D {
  const group = new THREE.Group();
  group.add(previewLine(points, ctx));
  const mat = previewMaterial(ctx);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-3) continue;
    const geo = new THREE.BoxGeometry(len, WALL_HEIGHT, WALL_WIDTH);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((a.x + b.x) / 2, a.y + WALL_HEIGHT / 2, (a.z + b.z) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.renderOrder = 997;
    group.add(mesh);
  }
  return group;
}

function commitWall(ctx: ToolContext): boolean {
  if (wall.points.length < 2) return false;
  const path = wall.points.map((p) => [p.x, p.z] as [number, number]);
  void ctx.createEntity({ type: "wall", path, width: WALL_WIDTH, height: WALL_HEIGHT }, [0, 0, 0]);
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
    ctx.setPreview(buildWallPreview(pts, ctx), "draft");
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
        ctx.setPreview(buildWallPreview(wall.points, ctx), "draft");
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
        ctx.setPreview(buildWallPreview(wall.points, ctx), "draft");
      }
    }
  },
  hint: () => "Wall · click path points · Enter or double-click finishes",
};
