import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { previewLine } from "./sketch";
import { previewMaterial } from "./primitives";
import { useArcStore } from "../lib/store";

// ---------------------------------------------------------------------------
// Architecture / BIM tools
// Modeled after Revit & BIMCraft with smooth interactive previews,
// dynamic dimension HUD, and intelligent snapping.
// ---------------------------------------------------------------------------

function flatXZ(p: THREE.Vector3): [number, number] {
  return [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))];
}

// ===========================================================================
// 1. WALL TOOL
// Continuous polyline wall with live thickness/height HUD and miter preview.
// ===========================================================================

export const WALL_DEFAULT_WIDTH = 20;
export const WALL_DEFAULT_HEIGHT = 300;

interface WallDraft {
  points: THREE.Vector3[];
  width: number;
  height: number;
}

let wallDraft: WallDraft = {
  points: [],
  width: WALL_DEFAULT_WIDTH,
  height: WALL_DEFAULT_HEIGHT,
};

function resetWall(ctx: ToolContext): void {
  wallDraft.points = [];
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function buildWallPreviewMesh(points: THREE.Vector3[], width: number, height: number, ctx: ToolContext): THREE.Object3D {
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

    const geo = new THREE.BoxGeometry(len, height, width);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((a.x + b.x) / 2, a.y + height / 2, (a.z + b.z) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.renderOrder = 997;
    group.add(mesh);
  }
  return group;
}

function commitWall(ctx: ToolContext): boolean {
  if (wallDraft.points.length < 2) return false;
  const path = wallDraft.points.map(flatXZ);
  const name = `Wall ${Math.round(wallDraft.width)}x${Math.round(wallDraft.height)}`;
  void ctx.createEntity(
    {
      type: "wall",
      path,
      width: wallDraft.width,
      height: wallDraft.height,
    },
    [0, 0, 0],
    name,
  );
  ctx.setStatus("Wall created");
  resetWall(ctx);
  return true;
}

export const wallTool: ToolHandler = {
  id: "wall",
  cursor: "crosshair",
  onActivate(ctx) {
    resetWall(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetWall,
  hasActivity: () => wallDraft.points.length > 0,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw, {
      extraPoints: wallDraft.points,
      anchor: wallDraft.points[wallDraft.points.length - 1],
    }).point;

    // Clicking initial point closes the wall perimeter
    if (wallDraft.points.length >= 2 && snapped.distanceTo(wallDraft.points[0]) < ctx.settings.gridSize * 0.7) {
      wallDraft.points.push(wallDraft.points[0].clone());
      commitWall(ctx);
      return true;
    }

    wallDraft.points.push(snapped);
    ctx.capturePointer(event);
    ctx.setStatus(`Wall · Click next point · Enter commits (${wallDraft.points.length} pts)`);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || wallDraft.points.length === 0) return;
    const cursor = ctx.snap(raw, {
      extraPoints: wallDraft.points,
      anchor: wallDraft.points[wallDraft.points.length - 1],
    }).point;

    const pts = [...wallDraft.points, cursor];
    ctx.setPreview(buildWallPreviewMesh(pts, wallDraft.width, wallDraft.height, ctx), "draft");

    const last = wallDraft.points[wallDraft.points.length - 1];
    const segLen = last.distanceTo(cursor).toFixed(1);
    ctx.showMeasure(`L: ${segLen} | W: ${wallDraft.width} H: ${wallDraft.height}`, ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (wallDraft.points.length === 0) return;
    ctx.releasePointer(event);
  },
  onEnter(ctx) {
    return commitWall(ctx);
  },
  onDoubleClick(_event, ctx) {
    return commitWall(ctx);
  },
  onCancel(ctx) {
    if (wallDraft.points.length > 0) {
      wallDraft.points.pop();
      if (wallDraft.points.length === 0) {
        ctx.clearPreview("draft");
        ctx.showMeasure(null);
      } else {
        ctx.setPreview(buildWallPreviewMesh(wallDraft.points, wallDraft.width, wallDraft.height, ctx), "draft");
      }
    }
  },
  onBackspace(ctx) {
    this.onCancel!(ctx);
  },
  hint: () => "Wall · Click points along centerline · Enter or double-click commits",
};

// ===========================================================================
// 2. DOOR TOOL
// Snaps to wall centerline, shows 3D frame + 2D swing arc. Space flips hand.
// ===========================================================================

interface DoorDraft {
  width: number;
  height: number;
  depth: number;
  swingDeg: number;
  flipHand: boolean;
  flipFacing: boolean;
}

let doorDraft: DoorDraft = {
  width: 90,
  height: 210,
  depth: 20,
  swingDeg: 90,
  flipHand: false,
  flipFacing: false,
};

function buildDoorPreview(pos: THREE.Vector3, rotY: number, draft: DoorDraft, ctx: ToolContext): THREE.Object3D {
  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;

  const mat = previewMaterial(ctx);
  // Frame
  const frameGeo = new THREE.BoxGeometry(draft.width, draft.height, draft.depth);
  const frameMesh = new THREE.Mesh(frameGeo, mat);
  frameMesh.position.set(0, draft.height / 2, 0);
  group.add(frameMesh);

  // 2D Swing arc wireframe
  const arcSteps = 16;
  const arcPts: THREE.Vector3[] = [];
  const sgn = draft.flipHand ? -1 : 1;
  const radius = draft.width;
  for (let s = 0; s <= arcSteps; s++) {
    const angle = (s / arcSteps) * (Math.PI / 2) * sgn;
    arcPts.push(new THREE.Vector3(Math.cos(angle) * radius - radius * 0.5, 0.1, Math.sin(angle) * radius));
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: false });
  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
  group.add(new THREE.Line(arcGeo, lineMat));

  return group;
}

