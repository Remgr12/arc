import * as THREE from "three";
import type { ViewportPalette } from "./themes";

// --------------------------------------------------------------------------
// A navigation gizmo: a small 3D cube pinned to the top-right of the viewport
// that mirrors the current camera orientation. Hover a face to highlight it,
// click to focus that plane (camera snaps front-plus to it), or drag on the
// cube (not a face) to orbit.
// --------------------------------------------------------------------------

export interface CubeTheme {
  fill: string;
  fillHover: string;
  edge: string;
  text: string;
}

const FACES: { normal: THREE.Vector3; label: string }[] = [
  { normal: new THREE.Vector3(1, 0, 0), label: "RIGHT" },
  { normal: new THREE.Vector3(-1, 0, 0), label: "LEFT" },
  { normal: new THREE.Vector3(0, 1, 0), label: "TOP" },
  { normal: new THREE.Vector3(0, -1, 0), label: "BOTTOM" },
  { normal: new THREE.Vector3(0, 0, 1), label: "FRONT" },
  { normal: new THREE.Vector3(0, 0, -1), label: "BACK" },
];

const GIZMO_SIZE = 104; // css px
const GIZMO_MARGIN = 16;

function cubeThemeFrom(palette: ViewportPalette): CubeTheme {
  return palette.lightViewport
    ? { fill: "#c2c9d6", fillHover: palette.accent600, edge: "#8892a8", text: "#1c2430" }
    : { fill: "#ccd2dd", fillHover: palette.accent500, edge: "#5c626e", text: "#22262e" };
}

export class ViewCube {
  scene = new THREE.Scene();
  navCam: THREE.OrthographicCamera;
  cube: THREE.Mesh;
  private domElement: HTMLElement;
  private onFocusFace: (normal: THREE.Vector3) => void;
  private materials: THREE.MeshLambertMaterial[] = [];
  private edges: THREE.LineSegments;
  private labels: HTMLDivElement[] = [];
  private theme: CubeTheme = cubeThemeFrom({
    bg: "#0c0c0e",
    grid: "",
    gridLine: "",
    accent500: "#21b3ed",
    accent600: "#00a0dd",
    lightViewport: false,
  });

  hover = -1;
  private pressedFace = -1;
  private pressPos = { x: 0, y: 0 };
  private orbiting = false;
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();

