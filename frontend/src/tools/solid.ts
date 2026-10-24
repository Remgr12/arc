import * as THREE from "three";
import type { EntityData, ToolId } from "../lib/types";
import type { ToolContext, ToolHandler } from "./types";
import { chainFromEntity, resampleLoop, type Chain } from "./geometry2d";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";

// ---------------------------------------------------------------------------
// Solid modeling tools in the Shapr3D style: pick a sketch profile, then
// interactively shape the solid. All tools reuse sketch entities via
// chainFromEntity and emit kernel `extrude` / `revolve` / `sweep` / `loft`
// geometry payloads.
//
// Kernel notes (crates/arc-core/src/meshgen.rs):
//   Extrude  recenters the polygon to its vertex mean and extrudes
//            -height/2..+height/2 around the local origin, so world position
//            is (mean, height/2, mean) with the polygon passed relative.
//   Revolve  lathes an (radius, height) profile about the LOCAL Y axis; the
//            entity transform carries the axis orientation.
//   Sweep    path points are used as-is (world coords, identity transform).
//   Loft     sections are used as-is and must share equal vertex counts.
// ---------------------------------------------------------------------------

const EPS = 1e-6;

interface PickedChain {
  chain: Chain;
  entity: EntityData;
}

// ----------------------------------------------------------------- helpers

function formatNum(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Extract the polyline under the cursor from a sketch entity. */
function pickChain(event: PointerEvent | MouseEvent, ctx: ToolContext): PickedChain | null {
  const id = ctx.pickEntity(event);
  if (!id) return null;
  const entity = ctx.entityById(id);
  if (!entity) return null;
  const chain = chainFromEntity(entity, ctx.objectFor(id));
  if (!chain || chain.points.length < 2) return null;
  return { chain, entity };
}

/** Signed cursor height along `normal` from `base`, snapped to dimSnapStep. */
function cursorHeight(
  ctx: ToolContext,
  event: PointerEvent | MouseEvent,
  base: THREE.Vector3,
  normal: THREE.Vector3,
): number {
  const forward = new THREE.Vector3();
  ctx.camera.getWorldDirection(forward);
  forward.addScaledVector(normal, -forward.dot(normal));
  if (forward.lengthSq() < 1e-6) {
    forward.crossVectors(normal, new THREE.Vector3(1, 0, 0));
    if (forward.lengthSq() < 1e-6) forward.crossVectors(normal, new THREE.Vector3(0, 0, 1));
  }
  forward.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, base);
  const out = new THREE.Vector3();
  const hit = ctx.rayAt(event).intersectPlane(plane, out);
  const raw = hit ? out.sub(base).dot(normal) : 20;
  const sign = raw < 0 ? -1 : 1;
  const mag = Math.max(0.5, ctx.snapDim(Math.abs(raw), event.altKey));
  return sign * mag;
}

/** Camera ray ∩ plane; null when the ray is parallel or misses. */
function rayPlaneHit(ctx: ToolContext, event: PointerEvent | MouseEvent, plane: THREE.Plane): THREE.Vector3 | null {
  const out = new THREE.Vector3();
  return ctx.rayAt(event).intersectPlane(plane, out) ? out : null;
}

/** Vertical plane through a segment; fallback for 2-point line profiles. */
function planeThroughSegment(a: THREE.Vector3, b: THREE.Vector3): THREE.Plane | null {
  const dir = new THREE.Vector3().subVectors(b, a);
  if (dir.lengthSq() < EPS) return null;
  dir.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let n = new THREE.Vector3().crossVectors(dir, up);
  if (n.lengthSq() < EPS) n = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(1, 0, 0));
  if (n.lengthSq() < EPS) return null;
  return new THREE.Plane().setFromNormalAndCoplanarPoint(n.normalize(), a);
}

/** General plane containing a polyline (first non-collinear triple). */
function planeThroughPoints(pts: THREE.Vector3[]): THREE.Plane | null {
  for (let i = 2; i < pts.length; i++) {
    const normal = new THREE.Vector3()
      .subVectors(pts[1], pts[0])
      .cross(new THREE.Vector3().subVectors(pts[i], pts[0]));
    if (normal.lengthSq() > EPS) {
      normal.normalize();
      return new THREE.Plane().setFromNormalAndCoplanarPoint(normal, pts[0]);
    }
  }
  return planeThroughSegment(pts[0], pts[pts.length - 1]);
}

