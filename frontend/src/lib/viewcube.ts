import * as THREE from "three";
import type { ViewportPalette } from "./themes";

// --------------------------------------------------------------------------
// 3D Navigation ViewCube pinned to the top-right of the viewport.
// Each face uses a high-DPI CanvasTexture baked directly onto the 3D cube
// surface (no floating HTML text!), with interactive face, edge (45°), and
// corner (isometric) hit zones plus an X/Y/Z axis triad and base compass ring.
// --------------------------------------------------------------------------

export interface CubeTheme {
  faceBgTop: string;
  faceBgBottom: string;
  bevelBg: string;
  border: string;
  innerBorder: string;
  hoverFill: string;
  hoverText: string;
  text: string;
  ring: string;
}

interface FaceDef {
  normal: THREE.Vector3;
  tangentU: THREE.Vector3;
  tangentV: THREE.Vector3;
  label: string;
}

// Matches THREE.BoxGeometry material group order: +X, -X, +Y, -Y, +Z, -Z
const FACES: FaceDef[] = [
  {
    normal: new THREE.Vector3(1, 0, 0),
    tangentU: new THREE.Vector3(0, 0, -1),
    tangentV: new THREE.Vector3(0, 1, 0),
    label: "RIGHT",
  },
  {
    normal: new THREE.Vector3(-1, 0, 0),
    tangentU: new THREE.Vector3(0, 0, 1),
    tangentV: new THREE.Vector3(0, 1, 0),
    label: "LEFT",
  },
  {
    normal: new THREE.Vector3(0, 1, 0),
    tangentU: new THREE.Vector3(1, 0, 0),
    tangentV: new THREE.Vector3(0, 0, -1),
    label: "TOP",
  },
  {
    normal: new THREE.Vector3(0, -1, 0),
    tangentU: new THREE.Vector3(1, 0, 0),
    tangentV: new THREE.Vector3(0, 0, 1),
    label: "BOTTOM",
  },
  {
    normal: new THREE.Vector3(0, 0, 1),
    tangentU: new THREE.Vector3(1, 0, 0),
    tangentV: new THREE.Vector3(0, 1, 0),
    label: "FRONT",
  },
  {
    normal: new THREE.Vector3(0, 0, -1),
    tangentU: new THREE.Vector3(-1, 0, 0),
    tangentV: new THREE.Vector3(0, 1, 0),
    label: "BACK",
  },
];

const GIZMO_SIZE = 104; // css px
const GIZMO_RIGHT_MARGIN = 66;
const GIZMO_TOP_MARGIN = 10;
const TEX_SIZE = 256;
const BEVEL_FRAC = 0.2; // 20% border zone for edges & corners

interface HoverZone {
  face: number; // 0..5, or -1
  du: -1 | 0 | 1;
  dv: -1 | 0 | 1;
}

const NO_HOVER: HoverZone = { face: -1, du: 0, dv: 0 };

function sameZone(a: HoverZone, b: HoverZone): boolean {
  return a.face === b.face && a.du === b.du && a.dv === b.dv;
}

function cubeThemeFrom(palette: ViewportPalette): CubeTheme {
  return palette.lightViewport
    ? {
        faceBgTop: "#eef2f7",
        faceBgBottom: "#d9e1ec",
        bevelBg: "#cdd6e4",
        border: "#7a869a",
        innerBorder: "#aeb9ca",
        hoverFill: palette.accent600 || "#0096d6",
        hoverText: "#ffffff",
        text: "#1e293b",
        ring: "#94a3b8",
      }
    : {
        faceBgTop: "#2b303c",
        faceBgBottom: "#1f232d",
        bevelBg: "#181b24",
        border: "#4b5568",
        innerBorder: "#343b4a",
        hoverFill: palette.accent500 || "#00b4d8",
        hoverText: "#090d14",
        text: "#e2e8f0",
        ring: "#3b4254",
      };
}

