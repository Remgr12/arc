import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { useThemeStore, viewportPalette, type ViewportPalette } from "../lib/themes";
import { ViewCube } from "../lib/viewcube";
import { MATERIALS } from "../lib/materials";
import { actions } from "../lib/actions";
import { TOOL_BY_ID } from "../data/tools";
import { handlerFor } from "../tools/registry";
import type { ToolContext, ViewPalette, GizmoMode } from "../tools/types";
import type { EntityData, LayerData, SceneData, ToolId, Transform } from "../lib/types";
import type { EdgeHit, FaceHit } from "../tools/topology";
import {
  edgeOverlayGeometry,
  faceOverlayGeometry,
  facePlaneInfo,
  pickEdgeScreen,
} from "../tools/topology";
import { uiCapture } from "../lib/uiCapture";

interface ViewAnim {
  start: number;
  duration: number;
  /** Orbit direction flight (gizmo planes). */
  dirFrom?: THREE.Vector3;
  dirTo?: THREE.Vector3;
  radius?: number;
  /** Camera + target flight (fit view, focus entity). */
  posFrom?: THREE.Vector3;
  posTo?: THREE.Vector3;
  targetFrom?: THREE.Vector3;
  targetTo?: THREE.Vector3;
}

interface MarqueeState {
  x0: number;
  y0: number;
  additive: boolean;
}

interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
}

interface ViewportRefs {
  host: HTMLDivElement;
  measureEl: HTMLDivElement;
  scaleBarLineEl: HTMLDivElement;
  scaleBarLabelEl: HTMLSpanElement;
  scaleGridBtnEl: HTMLButtonElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  tc: TransformControls;
  gizmoDragging: boolean;
  sceneRoot: THREE.Scene;
  entityRoot: THREE.Group;
  gridNode: THREE.Group;
  groundNode: THREE.Mesh;
  axes: THREE.AxesHelper;
  raycaster: THREE.Raycaster;
  columnMaterial: THREE.MeshStandardMaterial;
  lineMaterial: THREE.LineBasicMaterial;
  objects: Map<string, THREE.Object3D>;
  meshObjects: THREE.Object3D[];
  needsRender: boolean;
  lastTool: ToolId | null;
  lastCommitAt: number;
  lastScene: SceneData | null;
  lastHover: string | null;
  lastHoverObjKey: string;
  lastHoverAt: number;
  lastDisplayMode: "shaded" | "wireframe";
  lastSectionView: boolean;
  lastSectionOffset: number;
  lastSketchMode: boolean;
  lastSketchHeight: number;
  lastSketchPlaneKey: string;
  lastGridSize: number;
  lastLowSpecMode: boolean;
  lastCursorAt: number;
  disposed: boolean;
  gizmo: ViewCube;
  viewAnim: ViewAnim | null;
  palette: ViewPalette;
  marquee: MarqueeState | null;
  marqueeEl: HTMLDivElement | null;
  /** Screen position of an in-flight right-button press (pan-drag suppression). */
  contextPress: { x: number; y: number } | null;
  /** Overlay objects grouped by tag; each new object replaces the old one. */
  previews: Map<string, THREE.Object3D>;
  /** Hovered/selected face & edge highlight overlays. */
  hoverOverlay: THREE.Mesh | null;
  selOverlay: THREE.Mesh | null;
  hoverEdgeOverlay: THREE.LineSegments | null;
  selEdgeOverlay: THREE.LineSegments | null;
  sectionPlane: THREE.Plane;
  overlayKey: string;
  ctx: ToolContext;
}

/** The main editor viewport. Handles navigation, picking and tools. */
export function Viewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ref = createViewport(host);
    ref.disposed = false;
    const unsubscribe = useArcStore.subscribe(() => syncSceneToThree(ref));
    const unsubscribeTheme = useThemeStore.subscribe((state) =>
      applyTheme(ref, viewportPalette(state.active())),
    );
    applyTheme(ref, viewportPalette(useThemeStore.getState().active()));
    const cleanup = attachHandlers(ref);
    const stop = startLoop(ref);
    return () => {
      unsubscribe();
      unsubscribeTheme();
      cleanup();
      stop();
      disposeViewport(ref);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
    </div>
  );
}

// ------------------------------------------------------------------ setup

function themeToPalette(p: ViewportPalette): ViewPalette {
  const accent = new THREE.Color(p.accent600);
  return {
    bg: new THREE.Color(p.bg),
    grid: new THREE.Color(p.grid),
    gridLine: new THREE.Color(p.gridLine),
    selection: accent.clone(),
    hover: new THREE.Color(p.bg).lerp(accent, 0.25),
    line: new THREE.Color(p.accent500),
  };
}

function makeGrid(p: ViewportPalette, gridSize = 2): THREE.Group {
  const step = Math.max(0.5, Math.min(100, gridSize || 2));
  const divisions = 200;
  const extent = step * divisions;

  const group = new THREE.Group();
  const grid = new THREE.GridHelper(
    extent,
    divisions,
    new THREE.Color(p.grid).getHex(),
    new THREE.Color(p.gridLine).getHex(),
  );
  const mat = grid.material as THREE.LineBasicMaterial;
  mat.transparent = true;
  mat.opacity = 0.45;
  mat.depthWrite = false;
  group.add(grid);
  return group;
}

function updateScaleBar(ref: ViewportRefs): void {
  const settings = useArcStore.getState().settings;
  const isImperial =
    settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";
  const unit = isImperial ? "in" : "cm";
  const gridSize = settings?.grid_size ?? 2;

  // Map gridSize (1, 2, 5, 10) to a tiny visual square box size (12px -> 22px)
  const boxPx = gridSize <= 1 ? 12 : gridSize <= 2 ? 15 : gridSize <= 5 ? 18 : 22;
  ref.scaleBarLineEl.style.width = `${boxPx}px`;
  ref.scaleBarLineEl.style.height = `${boxPx}px`;
  ref.scaleBarLabelEl.textContent = `${gridSize} ${unit}`;
}

function createViewport(host: HTMLDivElement): ViewportRefs {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(host.clientWidth || 800, host.clientHeight || 600);
  renderer.autoClear = false;
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.style.display = "block";
  renderer.domElement.style.touchAction = "none";
  renderer.domElement.style.outline = "none";
  host.appendChild(renderer.domElement);

  const palette = viewportPalette(useThemeStore.getState().active());
  const viewPalette = themeToPalette(palette);

  const sceneRoot = new THREE.Scene();
  sceneRoot.background = viewPalette.bg;
  sceneRoot.fog = new THREE.Fog(palette.bg, 5000, 16000);

  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.5, 60000);
  camera.position.set(340, 250, 380);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = false;
  controls.mouseButtons = {
    LEFT: -1 as unknown as THREE.MOUSE,
    MIDDLE: THREE.MOUSE.ROTATE,
    RIGHT: THREE.MOUSE.PAN,
  };

  const hemi = new THREE.HemisphereLight(0xffffff, 0x3a3a44, 1.25);
  sceneRoot.add(hemi);
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.65);
  dirLight.position.set(600, 1000, 300);
  dirLight.castShadow = true;
  const shadow = dirLight.shadow;
  shadow.camera.left = -600;
  shadow.camera.right = 600;
  shadow.camera.top = 600;
  shadow.camera.bottom = -600;
  shadow.camera.near = 1;
  shadow.camera.far = 3000;
  shadow.mapSize.set(1024, 1024);
  shadow.bias = -0.0005;
  shadow.normalBias = 2;
  sceneRoot.add(dirLight);
  sceneRoot.add(new THREE.AmbientLight(0xffffff, 0.22));

  // Subtle PBR environment lighting (low intensity so the theme stays dominant).
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  sceneRoot.environment = pmrem.fromScene(room, 0.04).texture;
  sceneRoot.environmentIntensity = 0.35;
  pmrem.dispose();
  room.dispose();

  const entityRoot = new THREE.Group();
  sceneRoot.add(entityRoot);

  const groundNode = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.18 }),
  );
  groundNode.position.y = 0.01;
  groundNode.receiveShadow = true;
  sceneRoot.add(groundNode);

  const axes = new THREE.AxesHelper(240);
  axes.position.y = 0.2;
  sceneRoot.add(axes);

  const measureEl = document.createElement("div");
  measureEl.className =
    "pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-md border border-base-400 bg-base-50/95 px-2 py-1 font-mono text-[11px] leading-none text-accent-500 shadow-md";
  measureEl.style.display = "none";
  host.appendChild(measureEl);

  // Scale indicator is rendered in the top-right Shapr3D pill (UtilityRail)
  const scaleGridBtnEl = document.createElement("button");
  const scaleBarLineEl = document.createElement("div");
  const scaleBarLabelEl = document.createElement("span");

  const tc = new TransformControls(camera, renderer.domElement);
  tc.setMode("translate");
  tc.setSpace("world");
  tc.setSize(0.85);
  const tcHelper = tc.getHelper();
  tcHelper.visible = false;
  sceneRoot.add(tcHelper);

  const raycaster = new THREE.Raycaster();
  if (raycaster.params.Line) (raycaster.params.Line as { threshold: number }).threshold = 10;

  const initialGridSize = useArcStore.getState().settings?.grid_size ?? 2;
  const gridNode = makeGrid(palette, initialGridSize);
  sceneRoot.add(gridNode);

  const ref: ViewportRefs = {
    host,
    measureEl,
    scaleBarLineEl,
    scaleBarLabelEl,
    scaleGridBtnEl,
    renderer,
    camera,
    controls,
    tc,
    gizmoDragging: false,
    sceneRoot,
    entityRoot,
    gridNode,
    groundNode,
    axes,
    raycaster,
    columnMaterial: new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
    lineMaterial: new THREE.LineBasicMaterial(),
    objects: new Map(),
    meshObjects: [],
    needsRender: true,
    lastTool: null,
    lastCommitAt: 0,
    lastScene: null,
    lastHover: null,
    lastHoverObjKey: "",
    lastHoverAt: 0,
    lastDisplayMode: "shaded",
    lastSectionView: false,
    lastSectionOffset: 0,
    lastSketchMode: false,
    lastSketchHeight: 0,
    lastSketchPlaneKey: "",
    lastGridSize: initialGridSize,
    lastLowSpecMode: false,
    lastCursorAt: 0,
    disposed: false,
    gizmo: null as unknown as ViewCube,
    viewAnim: null,
    palette: viewPalette,
    marquee: null,
    marqueeEl: null,
    contextPress: null,
    previews: new Map(),
    hoverOverlay: null,
    selOverlay: null,
    hoverEdgeOverlay: null,
    selEdgeOverlay: null,
    sectionPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 15),
    overlayKey: "",
    ctx: null as unknown as ToolContext,
  };

  ref.gizmo = new ViewCube(
    renderer.domElement,
    (normal) => focusPlane(ref, normal),
    ref.measureEl.parentElement ?? ref.host,
  );
  ref.ctx = makeToolContext(ref);

  controls.addEventListener("change", () => {
    ref.needsRender = true;
  });
  tc.addEventListener("change", () => {
    ref.needsRender = true;
    if (ref.gizmoDragging) ref.renderer.shadowMap.needsUpdate = true;
  });
  tc.addEventListener("dragging-changed", (event) => {
    const dragging = Boolean((event as unknown as { value: boolean }).value);
    ref.gizmoDragging = dragging;
    ref.controls.enabled = !dragging;
    ref.needsRender = true;
    ref.renderer.shadowMap.needsUpdate = true;
    if (!dragging) writeBackGizmo(ref);
  });

  return ref;
}