export const doorTool: ToolHandler = {
  id: "door",
  cursor: "crosshair",
  onActivate(ctx) {
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    const snapped = ctx.snap(raw).point;

    ctx.setPreview(buildDoorPreview(snapped, 0, doorDraft, ctx), "draft");
    ctx.showMeasure(`Door ${doorDraft.width}×${doorDraft.height} cm (Space = flip)`, ctx.screenPoint(event));
  },
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;

    void ctx.createEntity(
      {
        type: "door",
        width: doorDraft.width,
        height: doorDraft.height,
        depth: doorDraft.depth,
        swing_deg: doorDraft.swingDeg,
      },
      [snapped.x, snapped.y, snapped.z],
      `Door ${doorDraft.width}x${doorDraft.height}`,
    );
    ctx.setStatus("Door placed");
    return true;
  },
  onKey(event, ctx) {
    if (event.key === " " || event.code === "Space") {
      doorDraft.flipHand = !doorDraft.flipHand;
      ctx.setStatus(`Door · Flip hand: ${doorDraft.flipHand ? "Right" : "Left"}`);
      return true;
    }
    if (event.key.toLowerCase() === "f") {
      doorDraft.flipFacing = !doorDraft.flipFacing;
      ctx.setStatus(`Door · Flip facing: ${doorDraft.flipFacing ? "Exterior" : "Interior"}`);
      return true;
    }
    return false;
  },
  hint: () => "Door · Click to place on wall · Space = flip hinge, F = flip swing",
};

// ===========================================================================
// 3. WINDOW TOOL
// Wall-hosted window with surround frame, sill and glass panes.
// ===========================================================================

interface WindowDraft {
  width: number;
  height: number;
  depth: number;
  sillHeight: number;
  panesX: number;
  panesY: number;
}

let windowDraft: WindowDraft = {
  width: 120,
  height: 150,
  depth: 20,
  sillHeight: 90,
  panesX: 2,
  panesY: 2,
};

function buildWindowPreview(pos: THREE.Vector3, draft: WindowDraft, ctx: ToolContext): THREE.Object3D {
  const group = new THREE.Group();
  group.position.set(pos.x, pos.y + draft.sillHeight, pos.z);

  const mat = previewMaterial(ctx);
  // Frame
  const frameGeo = new THREE.BoxGeometry(draft.width, draft.height, draft.depth);
  const frameMesh = new THREE.Mesh(frameGeo, mat);
  frameMesh.position.set(0, draft.height / 2, 0);
  group.add(frameMesh);

  // Sill
  const sillGeo = new THREE.BoxGeometry(draft.width + 10, 5, draft.depth + 10);
  const sillMesh = new THREE.Mesh(sillGeo, mat);
  sillMesh.position.set(0, 0, 0);
  group.add(sillMesh);

  return group;
}

