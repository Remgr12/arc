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
  const wallEntities = (scene.entities ?? []).filter((e) => {
    if (e.kind !== "wall" || !e.visible) return false;
    const ty = e.transform?.position?.[1] ?? 0;
    return Math.abs(ty - storey.elevation) < 50;
  });

  if (wallEntities.length === 0) {
    return {
      success: false,
      message: `No walls found on ${storey.name} to trace. Draw boundary with Line (L) or Rectangle (R).`,
    };
  }

  // Collect wall vertices in loop order
  const pts: [number, number, number][] = [];
  for (const w of wallEntities) {
    const g = w.geometry as Record<string, unknown>;
    if (!Array.isArray(g.path)) continue;
    const tx = w.transform?.position?.[0] ?? 0;
    const tz = w.transform?.position?.[2] ?? 0;
    const path = g.path as [number, number][];
    for (const p of path) {
      pts.push([p[0] + tx, storey.elevation, p[1] + tz]);
    }
  }

  if (pts.length < 3) {
    return { success: false, message: "Not enough wall points to form boundary." };
  }

  // Ensure closed loop
  const closedPts = [...pts];
  if (
    Math.hypot(
      closedPts[0][0] - closedPts[closedPts.length - 1][0],
      closedPts[0][2] - closedPts[closedPts.length - 1][2],
    ) > 1
  ) {
    closedPts.push([closedPts[0][0], closedPts[0][1], closedPts[0][2]]);
  }

  const id = await ipc.createEntity(
    docId,
    {
      type: "polyline_curve",
      points: closedPts,
    },
    `Boundary (${storey.name} Walls)`,
    {
      position: [0, 0, 0],
      rotation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
  );

  if (id) {
    useArcStore.getState().setStatusMessage(`Traced ${wallEntities.length} walls into closed boundary`);
    return { success: true, message: `Traced ${wallEntities.length} walls into closed boundary` };
  }
  return { success: false, message: "Failed to create boundary from walls" };
}
