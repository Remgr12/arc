import * as THREE from "three";
import type { ToolId } from "../lib/types";
import type { EntityData } from "../lib/types";
import type { ToolContext, ToolHandler } from "./types";
import {
  chainFromEntity,
  closestOnChain,
  filletCorner,
  mirrorPoint,
  offsetPolyline,
  segmentIntersection,
  toLocal,
  type Chain,
} from "./geometry2d";

// ---------------------------------------------------------------------------
// Sketch edit tools (Shapr3D-style): offset, trim, extend, fillet, mirror.
// Chains are world-space XZ polylines via chainFromEntity; new entities are
// created at [0,0,0] with world points, or edited in place via toLocal.
// ---------------------------------------------------------------------------

type EditToolId = "offset" | "trim" | "extend" | "fillet" | "mirror";

// lib/types.ts unions grow as tools get wired into the store; the shipped id
// is the string value, so a single boundary cast keeps edit.ts compiling.
type EditTool = Omit<ToolHandler, "id"> & { id: EditToolId };

function defineTool(tool: EditTool): ToolHandler {
  return { ...tool, id: tool.id as unknown as ToolId };
}

function formatNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function accentMaterial(ctx: ToolContext, opacity = 0.95): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({ transparent: true, opacity, depthTest: false });
  mat.color.copy(ctx.palette.hover);
  return mat;
}

function polylineObject(
  points: THREE.Vector3[],
  mat: THREE.LineBasicMaterial,
  closed = false,
): THREE.Line {
  const pts = closed && points.length > 1 ? [...points, points[0]] : points;
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  line.renderOrder = 999;
  line.frustumCulled = false;
  return line;
}

function previewGroup(parts: THREE.Object3D[]): THREE.Group {
  const group = new THREE.Group();
  for (const p of parts) group.add(p);
  return group;
}

interface ChainRef {
  id: string;
  points: THREE.Vector3[];
  closed: boolean;
  entity: EntityData;
}

function collectChains(ctx: ToolContext, excludeId: string | null): ChainRef[] {
  const out: ChainRef[] = [];
  for (const entity of ctx.scene()?.entities ?? []) {
    if (!entity.visible || entity.category !== "sketch" || entity.id === excludeId) continue;
    const chain = chainFromEntity(entity, ctx.objectFor(entity.id));
    if (!chain) continue;
    out.push({ id: entity.id, points: chain.points, closed: chain.closed, entity });
  }
  return out;
}

function chainOf(ctx: ToolContext, id: string | null): Chain | null {
  if (!id) return null;
  const entity = ctx.entityById(id);
  if (!entity || !entity.visible) return null;
  return chainFromEntity(entity, ctx.objectFor(id));
}

function isSketchEntity(entity: EntityData | null): boolean {
  return !!entity && entity.visible && entity.category === "sketch";
}

function clearDraft(ctx: ToolContext): void {
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function toLocalPoint(
  object: THREE.Object3D | null,
  world: THREE.Vector3,
): [number, number, number] {
  if (!object) return [world.x, world.y, world.z];
  return toLocal(object, [world])[0];
}

function distXZ(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Remove consecutive duplicate points (wrap crossings can emit them). */
function dedupe(points: THREE.Vector3[]): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const p of points) {
    if (out.length && distXZ(out[out.length - 1], p) < 1e-5 && Math.abs(out[out.length - 1].y - p.y) < 1e-5) {
      continue;
    }
    out.push(p);
  }
  return out;
}

function flatten(points: THREE.Vector3[]): [number, number, number][] {
  return points.map((p) => [p.x, p.y, p.z] as [number, number, number]);
}

function vertexMarker(center: THREE.Vector3, ctx: ToolContext): THREE.LineLoop {
  const r = Math.max(0.15, ctx.settings.gridSize * 0.25);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    pts.push(new THREE.Vector3(center.x + r * Math.cos(a), center.y, center.z + r * Math.sin(a)));
  }
  const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), accentMaterial(ctx));
  loop.renderOrder = 999;
  loop.frustumCulled = false;
  return loop;
}

// --------------------------------------------------------------------- offset

interface OffsetSet {
  id: string;
  entity: EntityData;
  chain: Chain;
}

let offsetSet: OffsetSet[] = [];

