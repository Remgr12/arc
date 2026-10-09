export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface BoundingBox {
  min: Point3;
  max: Point3;
}

export interface Transform {
  translation: Vector3;
  rotation: { x: number; y: number; z: number; w: number };
  scale: Vector3;
}

export interface EntityId {
  uuid: string;
}

export type EntityType =
  | 'Point' | 'Line' | 'Arc' | 'Circle' | 'Ellipse' | 'Spline' | 'Rectangle' | 'Polygon' | 'Text'
  | 'Extrusion' | 'Revolution' | 'Loft' | 'Sweep' | 'Fillet' | 'Chamfer' | 'Shell' | 'Boolean'
  | 'Wall' | 'Door' | 'Window' | 'Stair' | 'Roof' | 'Slab' | 'Column' | 'Beam' | 'Room' | 'Grid' | 'Level'
  | 'Plane' | 'Axis' | 'Point3D' | 'CoordinateSystem'
  | 'Dimension' | 'Leader' | 'Tag' | 'Symbol'
  | 'Group' | 'Block' | 'ExternalReference';

export type EntityCategory =
  | 'Sketch' | 'Solid' | 'Surface' | 'Mesh' | 'Architecture' | 'Annotation' | 'Reference' | 'Group';

export interface Entity {
  id: EntityId;
  name: string;
  type: EntityType;
  category: EntityCategory;
  visible: boolean;
  locked: boolean;
  color?: Color;
  layerId: EntityId;
  transform: Transform;
  boundingBox: BoundingBox;
  metadata: Record<string, unknown>;
}

export interface Layer {
  id: EntityId;
  name: string;
  visible: boolean;
  locked: boolean;
  color: Color;
  lineWeight: number;
  lineType: LineType;
  printable: boolean;
}

export type LineType =
  | 'Continuous' | 'Dashed' | 'Dotted' | 'DashDot' | 'DashDotDot'
  | 'Border' | 'Center' | 'Hidden' | 'Phantom';

export interface ViewportState {
  viewType: ViewType;
  cameraPosition: Point3;
  cameraTarget: Point3;
  cameraUp: Vector3;
  fov: number;
  near: number;
  far: number;
  aspectRatio: number;
}

export type ViewType =
  | 'Perspective' | 'Orthographic'
  | 'Top' | 'Bottom' | 'Front' | 'Back' | 'Left' | 'Right'
  | 'Isometric' | 'Dimetric' | 'Trimetric';

export interface Selection {
  selectedIds: EntityId[];
  primaryId?: EntityId;
  hoverId?: EntityId;
}

export interface SnapResult {
  point: Point3;
  snapType: SnapType;
  entityId?: EntityId;
  distance: number;
}

export type SnapType =
  | 'Endpoint' | 'Midpoint' | 'Center' | 'Intersection' | 'Perpendicular'
  | 'Tangent' | 'Quadrant' | 'Nearest' | 'Node' | 'Insert' | 'Extension'
  | 'Parallel' | 'Grid';

export interface SnapSettings {
  enabled: boolean;
  modes: SnapType[];
  aperture: number;
  showMarkers: boolean;
  snapToGrid: boolean;
  gridSpacing: number;
  polarTracking: boolean;
  polarIncrement: number;
  objectSnapTracking: boolean;
}

export interface Units {
  system: 'Metric' | 'Imperial';
  length: LengthUnit;
  angle: AngleUnit;
  precision: number;
  anglePrecision: number;
}

export type LengthUnit =
  | 'Millimeter' | 'Centimeter' | 'Meter' | 'Kilometer'
  | 'Inch' | 'Foot' | 'Yard' | 'Mile';

export type AngleUnit =
  | 'Degree' | 'Radian' | 'Gradian' | 'Surveyor';

export interface Document {
  id: EntityId;
  name: string;
  path?: string;
  modified: boolean;
  version: number;
  units: Units;
  snapSettings: SnapSettings;
  entities: Entity[];
  layers: Layer[];
  selection: Selection;
  viewports: ViewportState[];
  activeViewport: number;
}

export interface HistoryEntry {
  id: EntityId;
  actionType: 'Create' | 'Delete' | 'Modify' | 'Transform' | 'PropertyChange' | 'Group' | 'Ungroup';
  description: string;
  timestamp: number;
}

