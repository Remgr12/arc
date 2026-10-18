import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Circle, Minus, RectangleHorizontal, Waypoints } from "lucide-react";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { useThemeStore, viewportPalette, type ViewportPalette } from "../lib/themes";
import { ViewCube } from "../lib/viewcube";
import { DEFAULT_GEOMETRY, MULTI_POINT_TOOLS } from "../data/tools";
import { IconButton } from "./ui";
import type { EntityData, Geometry, LayerData, SceneData, SketchShape, ToolId } from "../lib/types";

interface ViewPalette {
  bg: THREE.Color;
  grid: THREE.Color;
  gridLine: THREE.Color;
  selection: THREE.Color;
  hover: THREE.Color;
  line: THREE.Color;
}

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

interface DraftCommit {
  geometry: Geometry;
  position: [number, number, number];
}

interface ShapeBuild {
  commit: DraftCommit;
  preview: THREE.Object3D;
}

interface DragDraft {
  shape: string;
  start: THREE.Vector3;
  pressX: number;
  pressY: number;
  built: ShapeBuild | null;
}

interface ViewportRefs {
  host: HTMLDivElement;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  sceneRoot: THREE.Scene;
  entityRoot: THREE.Group;
  gridNode: THREE.GridHelper;
  axes: THREE.AxesHelper;
  raycaster: THREE.Raycaster;
  draftNode: THREE.LineSegments;
  columnMaterial: THREE.MeshStandardMaterial;
  lineMaterial: THREE.LineBasicMaterial;
  objects: Map<string, THREE.Object3D>;
  draftPoints: THREE.Vector3[];
  dragging: EntityData | null;
  dragOffset: THREE.Vector3;
  dragMoved: boolean;
  dragDraft: DragDraft | null;
  dragPreview: THREE.Object3D | null;
  lastTool: ToolId | null;
  lastCommitAt: number;
  lastScene: SceneData | null;
  lastHover: string | null;
  lastCursorAt: number;
  disposed: boolean;
  gizmo: ViewCube;
  viewAnim: ViewAnim | null;
  palette: ViewPalette;
}

const DRAG_SHAPES: ReadonlySet<string> = new Set([
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
  "circle",
  "rectangle",
]);

const SKETCH_SHAPES: ReadonlySet<string> = new Set(["line", "polyline", "rectangle", "circle"]);

const SKETCH_UI: { shape: SketchShape; label: string; hint: string; icon: typeof Minus }[] = [
  { shape: "line", label: "Line", hint: "Line: click two points", icon: Minus },
  { shape: "polyline", label: "Polyline", hint: "Polyline: click points, Enter to finish", icon: Waypoints },
  { shape: "rectangle", label: "Rectangle", hint: "Rectangle: drag corner to corner", icon: RectangleHorizontal },
  { shape: "circle", label: "Circle", hint: "Circle: drag from center to radius", icon: Circle },
];

function messageForSketchShape(shape: SketchShape): string {
  switch (shape) {
    case "line":
      return "Sketch Line · click two points · Esc exits";
    case "polyline":
      return "Sketch Polyline · click to add points · Enter finishes · Esc exits";
    case "rectangle":
      return "Sketch Rectangle · drag corner to corner · Esc exits";
    case "circle":
      return "Sketch Circle · drag from center to radius · Esc exits";
  }
}

function hintForTool(tool: ToolId): string {
  switch (tool) {
    case "sketch":
      return "Sketch mode";
    case "line":
      return "Line · click two points · Enter finishes · Esc cancels";
    case "polyline":
      return "Polyline · click to add points · Enter finishes · Esc cancels";
    case "dimension":
      return "Dimension · click two points · Enter finishes · Esc cancels";
    case "wall":
      return "Wall · click to add points · Enter finishes · Esc cancels";
    case "box":
    case "sphere":
    case "cylinder":
    case "cone":
    case "torus":
    case "plane":
    case "circle":
    case "rectangle":
      return "Click to place, or drag to size";
    default:
      return "";
  }
}

/** The main editor viewport. Handles navigation, picking and tools. */
export function Viewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const tool = useArcStore((s) => s.tool);
  const sketchShape = useArcStore((s) => s.sketchShape);

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    const ref = createViewport(host, labels);
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
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={hostRef} className="h-full w-full" />
      {tool === "sketch" && (
        <div className="absolute left-1/2 top-2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-md border border-base-300 bg-base-100/95 py-1 pl-2 pr-1 shadow-md">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
            Sketch
          </span>
          {SKETCH_UI.map((item) => {
            const Icon = item.icon;
            return (
              <IconButton
                key={item.shape}
                icon={<Icon size={14} />}
                title={item.hint}
                active={sketchShape === item.shape}
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent<SketchShape>("arc-sketch-shape", { detail: item.shape }),
                  )
                }
              />
            );
          })}
        </div>
      )}
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
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

