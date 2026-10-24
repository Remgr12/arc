import * as THREE from "three";
import type { ToolHandler, ToolContext } from "./types";
import { useArcStore } from "../lib/store";
import { deriveFaces, edgeOverlayGeometry, faceOverlayGeometry } from "./topology";
import type { EntityData, Geometry } from "../lib/types";
import { uiCapture } from "../lib/uiCapture";

// ---------------------------------------------------------------------------
// Face tools: Extrude Face / Offset Face (prisms first — box, extrude,
// cylinder, cone via geometry param updates + re-center transform) and
// Fillet Edge (solid_fillet payload through the vendored truck backend).
//
// Gizmo: a THREE.ArrowHelper along the face normal (or the picked edge),
// drag along its screen projection, plus an inline numeric dimension input
// that commits through updateGeometry (undo history lives in the backend).
// ---------------------------------------------------------------------------

const ACCENT = 0x0ea5a5; // teal gizmo color
const MIN_PARAM = 0.05;

type ParamKey = "width" | "height" | "depth" | "radius" | "none";

interface Param {
  kind: ParamKey;
  /** Local axis pointing outward from the picked face. */
  axis: THREE.Vector3;
  /** True for centered-local kinds (box, extrude) or base-shifted kinds: param change shifts origin. */
  recenters: boolean;
  /** Fraction of delta to shift along `axis` when `recenters` is true (default 0.5). */
  shiftFactor?: number;
  label: string;
}

interface DragState {
  param: Param;
  entityId: string;
  startValue: number;
  delta: number;
  screenAnchor: { x: number; y: number };
  screenUnit: { x: number; y: number };
  /** World units per screen px along the axis. */
  pxToWorld: number;
}

interface ToolState {
  gizmo: THREE.ArrowHelper | null;
  attached: string | null;
  drag: DragState | null;
  input: HTMLDivElement | null;
}

const tool: ToolState = { gizmo: null, attached: null, drag: null, input: null };

const BOX_KINDS = new Set(["box", "beam", "slab"]);
const EXTRUDE_KINDS = new Set(["extrude"]);
const CYL_KINDS = new Set(["cylinder", "cone", "column"]);
const FILLET_KINDS = new Set([
  "box",
  "extrude",
  "cylinder",
  "column",
  "beam",
  "slab",
  "solid_fillet",
  "csg",
]);

function faceEditable(kind: string): boolean {
  return BOX_KINDS.has(kind) || EXTRUDE_KINDS.has(kind) || CYL_KINDS.has(kind);
}

/** Map the entity + face into the geometry param it controls. */
function faceParam(entity: EntityData, faceIndex: number): Param | null {
  const group = deriveFaces(entity).find((f) => f.index === faceIndex);
  if (!group) return null;
  const [nx, ny, nz] = group.normal;
  const axisFor = (x: number, y: number, z: number): THREE.Vector3 =>
    new THREE.Vector3(x, y, z).normalize();
  if (Math.abs(ny) >= Math.abs(nx) && Math.abs(ny) >= Math.abs(nz)) {
    if (BOX_KINDS.has(entity.kind) || EXTRUDE_KINDS.has(entity.kind)) {
      return {
        kind: "height",
        axis: axisFor(0, Math.sign(ny) || 1, 0),
        recenters: true,
        shiftFactor: 0.5,
        label: "Height",
      };
    }
    if (CYL_KINDS.has(entity.kind)) {
      if (ny >= 0) {
        return { kind: "height", axis: axisFor(0, 1, 0), recenters: false, label: "Height" };
      }
      // Cylinder/cone/column base cap at local y = 0: pulling along -Y increases height and shifts base by delta.
      return {
        kind: "height",
        axis: axisFor(0, -1, 0),
        recenters: true,
        shiftFactor: 1.0,
        label: "Height",
      };
    }
  }
  if (BOX_KINDS.has(entity.kind)) {
    if (Math.abs(nx) >= Math.abs(nz)) {
      return {
        kind: "width",
        axis: axisFor(Math.sign(nx) || 1, 0, 0),
        recenters: true,
        label: "Width",
      };
    }
    return {
      kind: "depth",
      axis: axisFor(0, 0, Math.sign(nz) || 1),
      recenters: true,
      label: "Depth",
    };
  }
  if (CYL_KINDS.has(entity.kind)) {
    return { kind: "radius", axis: axisFor(nx, 0, nz), recenters: false, label: "Radius" };
  }
  return null;
}

