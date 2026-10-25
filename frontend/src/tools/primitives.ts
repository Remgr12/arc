import * as THREE from "three";
import type { ToolContext, ToolHandler } from "./types";
import { evalMathExpr } from "./sketch";
import { useArcStore } from "../lib/store";

// ---------------------------------------------------------------------------
// Primitive creation tools. Click-click (or drag) sets the footprint; box,
// cylinder and cone add a third "height" step driven by cursor height.
// ---------------------------------------------------------------------------

interface PrimState {
  anchor: THREE.Vector3 | null;
  second: THREE.Vector3 | null;
  lastCursor: THREE.Vector3 | null;
  lastScreen: { x: number; y: number } | undefined;
  press: { x: number; y: number } | null;
  dragged: boolean;
  typed: string;
}

function fresh(): PrimState {
  return {
    anchor: null,
    second: null,
    lastCursor: null,
    lastScreen: undefined,
    press: null,
    dragged: false,
    typed: "",
  };
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
    side: THREE.DoubleSide,
  });
  mat.color.copy(ctx.palette.hover);
  return mat;
}

function decoratePreviewMesh(mesh: THREE.Mesh, ctx: ToolContext, withEdges = true): THREE.Mesh {
  if (withEdges) {
    const edges = new THREE.EdgesGeometry(mesh.geometry, 25);
    const lineMat = new THREE.LineBasicMaterial({
      color: ctx.palette.hover,
      transparent: true,
      opacity: 0.9,
      depthTest: false,
    });
    const wire = new THREE.LineSegments(edges, lineMat);
    wire.renderOrder = 998;
    mesh.add(wire);
  }
  mesh.renderOrder = 997;
  return mesh;
}

/** Cursor height above the base point using a camera-facing vertical plane, snapped to dimSnapStep. */
function cursorHeight(ctx: ToolContext, event: PointerEvent | MouseEvent, base: THREE.Vector3): number {
  const forward = new THREE.Vector3();
  ctx.camera.getWorldDirection(forward);
  forward.y = 0;
  if (forward.lengthSq() < 1e-6) forward.set(0, 0, 1);
  forward.normalize();
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(forward, base);
  const out = new THREE.Vector3();
  const hit = ctx.rayAt(event).intersectPlane(plane, out);
  const raw = hit ? Math.max(0.5, out.y - base.y) : 20;
  return Math.max(0.5, ctx.snapDim(raw, event.altKey));
}

function isDrag(state: PrimState, event: PointerEvent): boolean {
  return !!state.press && Math.hypot(event.clientX - state.press.x, event.clientY - state.press.y) > 5;
}

function footprintRadius(a: THREE.Vector3, b: THREE.Vector3, ctx: ToolContext): number {
  const raw = Math.max(0.5, Math.hypot(b.x - a.x, b.z - a.z));
  return Math.max(0.5, ctx.snapDim(raw));
}

