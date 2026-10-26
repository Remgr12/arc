import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { previewLine } from "./sketch";
import { previewMaterial } from "./primitives";
import { useArcStore } from "../lib/store";
import type { EntityData, SceneData } from "../lib/types";

// ---------------------------------------------------------------------------
// Architecture / BIM tools
// Modeled after Revit & BIMCraft with smooth interactive previews,
// dynamic dimension HUD, wall-hosted openings, storey management,
// and intelligent grid/angle snapping.
// ---------------------------------------------------------------------------

function flatXZ(p: THREE.Vector3): [number, number] {
  return [Number(p.x.toFixed(2)), Number(p.z.toFixed(2))];
}

/** Returns the active building storey's elevation, height, and name. */
export function getActiveStorey(): {
  elevation: number;
  height: number;
  name: string;
  id: string;
} {
  const st = useArcStore.getState();
  const scene = st.scene;
  if (!scene || scene.projectMode !== "architecture") {
    return { elevation: 0, height: 300, name: "Ground Level", id: "ground" };
  }
  const lvl =
    scene.levels?.find((l) => l.id === scene.activeLevel) ??
    scene.levels?.[0];
  return {
    elevation: lvl?.elevation ?? 0,
    height: lvl?.height ?? 300,
    name: lvl?.name ?? "Level 1",
    id: lvl?.id ?? "level-1",
  };
}

/** Result of snapping an opening (door/window) to a host wall segment. */
export interface WallSnapResult {
  wallEntity: EntityData;
  p0: THREE.Vector2;
  p1: THREE.Vector2;
  projPoint: THREE.Vector3;
  segAngle: number;
  offset: number;
  segLen: number;
  wallWidth: number;
  wallHeight: number;
  elevation: number;
}

/** Finds the nearest wall segment in the scene to host a door or window. */
export function findNearestWallSegment(
  cursorWorld: THREE.Vector3,
  scene: SceneData | null,
  maxSnapDist = 75,
): WallSnapResult | null {
  if (!scene || !scene.entities) return null;

  const cursor2D = new THREE.Vector2(cursorWorld.x, cursorWorld.z);
  let bestResult: WallSnapResult | null = null;
  let bestDist = Infinity;

  for (const entity of scene.entities) {
    if (entity.kind !== "wall" || !entity.visible) continue;
    const g = entity.geometry as Record<string, unknown> | undefined;
    if (!g || !Array.isArray(g.path) || g.path.length < 2) continue;

    const path = g.path as [number, number][];
    const width = typeof g.width === "number" ? g.width : 20;
    const height = typeof g.height === "number" ? g.height : 300;
    const tx = entity.transform?.position?.[0] ?? 0;
    const ty = entity.transform?.position?.[1] ?? 0;
    const tz = entity.transform?.position?.[2] ?? 0;

    const snapThreshold = Math.max(width * 1.5, maxSnapDist);

    for (let i = 0; i < path.length - 1; i++) {
      const p0 = new THREE.Vector2(path[i][0] + tx, path[i][1] + tz);
      const p1 = new THREE.Vector2(path[i + 1][0] + tx, path[i + 1][1] + tz);

      const seg = p1.clone().sub(p0);
      const segLen = seg.length();
      if (segLen < 1e-4) continue;

      const dir = seg.clone().divideScalar(segLen);
      const toCursor = cursor2D.clone().sub(p0);
      const proj = toCursor.dot(dir);
      const clampedProj = Math.max(0, Math.min(segLen, proj));

      const closestPoint = p0.clone().add(dir.clone().multiplyScalar(clampedProj));
      const dist = cursor2D.distanceTo(closestPoint);

      if (dist < snapThreshold && dist < bestDist) {
        bestDist = dist;
        const angle = -Math.atan2(seg.y, seg.x);
        bestResult = {
          wallEntity: entity,
          p0,
          p1,
          projPoint: new THREE.Vector3(closestPoint.x, ty, closestPoint.y),
          segAngle: angle,
          offset: clampedProj,
          segLen,
          wallWidth: width,
          wallHeight: height,
          elevation: ty,
        };
      }
    }
  }

  return bestResult;
}

// ===========================================================================
// 1. WALL TOOL
// Continuous polyline wall with live thickness/height HUD, wall types,
// and clean miter preview. Inspired by Revit & BIMCraft.
// ===========================================================================

export interface WallPreset {
  id: string;
  label: string;
  width: number; // in cm
  desc: string;
}

export const WALL_PRESETS: WallPreset[] = [
  { id: "p10", label: "100mm Partition", width: 10, desc: "Interior Drywall / Studs" },
  { id: "s20", label: "200mm Standard", width: 20, desc: "Standard Blockwork / Masonry" },
  { id: "c30", label: "300mm Cavity", width: 30, desc: "Insulated Exterior Cavity Wall" },
  { id: "c40", label: "400mm Concrete", width: 40, desc: "Structural Core / Retaining Wall" },
  { id: "g15", label: "150mm Curtain Wall", width: 15, desc: "Glazed Facade" },
];

let activeWallPresetIndex = 1; // Default: 200mm Standard

interface WallDraft {
  points: THREE.Vector3[];
}

let wallDraft: WallDraft = {
  points: [],
};

