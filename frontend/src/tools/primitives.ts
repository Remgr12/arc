import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";

// ---------------------------------------------------------------------------
// Primitive creation tools. Click-click (or drag) sets the footprint; box,
// cylinder and cone add a third "height" step driven by cursor height.
// ---------------------------------------------------------------------------

interface PrimState {
  anchor: THREE.Vector3 | null;
  second: THREE.Vector3 | null;
  press: { x: number; y: number } | null;
  dragged: boolean;
}

function fresh(): PrimState {
  return { anchor: null, second: null, press: null, dragged: false };
}

function reset(ctx: ToolContext): PrimState {
  ctx.clearPreview("draft");
  ctx.showMeasure(null);
  return fresh();
}

export function previewMaterial(ctx: ToolContext): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.6,
    roughness: 0.55,
    metalness: 0.05,
    depthWrite: false,
  });
  mat.color.copy(ctx.palette.hover);
  return mat;
}

/** Cursor height above the base point using a camera-facing vertical plane. */
function cursorHeight(ctx: ToolContext, event: PointerEvent | MouseEvent, base: THREE.Vector3): number {
  const forward = new THREE.Vector3();
  ctx.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, base);
  const out = new THREE.Vector3();
  const hit = ctx.rayAt(event).intersectPlane(plane, out);
  return hit ? Math.max(0.5, out.y) : 20;
}

function isDrag(state: PrimState, event: PointerEvent): boolean {
  return !!state.press && Math.hypot(event.clientX - state.press.x, event.clientY - state.press.y) > 5;
}

function footprintRadius(a: THREE.Vector3, b: THREE.Vector3): number {
  return Math.max(2, Math.hypot(b.x - a.x, b.z - a.z));
}

interface Built {
  geometry: Record<string, unknown>;
  position: [number, number, number];
  preview: THREE.Object3D;
  label: string;
}

// ------------------------------------------------------------------- simple

function makeSimpleTool(
  id: "sphere" | "torus" | "plane",
  build: (a: THREE.Vector3, b: THREE.Vector3, ctx: ToolContext) => Built | null,
): ToolHandler {
  let state = fresh();
  const place = (built: Built, ctx: ToolContext) => {
    void ctx.createEntity(built.geometry as never, built.position);
    ctx.setStatus("Placed");
  };
  return {
    id,
    cursor: "crosshair",
    onActivate(ctx) {
      state = reset(ctx);
      ctx.setStatus(this.hint!(ctx));
    },
    onDeactivate(ctx) {
      state = reset(ctx);
    },
    hasActivity: () => state.anchor !== null,
    onPointerDown(event, ctx) {
      const raw = ctx.planePoint(event, 0);
      if (!raw) return true;
      const p = ctx.snap(raw).point;
      if (!state.anchor) {
        state.anchor = p;
        state.press = { x: event.clientX, y: event.clientY };
        ctx.capturePointer(event);
        return true;
      }
      const built = build(state.anchor, p, ctx);
      if (built) place(built, ctx);
      state = reset(ctx);
      return true;
    },
    onPointerMove(event, ctx) {
      const raw = ctx.planePoint(event, 0);
      if (!raw) return;
      const cursor = ctx.snap(raw).point;
      if (isDrag(state, event)) state.dragged = true;
      if (!state.anchor) {
        ctx.showMeasure(null);
        return;
      }
      const built = build(state.anchor, cursor, ctx);
      if (built) {
        ctx.setPreview(built.preview, "draft");
        ctx.showMeasure(built.label, ctx.screenPoint(event));
      }
    },
    onPointerUp(event, ctx) {
      if (!state.anchor || !state.dragged) return;
      const raw = ctx.planePoint(event, 0);
      if (raw) {
        const built = build(state.anchor, ctx.snap(raw).point, ctx);
        if (built) place(built, ctx);
      }
      state = reset(ctx);
      ctx.releasePointer(event);
    },
    onCancel(ctx) {
      state = reset(ctx);
    },
    hint: () =>
      id === "plane" ? "Plane · drag or click two corners" : "Drag or click center, then radius",
  };
}

export const sphereTool = makeSimpleTool("sphere", (a, b, ctx) => {
  const r = footprintRadius(a, b);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), previewMaterial(ctx));
  mesh.position.set(a.x, r, a.z);
  return {
    geometry: { type: "sphere", radius: r, segments: 32 },
    position: [a.x, r, a.z],
    preview: mesh,
    label: `R ${Math.round(r * 100) / 100}`,
  };
});

export const torusTool = makeSimpleTool("torus", (a, b, ctx) => {
  const r = Math.max(6, Math.hypot(b.x - a.x, b.z - a.z));
  const tube = Math.min(8, r / 3);
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(r, tube, 14, 48).rotateX(Math.PI / 2),
    previewMaterial(ctx),
  );
  mesh.position.set(a.x, tube, a.z);
  return {
    geometry: { type: "torus", radius: r, tube, segments: 32, tubular_segments: 16 },
    position: [a.x, tube, a.z],
    preview: mesh,
    label: `R ${Math.round(r * 100) / 100}`,
  };
});

export const planeTool = makeSimpleTool("plane", (a, b, ctx) => {
  const w = Math.max(8, Math.abs(b.x - a.x));
  const d = Math.max(8, Math.abs(b.z - a.z));
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
    previewMaterial(ctx),
  );
  mesh.position.set((a.x + b.x) / 2, 0.02, (a.z + b.z) / 2);
  return {
    geometry: { type: "plane", width: w, depth: d },
    position: [(a.x + b.x) / 2, 0, (a.z + b.z) / 2],
    preview: mesh,
    label: `${Math.round(w * 100) / 100} × ${Math.round(d * 100) / 100}`,
  };
});