function pointAtTypedSimple(
  id: "sphere" | "torus" | "plane",
  a: THREE.Vector3,
  cursor: THREE.Vector3 | null,
  typed: string,
): THREE.Vector3 | null {
  const parts = typed
    .trim()
    .split(/[\s,x×]+/i)
    .map((s) => evalMathExpr(s) ?? Number.parseFloat(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return null;
  if (id === "plane") {
    const w = parts[0];
    const d = parts[1] ?? parts[0];
    const sx = cursor && cursor.x < a.x ? -1 : 1;
    const sz = cursor && cursor.z < a.z ? -1 : 1;
    return new THREE.Vector3(a.x + sx * w, a.y, a.z + sz * d);
  }
  const r = parts[0];
  return new THREE.Vector3(a.x + r, a.y, a.z);
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
    const st = useArcStore.getState();
    const rot = st.sketchMode && Math.abs(st.sketchPlaneNormal[1] - 1) > 1e-3
      ? (() => {
          const n = new THREE.Vector3(...st.sketchPlaneNormal).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
          return [q.x, q.y, q.z, q.w] as [number, number, number, number];
        })()
      : undefined;
    void ctx.createEntity(built.geometry as never, built.position, undefined, rot);
    ctx.setStatus("Placed");
  };
  const refreshTypedPreview = (ctx: ToolContext) => {
    if (!state.anchor) return;
    const target =
      (state.typed ? pointAtTypedSimple(id, state.anchor, state.lastCursor, state.typed) : null) ??
      state.lastCursor;
    if (!target) return;
    const built = build(state.anchor, target, ctx);
    if (built) {
      ctx.setPreview(built.preview, "draft");
      const label = state.typed ? `${built.label} [${state.typed}|]` : built.label;
      ctx.showMeasure(label, state.lastScreen);
    }
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
      const raw = state.anchor ? ctx.planePoint(event, state.anchor.y) : ctx.planePoint(event);
      if (!raw) return true;
      const p = ctx.snap(raw).point;
      if (!state.anchor) {
        state.anchor = p;
        state.lastCursor = p.clone();
        state.lastScreen = ctx.screenPoint(event);
        state.press = { x: event.clientX, y: event.clientY };
        ctx.capturePointer(event);
        return true;
      }
      const target =
        (state.typed ? pointAtTypedSimple(id, state.anchor, p, state.typed) : null) ?? p;
      const built = build(state.anchor, target, ctx);
      if (built) place(built, ctx);
      state = reset(ctx);
      return true;
    },
    onPointerMove(event, ctx) {
      const raw = state.anchor ? ctx.planePoint(event, state.anchor.y) : ctx.planePoint(event);
      if (!raw) return;
      const cursor = ctx.snap(raw).point;
      state.lastCursor = cursor;
      state.lastScreen = ctx.screenPoint(event);
      if (isDrag(state, event)) state.dragged = true;
      if (!state.anchor) {
        ctx.showMeasure(null);
        return;
      }
      const target =
        (state.typed ? pointAtTypedSimple(id, state.anchor, cursor, state.typed) : null) ?? cursor;
      const built = build(state.anchor, target, ctx);
      if (built) {
        ctx.setPreview(built.preview, "draft");
        const label = state.typed ? `${built.label} [${state.typed}|]` : built.label;
        ctx.showMeasure(label, state.lastScreen);
      }
    },
    onPointerUp(event, ctx) {
      if (!state.anchor) return;
      if (!state.dragged) {
        state.press = null;
        ctx.releasePointer(event);
        return;
      }
      const raw = ctx.planePoint(event, state.anchor.y);
      if (raw) {
        const cursor = ctx.snap(raw).point;
        const target =
          (state.typed ? pointAtTypedSimple(id, state.anchor, cursor, state.typed) : null) ?? cursor;
        const built = build(state.anchor, target, ctx);
        if (built) place(built, ctx);
      }
      state = reset(ctx);
      ctx.releasePointer(event);
    },
    onKey(event, ctx) {
      if (!state.anchor) return false;
      if (/^[0-9.+\-*/\s()]$/.test(event.key)) {
        state.typed += event.key;
        refreshTypedPreview(ctx);
        return true;
      }
      if ((event.key === "," || event.key === "Tab") && id === "plane") {
        event.preventDefault();
        if (!state.typed.includes(",")) state.typed += ",";
        refreshTypedPreview(ctx);
        return true;
      }
      return false;
    },
    onBackspace(ctx) {
      if (state.anchor && state.typed.length > 0) {
        state.typed = state.typed.slice(0, -1);
        refreshTypedPreview(ctx);
      }
    },
    onEnter(ctx) {
      if (!state.anchor) return false;
      const target =
        (state.typed ? pointAtTypedSimple(id, state.anchor, state.lastCursor, state.typed) : null) ??
        state.lastCursor;
      if (!target) return false;
      const built = build(state.anchor, target, ctx);
      if (built) place(built, ctx);
      state = reset(ctx);
      return true;
    },
    onCancel(ctx) {
      state = reset(ctx);
    },
    hint: () =>
      id === "plane"
        ? "Plane · drag or click two corners (or type W,D + Enter)"
        : "Drag or click center, then radius (or type R + Enter)",
  };
}

export const sphereTool = makeSimpleTool("sphere", (a, b, ctx) => {
  const r = footprintRadius(a, b, ctx);
  const u = ctx.settings.unitLabel;
  const mesh = decoratePreviewMesh(
    new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), previewMaterial(ctx)),
    ctx,
    false,
  );
  mesh.position.set(a.x, a.y + r, a.z);
  return {
    geometry: { type: "sphere", radius: r, segments: 24 },
    position: [a.x, a.y + r, a.z],
    preview: mesh,
    label: `R ${Math.round(r * 100) / 100} ${u}`,
  };
});

