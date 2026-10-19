import {
  ArrowRightToLine,
  ArrowUpFromLine,
  Blend,
  Box,
  BrickWall,
  Cable,
  Circle,
  Cone,
  Cylinder,
  Equal,
  FlipHorizontal2,
  Globe,
  Layers,
  LifeBuoy,
  Minus,
  MousePointer2,
  Move3d,
  PanelBottom,
  Pentagon,
  RectangleHorizontal,
  RotateCw,
  Ruler,
  Slice,
  Spline,
  Waypoints,
} from "lucide-react";
import type { Geometry, ToolId } from "../lib/types";
import type { LucideIcon } from "lucide-react";

export type ToolGroup = "select" | "sketch" | "modify" | "solid" | "primitives" | "annotate";

export interface ToolDef {
  id: ToolId;
  label: string;
  tip: string;
  icon: LucideIcon;
  group: ToolGroup;
}

export const TOOLS: ToolDef[] = [
  { id: "select", label: "Select", tip: "Select and inspect entities (Esc)", icon: MousePointer2, group: "select" },
  { id: "move", label: "Move", tip: "Drag entities with the transform gizmo (M)", icon: Move3d, group: "select" },

  { id: "line", label: "Line", tip: "Line between two points (L). Shift = ortho. Chain from endpoints", icon: Minus, group: "sketch" },
  { id: "polyline", label: "Polyline", tip: "Multi-segment polyline (J). Click first point again or Enter to close", icon: Waypoints, group: "sketch" },
  { id: "rectangle", label: "Rectangle", tip: "Rectangle by two corners (R). Shift = square", icon: RectangleHorizontal, group: "sketch" },
  { id: "circle", label: "Circle", tip: "Circle by center and radius (C)", icon: Circle, group: "sketch" },
  { id: "arc", label: "Arc", tip: "Arc through three points (A): start, end, bulge", icon: Spline, group: "sketch" },
  { id: "polygon", label: "Polygon", tip: "Regular polygon centered at a point (N). Shift = don't snap rotation", icon: Pentagon, group: "sketch" },

  { id: "offset", label: "Offset", tip: "Offset curves by a distance (O). Click sketches to arm, click to place", icon: Equal, group: "modify" },
  { id: "trim", label: "Trim", tip: "Delete the crossed segment (T)", icon: Slice, group: "modify" },
  { id: "extend", label: "Extend", tip: "Extend an end to the next curve (X)", icon: ArrowRightToLine, group: "modify" },
  { id: "fillet", label: "Fillet", tip: "Round a polyline corner (F). Choose vertex, set radius, click", icon: Blend, group: "modify" },
  { id: "mirror", label: "Mirror", tip: "Mirror selected curves across a two-point axis (I)", icon: FlipHorizontal2, group: "modify" },

  { id: "extrude", label: "Extrude", tip: "Extrude a closed profile (E). Pick profile, drag height, click", icon: ArrowUpFromLine, group: "solid" },
  { id: "revolve", label: "Revolve", tip: "Revolve an open profile around an axis (W). Pick profile, axis, then angle", icon: RotateCw, group: "solid" },
  { id: "sweep", label: "Sweep", tip: "Sweep a tube along a path (S). Pick path, drag radius, click", icon: Cable, group: "solid" },
  { id: "loft", label: "Loft", tip: "Loft through closed profiles (K). Click 2+ profiles, Enter to commit", icon: Layers, group: "solid" },

  { id: "box", label: "Box", tip: "Click base, drag second point, set height (B)", icon: Box, group: "primitives" },
  { id: "sphere", label: "Sphere", tip: "Click center, drag radius (G)", icon: Globe, group: "primitives" },
  { id: "cylinder", label: "Cylinder", tip: "Click base, drag radius, set height (Q)", icon: Cylinder, group: "primitives" },
  { id: "cone", label: "Cone", tip: "Click base, drag radius, set height (Z)", icon: Cone, group: "primitives" },
  { id: "torus", label: "Torus", tip: "Click center, drag radius (Y)", icon: LifeBuoy, group: "primitives" },
  { id: "plane", label: "Plane", tip: "Two clicks: near and far corners (P)", icon: PanelBottom, group: "primitives" },

  { id: "dimension", label: "Dimension", tip: "Annotate the distance between two points", icon: Ruler, group: "annotate" },
  { id: "wall", label: "Wall", tip: "Draw a wall along a path. Double-click or Enter to finish", icon: BrickWall, group: "annotate" },
];

/** Kept for compatibility with older profiles stored in localStorage. */
export const LEGACY_SKETCH: ToolId = "sketch";

export const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

/** Tailwind-average canvas colors for the Items list, mirroring rust category defaults. */
export const TOOL_COLORS: Partial<Record<ToolId, string>> = {
  line: "#4ea3ff",
};

/** Default geometry payloads for one-click creation fallbacks (command line etc.). */
export const DEFAULT_GEOMETRY: Partial<Record<ToolId, Geometry>> = {
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
};

/** Export format choices shared by the File menu and command palette. */
export const EXPORT_FORMATS: { id: string; label: string; ext: string }[] = [
  { id: "obj", label: "Export OBJ", ext: "obj" },
  { id: "stl", label: "Export STL", ext: "stl" },
  { id: "stl_ascii", label: "Export STL (ASCII)", ext: "stl" },
  { id: "gltf", label: "Export glTF", ext: "gltf" },
  { id: "step", label: "Export STEP", ext: "step" },
];