/** Map world points into the frame of an axis (origin, unit direction). */
function axisFrame(points: THREE.Vector3[], origin: THREE.Vector3, direction: THREE.Vector3): [number, number][] {
  return points.map((q) => {
    const v = q.clone().sub(origin);
    const along = v.dot(direction);
    v.addScaledVector(direction, -along);
    return [v.length(), along] as [number, number];
  });
}

function polylineCoordinates(points: THREE.Vector3[]): [number, number, number][] {
  return points.map((p) => [p.x, p.y, p.z] as [number, number, number]);
}

// Managed "draft" preview. Only one solid tool is active at a time, so a
// module-level tracker is safe; disposals compensate for any preview slots
// the viewport does not clear.
let draft: THREE.Object3D | null = null;

function clearDraft(ctx: ToolContext): void {
  if (draft) {
    draft.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    draft = null;
  }
  ctx.clearPreview("draft");
}

function showDraft(obj: THREE.Object3D, ctx: ToolContext): void {
  clearDraft(ctx);
  draft = obj;
  ctx.setPreview(obj, "draft");
}

function previewMaterial(ctx: ToolContext): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.6,
    roughness: 0.55,
    metalness: 0.05,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  mat.color.copy(ctx.palette.hover);
  return mat;
}

// ----------------------------------------------------------------- extrude

interface ExtrudeDraft {
  points: THREE.Vector3[];
  centroid: THREE.Vector3;
  normal: THREE.Vector3;
  u: THREE.Vector3;
  v: THREE.Vector3;
  quat: THREE.Quaternion;
  isHorizontal: boolean;
  height: number;
  forceCut: boolean;
  cutTargetId: string | null;
  typed: string;
  lastScreen: { x: number; y: number } | undefined;
  mesh: THREE.Mesh;
  wire: THREE.LineSegments;
}

let ext: ExtrudeDraft | null = null;
const CUT_COLOR = new THREE.Color(0xef4444);

function findCutTarget(d: ExtrudeDraft, h: number, ctx: ToolContext): string | null {
  // Auto-subtract when extruding inward (h < 0) or when Shift (forceCut) is held.
  if (h >= 0 && !d.forceCut) return null;
  const scene = ctx.scene();
  if (!scene) return null;
  const probe = d.centroid.clone().addScaledVector(d.normal, h * 0.5);
  const endPt = d.centroid.clone().addScaledVector(d.normal, h);
  const box = new THREE.Box3();
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const entity of scene.entities) {
    if (!entity.visible || entity.locked || entity.category === "sketch") continue;
    if (!entity.triPositions || entity.triPositions.length === 0) continue;
    const obj = ctx.objectFor(entity.id);
    if (!obj || !obj.visible) continue;
    box.setFromObject(obj);
    if (box.isEmpty()) continue;
    box.expandByScalar(0.2);
    if (box.containsPoint(probe) || box.containsPoint(endPt) || box.containsPoint(d.centroid)) {
      const dist = box.getCenter(new THREE.Vector3()).distanceTo(probe);
      if (dist < bestDist) {
        bestDist = dist;
        bestId = entity.id;
      }
    }
  }
  return bestId;
}

function updateExtrudePreview(d: ExtrudeDraft, ctx: ToolContext): void {
  const rawH = Math.abs(d.height) < 0.05 ? (d.height < 0 ? -0.05 : 0.05) : d.height;
  const absH = Math.abs(rawH);
  d.cutTargetId = findCutTarget(d, rawH, ctx);
  const isCutting = d.cutTargetId !== null;

  if (rawH >= 0) {
    d.mesh.position.copy(d.centroid);
  } else {
    d.mesh.position.copy(d.centroid).addScaledVector(d.normal, rawH);
  }
  d.mesh.scale.set(1, absH, 1);
  d.mesh.updateMatrix();

  const mat = d.mesh.material as THREE.MeshStandardMaterial;
  const wireMat = d.wire.material as THREE.LineBasicMaterial;
  mat.color.copy(isCutting ? CUT_COLOR : ctx.palette.hover);
  wireMat.color.copy(isCutting ? CUT_COLOR : ctx.palette.hover);

  ctx.requestRender();
  const u = ctx.settings.unitLabel;
  const prefix = isCutting ? "CUT" : "H";
  ctx.showMeasure(
    d.typed
      ? `${prefix} ${d.typed}| ${u}`
      : `${prefix} ${formatNum(absH)} ${u}${isCutting ? " (Subtract)" : ""}`,
    d.lastScreen,
  );
}