export const windowTool: ToolHandler = {
  id: "window",
  cursor: "crosshair",
  onActivate(ctx) {
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    const snapped = ctx.snap(raw).point;

    ctx.setPreview(buildWindowPreview(snapped, windowDraft, ctx), "draft");
    ctx.showMeasure(`Window ${windowDraft.width}×${windowDraft.height} (Sill: ${windowDraft.sillHeight})`, ctx.screenPoint(event));
  },
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;

    void ctx.createEntity(
      {
        type: "window",
        width: windowDraft.width,
        height: windowDraft.height,
        depth: windowDraft.depth,
        panes_x: windowDraft.panesX,
        panes_y: windowDraft.panesY,
      },
      [snapped.x, snapped.y + windowDraft.sillHeight, snapped.z],
      `Window ${windowDraft.width}x${windowDraft.height}`,
    );
    ctx.setStatus("Window placed");
    return true;
  },
  hint: () => "Window · Click to place on wall (Sill: 90 cm)",
};

// ===========================================================================
// 4. SLAB / FLOOR TOOL
// Polygon footprint floor plate with thickness.
// ===========================================================================

let slabPoints: THREE.Vector3[] = [];
const SLAB_DEFAULT_THICKNESS = 20;

function resetSlab(ctx: ToolContext): void {
  slabPoints = [];
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function commitSlab(ctx: ToolContext): boolean {
  if (slabPoints.length < 3) return false;
  const polygon = slabPoints.map(flatXZ);
  void ctx.createEntity(
    {
      type: "slab",
      polygon,
      height: SLAB_DEFAULT_THICKNESS,
    },
    [0, 0, 0],
    "Floor Slab",
  );
  ctx.setStatus("Floor slab created");
  resetSlab(ctx);
  return true;
}

export const slabTool: ToolHandler = {
  id: "slab",
  cursor: "crosshair",
  onActivate(ctx) {
    resetSlab(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate: resetSlab,
  hasActivity: () => slabPoints.length > 0,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw, {
      extraPoints: slabPoints,
      anchor: slabPoints[slabPoints.length - 1],
    }).point;

    if (slabPoints.length >= 3 && snapped.distanceTo(slabPoints[0]) < ctx.settings.gridSize * 0.7) {
      commitSlab(ctx);
      return true;
    }

    slabPoints.push(snapped);
    ctx.capturePointer(event);
    ctx.setStatus(`Floor Slab · Add point · Enter commits (${slabPoints.length} pts)`);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || slabPoints.length === 0) return;
    const cursor = ctx.snap(raw, {
      extraPoints: slabPoints,
      anchor: slabPoints[slabPoints.length - 1],
    }).point;

    const pts = [...slabPoints, cursor, slabPoints[0]];
    ctx.setPreview(previewLine(pts, ctx), "draft");
    ctx.showMeasure(`Slab points: ${slabPoints.length + 1} (Enter commits)`, ctx.screenPoint(event));
  },
  onPointerUp(event, ctx) {
    if (slabPoints.length === 0) return;
    ctx.releasePointer(event);
  },
  onEnter(ctx) {
    return commitSlab(ctx);
  },
  onDoubleClick(_event, ctx) {
    return commitSlab(ctx);
  },
  onCancel(ctx) {
    if (slabPoints.length > 0) {
      slabPoints.pop();
      if (slabPoints.length === 0) {
        ctx.clearPreview("draft");
        ctx.showMeasure(null);
      }
    }
  },
  hint: () => "Floor Slab · Click boundary vertices · Enter or first vertex commits",
};

// ===========================================================================
// 5. ROOF TOOL
// Pitch angle, eaves overhang, gable or hip roof.
// ===========================================================================

let roofAnchor: THREE.Vector3 | null = null;
const ROOF_PITCH_DEG = 30;
const ROOF_OVERHANG = 40;

