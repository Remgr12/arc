import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { useThemeStore, viewportPalette, type ViewportPalette } from "../lib/themes";
import { ViewCube } from "../lib/viewcube";
import { DEFAULT_GEOMETRY, MULTI_POINT_TOOLS } from "../data/tools";
import type { EntityData, Geometry, LayerData, SceneData, ToolId } from "../lib/types";

interface ViewPalette {
  bg: THREE.Color;
  grid: THREE.Color;
  gridLine: THREE.Color;
  selection: THREE.Color;
  hover: THREE.Color;
  line: THREE.Color;
}

interface ViewAnim {
  dirFrom: THREE.Vector3;
  dirTo: THREE.Vector3;
  radius: number;
  start: number;
  duration: number;
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
  disposed: boolean;
  gizmo: ViewCube;
  viewAnim: ViewAnim | null;
  palette: ViewPalette;
}

/** The three.js editor viewport. Handles navigation, picking and tools. */
export function Viewport() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);

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
    disposed: false,
    gizmo: null as unknown as ViewCube,
    viewAnim: null,
    palette: viewPalette,
  };

  ref.gizmo = new ViewCube(renderer.domElement, (normal) => focusPlane(ref, normal), labels);

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

    // Camera flight to a gizmo plane.
    if (ref.viewAnim) {
      const anim = ref.viewAnim;
      const t = Math.min(1, (performance.now() - anim.start) / anim.duration);
      const k = t * t * (3 - 2 * t);
      const dir = slerpDir(anim.dirFrom, anim.dirTo, k);
      ref.camera.position.copy(ref.controls.target).addScaledVector(dir, anim.radius);
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
  const scene = useArcStore.getState().scene;
  if (scene) rebuildEntities(ref, scene);
  const settings = useArcStore.getState().settings;
  ref.gridNode.visible = settings?.show_grid ?? true;
  ref.axes.visible = settings?.show_axes ?? true;
  if (!MULTI_POINT_TOOLS.has(useArcStore.getState().tool)) {
    ref.draftPoints = [];
    setDraft(ref, []);
  }
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
  if (lineData && !tris) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(lineData.slice(), 3));
    const material = ref.lineMaterial.clone();
    return new THREE.LineSegments(geometry, material);
  }
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
  return new THREE.Mesh(geometry, ref.columnMaterial.clone());
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

  obj.position.set(...entity.transform.position);
  obj.quaternion.set(...entity.transform.rotation);
  obj.scale.set(...entity.transform.scale);
  obj.updateMatrix();
  obj.matrixWorldNeedsUpdate = true;
  obj.visible = entity.visible && layerVisible(layer);

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

const BLACK = new THREE.Color(0x000000);

function layerVisible(layer: LayerData | undefined): boolean {
  return !(layer && !layer.visible);
}

function entityColor(entity: EntityData, layers: Map<string, LayerData>): THREE.Color {
  const color = entity.color ?? layers.get(entity.layer)?.color ?? [0.62, 0.62, 0.65, 1];
  return new THREE.Color(color[0], color[1], color[2]);
}

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
  const dbl = (event: MouseEvent) => onDoubleClick(ref, event);
  const ctx = (event: Event) => event.preventDefault();
  const wheel = () => {
    ref.viewAnim = null;
  };

  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("dblclick", dbl);
  el.addEventListener("wheel", wheel, { passive: true });
  el.addEventListener("contextmenu", ctx);

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
    el.removeEventListener("dblclick", dbl);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("contextmenu", ctx);
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

  if (MULTI_POINT_TOOLS.has(tool)) {
    ref.draftPoints.push(snapped);
    setDraft(ref, [...ref.draftPoints]);
    return;
  }

  const geometry = DEFAULT_GEOMETRY[tool as ToolId];
  if (!geometry) return;
  void ipc
    .createEntity(docId, geometry as Geometry)
    .then(({ id }) => {
      const current = useArcStore.getState().scene?.entities.find((e) => e.id === id);
      const transform = {
        ...(current?.transform ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }),
        position: [snapped.x, 0, snapped.z] as [number, number, number],
      };
      return ipc
        .setTransform(docId, [{ id, transform }], true)
        .then(() => ipc.setSelection(docId, [id], id));
    })
    .catch((error) => useArcStore.getState().setStatusMessage(`Create failed: ${String(error)}`));
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
    const world = pointOnHorizontalPlane(rayAt(ref, point), 0);
    if (world) store.setCursorWorld([world.x, 0, world.z]);
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

  if (event.button === 0 && ref.gizmo.onPointerUp(event, ref.host.clientWidth, ref.host.clientHeight)) {
    return;
  }
}

function onDoubleClick(ref: ViewportRefs, event: MouseEvent): void {
  const store = useArcStore.getState();
  const scene = store.scene;
  if (!scene) return;

  if (ref.gizmo.hitTest(event, ref.host.clientWidth, ref.host.clientHeight)) return;

  if (MULTI_POINT_TOOLS.has(store.tool) && ref.draftPoints.length >= 2) {
    const geometry = finishSketch(store.tool, ref.draftPoints);
    if (geometry) {
      void ipc
        .createEntity(activeDoc(), geometry)
        .then(({ id }) => ipc.setSelection(activeDoc(), [id], id))
        .catch((error) =>
          useArcStore.getState().setStatusMessage(`Create failed: ${String(error)}`),
        );
    }
    ref.draftPoints = [];
    setDraft(ref, []);
    return;
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

function finishSketch(tool: ToolId, points: THREE.Vector3[]): Geometry | null {
  if (points.length < 2) return null;
  const flatten = (p: THREE.Vector3): [number, number, number] => [p.x, p.y, p.z];
  const first = flatten(points[0]);
  const last = flatten(points[points.length - 1]);
  switch (tool) {
    case "line":
      return {
        type: "line",
        end: [last[0] - first[0], last[1] - first[1], last[2] - first[2]],
      };
    case "polyline":
      return { type: "polyline", points: points.map(flatten) };
    case "dimension":
      return { type: "dimension", start: first, end: last };
    case "wall":
      return {
        type: "wall",
        path: points.map((p) => [p.x, p.z] as [number, number]),
        width: 10,
        height: 80,
      };
    default:
      return null;
  }
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
  ref.camera.position.copy(center).addScaledVector(direction, distance);
  ref.camera.near = Math.max(0.1, distance / 1000);
  ref.camera.far = distance * 40;
  ref.camera.updateProjectionMatrix();
  ref.controls.target.copy(center);
  ref.controls.update();
}

// ------------------------------------------------------------------ dispose

function disposeViewport(ref: ViewportRefs): void {
  ref.disposed = true;
  ref.gizmo.dispose();
  for (const obj of ref.objects.values()) disposeObject(obj);
  ref.objects.clear();
  ref.controls.dispose();
  ref.renderer.dispose();
  ref.renderer.domElement.remove();
}