function startExtrude(chain: Chain, ctx: ToolContext): void {
  const points = chain.points.map((p) => p.clone());
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
    cz += p.z;
  }
  cx /= points.length;
  cy /= points.length;
  cz /= points.length;
  const centroid = new THREE.Vector3(cx, cy, cz);

  // Determine the sketch profile plane normal
  const fitPlane = planeThroughPoints(points);
  const normal = fitPlane ? fitPlane.normal.clone().normalize() : new THREE.Vector3(0, 1, 0);

  // Orient normal outward from any adjacent solid face (or toward +Y / camera)
  const scene = ctx.scene();
  let alignedToHost = false;
  if (scene) {
    const box = new THREE.Box3();
    for (const entity of scene.entities) {
      if (!entity.visible || entity.category === "sketch" || !entity.triPositions?.length) continue;
      const obj = ctx.objectFor(entity.id);
      if (!obj) continue;
      box.setFromObject(obj);
      if (!box.isEmpty() && box.distanceToPoint(centroid) <= 1.2) {
        const hostCenter = box.getCenter(new THREE.Vector3());
        if (centroid.clone().sub(hostCenter).dot(normal) < -0.05) {
          normal.negate();
        }
        alignedToHost = true;
        break;
      }
    }
  }
  if (!alignedToHost) {
    if (Math.abs(normal.y) > 0.98) {
      if (normal.y < 0) normal.negate();
    } else if (ctx.camera.position.clone().sub(centroid).dot(normal) < 0) {
      normal.negate();
    }
  }

  const isHorizontal = Math.abs(normal.x) < 1e-4 && Math.abs(normal.z) < 1e-4 && normal.y > 0;
  const quat = isHorizontal
    ? new THREE.Quaternion()
    : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
  const u = new THREE.Vector3(1, 0, 0).applyQuaternion(quat).normalize();
  const v = new THREE.Vector3(0, 0, 1).applyQuaternion(quat).normalize();

  const shape = new THREE.Shape(
    points.map((p) => {
      const rel = p.clone().sub(centroid);
      return new THREE.Vector2(rel.dot(u), -rel.dot(v));
    }),
  );
  // Build unit-depth ExtrudeGeometry once; mouse move scales Y in O(1)!
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
  geo.rotateX(-Math.PI / 2); // +Z (extrusion) → +Y; shape XY → local XZ
  const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
  const edges = new THREE.EdgesGeometry(geo, 25);
  const wire = new THREE.LineSegments(
    edges,
    new THREE.LineBasicMaterial({ color: ctx.palette.hover, transparent: true, opacity: 0.9, depthTest: false }),
  );
  wire.renderOrder = 998;
  mesh.add(wire);
  mesh.position.copy(centroid);
  mesh.quaternion.copy(quat);
  mesh.renderOrder = 997;
  mesh.frustumCulled = false;
  showDraft(mesh, ctx);

  ext = {
    points,
    centroid,
    normal,
    u,
    v,
    quat,
    isHorizontal,
    height: 20,
    forceCut: false,
    cutTargetId: null,
    typed: "",
    lastScreen: undefined,
    mesh,
    wire,
  };
  updateExtrudePreview(ext, ctx);
  ctx.setStatus("Drag outward to add or inward into a solid to Cut · click or type H + Enter");
}