function makeGrid(p: ViewportPalette): THREE.GridHelper {
  const grid = new THREE.GridHelper(
    4000,
    200,
    new THREE.Color(p.grid).getHex(),
    new THREE.Color(p.gridLine).getHex(),
  );
  (grid.material as THREE.Material).depthWrite = false;
  return grid;
}

function applyTheme(ref: ViewportRefs, palette: ViewportPalette): void {
  ref.palette = themeToPalette(palette);
  ref.sceneRoot.background = ref.palette.bg;
  ref.sceneRoot.fog = new THREE.Fog(palette.bg, 5000, 16000);
  const draftMat = ref.draftNode.material as THREE.LineBasicMaterial;
  draftMat.color.copy(ref.palette.line);
  const index = ref.sceneRoot.children.indexOf(ref.gridNode);
  const wasVisible = ref.gridNode.visible;
  ref.sceneRoot.remove(ref.gridNode);
  ref.gridNode.dispose();
  const next = makeGrid(palette);
  next.visible = wasVisible;
  if (index >= 0) ref.sceneRoot.children.splice(index, 0, next);
  else ref.sceneRoot.add(next);
  ref.gridNode = next;
  ref.gizmo.applyTheme(palette);
}

let currentRef: ViewportRefs | null = null;

function createViewport(host: HTMLDivElement, labels: HTMLElement): ViewportRefs {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(host.clientWidth || 800, host.clientHeight || 600);
  renderer.autoClear = false;
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
  sceneRoot.add(dirLight);
  sceneRoot.add(new THREE.AmbientLight(0xffffff, 0.22));

  const entityRoot = new THREE.Group();
  sceneRoot.add(entityRoot);

  const axes = new THREE.AxesHelper(240);
  axes.position.y = 0.2;
  sceneRoot.add(axes);

  const draftGeometry = new THREE.BufferGeometry();
  draftGeometry.setAttribute("position", new THREE.Float32BufferAttribute([], 3));
  const draftNode = new THREE.LineSegments(
    draftGeometry,
    new THREE.LineBasicMaterial({ color: viewPalette.line }),
  );
  draftNode.visible = false;
  draftNode.renderOrder = 999;
  draftNode.frustumCulled = false;
  sceneRoot.add(draftNode);

  const ref: ViewportRefs = {
    host,
    renderer,
    camera,
    controls,
    sceneRoot,
    entityRoot,
    gridNode: makeGrid(palette),
    axes,
    raycaster: new THREE.Raycaster(),
    draftNode,
    columnMaterial: new THREE.MeshStandardMaterial({
      roughness: 0.5,
      metalness: 0.05,
      side: THREE.DoubleSide,
    }),
    lineMaterial: new THREE.LineBasicMaterial(),
    objects: new Map(),
    draftPoints: [],
    dragging: null,
    dragOffset: new THREE.Vector3(),
    dragMoved: false,
    dragDraft: null,
    dragPreview: null,
    lastTool: null,
    lastCommitAt: 0,
    lastScene: null,
    lastHover: null,
    lastCursorAt: 0,
    disposed: false,
    gizmo: null as unknown as ViewCube,
    viewAnim: null,
    palette: viewPalette,
  };

  ref.gizmo = new ViewCube(renderer.domElement, (normal) => focusPlane(ref, normal), labels);
  currentRef = ref;

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
  });
  ro.observe(ref.host);

  let raf = 0;
  const tick = () => {
    if (ref.disposed) return;

    // Camera flight (gizmo plane focus or fit-view).
    if (ref.viewAnim) {
      const anim = ref.viewAnim;
      const t = Math.min(1, (performance.now() - anim.start) / anim.duration);
      const k = t * t * (3 - 2 * t);
      if (anim.dirFrom && anim.dirTo && anim.radius !== undefined) {
        const dir = slerpDir(anim.dirFrom, anim.dirTo, k);
        ref.camera.position.copy(ref.controls.target).addScaledVector(dir, anim.radius);
      } else if (anim.posFrom && anim.posTo && anim.targetFrom && anim.targetTo) {
        ref.camera.position.lerpVectors(anim.posFrom, anim.posTo, k);
        ref.controls.target.lerpVectors(anim.targetFrom, anim.targetTo, k);
      }
      if (t >= 1) ref.viewAnim = null;
    }

    ref.controls.update();
    ref.renderer.clear();
    ref.renderer.render(ref.sceneRoot, ref.camera);
    const w = ref.host.clientWidth;
    const h = ref.host.clientHeight;
    if (w > 0 && h > 0) ref.gizmo.render(ref.renderer, ref.camera, w, h);
    raf = requestAnimationFrame(tick);
  };
  tick();
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
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
    // Keep OrbitControls happy: nudge the pole slightly off-axis.
    dirTo.set(0.0008, dirTo.y > 0 ? 1 : -1, 0).normalize();
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

