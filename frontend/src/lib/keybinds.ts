import { actions } from "./actions";
import { TOOLS } from "../data/tools";
import { useArcStore } from "./store";
import type { ToolId } from "./types";

const TOOL_KEYS: Record<string, ToolId> = {
  v: "select",
  m: "move",
  b: "box",
  y: "sphere",
  c: "cylinder",
  o: "cone",
  t: "torus",
  p: "plane",
  g: "circle",
  l: "line",
  j: "polyline",
  r: "rectangle",
  d: "dimension",
  h: "wall",
};

function isInputFocused(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

export interface KeybindInfo {
  keys: string;
  label: string;
}

export const KEYBINDS: KeybindInfo[] = [
  ...TOOLS.map((t) => {
    const key = Object.entries(TOOL_KEYS).find(([, id]) => id === t.id)?.[0];
    return { keys: key ? key.toUpperCase() : "", label: t.label };
  }),
  { keys: "Ctrl  K", label: "Command palette" },
  { keys: "Ctrl  Z", label: "Undo" },
  { keys: "Ctrl  Shift  Z", label: "Redo" },
  { keys: "Ctrl  N", label: "New document" },
  { keys: "Ctrl  O", label: "Open document" },
  { keys: "Ctrl  S", label: "Save document" },
  { keys: "Ctrl  E", label: "Export model" },
  { keys: "Ctrl  A", label: "Select all" },
  { keys: "Ctrl  D", label: "Duplicate" },
  { keys: "Delete", label: "Delete selection" },
  { keys: "F", label: "Fit view to selection" },
];

/** Install the global keyboard handler. Returns a cleanup function. */
export function installKeybinds(): () => void {
  const handler = (e: KeyboardEvent) => {
    const st = useArcStore.getState();
    if (isInputFocused() && e.key !== "Escape") return;

    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    if (mod) {
      switch (key) {
        case "k":
          e.preventDefault();
          actions.togglePalette();
          return;
        case "z":
          e.preventDefault();
          if (e.shiftKey) actions.redo();
          else actions.undo();
          return;
        case "y":
          e.preventDefault();
          actions.redo();
          return;
        case "n":
          e.preventDefault();
          actions.newDocument();
          return;
        case "o":
          e.preventDefault();
          actions.openDocument();
          return;
        case "s":
          e.preventDefault();
          void actions.saveActive();
          return;
        case "e":
          e.preventDefault();
          actions.exportActive("obj");
          return;
        case "a":
          e.preventDefault();
          void actions.selectAll();
          return;
        case "d":
          e.preventDefault();
          void actions.duplicateSelection();
          return;
        case ",":
          e.preventDefault();
          actions.openSettings();
          return;
        default:
          return;
      }
    }

    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      void actions.deleteSelection();
      return;
    }
    if (key === "f") {
      actions.fitView();
      return;
    }
    if (key === "escape") {
      if (st.paletteOpen) st.setPaletteOpen(false);
      else if (st.scene && st.scene.selection.length > 0) void actions.clearSelection();
      return;
    }
    const tool = TOOL_KEYS[key];
    if (tool) {
      st.setTool(tool);
      e.preventDefault();
    }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}