function commitExtrudeHeight(signedH: number, ctx: ToolContext): void {
  const d = ext;
  if (!d) return;
  const rawH = Math.abs(signedH) < 0.05 ? 20 : signedH;
  const absH = Math.abs(rawH);
  const targetId = findCutTarget(d, rawH, ctx);
  const isCutting = targetId !== null;

  const polygon = d.points.map((p) => {
    const rel = p.clone().sub(d.centroid);
    return [rel.dot(d.u), rel.dot(d.v)] as [number, number];
  });

  // Add slight overshoot on entry face when boolean-cutting to prevent coplanar skin artifacts
  const overshoot = isCutting ? 0.1 : 0;
  const finalH = absH + overshoot;
  const offsetAlongNormal =
    rawH >= 0 ? (absH - overshoot * 0.5) / 2 : -(absH - overshoot * 0.5) / 2;
  const center = d.centroid.clone().addScaledVector(d.normal, offsetAlongNormal);
  const pos: [number, number, number] = [center.x, center.y, center.z];
  const rot: [number, number, number, number] = [d.quat.x, d.quat.y, d.quat.z, d.quat.w];
  const docId = ctx.docId();

  void (async () => {
    const createdId = await ctx.createEntity(
      { type: "extrude", polygon, height: finalH },
      pos,
    );
    if (!createdId) return;
    if (!d.isHorizontal) {
      await ctx.setTransform(createdId, { position: pos, rotation: rot, scale: [1, 1, 1] }, false);
    }
    if (isCutting && targetId && docId) {
      try {
        const res = await ipc.csgApply(docId, "difference", targetId, createdId);
        const overview = await ipc.getState();
        useArcStore.getState().setOverview(overview);
        useArcStore.getState().setScene(await ipc.getScene(docId));
        await ipc.setSelection(docId, [res.id], res.id);
        ctx.setStatus(`Extrude-Cut ${formatNum(absH)} ${ctx.settings.unitLabel}`);
        return;
      } catch {
        // Fallback: keep extruded body if boolean fails
      }
    }
    ctx.setStatus(`Extruded H ${formatNum(absH)} ${ctx.settings.unitLabel} · pick another closed profile`);
  })();

  ext = null;
  clearDraft(ctx);
  ctx.showMeasure(null);
}

function commitExtrude(event: PointerEvent, ctx: ToolContext): void {
  const d = ext;
  if (!d) return;
  d.forceCut = event.shiftKey;
  const parsed = d.typed ? Number.parseFloat(d.typed) : Number.NaN;
  const h =
    Number.isFinite(parsed) && Math.abs(parsed) > 0
      ? parsed
      : cursorHeight(ctx, event, d.centroid, d.normal);
  commitExtrudeHeight(h, ctx);
}

let armSelectedSketchOnce = false;

export function armExtrudeSelectedSketch(): void {
  armSelectedSketchOnce = true;
}

