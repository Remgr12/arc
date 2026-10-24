import * as THREE from "three";
import type { EntityData } from "../lib/types";

// ---------------------------------------------------------------------------
// 2D geometry helpers over the XZ ground plane. All "chains" are world-space
// polylines: [x, y, z] triples where y is usually 0.
// ---------------------------------------------------------------------------

export interface Chain {
  points: THREE.Vector3[];
  closed: boolean;
  entityId: string;
}

export interface PlaneBasis {
  origin: THREE.Vector3;
  normal: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  quat: THREE.Quaternion;
  isHorizontal: boolean;
}

/**
 * Standard CAD orthonormal plane basis (Shapr3D / Fusion 360 / SolidWorks style).
 * - `u`: horizontal axis on screen (perpendicular to world UP (0,1,0) and outward normal N)
 * - `v`: vertical axis on screen (pointing upwards in the plane, N cross u)
 * - `normal`: outward plane normal N
 * - `quat`: rotation matrix mapping local X -> u, local Y -> normal, local Z -> (u cross normal = -v).
 */
export function computePlaneBasis(normal: THREE.Vector3, origin: THREE.Vector3): PlaneBasis {
  const n = normal.clone().normalize();
  const isHorizontalTop = Math.abs(n.x) < 1e-4 && Math.abs(n.z) < 1e-4 && n.y > 0.99;
  const isHorizontalBottom = Math.abs(n.x) < 1e-4 && Math.abs(n.z) < 1e-4 && n.y < -0.99;

  let u: THREE.Vector3;
  let v: THREE.Vector3;
  let quat: THREE.Quaternion;

  if (isHorizontalTop) {
    u = new THREE.Vector3(1, 0, 0);
    v = new THREE.Vector3(0, 0, 1);
    quat = new THREE.Quaternion(); // Identity
  } else if (isHorizontalBottom) {
    u = new THREE.Vector3(1, 0, 0);
    v = new THREE.Vector3(0, 0, -1);
    quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
  } else {
    // 1) Horizontal on screen: perpendicular to world UP (0,1,0) and plane normal N.
    // (0,1,0) cross N points right when facing the plane!
    u = new THREE.Vector3(0, 1, 0).cross(n).normalize();
    // 2) Vertical on screen: points UPWARDS on the plane: N cross u
    v = new THREE.Vector3().crossVectors(n, u).normalize();

    // 3) In local entity space (meshgen.rs):
    //    Local X is (1, 0, 0) -> u
    //    Local Y is (0, 1, 0) -> n
    //    Local Z is (0, 0, 1) -> u cross n (-v)
    const colZ = new THREE.Vector3().crossVectors(u, n).normalize();
    const mat = new THREE.Matrix4().makeBasis(u, n, colZ);
    quat = new THREE.Quaternion().setFromRotationMatrix(mat);
  }

  return { origin: origin.clone(), normal: n, u, v, quat, isHorizontal: isHorizontalTop };
}

const EPS = 1e-6;

/** Sample a circle ring into `segments` points (open list, implicit closure). */
export function ringPoints(center: THREE.Vector3, radius: number, segments = 64): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments;
    out.push(new THREE.Vector3(center.x + radius * Math.cos(a), center.y, center.z + radius * Math.sin(a)));
  }
  return out;
}