// -------------------------------------------------------------- scene sync

function syncSceneToThree(ref: ViewportRefs): void {
  const state = useArcStore.getState();
  const scene = state.scene;
  const hoverChanged = state.hoverEntity !== ref.lastHover;
  const sceneChanged = scene !== ref.lastScene;

  if (sceneChanged) {
    ref.lastScene = scene;
    if (scene) rebuildEntities(ref, scene);
  } else if (hoverChanged && scene) {
    // Targeted update: only re-present the entities whose hover changed.
    const layers = new Map(scene.layers.map((l) => [l.id, l]));
    for (const id of [ref.lastHover, state.hoverEntity]) {
      if (!id) continue;
      const obj = ref.objects.get(id);
      const entity = scene.entities.find((e) => e.id === id);
      if (obj && entity) present(ref, obj, entity, layers, scene);
    }
  }
  ref.lastHover = state.hoverEntity;

  const settings = state.settings;
  ref.gridNode.visible = settings?.show_grid ?? true;
  ref.axes.visible = settings?.show_axes ?? true;
  const tool = state.tool;
  if (tool !== ref.lastTool) {
    ref.lastTool = tool;
    clearDraftState(ref);
    ref.renderer.domElement.style.cursor = MULTI_POINT_TOOLS.has(tool) ? "crosshair" : "";
    storeHint(tool);
  }
}

function storeHint(tool: ToolId): void {
  let hint = hintForTool(tool);
  if (tool === "sketch") {
    hint = `${hint} · ${messageForSketchShape(useArcStore.getState().sketchShape)}`;
  }
  if (hint) useArcStore.getState().setStatusMessage(hint);
}

function rebuildEntities(ref: ViewportRefs, scene: SceneData): void {
  const layers = new Map<string, LayerData>(scene.layers.map((l) => [l.id, l]));
  const byId = new Set(scene.entities.map((e) => e.id));
  for (const [id, obj] of ref.objects) {
    if (!byId.has(id)) {
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
  const hovered = useArcStore.getState().hoverEntity === entity.id;
  const color = entityColor(entity, layers);
  const colorHex = color.getHex();
  const visible = entity.visible && layerVisible(layer);

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
    pos: [...pos] as [number, number, number],
    rot: [...rot] as [number, number, number, number],
    scl: [...scl] as [number, number, number],
  };

  obj.position.set(...entity.transform.position);
  obj.quaternion.set(...entity.transform.rotation);
  obj.userData.realScale = [...entity.transform.scale] as [number, number, number];
  const spawnAt = obj.userData.spawnAt as number | undefined;
  if (spawnAt === undefined) {
    obj.scale.set(...entity.transform.scale);
  } else {
    applySpawnScale(obj, performance.now());
  }
  obj.visible = visible;
  obj.updateMatrix();

  const mesh = obj as THREE.Mesh;
  if (mesh.isMesh) {
    const mat = mesh.material as THREE.MeshStandardMaterial;
    mat.color.copy(color);
    if (entity.locked) mat.opacity = 0.55;
    else mat.opacity = 1.0;
    mat.transparent = entity.locked;
    mat.emissive.copy(selected ? ref.palette.selection : hovered ? ref.palette.hover : BLACK);
    mat.emissiveIntensity = selected ? 0.45 : hovered ? 0.16 : 0;
  } else if ((obj as THREE.Line).isLine) {
    const mat = (obj as THREE.Line).material as THREE.LineBasicMaterial;
    mat.color.copy(selected ? ref.palette.line : color);
    mat.opacity = entity.locked ? 0.5 : 1;
    mat.transparent = entity.locked;
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

// -------------------------------------------------------------- interaction

function localPoint(event: PointerEvent | MouseEvent): { x: number; y: number } {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
    y: -((event.clientY - rect.top) / rect.height) * 2 + 1,
  };
}

function rayAt(ref: ViewportRefs, point: { x: number; y: number }): THREE.Ray {
  ref.raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), ref.camera);
  const ray = ref.raycaster.ray.clone();
  return ray;
}