export const torusTool = makeSimpleTool("torus", (a, b, ctx) => {
  const r = Math.max(2, footprintRadius(a, b, ctx));
  const tube = Math.round(Math.min(8, r / 3) * 10) / 10;
  const u = ctx.settings.unitLabel;
  const mesh = decoratePreviewMesh(
    new THREE.Mesh(
      new THREE.TorusGeometry(r, tube, 12, 32).rotateX(Math.PI / 2),
      previewMaterial(ctx),
    ),
    ctx,
    false,
  );
  mesh.position.set(a.x, a.y + tube, a.z);
  return {
    geometry: { type: "torus", radius: r, tube, segments: 24, tubular_segments: 16 },
    position: [a.x, a.y + tube, a.z],
    preview: mesh,
    label: `R ${Math.round(r * 100) / 100} ${u}`,
  };
});

export const planeTool = makeSimpleTool("plane", (a, b, ctx) => {
  const w = Math.max(1, ctx.snapDim(Math.abs(b.x - a.x)));
  const d = Math.max(1, ctx.snapDim(Math.abs(b.z - a.z)));
  const sx = b.x < a.x ? -1 : 1;
  const sz = b.z < a.z ? -1 : 1;
  const cx = a.x + (sx * w) / 2;
  const cz = a.z + (sz * d) / 2;
  const u = ctx.settings.unitLabel;
  const mesh = decoratePreviewMesh(
    new THREE.Mesh(
      new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2),
      previewMaterial(ctx),
    ),
    ctx,
  );
  mesh.position.set(cx, a.y + 0.02, cz);
  return {
    geometry: { type: "plane", width: w, depth: d },
    position: [cx, a.y + 0.02, cz],
    preview: mesh,
    label: `${Math.round(w * 100) / 100} × ${Math.round(d * 100) / 100} ${u}`,
  };
});

// ------------------------------------------------------- two-stage (height)

interface HeightTool {
  id: "box" | "cylinder" | "cone";
  footprint: (a: THREE.Vector3, b: THREE.Vector3, ctx: ToolContext) => { w: number; d: number; r: number };
  mesh: (
    a: THREE.Vector3,
    b: THREE.Vector3,
    fp: { w: number; d: number; r: number },
    h: number,
    ctx: ToolContext,
  ) => THREE.Mesh;
  position: (
    a: THREE.Vector3,
    b: THREE.Vector3,
    fp: { w: number; d: number; r: number },
    h: number,
  ) => [number, number, number];
  geometry: (fp: { w: number; d: number; r: number }, h: number) => Record<string, unknown>;
  label: (fp: { w: number; d: number; r: number }, h: number, ctx: ToolContext) => string;
}

function secondFromTypedFootprint(
  id: "box" | "cylinder" | "cone",
  a: THREE.Vector3,
  cursor: THREE.Vector3 | null,
  typed: string,
): { second: THREE.Vector3; extraHeight?: number } | null {
  const parts = typed
    .trim()
    .split(/[\s,x×]+/i)
    .map((s) => evalMathExpr(s) ?? Number.parseFloat(s))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parts.length === 0) return null;
  if (id === "box") {
    const w = parts[0];
    const d = parts[1] ?? parts[0];
    const sx = cursor && cursor.x < a.x ? -1 : 1;
    const sz = cursor && cursor.z < a.z ? -1 : 1;
    return {
      second: new THREE.Vector3(a.x + sx * w, a.y, a.z + sz * d),
      extraHeight: parts[2],
    };
  }
  const r = parts[0];
  return {
    second: new THREE.Vector3(a.x + r, a.y, a.z),
    extraHeight: parts[1],
  };
}