/** Extract the world-space polyline of any drawable sketch entity. */
export function chainFromEntity(entity: EntityData, object: THREE.Object3D | null): Chain | null {
  if (!entity) return null;
  const g = entity.geometry as Record<string, unknown>;
  const type = String(g.type ?? "");
  const matrix = object ? object.matrixWorld.clone() : new THREE.Matrix4();
  const toWorld = (p: [number, number, number]) => new THREE.Vector3(...p).applyMatrix4(matrix);

  let points: THREE.Vector3[] | null = null;
  let closed = false;

  switch (type) {
    case "line_curve": {
      const end = (g.end as [number, number, number]) ?? [0, 0, 0];
      points = [toWorld([0, 0, 0]), toWorld(end)];
      break;
    }
    case "polyline_curve": {
      const raw = (g.points as [number, number, number][]) ?? [];
      if (raw.length < 2) return null;
      points = raw.map(toWorld);
      closed = raw.length > 2 && points[0].distanceTo(points[points.length - 1]) < 1e-4;
      if (closed) points = points.slice(0, -1);
      break;
    }
    case "rectangle_curve": {
      const w = Number(g.width ?? 0) / 2;
      const d = Number(g.depth ?? 0) / 2;
      if (w <= 0 || d <= 0) return null;
      points = [
        toWorld([-w, 0, -d]),
        toWorld([w, 0, -d]),
        toWorld([w, 0, d]),
        toWorld([-w, 0, d]),
      ];
      closed = true;
      break;
    }
    case "circle_curve":
    case "polygon_curve": {
      const r = Number(g.radius ?? 0);
      if (r <= 0) return null;
      const sides = type === "polygon_curve" ? Number(g.sides ?? 32) : 64;
      points = [];
      for (let i = 0; i < sides; i++) {
        const a = (Math.PI * 2 * i) / sides;
        points.push(toWorld([r * Math.cos(a), 0, r * Math.sin(a)]));
      }
      closed = true;
      break;
    }
    case "arc_curve": {
      const r = Number(g.radius ?? 0);
      const a0 = (Number(g.start_angle_deg ?? 0) * Math.PI) / 180;
      const a1 = (Number(g.end_angle_deg ?? 0) * Math.PI) / 180;
      const segs = Number(g.segments ?? 48);
      if (r <= 0 || segs < 1) return null;
      points = [];
      for (let i = 0; i <= segs; i++) {
        const a = a0 + ((a1 - a0) * i) / segs;
        points.push(toWorld([r * Math.cos(a), 0, r * Math.sin(a)]));
      }
      break;
    }
    default:
      return null;
  }
  if (!points || points.length < 2) return null;
  return { points, closed, entityId: entity.id };
}

/** Convert world points back to an entity's local space. */
export function toLocal(object: THREE.Object3D, world: THREE.Vector3[]): [number, number, number][] {
  const inv = new THREE.Matrix4().copy(object.matrixWorld).invert();
  return world.map((p) => {
    const l = p.clone().applyMatrix4(inv);
    return [l.x, l.y, l.z] as [number, number, number];
  });
}

export function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(
  p: THREE.Vector3,
  a: THREE.Vector3,
  b: THREE.Vector3,
): { point: THREE.Vector3; t: number; distance: number } {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const len2 = abx * abx + abz * abz;
  let t = 0;
  if (len2 > EPS) {
    t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const point = new THREE.Vector3(a.x + abx * t, a.y, a.z + abz * t);
  return { point, t, distance: point.distanceTo(p) };
}

/** Closest point on a whole chain; returns cumulative parameter u (0..N-1). */
export function closestOnChain(
  p: THREE.Vector3,
  points: THREE.Vector3[],
): { point: THREE.Vector3; u: number; distance: number; segment: number } {
  let best = { point: points[0], u: 0, distance: Infinity, segment: 0 };
  let acc = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const hit = closestOnSegment(p, points[i], points[i + 1]);
    if (hit.distance < best.distance) {
      best = { point: hit.point, u: acc + hit.t, distance: hit.distance, segment: i };
    }
    acc += 1;
  }
  return best;
}

/**
 * Intersect segments ab and cd in XZ. Returns null when parallel or
 * non-intersecting; collinear overlaps are ignored.
 */
export function segmentIntersection(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
): THREE.Vector3 | null {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const denom = r.x * s.z - r.z * s.x;
  if (Math.abs(denom) < EPS) return null;
  const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / denom;
  const u = ((c.x - a.x) * r.z - (c.z - a.z) * r.x) / denom;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
  return new THREE.Vector3(a.x + r.x * t, a.y, a.z + r.z * t);
}

/** All intersections of one chain against a set of other chains. */
export function chainIntersections(
  chain: THREE.Vector3[],
  others: { points: THREE.Vector3[]; entityId: string }[],
  selfId: string,
): { u: number; point: THREE.Vector3; otherId: string; segment: number }[] {
  const out: { u: number; point: THREE.Vector3; otherId: string; segment: number }[] = [];
  for (const other of others) {
    if (other.entityId === selfId) continue;
    for (let i = 0; i < chain.length - 1; i++) {
      for (let j = 0; j < other.points.length - 1; j++) {
        const hit = segmentIntersection(chain[i], chain[i + 1], other.points[j], other.points[j + 1]);
        if (hit) out.push({ u: i, point: hit, otherId: other.entityId, segment: j });
      }
    }
  }
  return out.sort((p, q) => p.u - q.u);
}

/**
 * Offset a polyline by `distance` in XZ. Positive distance offsets to the
 * left of travel direction for open chains, outward for closed CCW loops.
 * Uses miter joins with a length clamp to avoid spikes.
 */
