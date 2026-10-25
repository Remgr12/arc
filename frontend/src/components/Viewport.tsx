import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import {
  Box,
  Circle,
  Combine,
  Compass,
  Copy,
  Cylinder,
  Download,
  Eye,
  Layers,
  Maximize2,
  Move,
  Paintbrush,
  PencilRuler,
  Redo,
  RotateCw,
  Scissors,
  Slice,
  Sparkles,
  Trash2,
  Undo,
} from "lucide-react";
import { ipc } from "../lib/ipc";
import { useArcStore, type ContextMenuItem } from "../lib/store";
import { useThemeStore, viewportPalette, type ViewportPalette } from "../lib/themes";
import { ViewCube } from "../lib/viewcube";
import { MATERIALS } from "../lib/materials";
import { actions } from "../lib/actions";
import { TOOL_BY_ID } from "../data/tools";
import { handlerFor } from "../tools/registry";
import type { ToolContext, ViewPalette, GizmoMode, SnapKind } from "../tools/types";
import type { EntityData, LayerData, SceneData, ToolId, Transform } from "../lib/types";
import type { EdgeHit, FaceHit } from "../tools/topology";
import {
  edgeOverlayGeometry,
  faceOverlayGeometry,
  pickEdgeScreen,
} from "../tools/topology";
import {
  computePlaneBasis,
  intersectSegments2D,
  projectPointToSegment2D,
  snapPolarAngle,
} from "../tools/geometry2d";
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

interface ViewportRefs {
  host: HTMLDivElement;
  measureEl: HTMLDivElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  tc: TransformControls;
  gizmoDragging: boolean;
  sceneRoot: THREE.Scene;
  entityRoot: THREE.Group;
  gridNode: THREE.Group;
  groundNode: THREE.Mesh;
  axes: THREE.Group;
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
  lastGridStep: number;
  lastBaseGrid: number;
  altOrbit: { lastX: number; lastY: number } | null;
  lastLowSpecMode: boolean;
  lastCursorAt: number;
  spawningObjects: Set<THREE.Object3D>;
  disposed: boolean;
  gizmo: ViewCube;
  viewAnim: ViewAnim | null;
  palette: ViewPalette;
  marquee: MarqueeState | null;
  marqueeEl: HTMLDivElement | null;
  /** Screen position and timestamp of an in-flight right-button press (time-sensitive click vs pan drag). */
  contextPress: { x: number; y: number; time?: number } | null;
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

function makeGrid(p: ViewportPalette, step = 2): THREE.Group {
  const majorCells = 40;
  const majorStep = step * 5;
  const extent = majorStep * majorCells;
  const minorDivs = majorCells * 5;
  const majorDivs = majorCells;

  const group = new THREE.Group();
  group.name = "adaptive-grid";
  const minorColor = new THREE.Color(p.gridLine);
  const majorColor = new THREE.Color(p.grid).lerp(new THREE.Color(p.accent500), 0.2);
  const centerColor = new THREE.Color(p.accent500);

  const minor = new THREE.GridHelper(extent, minorDivs, minorColor.getHex(), minorColor.getHex());
  const minorMat = minor.material as THREE.LineBasicMaterial;
  minorMat.transparent = true;
  minorMat.opacity = 0.32;
  minorMat.depthWrite = false;

  const major = new THREE.GridHelper(extent, majorDivs, centerColor.getHex(), majorColor.getHex());
  const majorMat = major.material as THREE.LineBasicMaterial;
  majorMat.transparent = true;
  majorMat.opacity = 0.72;
  majorMat.depthWrite = false;
  major.position.y = 0.005;

  group.add(minor);
  group.add(major);
  return group;
}

function snapTo125Series(val: number): number {
  if (val <= 0 || !Number.isFinite(val)) return 2;
  const exponent = Math.floor(Math.log10(val));
  const fraction = val / Math.pow(10, exponent);

  let stepMultiplier = 1;
  if (fraction < 1.414) {
    stepMultiplier = 1;
  } else if (fraction < 3.162) {
    stepMultiplier = 2;
  } else if (fraction < 7.071) {
    stepMultiplier = 5;
  } else {
    stepMultiplier = 10;
  }

  const step = stepMultiplier * Math.pow(10, exponent);
  return Math.round(step * 10000) / 10000;
}

/**
 * Computes an adaptive grid step based on the user's base grid size (settings.grid_size)
 * and camera zoom level (distance to orbit target).
 *
 * At standard viewing distance (~275 - 1100), the step equals baseGrid exactly.
 * When zooming in close or far out, it dynamically scales along the 1-2-5 series
 * so grid subdivisions remain clear, readable, and perfectly proportioned.
 */
function computeAdaptiveGridStep(baseGrid: number, dist: number, _fov?: number): number {
  const base = baseGrid > 0 && Number.isFinite(baseGrid) ? baseGrid : 2;
  if (dist <= 0 || !Number.isFinite(dist)) return base;
  const ratio = dist / 550;
  // Comfortable deadband around normal framing where the grid strictly matches the user's setting
  if (ratio >= 0.5 && ratio <= 2.0) {
    return base;
  }
  const raw = base * ratio;
  return snapTo125Series(raw);
}

function updateAdaptiveGrid(ref: ViewportRefs, step: number): void {
  ref.lastGridStep = step;
  ref.lastGridSize = step;
  useArcStore.getState().setAdaptiveGridSize(step);

  const palette = viewportPalette(useThemeStore.getState().active());
  const wasVisible = ref.gridNode.visible;
  const prevPos = ref.gridNode.position.clone();
  const prevQuat = ref.gridNode.quaternion.clone();

  const index = ref.sceneRoot.children.indexOf(ref.gridNode);
  ref.sceneRoot.remove(ref.gridNode);
  disposeObject(ref.gridNode);

  const next = makeGrid(palette, step);
  next.visible = wasVisible;
  next.position.copy(prevPos);
  next.quaternion.copy(prevQuat);
  if (index >= 0) ref.sceneRoot.children.splice(index, 0, next);
  else ref.sceneRoot.add(next);
  ref.gridNode = next;
  ref.needsRender = true;
}

/**
 * Builds infinite X, Y, and Z axis reference lines extending across the world
 * ([-100,000, +100,000] units). Solid vibrant color along positive axes
 * (+X Red, +Y Green, +Z Blue) and translucent dashed/soft color along negative axes,
 * providing immediate 3D spatial orientation at all camera distances and angles.
 */
function makeInfiniteAxes(): THREE.Group {
  const group = new THREE.Group();
  group.name = "infinite-axes";
  const extent = 250000;

  // X axis (Red): +X vibrant, -X subtle
  const xPosGeo = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, extent, 0, 0], 3),
  );
  const xNegGeo = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-extent, 0, 0, 0, 0, 0], 3),
  );
  const xPosMat = new THREE.LineBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
  });
  const xNegMat = new THREE.LineBasicMaterial({
    color: 0xef4444,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    fog: false,
  });
  const xPosLine = new THREE.LineSegments(xPosGeo, xPosMat);
  const xNegLine = new THREE.LineSegments(xNegGeo, xNegMat);
  xPosLine.renderOrder = 2;
  xNegLine.renderOrder = 2;
  group.add(xPosLine);
  group.add(xNegLine);

  // Y axis (Green): +Y vibrant, -Y subtle
  const yPosGeo = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, extent, 0], 3),
  );
  const yNegGeo = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, -extent, 0, 0, 0, 0], 3),
  );
  const yPosMat = new THREE.LineBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
  });
  const yNegMat = new THREE.LineBasicMaterial({
    color: 0x22c55e,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    fog: false,
  });
  const yPosLine = new THREE.LineSegments(yPosGeo, yPosMat);
  const yNegLine = new THREE.LineSegments(yNegGeo, yNegMat);
  yPosLine.renderOrder = 2;
  yNegLine.renderOrder = 2;
  group.add(yPosLine);
  group.add(yNegLine);

  // Z axis (Blue): +Z vibrant, -Z subtle
  const zPosGeo = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, extent], 3),
  );
  const zNegGeo = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, -extent, 0, 0, 0], 3),
  );
  const zPosMat = new THREE.LineBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
    fog: false,
  });
  const zNegMat = new THREE.LineBasicMaterial({
    color: 0x3b82f6,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    fog: false,
  });
  const zPosLine = new THREE.LineSegments(zPosGeo, zPosMat);
  const zNegLine = new THREE.LineSegments(zNegGeo, zNegMat);
  zPosLine.renderOrder = 2;
  zNegLine.renderOrder = 2;
  group.add(zPosLine);
  group.add(zNegLine);

  group.position.y = 0.02; // Small vertical offset so ground plane does not z-fight
  return group;
}