function resetWall(ctx: ToolContext): void {
  wallDraft.points = [];
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function buildWallPreviewMesh(
  points: THREE.Vector3[],
  width: number,
  height: number,
  elevation: number,
  ctx: ToolContext,
): THREE.Object3D {
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
    mesh.position.set((a.x + b.x) / 2, elevation + height / 2, (a.z + b.z) / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.renderOrder = 997;
    group.add(mesh);
  }
  return group;
}

function commitWall(ctx: ToolContext): boolean {
  if (wallDraft.points.length < 2) return false;
  const storey = getActiveStorey();
  const preset = WALL_PRESETS[activeWallPresetIndex] ?? WALL_PRESETS[1];
  const path = wallDraft.points.map(flatXZ);

  let totalLen = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalLen += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
  }

  const name = `Wall ${preset.label} (${(totalLen / 100).toFixed(1)}m)`;
  void ctx.createEntity(
    {
      type: "wall",
      path,
      width: preset.width,
      height: storey.height,
    },
    [0, storey.elevation, 0],
    name,
  );
  ctx.setStatus(`Created ${name} on ${storey.name}`);
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
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return true;

    const snapped = ctx.snap(raw, {
      extraPoints: wallDraft.points,
      anchor: wallDraft.points[wallDraft.points.length - 1],
    }).point;

    // Clicking initial point closes the wall perimeter
    if (
      wallDraft.points.length >= 2 &&
      snapped.distanceTo(wallDraft.points[0]) < ctx.settings.gridSize * 0.7
    ) {
      wallDraft.points.push(wallDraft.points[0].clone());
      commitWall(ctx);
      return true;
    }

    wallDraft.points.push(snapped);
    ctx.capturePointer(event);
    const preset = WALL_PRESETS[activeWallPresetIndex] ?? WALL_PRESETS[1];
    ctx.setStatus(
      `Wall (${preset.label}) · Point ${wallDraft.points.length} placed · Enter or double-click to commit · [1-5]: switch wall type`,
    );
    return true;
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw || wallDraft.points.length === 0) return;

    const last = wallDraft.points[wallDraft.points.length - 1];
    let cursor = ctx.snap(raw, {
      extraPoints: wallDraft.points,
      anchor: last,
    }).point;

    // Orthogonal snap assistance (lock to nearest 0°, 45°, 90°, 135°, 180°)
    const dx = cursor.x - last.x;
    const dz = cursor.z - last.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 15) {
      const angle = Math.atan2(dz, dx);
      const snapStep = Math.PI / 4; // 45 degrees
      const nearestAngle = Math.round(angle / snapStep) * snapStep;
      if (Math.abs(angle - nearestAngle) < 0.12) {
        cursor = new THREE.Vector3(
          last.x + Math.cos(nearestAngle) * dist,
          storey.elevation,
          last.z + Math.sin(nearestAngle) * dist,
        );
      }
    }

    const preset = WALL_PRESETS[activeWallPresetIndex] ?? WALL_PRESETS[1];
    const pts = [...wallDraft.points, cursor];
    ctx.setPreview(
      buildWallPreviewMesh(pts, preset.width, storey.height, storey.elevation, ctx),
      "draft",
    );

    const segLen = last.distanceTo(cursor);
    ctx.showMeasure(
      `L: ${(segLen / 100).toFixed(2)}m (${segLen.toFixed(0)} cm) | ${preset.label} | H: ${storey.height} cm`,
      ctx.screenPoint(event),
    );
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
        const storey = getActiveStorey();
        const preset = WALL_PRESETS[activeWallPresetIndex] ?? WALL_PRESETS[1];
        ctx.setPreview(
          buildWallPreviewMesh(
            wallDraft.points,
            preset.width,
            storey.height,
            storey.elevation,
            ctx,
          ),
          "draft",
        );
      }
    }
  },
  onBackspace(ctx) {
    this.onCancel!(ctx);
  },
  onKey(event, ctx) {
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= WALL_PRESETS.length) {
      activeWallPresetIndex = num - 1;
      const preset = WALL_PRESETS[activeWallPresetIndex];
      const storey = getActiveStorey();
      ctx.setStatus(`Wall Type: ${preset.label} (${preset.width}cm) · ${preset.desc}`);
      if (wallDraft.points.length > 0) {
        ctx.setPreview(
          buildWallPreviewMesh(
            wallDraft.points,
            preset.width,
            storey.height,
            storey.elevation,
            ctx,
          ),
          "draft",
        );
      }
      return true;
    }
    if (event.key === "Tab" || event.key.toLowerCase() === "t") {
      activeWallPresetIndex = (activeWallPresetIndex + 1) % WALL_PRESETS.length;
      const preset = WALL_PRESETS[activeWallPresetIndex];
      ctx.setStatus(`Wall Type: ${preset.label} (${preset.width}cm) · ${preset.desc}`);
      return true;
    }
    return false;
  },
  hint: () =>
    `Wall · Click points along centerline · Enter commits · [1-5]: switch wall type (${WALL_PRESETS[activeWallPresetIndex]?.label})`,
};

// ===========================================================================
// 2. DOOR TOOL
// Wall-hosted door with centerline snapping, frame + 2D swing arc,
// and flip hand / facing controls. Modeled after BIMCraft.
// ===========================================================================

export interface DoorPreset {
  id: string;
  label: string;
  width: number;
  height: number;
}