// ------------------------------------------------------- two-stage (height)

interface HeightTool {
  id: "box" | "cylinder" | "cone";
  footprint: (a: THREE.Vector3, b: THREE.Vector3) => { w: number; d: number; r: number };
  mesh: (fp: { w: number; d: number; r: number }, h: number, ctx: ToolContext) => THREE.Mesh;
  geometry: (fp: { w: number; d: number; r: number }, h: number) => Record<string, unknown>;
  label: (fp: { w: number; d: number; r: number }, h: number) => string;
}

function makeHeightTool(spec: HeightTool): ToolHandler {
  let state = fresh();
  let height = 20;

  const previewFor = (ctx: ToolContext, event: PointerEvent): void => {
    if (!state.anchor) return;
    if (!state.second) {
      const raw = ctx.planePoint(event, 0);
      if (!raw) return;
      const fp = spec.footprint(state.anchor, ctx.snap(raw).point);
      const mesh = spec.mesh(fp, height, ctx);
      mesh.position.y = 0;
      ctx.setPreview(mesh, "draft");
      ctx.showMeasure(spec.label(fp, height), ctx.screenPoint(event));
      return;
    }
    height = cursorHeight(ctx, event, state.second);
    const fp = spec.footprint(state.anchor, state.second);
    const mesh = spec.mesh(fp, height, ctx);
    ctx.setPreview(mesh, "draft");
    ctx.showMeasure(spec.label(fp, height), ctx.screenPoint(event));
  };

  return {
    id: spec.id,
    cursor: "crosshair",
    onActivate(ctx) {
      state = reset(ctx);
      height = 20;
      ctx.setStatus(this.hint!(ctx));
    },
    onDeactivate(ctx) {
      state = reset(ctx);
    },
    hasActivity: () => state.anchor !== null,
    onPointerDown(event, ctx) {
      const raw = ctx.planePoint(event, 0);
      if (!raw) return true;
      const p = ctx.snap(raw).point;
      if (!state.anchor) {
        state.anchor = p;
        state.press = { x: event.clientX, y: event.clientY };
        ctx.capturePointer(event);
        return true;
      }
      if (!state.second) {
        state.second = p;
        height = 20;
        ctx.setStatus("Move to set height · click to place · Esc restarts footprint");
        previewFor(ctx, event);
        return true;
      }
      const fp = spec.footprint(state.anchor, state.second);
      void ctx.createEntity(spec.geometry(fp, height) as never, [state.anchor.x, 0, state.anchor.z]);
      ctx.setStatus("Placed");
      state = reset(ctx);
      return true;
    },
    onPointerMove(event, ctx) {
      previewFor(ctx, event);
      if (state.anchor && !state.second && isDrag(state, event)) state.dragged = true;
    },
    onPointerUp(event, ctx) {
      if (!state.anchor) return;
      if (!state.second && state.dragged) {
        const raw = ctx.planePoint(event, 0);
        if (raw) {
          state.second = ctx.snap(raw).point;
          height = 20;
          ctx.setStatus("Move to set height · click to place");
          previewFor(ctx, event);
        }
        state.dragged = false;
        state.press = null;
        ctx.releasePointer(event);
      }
    },
    onCancel(ctx) {
      if (state.second) {
        state.second = null;
        ctx.setStatus("Height cancelled · set the footprint again");
        return;
      }
      state = reset(ctx);
    },
    hint: () => "Click (or drag) the footprint, then set height",
  };
}

export const boxTool = makeHeightTool({
  id: "box",
  footprint: (a, b) => ({
    w: Math.max(4, Math.abs(b.x - a.x)),
    d: Math.max(4, Math.abs(b.z - a.z)),
    r: 0,
  }),
  mesh: (fp, h, ctx) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(fp.w, h, fp.d), previewMaterial(ctx));
    mesh.position.y = h / 2;
    return mesh;
  },
  geometry: (fp, h) => ({ type: "box", width: fp.w, depth: fp.d, height: h, corner_radius: 0 }),
  label: (fp, h) =>
    `${Math.round(fp.w * 10) / 10} × ${Math.round(fp.d * 10) / 10} × ${Math.round(h * 10) / 10}`,
});

export const cylinderTool = makeHeightTool({
  id: "cylinder",
  footprint: (a, b) => ({ w: 0, d: 0, r: footprintRadius(a, b) }),
  mesh: (fp, h, ctx) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(fp.r, fp.r, h, 32), previewMaterial(ctx));
    mesh.position.y = h / 2;
    return mesh;
  },
  geometry: (fp, h) => ({ type: "cylinder", radius: fp.r, height: h, segments: 32 }),
  label: (fp, h) => `R ${Math.round(fp.r * 10) / 10} · H ${Math.round(h * 10) / 10}`,
});

export const coneTool = makeHeightTool({
  id: "cone",
  footprint: (a, b) => ({ w: 0, d: 0, r: footprintRadius(a, b) }),
  mesh: (fp, h, ctx) => {
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(fp.r, h, 32), previewMaterial(ctx));
    mesh.position.y = h / 2;
    return mesh;
  },
  geometry: (fp, h) => ({ type: "cone", radius: fp.r, height: h, segments: 32 }),
  label: (fp, h) => `R ${Math.round(fp.r * 10) / 10} · H ${Math.round(h * 10) / 10}`,
});