function geomNumber(entity: EntityData, key: ParamKey): number {
  const value = (entity.geometry as Record<string, unknown>)[key];
  return typeof value === "number" ? value : Number.NaN;
}

function geomWith(entity: EntityData, key: ParamKey, value: number): Geometry {
  return { ...entity.geometry, [key]: Math.max(MIN_PARAM, value) } as Geometry;
}

// ------------------------------------------------------------------ helpers

function detachGizmo(): void {
  if (!tool.gizmo) return;
  tool.gizmo = null;
  tool.attached = null;
  tool.drag = null;
}

/** Rebuild the arrow gizmo for the active face/edge ref. */
function updateGizmo(ctx: ToolContext, entityId: string): void {
  const store = useArcStore.getState();
  const entity = ctx.entityById(entityId);
  if (!entity) {
    detachGizmo();
    return;
  }
  let anchor: THREE.Vector3 | null = null;
  let axis: THREE.Vector3 | null = null;

  const selFace = store.selFace;
  const selEdge = store.selEdge;
  if (selFace && selFace.entityId === entityId) {
    const obj = ctx.objectFor(entityId);
    const geometry = faceOverlayGeometry(entity, selFace.face);
    if (!obj || !geometry) {
      detachGizmo();
      return;
    }
    geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere;
    if (!sphere) {
      geometry.dispose();
      detachGizmo();
      return;
    }
    const center = sphere.center.clone();
    geometry.dispose();
    obj.updateMatrixWorld();
    anchor = center.applyMatrix4(obj.matrixWorld);
    const param = faceParam(entity, selFace.face);
    axis = param ? param.axis.clone().transformDirection(obj.matrixWorld) : null;
  } else if (selEdge && selEdge.entityId === entityId) {
    const parts = selEdge.key.split(":");
    const seg = Number(parts[parts.length - 1]);
    const geometry = edgeOverlayGeometry(entity, seg);
    const obj = ctx.objectFor(entityId);
    if (!obj || !geometry || geometry.getAttribute("position").count < 2) {
      detachGizmo();
      return;
    }
    const pos = geometry.getAttribute("position");
    const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
    const b = new THREE.Vector3().fromBufferAttribute(pos, 1);
    geometry.dispose();
    obj.updateMatrixWorld();
    anchor = a.clone().applyMatrix4(obj.matrixWorld);
    axis = b.clone().applyMatrix4(obj.matrixWorld).sub(anchor).normalize();
  }
  if (!anchor || !axis) {
    detachGizmo();
    return;
  }

  const key = `${entityId}:${selFace?.face ?? `e:${selEdge?.key ?? ""}`}`;
  const length = Math.max(14, ctx.camera.position.distanceTo(anchor) * 0.09);
  if (tool.gizmo && tool.attached === key) {
    tool.gizmo.position.copy(anchor);
    tool.gizmo.setDirection(axis);
    tool.gizmo.setLength(length, length * 0.26, length * 0.12);
    return;
  }
  const gizmo = new THREE.ArrowHelper(axis, anchor, length, ACCENT, length * 0.26, length * 0.12);
  tool.gizmo = gizmo;
  tool.attached = key;
  ctx.setPreview(gizmo, "face-gizmo");
}

// ---------------------------------------------------------- numeric overlay

function closeNumberInput(): void {
  const el = tool.input;
  if (!el) return;
  tool.input = null;
  uiCapture.active = false;
  el.remove();
}