export class ViewCube {
  scene = new THREE.Scene();
  navCam: THREE.OrthographicCamera;
  pivot = new THREE.Group();
  cube: THREE.Mesh;
  private domElement: HTMLElement;
  private onFocusFace: (normal: THREE.Vector3) => void;
  private canvases: HTMLCanvasElement[] = [];
  private textures: THREE.CanvasTexture[] = [];
  private materials: THREE.MeshLambertMaterial[] = [];
  private edges: THREE.LineSegments;
  private ringMesh: THREE.Mesh;
  private triadGroup: THREE.Group;
  private theme: CubeTheme = cubeThemeFrom({
    bg: "#0c0c0e",
    grid: "",
    gridLine: "",
    accent500: "#21b3ed",
    accent600: "#00a0dd",
    lightViewport: false,
  });

  hover: HoverZone = { ...NO_HOVER };
  private pressedZone: HoverZone = { ...NO_HOVER };
  private pressPos = { x: 0, y: 0 };
  private orbiting = false;
  private _v = new THREE.Vector3();
  private _v2 = new THREE.Vector3();
  private raycaster = new THREE.Raycaster();
  private lastSpherical = new THREE.Spherical();

  constructor(
    domElement: HTMLElement,
    onFocusFace: (normal: THREE.Vector3) => void,
    _labelLayer?: HTMLElement,
  ) {
    this.domElement = domElement;
    this.onFocusFace = onFocusFace;

    const geo = new THREE.BoxGeometry(1.76, 1.76, 1.76);
    for (let i = 0; i < 6; i++) {
      const canvas = document.createElement("canvas");
      canvas.width = TEX_SIZE;
      canvas.height = TEX_SIZE;
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      this.canvases.push(canvas);
      this.textures.push(tex);
      this.materials.push(
        new THREE.MeshLambertMaterial({
          map: tex,
        }),
      );
    }

    this.cube = new THREE.Mesh(geo, this.materials);
    this.pivot.add(this.cube);

    // Outer wireframe edges for crisp silhouette definition
    this.edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: this.theme.border }),
    );
    this.cube.add(this.edges);

    // Base compass ring beneath the cube (in XZ plane at y = -1.02)
    const ringGeo = new THREE.RingGeometry(1.18, 1.38, 48);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMesh = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: this.theme.ring,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.45,
      }),
    );
    this.ringMesh.position.y = -1.02;
    this.pivot.add(this.ringMesh);

    // Coordinate axis triad anchored at (-0.96, -0.96, -0.96)
    this.triadGroup = this.buildAxisTriad();
    this.pivot.add(this.triadGroup);

    this.scene.add(this.pivot);

    // Soft studio lighting so all visible faces stay legible while preserving 3D depth
    const ambient = new THREE.AmbientLight(0xffffff, 0.72);
    this.scene.add(ambient);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x9098a8, 0.5);
    hemi.position.set(0, 1, 0);
    this.scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(1.2, 1.8, 2.2);
    this.scene.add(dir);

    this.navCam = new THREE.OrthographicCamera(-1.95, 1.95, 1.95, -1.95, 0.1, 12);
    this.navCam.position.set(0, 0, 5);
    this.navCam.updateProjectionMatrix();

    this.redrawAllFaces();
  }

  private buildAxisTriad(): THREE.Group {
    const group = new THREE.Group();
    const origin = new THREE.Vector3(-0.92, -0.92, -0.92);
    const len = 1.95;
    const axes: { dir: THREE.Vector3; color: number; label: string }[] = [
      { dir: new THREE.Vector3(1, 0, 0), color: 0xef4444, label: "X" },
      { dir: new THREE.Vector3(0, 1, 0), color: 0x22c55e, label: "Y" },
      { dir: new THREE.Vector3(0, 0, 1), color: 0x3b82f6, label: "Z" },
    ];

    for (const ax of axes) {
      const mat = new THREE.MeshBasicMaterial({ color: ax.color });
      const cylGeo = new THREE.CylinderGeometry(0.038, 0.038, len, 10);
      cylGeo.translate(0, len / 2, 0);
      const shaft = new THREE.Mesh(cylGeo, mat);
      shaft.position.copy(origin);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), ax.dir);
      group.add(shaft);

      // Axis end cap with letter sprite
      const tipPos = origin.clone().addScaledVector(ax.dir, len + 0.18);
      const badge = this.makeAxisBadge(ax.label, ax.color);
      badge.position.copy(tipPos);
      group.add(badge);
    }

    // Small corner origin sphere
    const cornerSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.065, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0x94a3b8 }),
    );
    cornerSphere.position.copy(origin);
    group.add(cornerSphere);

    return group;
  }

  private makeAxisBadge(letter: string, hexColor: number): THREE.Sprite {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const hex = `#${hexColor.toString(16).padStart(6, "0")}`;
      ctx.beginPath();
      ctx.arc(32, 32, 26, 0, Math.PI * 2);
      ctx.fillStyle = hex;
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 32px Inter, system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(letter, 32, 34);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.32, 0.32, 0.32);
    sprite.renderOrder = 2;
    return sprite;
  }

  private redrawFace(index: number): void {
    const canvas = this.canvases[index];
    const tex = this.textures[index];
    if (!canvas || !tex) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const S = TEX_SIZE;
    const B = Math.round(S * BEVEL_FRAC);
    const isFaceHover = this.hover.face === index;
    const hDu = isFaceHover ? this.hover.du : 0;
    const hDv = isFaceHover ? this.hover.dv : 0;
    const centerHovered = isFaceHover && hDu === 0 && hDv === 0;

    // 1. Outer bevel frame background
    ctx.fillStyle = this.theme.bevelBg;
    ctx.fillRect(0, 0, S, S);

    // 2. Highlight active edge or corner zone on the bevel frame if hovered
    if (isFaceHover && (hDu !== 0 || hDv !== 0)) {
      ctx.fillStyle = this.theme.hoverFill;
      const x0 = hDu === -1 ? 0 : hDu === 0 ? B : S - B;
      const x1 = hDu === -1 ? B : hDu === 0 ? S - B : S;
      // Canvas Y=0 is top (which corresponds to v=1 in UV space)
      const y0 = hDv === 1 ? 0 : hDv === 0 ? B : S - B;
      const y1 = hDv === 1 ? B : hDv === 0 ? S - B : S;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    // 3. Subtle bevel grid lines separating corners & edges
    ctx.strokeStyle = this.theme.innerBorder;
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Corner ticks on bevel ring
    ctx.moveTo(B, 0);
    ctx.lineTo(B, S);
    ctx.moveTo(S - B, 0);
    ctx.lineTo(S - B, S);
    ctx.moveTo(0, B);
    ctx.lineTo(S, B);
    ctx.moveTo(0, S - B);
    ctx.lineTo(S, S - B);
    ctx.stroke();

    // 4. Center main face plate
    const pad = B;
    const innerW = S - pad * 2;
    if (centerHovered) {
      ctx.fillStyle = this.theme.hoverFill;
    } else {
      const grad = ctx.createLinearGradient(0, pad, 0, S - pad);
      grad.addColorStop(0, this.theme.faceBgTop);
      grad.addColorStop(1, this.theme.faceBgBottom);
      ctx.fillStyle = grad;
    }
    ctx.fillRect(pad, pad, innerW, innerW);

    // Inner plate border
    ctx.strokeStyle = centerHovered ? this.theme.hoverFill : this.theme.innerBorder;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(pad, pad, innerW, innerW);

    // Outer face border
    ctx.strokeStyle = this.theme.border;
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, S - 4, S - 4);

    // 5. Crisp face label painted directly on the cube face
    const label = FACES[index].label;
    ctx.fillStyle = centerHovered ? this.theme.hoverText : this.theme.text;
    const fontSize = label.length >= 6 ? 32 : 36;
    ctx.font = `700 ${fontSize}px Inter, system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, S / 2, S / 2 + 1);

    tex.needsUpdate = true;
  }

  private redrawAllFaces(): void {
    for (let i = 0; i < 6; i++) {
      this.redrawFace(i);
    }
  }

  applyTheme(palette: ViewportPalette): void {
    this.theme = cubeThemeFrom(palette);
    (this.edges.material as THREE.LineBasicMaterial).color.set(this.theme.border);
    (this.ringMesh.material as THREE.MeshBasicMaterial).color.set(this.theme.ring);
    this.redrawAllFaces();
  }

  /** Gizmo rect in CSS top-left coordinates of the host (pinned top-right, left of the Snap/Scale pill). */
  rect(hostW: number, _hostH: number): { x: number; y: number; size: number } {
    return {
      x: Math.max(0, hostW - GIZMO_SIZE - GIZMO_RIGHT_MARGIN),
      y: GIZMO_TOP_MARGIN,
      size: GIZMO_SIZE,
    };
  }

  /** Render the gizmo into the top-right corner of the framebuffer. */
  render(
    renderer: THREE.WebGLRenderer,
    mainCamera: THREE.PerspectiveCamera,
    hostW: number,
    hostH: number,
  ): void {
    this.pivot.quaternion.copy(mainCamera.quaternion).invert();
    this.pivot.updateMatrixWorld();
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
  }

  private pointerInRect(
    event: PointerEvent | MouseEvent,
    hostW: number,
    hostH: number,
  ): { ndcX: number; ndcY: number } | null {
    const rect = this.rect(hostW, hostH);
    const bounds = this.domElement.getBoundingClientRect();
    const px = event.clientX - bounds.left;
    const py = event.clientY - bounds.top;
    if (px < rect.x || py < rect.y || px >= rect.x + rect.size || py >= rect.y + rect.size) {
      return null;
    }
    return {
      ndcX: ((px - rect.x) / rect.size) * 2 - 1,
      ndcY: -(((py - rect.y) / rect.size) * 2 - 1),
    };
  }

  private zoneAt(event: PointerEvent | MouseEvent, hostW: number, hostH: number): HoverZone {
    const p = this.pointerInRect(event, hostW, hostH);
    if (!p) return NO_HOVER;
    this.raycaster.setFromCamera(new THREE.Vector2(p.ndcX, p.ndcY), this.navCam);
    const hits = this.raycaster.intersectObject(this.cube, false);
    if (hits.length === 0) return NO_HOVER;
    const hit = hits[0];
    const face = hit.face?.materialIndex ?? -1;
    if (face < 0 || face >= 6) return NO_HOVER;
    const uv = hit.uv;
    if (!uv) return { face, du: 0, dv: 0 };
    const du: -1 | 0 | 1 = uv.x < BEVEL_FRAC ? -1 : uv.x > 1 - BEVEL_FRAC ? 1 : 0;
    const dv: -1 | 0 | 1 = uv.y < BEVEL_FRAC ? -1 : uv.y > 1 - BEVEL_FRAC ? 1 : 0;
    return { face, du, dv };
  }

  /** Compute the world direction vector for a face, edge (45°), or corner (isometric) zone. */
  private directionForZone(zone: HoverZone): THREE.Vector3 | null {
    const def = FACES[zone.face];
    if (!def) return null;
    const dir = def.normal.clone();
    if (zone.du !== 0) dir.addScaledVector(def.tangentU, zone.du);
    if (zone.dv !== 0) dir.addScaledVector(def.tangentV, zone.dv);
    return dir.normalize();
  }

  /** True when the pointer sits over the gizmo's screen area. */
  hitTest(event: PointerEvent | MouseEvent, hostW: number, hostH: number): boolean {
    return this.pointerInRect(event, hostW, hostH) !== null;
  }

  private setHover(next: HoverZone): void {
    if (sameZone(next, this.hover)) return;
    const prevFace = this.hover.face;
    this.hover = { ...next };
    if (prevFace >= 0 && prevFace !== next.face) {
      this.redrawFace(prevFace);
    }
    if (next.face >= 0) {
      this.redrawFace(next.face);
    }
  }

  onPointerDown(
    event: PointerEvent,
    hostW: number,
    hostH: number,
    target: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
  ): boolean {
    const inRect = this.pointerInRect(event, hostW, hostH);
    if (!inRect) return false;
    const zone = this.zoneAt(event, hostW, hostH);
    this.pressedZone = { ...zone };
    this.pressPos = { x: event.clientX, y: event.clientY };
    if (zone.face === -1) {
      this.orbiting = true;
      this.lastSpherical.setFromVector3(this._v.copy(camera.position).sub(target));
    }
    try {
      this.domElement.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    this.domElement.style.cursor = zone.face >= 0 ? "pointer" : "grabbing";
    return true;
  }

  onPointerMove(
    event: PointerEvent,
    hostW: number,
    hostH: number,
    target: THREE.Vector3,
    camera: THREE.PerspectiveCamera,
  ): boolean {
    if (this.orbiting) {
      const dx = event.clientX - this.pressPos.x;
      const dy = event.clientY - this.pressPos.y;
      this.lastSpherical.theta -= dx * 0.008;
      this.lastSpherical.phi = Math.min(
        Math.PI - 0.02,
        Math.max(0.02, this.lastSpherical.phi - dy * 0.008),
      );
      this.pressPos = { x: event.clientX, y: event.clientY };
      const pos = this._v2.setFromSpherical(this.lastSpherical).add(target);
      camera.position.copy(pos);
      return true;
    }
    if (!this.pointerInRect(event, hostW, hostH)) {
      if (this.hover.face !== -1) {
        this.setHover(NO_HOVER);
        this.domElement.style.cursor = "";
      }
      return false;
    }
    if (this.pressedZone.face >= 0) {
      const dragged = Math.hypot(
        event.clientX - this.pressPos.x,
        event.clientY - this.pressPos.y,
      );
      if (dragged > 6) {
        this.orbiting = true;
        this.pressedZone = { ...NO_HOVER };
        this.lastSpherical.setFromVector3(this._v.copy(camera.position).sub(target));
        this.domElement.style.cursor = "grabbing";
        return true;
      }
    }
    const zone = this.zoneAt(event, hostW, hostH);
    this.setHover(zone);
    this.domElement.style.cursor = zone.face >= 0 ? "pointer" : "grab";
    return true;
  }

  onPointerUp(event: PointerEvent, hostW: number, hostH: number): boolean {
    if (this.orbiting) {
      this.orbiting = false;
      this.pressedZone = { ...NO_HOVER };
      try {
        this.domElement.releasePointerCapture(event.pointerId);
      } catch {
        // ignore
      }
      const zone = this.zoneAt(event, hostW, hostH);
      this.domElement.style.cursor = zone.face >= 0 ? "pointer" : "";
      return true;
    }
    if (this.pressedZone.face === -1) return false;
    const zone = this.zoneAt(event, hostW, hostH);
    const moved = Math.hypot(
      event.clientX - this.pressPos.x,
      event.clientY - this.pressPos.y,
    );
    try {
      this.domElement.releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    if (sameZone(zone, this.pressedZone) && zone.face >= 0 && moved < 6) {
      const dir = this.directionForZone(zone);
      if (dir) this.onFocusFace(dir);
    }
    this.domElement.style.cursor = zone.face >= 0 ? "pointer" : "";
    this.pressedZone = { ...NO_HOVER };
    return true;
  }

  get orbitActive(): boolean {
    return this.orbiting;
  }

  dispose(): void {
    (this.edges.material as THREE.Material).dispose();
    this.edges.geometry.dispose();
    (this.ringMesh.material as THREE.Material).dispose();
    this.ringMesh.geometry.dispose();
    for (const tex of this.textures) tex.dispose();
    for (const mat of this.materials) mat.dispose();
    this.cube.geometry.dispose();
    this.scene.clear();
  }
}
