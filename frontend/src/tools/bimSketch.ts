import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { getActiveStorey } from "./architecture";
import type { EntityData } from "../lib/types";

// ---------------------------------------------------------------------------
// Traditional BIM Sketch Mode / Boundary Edit System
// Modeled after Revit & BIMCraft:
// - Footprint boundary loop validation & area diagnostics
// - Target BIM element selection (Floor Slab, Roof, Ceiling, Room Space)
// - One-click "Pick Walls" tracing
// - Commit (Finish Edit Mode) & Cancel (Discard Edit Mode)
// ---------------------------------------------------------------------------

export type BimSketchTarget = "slab" | "roof" | "ceiling" | "room" | "extrude";

export interface BoundaryDiagnostic {
  hasClosedLoop: boolean;
  closedLoops: [number, number][][];
  totalAreaM2: number;
  totalPerimeterM: number;
  openEndsCount: number;
  sketchEntities: EntityData[];
}

export function shoelaceAreaM2(poly: [number, number][]): number {
  if (poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i][0] * poly[j][1] - poly[j][0] * poly[i][1];
  }
  return (Math.abs(a) * 0.5) / 10000;
}

export function polygonPerimeterM(poly: [number, number][]): number {
  if (poly.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    len += Math.hypot(poly[j][0] - poly[i][0], poly[j][1] - poly[i][1]);
  }
  return len / 100;
}

interface Segment {
  start: [number, number];
  end: [number, number];
}

/** Extracts closed boundary polygon loops from all sketch entities on the active plane. */
export function extractClosedBoundaries(entities: EntityData[]): BoundaryDiagnostic {
  const sketchEntities = entities.filter(
    (e) =>
      e.visible &&
      (e.category === "sketch" ||
        e.kind === "line" ||
        e.kind === "line_curve" ||
        e.kind === "polyline" ||
        e.kind === "polyline_curve" ||
        e.kind === "rectangle" ||
        e.kind === "rectangle_curve" ||
        e.kind === "circle" ||
        e.kind === "circle_curve" ||
        e.kind === "polygon" ||
        e.kind === "polygon_curve"),
  );

  const closedLoops: [number, number][][] = [];
  const segments: Segment[] = [];

  for (const e of sketchEntities) {
    const g = e.geometry as Record<string, unknown> | undefined;
    if (!g) continue;
    const tx = e.transform?.position?.[0] ?? 0;
    const tz = e.transform?.position?.[2] ?? 0;

    // 1. Rectangle
    if (e.kind === "rectangle" || e.kind === "rectangle_curve") {
      const w = Number(g.width) || 100;
      const d = Number(g.depth) || 100;
      closedLoops.push([
        [tx - w / 2, tz - d / 2],
        [tx + w / 2, tz - d / 2],
        [tx + w / 2, tz + d / 2],
        [tx - w / 2, tz + d / 2],
      ]);
      continue;
    }

    // 2. Regular Polygon
    if (e.kind === "polygon" || e.kind === "polygon_curve") {
      const r = Number(g.radius) || 50;
      const sides = Math.max(3, Number(g.sides) || 6);
      const pts: [number, number][] = [];
      for (let s = 0; s < sides; s++) {
        const ang = (s / sides) * Math.PI * 2;
        pts.push([tx + Math.cos(ang) * r, tz + Math.sin(ang) * r]);
      }
      closedLoops.push(pts);
      continue;
    }

    // 3. Circle (discretized to 32 boundary vertices)
    if (e.kind === "circle" || e.kind === "circle_curve") {
      const r = Number(g.radius) || 50;
      const pts: [number, number][] = [];
      for (let s = 0; s < 32; s++) {
        const ang = (s / 32) * Math.PI * 2;
        pts.push([tx + Math.cos(ang) * r, tz + Math.sin(ang) * r]);
      }
      closedLoops.push(pts);
      continue;
    }

    // 4. Polyline
    if (e.kind === "polyline" || e.kind === "polyline_curve") {
      const pts = (g.points as [number, number, number][]) ?? [];
      if (pts.length >= 3) {
        const pFirst = pts[0];
        const pLast = pts[pts.length - 1];
        const dist = Math.hypot(pFirst[0] - pLast[0], pFirst[2] - pLast[2]);
        if (dist < 1.0) {
          // Closed polyline loop
          const loop: [number, number][] = pts
            .slice(0, pts.length - 1)
            .map((p) => [p[0] + tx, p[2] + tz]);
          closedLoops.push(loop);
          continue;
        }
      }
      // Open polyline: decompose into segments
      for (let i = 0; i < pts.length - 1; i++) {
        segments.push({
          start: [pts[i][0] + tx, pts[i][2] + tz],
          end: [pts[i + 1][0] + tx, pts[i + 1][2] + tz],
        });
      }
      continue;
    }

    // 5. Line segments
    if (e.kind === "line" || e.kind === "line_curve") {
      const end = (g.end as [number, number, number]) ?? [0, 0, 0];
      segments.push({
        start: [tx, tz],
        end: [tx + end[0], tz + end[2]],
      });
    }
  }

  // 6. Chain connected segments into closed loops
  const remaining = [...segments];
  const tol = 3.0; // 3cm endpoint connection tolerance

  while (remaining.length > 0) {
    const first = remaining.shift()!;
    const chain: [number, number][] = [first.start, first.end];

    let extended = true;
    while (extended && remaining.length > 0) {
      extended = false;
      const tail = chain[chain.length - 1];

      // Check if tail connects back to the start of the chain (loop closed!)
      if (
        chain.length >= 3 &&
        Math.hypot(tail[0] - chain[0][0], tail[1] - chain[0][1]) < tol
      ) {
        chain.pop(); // remove duplicate closing point
        closedLoops.push(chain);
        break;
      }

      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const dStart = Math.hypot(tail[0] - seg.start[0], tail[1] - seg.start[1]);
        const dEnd = Math.hypot(tail[0] - seg.end[0], tail[1] - seg.end[1]);

        if (dStart < tol) {
          chain.push(seg.end);
          remaining.splice(i, 1);
          extended = true;
          break;
        } else if (dEnd < tol) {
          chain.push(seg.start);
          remaining.splice(i, 1);
          extended = true;
          break;
        }
      }
    }

    // Final check for chain loop closure
    if (chain.length >= 3) {
      const tail = chain[chain.length - 1];
      if (Math.hypot(tail[0] - chain[0][0], tail[1] - chain[0][1]) < tol) {
        chain.pop();
        closedLoops.push(chain);
      }
    }
  }

  let totalArea = 0;
  let totalPeri = 0;
  for (const loop of closedLoops) {
    totalArea += shoelaceAreaM2(loop);
    totalPeri += polygonPerimeterM(loop);
  }

  return {
    hasClosedLoop: closedLoops.length > 0,
    closedLoops,
    totalAreaM2: totalArea,
    totalPerimeterM: totalPeri,
    openEndsCount: segments.length > 0 && closedLoops.length === 0 ? segments.length : 0,
    sketchEntities,
  };
}