function startLoop(ref: ViewportRefs): () => void {
  const ro = new ResizeObserver(() => {
    const w = ref.host.clientWidth;
    const h = ref.host.clientHeight;
    if (w === 0 || h === 0) return;
    ref.renderer.setSize(w, h);
    ref.camera.aspect = w / h;
    ref.camera.updateProjectionMatrix();
    ref.needsRender = true;
  });
  ro.observe(ref.host);

  let raf = 0;
  let pendingCapture = false;
  let pendingThumbResolve: ((url: string | null) => void) | null = null;
  const captureListener = () => {
    pendingCapture = true;
    ref.needsRender = true;
  };
  window.addEventListener("arc-capture", captureListener);
  const thumbListener = (event: Event) => {
    const resolve = (event as CustomEvent).detail;
    if (typeof resolve === "function") {
      pendingThumbResolve = resolve;
      ref.needsRender = true;
    }
  };
  window.addEventListener("arc-capture-thumb", thumbListener);
  const tick = () => {
    if (ref.disposed) return;

    const now = performance.now();
    // Camera flight (gizmo plane focus or fit-view).
    if (ref.viewAnim) {
      const anim = ref.viewAnim;
      const t = Math.min(1, (now - anim.start) / anim.duration);
      const k = t * t * (3 - 2 * t);
      if (anim.dirFrom && anim.dirTo && anim.radius !== undefined) {
        const dir = slerpDir(anim.dirFrom, anim.dirTo, k);
        ref.camera.position.copy(ref.controls.target).addScaledVector(dir, anim.radius);
      } else if (anim.posFrom && anim.posTo && anim.targetFrom && anim.targetTo) {
        ref.camera.position.lerpVectors(anim.posFrom, anim.posTo, k);
        ref.controls.target.lerpVectors(anim.targetFrom, anim.targetTo, k);
      }
      if (t >= 1) ref.viewAnim = null;
      ref.needsRender = true;
    }

    // Animate any newly-spawned entities.
    for (const obj of ref.objects.values()) {
      if (obj.userData.spawnAt !== undefined) {
        applySpawnScale(obj, now);
        ref.needsRender = true;
      }
    }

    const controlsMoved = ref.controls.update();
    if (controlsMoved || ref.needsRender || pendingCapture || pendingThumbResolve) {
      ref.needsRender = false;
      ref.renderer.clear();
      ref.renderer.render(ref.sceneRoot, ref.camera);
      const w = ref.host.clientWidth;
      const h = ref.host.clientHeight;
      if (w > 0 && h > 0) ref.gizmo.render(ref.renderer, ref.camera, w, h);
      updateScaleBar(ref);
    }

    if (pendingCapture) {
      pendingCapture = false;
      try {
        const url = ref.renderer.domElement.toDataURL("image/png");
        const link = document.createElement("a");
        link.download = `${useArcStore.getState().scene?.name ?? "scene"}.png`;
        link.href = url;
        link.click();
      } catch {
        // capture unsupported on this renderer config
      }
    }
    if (pendingThumbResolve) {
      const resolve = pendingThumbResolve;
      pendingThumbResolve = null;
      try {
        resolve(thumbnailDataUrl(ref.renderer));
      } catch {
        resolve(null);
      }
    }
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    window.removeEventListener("arc-capture", captureListener);
    window.removeEventListener("arc-capture-thumb", thumbListener);
  };
}

