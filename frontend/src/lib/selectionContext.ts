import type { ToolId } from "./types";

export type SelectionContext =
  | "none"
  | "body"
  | "face"
  | "edge"
  | "sketch"
  | "multi";

/** Tools that put the app into sketching mode. */
const SKETCH_TOOLS: ReadonlySet<ToolId> = new Set([
  "line",
  "polyline",
  "rectangle",
  "circle",
  "arc",
  "polygon",
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
): SelectionContext {
  if (drafting && SKETCH_TOOLS.has(tool)) return "sketch";
  if (tool === "extrude-face" || tool === "offset-face" || tool === "fillet-edge") {
    return selectionCount >= 1 ? "face" : "none";
  }
  if (selKind === "face" && selectionCount >= 1) return "face";
  if (selKind === "edge" && selectionCount >= 1) return "edge";
  if (selectionCount > 1) return "multi";
  if (selectionCount === 1) {
    if (primaryKind && (primaryKind.endsWith("_curve") || primaryKind === "sketch")) {
      return "sketch";
    }
    return "body";
  }
  return "none";
}