export function offsetPolyline(
  points: THREE.Vector3[],
  closed: boolean,
  distance: number,
  miterLimit = 4,
): THREE.Vector3[] {
  const n = points.length;
  if (n < 2 || Math.abs(distance) < EPS) return points.map((p) => p.clone());
  const loop = closed && n > 2;

  const normals: { x: number; z: number }[] = [];
  const count = loop ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    // Left normal of travel direction (x, z) is (-z, x)... in XZ with Y up,
    // left of direction (dx,dz) is (dz, -dx). Verified: direction +X → left is -Z? For Y-up
    // right-handed coords, "left" when walking along +X is -Z? Walking +X with up +Y,
    // left hand points to +Z. Use (dz, -dx) for CCW-outward on closed loops.
    normals.push({ x: dz / len, z: -dx / len });
  }

  const offsetPoint = (i: number, nrm: { x: number; z: number }) =>
    new THREE.Vector3(points[i].x + nrm.x * distance, points[i].y, points[i].z + nrm.z * distance);

  if (!loop) {
    const out: THREE.Vector3[] = [offsetPoint(0, normals[0])];
    for (let i = 1; i < n - 1; i++) {
      out.push(miterJoin(points[i], normals[i - 1], normals[i], distance, miterLimit));
    }
    out.push(offsetPoint(n - 1, normals[n - 2]));
    return out;
  }

  const out: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const prev = normals[(i - 1 + n) % n];
    const next = normals[i];
    out.push(miterJoin(points[i], prev, next, distance, miterLimit));
  }
  return out;
}

function miterJoin(
  p: THREE.Vector3,
  n1: { x: number; z: number },
  n2: { x: number; z: number },
  distance: number,
  miterLimit: number,
): THREE.Vector3 {
  const mx = n1.x + n2.x;
  const mz = n1.z + n2.z;
  const lenSq = mx * mx + mz * mz;
  if (lenSq < EPS) {
    // 180° reversal: use either normal.
    return new THREE.Vector3(p.x + n2.x * distance, p.y, p.z + n2.z * distance);
  }
  const dot = n1.x * n2.x + n1.z * n2.z;
  let scale = distance / (1 + dot);
  // Clamp the miter spike (|scale| * |m| is the corner-to-miter length).
  const miterLen = Math.abs(scale) * Math.sqrt(lenSq);
  const limit = miterLimit * Math.abs(distance);
  if (miterLen > limit && limit > EPS) {
    scale = (scale * limit) / miterLen;
  }
  return new THREE.Vector3(p.x + mx * scale, p.y, p.z + mz * scale);
}

/**
 * Circumcircle of three points in XZ. Returns null for collinear input.
 */
export function circumcircle(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): { center: THREE.Vector3; radius: number } | null {
  const d = 2 * (a.x * (b.z - c.z) + b.x * (c.z - a.z) + c.x * (a.z - b.z));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.z * a.z;
  const b2 = b.x * b.x + b.z * b.z;
  const c2 = c.x * c.x + c.z * c.z;
  const ux = (a2 * (b.z - c.z) + b2 * (c.z - a.z) + c2 * (a.z - b.z)) / d;
  const uz = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = new THREE.Vector3(ux, a.y, uz);
  return { center, radius: center.distanceTo(a) };
}

const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Fit an arc through start → mid → end. Returns kernel arc_curve params. */
export function arcThrough3(
  start: THREE.Vector3,
  mid: THREE.Vector3,
  end: THREE.Vector3,
): { center: THREE.Vector3; radius: number; startAngle: number; endAngle: number } | null {
  const cc = circumcircle(start, mid, end);
  if (!cc) return null;
  const angleOf = (p: THREE.Vector3) => (Math.atan2(p.z - cc.center.z, p.x - cc.center.x) * 180) / Math.PI;
  const a0 = angleOf(start);
  const am = angleOf(mid);
  const a1 = angleOf(end);
  const dMid = norm360(am - a0);
  const dEnd = norm360(a1 - a0);
  // Sweep from a0 that passes through mid. gen_arc interpolates linearly, so
  // a negative (end - start) yields a clockwise sweep.
  let sweep = dEnd;
  if (dMid > dEnd) sweep = dEnd - 360;
  if (Math.abs(sweep) < 0.01) return null;
  return { center: cc.center, radius: cc.radius, startAngle: a0, endAngle: a0 + sweep };
}