/** Downscaled PNG of the just-rendered frame, for project card thumbnails. */
function thumbnailDataUrl(renderer: THREE.WebGLRenderer): string | null {
  const src = renderer.domElement;
  if (!src.width || !src.height) return null;
  const width = 480;
  const height = Math.max(1, Math.round((src.height / src.width) * width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(src, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** Shortest-arc rotation between two view directions. */
function slerpDir(from: THREE.Vector3, to: THREE.Vector3, k: number): THREE.Vector3 {
  const out = from.clone();
  const dot = Math.max(-1, Math.min(1, from.dot(to)));
  const angle = Math.acos(dot);
  if (angle < 1e-4) return out.lerp(to, k).normalize();
  const axis = new THREE.Vector3().crossVectors(from, to).normalize();
  out.applyAxisAngle(axis, angle * k);
  // Guard against drift making the direction non-normalized.
  if (out.lengthSq() < 0.9) out.copy(to);
  return out.normalize();
}

/** Fly the camera to look straight at the given world plane normal. */
function focusPlane(ref: ViewportRefs, normal: THREE.Vector3): void {
  const dirTo = normal.clone().normalize();
  if (Math.abs(dirTo.y) > 0.9999) {
    // Keep OrbitControls happy: nudge along +Z/-Z so +X stays horizontal (right).
    dirTo.set(0, dirTo.y > 0 ? 1 : -1, dirTo.y > 0 ? 0.0008 : -0.0008).normalize();
  }
  const current = ref.camera.position.clone().sub(ref.controls.target);
  if (current.lengthSq() < 1e-8) return;
  ref.viewAnim = {
    dirFrom: current.normalize(),
    dirTo,
    radius: Math.max(120, ref.camera.position.distanceTo(ref.controls.target)),
    start: performance.now(),
    duration: 360,
  };
}

// -------------------------------------------------------------- theme sync

function applyTheme(ref: ViewportRefs, palette: ViewportPalette): void {
  ref.palette = themeToPalette(palette);
  ref.sceneRoot.background = ref.palette.bg;
  ref.sceneRoot.fog = new THREE.Fog(palette.bg, 5000, 16000);
  const index = ref.sceneRoot.children.indexOf(ref.gridNode);
  const wasVisible = ref.gridNode.visible;
  const prevPos = ref.gridNode.position.clone();
  const prevQuat = ref.gridNode.quaternion.clone();
  ref.sceneRoot.remove(ref.gridNode);
  disposeObject(ref.gridNode);
  const next = makeGrid(palette, ref.lastGridSize);
  next.visible = wasVisible;
  next.position.copy(prevPos);
  next.quaternion.copy(prevQuat);
  if (index >= 0) ref.sceneRoot.children.splice(index, 0, next);
  else ref.sceneRoot.add(next);
  ref.gridNode = next;
  ref.gizmo.applyTheme(palette);
  updateScaleBar(ref);
  ref.needsRender = true;
}

// -------------------------------------------------------------- scene sync

function hoverObjKey(hoverObj: { entityId?: string; kind?: string; face?: number | null; edge?: string | null } | null): string {
  if (!hoverObj) return "";
  return `${hoverObj.entityId ?? ""}:${hoverObj.kind ?? ""}:${hoverObj.face ?? ""}:${hoverObj.edge ?? ""}`;
}

function syncSceneToThree(ref: ViewportRefs): void {
  const state = useArcStore.getState();
  const scene = state.scene;
  const hoverChanged = state.hoverEntity !== ref.lastHover;
  const currentHoverObjKey = hoverObjKey(state.hoverObj);
  const hoverObjChanged = currentHoverObjKey !== ref.lastHoverObjKey;
  const sceneChanged = scene !== ref.lastScene;
  const displayModeChanged = state.displayMode !== ref.lastDisplayMode;
  const sectionChanged =
    state.sectionView !== ref.lastSectionView ||
    state.sectionOffset !== ref.lastSectionOffset;
  const sketchPlaneKey = state.sketchMode
    ? `${state.sketchPlaneNormal.join(",")}|${state.sketchPlaneOrigin.join(",")}`
    : "";
  const sketchChanged =
    state.sketchMode !== ref.lastSketchMode ||
    state.sketchPlaneHeight !== ref.lastSketchHeight ||
    sketchPlaneKey !== ref.lastSketchPlaneKey;
  const lowSpecChanged = state.lowSpecMode !== ref.lastLowSpecMode;
  const toolChanged = state.tool !== ref.lastTool;

  if (lowSpecChanged) {
    ref.lastLowSpecMode = state.lowSpecMode;
    ref.renderer.setPixelRatio(
      state.lowSpecMode ? 1 : Math.min(window.devicePixelRatio || 1, 1.5),
    );
    ref.renderer.setSize(ref.host.clientWidth || 800, ref.host.clientHeight || 600);
    ref.renderer.shadowMap.enabled = !state.lowSpecMode;
    ref.renderer.shadowMap.needsUpdate = !state.lowSpecMode;
    ref.groundNode.visible = !state.lowSpecMode;
    ref.sceneRoot.environmentIntensity = state.lowSpecMode ? 0 : 0.35;
    for (const obj of ref.meshObjects) {
      const mat = (obj as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (mat) mat.needsUpdate = true;
    }
    ref.needsRender = true;
  }

  if (sectionChanged) {
    ref.lastSectionView = state.sectionView;
    ref.lastSectionOffset = state.sectionOffset;
    ref.sectionPlane.constant = state.sectionOffset + 15;
    ref.renderer.clippingPlanes = state.sectionView ? [ref.sectionPlane] : [];
    ref.needsRender = true;
  }

  if (sceneChanged || displayModeChanged) {
    ref.lastScene = scene;
    ref.lastDisplayMode = state.displayMode;
    if (scene) rebuildEntities(ref, scene);
    ref.overlayKey = "";
    ref.renderer.shadowMap.needsUpdate = true;
    ref.needsRender = true;
    // A face/edge ref on an entity that is no longer selected is stale.
    const st = useArcStore.getState();
    const faceKept = st.selFace && scene?.selection.includes(st.selFace.entityId);
    const edgeKept = st.selEdge && scene?.selection.includes(st.selEdge.entityId);
    if (st.selKind === "face" && !faceKept) {
      useArcStore.setState({ selKind: "entity", selFace: null, selEdge: null });
    } else if (st.selKind === "edge" && !edgeKept) {
      useArcStore.setState({ selKind: "entity", selFace: null, selEdge: null });
    }
    updateGizmoAttachment(ref);
  } else if (hoverChanged && scene) {
    // Targeted update: only re-present the entities whose hover changed.
    const layers = new Map(
      scene.layers.map(
        (l: LayerData): [string, LayerData] => [l.id, l],
      ),
    );
    for (const id of [ref.lastHover, state.hoverEntity]) {
      if (!id) continue;
      const obj = ref.objects.get(id);
      const entity = scene.entities.find((e) => e.id === id);
      if (obj && entity) present(ref, obj, entity, layers, scene);
    }
    ref.needsRender = true;
  }
  ref.lastHover = state.hoverEntity;
  if (hoverObjChanged) {
    ref.lastHoverObjKey = currentHoverObjKey;
    ref.needsRender = true;
  }
  updateOverlays(ref);

  const settings = state.settings;
  const isCreatingOrSketching =
    state.sketchMode ||
    state.drafting ||
    (state.tool !== "select" &&
      state.tool !== "move" &&
      state.tool !== "rotate" &&
      state.tool !== "scale" &&
      state.tool !== "extrude-face" &&
      state.tool !== "offset-face" &&
      state.tool !== "fillet-edge");
  // Shapr3D behavior: no grid in normal 3D view; grid appears when sketching or creating!
  const gridVis = (settings?.show_grid ?? true) && isCreatingOrSketching;
  const axesVis = settings?.show_axes ?? true;
  const gridSize = settings?.grid_size ?? 2;
  const gridSizeChanged = gridSize !== ref.lastGridSize;
  if (gridSizeChanged) {
    ref.lastGridSize = gridSize;
    const index = ref.sceneRoot.children.indexOf(ref.gridNode);
    const prevPos = ref.gridNode.position.clone();
    const prevQuat = ref.gridNode.quaternion.clone();
    ref.sceneRoot.remove(ref.gridNode);
    disposeObject(ref.gridNode);
    const next = makeGrid(viewportPalette(useThemeStore.getState().active()), gridSize);
    next.visible = gridVis;
    next.position.copy(prevPos);
    next.quaternion.copy(prevQuat);
    if (index >= 0) ref.sceneRoot.children.splice(index, 0, next);
    else ref.sceneRoot.add(next);
    ref.gridNode = next;
    updateScaleBar(ref);
    ref.needsRender = true;
  }
  if (ref.gridNode.visible !== gridVis || sketchChanged || gridSizeChanged) {
    ref.gridNode.visible = gridVis;
    if (state.sketchMode) {
      const n = new THREE.Vector3(...state.sketchPlaneNormal).normalize();
      const quat =
        Math.abs(n.x) < 1e-4 && Math.abs(n.z) < 1e-4 && n.y > 0
          ? new THREE.Quaternion()
          : new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      ref.gridNode.quaternion.copy(quat);
      const dist = new THREE.Vector3(...state.sketchPlaneOrigin).dot(n);
      ref.gridNode.position.copy(n.clone().multiplyScalar(dist));
    } else {
      ref.gridNode.quaternion.identity();
      ref.gridNode.position.set(0, 0, 0);
    }
    ref.lastSketchMode = state.sketchMode;
    ref.lastSketchHeight = state.sketchPlaneHeight;
    ref.lastSketchPlaneKey = sketchPlaneKey;
    ref.needsRender = true;
  }
  if (ref.axes.visible !== axesVis) {
    ref.axes.visible = axesVis;
    ref.needsRender = true;
  }
  if (toolChanged) {
    switchTool(ref, state.tool);
    ref.needsRender = true;
  }
}

/** Replace the hovered/selected face & edge highlight overlays. */
function updateOverlays(ref: ViewportRefs): void {
  const state = useArcStore.getState();
  const scene = state.scene;
  const key = `${scene?.version ?? -1}|${scene?.selection.join(",") ?? ""}|${hoverObjKey(state.hoverObj)}|${state.selKind}|${state.selFace?.entityId ?? ""}/${state.selFace?.face ?? ""}|${state.selEdge?.key ?? ""}`;
  if (key === ref.overlayKey) return;
  ref.overlayKey = key;
  ref.needsRender = true;

  const clear = <T extends THREE.Object3D>(obj: T | null): null => {
    if (obj) {
      ref.entityRoot.remove(obj);
      disposeObject(obj);
    }
    return null;
  };
  ref.hoverOverlay = clear(ref.hoverOverlay);
  ref.selOverlay = clear(ref.selOverlay);
  ref.hoverEdgeOverlay = clear(ref.hoverEdgeOverlay);
  ref.selEdgeOverlay = clear(ref.selEdgeOverlay);
  if (!scene) return;

  const entity = (id: string) => scene.entities.find((e) => e.id === id) ?? null;
  const host = (id: string): THREE.Object3D | null => {
    const obj = ref.objects.get(id);
    if (!obj || !obj.visible) return null;
    return obj;
  };
  const makeFace = (
    entityId: string,
    face: number,
    color: THREE.Color,
    opacity: number,
  ): THREE.Mesh | null => {
    const data = entity(entityId);
    const obj = host(entityId);
    if (!data || !obj) return null;
    const geometry = faceOverlayGeometry(data, face);
    if (!geometry) return null;
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    const overlay = new THREE.Mesh(geometry, material);
    overlay.position.copy(obj.position);
    overlay.quaternion.copy(obj.quaternion);
    overlay.scale.copy(obj.scale);
    overlay.renderOrder = 5;
    ref.entityRoot.add(overlay);
    return overlay;
  };
  const makeEdge = (
    entityId: string,
    segIndex: number,
    color: THREE.Color,
  ): THREE.LineSegments | null => {
    const data = entity(entityId);
    const obj = host(entityId);
    if (!data || !obj) return null;
    const geometry = edgeOverlayGeometry(data, segIndex);
    if (!geometry) return null;
    const material = new THREE.LineBasicMaterial({ color, depthWrite: false });
    const overlay = new THREE.LineSegments(geometry, material);
    overlay.position.copy(obj.position);
    overlay.quaternion.copy(obj.quaternion);
    overlay.scale.copy(obj.scale);
    overlay.renderOrder = 6;
    ref.entityRoot.add(overlay);
    return overlay;
  };

  const hover = state.hoverObj;
  if (hover?.kind === "face" && hover.face != null) {
    ref.hoverOverlay = makeFace(hover.entityId, hover.face, SHAPR_CYAN, 0.32);
  } else if (hover?.kind === "edge" && hover.edge != null) {
    const parts = hover.edge.split(":");
    const seg = Number(parts[parts.length - 1]);
    if (Number.isInteger(seg)) {
      ref.hoverEdgeOverlay = makeEdge(hover.entityId, seg, SHAPR_CYAN);
    }
  }
  if (state.selKind === "face" && state.selFace) {
    ref.selOverlay = makeFace(state.selFace.entityId, state.selFace.face, SHAPR_CYAN, 0.55);
  } else if (state.selKind === "edge" && state.selEdge) {
    const parts = state.selEdge.key.split(":");
    const seg = Number(parts[parts.length - 1]);
    if (Number.isInteger(seg)) {
      ref.selEdgeOverlay = makeEdge(state.selEdge.entityId, seg, SHAPR_CYAN);
    }
  }
}

function switchTool(ref: ViewportRefs, tool: ToolId): void {
  const prev = ref.lastTool ? handlerFor(ref.lastTool) : null;
  prev?.onDeactivate?.(ref.ctx);
  ref.lastTool = tool;
  for (const [tag] of ref.previews) ref.ctx.clearPreview(tag);
  ref.ctx.showMeasure(null);
  const handler = handlerFor(tool);
  const hint = handler?.hint?.(ref.ctx);
  ref.ctx.setStatus(
    hint ?? `Tool: ${TOOL_BY_ID.get(tool)?.label ?? tool}`,
  );
  ref.renderer.domElement.style.cursor = handler?.cursor ?? "";
  handler?.onActivate?.(ref.ctx);
  updateGizmoAttachment(ref);
}

function updateGizmoAttachment(ref: ViewportRefs): void {
  const state = useArcStore.getState();
  const gizmoMode: GizmoMode | null =
    state.tool === "move"
      ? "translate"
      : state.tool === "rotate"
        ? "rotate"
        : state.tool === "scale"
          ? "scale"
          : null;
  if (!gizmoMode) {
    if (ref.tc.object) ref.tc.detach();
    ref.tc.getHelper().visible = false;
    return;
  }
  ref.tc.setMode(gizmoMode);
  const scene = state.scene;
  const primary = scene?.selection[scene.selection.length - 1] ?? null;
  if (!primary) {
    if (ref.tc.object) ref.tc.detach();
    ref.tc.getHelper().visible = false;
    return;
  }
  const entity = scene?.entities.find((e) => e.id === primary);
  if (!entity || entity.locked) {
    if (ref.tc.object) ref.tc.detach();
    ref.tc.getHelper().visible = false;
    return;
  }
  const obj = ref.objects.get(primary);
  if (!obj || !obj.visible) {
    if (ref.tc.object) ref.tc.detach();
    ref.tc.getHelper().visible = false;
    return;
  }
  if (ref.tc.object !== obj) ref.tc.attach(obj);
  ref.tc.getHelper().visible = true;
}

/** Commit the transform the gizmo left on the attached object back to the store. */
function writeBackGizmo(ref: ViewportRefs): void {
  const obj = ref.tc.object as THREE.Object3D | null;
  const docId = activeDoc();
  if (!obj || !docId) return;
  const id = obj.userData.entityId as string | undefined;
  if (!id) return;
  const q = obj.quaternion;
  const transform: Transform = {
    position: [obj.position.x, obj.position.y, obj.position.z],
    rotation: [q.x, q.y, q.z, q.w],
    scale: [obj.scale.x, obj.scale.y, obj.scale.z],
  };
  void ipc
    .setTransform(docId, [{ id, transform }], true)
    .catch(() => undefined);
}

function rebuildEntities(ref: ViewportRefs, scene: SceneData): void {
  const layers = new Map<string, LayerData>(scene.layers.map((l) => [l.id, l]));
  const byId = new Set(scene.entities.map((e) => e.id));
  for (const [id, obj] of ref.objects) {
    if (!byId.has(id)) {
      if (ref.tc.object === obj) ref.tc.detach();
      ref.entityRoot.remove(obj);
      disposeObject(obj);
      ref.objects.delete(id);
    }
  }

  for (const entity of scene.entities) {
    let obj: THREE.Object3D | null | undefined = ref.objects.get(entity.id);
    if (!obj) {
      obj = makeEntityObject(ref, entity);
      if (!obj) continue;
      obj.userData.entityId = entity.id;
      ref.objects.set(entity.id, obj);
      ref.entityRoot.add(obj);
    }
    present(ref, obj, entity, layers, scene);
  }
  ref.meshObjects = Array.from(ref.objects.values()).filter(
    (o) => (o as THREE.Mesh).isMesh === true,
  );
}

function makeDimensionBadge(text: string): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.fillStyle = "rgba(18, 22, 31, 0.88)";
    ctx.beginPath();
    ctx.roundRect(4, 4, 152, 40, 8);
    ctx.fill();
    ctx.strokeStyle = "rgba(33, 179, 237, 0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#e2e8f0";
    ctx.font = "600 20px JetBrains Mono, monospace, system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 80, 25);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(16, 4.8, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function buildClosedSketchFill(lineData: number[], entityId: string, color: THREE.Color): THREE.Mesh | null {
  // lineData is segment pairs: [x0,y0,z0, x1,y1,z1, x1,y1,z1, x2,y2,z2, ...]
  if (lineData.length < 18) return null;
  const nSegs = Math.floor(lineData.length / 6);
  const fx = lineData[0];
  const fy = lineData[1];
  const fz = lineData[2];
  const lx = lineData[(nSegs - 1) * 6 + 3];
  const ly = lineData[(nSegs - 1) * 6 + 4];
  const lz = lineData[(nSegs - 1) * 6 + 5];
  if (Math.hypot(fx - lx, fy - ly, fz - lz) > 0.8) return null;

  const pts3D: THREE.Vector3[] = [new THREE.Vector3(fx, fy, fz)];
  for (let s = 0; s < nSegs; s++) {
    const px = lineData[s * 6 + 3];
    const py = lineData[s * 6 + 4];
    const pz = lineData[s * 6 + 5];
    const v = new THREE.Vector3(px, py, pz);
    if (v.distanceTo(pts3D[pts3D.length - 1]) > 1e-4) {
      pts3D.push(v);
    }
  }
  if (pts3D.length > 3 && pts3D[0].distanceTo(pts3D[pts3D.length - 1]) <= 0.8) {
    pts3D.pop();
  }
  if (pts3D.length < 3) return null;

  // Compute plane normal via Newell's method so horizontal, vertical, and angled faces all work
  const normal = new THREE.Vector3();
  for (let i = 0; i < pts3D.length; i++) {
    const cur = pts3D[i];
    const next = pts3D[(i + 1) % pts3D.length];
    normal.x += (cur.y - next.y) * (cur.z + next.z);
    normal.y += (cur.z - next.z) * (cur.x + next.x);
    normal.z += (cur.x - next.x) * (cur.y + next.y);
  }
  if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
  else normal.normalize();

  const refAxis = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const u = new THREE.Vector3().crossVectors(refAxis, normal).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  const origin = pts3D[0];

  const shape = new THREE.Shape();
  for (let i = 0; i < pts3D.length; i++) {
    const d = pts3D[i].clone().sub(origin);
    const x2 = d.dot(u);
    const y2 = d.dot(v);
    if (i === 0) shape.moveTo(x2, y2);
    else shape.lineTo(x2, y2);
  }
  shape.closePath();

  const geo = new THREE.ShapeGeometry(shape);
  const posAttr = geo.getAttribute("position");
  for (let i = 0; i < posAttr.count; i++) {
    const x2 = posAttr.getX(i);
    const y2 = posAttr.getY(i);
    const p3 = origin
      .clone()
      .addScaledVector(u, x2)
      .addScaledVector(v, y2);
    posAttr.setXYZ(i, p3.x, p3.y, p3.z);
  }
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.26,
    side: THREE.DoubleSide,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const fillMesh = new THREE.Mesh(geo, mat);
  fillMesh.userData.isProfileFill = true;
  fillMesh.userData.entityId = entityId;
  return fillMesh;
}

function buildSketchVertexDots(entity: EntityData): THREE.Points | null {
  const g = entity.geometry;
  const coords: number[] = [];
  if (g.type === "line_curve" && Array.isArray(g.end)) {
    const end = g.end as [number, number, number];
    coords.push(0, 0, 0, end[0], end[1], end[2]);
  } else if (g.type === "polyline_curve" && Array.isArray(g.points)) {
    for (const p of g.points as [number, number, number][]) {
      coords.push(p[0], p[1], p[2]);
    }
  } else if (g.type === "rectangle_curve" && typeof g.width === "number" && typeof g.depth === "number") {
    const hw = g.width / 2;
    const hd = g.depth / 2;
    coords.push(-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd);
  }
  if (coords.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(coords, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xa855f7,
    size: 5,
    sizeAttenuation: false,
    depthTest: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 995;
  pts.userData.isSolidOutline = true; // ignore in raycast
  return pts;
}

function makeEntityObject(ref: ViewportRefs, entity: EntityData): THREE.Object3D | null {
  const tris =
    entity.triPositions && entity.triPositions.length > 0 ? entity.triPositions : null;
  const lineData = entity.lines && entity.lines.length > 0 ? entity.lines : null;
  let obj: THREE.Object3D;
  if (lineData && !tris) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(lineData.slice(), 3));
    const material = ref.lineMaterial.clone();
    obj = new THREE.LineSegments(geometry, material);
    if (entity.category === "sketch") {
      const fill = buildClosedSketchFill(lineData, entity.id, new THREE.Color(0xc8ccd4));
      if (fill) obj.add(fill);
      const dots = buildSketchVertexDots(entity);
      if (dots) obj.add(dots);
    } else if (entity.kind === "dimension" && entity.geometry?.type === "dimension") {
      const s = entity.geometry.start as [number, number, number] | undefined;
      const e = entity.geometry.end as [number, number, number] | undefined;
      if (s && e) {
        const dist = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
        const badge = makeDimensionBadge(`${Math.round(dist * 100) / 100}`);
        badge.position.set((s[0] + e[0]) / 2, Math.max(s[1], e[1]) + 2.5, (s[2] + e[2]) / 2);
        obj.add(badge);
      }
    }
  } else {
    if (!tris) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(tris.slice(), 3));
    if (entity.triNormals && entity.triNormals.length > 0) {
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(entity.triNormals.slice(), 3),
      );
    } else {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingSphere();
    obj = new THREE.Mesh(geometry, ref.columnMaterial.clone());
    obj.castShadow = true;
    obj.receiveShadow = true;

    // Crisp Shapr3D-style dark B-rep feature edge outlines on gray solids
    const edgeGeo = lineData
      ? new THREE.BufferGeometry().setAttribute(
          "position",
          new THREE.Float32BufferAttribute(lineData.slice(), 3),
        )
      : new THREE.EdgesGeometry(geometry, 24);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x0f1013,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
    edgeLines.userData.isSolidOutline = true;
    edgeLines.userData.entityId = entity.id;
    obj.add(edgeLines);
  }
  // Entry animation metadata; present() and the render loop animate from here.
  obj.userData.spawnAt = performance.now();
  obj.userData.realScale = [...entity.transform.scale] as [number, number, number];
  return obj;
}

function present(
  ref: ViewportRefs,
  obj: THREE.Object3D,
  entity: EntityData,
  layers: Map<string, LayerData>,
  scene: SceneData,
): void {
  const layer = layers.get(entity.layer);
  const selected = scene.selection.includes(entity.id);
  // A face/edge hover highlights the subreference only, not the whole entity.
  const st = useArcStore.getState();
  const subHover =
    st.hoverObj !== null && st.hoverObj.entityId === entity.id && st.hoverObj.kind !== "entity";
  const hovered = st.hoverEntity === entity.id && !subHover;
  const color = entityColor(entity, layers);
  const colorHex = color.getHex();
  const visible = entity.visible && layerVisible(layer);
  const material = MATERIALS.find((m) => m.id === entity.material) ?? null;
  const displayMode = st.displayMode;

  // Cheap diff: skip material/transform churn when nothing changed.
  const pos = entity.transform.position;
  const rot = entity.transform.rotation;
  const scl = entity.transform.scale;
  const cache = obj.userData.cache as
    | {
        color: number;
        selected: boolean;
        hovered: boolean;
        locked: boolean;
        visible: boolean;
        material: string | null;
        displayMode: "shaded" | "wireframe";
        pos: [number, number, number];
        rot: [number, number, number, number];
        scl: [number, number, number];
      }
    | undefined;
  const dirty =
    !cache ||
    cache.color !== colorHex ||
    cache.selected !== selected ||
    cache.hovered !== hovered ||
    cache.locked !== entity.locked ||
    cache.visible !== visible ||
    cache.material !== entity.material ||
    cache.displayMode !== displayMode ||
    cache.pos[0] !== pos[0] ||
    cache.pos[1] !== pos[1] ||
    cache.pos[2] !== pos[2] ||
    cache.rot[0] !== rot[0] ||
    cache.rot[1] !== rot[1] ||
    cache.rot[2] !== rot[2] ||
    cache.rot[3] !== rot[3] ||
    cache.scl[0] !== scl[0] ||
    cache.scl[1] !== scl[1] ||
    cache.scl[2] !== scl[2];
  if (cache && !dirty) {
    if (obj.userData.spawnAt !== undefined) {
      applySpawnScale(obj, performance.now());
    }
    return;
  }
  obj.userData.cache = {
    color: colorHex,
    selected,
    hovered,
    locked: entity.locked,
    visible,
    material: entity.material ?? null,
    displayMode,
    pos: [...pos] as [number, number, number],
    rot: [...rot] as [number, number, number, number],
    scl: [...scl] as [number, number, number],
  };

  // While the gizmo drags this object, the object owns its transform; the
  // write-back on drag end brings the store back in sync.
  const gizmoHeld = ref.gizmoDragging && ref.tc.object === obj;
  if (!gizmoHeld) {
    obj.position.set(...entity.transform.position);
    obj.quaternion.set(...entity.transform.rotation);
    obj.userData.realScale = [...entity.transform.scale] as [number, number, number];
    const spawnAt = obj.userData.spawnAt as number | undefined;
    if (spawnAt === undefined) {
      obj.scale.set(...entity.transform.scale);
    } else {
      applySpawnScale(obj, performance.now());
    }
  }
  obj.visible = visible;
  obj.updateMatrix();

  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    mat.wireframe = displayMode === "wireframe";
    if (material) {
      mat.roughness = material.roughness;
      mat.metalness = material.metalness;
    } else {
      mat.roughness = 0.5;
      mat.metalness = 0.05;
    }
    if (entity.locked) mat.opacity = 0.55;
    else mat.opacity = material?.transparent ? 0.55 : 1.0;
    mat.transparent = entity.locked || !!material?.transparent;
    const wholeBodySelected = selected && st.selKind === "entity";
    mat.emissive.copy(
      wholeBodySelected ? SHAPR_CYAN : hovered ? SHAPR_CYAN : BLACK,
    );
    mat.emissiveIntensity = wholeBodySelected ? 0.12 : hovered ? 0.06 : 0;
  } else if ((obj as THREE.Line).isLine) {
    const mat = (obj as THREE.Line).material as THREE.LineBasicMaterial;
    mat.color.copy(selected ? SHAPR_CYAN : hovered ? SHAPR_CYAN : SKETCH_LINE_COLOR);
    mat.opacity = entity.locked ? 0.5 : 1;
    mat.transparent = entity.locked;
    for (const child of obj.children) {
      if (child.userData.isProfileFill) {
        const fillMat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        fillMat.color.copy(selected || hovered ? SHAPR_CYAN : SKETCH_FILL_GRAY);
        fillMat.opacity = selected ? 0.45 : hovered ? 0.35 : 0.25;
      }
    }
  }
}

/** Ease the object from zero scale to its real scale during the spawn window. */
function applySpawnScale(obj: THREE.Object3D, now: number): void {
  const spawnAt = obj.userData.spawnAt as number;
  const realScale = obj.userData.realScale as [number, number, number];
  const t = Math.min(1, (now - spawnAt) / SPAWN_DURATION);
  const k = t * t * (3 - 2 * t); // smoothstep
  obj.scale.set(realScale[0] * k, realScale[1] * k, realScale[2] * k);
  if (t >= 1) delete obj.userData.spawnAt;
}

const BLACK = new THREE.Color(0x000000);
const SHAPR_CYAN = new THREE.Color(0x28b5f5);
const SKETCH_FILL_GRAY = new THREE.Color(0xc8ccd4);
const SKETCH_LINE_COLOR = new THREE.Color(0x1f2329);
const SPAWN_DURATION = 220;

function layerVisible(layer: LayerData | undefined): boolean {
  return !(layer && !layer.visible);
}

// Shared scratch object to avoid per-entity allocations.
const scratchColor = new THREE.Color();

function entityColor(entity: EntityData, layers: Map<string, LayerData>): THREE.Color {
  const color = entity.color ?? layers.get(entity.layer)?.color ?? DEFAULT_ENTITY_COLOR;
  return scratchColor.setRGB(color[0], color[1], color[2]);
}

const DEFAULT_ENTITY_COLOR: [number, number, number, number] = [0.62, 0.62, 0.65, 1];

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((node) => {
    const mesh = node as THREE.Mesh & { geometry?: THREE.BufferGeometry; material?: unknown };
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => (item as { dispose?: () => void }).dispose?.());
    } else if (material) {
      (material as { dispose?: () => void }).dispose?.();
    }
  });
}

