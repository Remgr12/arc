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

  const triCount = Math.floor(positions.length / 9);
  // Backend mesh buffer pushes 3 entries per triangle into tri_face_ids (one per vertex)
  const stride = tags.length === Math.floor(positions.length / 3) ? 3 : 1;
  // Per-tag: triangle count, normal histogram.
  const groups = new Map<number, { count: number; norms: Map<string, number> }>();
  for (let tri = 0; tri < triCount; tri++) {
    const tag = tags[tri * stride];
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
    const normals = entity.triNormals;
    const triCount = Math.floor(positions.length / 9);
    const stride = tags.length === Math.floor(positions.length / 3) ? 3 : 1;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let count = 0;
    let normX = 0;
    let normY = 0;
    let normZ = 0;
    for (let tri = 0; tri < triCount; tri++) {
      if (tags[tri * stride] !== faceIndex) continue;
      const o = tri * 9;
      cx += positions[o] + positions[o + 3] + positions[o + 6];
      cy += positions[o + 1] + positions[o + 4] + positions[o + 7];
      cz += positions[o + 2] + positions[o + 5] + positions[o + 8];
      count += 3;
      if (normals && o + 8 < normals.length) {
        normX += normals[o] + normals[o + 3] + normals[o + 6];
        normY += normals[o + 1] + normals[o + 4] + normals[o + 7];
        normZ += normals[o + 2] + normals[o + 5] + normals[o + 8];
      }
    }
    if (count > 0) {
      const worldOrigin = new THREE.Vector3(cx / count, cy / count, cz / count).applyMatrix4(mat);
      let localN: THREE.Vector3;
      if (Math.hypot(normX, normY, normZ) > 1e-4) {
        localN = new THREE.Vector3(normX, normY, normZ).normalize();
      } else {
        const group = deriveFaces(entity).find((f) => f.index === faceIndex);
        localN = group ? new THREE.Vector3(...group.normal) : new THREE.Vector3(0, 1, 0);
      }
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

  // Fallback when faceIndex is null or mesh has no tags:
  // Detect top-most horizontal surface of the entity
  if (entity.triPositions && entity.triPositions.length >= 9) {
    const posArr = entity.triPositions;
    let maxY = -Infinity;
    let sumX = 0;
    let sumZ = 0;
    let topCount = 0;
    for (let i = 0; i < posArr.length; i += 3) {
      if (posArr[i + 1] > maxY) maxY = posArr[i + 1];
    }
    for (let i = 0; i < posArr.length; i += 3) {
      if (Math.abs(posArr[i + 1] - maxY) < 1e-3) {
        sumX += posArr[i];
        sumZ += posArr[i + 2];
        topCount++;
      }
    }
    if (topCount > 0) {
      const topOrigin = new THREE.Vector3(sumX / topCount, maxY, sumZ / topCount).applyMatrix4(mat);
      const topNormal = new THREE.Vector3(0, 1, 0).applyNormalMatrix(normalMat).normalize();
      return {
        origin: [topOrigin.x, topOrigin.y, topOrigin.z],
        normal: [topNormal.x, topNormal.y, topNormal.z],
        height: topOrigin.y,
        label: `Top Face (Y = ${Math.round(topOrigin.y * 100) / 100})`,
      };
    }
  }

  const py = entity.transform.position[1] ?? 0;
  const geom = entity.geometry as Record<string, unknown>;
  const h = typeof geom.height === "number" ? geom.height : 0;
  // Primitives are extruded upwards from py, so the top is py + h (never inside the body)
  const elev = py + h;
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
  const triCount = Math.floor(positions.length / 9);
  const stride = tags.length === Math.floor(positions.length / 3) ? 3 : 1;
  for (let tri = 0; tri < triCount; tri++) {
    if (tags[tri * stride] !== faceIndex) continue;
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
  const halfW = hostSize.width * 0.5;
  const halfH = hostSize.height * 0.5;
  const px = mousePx.x;
  const py = mousePx.y;

  // Screen-space bounding sphere early reject: avoids iterating every segment on distant objects
  const geom = (object as THREE.Mesh).geometry;
  if (geom) {
    if (!geom.boundingSphere) geom.computeBoundingSphere();
    const sphere = geom.boundingSphere;
    if (sphere && Number.isFinite(sphere.radius) && sphere.radius > 0) {
      _s0.copy(sphere.center).applyMatrix4(object.matrixWorld);
      const camDist = camera.position.distanceTo(_s0);
      _p0.copy(_s0).project(camera);
      if (_p0.z < -1 || _p0.z > 1) return null;
      const sx = (_p0.x + 1) * halfW;
      const sy = (-_p0.y + 1) * halfH;
      const fov = (camera as THREE.PerspectiveCamera).fov ?? 50;
      const fovRad = (fov * Math.PI) / 180;
      const projRadius = (sphere.radius / Math.max(0.1, camDist * Math.tan(fovRad * 0.5))) * halfH;
      const distToCenter = Math.hypot(px - sx, py - sy);
      if (distToCenter > projRadius + thresholdPx + 20) {
        return null;
      }
    }
  }

  const lines = entity.lines;
  const segmentCount = lines.length / 6;
  let bestSeg = -1;
  let bestPoint: THREE.Vector3 | null = null;
  let bestPx = thresholdPx;

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

/**
 * Extract the 2D planar polygon boundary of a solid face (in basis UV coordinates).
 * Used for generalized direct push-pull on arbitrary B-rep & boolean solids.
 */
export function faceBoundaryPolygon(
  entity: EntityData,
  faceIndex: number,
  basis: { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; normal: THREE.Vector3 },
): [number, number][] | null {
  const tags = entity.triFaceIds;
  const positions = entity.triPositions;
  if (!tags || !positions || positions.length < 9) return null;

  const triCount = Math.floor(positions.length / 9);
  const stride = tags.length === Math.floor(positions.length / 3) ? 3 : 1;

  // Track directed boundary edges: key -> count & [p1, p2]
  const edgeCount = new Map<string, { p1: THREE.Vector3; p2: THREE.Vector3; count: number }>();
  const pos = new THREE.Vector3(...entity.transform.position);
  const quat = new THREE.Quaternion(...entity.transform.rotation);
  const scl = new THREE.Vector3(...entity.transform.scale);
  const mat = new THREE.Matrix4().compose(pos, quat, scl);

  const hashPt = (v: THREE.Vector3) =>
    `${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`;

  for (let tri = 0; tri < triCount; tri++) {
    if (tags[tri * stride] !== faceIndex) continue;
    const o = tri * 9;
    const p0 = new THREE.Vector3(positions[o], positions[o + 1], positions[o + 2]).applyMatrix4(mat);
    const p1 = new THREE.Vector3(positions[o + 3], positions[o + 4], positions[o + 5]).applyMatrix4(mat);
    const p2 = new THREE.Vector3(positions[o + 6], positions[o + 7], positions[o + 8]).applyMatrix4(mat);

    const triEdges: [THREE.Vector3, THREE.Vector3][] = [
      [p0, p1],
      [p1, p2],
      [p2, p0],
    ];

    for (const [a, b] of triEdges) {
      const hA = hashPt(a);
      const hB = hashPt(b);
      const key = hA < hB ? `${hA}-${hB}` : `${hB}-${hA}`;
      const existing = edgeCount.get(key);
      if (existing) {
        existing.count++;
      } else {
        edgeCount.set(key, { p1: a, p2: b, count: 1 });
      }
    }
  }

  // Boundary edges belong to exactly one triangle in this face
  const boundary: { p1: THREE.Vector3; p2: THREE.Vector3 }[] = [];
  for (const entry of edgeCount.values()) {
    if (entry.count === 1) {
      boundary.push({ p1: entry.p1, p2: entry.p2 });
    }
  }

  if (boundary.length < 3) return null;

  // Chain boundary edges into an ordered loop
  const loop: THREE.Vector3[] = [boundary[0].p1, boundary[0].p2];
  const used = new Set<number>([0]);

  while (loop.length < boundary.length + 1) {
    const cur = loop[loop.length - 1];
    let found = false;
    for (let i = 0; i < boundary.length; i++) {
      if (used.has(i)) continue;
      const b = boundary[i];
      if (b.p1.distanceTo(cur) < 1e-3) {
        loop.push(b.p2);
        used.add(i);
        found = true;
        break;
      } else if (b.p2.distanceTo(cur) < 1e-3) {
        loop.push(b.p1);
        used.add(i);
        found = true;
        break;
      }
    }
    if (!found) break;
  }

  // Remove duplicate closure point if present
  if (loop.length > 3 && loop[0].distanceTo(loop[loop.length - 1]) < 1e-3) {
    loop.pop();
  }

  if (loop.length < 3) return null;

  // Project loop to 2D plane UV
  return loop.map((p) => {
    const rel = p.clone().sub(basis.origin);
    return [rel.dot(basis.u), -rel.dot(basis.v)] as [number, number];
  });
}