function pointOnHorizontalPlane(ray: THREE.Ray, height: number): THREE.Vector3 | null {
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -height);
  const out = new THREE.Vector3();
  const hit = ray.intersectPlane(plane, out);
  return hit ? out : null;
}

function pickEntityAt(ref: ViewportRefs, point: { x: number; y: number }): string | null {
  ref.raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), ref.camera);
  const hits = ref.raycaster.intersectObjects(Array.from(ref.objects.values()), false);
  const hit = hits.find((candidate) => candidate.object.visible);
  return hit ? (hit.object.userData.entityId as string) : null;
}

function snapCoord(value: number, gridSize: number, enabled: boolean): number {
  return enabled ? Math.round(value / gridSize) * gridSize : value;
}

function attachHandlers(ref: ViewportRefs): () => void {
  const el = ref.renderer.domElement;

  const down = (event: PointerEvent) => onPointerDown(ref, event);
  const move = (event: PointerEvent) => onPointerMove(ref, event);
  const up = (event: PointerEvent) => onPointerUp(ref, event);
  const cancel = (event: PointerEvent) => {
    if (ref.dragging) {
      try {
        (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      ref.dragging = null;
      ref.dragMoved = false;
    }
    clearDraftState(ref);
  };
  const dbl = (event: MouseEvent) => onDoubleClick(ref, event);
  const ctx = (event: Event) => event.preventDefault();
  const wheel = () => {
    ref.viewAnim = null;
  };
  const sketchShape = (event: Event) => {
    const shape = (event as CustomEvent<SketchShape>).detail;
    if (!shape || !(SKETCH_SHAPES as ReadonlySet<string>).has(shape)) return;
    const store = useArcStore.getState();
    store.setSketchShape(shape);
    clearDraftState(ref);
    store.setStatusMessage(messageForSketchShape(shape));
  };
  const draftCancel = () => {
    clearDraftState(ref);
    const store = useArcStore.getState();
    if (store.tool === "sketch") {
      store.setTool("select");
      store.setStatusMessage("Sketch exited");
    } else {
      store.setStatusMessage("Draft cancelled");
    }
  };
  const draftEnter = () => {
    if (!commitCurrentDraft(ref)) {
      useArcStore.getState().setStatusMessage("Nothing to finish · add more points or press Esc");
    }
  };
  const draftBackspace = () => {
    if (ref.draftPoints.length === 0) return;
    ref.draftPoints.pop();
    setDraft(ref, [...ref.draftPoints]);
    if (ref.draftPoints.length === 0) useArcStore.getState().setDrafting(false);
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("dblclick", dbl);
  el.addEventListener("wheel", wheel, { passive: true });
  el.addEventListener("contextmenu", ctx);
  window.addEventListener("arc-sketch-shape", sketchShape);
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

  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("dblclick", dbl);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("contextmenu", ctx);
    window.removeEventListener("arc-sketch-shape", sketchShape);
    window.removeEventListener("arc-draft-cancel", draftCancel);
    window.removeEventListener("arc-draft-enter", draftEnter);
    window.removeEventListener("arc-draft-backspace", draftBackspace);
    window.removeEventListener("arc-fit-view", fit);
    window.removeEventListener("arc-focus-entity", focus);
  };
}

function activeDoc(): string {
  return useArcStore.getState().overview?.active ?? "";
}

function onPointerDown(ref: ViewportRefs, event: PointerEvent): void {
  ref.viewAnim = null;
  if (event.button === 0) {
    const store = useArcStore.getState();
    if (ref.gizmo.onPointerDown(event, ref.host.clientWidth, ref.host.clientHeight, ref.controls.target, ref.camera)) {
      if (store.hoverEntity) store.setHoverEntity(null);
      return;
    }
  }
  if (event.button !== 0) return;
  const store = useArcStore.getState();
  const scene = store.scene;
  if (!scene) return;
  const docId = activeDoc();
  const point = localPoint(event);
  const tool = store.tool;

  if (tool === "select" || tool === "move") {
    const entityId = pickEntityAt(ref, point);
    const entity = entityId ? scene.entities.find((e) => e.id === entityId) : null;
    if (entityId && entity && !entity.locked) {
      let selection = scene.selection;
      if (event.shiftKey) {
        selection = selection.includes(entityId)
          ? selection.filter((id) => id !== entityId)
          : [...selection, entityId];
      } else if (!selection.includes(entityId)) {
        selection = [entityId];
      }
      const primary = selection[selection.length - 1] ?? null;
      void ipc.setSelection(docId, selection, primary);
      void store.setStatusMessage(`${selection.length} selected`);
      if (tool === "move") {
        const ray = rayAt(ref, point);
        const hit = pointOnHorizontalPlane(ray, entity.transform.position[1]);
        if (hit) {
          ref.dragging = entity;
          ref.dragOffset
            .set(...entity.transform.position)
            .sub(hit);
          ref.dragMoved = false;
          (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        }
      }
      return;
    }
    if (!event.shiftKey) void ipc.setSelection(docId, [], null);
    return;
  }

  // creation or sketch tools: place on the ground plane
  const ray = rayAt(ref, point);
  const hit = pointOnHorizontalPlane(ray, 0);
  if (!hit) return;
  const gridSize = store.settings?.grid_size ?? 10;
  const snapOn = store.settings?.snap_enabled ?? true;
  const snapped = new THREE.Vector3(
    snapCoord(hit.x, gridSize, snapOn),
    0,
    snapCoord(hit.z, gridSize, snapOn),
  );

  const sketching = tool === "sketch";
  const shape = sketching ? store.sketchShape : tool;
  const draftingPoints = sketching
    ? shape === "line" || shape === "polyline"
    : MULTI_POINT_TOOLS.has(tool);

  if (draftingPoints) {
    ref.draftPoints.push(snapped);
    setDraft(ref, [...ref.draftPoints]);
    if (!store.drafting) store.setDrafting(true);
    store.setStatusMessage("Click to add points · Enter finishes · Esc cancels");
    if ((tool === "line" || tool === "dimension" || (sketching && shape === "line")) && ref.draftPoints.length >= 2) {
      commitCurrentDraft(ref);
    }
    return;
  }

  if ((DRAG_SHAPES as ReadonlySet<string>).has(shape)) {
    ref.dragDraft = {
      shape,
      start: snapped.clone(),
      pressX: event.clientX,
      pressY: event.clientY,
      built: null,
    };
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    ref.renderer.domElement.style.cursor = "crosshair";
    if (!store.drafting) store.setDrafting(true);
    store.setStatusMessage("Drag to size · release to place");
    return;
  }

  const geometry = DEFAULT_GEOMETRY[tool as ToolId];
  if (!geometry) return;
  createCommitted(ref, {
    geometry,
    position: [snapped.x, sitY(geometry), snapped.z],
  });
}

function sitY(geometry: Geometry): number {
  switch (geometry.type) {
    case "box":
      return (Number(geometry.height) || 0) / 2;
    case "sphere":
      return Number(geometry.radius) || 0;
    case "torus":
      return Number(geometry.tube) || 0;
    default:
      return 0;
  }
}

function onPointerMove(ref: ViewportRefs, event: PointerEvent): void {
  const store = useArcStore.getState();
  const scene = store.scene;

  if (ref.dragging) {
    if (!scene) return;
    const point = localPoint(event);
    const ray = rayAt(ref, point);
    const hit = pointOnHorizontalPlane(ray, ref.dragging.transform.position[1]);
    if (!hit) return;
    const gridSize = store.settings?.grid_size ?? 10;
    const snapOn = store.settings?.snap_enabled ?? true;
    const moved = hit.add(ref.dragOffset);
    const target = new THREE.Vector3(
      snapCoord(moved.x, gridSize, snapOn),
      ref.dragging.transform.position[1],
      snapCoord(moved.z, gridSize, snapOn),
    );
    ref.dragMoved = true;
    const entityId = ref.dragging.id;
    const baseTransform = ref.dragging.transform;
    void ipc
      .setTransform(
        activeDoc(),
        [
          {
            id: entityId,
            transform: {
              ...baseTransform,
              position: [target.x, target.y, target.z],
            },
          },
        ],
        false,
      )
      .catch(() => undefined);
    return;
  }

  if (ref.dragDraft) {
    if (!scene) return;
    const point = localPoint(event);
    const hit = pointOnHorizontalPlane(rayAt(ref, point), 0);
    if (!hit) return;
    const gridSize = store.settings?.grid_size ?? 10;
    const snapOn = store.settings?.snap_enabled ?? true;
    const end = new THREE.Vector3(
      snapCoord(hit.x, gridSize, snapOn),
      0,
      snapCoord(hit.z, gridSize, snapOn),
    );
    const draft = ref.dragDraft;
    const built = buildShape(draft.shape, draft.start, end);
    if (!built) return;
    draft.built = built;
    setDragPreview(ref, built.preview);
    return;
  }

  // gizmo interaction (hover) only when not dragging an entity
  if (ref.gizmo.onPointerMove(event, ref.host.clientWidth, ref.host.clientHeight, ref.controls.target, ref.camera)) {
    if (store.hoverEntity) store.setHoverEntity(null);
    return;
  }

  if (!scene) return;
  const point = localPoint(event);

  if (MULTI_POINT_TOOLS.has(store.tool) && ref.draftPoints.length > 0) {
    const ray = rayAt(ref, point);
    const hit = pointOnHorizontalPlane(ray, 0);
    if (hit) {
      const gridSize = store.settings?.grid_size ?? 10;
      const snapOn = store.settings?.snap_enabled ?? true;
      const cursor = new THREE.Vector3(
        snapCoord(hit.x, gridSize, snapOn),
        0,
        snapCoord(hit.z, gridSize, snapOn),
      );
      setDraft(ref, [...ref.draftPoints, cursor]);
    }
    return;
  }

  if (store.tool === "select" || store.tool === "move") {
    const hovered = pickEntityAt(ref, point);
    if (hovered !== store.hoverEntity) store.setHoverEntity(hovered);
    // Throttle the coordinate readout; the TopBar re-renders otherwise.
    const now = performance.now();
    if (now - ref.lastCursorAt > 80) {
      ref.lastCursorAt = now;
      const world = pointOnHorizontalPlane(rayAt(ref, point), 0);
      if (world) store.setCursorWorld([world.x, 0, world.z]);
    }
  }
}

function onPointerUp(ref: ViewportRefs, event: PointerEvent): void {
  if (ref.dragging) {
    if (ref.dragMoved) {
      const entity = useArcStore.getState().scene?.entities.find((e) => e.id === ref.dragging?.id);
      if (entity) {
        void ipc
          .setTransform(activeDoc(), [{ id: entity.id, transform: entity.transform }], true)
          .catch(() => undefined);
      }
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // pointer may already be released
    }
    ref.dragging = null;
    ref.dragMoved = false;
    return;
  }

  if (ref.dragDraft) {
    commitDragDraft(ref, event);
    return;
  }

  if (event.button === 0 && ref.gizmo.onPointerUp(event, ref.host.clientWidth, ref.host.clientHeight)) {
    return;
  }
}

function commitDragDraft(ref: ViewportRefs, event: PointerEvent): void {
  const draft = ref.dragDraft;
  ref.dragDraft = null;
  try {
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
  } catch {
    // pointer may already be released
  }
  ref.renderer.domElement.style.cursor = "";
  useArcStore.getState().setDrafting(false);
  if (!draft) return;
  const hit = pointOnHorizontalPlane(rayAt(ref, localPoint(event)), 0);
  setDragPreview(ref, null);
  if (!hit) return;
  const store = useArcStore.getState();
  const gridSize = store.settings?.grid_size ?? 10;
  const snapOn = store.settings?.snap_enabled ?? true;
  const end = new THREE.Vector3(
    snapCoord(hit.x, gridSize, snapOn),
    0,
    snapCoord(hit.z, gridSize, snapOn),
  );
  const screenMoved = Math.hypot(event.clientX - draft.pressX, event.clientY - draft.pressY);
  if (end.distanceTo(draft.start) < gridSize / 2 && screenMoved < 6) {
    const geometry = DEFAULT_GEOMETRY[draft.shape as ToolId];
    if (geometry) {
      createCommitted(ref, {
        geometry,
        position: [draft.start.x, sitY(geometry), draft.start.z],
      });
      store.setStatusMessage("Default size placed · drag the next one to size it");
    }
    return;
  }
  const built = draft.built ?? buildShape(draft.shape, draft.start, end);
  if (!built) return;
  createCommitted(ref, built.commit);
  store.setStatusMessage("Placed");
}

function onDoubleClick(ref: ViewportRefs, event: MouseEvent): void {
  const store = useArcStore.getState();
  const scene = store.scene;
  if (!scene) return;

  if (ref.gizmo.hitTest(event, ref.host.clientWidth, ref.host.clientHeight)) return;
  if (performance.now() - ref.lastCommitAt < 300) return;

  if ((MULTI_POINT_TOOLS.has(store.tool) || (store.tool === "sketch" && store.sketchShape === "polyline")) && ref.draftPoints.length >= 2) {
    if (commitCurrentDraft(ref)) return;
  }

  const id = pickEntityAt(ref, localPoint(event));
  if (id) fitEntities(ref, [id]);
  else fitSelection(ref);
}

function setDraft(ref: ViewportRefs, points: THREE.Vector3[]): void {
  if (points.length === 0) {
    ref.draftNode.visible = false;
    return;
  }
  const segments: number[] = [];
  for (let i = 1; i < points.length; i++) {
    segments.push(points[i - 1].x, points[i - 1].y, points[i - 1].z);
    segments.push(points[i].x, points[i].y, points[i].z);
  }
  const geometry = ref.draftNode.geometry as THREE.BufferGeometry;
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(segments, 3));
  ref.draftNode.visible = true;
}

function setDragPreview(ref: ViewportRefs, preview: THREE.Object3D | null): void {
  if (ref.dragPreview) {
    ref.sceneRoot.remove(ref.dragPreview);
    disposeObject(ref.dragPreview);
    ref.dragPreview = null;
  }
  if (preview) {
    ref.dragPreview = preview;
    ref.sceneRoot.add(preview);
  }
}

function previewMeshMaterial(ref: ViewportRefs): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    transparent: true,
    opacity: 0.75,
    roughness: 0.5,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  material.color.copy(ref.palette.hover);
  return material;
}

function previewLineMaterial(ref: ViewportRefs): THREE.LineBasicMaterial {
  const material = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
  material.color.copy(ref.palette.line);
  return material;
}

function ringGeometryPoints(radius: number, segments: number): number[] {
  const points: number[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    points.push(radius * Math.cos(angle), 0, radius * Math.sin(angle));
  }
  return points;
}

function buildShape(shape: string, start: THREE.Vector3, end: THREE.Vector3): ShapeBuild | null {
  const ref = currentRef;
  if (!ref) return null;
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const geometry = {
    geometry: null as Geometry | null,
    position: null as [number, number, number] | null,
    preview: null as THREE.Object3D | null,
  };
  switch (shape) {
    case "box": {
      const width = Math.max(4, Math.abs(dx));
      const depth = Math.max(4, Math.abs(dz));
      const height = 20;
      geometry.geometry = { type: "box", width, depth, height, corner_radius: 0 };
      geometry.position = [(start.x + end.x) / 2, height / 2, (start.z + end.z) / 2];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), previewMeshMaterial(ref));
      mesh.position.set(...geometry.position);
      geometry.preview = mesh;
      break;
    }
    case "sphere": {
      const radius = Math.max(4, Math.hypot(dx, dz));
      geometry.geometry = { type: "sphere", radius, segments: 32 };
      geometry.position = [start.x, radius, start.z];
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), previewMeshMaterial(ref));
      mesh.position.set(...geometry.position);
      geometry.preview = mesh;
      break;
    }
    case "cylinder":
    case "cone": {
      const radius = Math.max(4, Math.hypot(dx, dz));
      const height = 40;
      geometry.geometry =
        shape === "cylinder"
          ? { type: "cylinder", radius, height, segments: 32 }
          : { type: "cone", radius, height, segments: 32 };
      geometry.position = [start.x, 0, start.z];
      const mesh = new THREE.Mesh(
        shape === "cylinder"
          ? new THREE.CylinderGeometry(radius, radius, height, 32)
          : new THREE.ConeGeometry(radius, height, 32),
        previewMeshMaterial(ref),
      );
      mesh.position.set(start.x, height / 2, start.z);
      geometry.preview = mesh;
      break;
    }
    case "torus": {
      const radius = Math.max(6, Math.hypot(dx, dz));
      const tube = Math.min(8, radius / 3);
      geometry.geometry = { type: "torus", radius, tube, segments: 32, tubular_segments: 16 };
      geometry.position = [start.x, tube, start.z];
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(radius, tube, 14, 48).rotateX(Math.PI / 2),
        previewMeshMaterial(ref),
      );
      mesh.position.set(...geometry.position);
      geometry.preview = mesh;
      break;
    }
    case "plane": {
      const width = Math.max(8, Math.abs(dx));
      const depth = Math.max(8, Math.abs(dz));
      geometry.geometry = { type: "plane", width, depth };
      geometry.position = [(start.x + end.x) / 2, 0, (start.z + end.z) / 2];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
        previewMeshMaterial(ref),
      );
      mesh.position.set(...geometry.position);
      geometry.preview = mesh;
      break;
    }
    case "circle": {
      const radius = Math.max(4, Math.hypot(dx, dz));
      geometry.geometry = { type: "circle_curve", radius, segments: 48 };
      geometry.position = [start.x, 0, start.z];
      const line = new THREE.BufferGeometry();
      line.setAttribute("position", new THREE.Float32BufferAttribute(ringGeometryPoints(radius, 48), 3));
      const loop = new THREE.LineLoop(line, previewLineMaterial(ref));
      loop.position.set(...geometry.position);
      geometry.preview = loop;
      break;
    }
    case "rectangle": {
      const width = Math.max(4, Math.abs(dx));
      const depth = Math.max(4, Math.abs(dz));
      geometry.geometry = { type: "rectangle_curve", width, depth };
      geometry.position = [(start.x + end.x) / 2, 0, (start.z + end.z) / 2];
      const hw = width / 2;
      const hd = depth / 2;
      const positions = [-hw, 0, -hd, hw, 0, -hd, hw, 0, hd, -hw, 0, hd, -hw, 0, -hd];
      const line = new THREE.BufferGeometry();
      line.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      const path = new THREE.Line(line, previewLineMaterial(ref));
      path.position.set(...geometry.position);
      geometry.preview = path;
      break;
    }
    default:
      return null;
  }
  if (!geometry.geometry || !geometry.position || !geometry.preview) return null;
  return {
    commit: { geometry: geometry.geometry, position: geometry.position },
    preview: geometry.preview,
  };
}