// ------------------------------------------------------------- context menu

function closeContextMenu(): void {
  useArcStore.getState().closeContextMenu();
}

function openContextMenu(ref: ViewportRefs, hostX: number, hostY: number, items: MenuItem[]): void {
  void ref;
  useArcStore.getState().openContextMenu(
    hostX,
    hostY,
    items.map((item) => ({ label: item.label, run: item.run, disabled: item.disabled })),
  );
}


function onContextMenu(ref: ViewportRefs, event: MouseEvent): void {
  event.preventDefault();
  // A right-drag was orbit/pan navigation, not a click: just suppress the menu.
  const press = ref.contextPress;
  ref.contextPress = null;
  if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) return;
  const scene = useArcStore.getState().scene;
  const docId = activeDoc();
  if (!scene || !docId) {
    closeContextMenu();
    return;
  }
  const pt = ndcPoint(event);
  const faceHit = pickFaceAt(ref, pt, scene);
  const edgeHit = pickEdgeAt(ref, pt, scene, 8, faceHit);
  const hitId = edgeHit?.entityId ?? faceHit?.entityId ?? pickEntityAt(ref, pt);
  const hostRect = ref.host.getBoundingClientRect();
  const x = event.clientX - hostRect.left;
  const y = event.clientY - hostRect.top;
  if (hitId) {
    const entity = scene.entities.find((e) => e.id === hitId) ?? null;
    if (!scene.selection.includes(hitId)) void ipc.setSelection(docId, [hitId], hitId);
    const selectedCount = scene.selection.includes(hitId) ? scene.selection.length : 1;

    const topItems: MenuItem[] = [];
    if (edgeHit) {
      useArcStore.getState().setSelectionRef({
        entityId: edgeHit.entityId,
        kind: "edge",
        face: null,
        edge: edgeHit.key,
        point: edgeHit.point,
        normal: [0, 0, 0],
      });
      topItems.push(
        {
          label: "Fillet Edge (F)",
          run: () => useArcStore.getState().setTool("fillet-edge"),
        },
        {
          label: "Chamfer Edge (45° · 2 cm)",
          run: () => void actions.chamferSelectedEdge(2),
        },
      );
    } else if (faceHit) {
      useArcStore.getState().setSelectionRef({
        entityId: faceHit.entityId,
        kind: "face",
        face: faceHit.faceIndex,
        edge: null,
        point: faceHit.point,
        normal: faceHit.normal,
      });
      topItems.push(
        {
          label: "Extrude / Push-Pull Face (E)",
          run: () => useArcStore.getState().setTool("extrude-face"),
        },
        {
          label: "Offset Face",
          run: () => useArcStore.getState().setTool("offset-face"),
        },
        {
          label: "Shell / Hollow Solid (2 cm)",
          run: () => void actions.shellSelection(2),
        },
        {
          label: "Sketch on this Face",
          run: () => {
            if (!entity) return;
            const info = facePlaneInfo(entity, faceHit.faceIndex);
            useArcStore.getState().enterSketchMode({
              height: info.height,
              origin: info.origin,
              normal: info.normal,
              label: info.label,
              tool: "rectangle",
            });
            window.dispatchEvent(
              new CustomEvent("arc-focus-plane", { detail: { normal: info.normal } }),
            );
          },
        },
      );
    } else if (entity?.category === "sketch") {
      topItems.push(
        {
          label: "Extrude Profile (E)",
          run: () => useArcStore.getState().setTool("extrude"),
        },
        {
          label: "Revolve Profile (V)",
          run: () => useArcStore.getState().setTool("revolve"),
        },
        {
          label: "Offset Sketch (O)",
          run: () => useArcStore.getState().setTool("offset"),
        },
      );
    }

    openContextMenu(ref, x, y, [
      ...topItems,
      { label: "Delete", run: () => void actions.deleteSelection() },
      { label: "Duplicate", run: () => void actions.duplicateSelection() },
      { label: "Linear Pattern (3× X)", run: () => void actions.linearPattern({ count: 3, spacing: 30, axis: "x" }) },
      { label: "Circular Pattern (6× Y)", run: () => void actions.circularPattern({ count: 6, angleDeg: 360, axis: "y" }) },
      { label: "Fit view", run: () => actions.fitView() },
      { label: "Boolean union", disabled: selectedCount < 2, run: () => void actions.booleanApply("union") },
      {
        label: "Boolean difference",
        disabled: selectedCount < 2,
        run: () => void actions.booleanApply("difference"),
      },
      {
        label: "Boolean intersection",
        disabled: selectedCount < 2,
        run: () => void actions.booleanApply("intersection"),
      },
      {
        label: "Materials…",
        run: () => window.dispatchEvent(new CustomEvent("arc-materials-toggle", { detail: true })),
      },
    ]);
    return;
  }
  openContextMenu(ref, x, y, [
    { label: "Fit view", run: () => actions.fitView() },
    { label: "Undo", run: () => void actions.undo() },
    { label: "Redo", run: () => void actions.redo() },
  ]);
}