function makeHeightTool(spec: HeightTool): ToolHandler {
  let state = fresh();
  let height = 20;

  const commitAt = (a: THREE.Vector3, b: THREE.Vector3, h: number, ctx: ToolContext): void => {
    const fp = spec.footprint(a, b, ctx);
    const st = useArcStore.getState();
    const rot = st.sketchMode && Math.abs(st.sketchPlaneNormal[1] - 1) > 1e-3
      ? (() => {
          const n = new THREE.Vector3(...st.sketchPlaneNormal).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
          return [q.x, q.y, q.z, q.w] as [number, number, number, number];
        })()
      : undefined;
    void ctx.createEntity(
      spec.geometry(fp, h) as never,
      spec.position(a, b, fp, h),
      undefined,
      rot,
    );
    ctx.setStatus("Placed");
    state = reset(ctx);
  };

  const previewFor = (ctx: ToolContext, event?: PointerEvent): void => {
    if (!state.anchor) return;
    if (event) {
      state.lastScreen = ctx.screenPoint(event);
    }
    if (!state.second) {
      if (event) {
        const raw = ctx.planePoint(event, state.anchor.y);
        if (!raw) return;
        state.lastCursor = ctx.snap(raw).point;
      }
      const typedFoot = state.typed
        ? secondFromTypedFootprint(spec.id, state.anchor, state.lastCursor, state.typed)
        : null;
      const b = typedFoot?.second ?? state.lastCursor ?? state.anchor;
      const previewH = typedFoot?.extraHeight ?? 2;
      const fp = spec.footprint(state.anchor, b, ctx);
      const mesh = spec.mesh(state.anchor, b, fp, previewH, ctx);
      ctx.setPreview(mesh, "draft");
      const baseLabel = spec.label(fp, previewH, ctx);
      ctx.showMeasure(
        state.typed ? `${baseLabel} [${state.typed}|]` : baseLabel,
        state.lastScreen,
      );
      return;
    }
    if (state.typed) {
      const parsed = Number.parseFloat(state.typed);
      if (Number.isFinite(parsed) && parsed > 0) height = parsed;
    } else if (event) {
      height = cursorHeight(ctx, event, state.second);
    }
    const fp = spec.footprint(state.anchor, state.second, ctx);
    const mesh = spec.mesh(state.anchor, state.second, fp, height, ctx);
    ctx.setPreview(mesh, "draft");
    const baseLabel = spec.label(fp, height, ctx);
    ctx.showMeasure(
      state.typed ? `${baseLabel} [${state.typed}|]` : baseLabel,
      state.lastScreen,
    );
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
      const raw = state.anchor ? ctx.planePoint(event, state.anchor.y) : ctx.planePoint(event);
      if (!raw) return true;
      const p = ctx.snap(raw).point;
      if (!state.anchor) {
        state.anchor = p;
        state.lastCursor = p.clone();
        state.lastScreen = ctx.screenPoint(event);
        state.press = { x: event.clientX, y: event.clientY };
        ctx.capturePointer(event);
        return true;
      }
      if (!state.second) {
        const typedFoot = state.typed
          ? secondFromTypedFootprint(spec.id, state.anchor, p, state.typed)
          : null;
        state.second = typedFoot?.second ?? p;
        state.typed = "";
        height = typedFoot?.extraHeight ?? 20;
        if (typedFoot?.extraHeight) {
          commitAt(state.anchor, state.second, height, ctx);
          return true;
        }
        ctx.setStatus("Move to set height (or type H + Enter) · click to place · Esc restarts footprint");
        previewFor(ctx, event);
        return true;
      }
      commitAt(state.anchor, state.second, height, ctx);
      return true;
    },
    onPointerMove(event, ctx) {
      previewFor(ctx, event);
      if (state.anchor && !state.second && isDrag(state, event)) state.dragged = true;
    },
    onPointerUp(event, ctx) {
      if (!state.anchor) return;
      if (!state.second && state.dragged) {
        const raw = ctx.planePoint(event, state.anchor.y);
        if (raw) {
          state.second = ctx.snap(raw).point;
          state.typed = "";
          height = 20;
          ctx.setStatus("Move to set height (or type H + Enter) · click to place");
          previewFor(ctx, event);
        }
        state.dragged = false;
        state.press = null;
        ctx.releasePointer(event);
      } else if (!state.second) {
        state.press = null;
        ctx.releasePointer(event);
      }
    },
    onKey(event, ctx) {
      if (!state.anchor) return false;
      if (/^[0-9.+\-*/\s()]$/.test(event.key)) {
        state.typed += event.key;
        previewFor(ctx);
        return true;
      }
      if ((event.key === "," || event.key === "Tab") && !state.second) {
        event.preventDefault();
        state.typed += ",";
        previewFor(ctx);
        return true;
      }
      return false;
    },
    onBackspace(ctx) {
      if (state.anchor && state.typed.length > 0) {
        state.typed = state.typed.slice(0, -1);
        previewFor(ctx);
      }
    },
    onEnter(ctx) {
      if (!state.anchor) return false;
      if (!state.second) {
        const typedFoot = state.typed
          ? secondFromTypedFootprint(spec.id, state.anchor, state.lastCursor, state.typed)
          : null;
        const b = typedFoot?.second ?? state.lastCursor;
        if (!b) return false;
        state.second = b;
        state.typed = "";
        if (typedFoot?.extraHeight) {
          commitAt(state.anchor, state.second, typedFoot.extraHeight, ctx);
          return true;
        }
        height = 20;
        ctx.setStatus("Move to set height (or type H + Enter) · click to place");
        previewFor(ctx);
        return true;
      }
      if (state.typed) {
        const parsed = Number.parseFloat(state.typed);
        if (Number.isFinite(parsed) && parsed > 0) height = parsed;
      }
      commitAt(state.anchor, state.second, height, ctx);
      return true;
    },
    onCancel(ctx) {
      if (state.second) {
        state.second = null;
        state.typed = "";
        ctx.setStatus("Height cancelled · set the footprint again");
        return;
      }
      state = reset(ctx);
    },
    hint: () => "Click (or drag) the footprint, then set height (type dimensions + Enter at any step)",
  };
}

