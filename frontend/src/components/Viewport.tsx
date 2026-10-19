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
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  tc: TransformControls;
  gizmoDragging: boolean;
  sceneRoot: THREE.Scene;
  entityRoot: THREE.Group;
  gridNode: THREE.GridHelper;
  groundNode: THREE.Mesh;
  axes: THREE.AxesHelper;
  raycaster: THREE.Raycaster;
  columnMaterial: THREE.MeshStandardMaterial;
  lineMaterial: THREE.LineBasicMaterial;
  objects: Map<string, THREE.Object3D>;
  lastTool: ToolId | null;
  lastCommitAt: number;
  lastScene: SceneData | null;
  lastHover: string | null;
  lastCursorAt: number;
  disposed: boolean;
  gizmo: ViewCube;
  viewAnim: ViewAnim | null;
  palette: ViewPalette;
  marquee: MarqueeState | null;
  marqueeEl: HTMLDivElement | null;
  contextMenu: HTMLDivElement | null;
  contextMenuCloser: (() => void) | null;
  /** Screen position of an in-flight right-button press (pan-drag suppression). */
  contextPress: { x: number; y: number } | null;
  /** Overlay objects grouped by tag; each new object replaces the old one. */
  previews: Map<string, THREE.Object3D>;
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

function createViewport(host: HTMLDivElement): ViewportRefs {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(host.clientWidth || 800, host.clientHeight || 600);
  renderer.autoClear = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  shadow.mapSize.set(2048, 2048);
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
    "pointer-events-none absolute z-30 -translate-x-1/2 -translate-y-[calc(100%+8px)] border border-base-400 bg-base-50/95 px-1.5 py-0.5 font-mono text-[11px] leading-none text-accent-700 shadow-sm";
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
    gridNode: makeGrid(palette),
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
    lastTool: null,
    lastCommitAt: 0,
    lastScene: null,
    lastHover: null,
    lastCursorAt: 0,
    disposed: false,
    gizmo: null as unknown as ViewCube,
    viewAnim: null,
    palette: viewPalette,
    marquee: null,
    marqueeEl: null,
    contextMenu: null,
    contextMenuCloser: null,
    contextPress: null,
    previews: new Map(),
    ctx: null as unknown as ToolContext,
  };

  ref.gizmo = new ViewCube(
    renderer.domElement,
    (normal) => focusPlane(ref, normal),
    ref.measureEl.parentElement ?? ref.host,
  );
  ref.ctx = makeToolContext(ref);

  tc.addEventListener("dragging-changed", (event) => {
    const dragging = Boolean((event as unknown as { value: boolean }).value);
    ref.gizmoDragging = dragging;
    ref.controls.enabled = !dragging;
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

// -------------------------------------------------------------- theme sync

function applyTheme(ref: ViewportRefs, palette: ViewportPalette): void {
  ref.palette = themeToPalette(palette);
  ref.sceneRoot.background = ref.palette.bg;
  ref.sceneRoot.fog = new THREE.Fog(palette.bg, 5000, 16000);
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

// -------------------------------------------------------------- scene sync

function syncSceneToThree(ref: ViewportRefs): void {
  const state = useArcStore.getState();
  const scene = state.scene;
  const hoverChanged = state.hoverEntity !== ref.lastHover;
  const sceneChanged = scene !== ref.lastScene;

  if (sceneChanged) {
    ref.lastScene = scene;
    if (scene) rebuildEntities(ref, scene);
    updateGizmoAttachment(ref);
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
  if (tool !== ref.lastTool) switchTool(ref, tool);
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
  if (state.tool !== "move") {
    if (ref.tc.object) ref.tc.detach();
    return;
  }
  const scene = state.scene;
  const primary = scene?.selection[scene.selection.length - 1] ?? null;
  if (!primary) {
    if (ref.tc.object) ref.tc.detach();
    return;
  }
  const entity = scene?.entities.find((e) => e.id === primary);
  if (!entity || entity.locked) {
    if (ref.tc.object) ref.tc.detach();
    return;
  }
  const obj = ref.objects.get(primary);
  if (!obj || !obj.visible) {
    if (ref.tc.object) ref.tc.detach();
    return;
  }
  if (ref.tc.object !== obj) ref.tc.attach(obj);
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
    obj.castShadow = true;
    obj.receiveShadow = true;
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
  const material = MATERIALS.find((m) => m.id === entity.material) ?? null;

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

// ------------------------------------------------------------- context menu

function closeContextMenu(ref: ViewportRefs): void {
  const closer = ref.contextMenuCloser;
  ref.contextMenu = null;
  ref.contextMenuCloser = null;
  closer?.();
}

function openContextMenu(ref: ViewportRefs, hostX: number, hostY: number, items: MenuItem[]): void {
  closeContextMenu(ref);
  const menu = document.createElement("div");
  menu.className =
    "pointer-events-auto absolute z-50 w-48 rounded-md border border-base-300 bg-base-100 py-1 shadow-xl";
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    button.disabled = item.disabled === true;
    button.className =
      "block w-full px-3 py-1.5 text-left text-[12.5px] text-base-700 transition-colors hover:bg-base-200 hover:text-base-800 disabled:pointer-events-none disabled:opacity-40";
    button.addEventListener("click", () => {
      closeContextMenu(ref);
      item.run();
    });
    menu.appendChild(button);
  }
  ref.host.appendChild(menu);
  menu.style.left = `${Math.max(4, Math.min(hostX, ref.host.clientWidth - (menu.offsetWidth + 8)))}px`;
  menu.style.top = `${Math.max(4, Math.min(hostY, ref.host.clientHeight - (menu.offsetHeight + 8)))}px`;
  ref.contextMenu = menu;
  // One-shot dismissal on the next pointer press outside the menu.
  const dismiss = (e: PointerEvent) => {
    if (!(e.target instanceof Node) || !menu.contains(e.target)) closeContextMenu(ref);
  };
  ref.contextMenuCloser = () => {
    window.removeEventListener("pointerdown", dismiss, true);
    if (menu.isConnected) menu.remove();
  };
  window.addEventListener("pointerdown", dismiss, true);
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
    closeContextMenu(ref);
    return;
  }
  const hitId = pickEntityAt(ref, ndcPoint(event));
  const hostRect = ref.host.getBoundingClientRect();
  const x = event.clientX - hostRect.left;
  const y = event.clientY - hostRect.top;
  if (hitId) {
    // Right-clicking an unselected entity selects it so menu actions act on it.
    if (!scene.selection.includes(hitId)) void ipc.setSelection(docId, [hitId], hitId);
    // Booleans act on the active selection; account for the implicit single pick.
    const selectedCount = scene.selection.includes(hitId) ? scene.selection.length : 1;
    openContextMenu(ref, x, y, [
      { label: "Delete", run: () => void actions.deleteSelection() },
      { label: "Duplicate", run: () => void actions.duplicateSelection() },
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

function pickEntityAt(ref: ViewportRefs, point: { x: number; y: number }): string | null {
  ref.raycaster.setFromCamera(new THREE.Vector2(point.x, point.y), ref.camera);
  const hits = ref.raycaster.intersectObjects(Array.from(ref.objects.values()), false);
  const hit = hits.find((candidate) => candidate.object.visible);
  return hit ? (hit.object.userData.entityId as string) : null;
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
    // The move gizmo owns its own pointer stream while hovered/dragging.
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
    if (ref.marquee) {
      moveMarquee(ref, event);
      return;
    }
    if (ref.gizmoDragging || ref.tc.axis) {
      if (store.hoverEntity) store.setHoverEntity(null);
      return;
    }
    if (store.scene) {
      const handler = handlerFor(store.tool);
      if (handler && (store.tool === "select" || store.tool === "move")) {
        const hovered = pickEntityAt(ref, ndcPoint(event));
        if (hovered !== store.hoverEntity) store.setHoverEntity(hovered);
      }
      const now = performance.now();
      if (now - ref.lastCursorAt > 80) {
        ref.lastCursorAt = now;
        const world = pointOnHorizontalPlane(rayAt(ref, ndcPoint(event)), 0);
        if (world) store.setCursorWorld([world.x, world.y, world.z]);
      }
    }
    handlerFor(store.tool)?.onPointerMove?.(event, ctx);
    syncDrafting(ref);
  };
  const up = (event: PointerEvent) => {
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
    if (handler?.hasActivity?.(ctx)) useArcStore.getState().setDrafting(false);
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

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("dblclick", dbl);
  el.addEventListener("wheel", wheel, { passive: true });
  el.addEventListener("contextmenu", ctx_);
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
    el.removeEventListener("contextmenu", ctx_);
    window.removeEventListener("arc-draft-cancel", draftCancel);
    window.removeEventListener("arc-draft-enter", draftEnter);
    window.removeEventListener("arc-draft-backspace", draftBackspace);
    window.removeEventListener("arc-fit-view", fit);
    window.removeEventListener("arc-focus-entity", focus);
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
    const settings = useArcStore.getState().settings;
    return {
      gridSize: settings?.grid_size ?? 10,
      snapEnabled: settings?.snap_enabled ?? true,
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

    planePoint(event, height = 0) {
      return pointOnHorizontalPlane(rayAt(ref, ndcPoint(event)), height);
    },
    rayAt(event) {
      return rayAt(ref, ndcPoint(event));
    },
    pickEntity(event) {
      return pickEntityAt(ref, ndcPoint(event));
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
      if (opts?.grid === false) {
        return { point: world.clone(), kind: "grid" };
      }
      const camDistance = ref.camera.position.distanceTo(world);
      const tolerance = Math.max(gridSize * 0.3, camDistance * 0.004);

      const origin = new THREE.Vector3(0, world.y, 0);
      if (world.distanceTo(origin) <= tolerance) {
        return { point: origin.clone(), kind: "origin" };
      }
      if (Math.abs(world.z) <= tolerance) {
        return { point: new THREE.Vector3(world.x, world.y, 0), kind: "axis" };
      }
      if (Math.abs(world.x) <= tolerance) {
        return { point: new THREE.Vector3(0, world.y, world.z), kind: "axis" };
      }

      const endpointTolerance = tolerance * 2.2;
      let best: THREE.Vector3 | null = null;
      let bestDist = endpointTolerance;
      const scene = useArcStore.getState().scene;
      if (scene && snapEnabled) {
        for (const entity of scene.entities) {
          if (entity.category !== "sketch") continue;
          if (!entity.visible || !entity.lines || entity.lines.length < 3) continue;
          const obj = ref.objects.get(entity.id);
          if (!obj || !obj.visible) continue;
          obj.updateMatrixWorld();
          const pts = entity.lines;
          for (let i = 0; i + 2 < pts.length; i += 3) {
            const local = new THREE.Vector3(pts[i], pts[i + 1], pts[i + 2]);
            const dist = local.applyMatrix4(obj.matrixWorld).distanceTo(world);
            if (dist <= bestDist) {
              bestDist = dist;
              best = local.clone();
            }
          }
          if (bestDist < tolerance * 0.5) break; // close enough, stop scanning
        }
      }
      if (best) return { point: best, kind: "endpoint" };

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
    },
    clearPreview(tag = "main") {
      const existing = ref.previews.get(tag);
      if (!existing) return;
      ref.sceneRoot.remove(existing);
      disposeObject(existing);
      ref.previews.delete(tag);
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
        return;
      }
      ref.tc.setMode(mode);
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
      // The render loop runs every frame; nothing to request.
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
  ref.gizmo.dispose();
  for (const obj of ref.objects.values()) disposeObject(obj);
  ref.objects.clear();
  cancelMarquee(ref);
  closeContextMenu(ref);
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