// -------------------------------------------------------------- interaction

function ndcPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
  };
}

function rayAt(ref: ViewportRefs, point: { x: number; y: number }): THREE.Ray {
  ref.raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), ref.camera);
  return ref.raycaster.ray.clone();
}

function pointOnHorizontalPlane(ray: THREE.Ray, height: number): THREE.Vector3 | null {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
  const out = new THREE.Vector3();
  const hit = ray.intersectPlane(plane, out);
  return hit ? out : null;
}

function pickFaceAt(
  ref: ViewportRefs,
  point: { x: number; y: number },
  scene: SceneData | null,
): FaceHit | null {
  if (!scene || ref.meshObjects.length === 0) return null;
  ref.raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), ref.camera);

  // If a closed sketch profile face (`isProfileFill`) lies in front of or coplanar
  // with the solid face, let `pickEntityAt` select the sketch profile instead!
  let closestSketchFillDist = Infinity;
  for (const obj of ref.objects.values()) {
    if (!obj.visible) continue;
    for (const child of obj.children) {
      if (child.userData.isProfileFill) {
        const fillHits = ref.raycaster.intersectObject(child, false);
        if (fillHits.length > 0 && fillHits[0].distance < closestSketchFillDist) {
          closestSketchFillDist = fillHits[0].distance;
        }
      }
    }
  }

  const hits = ref.raycaster.intersectObjects(ref.meshObjects, false);
  for (const hit of hits) {
    if (!hit.object.visible || !hit.face) continue;
    if (closestSketchFillDist <= hit.distance + 0.6) return null;
    const entity = scene.entities.find((e) => e.id === hit.object.userData.entityId);
    if (!entity || entity.locked) continue;
    const tags = entity.triFaceIds;
    if (!tags || tags.length === 0) continue;
    const tri = hit.faceIndex ?? -1;
    if (tri < 0 || tri >= tags.length) continue;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldN = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
    return {
      entityId: entity.id,
      faceIndex: tags[tri],
      distance: hit.distance,
      point: [hit.point.x, hit.point.y, hit.point.z],
      normal: [worldN.x, worldN.y, worldN.z],
    };
  }
  return null;
}