export const boxTool = makeHeightTool({
  id: "box",
  footprint: (a, b, ctx) => ({
    w: Math.max(0.5, ctx.snapDim(Math.abs(b.x - a.x))),
    d: Math.max(0.5, ctx.snapDim(Math.abs(b.z - a.z))),
    r: 0,
  }),
  mesh: (a, b, fp, h, ctx) => {
    const sx = b.x < a.x ? -1 : 1;
    const sz = b.z < a.z ? -1 : 1;
    const mesh = decoratePreviewMesh(
      new THREE.Mesh(new THREE.BoxGeometry(fp.w, h, fp.d), previewMaterial(ctx)),
      ctx,
    );
    mesh.position.set(a.x + (sx * fp.w) / 2, a.y + h / 2, a.z + (sz * fp.d) / 2);
    return mesh;
  },
  position: (a, b, fp, h) => {
    const sx = b.x < a.x ? -1 : 1;
    const sz = b.z < a.z ? -1 : 1;
    return [a.x + (sx * fp.w) / 2, a.y + h / 2, a.z + (sz * fp.d) / 2];
  },
  geometry: (fp, h) => ({ type: "box", width: fp.w, depth: fp.d, height: h, corner_radius: 0 }),
  label: (fp, h, ctx) =>
    `${Math.round(fp.w * 10) / 10} × ${Math.round(fp.d * 10) / 10} × ${Math.round(h * 10) / 10} ${ctx.settings.unitLabel}`,
});

export const cylinderTool = makeHeightTool({
  id: "cylinder",
  footprint: (a, b, ctx) => ({ w: 0, d: 0, r: footprintRadius(a, b, ctx) }),
  mesh: (a, _b, fp, h, ctx) => {
    const mesh = decoratePreviewMesh(
      new THREE.Mesh(new THREE.CylinderGeometry(fp.r, fp.r, h, 24), previewMaterial(ctx)),
      ctx,
    );
    mesh.position.set(a.x, a.y + h / 2, a.z);
    return mesh;
  },
  position: (a) => [a.x, a.y, a.z],
  geometry: (fp, h) => ({ type: "cylinder", radius: fp.r, height: h, segments: 24 }),
  label: (fp, h, ctx) => `R ${Math.round(fp.r * 10) / 10} · H ${Math.round(h * 10) / 10} ${ctx.settings.unitLabel}`,
});

export const coneTool = makeHeightTool({
  id: "cone",
  footprint: (a, b, ctx) => ({ w: 0, d: 0, r: footprintRadius(a, b, ctx) }),
  mesh: (a, _b, fp, h, ctx) => {
    const mesh = decoratePreviewMesh(
      new THREE.Mesh(new THREE.ConeGeometry(fp.r, h, 24), previewMaterial(ctx)),
      ctx,
    );
    mesh.position.set(a.x, a.y + h / 2, a.z);
    return mesh;
  },
  position: (a) => [a.x, a.y, a.z],
  geometry: (fp, h) => ({ type: "cone", radius: fp.r, height: h, segments: 24 }),
  label: (fp, h, ctx) => `R ${Math.round(fp.r * 10) / 10} · H ${Math.round(h * 10) / 10} ${ctx.settings.unitLabel}`,
});