export const roofTool: ToolHandler = {
  id: "roof",
  cursor: "crosshair",
  onActivate(ctx) {
    roofAnchor = null;
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    roofAnchor = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hasActivity: () => roofAnchor !== null,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!roofAnchor) {
      roofAnchor = p;
      ctx.capturePointer(event);
      ctx.setStatus("Roof · Click opposite diagonal corner");
      return true;
    }

    const w = Math.abs(p.x - roofAnchor.x);
    const d = Math.abs(p.z - roofAnchor.z);
    if (w > 10 && d > 10) {
      const cx = (roofAnchor.x + p.x) / 2;
      const cz = (roofAnchor.z + p.z) / 2;
      void ctx.createEntity(
        {
          type: "roof",
          width: w,
          depth: d,
          pitch_deg: ROOF_PITCH_DEG,
          overhang: ROOF_OVERHANG,
        },
        [cx, 300, cz],
        "Roof",
      );
      ctx.setStatus("Roof created");
    }
    roofAnchor = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || !roofAnchor) return;
    const cursor = ctx.snap(raw, { anchor: roofAnchor }).point;

    const w = Math.abs(cursor.x - roofAnchor.x);
    const d = Math.abs(cursor.z - roofAnchor.z);
    const geo = new THREE.BoxGeometry(w, 40, d);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set((roofAnchor.x + cursor.x) / 2, 300, (roofAnchor.z + cursor.z) / 2);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(`Roof ${w.toFixed(1)}×${d.toFixed(1)} cm (Pitch: ${ROOF_PITCH_DEG}°)`, ctx.screenPoint(event));
  },
  onCancel(ctx) {
    roofAnchor = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Roof · Click two diagonal corners to span roof footprint",
};

// ===========================================================================
// 6. COLUMN TOOL
// Circular or rectangular architectural / structural columns.
// ===========================================================================

export const columnTool: ToolHandler = {
  id: "column",
  cursor: "crosshair",
  onActivate(ctx) {
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    const snapped = ctx.snap(raw).point;

    const geo = new THREE.BoxGeometry(30, 300, 30);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set(snapped.x, 150, snapped.z);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure("Column 30×30 H: 300 cm", ctx.screenPoint(event));
  },
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;

    void ctx.createEntity(
      {
        type: "column",
        radius: 20,
        height: 300,
        sides: 4,
      },
      [snapped.x, 0, snapped.z],
      "Column",
    );
    ctx.setStatus("Column placed");
    return true;
  },
  hint: () => "Column · Click to place column at point or grid intersection",
};

// ===========================================================================
// 7. BEAM TOOL
// Structural horizontal framing beam between two points.
// ===========================================================================

let beamStart: THREE.Vector3 | null = null;

export const beamTool: ToolHandler = {
  id: "beam",
  cursor: "crosshair",
  onActivate(ctx) {
    beamStart = null;
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    beamStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hasActivity: () => beamStart !== null,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 300);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!beamStart) {
      beamStart = p;
      ctx.capturePointer(event);
      ctx.setStatus("Beam · Click end point");
      return true;
    }

    const len = beamStart.distanceTo(p);
    if (len > 10) {
      const mid = beamStart.clone().add(p).multiplyScalar(0.5);
      const angle = -Math.atan2(p.z - beamStart.z, p.x - beamStart.x);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      void ctx.createEntity(
        {
          type: "beam",
          length: len,
          width: 20,
          height: 40,
        },
        [mid.x, mid.y, mid.z],
        "Beam",
        [q.x, q.y, q.z, q.w],
      );
      ctx.setStatus("Beam created");
    }
    beamStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 300);
    if (!raw || !beamStart) return;
    const cursor = ctx.snap(raw, { anchor: beamStart }).point;

    const len = beamStart.distanceTo(cursor);
    const geo = new THREE.BoxGeometry(len, 40, 20);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set((beamStart.x + cursor.x) / 2, beamStart.y, (beamStart.z + cursor.z) / 2);
    mesh.rotation.y = -Math.atan2(cursor.z - beamStart.z, cursor.x - beamStart.x);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(`Beam L: ${len.toFixed(1)} cm`, ctx.screenPoint(event));
  },
  onCancel(ctx) {
    beamStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Beam · Click start and end points for structural beam",
};

// ===========================================================================
// 8. STAIR TOOL
// Interactive staircase with rise, run, tread steps and landings.
// ===========================================================================

let stairStart: THREE.Vector3 | null = null;