export const extrudeTool: ToolHandler = {
  id: "extrude" as ToolId,
  cursor: "crosshair",
  onActivate(ctx) {
    ext = null;
    clearDraft(ctx);
    ctx.showMeasure(null);
    // Only auto-start extruding a selected sketch when explicitly triggered from a sketch's action menu.
    if (armSelectedSketchOnce) {
      armSelectedSketchOnce = false;
      for (const id of ctx.selection()) {
        const entity = ctx.entityById(id);
        if (!entity || entity.category !== "sketch") continue;
        const chain = chainFromEntity(entity, ctx.objectFor(id));
        if (chain && chain.closed && chain.points.length >= 3) {
          startExtrude(chain, ctx);
          return;
        }
      }
    }
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    armSelectedSketchOnce = false;
    ext = null;
    clearDraft(ctx);
    ctx.showMeasure(null);
  },
  hasActivity: () => ext !== null,
  onPointerDown(event, ctx) {
    if (!ext) {
      const picked = pickChain(event, ctx);
      if (picked && picked.chain.closed) {
        startExtrude(picked.chain, ctx);
        return true;
      }
      // Also allow clicking any 3D solid face to push/pull that face!
      const face = ctx.pickFace(event);
      if (face) {
        ctx.setSelectionRef({
          entityId: face.entityId,
          kind: "face",
          face: face.faceIndex,
          edge: null,
          point: face.point,
          normal: face.normal,
        });
        void ctx.setSelection([face.entityId], face.entityId);
        useArcStore.getState().setTool("extrude-face");
        return true;
      }
      if (picked && !picked.chain.closed) {
        ctx.setStatus("Profile must be closed · click a closed sketch profile or a 3D face");
        return true;
      }
      ctx.setStatus("Click a closed sketch profile or a 3D solid face to extrude");
      return true;
    }
    commitExtrude(event, ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const d = ext;
    if (!d) {
      ctx.showMeasure(null);
      return;
    }
    d.lastScreen = ctx.screenPoint(event);
    d.forceCut = event.shiftKey;
    const parsed = d.typed ? Number.parseFloat(d.typed) : Number.NaN;
    d.height =
      Number.isFinite(parsed) && Math.abs(parsed) > 0
        ? parsed
        : cursorHeight(ctx, event, d.centroid, d.normal);
    updateExtrudePreview(d, ctx);
  },
  onKey(event, ctx) {
    const d = ext;
    if (!d) return false;
    if (/^[0-9.-]$/.test(event.key)) {
      if (event.key === "-" && d.typed.length > 0) {
        d.typed = d.typed.startsWith("-") ? d.typed.slice(1) : `-${d.typed}`;
      } else {
        d.typed += event.key;
      }
      const parsed = Number.parseFloat(d.typed);
      if (Number.isFinite(parsed) && Math.abs(parsed) > 0) d.height = parsed;
      updateExtrudePreview(d, ctx);
      return true;
    }
    return false;
  },
  onBackspace(ctx) {
    const d = ext;
    if (d && d.typed.length > 0) {
      d.typed = d.typed.slice(0, -1);
      const parsed = Number.parseFloat(d.typed);
      if (Number.isFinite(parsed) && Math.abs(parsed) > 0) d.height = parsed;
      updateExtrudePreview(d, ctx);
    }
  },
  onEnter(ctx) {
    const d = ext;
    if (!d) return false;
    const parsed = d.typed ? Number.parseFloat(d.typed) : Number.NaN;
    const h = Number.isFinite(parsed) && Math.abs(parsed) > 0 ? parsed : d.height;
    commitExtrudeHeight(h, ctx);
    return true;
  },
  onCancel(ctx) {
    if (ext) {
      ext = null;
      clearDraft(ctx);
      ctx.showMeasure(null);
      ctx.setStatus("Extrude cancelled · pick a closed profile");
    }
  },
  hint: () => "Extrude / Cut · click closed profile, drag outward to add or inward into a solid to Cut",
};

// ----------------------------------------------------------------- revolve

interface RevolveDraft {
  profile: THREE.Vector3[];
  plane: THREE.Plane;
  p1: THREE.Vector3 | null;
  axis: THREE.Vector3 | null;
  startX: number;
  angle: number;
  typed: string;
  lastScreen: { x: number; y: number } | undefined;
}

let rev: RevolveDraft | null = null;

/**
 * Compute the local-to-world orientation quaternion for a revolve solid so that:
 * - Local +Y aligns with `axis`
 * - Local +Z aligns with the radial direction from the axis toward the profile
 *   (matching `shapes::revolve_solid` and `THREE.LatheGeometry` which place
 *   phi = 0 at `[0, y, r]` in the +Z / Y half-plane).
 */
function frameQuat(axis: THREE.Vector3, profile: THREE.Vector3[], origin: THREE.Vector3): THREE.Quaternion {
  const yAxis = axis.clone().normalize();
  let radial = new THREE.Vector3();
  for (const q of profile) {
    const v = q.clone().sub(origin);
    v.addScaledVector(yAxis, -v.dot(yAxis));
    if (v.lengthSq() > radial.lengthSq()) {
      radial.copy(v);
    }
  }
  if (radial.lengthSq() < EPS) {
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), yAxis);
  }
  const zAxis = radial.normalize();
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function latheProfile(points: [number, number][]): [number, number][] {
  // Preserve vertex order along the profile chain so non-monotonic profiles
  // (arcs, C-shapes, multi-segment polylines) are not scrambled!
  return [...points];
}

function revolvePreview(d: RevolveDraft, ctx: ToolContext): void {
  const p1 = d.p1;
  const axis = d.axis;
  if (!p1 || !axis) return;
  const profile = latheProfile(axisFrame(d.profile, p1, axis));
  const geo = new THREE.LatheGeometry(
    profile.map(([r, t]) => new THREE.Vector2(r, t)),
    32,
    0,
    (d.angle * Math.PI) / 180,
  );
  const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
  mesh.position.copy(p1);
  mesh.quaternion.copy(frameQuat(axis, d.profile, p1));
  mesh.renderOrder = 997;
  mesh.frustumCulled = false;
  showDraft(mesh, ctx);
  ctx.showMeasure(
    d.typed ? `∠${d.typed}|°` : `∠${formatNum(d.angle)}°`,
    d.lastScreen,
  );
}

function commitRevolve(ctx: ToolContext): void {
  const d = rev;
  if (!d) return;
  const p1 = d.p1;
  const axis = d.axis;
  if (!p1 || !axis) return;
  const profile = latheProfile(axisFrame(d.profile, p1, axis));
  const quat = frameQuat(axis, d.profile, p1);
  const position: [number, number, number] = [p1.x, p1.y, p1.z];
  const rotation: [number, number, number, number] = [quat.x, quat.y, quat.z, quat.w];
  const isIdentityQuat =
    Math.abs(quat.x) < 1e-6 &&
    Math.abs(quat.y) < 1e-6 &&
    Math.abs(quat.z) < 1e-6 &&
    Math.abs(quat.w - 1) < 1e-6;
  void ctx
    .createEntity(
      { type: "revolve", profile, steps: 64, angle_deg: d.angle },
      position,
    )
    .then((id) => {
      if (id && !isIdentityQuat) {
        void ctx.setTransform(
          id,
          { position, rotation, scale: [1, 1, 1] },
          false,
        );
      }
    });
  rev = null;
  clearDraft(ctx);
  ctx.showMeasure(null);
}