/** Commits the sketch boundary into a finished BIM element on the active storey. */
export async function commitBimBoundary(target: BimSketchTarget): Promise<{
  success: boolean;
  name?: string;
  areaM2?: number;
  message?: string;
}> {
  const st = useArcStore.getState();
  const scene = st.scene;
  const docId = st.overview?.active;
  if (!docId) return { success: false, message: "No active project document" };

  const diag = extractClosedBoundaries(scene?.entities ?? []);
  if (!diag.hasClosedLoop || diag.closedLoops.length === 0) {
    return {
      success: false,
      message:
        "Boundary is not closed. All endpoints must meet to form a closed footprint loop.",
    };
  }

  // Pick largest closed loop as the primary footprint
  const polygon = diag.closedLoops.reduce((largest, curr) =>
    shoelaceAreaM2(curr) > shoelaceAreaM2(largest) ? curr : largest,
  );
  const areaM2 = shoelaceAreaM2(polygon);
  const storey = getActiveStorey();
  let entityName = "";

  if (target === "slab") {
    entityName = `Floor Slab (${areaM2.toFixed(1)} m²)`;
    await ipc.createEntity(
      docId,
      {
        type: "slab",
        polygon,
        height: 20,
      },
      entityName,
      {
        position: [0, storey.elevation, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    );
  } else if (target === "roof") {
    let minX = Infinity,
      maxX = -Infinity,
      minZ = Infinity,
      maxZ = -Infinity;
    for (const p of polygon) {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minZ) minZ = p[1];
      if (p[1] > maxZ) maxZ = p[1];
    }
    const w = Math.max(50, maxX - minX);
    const d = Math.max(50, maxZ - minZ);
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    entityName = `Roof 30° (${(w / 100).toFixed(1)}×${(d / 100).toFixed(1)}m)`;

    await ipc.createEntity(
      docId,
      {
        type: "roof",
        width: w,
        depth: d,
        pitch_deg: 30,
        overhang: 40,
      },
      entityName,
      {
        position: [cx, storey.elevation + storey.height, cz],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    );
  } else if (target === "ceiling") {
    entityName = `Ceiling Plate (${areaM2.toFixed(1)} m²)`;
    await ipc.createEntity(
      docId,
      {
        type: "slab",
        polygon,
        height: 5,
      },
      entityName,
      {
        position: [0, storey.elevation + storey.height - 10, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    );
  } else if (target === "room") {
    entityName = `Room Space (${areaM2.toFixed(1)} m²)`;
    await ipc.createEntity(
      docId,
      {
        type: "room",
        name: "Room Space",
        number: "101",
        polygon,
      },
      entityName,
      {
        position: [0, storey.elevation, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    );
  } else if (target === "extrude") {
    entityName = `Solid Extrude (H=${(storey.height / 100).toFixed(1)}m)`;
    await ipc.createEntity(
      docId,
      {
        type: "extrude",
        polygon,
        height: storey.height,
      },
      entityName,
      {
        position: [0, storey.elevation, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
    );
  }

  // Clean up temporary sketch boundary entities (Revit / BIMCraft clean exit)
  const sketchIds = diag.sketchEntities.map((e) => e.id);
  if (sketchIds.length > 0) {
    await ipc.deleteEntities(docId, sketchIds);
  }

  useArcStore.getState().exitSketchMode();
  useArcStore.getState().setStatusMessage(`Created ${entityName} on ${storey.name}`);

  return { success: true, name: entityName, areaM2 };
}

/** Discards the sketch boundary entities and exits sketch mode. */
export async function cancelBimBoundary(): Promise<void> {
  const st = useArcStore.getState();
  const docId = st.overview?.active;
  const diag = extractClosedBoundaries(st.scene?.entities ?? []);
  const sketchIds = diag.sketchEntities.map((e) => e.id);
  if (docId && sketchIds.length > 0) {
    await ipc.deleteEntities(docId, sketchIds);
  }
  useArcStore.getState().exitSketchMode();
  useArcStore.getState().setStatusMessage("Discarded sketch boundary");
}

/** "Pick Walls": Traces existing wall perimeters on the active storey into a sketch boundary. */
export async function traceWallsToBoundary(): Promise<{ success: boolean; message: string }> {
  const st = useArcStore.getState();
  const scene = st.scene;
  const docId = st.overview?.active;
  if (!docId || !scene) return { success: false, message: "No active project" };

  const storey = getActiveStorey();

  // Find wall entities on the active storey
  let wallEntities = (scene.entities ?? []).filter((e) => {
    if (e.kind !== "wall" || e.visible === false) return false;
    const ty = e.transform?.position?.[1] ?? 0;
    return Math.abs(ty - storey.elevation) < 100;
  });

  // Fallback to all visible walls if none found on active storey elevation
  if (wallEntities.length === 0) {
    wallEntities = (scene.entities ?? []).filter((e) => e.kind === "wall" && e.visible !== false);
  }

  if (wallEntities.length === 0) {
    return {
      success: false,
      message: `No walls found on ${storey.name} to trace. Draw boundary with Line (L) or Rectangle (R).`,
    };
  }

  // Extract all individual wall segments in world XZ coordinates
  interface WallSeg {
    start: [number, number];
    end: [number, number];
  }
  const wallSegments: WallSeg[] = [];

  for (const w of wallEntities) {
    const g = w.geometry as Record<string, unknown>;
    const path = (g.path as [number, number][]) || [];
    const tx = w.transform?.position?.[0] ?? 0;
    const tz = w.transform?.position?.[2] ?? 0;
    for (let i = 0; i < path.length - 1; i++) {
      const p0: [number, number] = [path[i][0] + tx, path[i][1] + tz];
      const p1: [number, number] = [path[i + 1][0] + tx, path[i + 1][1] + tz];
      if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 5) {
        wallSegments.push({ start: p0, end: p1 });
      }
    }
  }

  if (wallSegments.length === 0) {
    return { success: false, message: "No valid wall segments found." };
  }

  // Topological chaining of wall segments into closed loops
  const remaining = [...wallSegments];
  const loops: [number, number][][] = [];
  const chainTol = 60; // 60cm connection tolerance for wall joints / miters

  while (remaining.length > 0) {
    const first = remaining.shift()!;
    const chain: [number, number][] = [first.start, first.end];
    let extended = true;

    while (extended && remaining.length > 0) {
      extended = false;
      const tail = chain[chain.length - 1];

      // Check if tail connects back to start of chain
      if (chain.length >= 3 && Math.hypot(tail[0] - chain[0][0], tail[1] - chain[0][1]) < chainTol) {
        break;
      }

      let bestIdx = -1;
      let bestDist = chainTol;
      let shouldReverse = false;

      for (let i = 0; i < remaining.length; i++) {
        const seg = remaining[i];
        const dStart = Math.hypot(tail[0] - seg.start[0], tail[1] - seg.start[1]);
        const dEnd = Math.hypot(tail[0] - seg.end[0], tail[1] - seg.end[1]);

        if (dStart < bestDist) {
          bestDist = dStart;
          bestIdx = i;
          shouldReverse = false;
        } else if (dEnd < bestDist) {
          bestDist = dEnd;
          bestIdx = i;
          shouldReverse = true;
        }
      }

      if (bestIdx >= 0) {
        const nextSeg = remaining.splice(bestIdx, 1)[0];
        chain.push(shouldReverse ? nextSeg.start : nextSeg.end);
        extended = true;
      }
    }

    if (chain.length >= 3) {
      // Close chain if needed
      const tail = chain[chain.length - 1];
      if (Math.hypot(tail[0] - chain[0][0], tail[1] - chain[0][1]) < chainTol) {
        chain[chain.length - 1] = [chain[0][0], chain[0][1]];
      } else {
        chain.push([chain[0][0], chain[0][1]]);
      }
      loops.push(chain);
    }
  }

  if (loops.length === 0) {
    return {
      success: false,
      message: "Walls do not form an enclosed boundary loop. Connect open ends.",
    };
  }

  // Ensure BIM sketch mode is entered on active storey
  if (!st.sketchMode) {
    st.enterSketchMode({
      height: storey.elevation,
      origin: [0, storey.elevation, 0],
      normal: [0, 1, 0],
      label: `${storey.name} Footprint`,
      tool: "line",
    });
  }

  // Create boundary line segments for each loop
  let createdCount = 0;
  for (const loop of loops) {
    for (let i = 0; i < loop.length - 1; i++) {
      const p0 = loop[i];
      const p1 = loop[i + 1];
      const dx = p1[0] - p0[0];
      const dz = p1[1] - p0[1];
      if (Math.hypot(dx, dz) < 1) continue;

      await ipc.createEntity(
        docId,
        {
          type: "line_curve",
          end: [dx, 0, dz],
        },
        `Boundary Edge ${createdCount + 1}`,
        {
          position: [p0[0], storey.elevation, p0[1]],
          rotation: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
      );
      createdCount++;
    }
  }

  useArcStore.getState().setStatusMessage(`Traced ${wallEntities.length} walls into closed boundary (${createdCount} lines)`);
  return { success: true, message: `Traced ${wallEntities.length} walls into closed boundary` };
}

// ---------------------------------------------------------------------------
// Planar Straight-Line Graph (PSLG) Face Finder (inspired by BIMCraft)
// Finds enclosed rooms and building perimeter from any set of 2D wall lines.
// ---------------------------------------------------------------------------

export interface PlanarFace {
  polygon: [number, number][]; // in XZ
  areaM2: number;
  perimeterM: number;
  isExterior: boolean;
}

/** Splits segments at all mutual crossing points and T-junction intersections. */
export function splitPlanarSegments(
  segs: [[number, number], [number, number]][],
  tol = 1.0,
): [[number, number], [number, number]][] {
  const ptsOnSeg: number[][] = segs.map(() => [0, 1]);

  for (let i = 0; i < segs.length; i++) {
    const [p1, p2] = segs[i];
    const dx1 = p2[0] - p1[0];
    const dz1 = p2[1] - p1[1];
    const len1Sq = dx1 * dx1 + dz1 * dz1;
    if (len1Sq < 1e-4) continue;

    for (let j = i + 1; j < segs.length; j++) {
      const [p3, p4] = segs[j];
      const dx2 = p4[0] - p3[0];
      const dz2 = p4[1] - p3[1];
      const denom = dx1 * dz2 - dz1 * dx2;

      // Check endpoints of j on segment i
      for (const q of [p3, p4]) {
        const t = Math.max(0, Math.min(1, ((q[0] - p1[0]) * dx1 + (q[1] - p1[1]) * dz1) / len1Sq));
        const projX = p1[0] + t * dx1;
        const projZ = p1[1] + t * dz1;
        if (Math.hypot(q[0] - projX, q[1] - projZ) <= tol && t > 0.001 && t < 0.999) {
          ptsOnSeg[i].push(t);
        }
      }

      // Check endpoints of i on segment j
      const len2Sq = dx2 * dx2 + dz2 * dz2;
      if (len2Sq > 1e-4) {
        for (const q of [p1, p2]) {
          const t = Math.max(0, Math.min(1, ((q[0] - p3[0]) * dx2 + (q[1] - p3[1]) * dz2) / len2Sq));
          const projX = p3[0] + t * dx2;
          const projZ = p3[1] + t * dz2;
          if (Math.hypot(q[0] - projX, q[1] - projZ) <= tol && t > 0.001 && t < 0.999) {
            ptsOnSeg[j].push(t);
          }
        }
      }

      // Proper crossing
      if (Math.abs(denom) > 1e-6) {
        const t1 = ((p3[0] - p1[0]) * dz2 - (p3[1] - p1[1]) * dx2) / denom;
        const t2 = ((p3[0] - p1[0]) * dz1 - (p3[1] - p1[1]) * dx1) / denom;
        if (t1 > 0.001 && t1 < 0.999 && t2 > 0.001 && t2 < 0.999) {
          ptsOnSeg[i].push(t1);
          ptsOnSeg[j].push(t2);
        }
      }
    }
  }

  const out: [[number, number], [number, number]][] = [];
  for (let i = 0; i < segs.length; i++) {
    const [p1, p2] = segs[i];
    const dx = p2[0] - p1[0];
    const dz = p2[1] - p1[1];
    const ts = Array.from(new Set(ptsOnSeg[i])).sort((a, b) => a - b);
    for (let k = 0; k < ts.length - 1; k++) {
      const a: [number, number] = [p1[0] + ts[k] * dx, p1[1] + ts[k] * dz];
      const b: [number, number] = [p1[0] + ts[k + 1] * dx, p1[1] + ts[k + 1] * dz];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > tol) {
        out.push([a, b]);
      }
    }
  }
  return out;
}

/** Finds all planar faces (enclosed rooms and exterior boundary) from a set of 2D line segments. */
export function findPlanarFaces(
  rawSegs: [[number, number], [number, number]][],
  tol = 25.0,
): PlanarFace[] {
  const segs = splitPlanarSegments(rawSegs, 2.0);
  const nodes: [number, number][] = [];

  function getNode(p: [number, number]): number {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(p[0] - nodes[i][0], p[1] - nodes[i][1]) <= tol) {
        return i;
      }
    }
    nodes.push(p);
    return nodes.length - 1;
  }

  const edges = new Set<string>();
  const edgeList: [number, number][] = [];

  for (const [a, b] of segs) {
    const i = getNode(a);
    const j = getNode(b);
    if (i !== j) {
      const minN = Math.min(i, j);
      const maxN = Math.max(i, j);
      const key = `${minN}:${maxN}`;
      if (!edges.has(key)) {
        edges.add(key);
        edgeList.push([minN, maxN]);
      }
    }
  }

  const around: number[][] = Array.from({ length: nodes.length }, () => []);
  for (const [i, j] of edgeList) {
    around[i].push(j);
    around[j].push(i);
  }

  function angle(from: number, to: number): number {
    return Math.atan2(nodes[to][1] - nodes[from][1], nodes[to][0] - nodes[from][0]);
  }

  for (let i = 0; i < nodes.length; i++) {
    around[i].sort((a, b) => angle(i, a) - angle(i, b));
  }

  const seen = new Set<string>();
  const faces: PlanarFace[] = [];

  for (const [i, j] of edgeList) {
    for (const [startU, startV] of [[i, j], [j, i]] as [number, number][]) {
      const startKey = `${startU}->${startV}`;
      if (seen.has(startKey)) continue;

      const poly: [number, number][] = [];
      let u = startU;
      let v = startV;
      let valid = true;

      while (!seen.has(`${u}->${v}`)) {
        seen.add(`${u}->${v}`);
        poly.push(nodes[u]);
        const nbrs = around[v];
        if (!nbrs || nbrs.length === 0) {
          valid = false;
          break;
        }
        const k = nbrs.indexOf(u);
        if (k === -1) {
          valid = false;
          break;
        }
        const nextV = nbrs[(k + nbrs.length - 1) % nbrs.length];
        u = v;
        v = nextV;
        if (u === startU && v === startV) break;
        if (poly.length > edgeList.length * 2) {
          valid = false;
          break;
        }
      }

      if (valid && poly.length >= 3) {
        let signedArea = 0;
        let peri = 0;
        for (let idx = 0; idx < poly.length; idx++) {
          const p1 = poly[idx];
          const p2 = poly[(idx + 1) % poly.length];
          signedArea += p1[0] * p2[1] - p2[0] * p1[1];
          peri += Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        }
        signedArea *= 0.5;

        if (Math.abs(signedArea) > 5000) {
          faces.push({
            polygon: signedArea > 0 ? poly : poly.slice().reverse(),
            areaM2: Math.abs(signedArea) / 10000,
            perimeterM: peri / 100,
            isExterior: signedArea < 0,
          });
        }
      }
    }
  }

  return faces;
}

/** Check if 2D point [x, z] is inside polygon. */
export function isPointInsidePoly2D(p: [number, number], poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const zi = poly[i][1];
    const xj = poly[j][0];
    const zj = poly[j][1];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Finds the smallest enclosed room face containing the 2D cursor point [x, z].
 */
export function findEnclosedRoomAt(
  p: [number, number],
  wallEntities: EntityData[],
  elevation?: number,
  tol = 35.0,
): PlanarFace | null {
  const segs: [[number, number], [number, number]][] = [];

  for (const w of wallEntities) {
    if (w.kind !== "wall" || w.visible === false) continue;
    const g = w.geometry as Record<string, unknown> | undefined;
    if (!g || !Array.isArray(g.path) || g.path.length < 2) continue;
    const tx = w.transform?.position?.[0] ?? 0;
    const tz = w.transform?.position?.[2] ?? 0;
    const ty = w.transform?.position?.[1] ?? 0;

    if (elevation !== undefined && Math.abs(ty - elevation) > 100) continue;

    const path = g.path as [number, number][];
    for (let i = 0; i < path.length - 1; i++) {
      segs.push([
        [path[i][0] + tx, path[i][1] + tz],
        [path[i + 1][0] + tx, path[i + 1][1] + tz],
      ]);
    }
  }

  if (segs.length < 3) return null;

  const allFaces = findPlanarFaces(segs, tol);
  const interiorFaces = allFaces.filter((f) => !f.isExterior);

  let bestFace: PlanarFace | null = null;
  let minArea = Infinity;

  for (const f of interiorFaces) {
    if (isPointInsidePoly2D(p, f.polygon) && f.areaM2 < minArea) {
      minArea = f.areaM2;
      bestFace = f;
    }
  }

  return bestFace;
}

/**
 * Finds the overall building exterior footprint loop from all walls on the storey.
 */
export function findBuildingFootprint(
  wallEntities: EntityData[],
  elevation?: number,
  tol = 35.0,
): PlanarFace | null {
  const segs: [[number, number], [number, number]][] = [];

  for (const w of wallEntities) {
    if (w.kind !== "wall" || w.visible === false) continue;
    const g = w.geometry as Record<string, unknown> | undefined;
    if (!g || !Array.isArray(g.path) || g.path.length < 2) continue;
    const tx = w.transform?.position?.[0] ?? 0;
    const tz = w.transform?.position?.[2] ?? 0;
    const ty = w.transform?.position?.[1] ?? 0;

    if (elevation !== undefined && Math.abs(ty - elevation) > 100) continue;

    const path = g.path as [number, number][];
    for (let i = 0; i < path.length - 1; i++) {
      segs.push([
        [path[i][0] + tx, path[i][1] + tz],
        [path[i + 1][0] + tx, path[i + 1][1] + tz],
      ]);
    }
  }

  if (segs.length < 3) return null;

  const allFaces = findPlanarFaces(segs, tol);
  // The exterior face has the largest absolute area or is marked isExterior
  const exterior = allFaces.find((f) => f.isExterior) ?? allFaces.sort((a, b) => b.areaM2 - a.areaM2)[0];
  return exterior ?? null;
}
