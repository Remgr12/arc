import type * as THREE from "three";
import type { EntityData, Geometry, RefObject, SceneData, ToolId } from "../lib/types";
import type { EdgeHit, FaceHit } from "./topology";

export interface ViewPalette {
  bg: THREE.Color;
  grid: THREE.Color;
  gridLine: THREE.Color;
  selection: THREE.Color;
  hover: THREE.Color;
  line: THREE.Color;
}

export type SnapKind = "grid" | "endpoint" | "midpoint" | "center" | "origin" | "axis" | "aligned";

export interface SnapResult {
  point: THREE.Vector3;
  kind: SnapKind;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/**
 * Everything a tool may touch. The viewport implements this; tools stay
 * decoupled from renderer internals.
 */
export interface ToolContext {
  readonly camera: THREE.PerspectiveCamera;
  readonly host: HTMLDivElement;
  readonly palette: ViewPalette;
  readonly settings: { gridSize: number; snapEnabled: boolean; dimSnapStep: number; unitLabel: string };

  scene(): SceneData | null;
  entityById(id: string): EntityData | null;
  objectFor(id: string): THREE.Object3D | null;
  objectsSnapshot(): THREE.Object3D[];
  selection(): string[];
  docId(): string;

  /** World point on the horizontal plane at `height` under the cursor. */
  planePoint(event: PointerEvent | MouseEvent, height?: number): THREE.Vector3 | null;
  /** Camera ray through the cursor. */
  rayAt(event: PointerEvent | MouseEvent): THREE.Ray;
  /** Entity id under the cursor (mesh or line picking). */
  pickEntity(event: PointerEvent | MouseEvent): string | null;
  /** Face pick on the cursor ray (null when no tagged face is under it). */
  pickFace(event: PointerEvent | MouseEvent): FaceHit | null;
  /** Screen-space nearest-edge pick (null when no edge is within threshold). */
  pickEdge(event: PointerEvent | MouseEvent, thresholdPx?: number): EdgeHit | null;
  /** Store-level face/edge/entity selection ref. */
  setSelectionRef(obj: RefObject | null): void;
  screenPoint(event: PointerEvent | MouseEvent): ScreenPoint;
  /** Project a world point to host-relative screen coordinates. */
  worldToScreen(p: THREE.Vector3): ScreenPoint | null;

  /** Snap to grid, sketch endpoints, origin and axes. */
  snap(world: THREE.Vector3, opts?: { grid?: boolean }): SnapResult;
  snapGrid(v: THREE.Vector3): THREE.Vector3;
  /** Snap a scalar dimension (length, width, height, radius) to the active dimension increment (e.g. 1 cm or 2 cm). */
  snapDim(value: number, fine?: boolean): number;

  createEntity(
    geometry: Geometry,
    position: [number, number, number],
    name?: string,
    rotation?: [number, number, number, number],
  ): Promise<string | null>;
  updateGeometry(id: string, geometry: Geometry): Promise<void>;
  deleteEntities(ids: string[]): Promise<void>;
  setVisible(ids: string[], visible: boolean): Promise<void>;
  setSelection(ids: string[], primary: string | null): Promise<void>;
  setTransform(
    id: string,
    transform: { position: [number, number, number]; rotation: [number, number, number, number]; scale: [number, number, number] },
    record: boolean,
  ): Promise<void>;

  /** Managed overlay previews. `tag` groups related objects (default "main"). */
  setPreview(obj: THREE.Object3D, tag?: string): void;
  clearPreview(tag?: string): void;

  /** Marquee selection (implemented by the viewport). */
  startMarquee(event: PointerEvent): void;
  moveMarquee(event: PointerEvent): void;
  finishMarquee(event: PointerEvent): void;
  cancelMarquee(): void;
  isMarqueeActive(): boolean;

  /** Show/hide the move gizmo on the primary selection. */
  setGizmo(mode: GizmoMode | null): void;
  /** True while the pointer hovers or drags a gizmo handle. */
  gizmoActive(): boolean;
  /** True while the gizmo is mid-drag (store sync must not fight it). */
  gizmoBusy(): boolean;

  setStatus(msg: string): void;
  /** Floating measurement label near the cursor; null hides it. */
  showMeasure(text: string | null, screen?: ScreenPoint): void;
  setCursor(style: string): void;
  requestRender(): void;
  capturePointer(event: PointerEvent): void;
  releasePointer(event: PointerEvent): void;
}

export type GizmoMode = "translate" | "rotate" | "scale";

export interface ToolHandler {
  id: ToolId;
  cursor?: string;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  /** Return true when the event was consumed. */
  onPointerDown?(event: PointerEvent, ctx: ToolContext): boolean;
  onPointerMove?(event: PointerEvent, ctx: ToolContext): void;
  onPointerUp?(event: PointerEvent, ctx: ToolContext): void;
  onDoubleClick?(event: MouseEvent, ctx: ToolContext): boolean;
  onKey?(event: KeyboardEvent, ctx: ToolContext): boolean;
  hint?(ctx: ToolContext): string;
  /** True while the tool holds uncommitted state (draft in progress). */
  hasActivity?(ctx: ToolContext): boolean;
  /** Enter pressed: finish multi-point input. */
  onEnter?(ctx: ToolContext): boolean;
  /** Escape pressed: cancel the active draft. */
  onCancel?(ctx: ToolContext): void;
  /** Backspace pressed: remove the last placed point. */
  onBackspace?(ctx: ToolContext): void;
}