function resetOffset(ctx: ToolContext): void {
  offsetSet = [];
  clearDraft(ctx);
}

/** Signed distance from the first chain's start segment to the cursor; the
 * offsetPolyline convention makes a cursor on that side land on the preview. */
function signedOffsetDistance(chain: Chain, cursor: THREE.Vector3): number {
  const a = chain.points[0];
  const b = chain.points[1];
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  return ((cursor.x - a.x) * dz - (cursor.z - a.z) * dx) / len;
}

function createOffsetEntity(ctx: ToolContext, entry: OffsetSet, distance: number): boolean {
  const entity = entry.entity;
  const chain = entry.chain;
  const g = entity.geometry as Record<string, unknown>;
  if (chain.closed && String(g.type) === "circle_curve") {
    const r = Number(g.radius ?? 0) + distance;
    if (r <= 1e-3) {
      ctx.setStatus(`Offset of ${entity.name} would invert the circle`);
      return false;
    }
    const object = ctx.objectFor(entry.id);
    const center = object
      ? new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)
      : chain.points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(chain.points.length);
    void ctx.createEntity({ type: "circle_curve", radius: r, segments: 64 }, [center.x, center.y, center.z]);
    return true;
  }
  const offset = offsetPolyline(chain.points, chain.closed, distance);
  if (offset.length < 2) {
    ctx.setStatus(`Offset of ${entity.name} collapsed`);
    return false;
  }
  const flat = flatten(offset);
  if (chain.closed) flat.push(flat[0]);
  void ctx.createEntity({ type: "polyline_curve", points: flat }, [0, 0, 0]);
  return true;
}

function offsetPreview(ctx: ToolContext, cursor: THREE.Vector3): void {
  if (offsetSet.length === 0) {
    clearDraft(ctx);
    return;
  }
  const mat = accentMaterial(ctx);
  const distance = signedOffsetDistance(offsetSet[0].chain, cursor);
  const parts: THREE.Object3D[] = [];
  for (const entry of offsetSet) parts.push(polylineObject(entry.chain.points, mat, entry.chain.closed));
  for (const entry of offsetSet) {
    parts.push(polylineObject(offsetPolyline(entry.chain.points, entry.chain.closed, distance), mat, entry.chain.closed));
  }
  ctx.setPreview(previewGroup(parts), "draft");
  ctx.showMeasure(`offset ${formatNum(distance)}`);
}