export const DOOR_PRESETS: DoorPreset[] = [
  { id: "d90", label: "900×2100 Single Flush", width: 90, height: 210 },
  { id: "d80", label: "800×2100 Interior Single", width: 80, height: 210 },
  { id: "d100", label: "1000×2100 Wide Entry", width: 100, height: 210 },
  { id: "d180", label: "1800×2100 Double French", width: 180, height: 210 },
  { id: "d200", label: "2000×2150 Sliding Patio", width: 200, height: 215 },
];

let activeDoorPresetIndex = 0;

interface DoorDraft {
  swingDeg: number;
  flipHand: boolean;
  flipFacing: boolean;
}

let doorDraft: DoorDraft = {
  swingDeg: 90,
  flipHand: false,
  flipFacing: false,
};

let currentDoorSnap: WallSnapResult | null = null;
let currentDoorPos: THREE.Vector3 | null = null;
let currentDoorRotY = 0;

function buildDoorPreview(
  pos: THREE.Vector3,
  rotY: number,
  preset: DoorPreset,
  depth: number,
  draft: DoorDraft,
  snapResult: WallSnapResult | null,
  ctx: ToolContext,
): THREE.Object3D {
  const group = new THREE.Group();
  group.position.copy(pos);
  group.rotation.y = rotY;

  const mat = previewMaterial(ctx);
  const frameGeo = new THREE.BoxGeometry(preset.width, preset.height, depth);
  const frameMesh = new THREE.Mesh(frameGeo, mat);
  frameMesh.position.set(0, preset.height / 2, 0);
  frameMesh.renderOrder = 998;
  group.add(frameMesh);

  // 2D Swing arc wireframe
  const arcSteps = 16;
  const arcPts: THREE.Vector3[] = [];
  const sgn = draft.flipHand ? -1 : 1;
  const radius = preset.width;
  for (let s = 0; s <= arcSteps; s++) {
    const angle = (s / arcSteps) * (Math.PI / 2) * sgn;
    arcPts.push(
      new THREE.Vector3(
        Math.cos(angle) * radius - radius * 0.5,
        0.1,
        Math.sin(angle) * radius,
      ),
    );
  }
  const lineMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, depthTest: false });
  const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
  group.add(new THREE.Line(arcGeo, lineMat));

  // If hosted on a wall, draw host guideline
  if (snapResult) {
    const guidePts = [
      new THREE.Vector3(-preset.width * 1.5, 0.05, 0),
      new THREE.Vector3(preset.width * 1.5, 0.05, 0),
    ];
    const guideGeo = new THREE.BufferGeometry().setFromPoints(guidePts);
    const guideMat = new THREE.LineDashedMaterial({
      color: 0x22c55e,
      dashSize: 6,
      gapSize: 4,
      depthTest: false,
    });
    const guideLine = new THREE.Line(guideGeo, guideMat);
    guideLine.computeLineDistances();
    group.add(guideLine);
  }

  return group;
}

export const doorTool: ToolHandler = {
  id: "door",
  cursor: "crosshair",
  onActivate(ctx) {
    currentDoorSnap = null;
    currentDoorPos = null;
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    currentDoorSnap = null;
    currentDoorPos = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return;

    const scene = useArcStore.getState().scene;
    const hostSnap = findNearestWallSegment(raw, scene, 80);
    const preset = DOOR_PRESETS[activeDoorPresetIndex] ?? DOOR_PRESETS[0];

    let pos: THREE.Vector3;
    let rotY = 0;
    let depth = 20;

    if (hostSnap) {
      pos = hostSnap.projPoint.clone();
      rotY = hostSnap.segAngle + (doorDraft.flipFacing ? Math.PI : 0);
      depth = hostSnap.wallWidth;
      currentDoorSnap = hostSnap;
      currentDoorPos = pos;
      currentDoorRotY = rotY;

      ctx.setPreview(
        buildDoorPreview(pos, rotY, preset, depth, doorDraft, hostSnap, ctx),
        "draft",
      );
      ctx.showMeasure(
        `Door ${preset.label} • Hosted on ${hostSnap.wallEntity.name || "Wall"} (${(hostSnap.offset / 100).toFixed(2)}m from corner) • Space: flip hand, F: flip facing, [1-5]: preset`,
        ctx.screenPoint(event),
      );
    } else {
      const snapped = ctx.snap(raw).point;
      pos = snapped;
      rotY = doorDraft.flipFacing ? Math.PI : 0;
      currentDoorSnap = null;
      currentDoorPos = pos;
      currentDoorRotY = rotY;

      ctx.setPreview(
        buildDoorPreview(pos, rotY, preset, depth, doorDraft, null, ctx),
        "draft",
      );
      ctx.showMeasure(
        `Door ${preset.label} (Hover near wall to host) • Space: flip hand, F: flip facing, [1-5]: preset`,
        ctx.screenPoint(event),
      );
    }
  },
  onPointerDown(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw && !currentDoorPos) return true;

    const preset = DOOR_PRESETS[activeDoorPresetIndex] ?? DOOR_PRESETS[0];
    const pos = currentDoorPos ?? raw!;
    const rotY = currentDoorRotY;
    const depth = currentDoorSnap ? currentDoorSnap.wallWidth : 20;

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const name = `Door ${preset.label}`;

    void ctx.createEntity(
      {
        type: "door",
        width: preset.width,
        height: preset.height,
        depth,
        swing_deg: doorDraft.swingDeg,
      },
      [pos.x, currentDoorSnap ? currentDoorSnap.elevation : storey.elevation, pos.z],
      name,
      [q.x, q.y, q.z, q.w],
    );

    ctx.setStatus(
      `Door placed (${preset.label})${currentDoorSnap ? ` hosted on ${currentDoorSnap.wallEntity.name || "Wall"}` : ""}`,
    );
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
      ctx.setStatus(
        `Door · Flip facing: ${doorDraft.flipFacing ? "Exterior" : "Interior"}`,
      );
      return true;
    }
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= DOOR_PRESETS.length) {
      activeDoorPresetIndex = num - 1;
      const preset = DOOR_PRESETS[activeDoorPresetIndex];
      ctx.setStatus(`Door Type: ${preset.label}`);
      return true;
    }
    return false;
  },
  hint: () =>
    `Door · Click to place (snaps to wall centerline) · Space: flip hand, F: flip facing, [1-5]: switch size (${DOOR_PRESETS[activeDoorPresetIndex]?.label})`,
};