function pickEdgeAt(
  ref: ViewportRefs,
  point: { x: number; y: number },
  scene: SceneData | null,
  thresholdPx = 8,
  precomputedFaceHit?: FaceHit | null,
): EdgeHit | null {
  if (!scene) return null;
  const hostRect = ref.host.getBoundingClientRect();
  const mousePx = {
    x: (point.x * 0.5 + 0.5) * hostRect.width,
    y: (-point.y * 0.5 + 0.5) * hostRect.height,
  };
  const faceHit =
    precomputedFaceHit !== undefined ? precomputedFaceHit : pickFaceAt(ref, point, scene);
  let bestHit: EdgeHit | null = null;
  let bestScreenDist = thresholdPx;

  for (const entity of scene.entities) {
    if (!entity.visible || entity.locked || !entity.lines || entity.lines.length < 6) continue;
    if (entity.category === "sketch") continue;
    const obj = ref.objects.get(entity.id);
    if (!obj || !obj.visible) continue;
    const seg = pickEdgeScreen(entity, obj, ref.camera, mousePx, hostRect, bestScreenDist);
    if (!seg) continue;
    // Reject back-facing edges that are occluded behind the hit front face.
    if (faceHit) {
      const edgeCamDist = seg.point.distanceTo(ref.camera.position);
      if (edgeCamDist > faceHit.distance + Math.max(3, faceHit.distance * 0.04)) {
        continue;
      }
    }
    bestScreenDist = seg.distance;
    bestHit = {
      entityId: entity.id,
      segIndex: seg.segIndex,
      key: `${entity.id}:${seg.segIndex}`,
      distance: seg.distance,
      point: [seg.point.x, seg.point.y, seg.point.z],
    };
  }
  return bestHit;
}

function pickEntityAt(
  ref: ViewportRefs,
  point: { x: number; y: number },
): string | null {
  ref.raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), ref.camera);
  const hits = ref.raycaster.intersectObjects(Array.from(ref.objects.values()), true);
  for (const candidate of hits) {
    if (!candidate.object.visible) continue;
    if (candidate.object.userData.isSolidOutline) continue;
    const id =
      (candidate.object.userData.entityId as string | undefined) ??
      (candidate.object.parent?.userData.entityId as string | undefined);
    if (id) return id;
  }
  return null;
}

function snapCoord(value: number, gridSize: number, enabled: boolean): number {
  return enabled ? Math.round(value / gridSize) * gridSize : value;
}

// --------------------------------------------------------------- marquee

function startMarquee(ref: ViewportRefs, event: PointerEvent): void {
  const hostRect = ref.host.getBoundingClientRect();
  ref.marquee = {
    x0: event.clientX - hostRect.left,
    y0: event.clientY - hostRect.top,
    additive: event.shiftKey,
  };
  const accent = ref.palette.selection;
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.zIndex = "40";
  el.style.pointerEvents = "none";
  el.style.display = "none";
  el.style.border = `1px solid #${accent.getHexString()}`;
  el.style.backgroundColor = `rgba(${Math.round(accent.r * 255)}, ${Math.round(accent.g * 255)}, ${Math.round(accent.b * 255)}, 0.12)`;
  el.style.borderRadius = "1px";
  ref.host.appendChild(el);
  ref.marqueeEl = el;
  try {
    ref.renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // ignore
  }
}

function moveMarquee(ref: ViewportRefs, event: PointerEvent): void {
  const marquee = ref.marquee;
  const el = ref.marqueeEl;
  if (!marquee || !el) return;
  const hostRect = ref.host.getBoundingClientRect();
  const x = event.clientX - hostRect.left;
  const y = event.clientY - hostRect.top;
  el.style.display = "block";
  el.style.left = `${Math.min(marquee.x0, x)}px`;
  el.style.top = `${Math.min(marquee.y0, y)}px`;
  el.style.width = `${Math.abs(x - marquee.x0)}px`;
  el.style.height = `${Math.abs(y - marquee.y0)}px`;
}

function cancelMarquee(ref: ViewportRefs): void {
  if (ref.marqueeEl) {
    ref.marqueeEl.remove();
    ref.marqueeEl = null;
  }
  ref.marquee = null;
}

function finishMarquee(ref: ViewportRefs, event: PointerEvent): void {
  const marquee = ref.marquee;
  const el = ref.marqueeEl;
  cancelMarquee(ref);
  if (!marquee) return;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    // pointer may already be released
  }
  if (el === null) return;
  const hostRect = ref.host.getBoundingClientRect();
  const x1 = Math.min(marquee.x0, event.clientX - hostRect.left);
  const y1 = Math.min(marquee.y0, event.clientY - hostRect.top);
  const x2 = Math.max(marquee.x0, event.clientX - hostRect.left);
  const y2 = Math.max(marquee.y0, event.clientY - hostRect.top);

  // Tiny drag: plain click in empty space keeps the existing deselect behavior.
  if (x2 - x1 < 4 && y2 - y1 < 4) {
    if (!marquee.additive) void ipc.setSelection(activeDoc(), [], null);
    return;
  }

  const scene = useArcStore.getState().scene;
  if (!scene) return;
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const ids = marquee.additive ? [...scene.selection] : [];
  for (const [entityId, obj] of ref.objects) {
    if (!obj.visible) continue;
    _bbox.setFromObject(obj);
    if (_bbox.isEmpty()) continue;
    // Skip anything behind the camera; projection is unreliable there.
    const center = _bbox.getCenter(new THREE.Vector3());
    const depth = center.clone().project(ref.camera);
    if (depth.z > 1 || depth.z < -1) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    corners[0].set(_bbox.max.x, _bbox.max.y, _bbox.max.z);
    corners[1].set(_bbox.max.x, _bbox.max.y, _bbox.min.z);
    corners[2].set(_bbox.max.x, _bbox.min.y, _bbox.max.z);
    corners[3].set(_bbox.max.x, _bbox.min.y, _bbox.min.z);
    corners[4].set(_bbox.min.x, _bbox.max.y, _bbox.max.z);
    corners[5].set(_bbox.min.x, _bbox.max.y, _bbox.min.z);
    corners[6].set(_bbox.min.x, _bbox.min.y, _bbox.max.z);
    corners[7].set(_bbox.min.x, _bbox.min.y, _bbox.min.z);
    for (const corner of corners) {
      corner.project(ref.camera);
      const sx = (corner.x * 0.5 + 0.5) * hostRect.width;
      const sy = (-corner.y * 0.5 + 0.5) * hostRect.height;
      if (sx < minX) minX = sx;
      if (sy < minY) minY = sy;
      if (sx > maxX) maxX = sx;
      if (sy > maxY) maxY = sy;
    }
    if (maxX < x1 || minX > x2 || maxY < y1 || minY > y2) continue;
    if (!ids.includes(entityId)) ids.push(entityId);
  }
  void ipc.setSelection(activeDoc(), ids, ids[ids.length - 1] ?? null);
  useArcStore.getState().setStatusMessage(`${ids.length} selected`);
  useArcStore.getState().setDrafting(false);
}