export interface AppSettings {
  theme: 'dark' | 'light' | 'high-contrast';
  keybindPreset: 'default' | 'shapr3d' | 'autocad' | 'blender';
  gridEnabled: boolean;
  gridSize: number;
  gridSubdivisions: number;
  snapEnabled: boolean;
  orthoMode: boolean;
  polarTracking: boolean;
  objectSnap: boolean;
  dynamicInput: boolean;
  units: Units;
  autoSave: boolean;
  autoSaveInterval: number;
  language: string;
  viewportBackground: string;
  showNavigationCube: boolean;
  showGrid: boolean;
  showAxes: boolean;
  renderMode: RenderMode;
  msaaSamples: number;
  ambientOcclusion: boolean;
  shadows: boolean;
  showSnapIndicator: boolean;
  snapTolerance: number;
}

export type RenderMode =
  | 'Wireframe' | 'HiddenLine' | 'Shaded' | 'ShadedWithEdges' | 'Realistic' | 'Conceptual' | 'XRay';

export type Settings = AppSettings;

export interface Tool {
  id: string;
  name: string;
  icon: string;
  category: ToolCategory;
  shortcut?: string;
  cursor?: string;
  options?: ToolOption[];
}

export type ToolCategory =
  | 'Select' | 'Sketch' | 'Model' | 'Architecture' | 'Modify' | 'Annotate' | 'View' | 'Measure';

export interface ToolOption {
  id: string;
  name: string;
  type: 'boolean' | 'number' | 'string' | 'enum';
  value: unknown;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface Command {
  id: string;
  name: string;
  description: string;
  category: string;
  shortcut?: string;
  icon?: string;
  action: string;
}

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  enabled: boolean;
  loaded: boolean;
}

export interface UIPanel {
  id: string;
  title: string;
  component: string;
  defaultPosition: PanelPosition;
  defaultSize: PanelSize;
  visible: boolean;
  icon?: string;
}

export type PanelPosition = 'left' | 'right' | 'top' | 'bottom' | 'floating';
export type PanelSize = { width?: number; height?: number; minWidth?: number; minHeight?: number };

export interface ToolbarButton {
  id: string;
  toolId: string;
  position: number;
  group: string;
}

export interface KeyboardShortcut {
  id: string;
  key: string;
  modifiers?: ('shift' | 'ctrl' | 'alt' | 'meta')[];
  action: string;
  context?: string;
  description: string;
}

export interface KeybindPreset {
  id: string;
  name: string;
  description: string;
  shortcuts: KeyboardShortcut[];
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: Record<string, string>;
  isBuiltIn: boolean;
}

export interface ViewportCamera {
  position: Point3;
  target: Point3;
  up: Vector3;
  fov: number;
  near: number;
  far: number;
  aspectRatio: number;
  projection: 'perspective' | 'orthographic';
}

export interface RaycastHit {
  entityId: EntityId;
  point: Point3;
  normal: Vector3;
  distance: number;
}

export interface Constraint {
  id: EntityId;
  type: ConstraintType;
  entities: EntityId[];
  parameters: Record<string, number>;
  enabled: boolean;
  driven: boolean;
}

export type ConstraintType =
  | 'Coincident' | 'Collinear' | 'Concentric' | 'Parallel' | 'Perpendicular'
  | 'Tangent' | 'Horizontal' | 'Vertical' | 'Equal' | 'Symmetric' | 'Fix' | 'Midpoint'
  | 'Distance' | 'Angle' | 'Radius' | 'Diameter' | 'Length';

export interface Sketch {
  id: EntityId;
  name: string;
  plane: Plane;
  entities: Entity[];
  constraints: Constraint[];
  isActive: boolean;
}

export interface Plane {
  origin: Point3;
  normal: Vector3;
  xAxis: Vector3;
  yAxis: Vector3;
}

export interface Feature {
  id: EntityId;
  name: string;
  type: FeatureType;
  parameters: Record<string, unknown>;
  sketchId?: EntityId;
  isActive: boolean;
  children: EntityId[];
}

export type FeatureType =
  | 'Extrusion' | 'Revolution' | 'Loft' | 'Sweep' | 'Fillet' | 'Chamfer'
  | 'Shell' | 'Pattern' | 'Mirror' | 'Hole' | 'Thread' | 'Rib' | 'Draft';