// ===========================================================================
// 3. WINDOW TOOL
// Wall-hosted window with surround frame, sill, panes, and wall alignment.
// Modeled after BIMCraft.
// ===========================================================================

export interface WindowPreset {
  id: string;
  label: string;
  width: number;
  height: number;
  sillHeight: number;
  panesX: number;
  panesY: number;
}

export const WINDOW_PRESETS: WindowPreset[] = [
  { id: "w120", label: "1200×1500 Double Casement", width: 120, height: 150, sillHeight: 90, panesX: 2, panesY: 2 },
  { id: "w80", label: "800×1200 Single Casement", width: 80, height: 120, sillHeight: 90, panesX: 1, panesY: 2 },
  { id: "w180", label: "1800×1500 Picture Window", width: 180, height: 150, sillHeight: 80, panesX: 3, panesY: 2 },
  { id: "w240", label: "2400×900 Ribbon Clerestory", width: 240, height: 90, sillHeight: 180, panesX: 4, panesY: 1 },
  { id: "w60", label: "600×900 Bathroom Frosted", width: 60, height: 90, sillHeight: 120, panesX: 1, panesY: 1 },
];

let activeWindowPresetIndex = 0;
let windowSillOverride: number | null = null;

let currentWindowSnap: WallSnapResult | null = null;
let currentWindowPos: THREE.Vector3 | null = null;
let currentWindowRotY = 0;

function buildWindowPreview(
  pos: THREE.Vector3,
  rotY: number,
  preset: WindowPreset,
  sillHeight: number,
  depth: number,
  snapResult: WallSnapResult | null,
  ctx: ToolContext,
): THREE.Object3D {
  const group = new THREE.Group();
  group.position.set(pos.x, pos.y + sillHeight + preset.height / 2, pos.z);
  group.rotation.y = rotY;

  const mat = previewMaterial(ctx);
  // Frame
  const frameGeo = new THREE.BoxGeometry(preset.width, preset.height, depth);
  const frameMesh = new THREE.Mesh(frameGeo, mat);
  frameMesh.renderOrder = 998;
  group.add(frameMesh);

  // Sill projection
  const sillGeo = new THREE.BoxGeometry(preset.width + 12, 6, depth + 8);
  const sillMesh = new THREE.Mesh(sillGeo, mat);
  sillMesh.position.set(0, -preset.height / 2 - 3, 0);
  group.add(sillMesh);

  // Glazing / glass pane preview
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.35,
    roughness: 0.1,
  });
  const glassGeo = new THREE.BoxGeometry(preset.width - 10, preset.height - 10, 2);
  const glassMesh = new THREE.Mesh(glassGeo, glassMat);
  group.add(glassMesh);

  // Host snap line
  if (snapResult) {
    const guidePts = [
      new THREE.Vector3(-preset.width * 1.5, -preset.height / 2 - sillHeight, 0),
      new THREE.Vector3(preset.width * 1.5, -preset.height / 2 - sillHeight, 0),
    ];
    const guideGeo = new THREE.BufferGeometry().setFromPoints(guidePts);
    const guideMat = new THREE.LineDashedMaterial({
      color: 0x22c55e,
      dashSize: 6,
      gapSize: 4,
      depthTest: false,
    });
    const guideLine = new THREE.Line(guideGeo, guideMat);
    guideLine.computeLineDistances();
    group.add(guideLine);
  }

  return group;
}