export const revolveTool: ToolHandler = {
  id: "revolve" as ToolId,
  cursor: "crosshair",
  onActivate(ctx) {
    rev = null;
    clearDraft(ctx);
    ctx.showMeasure(null);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    rev = null;
    clearDraft(ctx);
    ctx.showMeasure(null);
  },
  hasActivity: () => rev !== null,
  onPointerDown(event, ctx) {
    if (!rev) {
      const picked = pickChain(event, ctx);
      if (!picked) {
        ctx.setStatus("No sketch under cursor · click an open profile");
        return true;
      }
      if (picked.chain.closed) {
        ctx.setStatus("Profile must be open · revolve needs an open chain");
        return true;
      }
      const plane = planeThroughPoints(picked.chain.points);
      if (!plane) {
        ctx.setStatus("Degenerate profile");
        return true;
      }
      rev = {
        profile: picked.chain.points.map((p) => p.clone()),
        plane,
        p1: null,
        axis: null,
        startX: 0,
        angle: 360,
        typed: "",
        lastScreen: ctx.screenPoint(event),
      };
      ctx.setStatus("Click the first point on the revolve axis");
      return true;
    }
    if (!rev.p1) {
      const hit = rayPlaneHit(ctx, event, rev.plane);
      if (!hit) return true;
      rev.p1 = ctx.snap(hit).point.clone();
      ctx.setStatus("Click the second point on the revolve axis");
      return true;
    }
    if (!rev.axis) {
      const hit = rayPlaneHit(ctx, event, rev.plane);
      if (!hit) return true;
      const p2 = ctx.snap(hit).point;
      const dir = new THREE.Vector3().subVectors(p2, rev.p1);
      if (dir.length() < 1e-4) {
        ctx.setStatus("Axis points are too close · click further apart");
        return true;
      }
      dir.normalize();
      rev.axis = dir;
      rev.startX = event.clientX;
      rev.angle = 360;
      rev.lastScreen = ctx.screenPoint(event);
      revolvePreview(rev, ctx);
      ctx.setStatus("Move to set the sweep angle (or type angle + Enter) · click to commit");
      return true;
    }
    // Phase 3: click commits.
    commitRevolve(ctx);
    ctx.setStatus("Revolved · pick another open profile");
    return true;
  },
  onPointerMove(event, ctx) {
    const d = rev;
    if (!d || !d.axis) {
      if (!d) ctx.showMeasure(null);
      return;
    }
    d.lastScreen = ctx.screenPoint(event);
    if (!d.typed) {
      const dx = event.clientX - d.startX;
      d.angle = Math.max(10, Math.min(360, dx <= 0 ? 360 : 360 * (dx / 300)));
    }
    revolvePreview(d, ctx);
  },
  onKey(event, ctx) {
    const d = rev;
    if (!d || !d.axis) return false;
    if (/^[0-9.]$/.test(event.key)) {
      d.typed += event.key;
      const parsed = Number.parseFloat(d.typed);
      if (Number.isFinite(parsed) && parsed > 0) {
        d.angle = Math.max(1, Math.min(360, parsed));
      }
      revolvePreview(d, ctx);
      return true;
    }
    return false;
  },
  onBackspace(ctx) {
    const d = rev;
    if (d && d.axis && d.typed.length > 0) {
      d.typed = d.typed.slice(0, -1);
      const parsed = Number.parseFloat(d.typed);
      if (Number.isFinite(parsed) && parsed > 0) {
        d.angle = Math.max(1, Math.min(360, parsed));
      }
      revolvePreview(d, ctx);
    }
  },
  onEnter(ctx) {
    const d = rev;
    if (!d || !d.axis) return false;
    commitRevolve(ctx);
    ctx.setStatus("Revolved · pick another open profile");
    return true;
  },
  onCancel(ctx) {
    const d = rev;
    if (!d) return;
    if (d.axis) {
      d.axis = null; // back to re-picking the second axis point
      d.typed = "";
      clearDraft(ctx);
      ctx.showMeasure(null);
      ctx.setStatus("Angle cancelled · click the second axis point again");
    } else if (d.p1) {
      d.p1 = null;
      ctx.setStatus("Click the first point on the revolve axis");
    } else {
      rev = null;
      clearDraft(ctx);
      ctx.setStatus("Revolve cancelled · pick an open profile");
    }
  },
  hint: () => "Revolve · click an open profile, two axis points, then set angle",
};