/** Inline numeric input projected at host-relative `screen`. Enter/blur commits. */
function showNumberInput(
  ctx: ToolContext,
  screen: { x: number; y: number } | null,
  label: string,
  initial: number,
  onCommit: (value: number) => void,
): void {
  closeNumberInput();
  const host = ctx.host;
  const wrap = document.createElement("div");
  wrap.className =
    "absolute z-[70] flex items-center gap-1.5 rounded-md border border-base-300 bg-base-100 px-2 py-1 shadow-lg";
  const width = host.clientWidth;
  const height = host.clientHeight;
  const x = screen ? screen.x : width / 2;
  const y = screen ? screen.y : height / 2;
  wrap.style.left = `${Math.max(8, Math.min(x + 16, width - 130))}px`;
  wrap.style.top = `${Math.max(8, Math.min(y - 16, height - 36))}px`;

  if (label) {
    const span = document.createElement("span");
    span.className = "text-[11px] font-medium text-base-600";
    span.textContent = label;
    wrap.appendChild(span);
  }
  const input = document.createElement("input");
  input.type = "text";
  input.inputMode = "decimal";
  input.value = Number.isFinite(initial) ? initial.toFixed(1) : "";
  input.className =
    "h-5 w-16 rounded border border-base-400 bg-base-50 px-1 text-[12px] font-mono tabular-nums text-base-800 outline-none";
  wrap.appendChild(input);
  host.appendChild(wrap);
  tool.input = wrap;

  input.addEventListener("focus", () => {
    uiCapture.active = true;
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      input.blur();
    } else if (event.key === "Escape") {
      tool.input = null;
      uiCapture.active = false;
      wrap.remove();
    }
  });
  input.addEventListener("blur", () => {
    const parsed = Number.parseFloat(input.value);
    tool.input = null;
    uiCapture.active = false;
    wrap.remove();
    if (Number.isFinite(parsed) && parsed >= MIN_PARAM) onCommit(parsed);
  });
  input.focus();
  input.select();
}

// ------------------------------------------------------------ pick/arming

/** Arm the face/edge ref from the pointer (returns true when armed). */
function armFromPick(event: PointerEvent, ctx: ToolContext, preferEdge = false): boolean {
  if (preferEdge) {
    const edge = ctx.pickEdge(event, 10);
    if (edge) {
      ctx.setSelectionRef({
        entityId: edge.entityId,
        kind: "edge",
        face: null,
        edge: edge.key,
        point: edge.point,
        normal: [0, 0, 0],
      });
      return true;
    }
  }
  const face = ctx.pickFace(event);
  if (face && !preferEdge) {
    ctx.setSelectionRef({
      entityId: face.entityId,
      kind: "face",
      face: face.faceIndex,
      edge: null,
      point: face.point,
      normal: face.normal,
    });
    return true;
  }
  const edge = ctx.pickEdge(event, 10);
  if (edge) {
    ctx.setSelectionRef({
      entityId: edge.entityId,
      kind: "edge",
      face: null,
      edge: edge.key,
      point: edge.point,
      normal: [0, 0, 0],
    });
    return true;
  }
  return false;
}

function ensureEntitySelected(ctx: ToolContext, entityId: string): void {
  const selection = ctx.selection();
  if (selection.length === 1 && selection[0] === entityId) return;
  void ctx.setSelection([entityId], entityId);
}

// ------------------------------------------------------------------- drag

/** Screen geometry of the world axis at `anchor` (px, host-relative). */
function screenAxisGeometry(
  ctx: ToolContext,
  anchor: THREE.Vector3,
  axis: THREE.Vector3,
): { screenAnchor: { x: number; y: number }; screenUnit: { x: number; y: number }; pxToWorld: number } | null {
  const p0 = ctx.worldToScreen(anchor.clone());
  const p1 = ctx.worldToScreen(anchor.clone().addScaledVector(axis, 1));
  if (!p0 || !p1) return null;
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  return {
    screenAnchor: p0,
    screenUnit: { x: dx / len, y: dy / len },
    pxToWorld: 1 / len,
  };
}

function paramValue(entity: EntityData, param: Param): number {
  if (param.kind === "radius") return geomNumber(entity, "radius");
  return geomNumber(entity, param.kind);
}

function commitValue(
  ctx: ToolContext,
  entityId: string,
  param: Param,
  value: number,
  delta: number,
): void {
  const entity = ctx.entityById(entityId);
  if (!entity || param.kind === "none") return;
  const clamped = Math.max(MIN_PARAM, value);
  void ctx.updateGeometry(entityId, geomWith(entity, param.kind, clamped));
  if (param.recenters && Math.abs(delta) > 1e-9) {
    const obj = ctx.objectFor(entityId);
    if (obj) {
      const worldAxis = param.axis.clone().transformDirection(obj.matrixWorld);
      const factor = param.shiftFactor ?? 0.5;
      const shift = worldAxis.multiplyScalar(delta * factor);
      const current = entity.transform.position;
      void ctx.setTransform(
        entityId,
        {
          position: [current[0] + shift.x, current[1] + shift.y, current[2] + shift.z],
          rotation: entity.transform.rotation,
          scale: entity.transform.scale,
        },
        true,
      );
    }
  }
  useArcStore.getState().setStatusMessage(`${param.label}: ${Math.round(clamped * 10) / 10}`);
}

