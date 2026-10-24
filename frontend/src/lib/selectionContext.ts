import type { ToolId } from "./types";

export type SelectionContext =
  | "none"
  | "body"
  | "face"
  | "edge"
  | "sketch"
  | "multi";

/** Tools that belong to 2D sketching and sketch modification. */
export const SKETCH_TOOLS: ReadonlySet<ToolId> = new Set([
  "line",
  "polyline",
  "rectangle",
  "circle",
  "arc",
  "polygon",
  "offset",
  "trim",
  "extend",
  "fillet",
  "mirror",
]);

export const SKETCH_ENTITY_KINDS: ReadonlySet<string> = new Set([
  "line",
  "polyline",
  "circle",
  "arc",
  "rectangle",
  "polygon",
  "line_curve",
  "polyline_curve",
  "circle_curve",
  "arc_curve",
  "rectangle_curve",
  "polygon_curve",
  "sketch",
]);

/**
 * Pure derivation of the context-reactive UI mode from selection + tool state.
 * `primaryKind` is the kind of the primary selected entity, null when nothing
 * is selected.
 */
export function deriveSelectionContext(
  selKind: "entity" | "face" | "edge",
  selectionCount: number,
  primaryKind: string | null,
  tool: ToolId,
  drafting: boolean,
  sketchMode = false,
): SelectionContext {
  if (sketchMode || SKETCH_TOOLS.has(tool) || (drafting && SKETCH_TOOLS.has(tool))) {
    return "sketch";
  }
  if (tool === "extrude-face" || tool === "offset-face") {
    return selectionCount >= 1 ? "face" : "none";
  }
  if (tool === "fillet-edge") {
    return selectionCount >= 1 ? "edge" : "none";
  }
  if (selKind === "face" && selectionCount >= 1) return "face";
  if (selKind === "edge" && selectionCount >= 1) return "edge";
  if (selectionCount > 1) {
    if (primaryKind && SKETCH_ENTITY_KINDS.has(primaryKind)) return "sketch";
    return "multi";
  }
  if (selectionCount === 1) {
    if (primaryKind && (SKETCH_ENTITY_KINDS.has(primaryKind) || primaryKind.endsWith("_curve"))) {
      return "sketch";
    }
    return "body";
  }
  return "none";
}