function attachHandlers(ref: ViewportRefs): () => void {
  const el = ref.renderer.domElement;
  const ctx = ref.ctx;

  const down = (event: PointerEvent) => {
    ref.viewAnim = null;
    if (event.button === 2) {
      ref.contextPress = { x: event.clientX, y: event.clientY };
    }
    if (event.button !== 0) return;
    // Check the 3D ViewCube gizmo first so clicks/drags on it navigate the camera.
    const w = ref.host.clientWidth;
    const h = ref.host.clientHeight;
    if (ref.gizmo.onPointerDown(event, w, h, ref.controls.target, ref.camera)) {
      return;
    }
    // The move/rotate/scale gizmo owns its own pointer stream while hovered/dragging.
    if (ref.gizmoDragging || ref.tc.axis) {
      if (useArcStore.getState().hoverEntity) useArcStore.getState().setHoverEntity(null);
      return;
    }
    const handler = handlerFor(useArcStore.getState().tool);
    const consumed = handler?.onPointerDown?.(event, ctx) ?? false;
    syncDrafting(ref);
    if (!consumed && !handler) {
      // No handler (should not happen): fall back to marquee selection.
      if (useArcStore.getState().scene) startMarquee(ref, event);
    }
  };
  const move = (event: PointerEvent) => {
    const store = useArcStore.getState();
    const w = ref.host.clientWidth;
    const h = ref.host.clientHeight;
    if (ref.gizmo.onPointerMove(event, w, h, ref.controls.target, ref.camera)) {
      ref.needsRender = true;
      if (store.hoverEntity || store.hoverObj) store.setHoverEntity(null);
      return;
    }
    if (ref.marquee) {
      moveMarquee(ref, event);
      return;
    }
    if (ref.gizmoDragging || ref.tc.axis) {
      if (store.hoverEntity) store.setHoverEntity(null);
      return;
    }
    if (store.scene) {
      const now = performance.now();
      const handler = handlerFor(store.tool);
      // Throttle hover picking on laptops (~40Hz max) and skip while orbiting/panning.
      if (
        event.buttons === 0 &&
        now - ref.lastHoverAt >= 24 &&
        handler &&
        (store.tool === "select" ||
          store.tool === "move" ||
          store.tool === "rotate" ||
          store.tool === "scale")
      ) {
        ref.lastHoverAt = now;
        const point = ndcPoint(event);
        // Single-pass face hit shared with edge occlusion test.
        const face = pickFaceAt(ref, point, store.scene);
        const edge = pickEdgeAt(ref, point, store.scene, 7, face);
        if (edge) {
          store.setHoverObj({
            entityId: edge.entityId,
            kind: "edge",
            face: null,
            edge: edge.key,
            point: edge.point,
            normal: [0, 0, 0],
          });
        } else if (face) {
          store.setHoverObj({
            entityId: face.entityId,
            kind: "face",
            face: face.faceIndex,
            edge: null,
            point: face.point,
            normal: face.normal,
          });
        } else {
          const id = pickEntityAt(ref, point);
          if (id !== store.hoverEntity || store.hoverObj !== null) {
            store.setHoverEntity(id);
          }
        }
      }
      if (now - ref.lastCursorAt > 80) {
        ref.lastCursorAt = now;
        const ray = rayAt(ref, ndcPoint(event));
        let world: THREE.Vector3 | null = null;
        if (store.sketchMode) {
          const n = new THREE.Vector3(...store.sketchPlaneNormal).normalize();
          const o = new THREE.Vector3(...store.sketchPlaneOrigin);
          const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
          const out = new THREE.Vector3();
          world = ray.intersectPlane(plane, out);
        } else {
          world = pointOnHorizontalPlane(ray, 0);
        }
        if (world) store.setCursorWorld([world.x, world.y, world.z]);
      }
    }
    handlerFor(store.tool)?.onPointerMove?.(event, ctx);
    syncDrafting(ref);
  };
  const up = (event: PointerEvent) => {
    const w = ref.host.clientWidth;
    const h = ref.host.clientHeight;
    if (ref.gizmo.onPointerUp(event, w, h)) {
      return;
    }
    if (ref.marquee) {
      finishMarquee(ref, event);
      return;
    }
    if (ref.gizmoDragging) return;
    handlerFor(useArcStore.getState().tool)?.onPointerUp?.(event, ctx);
    syncDrafting(ref);
  };
  const cancel = (event: PointerEvent) => {
    if (ref.marquee) {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      cancelMarquee(ref);
    }
    const handler = handlerFor(useArcStore.getState().tool);
    handler?.onCancel?.(ctx);
    syncDrafting(ref);
  };
  const dbl = (event: MouseEvent) => {
    const handler = handlerFor(useArcStore.getState().tool);
    if (handler?.onDoubleClick?.(event, ctx)) return;
    const id = pickEntityAt(ref, ndcPoint(event));
    if (id) fitEntities(ref, [id]);
    else fitSelection(ref);
  };
  const ctx_ = (event: MouseEvent) => onContextMenu(ref, event);
  const wheel = () => {
    ref.viewAnim = null;
  };

  const draftCancel = () => {
    const handler = handlerFor(useArcStore.getState().tool);
    handler?.onCancel?.(ctx);
    const still = handler?.hasActivity?.(ctx) ?? false;
    if (still) {
      useArcStore.getState().setDrafting(true);
      return;
    }
    syncDrafting(ref);
    const stop = useArcStore.getState();
    if (stop.tool !== "select") {
      stop.setTool("select");
    }
  };
  const draftEnter = () => {
    const consumed = handlerFor(useArcStore.getState().tool)?.onEnter?.(ctx) ?? false;
    syncDrafting(ref);
    if (!consumed) {
      useArcStore.getState().setStatusMessage(
        "Nothing to finish · add more points or press Esc",
      );
    }
  };
  const draftBackspace = () => {
    handlerFor(useArcStore.getState().tool)?.onBackspace?.(ctx);
    syncDrafting(ref);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (uiCapture.active) return;
    const target = event.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const store = useArcStore.getState();
    if (
      store.view !== "editor" ||
      store.paletteOpen ||
      store.commandLineOpen ||
      store.settingsOpen ||
      store.startupOpen ||
      store.onboardingOpen
    ) {
      return;
    }
    const handler = handlerFor(store.tool);
    if (handler?.onKey?.(event, ctx)) {
      event.preventDefault();
      event.stopPropagation();
      syncDrafting(ref);
    }
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("dblclick", dbl);
  el.addEventListener("wheel", wheel, { passive: true });
  el.addEventListener("contextmenu", ctx_);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("arc-draft-cancel", draftCancel);
  window.addEventListener("arc-draft-enter", draftEnter);
  window.addEventListener("arc-draft-backspace", draftBackspace);

  const fit = () => fitSelection(ref);
  window.addEventListener("arc-fit-view", fit);
  const focus = (event: Event) => {
    const id = (event as CustomEvent<{ entityId?: string }>).detail?.entityId;
    if (id) fitEntities(ref, [id]);
  };
  window.addEventListener("arc-focus-entity", focus);
  const focusPlaneEv = (event: Event) => {
    const n = (event as CustomEvent<{ normal?: [number, number, number] }>).detail?.normal ?? [0, 1, 0];
    focusPlane(ref, new THREE.Vector3(n[0], n[1], n[2]));
  };
  window.addEventListener("arc-focus-plane", focusPlaneEv);

  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("dblclick", dbl);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("contextmenu", ctx_);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("arc-draft-cancel", draftCancel);
    window.removeEventListener("arc-draft-enter", draftEnter);
    window.removeEventListener("arc-draft-backspace", draftBackspace);
    window.removeEventListener("arc-fit-view", fit);
    window.removeEventListener("arc-focus-entity", focus);
    window.removeEventListener("arc-focus-plane", focusPlaneEv);
  };
}

/** Keep the drafting flag in step with the active tool's pending input. */
function syncDrafting(ref: ViewportRefs): void {
  const store = useArcStore.getState();
  const handler = handlerFor(store.tool);
  const active = handler?.hasActivity?.(ref.ctx) ?? false;
  if (store.drafting !== active) store.setDrafting(active);
}

function activeDoc(): string {
  return useArcStore.getState().overview?.active ?? "";
}

// ---------------------------------------------------------------- tool ctx