function commitFillet(
  ctx: ToolContext,
  entityId: string,
  radius: number,
): void {
  const entity = ctx.entityById(entityId);
  const store = useArcStore.getState();
  const selEdge = store.selEdge;
  if (!entity || !selEdge) return;
  const world = ctx.objectFor(entityId);
  if (!world) return;
  void world.updateMatrixWorld();
  // Backend expects the edge in source payload (local) coordinates.
  const payload: Geometry = {
    type: "solid_fillet",
    source: entity.geometry,
    edge: selEdgeKeyToPoints(entity, selEdge.key) ?? [[0, 0, 0], [0, 0, 0]],
    radius: Math.max(0.05, Math.round(radius * 100) / 100),
  };
  if (!payload_edge_points(payload)) {
    store.setStatusMessage("Fillet Edge · edge endpoints unavailable");
    return;
  }
  void ctx
    .updateGeometry(entityId, payload)
    .then(() => {
      const after = ctx.entityById(entityId);
      store.setStatusMessage(
        after && "type" in after.geometry && after.geometry.type === "solid_fillet"
          ? `Fillet r=${(payload as { radius?: number }).radius}`
          : "Fillet failed · edge could not be rounded",
      );
    });
}

function selEdgeKeyPointsLocal(entity: EntityData, key: string): [[number, number, number], [number, number, number]] | null {
  const parts = key.split(":");
  const seg = Number(parts[parts.length - 1]);
  const geometry = edgeOverlayGeometry(entity, seg);
  if (!geometry || geometry.getAttribute("position").count < 2) {
    geometry?.dispose();
    return null;
  }
  const pos = geometry.getAttribute("position");
  const a = new THREE.Vector3().fromBufferAttribute(pos, 0);
  const b = new THREE.Vector3().fromBufferAttribute(pos, 1);
  geometry.dispose();
  return [
    [a.x, a.y, a.z],
    [b.x, b.y, b.z],
  ];
}

function selEdgeKeyToPoints(entity: EntityData, key: string) {
  return selEdgeKeyPointsLocal(entity, key) ?? [[0, 0, 0], [0, 0, 0]];
}

void selEdgeKeyToPoints;

function payload_edge_points(payload: unknown): boolean {
  const edge = (payload as { edge?: [[number, number, number], [number, number, number]] }).edge;
  if (!edge || edge.length !== 2) return false;
  const [a, b] = edge;
  return [a[0], a[1], a[2], b[0], b[1], b[2]].every((v) => Number.isFinite(v)) &&
    (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]);
}

function fmt(v: number): string {
  return `${Math.round(v * 10) / 10}`;
}

// ------------------------------------------------------------------- tools

