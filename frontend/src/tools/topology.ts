import * as THREE from "three";
import type { EntityData } from "../lib/types";

// ---------------------------------------------------------------------------
// Topology helpers for face/edge picking.
//
// The backend tags every triangle of a meshed entity with a face group id
// (`EntityData.triFaceIds`, one entry per triangle). Faces are identified by
// that group id; entities without tags (imports, meshes) fall back to
// whole-entity picking.
//
// Edge identity is segment-based: the entity's `lines` array holds segment
// pairs (6 floats per segment, local coordinates); pick by segment index.
// ---------------------------------------------------------------------------

export interface FaceGroup {
  index: number;
  /** Number of triangles in the group. */
  triCount: number;
  /** Representative (most frequent) normal of the triangles. */
  normal: [number, number, number];
}

export interface FaceHit {
  entityId: string;
  faceIndex: number;
  distance: number;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface EdgeHit {
  entityId: string;
  segIndex: number;
  /** Stable edge key: `${entityId}:${segIndex}`. */
  key: string;
  distance: number;
  point: [number, number, number];
}

const faceGroupCache = new WeakMap<EntityData, FaceGroup[]>();

/** Group the entity's triangles by backend face tag (cached per entity snapshot). */
export function deriveFaces(entity: EntityData): FaceGroup[] {
  const cached = faceGroupCache.get(entity);
  if (cached) return cached;
  const tags = entity.triFaceIds;
  const positions = entity.triPositions;
  const normals = entity.triNormals;
  if (!tags || !positions || tags.length === 0) return [];

  const triCount = Math.min(positions.length / 9, tags.length);
  // Per-tag: triangle count, normal histogram.
  const groups = new Map<number, { count: number; norms: Map<string, number> }>();
  for (let tri = 0; tri < triCount; tri++) {
    const tag = tags[tri];
    let g = groups.get(tag);
    if (!g) {
      g = { count: 0, norms: new Map() };
      groups.set(tag, g);
    }
    g.count++;
    if (normals) {
      const o = tri * 9;
      const nx = normals[o] ?? 0;
      const ny = normals[o + 1] ?? 0;
      const nz = normals[o + 2] ?? 0;
      // Quantize to avoid float noise splitting the mode.
      const key = `${Math.round(nx * 100)},${Math.round(ny * 100)},${Math.round(nz * 100)}`;
      g.norms.set(key, (g.norms.get(key) ?? 0) + 1);
    }
  }

  const out: FaceGroup[] = [];
  const ordered = [...groups.keys()].sort((a, b) => a - b);
  for (const tag of ordered) {
    const g = groups.get(tag)!;
    let best = "0,1,0";
    let bestCount = -1;
    for (const [key, count] of g.norms) {
      if (count > bestCount) {
        bestCount = count;
        best = key;
      }
    }
    const [nx, ny, nz] = best.split(",").map(Number);
    const len = Math.hypot(nx, ny, nz) || 1;
    out.push({ index: tag, triCount: g.count, normal: [nx / len, ny / len, nz / len] });
  }
  faceGroupCache.set(entity, out);
  return out;
}

/**
 * Compute world-space plane origin, normal, and label for a selected face on an entity
 * (or the entity's top horizontal face when `faceIndex === null`).
 */
export function facePlaneInfo(
  entity: EntityData,
  faceIndex: number | null,
): {
  origin: [number, number, number];
  normal: [number, number, number];
  height: number;
  label: string;
} {
  const pos = new THREE.Vector3(...entity.transform.position);
  const quat = new THREE.Quaternion(...entity.transform.rotation);
  const scl = new THREE.Vector3(...entity.transform.scale);
  const mat = new THREE.Matrix4().compose(pos, quat, scl);
  const normalMat = new THREE.Matrix3().getNormalMatrix(mat);

  if (faceIndex !== null && entity.triFaceIds && entity.triPositions) {
    const tags = entity.triFaceIds;
    const positions = entity.triPositions;
    const tris = Math.min(positions.length / 9, tags.length);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    for (let tri = 0; tri < tris; tri++) {
      if (tags[tri] !== faceIndex) continue;
      const o = tri * 9;
      cx += positions[o] + positions[o + 3] + positions[o + 6];
      cy += positions[o + 1] + positions[o + 4] + positions[o + 7];
      cz += positions[o + 2] + positions[o + 5] + positions[o + 8];
      count += 3;
    }
    if (count > 0) {
      const worldOrigin = new THREE.Vector3(cx / count, cy / count, cz / count).applyMatrix4(mat);
      const group = deriveFaces(entity).find((f) => f.index === faceIndex);
      const localN = group
        ? new THREE.Vector3(...group.normal)
        : new THREE.Vector3(0, 1, 0);
      const worldN = localN.applyNormalMatrix(normalMat).normalize();
      const nArr: [number, number, number] = [worldN.x, worldN.y, worldN.z];
      const oArr: [number, number, number] = [worldOrigin.x, worldOrigin.y, worldOrigin.z];
      const dist = worldOrigin.dot(worldN);
      const r = (v: number) => Math.round(v * 100) / 100;
      let label = `Face ${faceIndex} Plane`;
      if (Math.abs(worldN.y) > 0.98) label = `Face Plane (Y = ${r(worldOrigin.y)})`;
      else if (Math.abs(worldN.z) > 0.98) label = `Vertical Face (Z = ${r(worldOrigin.z)})`;
      else if (Math.abs(worldN.x) > 0.98) label = `Side Face (X = ${r(worldOrigin.x)})`;
      return { origin: oArr, normal: nArr, height: dist, label };
    }
  }

  const py = entity.transform.position[1] ?? 0;
  const geom = entity.geometry as Record<string, unknown>;
  const h = typeof geom.height === "number" ? geom.height : 0;
  const elev = entity.kind === "box" || entity.kind === "extrude" ? py + h / 2 : py + h;
  return {
    origin: [pos.x, elev, pos.z],
    normal: [0, 1, 0],
    height: elev,
    label: `Face Plane (Y = ${Math.round(elev * 100) / 100})`,
  };
}

/** Build a local-space overlay geometry for one face group of the entity. */
export function faceOverlayGeometry(
  entity: EntityData,
  faceIndex: number,
): THREE.BufferGeometry | null {
  const tags = entity.triFaceIds;
  const positions = entity.triPositions;
  if (!tags || !positions || entity.triPositions?.length === 0) return null;
  const out: number[] = [];
  const tris = Math.min(positions.length / 9, tags.length);
  for (let tri = 0; tri < tris; tri++) {
    if (tags[tri] !== faceIndex) continue;
    const o = tri * 9;
    out.push(
      positions[o], positions[o + 1], positions[o + 2],
      positions[o + 3], positions[o + 4], positions[o + 5],
      positions[o + 6], positions[o + 7], positions[o + 8],
    );
  }
  if (out.length < 9) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(out, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Local-space line geometry for one segment of the entity. */
export function edgeOverlayGeometry(
  entity: EntityData,
  segIndex: number,
): THREE.BufferGeometry | null {
  if (!entity.lines || entity.lines.length < (segIndex + 1) * 6) return null;
  const o = segIndex * 6;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(entity.lines.slice(o, o + 6), 3),
  );
  return geometry;
}

/**
 * Screen-space nearest-segment edge pick. Segments closer than `thresholdPx`
 * (in host pixels) qualify; the closest wins.
 */
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _s0 = new THREE.Vector3();
const _s1 = new THREE.Vector3();
const _p0 = new THREE.Vector3();
const _p1 = new THREE.Vector3();

/**
 * Screen-space nearest-segment edge pick. Segments closer than `thresholdPx`
 * (in host pixels) qualify; the closest wins. Zero heap allocations in the loop.
 */
export function pickEdgeScreen(
  entity: EntityData,
  object: THREE.Object3D,
  camera: THREE.Camera,
  mousePx: { x: number; y: number },
  hostSize: { width: number; height: number },
  thresholdPx = 8,
): { segIndex: number; point: THREE.Vector3; distance: number } | null {
  if (!entity.lines || entity.lines.length < 6) return null;
  object.updateMatrixWorld();
  const lines = entity.lines;
  const segmentCount = lines.length / 6;
  let bestSeg = -1;
  let bestPoint: THREE.Vector3 | null = null;
  let bestPx = thresholdPx;
  const halfW = hostSize.width * 0.5;
  const halfH = hostSize.height * 0.5;
  const px = mousePx.x;
  const py = mousePx.y;

  for (let seg = 0; seg < segmentCount; seg++) {
    const o = seg * 6;
    _v0.set(lines[o], lines[o + 1], lines[o + 2]);
    _v1.set(lines[o + 3], lines[o + 4], lines[o + 5]);
    _s0.copy(_v0).applyMatrix4(object.matrixWorld);
    _s1.copy(_v1).applyMatrix4(object.matrixWorld);
    _p0.copy(_s0).project(camera);
    _p1.copy(_s1).project(camera);
    if (_p0.z < -1 || _p0.z > 1 || _p1.z < -1 || _p1.z > 1) continue;
    const ax = (_p0.x + 1) * halfW;
    const ay = (-_p0.y + 1) * halfH;
    const bx = (_p1.x + 1) * halfW;
    const by = (-_p1.y + 1) * halfH;
    // Quick AABB reject in screen space before hypot/dot
    if (
      px < Math.min(ax, bx) - bestPx ||
      px > Math.max(ax, bx) + bestPx ||
      py < Math.min(ay, by) - bestPx ||
      py > Math.max(ay, by) + bestPx
    ) {
      continue;
    }
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const distPx = Math.hypot(px - cx, py - cy);
    if (distPx < bestPx) {
      bestPx = distPx;
      bestSeg = seg;
      if (!bestPoint) bestPoint = new THREE.Vector3();
      bestPoint.copy(_s0).lerp(_s1, t);
    }
  }
  return bestSeg >= 0 && bestPoint ? { segIndex: bestSeg, point: bestPoint, distance: bestPx } : null;
}