export const windowTool: ToolHandler = {
  id: "window",
  cursor: "crosshair",
  onActivate(ctx) {
    currentWindowSnap = null;
    currentWindowPos = null;
    ctx.clearPreview("draft");
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    currentWindowSnap = null;
    currentWindowPos = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return;

    const scene = useArcStore.getState().scene;
    const hostSnap = findNearestWallSegment(raw, scene, 80);
    const preset = WINDOW_PRESETS[activeWindowPresetIndex] ?? WINDOW_PRESETS[0];
    const sill = windowSillOverride ?? preset.sillHeight;

    let pos: THREE.Vector3;
    let rotY = 0;
    let depth = 20;

    if (hostSnap) {
      pos = hostSnap.projPoint.clone();
      rotY = hostSnap.segAngle;
      depth = hostSnap.wallWidth;
      currentWindowSnap = hostSnap;
      currentWindowPos = pos;
      currentWindowRotY = rotY;

      ctx.setPreview(
        buildWindowPreview(pos, rotY, preset, sill, depth, hostSnap, ctx),
        "draft",
      );
      ctx.showMeasure(
        `Window ${preset.label} (Sill: ${sill}cm) • Hosted on ${hostSnap.wallEntity.name || "Wall"} (${(hostSnap.offset / 100).toFixed(2)}m from corner) • [1-5]: size, [ / ]: sill ±10cm`,
        ctx.screenPoint(event),
      );
    } else {
      const snapped = ctx.snap(raw).point;
      pos = snapped;
      rotY = 0;
      currentWindowSnap = null;
      currentWindowPos = pos;
      currentWindowRotY = rotY;

      ctx.setPreview(
        buildWindowPreview(pos, rotY, preset, sill, depth, null, ctx),
        "draft",
      );
      ctx.showMeasure(
        `Window ${preset.label} (Sill: ${sill}cm) • Hover near wall to host • [1-5]: size, [ / ]: sill ±10cm`,
        ctx.screenPoint(event),
      );
    }
  },
  onPointerDown(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw && !currentWindowPos) return true;

    const preset = WINDOW_PRESETS[activeWindowPresetIndex] ?? WINDOW_PRESETS[0];
    const sill = windowSillOverride ?? preset.sillHeight;
    const pos = currentWindowPos ?? raw!;
    const rotY = currentWindowRotY;
    const depth = currentWindowSnap ? currentWindowSnap.wallWidth : 20;
    const baseElev = currentWindowSnap ? currentWindowSnap.elevation : storey.elevation;

    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    const name = `Window ${preset.label}`;

    void ctx.createEntity(
      {
        type: "window",
        width: preset.width,
        height: preset.height,
        depth,
        panes_x: preset.panesX,
        panes_y: preset.panesY,
      },
      [pos.x, baseElev + sill + preset.height / 2, pos.z],
      name,
      [q.x, q.y, q.z, q.w],
    );

    ctx.setStatus(
      `Window placed (${preset.label}, Sill ${sill}cm)${currentWindowSnap ? ` hosted on ${currentWindowSnap.wallEntity.name || "Wall"}` : ""}`,
    );
    return true;
  },
  onKey(event, ctx) {
    const preset = WINDOW_PRESETS[activeWindowPresetIndex] ?? WINDOW_PRESETS[0];
    const currentSill = windowSillOverride ?? preset.sillHeight;

    if (event.key === "[") {
      windowSillOverride = Math.max(0, currentSill - 10);
      ctx.setStatus(`Window Sill Height: ${windowSillOverride} cm`);
      return true;
    }
    if (event.key === "]") {
      windowSillOverride = Math.min(250, currentSill + 10);
      ctx.setStatus(`Window Sill Height: ${windowSillOverride} cm`);
      return true;
    }
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= WINDOW_PRESETS.length) {
      activeWindowPresetIndex = num - 1;
      windowSillOverride = null;
      const nextPreset = WINDOW_PRESETS[activeWindowPresetIndex];
      ctx.setStatus(`Window Type: ${nextPreset.label} (Sill: ${nextPreset.sillHeight}cm)`);
      return true;
    }
    return false;
  },
  hint: () =>
    `Window · Click to place (snaps to wall) · [1-5]: switch size (${WINDOW_PRESETS[activeWindowPresetIndex]?.label}) · [ / ]: sill height ±10cm`,
};

// ===========================================================================
// 4. SLAB / FLOOR TOOL
// Polygon footprint floor plate with thickness, live area takeoff HUD,
// and storey level binding. Modeled after BIMCraft.
// ===========================================================================

let slabPoints: THREE.Vector3[] = [];
export const SLAB_DEFAULT_THICKNESS = 20;

function resetSlab(ctx: ToolContext): void {
  slabPoints = [];
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
}

function calculatePolygonAreaM2(points: THREE.Vector3[]): number {
  if (points.length < 3) return 0;
  let areaCm2 = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    areaCm2 += points[i].x * points[j].z - points[j].x * points[i].z;
  }
  return Math.abs(areaCm2) * 0.5 / 10000;
}

function commitSlab(ctx: ToolContext): boolean {
  if (slabPoints.length < 3) return false;
  const storey = getActiveStorey();
  const polygon = slabPoints.map(flatXZ);
  const areaM2 = calculatePolygonAreaM2(slabPoints);

  const name = `Floor Slab (${areaM2.toFixed(1)} m²)`;
  void ctx.createEntity(
    {
      type: "slab",
      polygon,
      height: SLAB_DEFAULT_THICKNESS,
    },
    [0, storey.elevation, 0],
    name,
  );
  ctx.setStatus(`Floor slab created on ${storey.name} (${areaM2.toFixed(1)} m²)`);
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
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return true;

    const snapped = ctx.snap(raw, {
      extraPoints: slabPoints,
      anchor: slabPoints[slabPoints.length - 1],
    }).point;

    // Closing the boundary on first point
    if (slabPoints.length >= 3 && snapped.distanceTo(slabPoints[0]) < ctx.settings.gridSize * 0.7) {
      commitSlab(ctx);
      return true;
    }

    slabPoints.push(snapped);
    ctx.capturePointer(event);
    ctx.setStatus(
      `Floor Slab · Add vertex ${slabPoints.length + 1} · Enter or click first point commits (${slabPoints.length} vertices)`,
    );
    return true;
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw || slabPoints.length === 0) return;

    const cursor = ctx.snap(raw, {
      extraPoints: slabPoints,
      anchor: slabPoints[slabPoints.length - 1],
    }).point;

    const pts = [...slabPoints, cursor, slabPoints[0]];
    ctx.setPreview(previewLine(pts, ctx), "draft");

    const areaM2 = calculatePolygonAreaM2([...slabPoints, cursor]);
    const areaSqFt = areaM2 * 10.7639;
    ctx.showMeasure(
      `Floor Slab • ${slabPoints.length + 1} pts • Area: ${areaM2.toFixed(2)} m² (${areaSqFt.toFixed(0)} sq ft) • Enter commits`,
      ctx.screenPoint(event),
    );
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
// Pitch angle, eaves overhang, gable or hip roof. Modeled after BIMCraft.
// ===========================================================================