function buildMultiGeometry(shape: string, points: THREE.Vector3[]): DraftCommit | null {
  if (points.length < 2) return null;
  const flatten = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];
  const first = flatten(points[0]);
  const last = flatten(points[points.length - 1]);
  switch (shape) {
    case "line":
      return {
        geometry: {
          type: "line_curve",
          end: [last[0] - first[0], last[1] - first[1], last[2] - first[2]],
        },
        position: first,
      };
    case "polyline":
      return {
        geometry: { type: "polyline_curve", points: points.map(flatten) },
        position: [0, 0, 0],
      };
    case "dimension":
      return {
        geometry: { type: "dimension", start: first, end: last },
        position: [0, 0, 0],
      };
    case "wall":
      return {
        geometry: {
          type: "wall",
          path: points.map((p) => [p.x, p.z] as [number, number]),
          width: 10,
          height: 80,
        },
        position: [0, 0, 0],
      };
    default:
      return null;
  }
}

function createCommitted(ref: ViewportRefs, commit: DraftCommit): void {
  ref.lastCommitAt = performance.now();
  const docId = activeDoc();
  if (!docId) return;
  void ipc
    .createEntity(docId, commit.geometry)
    .then(({ id }) => {
      const needsPlace = commit.position[0] !== 0 || commit.position[1] !== 0 || commit.position[2] !== 0;
      if (!needsPlace) return ipc.setSelection(docId, [id], id);
      const current = useArcStore.getState().scene?.entities.find((e) => e.id === id);
      const transform = {
        ...(current?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
        position: commit.position,
      };
      return ipc
        .setTransform(docId, [{ id, transform }], true)
        .then(() => ipc.setSelection(docId, [id], id));
    })
    .catch((error) => useArcStore.getState().setStatusMessage(`Create failed: ${String(error)}`));
}

function commitCurrentDraft(ref: ViewportRefs): boolean {
  const store = useArcStore.getState();
  const shape = store.tool === "sketch" ? store.sketchShape : store.tool;
  if (store.tool !== "sketch" && !MULTI_POINT_TOOLS.has(store.tool)) return false;
  const commit = buildMultiGeometry(shape, ref.draftPoints);
  if (!commit) return false;
  createCommitted(ref, commit);
  clearDraftState(ref);
  store.setStatusMessage("Created");
  return true;
}

function clearDraftState(ref: ViewportRefs): void {
  ref.draftPoints = [];
  ref.dragDraft = null;
  setDragPreview(ref, null);
  setDraft(ref, []);
  const store = useArcStore.getState();
  if (store.drafting) store.setDrafting(false);
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
  if (currentRef === ref) currentRef = null;
  ref.gizmo.dispose();
  for (const obj of ref.objects.values()) disposeObject(obj);
  ref.objects.clear();
  ref.controls.dispose();
  ref.renderer.dispose();
  ref.renderer.domElement.remove();
}