export const offsetTool: ToolHandler = defineTool({
  id: "offset",
  cursor: "crosshair",
  onActivate(ctx) {
    resetOffset(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetOffset,
  hasActivity: () => offsetSet.length > 0,
  onPointerDown(event, ctx) {
    const picked = ctx.pickEntity(event);
    const entity = ctx.entityById(picked ?? "");
    if (picked && entity && isSketchEntity(entity)) {
      const chain = chainOf(ctx, picked);
      if (chain) {
        const existing = offsetSet.findIndex((e) => e.id === picked);
        if (existing >= 0) {
          offsetSet.splice(existing, 1);
          ctx.setStatus(`${offsetSet.length} curve(s) in offset set · click another, or empty space to commit`);
        } else {
          offsetSet = [...offsetSet, { id: picked, entity, chain }];
          ctx.setStatus(`${offsetSet.length} curve(s) in offset set · move to preview, empty-space click commits`);
        }
        const after = ctx.planePoint(event, offsetSet[0]?.chain.points[0]?.y);
        if (after) offsetPreview(ctx, after);
        else clearDraft(ctx);
        return true;
      }
    }
    if (offsetSet.length === 0) {
      ctx.setStatus("Offset · click sketch curves to add them first");
      return true;
    }
    const cursor = ctx.planePoint(event, offsetSet[0]?.chain.points[0]?.y);
    if (!cursor) return true;
    const distance = signedOffsetDistance(offsetSet[0].chain, cursor);
    if (Math.abs(distance) < 1e-3) {
      ctx.setStatus("Offset distance is too small · move further from the first curve");
      return true;
    }
    let ok = 0;
    for (const entry of offsetSet) if (createOffsetEntity(ctx, entry, distance)) ok++;
    ctx.setStatus(ok === 1 ? "Offset created" : `${ok} offsets created`);
    resetOffset(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const cursor = ctx.planePoint(event, offsetSet[0]?.chain.points[0]?.y);
    if (!cursor) {
      clearDraft(ctx);
      return;
    }
    offsetPreview(ctx, cursor);
  },
  onCancel(ctx) {
    resetOffset(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onBackspace(ctx) {
    offsetSet.pop();
    ctx.setStatus(`${offsetSet.length} curve(s) in offset set`);
    clearDraft(ctx);
  },
  hint: () => "Offset · click sketch curves to add, move to preview, click empty space to commit · Esc clears",
});

// ----------------------------------------------------------------------- trim

interface ChainHit {
  u: number;
  point: THREE.Vector3;
}

/** Exact intersection parameters along the chain (segmentIntersections u + t). */
function chainHits(
  chain: Chain,
  others: { id: string; points: THREE.Vector3[]; closed: boolean }[],
): ChainHit[] {
  const n = chain.points.length;
  const segCount = chain.closed ? n : n - 1;
  const hits: ChainHit[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = chain.points[i];
    const b = chain.points[(i + 1) % n];
    const dirx = b.x - a.x;
    const dirz = b.z - a.z;
    const len2 = dirx * dirx + dirz * dirz;
    for (const other of others) {
      const m = other.points.length;
      const otherSegs = other.closed ? m : m - 1;
      for (let j = 0; j < otherSegs; j++) {
        const hit = segmentIntersection(a, b, other.points[j], other.points[(j + 1) % m]);
        if (!hit) continue;
        let t = 0;
        if (len2 > 1e-12) t = ((hit.x - a.x) * dirx + (hit.z - a.z) * dirz) / len2;
        hits.push({ u: i + Math.max(0, Math.min(1, t)), point: hit.clone() });
      }
    }
  }
  hits.sort((p, q) => p.u - q.u);
  const merged: ChainHit[] = [];
  for (const h of hits) {
    if (merged.length && h.u - merged[merged.length - 1].u < 1e-3) continue;
    merged.push(h);
  }
  return merged;
}

function pointAtU(points: THREE.Vector3[], u: number, closed: boolean): THREE.Vector3 {
  const n = points.length;
  let uu = u;
  if (closed) uu = ((u % n) + n) % n;
  const maxIdx = closed ? n - 1 : n - 2;
  const i = Math.max(0, Math.min(maxIdx, Math.floor(uu)));
  const t = Math.max(0, Math.min(1, uu - i));
  const a = points[i];
  const b = points[(i + 1) % n];
  return new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
}

/** Chain path from parameter a to b; b may exceed n for closed-loop wraps. */
function rangePath(points: THREE.Vector3[], closed: boolean, a: number, b: number): THREE.Vector3[] {
  const n = points.length;
  const path = [pointAtU(points, a, closed)];
  for (let i = Math.floor(a) + 1; i <= Math.floor(b); i++) {
    path.push(points[((i % n) + n) % n]);
  }
  path.push(pointAtU(points, b, closed));
  return dedupe(path);
}

function findBracket(
  hits: ChainHit[],
  u: number,
  closed: boolean,
  n: number,
): { a: number; b: number } | null {
  const eps = 1e-3;
  if (closed) {
    const m = hits.length;
    if (m < 2) return null;
    for (let k = 0; k < m; k++) {
      const a = hits[k].u;
      const b = k === m - 1 ? hits[0].u + n : hits[k + 1].u;
      if (b - a < eps) continue;
      let q = u;
      if (q < a) q += n;
      if (q > a + eps && q < b - eps) return { a, b };
    }
    return null;
  }
  for (let k = 0; k < hits.length - 1; k++) {
    const a = hits[k].u;
    const b = hits[k + 1].u;
    if (u > a + eps && u < b - eps) return { a, b };
  }
  return null;
}

interface TrimPlan {
  removed: THREE.Vector3[];
  remaining: THREE.Vector3[][];
}

function trimPlan(chain: Chain, cursor: THREE.Vector3, others: ChainRef[]): TrimPlan | null {
  const hits = chainHits(chain, others);
  const probe = chain.closed ? [...chain.points, chain.points[0]] : chain.points;
  const u = closestOnChain(cursor, probe).u;
  const bracket = findBracket(hits, u, chain.closed, chain.points.length);
  if (bracket) {
    const removed = rangePath(chain.points, chain.closed, bracket.a, bracket.b);
    const remaining: THREE.Vector3[][] = [];
    if (chain.closed) {
      remaining.push(dedupe(rangePath(chain.points, chain.closed, bracket.b, bracket.a + chain.points.length)));
    } else {
      if (bracket.a > 1e-3) remaining.push(rangePath(chain.points, false, 0, bracket.a));
      if (bracket.b < chain.points.length - 1 - 1e-3) {
        remaining.push(rangePath(chain.points, false, bracket.b, chain.points.length - 1));
      }
    }
    return { removed, remaining };
  }
  // No two-sided bracket: the clicked piece may still run to a chain end
  // (e.g. a T-stop with a single crossing) - trim from the crossing outward.
  if (!chain.closed && hits.length === 1) {
    const h = hits[0].u;
    if (u < h - 1e-3) {
      return {
        removed: rangePath(chain.points, false, 0, h),
        remaining: [rangePath(chain.points, false, h, chain.points.length - 1)],
      };
    }
    if (u > h + 1e-3) {
      return {
        removed: rangePath(chain.points, false, h, chain.points.length - 1),
        remaining: [rangePath(chain.points, false, 0, h)],
      };
    }
  }
  return null;
}

export const trimTool: ToolHandler = defineTool({
  id: "trim",
  cursor: "crosshair",
  onActivate(ctx) {
    clearDraft(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: clearDraft,
  onPointerDown(event, ctx) {
    const picked = ctx.pickEntity(event);
    const entity = ctx.entityById(picked ?? "");
    const chain = !isSketchEntity(entity) ? null : chainOf(ctx, picked);
    if (!chain || !picked) {
      ctx.setStatus(this.hint!(ctx));
      return true;
    }
    const cursor = ctx.planePoint(event, chain.points[0]?.y);
    if (!cursor) return true;
    const plan = trimPlan(chain, cursor, collectChains(ctx, picked));
    if (!plan) {
      ctx.setStatus("Nothing to trim here");
      return true;
    }
    let created = 0;
    for (const piece of plan.remaining) {
      if (piece.length < 2) continue;
      void ctx.createEntity({ type: "polyline_curve", points: flatten(piece) }, [0, 0, 0]);
      created++;
    }
    void ctx.deleteEntities([picked]);
    ctx.setStatus(created > 0 ? "Trimmed" : "Trimmed away the whole piece");
    clearDraft(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const picked = ctx.pickEntity(event);
    const entity = ctx.entityById(picked ?? "");
    const chain = !isSketchEntity(entity) ? null : chainOf(ctx, picked);
    const cursor = ctx.planePoint(event, chain?.points[0]?.y);
    if (!chain || !picked || !cursor) {
      clearDraft(ctx);
      return;
    }
    const plan = trimPlan(chain, cursor, collectChains(ctx, picked));
    if (!plan || plan.removed.length < 2) {
      clearDraft(ctx);
      return;
    }
    const mat = accentMaterial(ctx);
    const pairs: THREE.Vector3[] = [];
    for (let i = 0; i < plan.removed.length - 1; i++) {
      pairs.push(plan.removed[i], plan.removed[i + 1]);
    }
    const segs = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pairs), mat);
    segs.renderOrder = 999;
    segs.frustumCulled = false;
    ctx.setPreview(segs, "draft");
  },
  hint: () => "Trim · click a curve to remove the piece between its nearest crossings",
});

// --------------------------------------------------------------------- extend

interface EndpointHover {
  id: string;
  chain: Chain;
  isStart: boolean;
  screenDist: number;
}

const ENDPOINT_PICK_PX = 12;

function endpointHover(ctx: ToolContext, event: PointerEvent | MouseEvent): EndpointHover | null {
  const sp = ctx.screenPoint(event);
  let best: EndpointHover | null = null;
  for (const ref of collectChains(ctx, null)) {
    const g = ref.entity.geometry as Record<string, unknown>;
    const type = String(g.type);
    if (type !== "line_curve" && !(type === "polyline_curve" && !ref.closed)) continue;
    if (ref.points.length < 2) continue;
    for (const isStart of [true, false]) {
      const world = isStart ? ref.points[0] : ref.points[ref.points.length - 1];
      const screen = ctx.worldToScreen(world);
      if (!screen) continue;
      const dist = Math.hypot(screen.x - sp.x, screen.y - sp.y);
      if (dist > ENDPOINT_PICK_PX) continue;
      if (!best || dist < best.screenDist) {
        best = { id: ref.id, chain: { points: ref.points, closed: false, entityId: ref.id }, isStart, screenDist: dist };
      }
    }
  }
  return best;
}

function extendTarget(hover: EndpointHover, chain: Chain, others: ChainRef[]): THREE.Vector3 | null {
  const endIdx = hover.isStart ? 0 : chain.points.length - 1;
  const world = chain.points[endIdx];
  const behind = chain.points[hover.isStart ? 1 : chain.points.length - 2];
  const dir = new THREE.Vector3(world.x - behind.x, 0, world.z - behind.z);
  const len = Math.hypot(dir.x, dir.z);
  if (len < 1e-6) return null;
  dir.divideScalar(len);
  const far = new THREE.Vector3(world.x + dir.x * 10000, world.y, world.z + dir.z * 10000);
  let best: { point: THREE.Vector3; dist: number } | null = null;
  for (const other of others) {
    const m = other.points.length;
    const segs = other.closed ? m : m - 1;
    for (let j = 0; j < segs; j++) {
      const hit = segmentIntersection(world, far, other.points[j], other.points[(j + 1) % m]);
      if (!hit) continue;
      const dist = hit.distanceTo(world);
      if (dist < 1e-4) continue;
      if (!best || dist < best.dist) best = { point: hit.clone(), dist };
    }
  }
  return best ? best.point : null;
}

export const extendTool: ToolHandler = defineTool({
  id: "extend",
  cursor: "crosshair",
  onActivate(ctx) {
    clearDraft(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: clearDraft,
  onPointerDown(event, ctx) {
    const hover = endpointHover(ctx, event);
    if (!hover) {
      ctx.setStatus(this.hint!(ctx));
      return true;
    }
    const target = extendTarget(hover, hover.chain, collectChains(ctx, hover.id));
    if (!target) {
      ctx.setStatus("No target to extend to");
      return true;
    }
    const entity = ctx.entityById(hover.id);
    const object = ctx.objectFor(hover.id);
    if (!entity) return true;
    const g = entity.geometry as Record<string, unknown>;
    if (String(g.type) === "line_curve") {
      if (hover.isStart) {
        // Start moves instead of end: rebase the line so the far endpoint
        // (end) stays put while the start lands on the new target.
        const endWorld = hover.chain.points[hover.chain.points.length - 1];
        const end = [endWorld.x - target.x, endWorld.y - target.y, endWorld.z - target.z];
        void ctx.updateGeometry(hover.id, { type: "line_curve", end: end as [number, number, number] });
        void ctx.setTransform(
          hover.id,
          { position: [target.x, target.y, target.z], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
          true,
        );
      } else {
        void ctx.updateGeometry(hover.id, { type: "line_curve", end: toLocalPoint(object, target) });
      }
    } else {
      const raw = (g.points as [number, number, number][]) ?? [];
      const pts = raw.slice();
      if (hover.isStart) pts[0] = toLocalPoint(object, target);
      else pts[pts.length - 1] = toLocalPoint(object, target);
      void ctx.updateGeometry(hover.id, { type: "polyline_curve", points: pts });
    }
    ctx.setStatus("Extended");
    clearDraft(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const hover = endpointHover(ctx, event);
    if (!hover) {
      clearDraft(ctx);
      return;
    }
    const mat = accentMaterial(ctx);
    const parts: THREE.Object3D[] = [];
    const world = hover.isStart ? hover.chain.points[0] : hover.chain.points[hover.chain.points.length - 1];
    parts.push(vertexMarker(world, ctx));
    const target = extendTarget(hover, hover.chain, collectChains(ctx, hover.id));
    if (target) {
      parts.push(polylineObject([world, target], mat));
      ctx.showMeasure(`extend ${formatNum(distXZ(world, target))}`);
    } else {
      ctx.showMeasure(null);
    }
    ctx.setPreview(previewGroup(parts), "draft");
  },
  hint: () => "Extend · click a line or open polyline endpoint to stretch it to the next crossing",
});

// --------------------------------------------------------------------- fillet

interface VertexHover {
  id: string;
  vertexIndex: number;
  vertexWorld: THREE.Vector3;
  screenDist: number;
}

interface ArmedFillet {
  id: string;
  vertexIndex: number;
}

let armedFillet: ArmedFillet | null = null;
let filletPress: { x: number; y: number } | null = null;
let filletDragged = false;

function resetFillet(ctx: ToolContext): void {
  armedFillet = null;
  filletPress = null;
  filletDragged = false;
  clearDraft(ctx);
}

/** Corner vertices a fillet may address: polyline interiors, all corners of
 * closed loops (rotation fixes the seam), polygon corners, and rectangle corners. */
function filletHover(ctx: ToolContext, event: PointerEvent | MouseEvent): VertexHover | null {
  const sp = ctx.screenPoint(event);
  let best: VertexHover | null = null;
  for (const ref of collectChains(ctx, null)) {
    const g = ref.entity.geometry as Record<string, unknown>;
    const type = String(g.type);
    if (type !== "polyline_curve" && type !== "rectangle_curve" && type !== "polygon_curve") continue;
    const maxIdx = type === "rectangle_curve" ? 4 : ref.points.length;
    for (let i = 0; i < maxIdx; i++) {
      if (type === "polyline_curve" && !ref.closed && (i === 0 || i === ref.points.length - 1)) continue;
      if (ref.points.length < 3) continue;
      const world = ref.points[i];
      const screen = ctx.worldToScreen(world);
      if (!screen) continue;
      const dist = Math.hypot(screen.x - sp.x, screen.y - sp.y);
      if (dist > ENDPOINT_PICK_PX) continue;
      if (!best || dist < best.screenDist) {
        best = { id: ref.id, vertexIndex: i, vertexWorld: world.clone(), screenDist: dist };
      }
    }
  }
  return best;
}

/** Rotate a closed loop so the corner sits at index 1 (an interior slot). */
function rotateCornerInto(points: THREE.Vector3[], idx: number): { pts: THREE.Vector3[]; idx: number } {
  const n = points.length;
  const shift = (idx - 1 + n) % n;
  return { pts: [...points.slice(shift), ...points.slice(0, shift)], idx: 1 };
}

function filletRectangleWorld(corners: THREE.Vector3[], radius: number): THREE.Vector3[] | null {
  const n = corners.length;
  let r = radius;
  for (let i = 0; i < n; i++) {
    const edge = corners[i].distanceTo(corners[(i + 1) % n]);
    r = Math.min(r, edge * 0.49);
  }
  if (r < 1e-3) return null;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const fit = filletCorner(
      [corners[(i + n - 1) % n].clone(), corners[i].clone(), corners[(i + 1) % n].clone()],
      1,
      r,
      12,
    );
    if (!fit) return null;
    out.push(...fit.arc);
  }
  out.push(out[0].clone());
  return out;
}

function filletPolylineWorld(
  points: THREE.Vector3[],
  idx: number,
  radius: number,
  closed: boolean,
): THREE.Vector3[] | null {
  const fit = filletCorner(points, idx, radius, 12);
  if (!fit) return null;
  const out = [...points.slice(0, idx), ...fit.arc, ...points.slice(idx + 1)];
  if (closed) out.push(out[0].clone());
  return out;
}

/** Build the filleted world points for the armed corner at the given radius. */
function filletResult(
  ctx: ToolContext,
  armed: ArmedFillet,
  radius: number,
  allCorners = false,
): { points: THREE.Vector3[]; closed: boolean } | null {
  const chain = chainOf(ctx, armed.id);
  if (!chain) return null;
  const g = ctx.entityById(armed.id)?.geometry as Record<string, unknown> | undefined;
  if (!g) return null;
  if (allCorners && String(g.type) === "rectangle_curve") {
    if (chain.points.length !== 4) return null;
    const rect = filletRectangleWorld(chain.points, radius);
    return rect ? { points: rect, closed: true } : null;
  }
  if (chain.points.length < 3) return null;
  if (chain.closed) {
    const { pts, idx } = rotateCornerInto(chain.points, armed.vertexIndex);
    const out = filletPolylineWorld(pts, idx, radius, true);
    return out ? { points: out, closed: true } : null;
  }
  if (armed.vertexIndex <= 0 || armed.vertexIndex >= chain.points.length - 1) return null;
  const out = filletPolylineWorld(chain.points, armed.vertexIndex, radius, false);
  return out ? { points: out, closed: false } : null;
}

function commitFillet(ctx: ToolContext, event: PointerEvent | MouseEvent): void {
  if (!armedFillet) return;
  const entity = ctx.entityById(armedFillet.id);
  if (!entity) {
    resetFillet(ctx);
    return;
  }
  const chain = chainOf(ctx, armedFillet.id);
  const planeY = chain?.points[0]?.y ?? 0;
  const cursor = ctx.planePoint(event, planeY);
  if (!cursor || !chain) {
    resetFillet(ctx);
    return;
  }
  const vertex = chain.points[Math.min(armedFillet.vertexIndex, chain.points.length - 1)];
  const radius = distXZ(vertex, cursor);
  if (radius < 1e-3) {
    ctx.setStatus("Fillet radius is too small · move away from the corner");
    return;
  }
  const result = filletResult(ctx, armedFillet, radius, event.shiftKey);
  if (!result) {
    ctx.setStatus("Can't fillet this corner · its sides are collinear or the radius overflows");
    return;
  }
  void ctx.createEntity(
    { type: "polyline_curve", points: flatten(result.points) },
    [0, 0, 0],
    `${entity.name} fillet`,
  );
  void ctx.deleteEntities([armedFillet.id]);
  resetFillet(ctx);
  ctx.setStatus("Fillet applied");
}

export const filletTool: ToolHandler = defineTool({
  id: "fillet",
  cursor: "crosshair",
  onActivate(ctx) {
    resetFillet(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetFillet,
  hasActivity: () => armedFillet !== null,
  onPointerDown(event, ctx) {
    if (armedFillet) {
      commitFillet(ctx, event);
      return true;
    }
    const hover = filletHover(ctx, event);
    if (!hover) {
      ctx.setStatus(this.hint!(ctx));
      return true;
    }
    armedFillet = { id: hover.id, vertexIndex: hover.vertexIndex };
    filletPress = { x: event.clientX, y: event.clientY };
    filletDragged = false;
    ctx.capturePointer(event);
    ctx.setStatus("Fillet · move to set radius, click or release to commit · Esc cancels");
    return true;
  },
  onPointerMove(event, ctx) {
    if (filletPress && Math.hypot(event.clientX - filletPress.x, event.clientY - filletPress.y) > 5) {
      filletDragged = true;
    }
    const armed = armedFillet;
    if (!armed) {
      const hover = filletHover(ctx, event);
      if (!hover) {
        clearDraft(ctx);
        return;
      }
      ctx.setPreview(vertexMarker(hover.vertexWorld, ctx), "draft");
      ctx.showMeasure(null);
      return;
    }
    const chain = chainOf(ctx, armed.id);
    if (!chain) {
      clearDraft(ctx);
      return;
    }
    const cursor = ctx.planePoint(event, chain.points[0]?.y ?? 0);
    if (!cursor) {
      clearDraft(ctx);
      return;
    }
    const vertex = chain.points[Math.min(armed.vertexIndex, chain.points.length - 1)];
    const radius = distXZ(vertex, cursor);
    const parts: THREE.Object3D[] = [vertexMarker(vertex, ctx)];
    const result = filletResult(ctx, armed, radius, event.shiftKey);
    if (result) {
      const mat = accentMaterial(ctx);
      parts.push(polylineObject(result.points, mat, result.closed));
      ctx.showMeasure(`R ${formatNum(radius)}`);
    } else {
      ctx.showMeasure(null);
    }
    ctx.setPreview(previewGroup(parts), "draft");
  },
  onPointerUp(event, ctx) {
    if (!armedFillet || !filletDragged) return;
    commitFillet(ctx, event);
    ctx.releasePointer(event);
  },
  onCancel: resetFillet,
  hint: () => "Fillet · click a polyline corner or rectangle corner, drag or move, then click to commit",
});

// --------------------------------------------------------------------- mirror

let mirrorAxis: THREE.Vector3 | null = null;

function resetMirror(ctx: ToolContext): void {
  mirrorAxis = null;
  clearDraft(ctx);
}

function axisPreviewMaterial(ctx: ToolContext): THREE.LineDashedMaterial {
  const grid = Math.max(0.05, ctx.settings.gridSize);
  const mat = new THREE.LineDashedMaterial({
    transparent: true,
    opacity: 0.5,
    depthTest: false,
    dashSize: grid * 0.4,
    gapSize: grid * 0.25,
  });
  mat.color.copy(ctx.palette.hover);
  return mat;
}

function mirrorSelection(ctx: ToolContext): { id: string; chain: Chain }[] {
  const out: { id: string; chain: Chain }[] = [];
  for (const id of ctx.selection()) {
    const chain = chainOf(ctx, id);
    if (chain) out.push({ id, chain });
  }
  return out;
}

export const mirrorTool: ToolHandler = defineTool({
  id: "mirror",
  cursor: "crosshair",
  onActivate(ctx) {
    resetMirror(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetMirror,
  hasActivity: () => mirrorAxis !== null,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, mirrorAxis?.y);
    if (!raw) return true;
    const point = ctx.snap(raw).point;
    if (mirrorSelection(ctx).length === 0) {
      const picked = ctx.pickEntity(event);
      const entity = ctx.entityById(picked ?? "");
      if (picked && entity && isSketchEntity(entity)) {
        void ctx.setSelection([picked], picked);
        ctx.setStatus("Curve selected · click the first point on the mirror axis");
        return true;
      }
      ctx.setStatus("Select curves first (or click a curve), then define mirror axis");
      return true;
    }
    if (!mirrorAxis) {
      mirrorAxis = point.clone();
      ctx.setStatus("Mirror · click the second axis point · Esc cancels");
      return true;
    }
    const dir = point.clone().sub(mirrorAxis);
    if (Math.hypot(dir.x, dir.z) < 1e-3) {
      ctx.setStatus("Mirror axis is degenerate · click a distinct second point");
      return true;
    }
    dir.divideScalar(Math.hypot(dir.x, dir.z));
    const anchor = mirrorAxis;
    let count = 0;
    for (const { id, chain } of mirrorSelection(ctx)) {
      const mirrored = chain.points.map((p) => mirrorPoint(p, anchor, dir));
      if (mirrored.length < 2) continue;
      if (chain.closed) mirrored.push(mirrored[0].clone());
      const entity = ctx.entityById(id);
      void ctx.createEntity(
        { type: "polyline_curve", points: flatten(mirrored) },
        [0, 0, 0],
        entity ? `Mirror of ${entity.name}` : undefined,
      );
      count++;
    }
    ctx.setStatus(`Mirrored ${count} curve(s)`);
    resetMirror(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    if (!mirrorAxis) {
      clearDraft(ctx);
      return;
    }
    const raw = ctx.planePoint(event, mirrorAxis.y);
    if (!raw) {
      clearDraft(ctx);
      return;
    }
    const cursor = ctx.snap(raw).point;
    const dir = cursor.clone().sub(mirrorAxis);
    const len = Math.hypot(dir.x, dir.z);
    if (len < 1e-3) {
      clearDraft(ctx);
      return;
    }
    dir.divideScalar(len);
    const anchor = mirrorAxis;
    const far = 1000;
    const a = new THREE.Vector3(
      mirrorAxis.x - dir.x * far,
      cursor.y,
      mirrorAxis.z - dir.z * far,
    );
    const b = new THREE.Vector3(
      mirrorAxis.x + dir.x * far,
      cursor.y,
      mirrorAxis.z + dir.z * far,
    );
    const axisLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      axisPreviewMaterial(ctx),
    );
    axisLine.computeLineDistances();
    axisLine.renderOrder = 999;
    axisLine.frustumCulled = false;
    const parts: THREE.Object3D[] = [axisLine];
    const mat = accentMaterial(ctx, 0.5);
    for (const { chain } of mirrorSelection(ctx)) {
      const mirrored = chain.points.map((p) => mirrorPoint(p, anchor, dir));
      if (mirrored.length < 2) continue;
      parts.push(polylineObject(mirrored, mat, chain.closed));
    }
    ctx.setPreview(previewGroup(parts), "draft");
    ctx.showMeasure(null);
  },
  onCancel: resetMirror,
  onBackspace: resetMirror,
  hint: () => "Mirror · select sketch curves, then click two points on the mirror axis",
});
