import type { ToolId } from "../lib/types";
import type { ToolHandler } from "./types";
import { selectTool } from "./select";
import { moveTool, rotateTool, scaleTool } from "./transform";
import { lineTool, polylineTool, rectangleTool, circleTool, arcTool, polygonTool } from "./sketch";
import { offsetTool, trimTool, extendTool, filletTool, mirrorTool } from "./edit";
import { extrudeTool, revolveTool, sweepTool, loftTool } from "./solid";
import { extrudeFaceTool, offsetFaceTool, filletEdgeTool } from "./faceTools";
import { boxTool, sphereTool, cylinderTool, coneTool, torusTool, planeTool } from "./primitives";
import { dimensionTool, wallTool } from "./annotate";

/** Handler for every registered tool id. */
export const HANDLERS: ReadonlyMap<ToolId, ToolHandler> = new Map([
  ["select", selectTool],
  ["move", moveTool],
  ["rotate", rotateTool],
  ["scale", scaleTool],
  ["line", lineTool],
  ["polyline", polylineTool],
  ["rectangle", rectangleTool],
  ["circle", circleTool],
  ["arc", arcTool],
  ["polygon", polygonTool],
  ["offset", offsetTool],
  ["trim", trimTool],
  ["extend", extendTool],
  ["fillet", filletTool],
  ["mirror", mirrorTool],
  ["extrude", extrudeTool],
  ["extrude-face", extrudeFaceTool],
  ["offset-face", offsetFaceTool],
  ["fillet-edge", filletEdgeTool],
  ["revolve", revolveTool],
  ["sweep", sweepTool],
  ["loft", loftTool],
  ["box", boxTool],
  ["sphere", sphereTool],
  ["cylinder", cylinderTool],
  ["cone", coneTool],
  ["torus", torusTool],
  ["plane", planeTool],
  ["dimension", dimensionTool],
  ["wall", wallTool],
]);

/** "sketch" is a legacy alias for the polyline tool. */
export function normalizeTool(tool: ToolId): ToolId {
  return tool === "sketch" ? "polyline" : tool;
}

export function handlerFor(tool: ToolId): ToolHandler | null {
  return HANDLERS.get(normalizeTool(tool)) ?? null;
}