function faceToolHandlers(id: ToolHandler["id"], label: string): ToolHandler {
  return {
    id,
    cursor: "crosshair",
    onActivate(ctx) {
      detachGizmo();
      closeNumberInput();
      const store = useArcStore.getState();
      const entity = store.selFace ? ctx.entityById(store.selFace.entityId) : null;
      if (!entity || !store.selFace) {
        ctx.setStatus(`${label} · click a face (box / extrude / cylinder / cone)`);
        return;
      }
      if (!faceEditable(entity.kind)) {
        ctx.setStatus(`${label} · "${entity.kind}" is not face-editable yet (prisms first)`);
        return;
      }
      updateGizmo(ctx, entity.id);
      ctx.setStatus(`${label} · drag the arrow, type the exact number next to it`);
    },
    onDeactivate() {
      detachGizmo();
      closeNumberInput();
    },
    onCancel() {
      detachGizmo();
      closeNumberInput();
    },
    onPointerDown(event, ctx) {
      if (event.button !== 0) return false;
      const store = useArcStore.getState();
      if (!store.selFace) {
        // No face yet: click picks one.
        if (armFromPick(event, ctx)) {
          const fresh = useArcStore.getState();
          const entity = fresh.selFace ? ctx.entityById(fresh.selFace.entityId) : null;
          if (!entity) return true;
          ensureEntitySelected(ctx, entity.id);
          if (!faceEditable(entity.kind)) {
            ctx.setStatus(`${label} · "${entity.kind}" cannot be face-edited (prisms first)`);
            return true;
          }
          updateGizmo(ctx, entity.id);
          ctx.setStatus(`${label} · drag the arrow, click the number to type`);
        }
        return true;
      }
      const entity = ctx.entityById(store.selFace.entityId);
      if (!entity || !faceEditable(entity.kind)) return false;
      const gizmo = tool.gizmo;
      if (!gizmo) return false;
      // Near the arrow? start the drag along its axis.
      const mouseScreen = ctx.screenPoint(event);
      const param = faceParam(entity, store.selFace.face);
      if (!param || param.kind === "none") {
        ctx.setStatus(`${label} · this face has no size parameter to drag`);
        return true;
      }
      const startValue = paramValue(entity, param);
      const geometry = screenAxisGeometry(ctx, gizmo.position.clone(), param.axis.clone().transformDirection(
        (() => {
          const obj = ctx.objectFor(entity.id);
          obj?.updateMatrixWorld();
          return obj?.matrixWorld ?? new THREE.Matrix4();
        })(),
      ));
      if (!geometry) return false;
      const axisDistancePx = Math.hypot(
        (mouseScreen.x - geometry.screenAnchor.x) * geometry.screenUnit.y -
          (mouseScreen.y - geometry.screenAnchor.y) * geometry.screenUnit.x,
      );
      if (axisDistancePx > 14) {
        // Click elsewhere on the face: re-arm the reference to that face.
        armFromPick(event, ctx);
        return true;
      }
      ctx.capturePointer(event);
      tool.drag = {
        param,
        entityId: entity.id,
        startValue,
        delta: 0,
        screenAnchor: geometry.screenAnchor,
        screenUnit: geometry.screenUnit,
        pxToWorld: geometry.pxToWorld,
      };
      return true;
    },
    onPointerMove(event, ctx) {
      const store = useArcStore.getState();
      if (store.selFace) updateGizmo(ctx, store.selFace.entityId);
      const drag = tool.drag;
      if (!drag) return;
      const mouseScreen = ctx.screenPoint(event);
      const rel = { x: mouseScreen.x - drag.screenAnchor.x, y: mouseScreen.y - drag.screenAnchor.y };
      const along = rel.x * drag.screenUnit.x + rel.y * drag.screenUnit.y;
      drag.delta = along * drag.pxToWorld;
      ctx.showMeasure(
        `${drag.param.label}: ${fmt(Math.max(MIN_PARAM, drag.startValue + drag.delta))}`,
        { x: mouseScreen.x, y: mouseScreen.y - 24 },
      );
    },
    onPointerUp(event, ctx) {
      const drag = tool.drag;
      if (!drag) return;
      ctx.releasePointer(event);
      ctx.showMeasure(null);
      commitValue(ctx, drag.entityId, drag.param, drag.startValue + drag.delta, drag.delta);
      tool.drag = null;
    },
    /** Clicking the displayed number opens the inline input for exact values. */
    onDoubleClick(event, ctx) {
      const store = useArcStore.getState();
      const entity = store.selFace ? ctx.entityById(store.selFace.entityId) : null;
      if (!entity || !store.selFace) return false;
      const param = faceParam(entity, store.selFace.face);
      if (!param || param.kind === "none") return false;
      showNumberInput(
        ctx,
        ctx.screenPoint(event),
        param.label,
        paramValue(entity, param),
        (value) => commitValue(ctx, entity.id, param, value, value - paramValue(entity, param)),
      );
      return true;
    },
    hasActivity(ctx) {
      const store = useArcStore.getState();
      return store.selFace !== null && ctx.entityById(store.selFace.entityId) !== null;
    },
    hint: () => `${label} · click a face, drag its arrow`,
  };
}

export const extrudeFaceTool: ToolHandler = faceToolHandlers("extrude-face", "Extrude Face");
export const offsetFaceTool: ToolHandler = faceToolHandlers("offset-face", "Offset Face");