  constructor(
    domElement: HTMLElement,
    onFocusFace: (normal: THREE.Vector3) => void,
    labelLayer: HTMLElement,
  ) {
    this.domElement = domElement;
    this.onFocusFace = onFocusFace;

    const geo = new THREE.BoxGeometry(2, 2, 2);
    for (let i = 0; i < 6; i++) {
      this.materials.push(new THREE.MeshLambertMaterial({ color: this.theme.fill }));
    }
    this.cube = new THREE.Mesh(geo, this.materials);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x777788, 0.9);
    hemi.position.set(0, 1, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(0.4, 0.8, 0.6);
    this.scene.add(dir);
    this.scene.add(this.cube);

    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: this.theme.edge }),
    );
    this.cube.add(this.edges);

    // A fixed ortho camera looking down -Z; the cube is aligned against the
    // main camera each frame.
    this.navCam = new THREE.OrthographicCamera(-1.85, 1.85, 1.85, -1.85, 0.1, 10);
    this.navCam.position.set(0, 0, 4);
    this.navCam.updateProjectionMatrix();

    for (const face of FACES) {
      const el = document.createElement("div");
      el.style.cssText =
        "position:absolute;transform:translate(-50%,-50%);font-size:9px;font-weight:600;letter-spacing:0.4px;" +
        "text-shadow:0 1px 2px rgba(0,0,0,0.35);white-space:nowrap;";
      el.textContent = face.label;
      labelLayer.appendChild(el);
      this.labels.push(el);
    }
  }

  applyTheme(palette: ViewportPalette): void {
    this.theme = cubeThemeFrom(palette);
    for (let i = 0; i < this.materials.length; i++) {
      this.materials[i].color.set(i === this.hover ? this.theme.fillHover : this.theme.fill);
    }
    (this.edges.material as THREE.LineBasicMaterial).color.set(this.theme.edge);
    for (const label of this.labels) label.style.color = this.theme.text;
  }

  /** Gizmo rect in CSS top-left coordinates of the host. */
  rect(hostW: number, hostH: number): { x: number; y: number; size: number } {
    return { x: hostW - GIZMO_SIZE - GIZMO_MARGIN, y: hostH - GIZMO_MARGIN - GIZMO_SIZE, size: GIZMO_SIZE };
  }

  /** Render the gizmo into a corner of the framebuffer. */
  render(renderer: THREE.WebGLRenderer, mainCamera: THREE.PerspectiveCamera, hostW: number, hostH: number): void {
    this.cube.quaternion.copy(mainCamera.quaternion).invert();
    this.cube.updateMatrixWorld();
    const rect = this.rect(hostW, hostH);

    // GL viewport coordinates are bottom-left origin; rect is CSS top-left.
    const glY = hostH - rect.y - rect.size;
    renderer.setScissorTest(true);
    renderer.setScissor(rect.x, glY, rect.size, rect.size);
    renderer.setViewport(rect.x, glY, rect.size, rect.size);
    renderer.clearDepth();
    renderer.render(this.scene, this.navCam);
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, hostW, hostH);

    this.updateLabels(rect);
  }

  private updateLabels(rect: { x: number; y: number; size: number }): void {
    for (let i = 0; i < FACES.length; i++) {
      const el = this.labels[i];
      // A cube-local face normal rotated into gizmo world space: its z is the
      // facing factor (the gizmo camera looks down -Z) and rotating it to
      // radius 1.55 gives the point above that face's center to project.
      const world = this._v.copy(FACES[i].normal).applyQuaternion(this.cube.quaternion);
      const facing = world.z;
      if (facing <= 0.08) {
        el.style.opacity = "0";
        continue;
      }
      world.multiplyScalar(1.55);
      world.project(this.navCam);
      const left = rect.x + (world.x * 0.5 + 0.5) * rect.size;
      const top = rect.y + (0.5 - world.y * 0.5) * rect.size;
      el.style.left = `${left}px`;
      el.style.top = `${top}px`;
      el.style.opacity = String(Math.min(1, facing * 1.6));
    }
  }

  private pointerInRect(event: PointerEvent | MouseEvent, hostW: number, hostH: number): { ndcX: number; ndcY: number } | null {
    const rect = this.rect(hostW, hostH);
    const bounds = this.domElement.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    if (px < rect.x || py < rect.y || px >= rect.x + rect.size || py >= rect.y + rect.size) return null;
    return {
      ndcX: ((px - rect.x) / rect.size) * 2 - 1,
      ndcY: -(((py - rect.y) / rect.size) * 2 - 1),
    };
  }

  private faceAt(event: PointerEvent | MouseEvent, hostW: number, hostH: number): number {
    const p = this.pointerInRect(event, hostW, hostH);
    if (!p) return -1;
    this.raycaster.setFromCamera(new THREE.Vector2(p.ndcX, p.ndcY), this.navCam);
    const hits = this.raycaster.intersectObject(this.cube, false);
    return hits.length > 0 ? (hits[0].face?.materialIndex ?? -1) : -1;
  }

  /** True when the pointer sits over the gizmo's screen area. */
  hitTest(event: PointerEvent | MouseEvent, hostW: number, hostH: number): boolean {
    return this.pointerInRect(event, hostW, hostH) !== null;
  }

  private faceColor(materialIndex: number, hovered: boolean): void {
    const mat = this.materials[materialIndex];
    if (!mat) return;
    mat.color.set(hovered ? this.theme.fillHover : this.theme.fill);
  }

  private setHover(face: number): void {
    if (face === this.hover) return;
    if (this.hover >= 0) this.faceColor(this.hover, false);
    this.hover = face;
    if (face >= 0) this.faceColor(face, true);
  }

  private lastSpherical = new THREE.Spherical();

  onPointerDown(event: PointerEvent, hostW: number, hostH: number, target: THREE.Vector3, camera: THREE.PerspectiveCamera): boolean {
    const inRect = this.pointerInRect(event, hostW, hostH);
    if (!inRect) return false;
    const face = this.faceAt(event, hostW, hostH);
    this.pressedFace = face;
    this.pressPos = { x: event.clientX, y: event.clientY };
    if (face === -1) {
      this.orbiting = true;
      this.lastSpherical.setFromVector3(this._v.copy(camera.position).sub(target));
    }
    try {
      this.domElement.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    this.domElement.style.cursor = face >= 0 ? "pointer" : "grabbing";
    return true;
  }

  onPointerMove(event: PointerEvent, hostW: number, hostH: number, target: THREE.Vector3, camera: THREE.PerspectiveCamera): boolean {
    if (this.orbiting) {
      const dx = event.clientX - this.pressPos.x;
      const dy = event.clientY - this.pressPos.y;
      this.lastSpherical.theta -= dx * 0.008;
      this.lastSpherical.phi = Math.min(Math.PI - 0.02, Math.max(0.02, this.lastSpherical.phi - dy * 0.008));
      this.pressPos = { x: event.clientX, y: event.clientY };
      const pos = this._v2.setFromSpherical(this.lastSpherical).add(target);
      camera.position.copy(pos);
      return true;
    }
    if (!this.pointerInRect(event, hostW, hostH)) {
      this.setHover(-1);
      this.domElement.style.cursor = "";
      return false;
    }
    if (this.pressedFace >= 0) {
      const dragged = Math.hypot(event.clientX - this.pressPos.x, event.clientY - this.pressPos.y);
      if (dragged > 6) {
        this.orbiting = true;
        this.pressedFace = -1;
        this.lastSpherical.setFromVector3(this._v.copy(camera.position).sub(target));
        this.domElement.style.cursor = "grabbing";
        return true;
      }
    }
    this.setHover(this.faceAt(event, hostW, hostH));
    this.domElement.style.cursor = "pointer";
    return true;
  }

  onPointerUp(event: PointerEvent, hostW: number, hostH: number): boolean {
    if (this.orbiting) {
      this.orbiting = false;
      this.pressedFace = -1;
      this.domElement.style.cursor = this.faceAt(event, hostW, hostH) >= 0 ? "pointer" : "";
      return true;
    }
    if (this.pressedFace === -1) return false;
    const face = this.faceAt(event, hostW, hostH);
    const moved = Math.hypot(event.clientX - this.pressPos.x, event.clientY - this.pressPos.y);
    try {
      this.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (face === this.pressedFace && face >= 0 && moved < 6) {
      this.onFocusFace(FACES[face].normal.clone());
    }
    this.domElement.style.cursor = face >= 0 ? "pointer" : "";
    this.pressedFace = -1;
    return true;
  }

  get orbitActive(): boolean {
    return this.orbiting;
  }

  dispose(): void {
    for (const label of this.labels) label.remove();
    this.labels = [];
    (this.edges.material as THREE.Material).dispose();
    this.edges.geometry.dispose();
    for (const mat of this.materials) mat.dispose();
    this.cube.geometry.dispose();
    this.scene.clear();
  }
}