export interface Part {
  id: EntityId;
  name: string;
  features: Feature[];
  bodies: EntityId[];
  sketches: EntityId[];
  parameters: Record<string, number>;
}

export interface Assembly {
  id: EntityId;
  name: string;
  parts: EntityId[];
  joints: Joint[];
  transform: Transform;
}

export interface Joint {
  id: EntityId;
  type: JointType;
  partA: EntityId;
  partB: EntityId;
  originA: Point3;
  originB: Point3;
  axisA: Vector3;
  axisB: Vector3;
  limits?: JointLimits;
}

export type JointType =
  | 'Rigid' | 'Revolute' | 'Slider' | 'Cylindrical' | 'PinSlot' | 'Planar' | 'Ball';

export interface JointLimits {
  min?: number;
  max?: number;
  rest?: number;
}

export interface ArchitecturalElement {
  id: EntityId;
  type: ArchitecturalElementType;
  name: string;
  levelId: EntityId;
  transform: Transform;
  properties: Record<string, unknown>;
}

export type ArchitecturalElementType =
  | 'Wall' | 'Door' | 'Window' | 'Stair' | 'Roof' | 'Slab'
  | 'Column' | 'Beam' | 'Room' | 'Space' | 'Grid' | 'Level';

export interface Wall {
  id: EntityId;
  baseline: Point3[];
  height: number;
  thickness: number;
  baseHeight: number;
  justification: 'Left' | 'Center' | 'Right';
  layers: WallLayer[];
  openings: EntityId[];
}

export interface WallLayer {
  name: string;
  thickness: number;
  material: string;
  function: 'Structure' | 'Substrate' | 'Insulation' | 'Finish1' | 'Finish2' | 'Membrane' | 'Other';
}

export interface Door {
  id: EntityId;
  width: number;
  height: number;
  thickness: number;
  swingAngle: number;
  swingDirection: 'In' | 'Out' | 'Left' | 'Right';
  hingeSide: 'Left' | 'Right';
  style: 'Panel' | 'Flush' | 'Glass' | 'Louvered' | 'French' | 'Dutch' | 'Barn' | 'Pivot';
}

export interface Window {
  id: EntityId;
  width: number;
  height: number;
  sillHeight: number;
  headHeight: number;
  type: 'Fixed' | 'Casement' | 'Awning' | 'Hopper' | 'Sliding' | 'DoubleHung' | 'TiltTurn';
  mullions: Mullion[];
}

export interface Mullion {
  orientation: 'Vertical' | 'Horizontal';
  position: number;
  width: number;
}

export interface Level {
  id: EntityId;
  name: string;
  elevation: number;
  height: number;
  type: 'Story' | 'Reference' | 'Datum' | 'Roof' | 'Basement' | 'Mezzanine' | 'Penthouse';
  color: Color;
}

export interface Grid {
  id: EntityId;
  name: string;
  type: 'Rectangular' | 'Radial';
  origin: Point3;
  spacing: Point3;
  count: { x: number; y: number };
  labels: { prefix: string; start: number; increment: number };
}

export interface Room {
  id: EntityId;
  name: string;
  number: string;
  type: string;
  boundary: Point3[];
  height: number;
  baseHeight: number;
  finishes: {
    floor: string;
    wall: string;
    ceiling: string;
    base: string;
  };
  area: number;
  perimeter: number;
  volume: number;
}

export interface Annotation {
  id: EntityId;
  type: AnnotationType;
  position: Point3;
  text: string;
  style: TextStyle;
}

export type AnnotationType =
  | 'Text' | 'Dimension' | 'Leader' | 'Tag' | 'Symbol' | 'RevisionCloud'
  | 'Keynote' | 'SpotElevation' | 'SpotCoordinate' | 'NorthArrow' | 'ScaleBar';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  color: Color;
  alignment: 'Left' | 'Center' | 'Right' | 'Justified';
  lineSpacing: number;
}

export interface AppEvent {
  type: string;
  payload: unknown;
  timestamp: number;
}

export interface IPCMessage<T = unknown> {
  id: string;
  type: 'command' | 'event' | 'request' | 'response';
  channel: string;
  payload: T;
  timestamp: number;
}