export const filletEdgeTool: ToolHandler = {
  id: "fillet-edge",
  cursor: "crosshair",
  onActivate(ctx) {
    detachGizmo();
    closeNumberInput();
    const store = useArcStore.getState();
    const entity = store.selEdge ? ctx.entityById(store.selEdge.entityId) : null;
    if (!entity || !store.selEdge) {
      ctx.setStatus("Fillet Edge · click an edge of a solid");
      return;
    }
    if (!FILLET_KINDS.has(entity.kind)) {
      ctx.setStatus(`Fillet Edge · "${entity.kind}" fillets land later (box first)`);
      return;
    }
    updateGizmo(ctx, entity.id);
    ctx.setStatus("Fillet Edge · drag the arrow for radius, click the number to type");
  },
  onDeactivate() {
    detachGizmo();
    closeNumberInput();
  },
  onCancel() {
    detachGizmo();
    closeNumberInput();
  },
    onPointerDown(event, ctx) {
      if (event.button !== 0) return false;
      // Always allow picking an edge directly (or re-picking another edge).
      const pickedEdge = ctx.pickEdge(event, 10);
      if (pickedEdge) {
        ctx.setSelectionRef({
          entityId: pickedEdge.entityId,
          kind: "edge",
          face: null,
          edge: pickedEdge.key,
          point: pickedEdge.point,
          normal: [0, 0, 0],
        });
      } else if (!useArcStore.getState().selEdge) {
        if (!armFromPick(event, ctx, true)) return false;
      }
      const fresh = useArcStore.getState();
      const selEdge = fresh.selEdge;
      const entity = selEdge ? ctx.entityById(selEdge.entityId) : null;
      if (!entity || !selEdge) return true;
      if (!FILLET_KINDS.has(entity.kind)) {
        ctx.setStatus(`Fillet Edge · "${entity.kind}" cannot be filleted`);
        return true;
      }
      ensureEntitySelected(ctx, entity.id);
      updateGizmo(ctx, entity.id);
      const gizmo = tool.gizmo;
      if (!gizmo) return true;
      const mouseScreen = ctx.screenPoint(event);
      const screenUnitVec = (() => {
        const obj = ctx.objectFor(entity.id);
        obj?.updateMatrixWorld();
        const parts = selEdge.key.split(":");
        const seg = Number(parts[parts.length - 1]);
        const geometry = edgeOverlayGeometry(entity, seg);
        if (!obj || !geometry) return null;
        const pos = geometry.getAttribute("position");
        const a = new THREE.Vector3().fromBufferAttribute(pos, 0).applyMatrix4(obj.matrixWorld);
        const b = new THREE.Vector3().fromBufferAttribute(pos, 1).applyMatrix4(obj.matrixWorld);
        geometry.dispose();
        return { a, b };
      })();
      const { screenUnit, pxToWorld } =
        (screenUnitVec
          ? screenAxisGeometry(
              ctx,
              gizmo.position.clone(),
              screenUnitVec.b.clone().sub(screenUnitVec.a).normalize(),
            )
          : null) ?? {
          screenAnchor: mouseScreen,
          screenUnit: { x: 1, y: 0 },
          pxToWorld: 0.1,
        };
      ctx.capturePointer(event);
      tool.drag = {
        param: { kind: "radius", axis: new THREE.Vector3(), recenters: false, label: "Radius" },
        entityId: entity.id,
        startValue: 0,
        delta: 0,
        screenAnchor: mouseScreen,
        screenUnit,
        pxToWorld,
      };
      ctx.setStatus("Fillet Edge · drag outward for radius, release to commit (or double-click to type)");
      return true;
    },
  onPointerMove(event, ctx) {
    const store = useArcStore.getState();
    if (store.selEdge) updateGizmo(ctx, store.selEdge.entityId);
    const drag = tool.drag;
    if (!drag) return;
    const mouseScreen = ctx.screenPoint(event);
    const distPx = Math.hypot(
      mouseScreen.x - drag.screenAnchor.x,
      mouseScreen.y - drag.screenAnchor.y,
    );
    drag.delta = distPx * drag.pxToWorld;
    if (distPx > 3) {
      ctx.showMeasure(
        `R ${fmt(Math.max(0.05, drag.delta))}`,
        { x: mouseScreen.x, y: mouseScreen.y - 24 },
      );
    }
  },
  onPointerUp(event, ctx) {
    const drag = tool.drag;
    if (!drag) return;
    ctx.releasePointer(event);
    ctx.showMeasure(null);
    tool.drag = null;
    if (drag.delta >= 0.05) {
      commitFillet(ctx, drag.entityId, drag.delta);
    }
  },
  onDoubleClick(event, ctx) {
    const store = useArcStore.getState();
    if (!store.selEdge) return false;
    showNumberInput(ctx, ctx.screenPoint(event), "Radius", 2, (radius) => {
      commitFillet(ctx, store.selEdge!.entityId, radius);
    });
    return true;
  },
  hasActivity(ctx) {
    const store = useArcStore.getState();
    return store.selEdge !== null && ctx.entityById(store.selEdge.entityId) !== null;
  },
  hint: () => "Fillet Edge · click an edge, set the radius",
};