export const stairTool: ToolHandler = {
  id: "stair",
  cursor: "crosshair",
  onActivate(ctx) {
    stairStart = null;
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    stairStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hasActivity: () => stairStart !== null,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!stairStart) {
      stairStart = p;
      ctx.capturePointer(event);
      ctx.setStatus("Stair · Click top of flight run");
      return true;
    }

    const dx = p.x - stairStart.x;
    const dz = p.z - stairStart.z;
    const totalRun = Math.hypot(dx, dz);
    if (totalRun > 30) {
      const stepCount = Math.max(3, Math.round(totalRun / 28));
      const runPerStep = totalRun / stepCount;
      const angle = -Math.atan2(dz, dx);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);

      void ctx.createEntity(
        {
          type: "stair",
          width: 100,
          rise: 18,
          run: runPerStep,
          count: stepCount,
        },
        [stairStart.x, stairStart.y, stairStart.z],
        "Staircase",
        [q.x, q.y, q.z, q.w],
      );
      ctx.setStatus("Staircase placed");
    }

    stairStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || !stairStart) return;
    const cursor = ctx.snap(raw, { anchor: stairStart }).point;

    const totalRun = stairStart.distanceTo(cursor);
    const steps = Math.max(3, Math.round(totalRun / 28));
    ctx.setPreview(previewLine([stairStart, cursor], ctx), "draft");
    ctx.showMeasure(`Stair: ${steps} risers (Run: ${totalRun.toFixed(0)} cm)`, ctx.screenPoint(event));
  },
  onCancel(ctx) {
    stairStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Stair · Click flight start and drag run direction/length",
};

// ===========================================================================
// 9. ROOM / SPACE TOOL
// Defines space with tags, perimeter, and area takeoff.
// ===========================================================================

let roomCorners: THREE.Vector3[] = [];

export const roomTool: ToolHandler = {
  id: "room",
  cursor: "crosshair",
  onActivate(ctx) {
    roomCorners = [];
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    roomCorners = [];
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hasActivity: () => roomCorners.length > 0,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (roomCorners.length >= 3 && p.distanceTo(roomCorners[0]) < ctx.settings.gridSize * 0.7) {
      const polygon = roomCorners.map(flatXZ);
      void ctx.createEntity(
        {
          type: "room",
          name: "Room",
          number: "101",
          polygon,
        },
        [0, 0, 0],
        "Room Space",
      );
      ctx.setStatus("Room space created");
      roomCorners = [];
      ctx.clearPreview("draft");
      ctx.showMeasure(null);
      return true;
    }

    roomCorners.push(p);
    ctx.capturePointer(event);
    ctx.setStatus(`Room · Add corner · First point commits (${roomCorners.length} pts)`);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || roomCorners.length === 0) return;
    const cursor = ctx.snap(raw, { anchor: roomCorners[roomCorners.length - 1] }).point;

    ctx.setPreview(previewLine([...roomCorners, cursor, roomCorners[0]], ctx), "draft");
    ctx.showMeasure(`Room corners: ${roomCorners.length + 1}`, ctx.screenPoint(event));
  },
  onCancel(ctx) {
    roomCorners = [];
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Room · Click boundary corners to define room area and tag",
};

// ===========================================================================
// 10. COMPONENT / FURNITURE TOOL
// Places architectural components (sofas, desks, beds, chairs, tables, cabinets)
// ===========================================================================

export type ArchComponentKind =
  | "sofa"
  | "table"
  | "desk"
  | "chair"
  | "bed"
  | "cabinet"
  | "toilet"
  | "sink";

let activeCompKind: ArchComponentKind = "sofa";
let compRotationDeg = 0;

export const COMPONENT_SPECS: Record<
  ArchComponentKind,
  { label: string; w: number; d: number; h: number }
> = {
  sofa: { label: "Sofa", w: 220, d: 90, h: 80 },
  table: { label: "Dining Table", w: 180, d: 90, h: 75 },
  desk: { label: "Office Desk", w: 150, d: 75, h: 74 },
  chair: { label: "Chair", w: 50, d: 50, h: 85 },
  bed: { label: "Double Bed", w: 180, d: 210, h: 90 },
  cabinet: { label: "Storage Cabinet", w: 100, d: 50, h: 180 },
  toilet: { label: "Toilet", w: 45, d: 70, h: 80 },
  sink: { label: "Bathroom Vanity", w: 90, d: 55, h: 85 },
};