// ------------------------------------------------------------------- sweep

let sweepPath: THREE.Vector3[] | null = null;
let sweepRadius = 1;
let sweepTyped = "";
let sweepScreen: { x: number; y: number } | undefined;

function sweepLength(path: THREE.Vector3[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += path[i].distanceTo(path[i - 1]);
  return total;
}

function updateSweepPreview(ctx: ToolContext): void {
  const path = sweepPath;
  if (!path || path.length < 2) return;
  const curve = new THREE.CatmullRomCurve3(path, false, "centripetal");
  const geo = new THREE.TubeGeometry(curve, 64, sweepRadius, 16, false);
  const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
  mesh.renderOrder = 997;
  mesh.frustumCulled = false;
  showDraft(mesh, ctx);
  ctx.showMeasure(
    sweepTyped ? `R ${sweepTyped}|` : `R ${formatNum(sweepRadius)}`,
    sweepScreen,
  );
}

function commitSweep(ctx: ToolContext): void {
  const path = sweepPath;
  if (!path) return;
  void ctx.createEntity(
    { type: "sweep", path: polylineCoordinates(path), radius: sweepRadius, sides: 16 },
    [0, 0, 0],
  );
  sweepPath = null;
  sweepTyped = "";
  clearDraft(ctx);
  ctx.showMeasure(null);
  ctx.setStatus(`Swept R ${formatNum(sweepRadius)} · pick another open path`);
}

export const sweepTool: ToolHandler = {
  id: "sweep" as ToolId,
  cursor: "crosshair",
  onActivate(ctx) {
    sweepPath = null;
    sweepTyped = "";
    clearDraft(ctx);
    ctx.showMeasure(null);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    sweepPath = null;
    sweepTyped = "";
    clearDraft(ctx);
    ctx.showMeasure(null);
  },
  hasActivity: () => sweepPath !== null && sweepPath.length >= 2,
  onPointerDown(event, ctx) {
    if (!sweepPath) {
      const picked = pickChain(event, ctx);
      if (!picked) {
        ctx.setStatus("No sketch under cursor · click an open path");
        return true;
      }
      if (picked.chain.closed) {
        ctx.setStatus("Path must be open · sweep needs an open chain");
        return true;
      }
      sweepPath = picked.chain.points.map((p) => p.clone());
      sweepRadius = 2;
      sweepTyped = "";
      sweepScreen = ctx.screenPoint(event);
      updateSweepPreview(ctx);
      ctx.setStatus("Move to size the tube (or type R + Enter) · click to commit · Esc re-picks");
      return true;
    }
    commitSweep(ctx);
    return true;
  },
  onPointerMove(event, ctx) {
    const path = sweepPath;
    if (!path || path.length < 2) {
      ctx.showMeasure(null);
      return;
    }
    sweepScreen = ctx.screenPoint(event);
    if (!sweepTyped) {
      const cursor = ctx.planePoint(event, path[0].y);
      if (!cursor) return;
      const maxRadius = Math.max(1, sweepLength(path) / 3);
      const rawR = Math.max(0.5, Math.min(maxRadius, cursor.distanceTo(path[0])));
      sweepRadius = Math.max(0.5, ctx.snapDim(rawR, event.altKey));
    }
    updateSweepPreview(ctx);
  },
  onKey(event, ctx) {
    if (!sweepPath) return false;
    if (/^[0-9.]$/.test(event.key)) {
      sweepTyped += event.key;
      const parsed = Number.parseFloat(sweepTyped);
      if (Number.isFinite(parsed) && parsed > 0) sweepRadius = parsed;
      updateSweepPreview(ctx);
      return true;
    }
    return false;
  },
  onBackspace(ctx) {
    if (sweepPath && sweepTyped.length > 0) {
      sweepTyped = sweepTyped.slice(0, -1);
      const parsed = Number.parseFloat(sweepTyped);
      if (Number.isFinite(parsed) && parsed > 0) sweepRadius = parsed;
      updateSweepPreview(ctx);
    }
  },
  onEnter(ctx) {
    if (!sweepPath) return false;
    commitSweep(ctx);
    return true;
  },
  onCancel(ctx) {
    if (sweepPath) {
      sweepPath = null;
      sweepTyped = "";
      clearDraft(ctx);
      ctx.showMeasure(null);
      ctx.setStatus("Sweep cancelled · pick an open path");
    }
  },
  hint: () => "Sweep · click an open path, then move or type radius + Enter",
};

// -------------------------------------------------------------------- loft

let loftSections: THREE.Vector3[][] = [];

function ribbonGeometry(sections: THREE.Vector3[][]): THREE.BufferGeometry | null {
  if (sections.length < 2) return null;
  const positions: number[] = [];
  for (let r = 0; r < sections.length - 1; r++) {
    const lower = sections[r];
    const upper = sections[r + 1];
    const n = Math.min(lower.length, upper.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = lower[i];
      const b = lower[j];
      const c = upper[j];
      const dd = upper[i];
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      positions.push(a.x, a.y, a.z, c.x, c.y, c.z, dd.x, dd.y, dd.z);
    }
  }
  // Add fan caps on the first and last sections so the preview looks solid
  const addCap = (ring: THREE.Vector3[], flip: boolean) => {
    if (ring.length < 3) return;
    const center = new THREE.Vector3();
    for (const p of ring) center.add(p);
    center.divideScalar(ring.length);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      if (flip) {
        positions.push(center.x, center.y, center.z, b.x, b.y, b.z, a.x, a.y, a.z);
      } else {
        positions.push(center.x, center.y, center.z, a.x, a.y, a.z, b.x, b.y, b.z);
      }
    }
  };
  addCap(sections[0], true);
  addCap(sections[sections.length - 1], false);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

function loftPreview(ctx: ToolContext): void {
  const geo = ribbonGeometry(loftSections);
  if (!geo) {
    clearDraft(ctx);
    return;
  }
  const mesh = new THREE.Mesh(geo, previewMaterial(ctx));
  mesh.renderOrder = 997;
  mesh.frustumCulled = false;
  showDraft(mesh, ctx);
}

function resetLoft(ctx: ToolContext): void {
  loftSections = [];
  clearDraft(ctx);
  ctx.showMeasure(null);
}

function commitLoft(ctx: ToolContext): void {
  if (loftSections.length < 2) {
    ctx.setStatus("Loft needs at least 2 profiles · Enter to finish when ready");
    return;
  }
  const sections = loftSections.map((s) => polylineCoordinates(s));
  void ctx.createEntity({ type: "loft", sections }, [0, 0, 0]);
  resetLoft(ctx);
  ctx.setStatus(`Loft created (${sections.length} sections)`);
}

export const loftTool: ToolHandler = {
  id: "loft" as ToolId,
  cursor: "crosshair",
  onActivate(ctx) {
    resetLoft(ctx);
    ctx.setStatus(this.hint!(ctx));
  },
  onDeactivate(ctx) {
    resetLoft(ctx);
  },
  hasActivity: () => loftSections.length > 0,
  onPointerDown(event, ctx) {
    const picked = pickChain(event, ctx);
    if (!picked) return false;
    if (!picked.chain.closed) {
      ctx.setStatus("Profile must be closed");
      return true;
    }
    loftSections.push(resampleLoop(picked.chain.points, 64));
    loftPreview(ctx);
    ctx.setStatus(
      loftSections.length < 2
        ? `Loft · ${loftSections.length} profile · pick the next (64 rings)`
        : `Loft · ${loftSections.length} profiles · Enter to finish`,
    );
    return true;
  },
  onPointerMove(_event, ctx) {
    if (loftSections.length === 0) ctx.showMeasure(null);
  },
  onEnter(ctx) {
    if (loftSections.length >= 2) {
      commitLoft(ctx);
      return true;
    }
    return false;
  },
  onCancel(ctx) {
    if (loftSections.length > 0) {
      resetLoft(ctx);
      ctx.setStatus("Loft cancelled · click a closed profile");
    }
  },
  onBackspace(ctx) {
    if (loftSections.length > 0) {
      loftSections.pop();
      loftPreview(ctx);
      ctx.setStatus(
        loftSections.length === 0
          ? "Loft · click a closed profile"
          : `Loft · ${loftSections.length} profile${loftSections.length > 1 ? "s" : ""} · pick the next or Enter to finish`,
      );
    }
  },
  hint: () => "Loft · click 2+ closed profiles in order · Enter finishes",
};