/** Resample a closed loop to exactly `n` points by arc-length parameter. */
export function resampleLoop(points: THREE.Vector3[], n: number): THREE.Vector3[] {
  const m = points.length;
  if (m === 0 || n <= 0) return [];
  const lens: number[] = [];
  let total = 0;
  for (let i = 0; i < m; i++) {
    const l = points[i].distanceTo(points[(i + 1) % m]);
    lens.push(l);
    total += l;
  }
  if (total < EPS) return Array.from({ length: n }, () => points[0].clone());
  const out: THREE.Vector3[] = [];
  for (let k = 0; k < n; k++) {
    let target = (total * k) / n;
    let i = 0;
    while (i < m - 1 && target > lens[i]) {
      target -= lens[i];
      i++;
    }
    const t = lens[i] > EPS ? Math.min(1, target / lens[i]) : 0;
    const a = points[i];
    const b = points[(i + 1) % m];
    out.push(new THREE.Vector3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
  }
  return out;
}

/** Signed area of a closed XZ polygon (positive = CCW when viewed from +Y). */
export function polygonAreaXZ(points: THREE.Vector3[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.z - b.x * a.z;
  }
  return area / 2;
}

/** Point-in-polygon test in XZ (ray casting). */
export function pointInPolygon(p: THREE.Vector3, poly: THREE.Vector3[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const zi = poly[i].z;
    const xj = poly[j].x;
    const zj = poly[j].z;
    if (zi > p.z !== zj > p.z && p.x < ((xj - xi) * (p.z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Mirror points across an infinite line through a with direction d. */
export function mirrorPoint(p: THREE.Vector3, a: THREE.Vector3, d: THREE.Vector3): THREE.Vector3 {
  const len2 = d.x * d.x + d.z * d.z;
  if (len2 < EPS) return p.clone();
  // Projection of (p - a) onto d.
  const t = ((p.x - a.x) * d.x + (p.z - a.z) * d.z) / len2;
  const foot = new THREE.Vector3(a.x + d.x * t, p.y, a.z + d.z * t);
  return new THREE.Vector3(2 * foot.x - p.x, p.y, 2 * foot.z - p.z);
}

/**
 * Fillet the corner at `index` of a polyline with the given radius.
 * Returns replacement points for the corner (tangent points + arc samples),
 * or null when the fillet is impossible.
 */
export function filletCorner(
  points: THREE.Vector3[],
  index: number,
  radius: number,
  segments = 12,
): { trimStart: number; trimEnd: number; arc: THREE.Vector3[] } | null {
  const n = points.length;
  if (index <= 0 || index >= n - 1) return null;
  const p = points[index];
  const a = points[index - 1];
  const b = points[index + 1];
  const d1 = new THREE.Vector3(p.x - a.x, 0, p.z - a.z);
  const d2 = new THREE.Vector3(b.x - p.x, 0, b.z - p.z);
  const l1 = d1.length();
  const l2 = d2.length();
  if (l1 < EPS || l2 < EPS) return null;
  d1.divideScalar(l1);
  d2.divideScalar(l2);
  const cross = d1.x * d2.z - d1.z * d2.x;
  if (Math.abs(cross) < 1e-4) return null; // collinear
  const interior = Math.PI - Math.acos(Math.max(-1, Math.min(1, d1.dot(d2))));
  const maxR = Math.min(l1, l2) * Math.tan(interior / 2);
  const r = Math.min(radius, maxR * 0.98);
  if (r < EPS) return null;
  const t = r / Math.tan(interior / 2);
  const tanA = new THREE.Vector3(p.x - d1.x * t, p.y, p.z - d1.z * t);
  const tanB = new THREE.Vector3(p.x + d2.x * t, p.y, p.z + d2.z * t);
  // Arc center: offset both tangents by r toward the interior.
  const n1 = new THREE.Vector3(-d1.z, 0, d1.x).multiplyScalar(cross > 0 ? r : -r);
  const n2 = new THREE.Vector3(-d2.z, 0, d2.x).multiplyScalar(cross > 0 ? r : -r);
  const c1 = new THREE.Vector3(tanA.x + n1.x, p.y, tanA.z + n1.z);
  const c2 = new THREE.Vector3(tanB.x + n2.x, p.y, tanB.z + n2.z);
  const center = new THREE.Vector3((c1.x + c2.x) / 2, p.y, (c1.z + c2.z) / 2);
  const a0 = Math.atan2(tanA.z - center.z, tanA.x - center.x);
  const a1 = Math.atan2(tanB.z - center.z, tanB.x - center.x);
  let sweep = a1 - a0;
  if (cross > 0 ? sweep < 0 : sweep > 0) sweep += cross > 0 ? Math.PI * 2 : -Math.PI * 2;
  const arc: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const ang = a0 + (sweep * i) / segments;
    arc.push(new THREE.Vector3(center.x + r * Math.cos(ang), p.y, center.z + r * Math.sin(ang)));
  }
  return { trimStart: t, trimEnd: t, arc };
}