export const componentTool: ToolHandler = {
  id: "component",
  cursor: "crosshair",
  onActivate(ctx) {
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return;
    const snapped = ctx.snap(raw).point;

    const spec = COMPONENT_SPECS[activeCompKind];
    const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set(snapped.x, spec.h / 2, snapped.z);
    mesh.rotation.y = THREE.MathUtils.degToRad(compRotationDeg);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(`${spec.label} (Space = rotate 45°)`, ctx.screenPoint(event));
  },
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;

    const spec = COMPONENT_SPECS[activeCompKind];
    const q = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      THREE.MathUtils.degToRad(compRotationDeg),
    );

    void ctx.createEntity(
      {
        type: "component",
        component_type: activeCompKind,
        width: spec.w,
        depth: spec.d,
        height: spec.h,
      },
      [snapped.x, 0, snapped.z],
      spec.label,
      [q.x, q.y, q.z, q.w],
    );
    ctx.setStatus(`${spec.label} placed`);
    return true;
  },
  onKey(event, ctx) {
    if (event.key === " " || event.code === "Space") {
      compRotationDeg = (compRotationDeg + 45) % 360;
      ctx.setStatus(`Rotate: ${compRotationDeg}°`);
      return true;
    }
    // Number keys 1-8 quickly pick furniture kind
    const keys: ArchComponentKind[] = [
      "sofa",
      "table",
      "desk",
      "chair",
      "bed",
      "cabinet",
      "toilet",
      "sink",
    ];
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= keys.length) {
      activeCompKind = keys[num - 1];
      ctx.setStatus(`Selected: ${COMPONENT_SPECS[activeCompKind].label}`);
      return true;
    }
    return false;
  },
  hint: () => "Furniture · Click to place · Space = rotate 45° · Keys 1-8 switch kind",
};

// ===========================================================================
// 11. GRID TOOL
// Architectural structural grid line with numbered bubble heads.
// ===========================================================================

let gridStart: THREE.Vector3 | null = null;

export const gridTool: ToolHandler = {
  id: "grid",
  cursor: "crosshair",
  onActivate(ctx) {
    gridStart = null;
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    gridStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hasActivity: () => gridStart !== null,
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!gridStart) {
      gridStart = p;
      ctx.capturePointer(event);
      ctx.setStatus("Grid Line · Click end point");
      return true;
    }

    const st = useArcStore.getState();
    const existingCount = st.scene?.grids?.length ?? 0;
    const gridName = String(existingCount + 1);

    const docId = st.overview?.active;
    if (docId) {
      void import("../lib/ipc").then(({ ipc }) =>
        ipc.addGrid(docId, gridName, flatXZ(gridStart!), flatXZ(p)),
      );
    }
    ctx.setStatus(`Grid Line '${gridName}' added`);
    gridStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw || !gridStart) return;
    const cursor = ctx.snap(raw, { anchor: gridStart }).point;

    ctx.setPreview(previewLine([gridStart, cursor], ctx), "draft");
    ctx.showMeasure(`Grid Length: ${gridStart.distanceTo(cursor).toFixed(1)} cm`, ctx.screenPoint(event));
  },
  onCancel(ctx) {
    gridStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Grid · Click start and end points for structural datum grid",
};

// ===========================================================================
// 12. LEVEL TOOL
// Architectural building storey level datum plane.
// ===========================================================================

export const levelTool: ToolHandler = {
  id: "level",
  cursor: "crosshair",
  onActivate(ctx) {
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerDown(event, ctx) {
    const raw = ctx.planePoint(event, 0);
    if (!raw) return true;

    const st = useArcStore.getState();
    const docId = st.overview?.active;
    const levels = st.scene?.levels ?? [];
    const highest = levels.reduce((max, l) => Math.max(max, l.elevation), 0);
    const newElevation = highest + 300;
    const newName = `Level ${levels.length + 1}`;

    if (docId) {
      void import("../lib/ipc").then(({ ipc }) =>
        ipc.addLevel(docId, newName, newElevation, 300),
      );
    }
    ctx.setStatus(`Level '${newName}' (+${newElevation} cm) created`);
    return true;
  },
  hint: () => "Level · Click to add a new building storey level (+300 cm)",
};