function createViewport(host: HTMLDivElement): ViewportRefs {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
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
  sceneRoot.fog = new THREE.Fog(palette.bg, 40000, 200000);

  const camera = new THREE.PerspectiveCamera(50, host.clientWidth / host.clientHeight, 0.5, 250000);
  camera.position.set(340, 250, 380);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.screenSpacePanning = true;
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

  const axes = makeInfiniteAxes();
  sceneRoot.add(axes);

  const measureEl = document.createElement("div");
  measureEl.className =
    "pointer-events-none absolute z-40 -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg border border-accent-500/40 bg-neutral-900/95 text-neutral-100 backdrop-blur-md px-2.5 py-1 font-mono text-[11px] font-semibold tracking-wide shadow-xl flex items-center gap-1.5";
  measureEl.style.display = "none";
  host.appendChild(measureEl);

  const tc = new TransformControls(camera, renderer.domElement);
  tc.setMode("translate");
  tc.setSpace("world");
  tc.setSize(0.85);
  const tcHelper = tc.getHelper();
  tcHelper.visible = false;
  sceneRoot.add(tcHelper);

  const raycaster = new THREE.Raycaster();
  if (raycaster.params.Line) (raycaster.params.Line as { threshold: number }).threshold = 10;

  const initialBaseGrid = useArcStore.getState().settings?.grid_size ?? 2;
  const initialDist = camera.position.distanceTo(controls.target);
  const initialGridStep = computeAdaptiveGridStep(initialBaseGrid, initialDist, camera.fov);
  useArcStore.getState().setAdaptiveGridSize(initialGridStep);
  const gridNode = makeGrid(palette, initialGridStep);
  gridNode.visible = false;
  sceneRoot.add(gridNode);

  const ref: ViewportRefs = {
    host,
    measureEl,
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
    lastGridSize: initialGridStep,
    lastGridStep: initialGridStep,
    lastBaseGrid: initialBaseGrid,
    altOrbit: null,
    lastLowSpecMode: false,
    lastCursorAt: 0,
    spawningObjects: new Set(),
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
    if (dragging) {
      const settings = useArcStore.getState().settings;
      const snapEnabled = settings?.snap_enabled ?? true;
      const gridSize = settings?.grid_size ?? 1;
      ref.tc.setTranslationSnap(snapEnabled ? gridSize : null);
      ref.tc.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(15) : null);
      ref.tc.setScaleSnap(snapEnabled ? 0.1 : null);
    }
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

    // Adaptive ground grid spacing & infinite scrolling
    if (ref.gridNode.visible) {
      const dist = ref.camera.position.distanceTo(ref.controls.target);
      const baseGrid = useArcStore.getState().settings?.grid_size ?? 2;
      const adaptiveStep = computeAdaptiveGridStep(baseGrid, dist, ref.camera.fov);
      if (adaptiveStep !== ref.lastGridStep) {
        updateAdaptiveGrid(ref, adaptiveStep);
      }

      if (!useArcStore.getState().sketchMode) {
        const majorStep = (ref.lastGridStep || 2) * 5;
        const snapX = Math.floor(ref.controls.target.x / majorStep) * majorStep;
        const snapZ = Math.floor(ref.controls.target.z / majorStep) * majorStep;
        if (
          Math.abs(ref.gridNode.position.x - snapX) > 0.001 ||
          Math.abs(ref.gridNode.position.z - snapZ) > 0.001
        ) {
          ref.gridNode.position.x = snapX;
          ref.gridNode.position.z = snapZ;
          ref.needsRender = true;
        }
      }
    }

    // Animate any newly-spawned entities.
    if (ref.spawningObjects.size > 0) {
      for (const obj of ref.spawningObjects) {
        if (applySpawnScale(obj, now)) {
          ref.spawningObjects.delete(obj);
        }
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

/** Fly the camera to look straight at the given world plane normal, centered on the workplane or selection. */
function focusPlane(ref: ViewportRefs, normal: THREE.Vector3): void {
  const dirTo = normal.clone().normalize();
  if (Math.abs(dirTo.y) > 0.9999) {
    // Keep OrbitControls happy: nudge along +Z/-Z so +X stays horizontal (right).
    dirTo.set(0, dirTo.y > 0 ? 1 : -1, dirTo.y > 0 ? 0.0008 : -0.0008).normalize();
  }
  const st = useArcStore.getState();
  let targetTo = ref.controls.target.clone();
  if (st.sketchMode) {
    targetTo.set(...st.sketchPlaneOrigin);
  } else if (st.scene && st.scene.selection.length > 0) {
    const primaryId = st.scene.selection[st.scene.selection.length - 1];
    const obj = ref.objects.get(primaryId);
    if (obj) {
      const b = new THREE.Box3().setFromObject(obj);
      if (!b.isEmpty()) targetTo = b.getCenter(new THREE.Vector3());
    }
  }

  const radius = Math.max(120, ref.camera.position.distanceTo(targetTo));
  const posTo = targetTo.clone().addScaledVector(dirTo, radius);

  ref.viewAnim = {
    start: performance.now(),
    duration: 360,
    posFrom: ref.camera.position.clone(),
    posTo,
    targetFrom: ref.controls.target.clone(),
    targetTo,
  };
}

// -------------------------------------------------------------- theme sync

function applyTheme(ref: ViewportRefs, palette: ViewportPalette): void {
  ref.palette = themeToPalette(palette);
  ref.sceneRoot.background = ref.palette.bg;
  ref.sceneRoot.fog = new THREE.Fog(palette.bg, 40000, 200000);
  ref.lineMaterial.color.copy(ref.palette.line);
  ref.lineMaterial.depthTest = false;
  const index = ref.sceneRoot.children.indexOf(ref.gridNode);
  const wasVisible = ref.gridNode.visible;
  const prevPos = ref.gridNode.position.clone();
  const prevQuat = ref.gridNode.quaternion.clone();
  ref.sceneRoot.remove(ref.gridNode);
  disposeObject(ref.gridNode);
  const next = makeGrid(palette, ref.lastGridStep || ref.lastGridSize);
  next.visible = wasVisible;
  next.position.copy(prevPos);
  next.quaternion.copy(prevQuat);
  if (index >= 0) ref.sceneRoot.children.splice(index, 0, next);
  else ref.sceneRoot.add(next);
  ref.gridNode = next;
  ref.gizmo.applyTheme(palette);
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

  if (sceneChanged || displayModeChanged || sketchChanged) {
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

  const baseGrid = settings?.grid_size ?? 2;
  const baseGridChanged = baseGrid !== ref.lastBaseGrid;
  if (baseGridChanged) {
    ref.lastBaseGrid = baseGrid;
    const dist = ref.camera.position.distanceTo(ref.controls.target);
    const step = computeAdaptiveGridStep(baseGrid, dist, ref.camera.fov);
    updateAdaptiveGrid(ref, step);
  }

  if (ref.gridNode.visible !== gridVis || sketchChanged || baseGridChanged) {
    ref.gridNode.visible = gridVis;
    if (state.sketchMode) {
      const n = new THREE.Vector3(...state.sketchPlaneNormal).normalize();
      const o = new THREE.Vector3(...state.sketchPlaneOrigin);
      const basis = computePlaneBasis(n, o);
      ref.gridNode.quaternion.copy(basis.quat);
      // Elevate grid slightly along normal (+0.03) so it never z-fights with solid face triangles
      ref.gridNode.position.copy(basis.origin).addScaledVector(basis.normal, 0.03);
    } else {
      ref.gridNode.quaternion.identity();
      const majorStep = (ref.lastGridStep || 2) * 5;
      const snapX = Math.floor(ref.controls.target.x / majorStep) * majorStep;
      const snapZ = Math.floor(ref.controls.target.z / majorStep) * majorStep;
      ref.gridNode.position.set(snapX, 0, snapZ);
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
  const settings = state.settings;
  const snapEnabled = settings?.snap_enabled ?? true;
  const gridSize = ref.lastGridStep || settings?.grid_size || 1;
  ref.tc.setTranslationSnap(snapEnabled ? gridSize : null);
  ref.tc.setRotationSnap(snapEnabled ? THREE.MathUtils.degToRad(15) : null);
  ref.tc.setScaleSnap(snapEnabled ? 0.1 : null);

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
      ref.spawningObjects.delete(obj);
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
  fillMesh.renderOrder = 400;
  fillMesh.userData.isProfileFill = true;
  fillMesh.userData.entityId = entityId;
  return fillMesh;
}

function makeEntityObject(ref: ViewportRefs, entity: EntityData): THREE.Object3D | null {
  const tris =
    entity.triPositions && entity.triPositions.length > 0 ? entity.triPositions : null;
  const lineData = entity.lines && entity.lines.length > 0 ? entity.lines : null;
  let obj: THREE.Object3D;
  if (lineData && !tris) {
    const isConstruction = entity.name?.startsWith("[C] ");
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(lineData, 3));
    if (isConstruction) {
      const dashMat = new THREE.LineDashedMaterial({
        color: 0xf59e0b,
        dashSize: 2.0,
        gapSize: 1.2,
        transparent: true,
        opacity: 0.9,
      });
      const segs = new THREE.LineSegments(geometry, dashMat);
      segs.computeLineDistances();
      obj = segs;
    } else {
      const material = ref.lineMaterial.clone();
      material.color.copy(ref.palette.line);
      material.depthTest = false;
      obj = new THREE.LineSegments(geometry, material);
      obj.renderOrder = 500;
      if (entity.category === "sketch") {
        const fill = buildClosedSketchFill(lineData, entity.id, new THREE.Color(0xc8ccd4));
        if (fill) obj.add(fill);
      }
    }
    if (entity.kind === "dimension" && entity.geometry?.type === "dimension") {
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
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
    if (entity.triNormals && entity.triNormals.length > 0) {
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(entity.triNormals, 3),
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
          new THREE.Float32BufferAttribute(lineData, 3),
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
  ref.spawningObjects.add(obj);
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
        sketchMode: boolean;
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
    cache.sketchMode !== st.sketchMode ||
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
    sketchMode: st.sketchMode,
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
    if (st.sketchMode && entity.category !== "sketch") {
      mat.opacity = 0.28;
      mat.transparent = true;
      mat.depthWrite = false;
    } else if (entity.locked) {
      mat.opacity = 0.55;
      mat.transparent = true;
      mat.depthWrite = true;
    } else {
      mat.opacity = material?.transparent ? 0.55 : 1.0;
      mat.transparent = entity.locked || !!material?.transparent;
      mat.depthWrite = !material?.transparent;
    }
    const wholeBodySelected = selected && st.selKind === "entity";
    mat.emissive.copy(
      wholeBodySelected ? SHAPR_CYAN : hovered ? SHAPR_CYAN : BLACK,
    );
    mat.emissiveIntensity = wholeBodySelected ? 0.12 : hovered ? 0.06 : 0;
  } else if ((obj as THREE.Line).isLine) {
    const line = obj as THREE.Line;
    const mat = line.material as THREE.LineBasicMaterial;
    mat.color.copy(selected ? SHAPR_CYAN : hovered ? SHAPR_CYAN : SKETCH_LINE_COLOR);
    mat.opacity = entity.locked ? 0.5 : 1;
    mat.transparent = entity.locked;
    mat.depthTest = true;
    line.renderOrder = st.sketchMode ? 10 : 0;
    for (const child of obj.children) {
      if (child.userData.isProfileFill) {
        const fillMat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
        fillMat.color.copy(selected || hovered ? SHAPR_CYAN : SKETCH_FILL_GRAY);
        fillMat.opacity = selected ? 0.45 : hovered ? 0.35 : 0.25;
      }
    }
  }
}

/** Ease the object from zero scale to its real scale during the spawn window. Returns true when done. */
function applySpawnScale(obj: THREE.Object3D, now: number): boolean {
  const spawnAt = obj.userData.spawnAt as number;
  const realScale = obj.userData.realScale as [number, number, number];
  const t = Math.min(1, (now - spawnAt) / SPAWN_DURATION);
  const k = t * t * (3 - 2 * t); // smoothstep
  obj.scale.set(realScale[0] * k, realScale[1] * k, realScale[2] * k);
  if (t >= 1) {
    delete obj.userData.spawnAt;
    return true;
  }
  return false;
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

function openContextMenu(ref: ViewportRefs, hostX: number, hostY: number, items: ContextMenuItem[]): void {
  void ref;
  useArcStore.getState().openContextMenu(hostX, hostY, items);
}


function onContextMenu(ref: ViewportRefs, event: MouseEvent): void {
  event.preventDefault();
  // A right-drag was orbit/pan navigation, not a click: just suppress the menu.
  const press = ref.contextPress;
  ref.contextPress = null;
  if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) return;

  const store = useArcStore.getState();
  const handler = handlerFor(store.tool);

  // Time-sensitive right-click (<350ms): if currently drafting, right-click acts as Enter (CADCraft/AutoCAD/SolveSpace style)!
  const elapsed = press?.time ? performance.now() - press.time : 0;
  if (elapsed < 350 && (store.drafting || handler?.hasActivity?.(ref.ctx))) {
    const handled = handler?.onEnter?.(ref.ctx);
    syncDrafting(ref);
    if (handled) return;
  }

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

    const topItems: ContextMenuItem[] = [];
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
          label: "Fillet Edge",
          icon: <Sparkles size={13} strokeWidth={2} />,
          shortcut: "F",
          run: () => useArcStore.getState().setTool("fillet-edge"),
        },
        {
          label: "Chamfer Edge",
          icon: <Slice size={13} strokeWidth={1.8} />,
          run: () => void actions.chamferSelectedEdge(2),
        },
        {
          label: "Isolate Edge Solid",
          icon: <Eye size={13} strokeWidth={1.8} />,
          shortcut: "Alt+I",
          run: () => void actions.isolateSelection(),
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
          label: "Extrude Face",
          icon: <Maximize2 size={13} strokeWidth={1.8} />,
          shortcut: "E",
          run: () => useArcStore.getState().setTool("extrude-face"),
        },
        {
          label: "Offset Face",
          icon: <Move size={13} strokeWidth={1.8} />,
          run: () => useArcStore.getState().setTool("offset-face"),
        },
        {
          label: "Sketch on Face",
          icon: <PencilRuler size={13} strokeWidth={1.8} />,
          shortcut: "W",
          run: () => actions.activateWorkplane(),
        },
        {
          label: "Section on Face",
          icon: <Slice size={13} strokeWidth={1.8} />,
          run: () => void actions.sectionOnFace(faceHit.entityId, faceHit.faceIndex),
        },
        {
          label: "Shell Solid (2 cm)",
          icon: <Box size={13} strokeWidth={1.8} />,
          run: () => void actions.shellSelection(2),
        },
      );
    } else if (entity?.category === "sketch") {
      topItems.push(
        {
          label: "Draw on Sketch",
          icon: <PencilRuler size={13} strokeWidth={1.8} />,
          shortcut: "W",
          run: () => actions.activateWorkplane(),
        },
        {
          label: "Extrude Profile",
          icon: <Maximize2 size={13} strokeWidth={1.8} />,
          shortcut: "E",
          run: () => useArcStore.getState().setTool("extrude"),
        },
        {
          label: "Revolve Profile",
          icon: <RotateCw size={13} strokeWidth={1.8} />,
          shortcut: "V",
          run: () => useArcStore.getState().setTool("revolve"),
        },
        {
          label: "Toggle Construction",
          icon: <PencilRuler size={13} strokeWidth={1.8} />,
          shortcut: "X",
          run: () => void actions.toggleConstruction(),
        },
      );
    } else {
      topItems.push(
        {
          label: "Isolate Body",
          icon: <Eye size={13} strokeWidth={1.8} />,
          shortcut: "Alt+I",
          run: () => void actions.isolateSelection(),
        },
        {
          label: "Export STL",
          icon: <Download size={13} strokeWidth={1.8} />,
          run: () => void actions.exportSelectedStl(),
        },
      );
    }

    openContextMenu(ref, x, y, [
      ...topItems,
      { label: "", separator: true, run: () => {} },
      {
        label: "Duplicate",
        icon: <Copy size={13} strokeWidth={1.8} />,
        shortcut: "Ctrl+D",
        run: () => void actions.duplicateSelection(),
      },
      {
        label: "Boolean Union",
        icon: <Combine size={13} strokeWidth={1.8} />,
        disabled: selectedCount < 2,
        run: () => void actions.booleanApply("union"),
      },
      {
        label: "Boolean Subtract",
        icon: <Scissors size={13} strokeWidth={1.8} />,
        disabled: selectedCount < 2,
        run: () => void actions.booleanApply("difference"),
      },
      {
        label: "Boolean Intersect",
        icon: <Layers size={13} strokeWidth={1.8} />,
        disabled: selectedCount < 2,
        run: () => void actions.booleanApply("intersection"),
      },
      {
        label: "Materials…",
        icon: <Paintbrush size={13} strokeWidth={1.8} />,
        run: () => window.dispatchEvent(new CustomEvent("arc-materials-toggle", { detail: true })),
      },
      { label: "", separator: true, run: () => {} },
      {
        label: "Delete",
        icon: <Trash2 size={13} strokeWidth={1.8} />,
        shortcut: "Del",
        danger: true,
        run: () => void actions.deleteSelection(),
      },
    ]);
    return;
  }

  // Empty canvas right click: Quick Creation & Navigation
  openContextMenu(ref, x, y, [
    {
      label: "New Sketch",
      icon: <PencilRuler size={13} strokeWidth={1.8} />,
      shortcut: "W",
      run: () => actions.activateWorkplane(),
    },
    {
      label: "Add Box",
      icon: <Box size={13} strokeWidth={1.8} />,
      shortcut: "B",
      run: () => actions.setTool("box"),
    },
    {
      label: "Add Cylinder",
      icon: <Cylinder size={13} strokeWidth={1.8} />,
      shortcut: "Q",
      run: () => actions.setTool("cylinder"),
    },
    {
      label: "Add Sphere",
      icon: <Circle size={13} strokeWidth={1.8} />,
      shortcut: "G",
      run: () => actions.setTool("sphere"),
    },
    { label: "", separator: true, run: () => {} },
    {
      label: "Fit View",
      icon: <Compass size={13} strokeWidth={1.8} />,
      shortcut: "Ctrl+F",
      run: () => actions.fitView(),
    },
    {
      label: "Undo",
      icon: <Undo size={13} strokeWidth={1.8} />,
      shortcut: "Ctrl+Z",
      run: () => void actions.undo(),
    },
    {
      label: "Redo",
      icon: <Redo size={13} strokeWidth={1.8} />,
      shortcut: "Ctrl+Y",
      run: () => void actions.redo(),
    },
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

  const hits = ref.raycaster.intersectObjects(ref.meshObjects, false);
  if (hits.length === 0) return null;

  // If a closed sketch profile face (`isProfileFill`) lies in front of or coplanar
  // with the solid face, let `pickEntityAt` select the sketch profile instead!
  let closestSketchFillDist = Infinity;
  for (const obj of ref.objects.values()) {
    if (!obj.visible) continue;
    for (const child of obj.children) {
      if (child.userData.isProfileFill && child.visible) {
        const fillHits = ref.raycaster.intersectObject(child, false);
        if (fillHits.length > 0 && fillHits[0].distance < closestSketchFillDist) {
          closestSketchFillDist = fillHits[0].distance;
        }
      }
    }
  }

  for (const hit of hits) {
    if (!hit.object.visible || !hit.face) continue;
    if (closestSketchFillDist <= hit.distance + 0.6) return null;
    const entity = scene.entities.find((e) => e.id === hit.object.userData.entityId);
    if (!entity || entity.locked) continue;
    const tags = entity.triFaceIds;
    if (!tags || tags.length === 0) continue;
    const tri = hit.faceIndex ?? -1;
    if (tri < 0) continue;
    const positions = entity.triPositions;
    const stride = positions && tags.length === Math.floor(positions.length / 3) ? 3 : 1;
    const tagIndex = tri * stride;
    if (tagIndex >= tags.length) continue;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    const worldN = hit.face.normal.clone().applyNormalMatrix(normalMatrix).normalize();
    return {
      entityId: entity.id,
      faceIndex: tags[tagIndex],
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
  if (!enabled || gridSize <= 0) return value;
  const snapped = Math.round(value / gridSize) * gridSize;
  return Math.abs(snapped) < 1e-10 ? 0 : Number(snapped.toFixed(6));
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
  const isCrossing = x < marquee.x0; // Right-to-Left drag = Crossing selection
  el.style.display = "block";
  el.style.left = `${Math.min(marquee.x0, x)}px`;
  el.style.top = `${Math.min(marquee.y0, y)}px`;
  el.style.width = `${Math.abs(x - marquee.x0)}px`;
  el.style.height = `${Math.abs(y - marquee.y0)}px`;
  if (isCrossing) {
    el.style.border = "1px dashed #10b981";
    el.style.backgroundColor = "rgba(16, 185, 129, 0.16)";
  } else {
    el.style.border = "1px solid #3b82f6";
    el.style.backgroundColor = "rgba(59, 130, 246, 0.16)";
  }
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
  const rawEndX = event.clientX - hostRect.left;
  const rawEndY = event.clientY - hostRect.top;
  const isCrossing = rawEndX < marquee.x0;
  const x1 = Math.min(marquee.x0, rawEndX);
  const y1 = Math.min(marquee.y0, rawEndY);
  const x2 = Math.max(marquee.x0, rawEndX);
  const y2 = Math.max(marquee.y0, rawEndY);

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
    // CAD selection semantics:
    // Crossing (Right-to-Left): any intersection selects
    // Window (Left-to-Right): must be strictly enclosed inside
    if (isCrossing) {
      if (maxX < x1 || minX > x2 || maxY < y1 || minY > y2) continue;
    } else {
      if (minX < x1 || maxX > x2 || minY < y1 || maxY > y2) continue;
    }
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
      ref.contextPress = { x: event.clientX, y: event.clientY, time: performance.now() };
    }
    // Trackpad navigation: Alt + Left Drag orbits the camera in 3D
    if (event.button === 0 && event.altKey) {
      ref.altOrbit = { lastX: event.clientX, lastY: event.clientY };
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      return;
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
    if (ref.altOrbit) {
      const dx = event.clientX - ref.altOrbit.lastX;
      const dy = event.clientY - ref.altOrbit.lastY;
      ref.altOrbit.lastX = event.clientX;
      ref.altOrbit.lastY = event.clientY;
      ref.controls.rotateLeft(-dx * 0.005);
      ref.controls.rotateUp(-dy * 0.005);
      ref.controls.update();
      ref.needsRender = true;
      return;
    }
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
      // Throttle hover picking on laptops (~30Hz max) and skip while orbiting/panning.
      if (
        event.buttons === 0 &&
        now - ref.lastHoverAt >= 32 &&
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
        const prevHover = store.hoverObj;

        if (edge) {
          if (
            prevHover?.kind !== "edge" ||
            prevHover.entityId !== edge.entityId ||
            prevHover.edge !== edge.key
          ) {
            store.setHoverObj({
              entityId: edge.entityId,
              kind: "edge",
              face: null,
              edge: edge.key,
              point: edge.point,
              normal: [0, 0, 0],
            });
          }
          if (store.tool === "select") {
            const entity = store.scene?.entities.find((e) => e.id === edge.entityId);
            if (entity?.lines) {
              const o = edge.segIndex * 6;
              if (o + 5 < entity.lines.length) {
                const obj = ref.objects.get(edge.entityId);
                const mat = obj?.matrixWorld ?? new THREE.Matrix4();
                const v0 = new THREE.Vector3(
                  entity.lines[o],
                  entity.lines[o + 1],
                  entity.lines[o + 2],
                ).applyMatrix4(mat);
                const v1 = new THREE.Vector3(
                  entity.lines[o + 3],
                  entity.lines[o + 4],
                  entity.lines[o + 5],
                ).applyMatrix4(mat);
                const len = v0.distanceTo(v1);
                const mid = v0.clone().add(v1).multiplyScalar(0.5);
                const screenPt = ref.ctx.worldToScreen(mid);
                const u = ref.ctx.settings.unitLabel;
                ref.ctx.showMeasure(`L ${Math.round(len * 10) / 10} ${u}`, screenPt ?? undefined);
              }
            }
          }
        } else if (face) {
          if (store.tool === "select") ref.ctx.showMeasure(null);
          if (
            prevHover?.kind !== "face" ||
            prevHover.entityId !== face.entityId ||
            prevHover.face !== face.faceIndex
          ) {
            store.setHoverObj({
              entityId: face.entityId,
              kind: "face",
              face: face.faceIndex,
              edge: null,
              point: face.point,
              normal: face.normal,
            });
          }
        } else if (prevHover !== null) {
          if (store.tool === "select") ref.ctx.showMeasure(null);
          store.setHoverObj(null);
        } else {
          const id = pickEntityAt(ref, point);
          if (id !== store.hoverEntity) {
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
        if (world) {
          const prev = store.cursorWorld;
          if (
            !prev ||
            Math.abs(world.x - prev[0]) > 0.05 ||
            Math.abs(world.y - prev[1]) > 0.05 ||
            Math.abs(world.z - prev[2]) > 0.05
          ) {
            store.setCursorWorld([world.x, world.y, world.z]);
          }
        }
      }
    }
    handlerFor(store.tool)?.onPointerMove?.(event, ctx);
    syncDrafting(ref);
  };
  const up = (event: PointerEvent) => {
    if (ref.altOrbit) {
      ref.altOrbit = null;
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      return;
    }
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
    if (ref.altOrbit) {
      ref.altOrbit = null;
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
    }
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

  const zoomToCursor = (clientX: number, clientY: number, zoomFactor: number) => {
    if (zoomFactor <= 0 || !Number.isFinite(zoomFactor)) return;
    const dist = ref.camera.position.distanceTo(ref.controls.target);
    const nextDist = dist / zoomFactor;
    if (nextDist < 1 || nextDist > 150000) return;

    const rect = ref.host.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;

    const ray = new THREE.Ray();
    ray.origin.copy(ref.camera.position);
    ray.direction
      .set(ndcX, ndcY, 0.5)
      .unproject(ref.camera)
      .sub(ref.camera.position)
      .normalize();

    const camDir = new THREE.Vector3();
    ref.camera.getWorldDirection(camDir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, ref.controls.target);
    const hit = new THREE.Vector3();

    if (ray.intersectPlane(plane, hit)) {
      const factor = 1 - 1 / zoomFactor;
      const camShift = hit.clone().sub(ref.camera.position).multiplyScalar(factor);
      const targetShift = hit.clone().sub(ref.controls.target).multiplyScalar(factor);
      ref.camera.position.add(camShift);
      ref.controls.target.add(targetShift);
      ref.controls.update();
      ref.needsRender = true;
    } else {
      const factor = 1 - 1 / zoomFactor;
      const camShift = ref.controls.target.clone().sub(ref.camera.position).multiplyScalar(factor);
      ref.camera.position.add(camShift);
      ref.controls.update();
      ref.needsRender = true;
    }
  };

  const wheel = (event: WheelEvent) => {
    ref.viewAnim = null;

    // 1) Trackpad pinch-to-zoom (or Ctrl/Cmd + Wheel): Smooth zoom to cursor
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      event.stopPropagation();
      const zoomFactor = Math.exp(-event.deltaY * 0.008);
      zoomToCursor(event.clientX, event.clientY, zoomFactor);
      return;
    }

    // 2) Shift + Wheel / Trackpad Scroll: Pan viewport
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      const panSpeed = 0.65;
      ref.controls.pan(-event.deltaX * panSpeed, -event.deltaY * panSpeed);
      ref.controls.update();
      ref.needsRender = true;
      return;
    }

    // 3) Alt + Wheel / Trackpad Scroll: Orbit viewport
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      const rotSpeed = 0.005;
      ref.controls.rotateLeft(-event.deltaX * rotSpeed);
      ref.controls.rotateUp(-event.deltaY * rotSpeed);
      ref.controls.update();
      ref.needsRender = true;
      return;
    }

    // 4) Pure horizontal swipe on trackpad: Pan horizontally
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) * 2.5 && Math.abs(event.deltaX) > 2) {
      event.preventDefault();
      event.stopPropagation();
      ref.controls.pan(-event.deltaX * 0.65, 0);
      ref.controls.update();
      ref.needsRender = true;
      return;
    }

    // 5) Two-finger vertical scroll or mouse wheel: Zoom to cursor
    event.preventDefault();
    event.stopPropagation();
    const isTrackpad = event.deltaMode === 0 || !Number.isInteger(event.deltaY);
    const zoomFactor = isTrackpad
      ? Math.exp(-event.deltaY * 0.0035)
      : event.deltaY < 0 ? 1.15 : 0.87;
    zoomToCursor(event.clientX, event.clientY, zoomFactor);
  };

  const draftCancel = () => {
    const handler = handlerFor(useArcStore.getState().tool);
    handler?.onCancel?.(ctx);
    ref.ctx.clearPreview("draft");
    syncDrafting(ref);
    const stop = useArcStore.getState();
    if (stop.tool !== "select") {
      stop.setTool("select");
    }
    stop.setDrafting(false);
  };
  const draftEnter = () => {
    const handler = handlerFor(useArcStore.getState().tool);
    handler?.onEnter?.(ctx);
    ref.ctx.clearPreview("draft");
    syncDrafting(ref);
    const stop = useArcStore.getState();
    if (stop.tool !== "select") {
      stop.setTool("select");
    }
    stop.setDrafting(false);
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

    // Standard CAD Viewport Numpad / Alt+Digit shortcuts
    if (event.code === "Numpad1" || (event.altKey && event.code === "Digit1")) {
      event.preventDefault();
      focusPlane(ref, new THREE.Vector3(0, 0, 1));
      return;
    }
    if (event.code === "Numpad3" || (event.altKey && event.code === "Digit3")) {
      event.preventDefault();
      focusPlane(ref, new THREE.Vector3(1, 0, 0));
      return;
    }
    if (event.code === "Numpad7" || (event.altKey && event.code === "Digit7")) {
      event.preventDefault();
      focusPlane(ref, new THREE.Vector3(0, 1, 0));
      return;
    }
    if (event.code === "Numpad9" || (event.altKey && event.code === "Digit9")) {
      event.preventDefault();
      const cur = ref.camera.position.clone().sub(ref.controls.target).normalize();
      focusPlane(ref, cur.negate());
      return;
    }
    if (event.code === "Numpad0" || (event.altKey && event.code === "Digit0")) {
      event.preventDefault();
      focusPlane(ref, new THREE.Vector3(1, 1, 1).normalize());
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

  const leave = () => {
    ref.ctx.clearPreview("snap-marker");
    ref.ctx.clearPreview("alignment-guide");
    if (useArcStore.getState().tool === "select") {
      ref.ctx.showMeasure(null);
      useArcStore.getState().setHoverObj(null);
      useArcStore.getState().setHoverEntity(null);
    }
  };

  let gestureInitialScale = 1;
  const gestureStart = (event: Event) => {
    event.preventDefault();
    gestureInitialScale = 1;
  };
  const gestureChange = (event: Event) => {
    event.preventDefault();
    const ge = event as Event & { scale?: number; clientX?: number; clientY?: number };
    if (typeof ge.scale === "number" && Number.isFinite(ge.scale) && ge.scale > 0) {
      const factor = ge.scale / gestureInitialScale;
      gestureInitialScale = ge.scale;
      const cx = typeof ge.clientX === "number" ? ge.clientX : ref.host.clientWidth / 2;
      const cy = typeof ge.clientY === "number" ? ge.clientY : ref.host.clientHeight / 2;
      zoomToCursor(cx, cy, factor);
    }
  };
  const gestureEnd = (event: Event) => {
    event.preventDefault();
    gestureInitialScale = 1;
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("pointerleave", leave);
  el.addEventListener("dblclick", dbl);
  el.addEventListener("wheel", wheel, { passive: false, capture: true });
  el.addEventListener("gesturestart", gestureStart, { passive: false });
  el.addEventListener("gesturechange", gestureChange, { passive: false });
  el.addEventListener("gestureend", gestureEnd, { passive: false });
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

  const standardViewEv = (event: Event) => {
    const v = (event as CustomEvent<{ view: string }>).detail?.view;
    if (v === "front") focusPlane(ref, new THREE.Vector3(0, 0, 1));
    else if (v === "top") focusPlane(ref, new THREE.Vector3(0, 1, 0));
    else if (v === "right") focusPlane(ref, new THREE.Vector3(1, 0, 0));
    else if (v === "iso") focusPlane(ref, new THREE.Vector3(1, 1, 1).normalize());
    else if (v === "back") focusPlane(ref, new THREE.Vector3(0, 0, -1));
    else if (v === "bottom") focusPlane(ref, new THREE.Vector3(0, -1, 0));
    else if (v === "left") focusPlane(ref, new THREE.Vector3(-1, 0, 0));
  };
  window.addEventListener("arc-standard-view", standardViewEv);

  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("pointerleave", leave);
    el.removeEventListener("dblclick", dbl);
    el.removeEventListener("wheel", wheel, { capture: true } as EventListenerOptions);
    el.removeEventListener("gesturestart", gestureStart);
    el.removeEventListener("gesturechange", gestureChange);
    el.removeEventListener("gestureend", gestureEnd);
    el.removeEventListener("contextmenu", ctx_);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("arc-draft-cancel", draftCancel);
    window.removeEventListener("arc-draft-enter", draftEnter);
    window.removeEventListener("arc-draft-backspace", draftBackspace);
    window.removeEventListener("arc-fit-view", fit);
    window.removeEventListener("arc-focus-entity", focus);
    window.removeEventListener("arc-focus-plane", focusPlaneEv);
    window.removeEventListener("arc-standard-view", standardViewEv);
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
      gridSize: ref.lastGridStep || settings?.grid_size || 2,
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
      if (st.sketchMode) {
        const n = new THREE.Vector3(...st.sketchPlaneNormal).normalize();
        const o = new THREE.Vector3(...st.sketchPlaneOrigin);
        if (height !== undefined) {
          o.addScaledVector(n, height - st.sketchPlaneHeight);
        }
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, o);
        const out = new THREE.Vector3();
        return rayAt(ref, ndcPoint(event)).intersectPlane(plane, out);
      }
      const h = height ?? 0;
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
      const st = useArcStore.getState();
      const isSketch = st.sketchMode;
      const basis = isSketch
        ? computePlaneBasis(
            new THREE.Vector3(...st.sketchPlaneNormal),
            new THREE.Vector3(...st.sketchPlaneOrigin),
          )
        : null;

      const hostRect = ref.host.getBoundingClientRect();
      const camDistance = ref.camera.position.distanceTo(world);
      const cam = ref.camera as THREE.PerspectiveCamera;
      const fov = typeof cam.fov === "number" ? cam.fov : 50;
      const unitsPerPx =
        (2 * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * camDistance) /
        Math.max(100, hostRect.height);
      // CAD standard 18-20 screen pixels snap aperture
      const endpointTolerance = Math.max(gridSize * 0.4, 20 * unitsPerPx);
      const tolerance = endpointTolerance * 0.55;

      const showSnapMarker = (
        pt: THREE.Vector3 | null,
        kind?: SnapKind,
        customColor?: number,
      ) => {
        if (!pt || !kind || kind === "grid") {
          ref.ctx.clearPreview("snap-marker");
          return;
        }
        const radius = Math.max(0.65, 10 * unitsPerPx);
        const color =
          customColor ??
          (kind === "midpoint"
            ? 0x10b981
            : kind === "center" || kind === "origin"
              ? 0xf59e0b
              : kind === "intersection"
                ? 0xf43f5e
                : kind === "quadrant"
                  ? 0xeab308
                  : kind === "perpendicular"
                    ? 0x6366f1
                    : kind === "tangent"
                      ? 0x14b8a6
                      : kind === "aligned" || kind === "polar"
                        ? 0xa855f7
                        : kind === "axis"
                          ? 0x38bdf8
                          : 0x22d3ee); // endpoint / default cyan

        let markerGeo: THREE.BufferGeometry;
        let isLineSegments = false;
        const s = radius * 0.75;

        if (kind === "midpoint") {
          // Triangle
          const pts = [
            new THREE.Vector3(0, s * 1.15, 0),
            new THREE.Vector3(-s, -s * 0.65, 0),
            new THREE.Vector3(s, -s * 0.65, 0),
            new THREE.Vector3(0, s * 1.15, 0),
          ];
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (kind === "tangent") {
          // Circle with horizontal tangent bar on top
          const pts: THREE.Vector3[] = [];
          const segs = 16;
          for (let i = 0; i <= segs; i++) {
            const th = (i / segs) * Math.PI * 2;
            pts.push(new THREE.Vector3(Math.cos(th) * s * 0.7, Math.sin(th) * s * 0.7 - s * 0.2, 0));
          }
          pts.push(new THREE.Vector3(-s, s * 0.5, 0), new THREE.Vector3(s, s * 0.5, 0));
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (kind === "intersection") {
          // Cross 'X'
          const pts = [
            new THREE.Vector3(-s, -s, 0),
            new THREE.Vector3(s, s, 0),
            new THREE.Vector3(-s, s, 0),
            new THREE.Vector3(s, -s, 0),
          ];
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
          isLineSegments = true;
        } else if (kind === "quadrant") {
          // Diamond
          const pts = [
            new THREE.Vector3(0, s * 1.1, 0),
            new THREE.Vector3(s * 1.1, 0, 0),
            new THREE.Vector3(0, -s * 1.1, 0),
            new THREE.Vector3(-s * 1.1, 0, 0),
            new THREE.Vector3(0, s * 1.1, 0),
          ];
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
        } else if (kind === "axis") {
          // Axis marker: diamond with center crosshair
          const pts = [
            // Diamond
            new THREE.Vector3(0, s * 1.2, 0),
            new THREE.Vector3(s * 1.2, 0, 0),
            new THREE.Vector3(s * 1.2, 0, 0),
            new THREE.Vector3(0, -s * 1.2, 0),
            new THREE.Vector3(0, -s * 1.2, 0),
            new THREE.Vector3(-s * 1.2, 0, 0),
            new THREE.Vector3(-s * 1.2, 0, 0),
            new THREE.Vector3(0, s * 1.2, 0),
            // Center crosshair
            new THREE.Vector3(-s * 0.65, 0, 0),
            new THREE.Vector3(s * 0.65, 0, 0),
            new THREE.Vector3(0, -s * 0.65, 0),
            new THREE.Vector3(0, s * 0.65, 0),
          ];
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
          isLineSegments = true;
        } else if (kind === "perpendicular") {
          // Right-angle perpendicular symbol
          const pts = [
            new THREE.Vector3(-s, -s, 0),
            new THREE.Vector3(s, -s, 0),
            new THREE.Vector3(0, -s, 0),
            new THREE.Vector3(0, s, 0),
          ];
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
          isLineSegments = true;
        } else if (kind === "center" || kind === "origin") {
          // Ring
          markerGeo = new THREE.RingGeometry(radius * 0.55, radius * 0.85, 24);
        } else {
          // Endpoint: Square
          const pts = [
            new THREE.Vector3(-s, -s, 0),
            new THREE.Vector3(s, -s, 0),
            new THREE.Vector3(s, s, 0),
            new THREE.Vector3(-s, s, 0),
            new THREE.Vector3(-s, -s, 0),
          ];
          markerGeo = new THREE.BufferGeometry().setFromPoints(pts);
        }

        let marker: THREE.Object3D;
        if (markerGeo instanceof THREE.RingGeometry) {
          const mat = new THREE.MeshBasicMaterial({
            color,
            side: THREE.DoubleSide,
            depthTest: false,
            transparent: true,
            opacity: 0.95,
          });
          marker = new THREE.Mesh(markerGeo, mat);
        } else {
          const mat = new THREE.LineBasicMaterial({
            color,
            depthTest: false,
            transparent: true,
            opacity: 0.95,
          });
          marker = isLineSegments
            ? new THREE.LineSegments(markerGeo, mat)
            : new THREE.Line(markerGeo, mat);
        }

        if (basis) {
          marker.quaternion.copy(basis.quat);
          marker.position.copy(pt).addScaledVector(basis.normal, 0.08);
        } else {
          marker.quaternion.copy(ref.camera.quaternion);
          marker.position.copy(pt);
        }
        marker.renderOrder = 9999;
        ref.ctx.setPreview(marker, "snap-marker");
      };

      const setGuideLine = (
        p0: THREE.Vector3 | null,
        p1: THREE.Vector3 | null,
        color: number = 0xa855f7,
      ) => {
        if (!p0 || !p1) {
          ref.ctx.clearPreview("alignment-guide");
          return;
        }
        const geom = new THREE.BufferGeometry().setFromPoints([p0, p1]);
        const mat = new THREE.LineDashedMaterial({
          color,
          dashSize: 2.5,
          gapSize: 2,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
        });
        const line = new THREE.Line(geom, mat);
        line.computeLineDistances();
        line.renderOrder = 998;
        ref.ctx.setPreview(line, "alignment-guide");
      };

      if (opts?.grid === false) {
        showSnapMarker(null);
        setGuideLine(null, null);
        return { point: world.clone(), kind: "grid" };
      }

      if (basis) {
        // --- ADVANCED CAD SNAPPING ENGINE (CADCraft / SolveSpace / Shapr3D) ---
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(basis.normal, basis.origin);
        const ptOnPlane = plane.projectPoint(world, new THREE.Vector3());
        const delta = ptOnPlane.clone().sub(basis.origin);
        let uCoord = delta.dot(basis.u);
        let vCoord = delta.dot(basis.v);

        let bestPt: THREE.Vector3 | null = null;
        let bestKind: SnapKind = "endpoint";
        let bestDist = endpointTolerance;

        // Check active in-progress chain points (allows easy closing of loops & snapping to chain vertices)
        if (opts?.extraPoints && opts.extraPoints.length > 0) {
          for (const ep of opts.extraPoints) {
            const d = ep.distanceTo(ptOnPlane);
            if (d <= endpointTolerance && d < bestDist) {
              bestDist = d;
              bestPt = ep.clone();
              bestKind = "endpoint";
            }
          }
        }

        // 1. Check Sketch Plane Origin (0,0)
        if (Math.hypot(uCoord, vCoord) <= tolerance && Math.hypot(uCoord, vCoord) < bestDist) {
          bestDist = Math.hypot(uCoord, vCoord);
          bestPt = basis.origin.clone();
          bestKind = "origin";
        }

        // 2. Check Geometry features: endpoints, midpoints, circle centers, quadrants, intersections
        const scene = useArcStore.getState().scene;
        const guidePoints: { u: number; v: number; pt: THREE.Vector3 }[] = [];

        interface PlaneSeg {
          a: [number, number];
          b: [number, number];
          pA: THREE.Vector3;
          pB: THREE.Vector3;
        }
        const planeSegments: PlaneSeg[] = [];

        if (scene) {
          const vA = new THREE.Vector3();
          const vB = new THREE.Vector3();
          const mid = new THREE.Vector3();
          for (const entity of scene.entities) {
            if (!entity.visible) continue;
            const obj = ref.objects.get(entity.id);
            if (!obj || !obj.visible) continue;
            obj.updateMatrixWorld();

            // Candidate entity center
            const center3D = new THREE.Vector3(...entity.transform.position);
            const centerDist = center3D.distanceTo(ptOnPlane);
            if (centerDist <= bestDist * 0.85) {
              bestDist = centerDist;
              bestPt = center3D;
              bestKind = "center";
            }
            const cRel = center3D.clone().sub(basis.origin);
            const cu = cRel.dot(basis.u);
            const cv = cRel.dot(basis.v);
            guidePoints.push({ u: cu, v: cv, pt: center3D });

            // Check circle quadrants (top, bottom, left, right)
            const geom = entity.geometry as Record<string, unknown>;
            if (
              (geom.type === "circle_curve" || geom.type === "circle") &&
              typeof geom.radius === "number" &&
              geom.radius > 1e-4
            ) {
              const r = geom.radius;
              const quads: [number, number][] = [
                [cu + r, cv],
                [cu - r, cv],
                [cu, cv + r],
                [cu, cv - r],
              ];
              for (const q of quads) {
                const dQ = Math.hypot(uCoord - q[0], vCoord - q[1]);
                if (dQ <= bestDist) {
                  bestDist = dQ;
                  bestKind = "quadrant";
                  bestPt = basis.origin
                    .clone()
                    .addScaledVector(basis.u, q[0])
                    .addScaledVector(basis.v, q[1]);
                }
              }
            }

            const pts = entity.lines;
            if (!pts || pts.length < 3) continue;
            for (let i = 0; i + 5 < pts.length; i += 6) {
              vA.set(pts[i], pts[i + 1], pts[i + 2]).applyMatrix4(obj.matrixWorld);
              vB.set(pts[i + 3], pts[i + 4], pts[i + 5]).applyMatrix4(obj.matrixWorld);

              const dA = vA.distanceTo(ptOnPlane);
              if (dA <= bestDist) {
                bestDist = dA;
                bestPt = vA.clone();
                bestKind = "endpoint";
              }
              const dB = vB.distanceTo(ptOnPlane);
              if (dB <= bestDist) {
                bestDist = dB;
                bestPt = vB.clone();
                bestKind = "endpoint";
              }
              mid.copy(vA).add(vB).multiplyScalar(0.5);
              const dMid = mid.distanceTo(ptOnPlane);
              if (dMid <= bestDist * 0.9) {
                bestDist = dMid;
                bestPt = mid.clone();
                bestKind = "midpoint";
              }

              const relA = vA.clone().sub(basis.origin);
              const uA = relA.dot(basis.u);
              const vA_ = relA.dot(basis.v);
              guidePoints.push({ u: uA, v: vA_, pt: vA.clone() });

              const relB = vB.clone().sub(basis.origin);
              const uB = relB.dot(basis.u);
              const vB_ = relB.dot(basis.v);

              const relMid = mid.clone().sub(basis.origin);
              guidePoints.push({ u: relMid.dot(basis.u), v: relMid.dot(basis.v), pt: mid.clone() });

              planeSegments.push({
                a: [uA, vA_],
                b: [uB, vB_],
                pA: vA.clone(),
                pB: vB.clone(),
              });
            }
          }

          // 3. Check segment-segment intersections (CADCraft / SolveSpace)
          if (planeSegments.length >= 2) {
            const maxSegs = Math.min(planeSegments.length, 60);
            for (let i = 0; i < maxSegs; i++) {
              for (let j = i + 1; j < maxSegs; j++) {
                const intUV = intersectSegments2D(
                  planeSegments[i].a,
                  planeSegments[i].b,
                  planeSegments[j].a,
                  planeSegments[j].b,
                );
                if (intUV) {
                  const dInt = Math.hypot(uCoord - intUV[0], vCoord - intUV[1]);
                  if (dInt <= bestDist * 1.05) {
                    bestDist = dInt;
                    bestKind = "intersection";
                    bestPt = basis.origin
                      .clone()
                      .addScaledVector(basis.u, intUV[0])
                      .addScaledVector(basis.v, intUV[1]);
                  }
                }
              }
            }
          }

          // 4. Perpendicular Foot Snap when drafting from an anchor (CADCraft)
          if (opts?.anchor && !bestPt) {
            const ancDelta = opts.anchor.clone().sub(basis.origin);
            const ancU = ancDelta.dot(basis.u);
            const ancV = ancDelta.dot(basis.v);
            for (const seg of planeSegments) {
              const proj = projectPointToSegment2D([ancU, ancV], seg.a, seg.b);
              const dFoot = Math.hypot(uCoord - proj.point[0], vCoord - proj.point[1]);
              if (dFoot <= endpointTolerance && proj.t > 0.05 && proj.t < 0.95) {
                bestPt = basis.origin
                  .clone()
                  .addScaledVector(basis.u, proj.point[0])
                  .addScaledVector(basis.v, proj.point[1]);
                bestKind = "perpendicular";
                break;
              }
            }
          }

          // 4b. Tangent Snap to Circles/Arcs when drafting from an anchor
          if (opts?.anchor && !bestPt) {
            const ancDelta = opts.anchor.clone().sub(basis.origin);
            const ancU = ancDelta.dot(basis.u);
            const ancV = ancDelta.dot(basis.v);
            for (const entity of scene?.entities ?? []) {
              if (!entity.visible || entity.locked) continue;
              const g = entity.geometry as Record<string, unknown>;
              if (g.type === "circle_curve" || g.type === "circle") {
                const r = Number(g.radius ?? 0);
                if (r > 0) {
                  const cPos = new THREE.Vector3(...entity.transform.position).sub(basis.origin);
                  const cu = cPos.dot(basis.u);
                  const cv = cPos.dot(basis.v);
                  const dToCenter = Math.hypot(ancU - cu, ancV - cv);
                  if (dToCenter > r) {
                    const th = Math.atan2(ancV - cv, ancU - cu);
                    const alpha = Math.acos(r / dToCenter);
                    const t1: [number, number] = [cu + r * Math.cos(th + alpha), cv + r * Math.sin(th + alpha)];
                    const t2: [number, number] = [cu + r * Math.cos(th - alpha), cv + r * Math.sin(th - alpha)];
                    for (const tp of [t1, t2]) {
                      const dCursor = Math.hypot(uCoord - tp[0], vCoord - tp[1]);
                      if (dCursor <= endpointTolerance * 1.5) {
                        bestPt = basis.origin.clone().addScaledVector(basis.u, tp[0]).addScaledVector(basis.v, tp[1]);
                        bestKind = "tangent";
                        break;
                      }
                    }
                  }
                }
              }
              if (bestPt) break;
            }
          }
        }

        if (bestPt) {
          showSnapMarker(bestPt, bestKind);
          setGuideLine(null, null);
          return { point: bestPt, kind: bestKind };
        }

        // 5. Polar Tracking / Magnetic Angle Snapping (CADCraft & AutoCAD style)
        if (opts?.anchor && opts.allowPolar !== false) {
          const ancDelta = opts.anchor.clone().sub(basis.origin);
          const ancU = ancDelta.dot(basis.u);
          const ancV = ancDelta.dot(basis.v);
          const du = uCoord - ancU;
          const dv = vCoord - ancV;
          const dist = Math.hypot(du, dv);
          if (dist > tolerance * 1.5) {
            const angleDeg = (Math.atan2(dv, du) * 180) / Math.PI;
            const snappedAngle = snapPolarAngle(angleDeg, 3.5);
            if (snappedAngle !== null) {
              const rad = (snappedAngle * Math.PI) / 180;
              const snappedU = ancU + dist * Math.cos(rad);
              const snappedV = ancV + dist * Math.sin(rad);
              const polarPt = basis.origin
                .clone()
                .addScaledVector(basis.u, snappedU)
                .addScaledVector(basis.v, snappedV);
              const farPt = basis.origin
                .clone()
                .addScaledVector(basis.u, ancU + Math.max(dist * 1.6, 250) * Math.cos(rad))
                .addScaledVector(basis.v, ancV + Math.max(dist * 1.6, 250) * Math.sin(rad));
              setGuideLine(opts.anchor, farPt);
              showSnapMarker(polarPt, "polar");
              return { point: polarPt, kind: "polar", polarAngle: snappedAngle };
            }
          }
        }

        // 6. Shapr3D Inference Alignment Guidelines (horizontal & vertical extension lines)
        const alignTol = Math.max(tolerance * 1.3, gridSize * 0.35, 14 * unitsPerPx);

        // Check alignment with sketch plane origin axes (U = 0 or V = 0)
        const nearUZero = Math.abs(uCoord) <= alignTol;
        const nearVZero = Math.abs(vCoord) <= alignTol;

        if (nearUZero && nearVZero) {
          const originPt = basis.origin.clone();
          setGuideLine(null, null);
          showSnapMarker(originPt, "origin");
          return { point: originPt, kind: "origin" };
        }

        if (nearUZero) {
          // Snapped to V axis (U = 0)
          const snappedV = snapCoord(vCoord, gridSize, snapEnabled);
          const axisPt = basis.origin.clone().addScaledVector(basis.v, snappedV);
          const pStart = basis.origin.clone().addScaledVector(basis.v, -1000);
          const pEnd = basis.origin.clone().addScaledVector(basis.v, 1000);
          setGuideLine(pStart, pEnd, 0x22c55e); // Green V-axis
          showSnapMarker(axisPt, "axis", 0x22c55e);
          return { point: axisPt, kind: "axis" };
        }

        if (nearVZero) {
          // Snapped to U axis (V = 0)
          const snappedU = snapCoord(uCoord, gridSize, snapEnabled);
          const axisPt = basis.origin.clone().addScaledVector(basis.u, snappedU);
          const pStart = basis.origin.clone().addScaledVector(basis.u, -1000);
          const pEnd = basis.origin.clone().addScaledVector(basis.u, 1000);
          setGuideLine(pStart, pEnd, 0xef4444); // Red U-axis
          showSnapMarker(axisPt, "axis", 0xef4444);
          return { point: axisPt, kind: "axis" };
        }

        // Check alignment with any existing guidepoint
        if (snapEnabled) {
          for (const gp of guidePoints) {
            if (Math.abs(uCoord - gp.u) <= alignTol) {
              const snappedV = snapCoord(vCoord, gridSize, snapEnabled);
              const alignedTargetPt = basis.origin
                .clone()
                .addScaledVector(basis.u, gp.u)
                .addScaledVector(basis.v, snappedV);
              setGuideLine(gp.pt, alignedTargetPt, 0xa855f7);
              showSnapMarker(alignedTargetPt, "aligned", 0xa855f7);
              return { point: alignedTargetPt, kind: "aligned" };
            } else if (Math.abs(vCoord - gp.v) <= alignTol) {
              const snappedU = snapCoord(uCoord, gridSize, snapEnabled);
              const alignedTargetPt = basis.origin
                .clone()
                .addScaledVector(basis.u, snappedU)
                .addScaledVector(basis.v, gp.v);
              setGuideLine(gp.pt, alignedTargetPt, 0xa855f7);
              showSnapMarker(alignedTargetPt, "aligned", 0xa855f7);
              return { point: alignedTargetPt, kind: "aligned" };
            }
          }
        }
        setGuideLine(null, null);

        // 7. Snap coordinates to plane grid
        const snappedU = snapCoord(uCoord, gridSize, snapEnabled);
        const snappedV = snapCoord(vCoord, gridSize, snapEnabled);
        const snappedPt = basis.origin
          .clone()
          .addScaledVector(basis.u, snappedU)
          .addScaledVector(basis.v, snappedV);

        showSnapMarker(null);
        return { point: snappedPt, kind: "grid" };
      }

      // --- 3D VIEWPORT SNAPPING (when not in 2D sketch mode) ---
      const axisTol = Math.max(tolerance * 1.35, 14 * unitsPerPx, gridSize * 0.35);

      // 1. Check true 3D Origin (0, 0, 0)
      const trueOrigin = new THREE.Vector3(0, 0, 0);
      if (world.distanceTo(trueOrigin) <= axisTol * 1.25) {
        setGuideLine(null, null);
        showSnapMarker(trueOrigin, "origin");
        return { point: trueOrigin, kind: "origin" };
      }

      // 2. Check sketch & solid vertices, midpoints, and centers BEFORE axis lines!
      let best: THREE.Vector3 | null = null;
      let bestKind: SnapKind = "endpoint";
      let bestDist = endpointTolerance;
      const scene = useArcStore.getState().scene;
      if (scene) {
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
        setGuideLine(null, null);
        showSnapMarker(best, bestKind);
        return { point: best, kind: bestKind };
      }

      // 3. Primary 3D Axes Snapping (X, Y, Z axes)
      const distToXAxis = Math.hypot(world.y, world.z);
      const distToYAxis = Math.hypot(world.x, world.z);
      const distToZAxis = Math.hypot(world.x, world.y);

      // Determine if cursor is closest to X, Y, or Z axis
      if (distToYAxis <= axisTol && distToYAxis <= distToXAxis && distToYAxis <= distToZAxis) {
        // Y-axis (vertical green)
        const snappedY = snapCoord(world.y, gridSize, snapEnabled);
        const pt = new THREE.Vector3(0, snappedY, 0);
        setGuideLine(new THREE.Vector3(0, -1000, 0), new THREE.Vector3(0, 1000, 0), 0x22c55e);
        showSnapMarker(pt, "axis", 0x22c55e);
        return { point: pt, kind: "axis" };
      }

      if (distToXAxis <= axisTol && distToXAxis <= distToZAxis) {
        // X-axis (red)
        const snappedX = snapCoord(world.x, gridSize, snapEnabled);
        const pt = new THREE.Vector3(snappedX, 0, 0);
        setGuideLine(new THREE.Vector3(-1000, 0, 0), new THREE.Vector3(1000, 0, 0), 0xef4444);
        showSnapMarker(pt, "axis", 0xef4444);
        return { point: pt, kind: "axis" };
      }

      if (distToZAxis <= axisTol) {
        // Z-axis (blue)
        const snappedZ = snapCoord(world.z, gridSize, snapEnabled);
        const pt = new THREE.Vector3(0, 0, snappedZ);
        setGuideLine(new THREE.Vector3(0, 0, -1000), new THREE.Vector3(0, 0, 1000), 0x3b82f6);
        showSnapMarker(pt, "axis", 0x3b82f6);
        return { point: pt, kind: "axis" };
      }

      // 4. Ground / Horizontal Plane Axes Lines (when drafting at a specific plane height, e.g. Y = world.y)
      if (Math.abs(world.z) <= axisTol) {
        const snappedX = snapCoord(world.x, gridSize, snapEnabled);
        const snappedY = snapCoord(world.y, gridSize, snapEnabled);
        const pt = new THREE.Vector3(snappedX, snappedY, 0);
        setGuideLine(new THREE.Vector3(-1000, snappedY, 0), new THREE.Vector3(1000, snappedY, 0), 0xef4444);
        showSnapMarker(pt, "axis", 0xef4444);
        return { point: pt, kind: "axis" };
      }
      if (Math.abs(world.x) <= axisTol) {
        const snappedY = snapCoord(world.y, gridSize, snapEnabled);
        const snappedZ = snapCoord(world.z, gridSize, snapEnabled);
        const pt = new THREE.Vector3(0, snappedY, snappedZ);
        setGuideLine(new THREE.Vector3(0, snappedY, -1000), new THREE.Vector3(0, snappedY, 1000), 0x3b82f6);
        showSnapMarker(pt, "axis", 0x3b82f6);
        return { point: pt, kind: "axis" };
      }

      setGuideLine(null, null);
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

    createEntity(geometry, position, name, rotation) {
      const docId = activeDoc();
      if (!docId) return Promise.resolve(null);
      ref.lastCommitAt = performance.now();
      return ipc
        .createEntity(docId, geometry, name)
        .then(({ id }) => {
          const rot = rotation ?? [0, 0, 0, 1];
          const needsPlace =
            position[0] !== 0 ||
            position[1] !== 0 ||
            position[2] !== 0 ||
            rot[0] !== 0 ||
            rot[1] !== 0 ||
            rot[2] !== 0 ||
            rot[3] !== 1;
          const placed = needsPlace
            ? ipc
                .setTransform(
                  docId,
                  [
                    {
                      id,
                      transform: {
                        position,
                        rotation: rot,
                        scale: [1, 1, 1],
                      },
                    },
                  ],
                  true,
                )
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
