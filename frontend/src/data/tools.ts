import {
  Box,
  BrickWall,
  Circle,
  Cone,
  Database,
  Globe,
  LifeBuoy,
  Minus,
  MousePointer2,
  Move,
  PanelBottom,
  PenLine,
  RectangleHorizontal,
  Ruler,
  Waypoints,
} from "lucide-react";
import type { Geometry, ToolId } from "../lib/types";
import type { LucideIcon } from "lucide-react";

export interface ToolDef {
  id: ToolId;
  label: string;
  tip: string;
  icon: LucideIcon;
  group: "selectors" | "primitives" | "sketch";
}

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", tip: "Select and inspect entities", icon: MousePointer2, group: "selectors" },
  { id: "move", label: "Move", tip: "Drag entities along the ground plane", icon: Move, group: "selectors" },
  { id: "box", label: "Box", tip: "Click to place, or drag to size", icon: Box, group: "primitives" },
  { id: "sphere", label: "Sphere", tip: "Click to place, or drag to set radius", icon: Globe, group: "primitives" },
  { id: "cylinder", label: "Cylinder", tip: "Click to place, or drag to set radius", icon: Database, group: "primitives" },
  { id: "cone", label: "Cone", tip: "Click to place, or drag to set radius", icon: Cone, group: "primitives" },
  { id: "torus", label: "Torus", tip: "Click to place, or drag to set radius", icon: LifeBuoy, group: "primitives" },
  { id: "plane", label: "Plane", tip: "Click to place, or drag to size", icon: PanelBottom, group: "primitives" },
  { id: "sketch", label: "Sketch", tip: "Sketch mode: line, polyline, rectangle, circle (Enter finishes, Esc exits)", icon: PenLine, group: "sketch" },
  { id: "circle", label: "Circle", tip: "Draw a circle outline (drag to set radius)", icon: Circle, group: "sketch" },
  { id: "line", label: "Line", tip: "Draw a line between two points", icon: Minus, group: "sketch" },
  { id: "polyline", label: "Polyline", tip: "Draw a polyline (click to add points, double click to finish)", icon: Waypoints, group: "sketch" },
  { id: "rectangle", label: "Rectangle", tip: "Draw a rectangle outline (drag corner to corner)", icon: RectangleHorizontal, group: "sketch" },
  { id: "dimension", label: "Dimension", tip: "Annotate distance between two points", icon: Ruler, group: "sketch" },
  { id: "wall", label: "Wall", tip: "Draw a wall along a path (double click to finish)", icon: BrickWall, group: "sketch" },
];

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

/** Default payloads for creation tools (snake_case, mirroring serde tags). */
export const DEFAULT_GEOMETRY: Record<ToolId, Geometry | null> = {
  select: null,
  move: null,
  box: { type: "box", width: 60, depth: 60, height: 20, corner_radius: 0 },
  sphere: { type: "sphere", radius: 30, segments: 32 },
  cylinder: { type: "cylinder", radius: 20, height: 40, segments: 32 },
  cone: { type: "cone", radius: 20, height: 40, segments: 32 },
  torus: { type: "torus", radius: 30, tube: 8, segments: 32, tubular_segments: 16 },
  plane: { type: "plane", width: 200, depth: 200 },
  circle: { type: "circle_curve", radius: 40, segments: 48 },
  line: { type: "line_curve", end: [60, 0, 0] },
  polyline: { type: "polyline_curve", points: [] },
  rectangle: { type: "rectangle_curve", width: 80, depth: 50 },
  dimension: { type: "dimension", start: [0, 0, 0], end: [80, 0, 0] },
  wall: { type: "wall", path: [], width: 10, height: 80 },
  sketch: null,
};

/** Export format choices shared by the File menu and command palette. */
export const EXPORT_FORMATS: { id: string; label: string; ext: string }[] = [
  { id: "obj", label: "Export OBJ", ext: "obj" },
  { id: "stl", label: "Export STL", ext: "stl" },
  { id: "stl_ascii", label: "Export STL (ASCII)", ext: "stl" },
  { id: "gltf", label: "Export glTF", ext: "gltf" },
  { id: "step", label: "Export STEP", ext: "step" },
];

/** Two-point sketch tools collect points before sending geometry. */
export const MULTI_POINT_TOOLS: ReadonlySet<ToolId> = new Set([
  "line",
  "polyline",
  "dimension",
  "wall",
  "sketch",
]);