let roofAnchor: THREE.Vector3 | null = null;
const ROOF_PITCH_PRESETS = [15, 22.5, 30, 45];
let activeRoofPitchIndex = 2; // Default: 30 degrees
const ROOF_DEFAULT_OVERHANG = 40;

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
    const storey = getActiveStorey();
    const roofBaseElev = storey.elevation + storey.height;
    const raw = ctx.planePoint(event, roofBaseElev);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!roofAnchor) {
      roofAnchor = p;
      ctx.capturePointer(event);
      ctx.setStatus("Roof · Click opposite diagonal corner of roof footprint");
      return true;
    }

    const w = Math.abs(p.x - roofAnchor.x);
    const d = Math.abs(p.z - roofAnchor.z);
    if (w > 20 && d > 20) {
      const cx = (roofAnchor.x + p.x) / 2;
      const cz = (roofAnchor.z + p.z) / 2;
      const pitch = ROOF_PITCH_PRESETS[activeRoofPitchIndex];
      const areaM2 = (w * d) / 10000;
      const name = `Roof ${pitch}° (${(w / 100).toFixed(1)}×${(d / 100).toFixed(1)}m)`;

      void ctx.createEntity(
        {
          type: "roof",
          width: w,
          depth: d,
          pitch_deg: pitch,
          overhang: ROOF_DEFAULT_OVERHANG,
        },
        [cx, roofBaseElev, cz],
        name,
      );
      ctx.setStatus(`Created ${name} (${areaM2.toFixed(1)} m²)`);
    }

    roofAnchor = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const roofBaseElev = storey.elevation + storey.height;
    const raw = ctx.planePoint(event, roofBaseElev);
    if (!raw || !roofAnchor) return;
    const cursor = ctx.snap(raw, { anchor: roofAnchor }).point;

    const w = Math.abs(cursor.x - roofAnchor.x);
    const d = Math.abs(cursor.z - roofAnchor.z);
    const pitch = ROOF_PITCH_PRESETS[activeRoofPitchIndex];

    const geo = new THREE.BoxGeometry(w, 40, d);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set((roofAnchor.x + cursor.x) / 2, roofBaseElev, (roofAnchor.z + cursor.z) / 2);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(
      `Roof ${(w / 100).toFixed(1)}×${(d / 100).toFixed(1)}m • Area: ${(w * d / 10000).toFixed(1)} m² • Pitch: ${pitch}° • [1-4]: Pitch`,
      ctx.screenPoint(event),
    );
  },
  onKey(event, ctx) {
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= ROOF_PITCH_PRESETS.length) {
      activeRoofPitchIndex = num - 1;
      const pitch = ROOF_PITCH_PRESETS[activeRoofPitchIndex];
      ctx.setStatus(`Roof Pitch: ${pitch}°`);
      return true;
    }
    return false;
  },
  onCancel(ctx) {
    roofAnchor = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () =>
    `Roof · Click two diagonal corners to span footprint · [1-4]: pitch (${ROOF_PITCH_PRESETS[activeRoofPitchIndex]}°)`,
};

// ===========================================================================
// 6. COLUMN TOOL
// Circular or square architectural/structural columns with grid snapping.
// ===========================================================================

export interface ColumnPreset {
  id: string;
  label: string;
  radius: number;
  sides: number;
  widthCm: number;
}

export const COLUMN_PRESETS: ColumnPreset[] = [
  { id: "sq30", label: "300×300mm Square", radius: 21.2, sides: 4, widthCm: 30 },
  { id: "sq40", label: "400×400mm Square", radius: 28.3, sides: 4, widthCm: 40 },
  { id: "rd30", label: "Ø300mm Circular", radius: 15, sides: 16, widthCm: 30 },
  { id: "rd40", label: "Ø400mm Circular", radius: 20, sides: 16, widthCm: 40 },
];

let activeColumnPresetIndex = 0;

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
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return;
    const snapped = ctx.snap(raw).point;
    const preset = COLUMN_PRESETS[activeColumnPresetIndex] ?? COLUMN_PRESETS[0];

    const geo =
      preset.sides === 4
        ? new THREE.BoxGeometry(preset.widthCm, storey.height, preset.widthCm)
        : new THREE.CylinderGeometry(preset.radius, preset.radius, storey.height, preset.sides);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set(snapped.x, storey.elevation + storey.height / 2, snapped.z);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(
      `Column ${preset.label} • H: ${storey.height} cm • [1-4]: switch type`,
      ctx.screenPoint(event),
    );
  },
  onPointerDown(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return true;
    const snapped = ctx.snap(raw).point;
    const preset = COLUMN_PRESETS[activeColumnPresetIndex] ?? COLUMN_PRESETS[0];

    const name = `Column ${preset.label}`;
    void ctx.createEntity(
      {
        type: "column",
        radius: preset.radius,
        height: storey.height,
        sides: preset.sides,
      },
      [snapped.x, storey.elevation, snapped.z],
      name,
    );
    ctx.setStatus(`Column placed (${preset.label}) on ${storey.name}`);
    return true;
  },
  onKey(event, ctx) {
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= COLUMN_PRESETS.length) {
      activeColumnPresetIndex = num - 1;
      const preset = COLUMN_PRESETS[activeColumnPresetIndex];
      ctx.setStatus(`Column Type: ${preset.label}`);
      return true;
    }
    return false;
  },
  hint: () =>
    `Column · Click point or grid intersection to place · [1-4]: switch type (${COLUMN_PRESETS[activeColumnPresetIndex]?.label})`,
};

