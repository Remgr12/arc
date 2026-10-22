// Types mirroring the Rust backend payloads.

export type ToolId =
  | "select"
  | "move"
  | "rotate"
  | "scale"
  | "box"
  | "sphere"
  | "cylinder"
  | "cone"
  | "torus"
  | "plane"
  | "line"
  | "polyline"
  | "rectangle"
  | "circle"
  | "arc"
  | "polygon"
  | "dimension"
  | "wall"
  | "offset"
  | "trim"
  | "extend"
  | "fillet"
  | "mirror"
  | "extrude"
  | "extrude-face"
  | "offset-face"
  | "fillet-edge"
  | "revolve"
  | "sweep"
  | "loft"
  /** Legacy sketch meta-tool; maps to polyline. */
  | "sketch";

export type GeometryCategory = "primitive" | "sketch" | "solid" | "architecture" | "annotation";

export type Geometry = {
  type: string;
  [key: string]: unknown;
};

export interface Transform {
  position: [number, number, number];
  rotation: [number, number, number, number];
  scale: [number, number, number];
}

export interface EntityData {
  id: string;
  name: string;
  kind: string;
  category: GeometryCategory;
  layer: string;
  visible: boolean;
  locked: boolean;
  color: [number, number, number, number] | null;
  transform: Transform;
  geometry: Geometry;
  triPositions?: number[] | null;
  triNormals?: number[] | null;
  /** Per-triangle face group id (parallel to triPositions, 1 per triangle). */
  triFaceIds?: number[] | null;
  lines?: number[] | null;
  material?: string | null;
}

export interface LayerData {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  color: [number, number, number, number];
}

export interface SceneData {
  version: number;
  name: string;
  modified: boolean;
  path: string | null;
  activeLayer: string;
  entities: EntityData[];
  layers: LayerData[];
  selection: string[];
  primary: string | null;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  historyLen: number;
  historyPos: number;
}

export interface DocumentInfo {
  id: string;
  name: string;
  dirty: boolean;
  path: string | null;
}

export interface Settings {
  units: string;
  grid_size: number;
  snap_enabled: boolean;
  show_grid: boolean;
  show_axes: boolean;
  enabled_plugins: string[];
  recent_files: string[];
  reopen_last_session: boolean;
  workspace_dir: string | null;
  updater_last_check: number | null;
}

export interface ProjectSummary {
  name: string;
  path: string;
  modified: number;
  size: number;
}

export interface PluginInfo {
  name: string;
  path: string;
  enabled: boolean;
  ok: boolean;
  error: string | null;
}

export interface UpdateNotice {
  available: boolean;
  version: string | null;
  notes: string | null;
  installable: boolean;
}

export interface AppOverview {
  documents: DocumentInfo[];
  active: string | null;
  settings: Settings;
  updater?: UpdateNotice;
}

export type SelKind = "entity" | "face" | "edge";

export interface RefObject {
  entityId: string;
  kind: SelKind;
  face?: number | null;
  edge?: string | null;
  point: [number, number, number];
  normal: [number, number, number];
}

export interface RayHit {
  entity_id: string;
  point: [number, number, number];
  normal: [number, number, number];
  distance: number;
  face?: number | null;
}

export interface SceneEnvelope {
  documentId: string;
  scene: SceneData;
}