function makeToolContext(ref: ViewportRefs): ToolContext {
  const paletteInView = (): ViewPalette => ref.palette;
  const settingsInView = () => {
    const st = useArcStore.getState();
    const settings = st.settings;
    const isImperial = settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";
    return {
      gridSize: settings?.grid_size ?? 2,
      snapEnabled: settings?.snap_enabled ?? true,
      dimSnapStep: st.dimSnapStep ?? 1,
      unitLabel: isImperial ? "in" : "cm",
    };
  };

  return {
    camera: ref.camera,
    host: ref.host,
    get palette() {
      return paletteInView();
    },
    get settings() {
      return settingsInView();
    },

    scene: () => useArcStore.getState().scene,
    entityById(id) {
      return useArcStore.getState().scene?.entities.find((e) => e.id === id) ?? null;
    },
    objectFor(id) {
      return ref.objects.get(id) ?? null;
    },
    objectsSnapshot: () => Array.from(ref.objects.values()),
    selection: () => useArcStore.getState().scene?.selection ?? [],
    docId: activeDoc,

    planePoint(event, height) {
      const st = useArcStore.getState();
      if (height === undefined && st.sketchMode) {
        const n = new THREE.Vector3(...st.sketchPlaneNormal).normalize();
        const o = new THREE.Vector3(...st.sketchPlaneOrigin);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
        const out = new THREE.Vector3();
        return rayAt(ref, ndcPoint(event)).intersectPlane(plane, out);
      }
      const h = height ?? (st.sketchMode ? st.sketchPlaneHeight : 0);
      return pointOnHorizontalPlane(rayAt(ref, ndcPoint(event)), h);
    },
    rayAt(event) {
      return rayAt(ref, ndcPoint(event));
    },
    pickEntity(event) {
      return pickEntityAt(ref, ndcPoint(event));
    },
    pickFace(event) {
      return pickFaceAt(ref, ndcPoint(event), useArcStore.getState().scene);
    },
    pickEdge(event, thresholdPx = 8) {
      return pickEdgeAt(ref, ndcPoint(event), useArcStore.getState().scene, thresholdPx);
    },
    setSelectionRef(obj) {
      useArcStore.getState().setSelectionRef(obj);
    },
    screenPoint(event) {
      const rect = ref.host.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },
    worldToScreen(p) {
      const rect = ref.host.getBoundingClientRect();
      const projected = p.clone().project(ref.camera);
      if (projected.z < -1 || projected.z > 1) return null;
      return {
        x: (projected.x * 0.5 + 0.5) * rect.width,
        y: (-projected.y * 0.5 + 0.5) * rect.height,
      };
    },

    snap(world, opts) {
      const { gridSize, snapEnabled } = settingsInView();
      const showSnapMarker = (pt: THREE.Vector3 | null, kind?: string) => {
        if (!pt || !kind || kind === "grid") {
          ref.ctx.clearPreview("snap-marker");
          return;
        }
        const radius = Math.max(0.6, ref.camera.position.distanceTo(pt) * 0.008);
        const color =
          kind === "midpoint"
            ? 0x10b981
            : kind === "center" || kind === "origin"
              ? 0xf59e0b
              : 0x22d3ee;
        const ringGeo = new THREE.RingGeometry(radius * 0.55, radius, 20);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color,
          side: THREE.DoubleSide,
          depthTest: false,
          transparent: true,
          opacity: 0.95,
        });
        const marker = new THREE.Mesh(ringGeo, ringMat);
        marker.position.set(pt.x, pt.y + 0.05, pt.z);
        marker.renderOrder = 999;
        ref.ctx.setPreview(marker, "snap-marker");
      };

      if (opts?.grid === false) {
        showSnapMarker(null);
        return { point: world.clone(), kind: "grid" };
      }
      const camDistance = ref.camera.position.distanceTo(world);
      const tolerance = Math.max(gridSize * 0.3, camDistance * 0.004);

      const origin = new THREE.Vector3(0, world.y, 0);
      if (world.distanceTo(origin) <= tolerance) {
        showSnapMarker(origin, "origin");
        return { point: origin.clone(), kind: "origin" };
      }

      // Check sketch & solid vertices, midpoints, and centers BEFORE axis lines!
      const endpointTolerance = tolerance * 2.2;
      let best: THREE.Vector3 | null = null;
      let bestKind: "endpoint" | "midpoint" | "center" = "endpoint";
      let bestDist = endpointTolerance;
      const scene = useArcStore.getState().scene;
      if (scene && snapEnabled) {
        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const mid = new THREE.Vector3();
        for (const entity of scene.entities) {
          if (!entity.visible) continue;
          const obj = ref.objects.get(entity.id);
          if (!obj || !obj.visible) continue;
          obj.updateMatrixWorld();

          // Check entity center projected to active plane
          const centerPt = new THREE.Vector3(
            entity.transform.position[0],
            world.y,
            entity.transform.position[2],
          );
          const centerDist = centerPt.distanceTo(world);
          if (centerDist <= bestDist * 0.85) {
            bestDist = centerDist;
            best = centerPt;
            bestKind = "center";
          }

          const pts = entity.lines;
          if (!pts || pts.length < 3) continue;
          // Segment endpoints & midpoints (pts are pairs of 3D vertices: 6 floats per segment)
          for (let i = 0; i + 5 < pts.length; i += 6) {
            vA.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(obj.matrixWorld);
            vB.set(pts[i + 3], pts[i + 4], pts[i + 5]).applyMatrix4(obj.matrixWorld);
            const dA = vA.distanceTo(world);
            if (dA <= bestDist) {
              bestDist = dA;
              best = vA.clone();
              bestKind = "endpoint";
            }
            const dB = vB.distanceTo(world);
            if (dB <= bestDist) {
              bestDist = dB;
              best = vB.clone();
              bestKind = "endpoint";
            }
            // Midpoint of segment
            mid.copy(vA).add(vB).multiplyScalar(0.5);
            const dMid = mid.distanceTo(world);
            if (dMid <= bestDist * 0.9) {
              bestDist = dMid;
              best = mid.clone();
              bestKind = "midpoint";
            }
          }
          if (bestDist < tolerance * 0.4) break;
        }
      }
      if (best) {
        showSnapMarker(best, bestKind);
        return { point: best, kind: bestKind };
      }

      if (Math.abs(world.z) <= tolerance) {
        const pt = new THREE.Vector3(snapCoord(world.x, gridSize, snapEnabled), world.y, 0);
        showSnapMarker(pt, "axis");
        return { point: pt, kind: "axis" };
      }
      if (Math.abs(world.x) <= tolerance) {
        const pt = new THREE.Vector3(0, world.y, snapCoord(world.z, gridSize, snapEnabled));
        showSnapMarker(pt, "axis");
        return { point: pt, kind: "axis" };
      }

      showSnapMarker(null);
      return {
        point: new THREE.Vector3(
          snapCoord(world.x, gridSize, snapEnabled),
          snapCoord(world.y, gridSize, snapEnabled),
          snapCoord(world.z, gridSize, snapEnabled),
        ),
        kind: "grid",
      };
    },
    snapGrid(v) {
      const { gridSize, snapEnabled } = settingsInView();
      return new THREE.Vector3(
        snapCoord(v.x, gridSize, snapEnabled),
        snapCoord(v.y, gridSize, snapEnabled),
        snapCoord(v.z, gridSize, snapEnabled),
      );
    },
    snapDim(value, fine = false) {
      const { snapEnabled, dimSnapStep } = settingsInView();
      const step = fine ? 0.1 : snapEnabled ? dimSnapStep : 0;
      if (step <= 0) return Math.round(value * 100) / 100;
      const snapped = Math.round(value / step) * step;
      if (value > 0 && snapped <= 0) return step;
      return Math.round(snapped * 100) / 100;
    },

    createEntity(geometry, position, name) {
      const docId = activeDoc();
      if (!docId) return Promise.resolve(null);
      ref.lastCommitAt = performance.now();
      return ipc
        .createEntity(docId, geometry, name)
        .then(({ id }) => {
          const needsPlace =
            position[0] !== 0 || position[1] !== 0 || position[2] !== 0;
          const placed = needsPlace
            ? ipc
                .setTransform(docId, [{ id, transform: makeTransformFromPosition(id, position) }], true)
                .catch(() => undefined)
            : Promise.resolve();
          return placed
            .then(() => ipc.setSelection(docId, [id], id))
            .then(() => id)
            .catch(() => id);
        })
        .catch(() => null);
    },
    updateGeometry(id, geometry) {
      const docId = activeDoc();
      if (!docId) return Promise.resolve();
      return ipc.updateGeometry(docId, id, geometry).catch(() => undefined);
    },
    deleteEntities(ids) {
      const docId = activeDoc();
      if (!docId || ids.length === 0) return Promise.resolve();
      return ipc.deleteEntities(docId, ids).catch(() => undefined);
    },
    setVisible(ids, visible) {
      const docId = activeDoc();
      if (!docId) return Promise.resolve();
      return Promise.all(
        ids.map((id) => ipc.setEntityProps(docId, id, { visible })),
      ).then(() => undefined);
    },
    setSelection(ids, primary) {
      const docId = activeDoc();
      if (!docId) return Promise.resolve();
      return ipc.setSelection(docId, ids, primary).catch(() => undefined);
    },
    setTransform(id, transform, record) {
      const docId = activeDoc();
      if (!docId) return Promise.resolve();
      const current = useArcStore
        .getState()
        .scene?.entities.find((e) => e.id === id);
      const merged: Transform = current
        ? { ...current.transform, ...transform }
        : { ...transform };
      return ipc
        .setTransform(docId, [{ id, transform: merged }], record)
        .catch(() => undefined);
    },

    setPreview(obj, tag = "main") {
      const existing = ref.previews.get(tag);
      if (existing) {
        ref.sceneRoot.remove(existing);
        disposeObject(existing);
      }
      ref.previews.set(tag, obj);
      ref.sceneRoot.add(obj);
      ref.needsRender = true;
    },
    clearPreview(tag = "main") {
      const existing = ref.previews.get(tag);
      if (!existing) return;
      ref.sceneRoot.remove(existing);
      disposeObject(existing);
      ref.previews.delete(tag);
      ref.needsRender = true;
    },

    startMarquee(event) {
      startMarquee(ref, event);
    },
    moveMarquee(event) {
      moveMarquee(ref, event);
    },
    finishMarquee(event) {
      finishMarquee(ref, event);
    },
    cancelMarquee() {
      cancelMarquee(ref);
    },
    isMarqueeActive: () => ref.marquee !== null,

    setGizmo(mode: GizmoMode | null) {
      if (!mode) {
        if (ref.tc.object) ref.tc.detach();
        ref.tc.getHelper().visible = false;
        ref.needsRender = true;
        return;
      }
      ref.tc.setMode(mode);
      updateGizmoAttachment(ref);
      ref.needsRender = true;
    },
    gizmoActive: () => ref.gizmoDragging || ref.tc.axis !== null,
    gizmoBusy: () => ref.gizmoDragging,

    setStatus: (msg) => useArcStore.getState().setStatusMessage(msg),
    showMeasure(text, screen) {
      if (!text) {
        ref.measureEl.style.display = "none";
        return;
      }
      ref.measureEl.textContent = text;
      const rect = ref.host.getBoundingClientRect();
      const x = screen ? screen.x : rect.width / 2;
      const y = screen ? screen.y : rect.height / 2;
      ref.measureEl.style.display = "block";
      ref.measureEl.style.left = `${Math.max(40, Math.min(x, rect.width - 40))}px`;
      ref.measureEl.style.top = `${Math.max(24, y - 12)}px`;
    },
    setCursor(style) {
      ref.renderer.domElement.style.cursor = style;
    },
    requestRender() {
      ref.needsRender = true;
    },
    capturePointer(event) {
      try {
        ref.renderer.domElement.setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
    releasePointer(event) {
      try {
        ref.renderer.domElement.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    },
  };
}

function makeTransformFromPosition(
  id: string,
  position: [number, number, number],
): Transform {
  const current = useArcStore.getState().scene?.entities.find((e) => e.id === id);
  return current
    ? { ...current.transform, position }
    : { position, rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
}

// ------------------------------------------------------------------- camera

const _bbox = new THREE.Box3();

export function fitSelection(ref: ViewportRefs): void {
  const scene = useArcStore.getState().scene;
  if (!scene) return;
  const ids = scene.selection.length > 0 ? scene.selection : scene.entities.map((e) => e.id);
  fitEntities(ref, ids);
}

export function fitEntities(ref: ViewportRefs, ids: string[]): void {
  const box = new THREE.Box3();
  let found = false;
  for (const id of ids) {
    const obj = ref.objects.get(id);
    if (!obj || !obj.visible) continue;
    _bbox.setFromObject(obj);
    if (_bbox.isEmpty()) continue;
    box.union(_bbox);
    found = true;
  }
  if (!found) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length();
  const distance = Math.max(90, size * 1.6 || 90);
  const direction = new THREE.Vector3(0.62, 0.45, 0.65).normalize();
  const posTo = center.clone().addScaledVector(direction, distance);
  ref.camera.near = Math.max(0.1, distance / 1000);
  ref.camera.far = distance * 40;
  ref.camera.updateProjectionMatrix();
  flyCamera(ref, posTo, center, 380);
}

/** Fly the camera position and orbit target smoothly. */
function flyCamera(ref: ViewportRefs, posTo: THREE.Vector3, targetTo: THREE.Vector3, duration: number): void {
  ref.viewAnim = {
    start: performance.now(),
    duration,
    posFrom: ref.camera.position.clone(),
    posTo,
    targetFrom: ref.controls.target.clone(),
    targetTo,
  };
}

// ------------------------------------------------------------------ dispose

function disposeViewport(ref: ViewportRefs): void {
  ref.disposed = true;
  ref.tc.detach();
  ref.tc.dispose();
  for (const [tag] of ref.previews) ref.ctx?.clearPreview(tag);
  ref.previews.clear();
  const clearOne = (obj: THREE.Object3D | null) => {
    if (obj) ref.entityRoot.remove(obj);
  };
  clearOne(ref.hoverOverlay);
  clearOne(ref.selOverlay);
  clearOne(ref.hoverEdgeOverlay);
  clearOne(ref.selEdgeOverlay);
  ref.gizmo.dispose();
  for (const obj of ref.objects.values()) disposeObject(obj);
  ref.objects.clear();
  cancelMarquee(ref);
  closeContextMenu();
  const groundMaterial = ref.groundNode.material as THREE.Material;
  ref.groundNode.geometry.dispose();
  groundMaterial.dispose();
  ref.sceneRoot.remove(ref.groundNode);
  const environment = ref.sceneRoot.environment as THREE.Texture | null;
  ref.sceneRoot.environment = null;
  environment?.dispose();
  ref.controls.dispose();
  ref.renderer.dispose();
  ref.renderer.domElement.remove();
}