// ===========================================================================
// 7. BEAM TOOL
// Structural horizontal framing beam between two points at ceiling level.
// ===========================================================================

let beamStart: THREE.Vector3 | null = null;
const BEAM_DEFAULT_WIDTH = 20;
const BEAM_DEFAULT_HEIGHT = 40;

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
    const storey = getActiveStorey();
    const beamElev = storey.elevation + storey.height;
    const raw = ctx.planePoint(event, beamElev);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!beamStart) {
      beamStart = p;
      ctx.capturePointer(event);
      ctx.setStatus("Beam · Click end point");
      return true;
    }

    const len = beamStart.distanceTo(p);
    if (len > 15) {
      const mid = beamStart.clone().add(p).multiplyScalar(0.5);
      const angle = -Math.atan2(p.z - beamStart.z, p.x - beamStart.x);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      const name = `Beam 200×400mm (L=${(len / 100).toFixed(2)}m)`;

      void ctx.createEntity(
        {
          type: "beam",
          length: len,
          width: BEAM_DEFAULT_WIDTH,
          height: BEAM_DEFAULT_HEIGHT,
        },
        [mid.x, mid.y, mid.z],
        name,
        [q.x, q.y, q.z, q.w],
      );
      ctx.setStatus(`Beam placed (${(len / 100).toFixed(2)}m)`);
    }

    beamStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const beamElev = storey.elevation + storey.height;
    const raw = ctx.planePoint(event, beamElev);
    if (!raw || !beamStart) return;
    const cursor = ctx.snap(raw, { anchor: beamStart }).point;

    const len = beamStart.distanceTo(cursor);
    const geo = new THREE.BoxGeometry(len, BEAM_DEFAULT_HEIGHT, BEAM_DEFAULT_WIDTH);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set((beamStart.x + cursor.x) / 2, beamStart.y, (beamStart.z + cursor.z) / 2);
    mesh.rotation.y = -Math.atan2(cursor.z - beamStart.z, cursor.x - beamStart.x);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(
      `Beam L: ${(len / 100).toFixed(2)}m (${len.toFixed(0)} cm) • 200×400mm`,
      ctx.screenPoint(event),
    );
  },
  onCancel(ctx) {
    beamStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Beam · Click start and end points for structural framing beam",
};

// ===========================================================================
// 8. STAIR TOOL
// Interactive staircase with rise, run, and risers calculated to storey height.
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
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return true;
    const p = ctx.snap(raw).point;

    if (!stairStart) {
      stairStart = p;
      ctx.capturePointer(event);
      ctx.setStatus("Stair · Click flight landing / top of run");
      return true;
    }

    const dx = p.x - stairStart.x;
    const dz = p.z - stairStart.z;
    const totalRun = Math.hypot(dx, dz);
    if (totalRun > 30) {
      // Calculate risers to perfectly meet storey height (optimal rise ~17.5cm)
      const optimalStepCount = Math.max(3, Math.round(storey.height / 17.5));
      const actualRise = storey.height / optimalStepCount;
      const runPerStep = totalRun / optimalStepCount;
      const angle = -Math.atan2(dz, dx);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
      const name = `Staircase (${optimalStepCount} risers @ ${actualRise.toFixed(1)}cm)`;

      void ctx.createEntity(
        {
          type: "stair",
          width: 100,
          rise: actualRise,
          run: runPerStep,
          count: optimalStepCount,
        },
        [stairStart.x, storey.elevation, stairStart.z],
        name,
        [q.x, q.y, q.z, q.w],
      );
      ctx.setStatus(`Staircase placed: ${optimalStepCount} risers to ${storey.name}`);
    }

    stairStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
    return true;
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw || !stairStart) return;
    const cursor = ctx.snap(raw, { anchor: stairStart }).point;

    const totalRun = stairStart.distanceTo(cursor);
    const steps = Math.max(3, Math.round(storey.height / 17.5));
    const actualRise = storey.height / steps;
    ctx.setPreview(previewLine([stairStart, cursor], ctx), "draft");
    ctx.showMeasure(
      `Stair: ${steps} risers @ ${actualRise.toFixed(1)}cm rise (Run: ${(totalRun / 100).toFixed(2)}m)`,
      ctx.screenPoint(event),
    );
  },
  onCancel(ctx) {
    stairStart = null;
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () => "Stair · Click start and drag flight direction to meet storey height",
};

// ===========================================================================
// 9. ROOM / SPACE TOOL
// Defines space boundaries with live area takeoff and room presets.
// Modeled after BIMCraft.
// ===========================================================================

export interface RoomPreset {
  name: string;
  number: string;
}

