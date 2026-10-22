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

/** Group the entity's triangles by backend face tag. */
export function deriveFaces(entity: EntityData): FaceGroup[] {
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
    out.push({ index: tag, triCount: g.count, normal: [nx, ny, nz] });
  }
  return out;
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
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const s0 = new THREE.Vector3();
  const s1 = new THREE.Vector3();
  const segmentCount = entity.lines.length / 6;
  let best: { segIndex: number; point: THREE.Vector3; distance: number } | null = null;
  let bestPx = thresholdPx;
  for (let seg = 0; seg < segmentCount; seg++) {
    const o = seg * 6;
    v0.set(entity.lines[o], entity.lines[o + 1], entity.lines[o + 2]);
    v1.set(entity.lines[o + 3], entity.lines[o + 4], entity.lines[o + 5]);
    s0.copy(v0).applyMatrix4(object.matrixWorld);
    s1.copy(v1).applyMatrix4(object.matrixWorld);
    const p0 = s0.clone().project(camera);
    const p1 = s1.clone().project(camera);
    if (p0.z < -1 || p0.z > 1 || p1.z < -1 || p1.z > 1) continue;
    const ax = (p0.x * 0.5 + 0.5) * hostSize.width;
    const ay = (-p0.y * 0.5 + 0.5) * hostSize.height;
    const bx = (p1.x * 0.5 + 0.5) * hostSize.width;
    const by = (-p1.y * 0.5 + 0.5) * hostSize.height;
    const px = mousePx.x;
    const py = mousePx.y;
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
      const point = s0.clone().lerp(s1, t);
      best = { segIndex: seg, point, distance: distPx };
    }
  }
  return best;
}