export const ROOM_PRESETS: RoomPreset[] = [
  { name: "Living Room", number: "101" },
  { name: "Master Bedroom", number: "102" },
  { name: "Bedroom 2", number: "103" },
  { name: "Kitchen", number: "104" },
  { name: "Dining Room", number: "105" },
  { name: "Bathroom", number: "106" },
  { name: "Home Office", number: "107" },
  { name: "Hallway / Entry", number: "108" },
  { name: "Balcony / Terrace", number: "109" },
];

let activeRoomPresetIndex = 0;
let roomCorners: THREE.Vector3[] = [];

function calculatePerimeterM(points: THREE.Vector3[]): number {
  if (points.length < 2) return 0;
  let peri = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    peri += points[i].distanceTo(points[j]);
  }
  return peri / 100;
}

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
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return true;
    const p = ctx.snap(raw, {
      extraPoints: roomCorners,
      anchor: roomCorners[roomCorners.length - 1],
    }).point;

    if (
      roomCorners.length >= 3 &&
      p.distanceTo(roomCorners[0]) < ctx.settings.gridSize * 0.7
    ) {
      const preset = ROOM_PRESETS[activeRoomPresetIndex] ?? ROOM_PRESETS[0];
      const polygon = roomCorners.map(flatXZ);
      const areaM2 = calculatePolygonAreaM2(roomCorners);
      const name = `${preset.name} (${preset.number})`;

      void ctx.createEntity(
        {
          type: "room",
          name: preset.name,
          number: preset.number,
          polygon,
        },
        [0, storey.elevation, 0],
        name,
      );
      ctx.setStatus(`Room created: ${name} (${areaM2.toFixed(1)} m²)`);
      roomCorners = [];
      ctx.clearPreview("draft");
      ctx.showMeasure(null);
      return true;
    }

    roomCorners.push(p);
    ctx.capturePointer(event);
    const preset = ROOM_PRESETS[activeRoomPresetIndex] ?? ROOM_PRESETS[0];
    ctx.setStatus(
      `Room (${preset.name}) · Add corner ${roomCorners.length + 1} · Click first vertex commits · [1-9]: switch template`,
    );
    return true;
  },
  onPointerMove(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw || roomCorners.length === 0) return;
    const cursor = ctx.snap(raw, {
      extraPoints: roomCorners,
      anchor: roomCorners[roomCorners.length - 1],
    }).point;

    const pts = [...roomCorners, cursor, roomCorners[0]];
    ctx.setPreview(previewLine(pts, ctx), "draft");

    const areaM2 = calculatePolygonAreaM2([...roomCorners, cursor]);
    const periM = calculatePerimeterM([...roomCorners, cursor]);
    const preset = ROOM_PRESETS[activeRoomPresetIndex] ?? ROOM_PRESETS[0];
    ctx.showMeasure(
      `Room: ${preset.name} (${preset.number}) • Area: ${areaM2.toFixed(2)} m² • Perimeter: ${periM.toFixed(1)} m • [1-9]: Template`,
      ctx.screenPoint(event),
    );
  },
  onKey(event, ctx) {
    const num = parseInt(event.key, 10);
    if (num >= 1 && num <= ROOM_PRESETS.length) {
      activeRoomPresetIndex = num - 1;
      const preset = ROOM_PRESETS[activeRoomPresetIndex];
      ctx.setStatus(`Room Template: ${preset.name} (${preset.number})`);
      return true;
    }
    return false;
  },
  onCancel(ctx) {
    roomCorners = [];
    ctx.clearPreview("draft");
    ctx.showMeasure(null);
  },
  hint: () =>
    `Room · Click boundary corners to tag space · [1-9]: switch template (${ROOM_PRESETS[activeRoomPresetIndex]?.name})`,
};

// ===========================================================================
// 10. COMPONENT / FURNITURE TOOL
// Places architectural components (sofa, table, desk, chair, bed, cabinet, sink, toilet).
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
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
    if (!raw) return;
    const snapped = ctx.snap(raw).point;

    const spec = COMPONENT_SPECS[activeCompKind];
    const geo = new THREE.BoxGeometry(spec.w, spec.h, spec.d);
    const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
    mesh.position.set(snapped.x, storey.elevation + spec.h / 2, snapped.z);
    mesh.rotation.y = THREE.MathUtils.degToRad(compRotationDeg);

    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(`${spec.label} • Space: rotate 45° • [1-8]: type`, ctx.screenPoint(event));
  },
  onPointerDown(event, ctx) {
    const storey = getActiveStorey();
    const raw = ctx.planePoint(event, storey.elevation);
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
      [snapped.x, storey.elevation, snapped.z],
      spec.label,
      [q.x, q.y, q.z, q.w],
    );
    ctx.setStatus(`${spec.label} placed on ${storey.name}`);
    return true;
  },
  onKey(event, ctx) {
    if (event.key === " " || event.code === "Space") {
      compRotationDeg = (compRotationDeg + 45) % 360;
      ctx.setStatus(`Rotate: ${compRotationDeg}°`);
      return true;
    }
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
// Architectural structural datum grid line with numbered bubble heads.
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
    ctx.showMeasure(
      `Grid Length: ${(gridStart.distanceTo(cursor) / 100).toFixed(2)}m (${gridStart.distanceTo(cursor).toFixed(0)} cm)`,
      ctx.screenPoint(event),
    );
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
