import { actions } from "./actions";
import { TOOL_BY_ID } from "../data/tools";
import { useArcStore } from "./store";
import { uiCapture } from "./uiCapture";
import type { ToolId } from "./types";
import {
  type ActionDef,
  type KeybindProfile,
  ACTION_DEFS,
  eventBinding,
  formatBinding,
  useKeybindStore,
} from "./keybindProfiles";

export interface KeybindInfo {
  keys: string;
  label: string;
}

/** Display list of the active profile's bindings, for menus and help popups. */
export function listKeybindInfos(): KeybindInfo[] {
  const profile = useKeybindStore.getState().active();
  return ACTION_DEFS.map((def) => ({
    keys: (profile.bindings[def.id] ?? []).map(formatBinding).join(" / "),
    label: def.label,
  })).filter((info) => info.keys.length > 0);
}

/** Hint text for a file menu item, e.g. "Ctrl N". */
export function bindingHint(actionId: string): string {
  const profile = useKeybindStore.getState().active();
  const binding = (profile.bindings[actionId] ?? [])[0];
  return binding ? formatBinding(binding) : "";
}

function isInputFocused(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    el instanceof HTMLSelectElement
  );
}

function bindingMapFor(profile: KeybindProfile): Map<string, ActionDef> {
  const byId = new Map(ACTION_DEFS.map((def) => [def.id, def]));
  const map = new Map<string, ActionDef>();
  for (const [action, bindings] of Object.entries(profile.bindings)) {
    const def = byId.get(action);
    if (!def) continue;
    for (const binding of bindings) if (!map.has(binding)) map.set(binding, def);
  }
  return map;
}

function runAction(def: ActionDef): void {
  const [kind, name] = [def.id.slice(0, def.id.indexOf(":")), def.id.slice(def.id.indexOf(":") + 1)];
  if (kind === "tool") {
    useArcStore.getState().setTool(name as ToolId);
    return;
  }
  const st = useArcStore.getState();
  switch (name) {
    case "new":
      void actions.newDocument();
      return;
    case "open":
      void actions.openDocument();
      return;
    case "save":
      void actions.saveActive();
      return;
    case "saveAs":
      void actions.saveDocumentAs();
      return;
    case "export":
      void actions.exportActive("obj");
      return;
    case "undo":
      void actions.undo();
      return;
    case "redo":
      void actions.redo();
      return;
    case "selectAll":
      void actions.selectAll();
      return;
    case "duplicate":
      void actions.duplicateSelection();
      return;
    case "delete":
      void actions.deleteSelection();
      return;
    case "explode":
      void actions.explodeSelection();
      return;
    case "fit":
      actions.fitView();
      return;
    case "palette":
      actions.togglePalette();
      return;
    case "settings":
      actions.openSettings();
      return;
    case "plugins":
      void actions.reloadPlugins();
      return;
    case "commandLine":
      actions.openCommandLine();
      return;
    case "clear":
      if (st.paletteOpen) st.setPaletteOpen(false);
      else if (st.scene && st.scene.selection.length > 0) void actions.clearSelection();
      return;
    default:
      return;
  }
}

/** Install the global keyboard handler. Returns a cleanup function. */
export function installKeybinds(): () => void {
  const store = useKeybindStore.getState();
  let map = bindingMapFor(store.active());

  const rebuild = (state: { profiles: KeybindProfile[]; activeId: string }) => {
    const profile = state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0];
    map = bindingMapFor(profile);
  };
  const unsubscribe = useKeybindStore.subscribe(rebuild);

  const handler = (e: KeyboardEvent) => {
    if (uiCapture.active) return; // a capture field owns these keystrokes
    const st = useArcStore.getState();
    if (isInputFocused() && e.key !== "Escape") return;

    const binding = eventBinding(e);
    if (!binding) return;

    if (binding === "escape") {
      if (st.paletteOpen) {
        st.setPaletteOpen(false);
        return;
      }
      if (st.commandLineOpen) {
        st.setCommandLineOpen(false);
        return;
      }
      if (st.drafting) {
        window.dispatchEvent(new CustomEvent("arc-draft-cancel"));
        st.setDrafting(false);
        if (!st.sketchMode) {
          st.setTool("select");
          st.setSelectionRef(null);
        }
        return;
      }
      if (st.sketchMode) {
        window.dispatchEvent(new CustomEvent("arc-draft-cancel"));
        st.exitSketchMode();
        return;
      }
      if (st.tool !== "select") {
        window.dispatchEvent(new CustomEvent("arc-draft-cancel"));
        st.setTool("select");
        st.setDrafting(false);
        st.setSelectionRef(null);
        return;
      }
      if (st.selFace || st.selEdge || (st.scene && st.scene.selection.length > 0)) {
        st.setSelectionRef(null);
        void actions.clearSelection();
        return;
      }
      return;
    }

    if (st.sketchMode && e.code === "Space" && !isInputFocused()) {
      e.preventDefault();
      const n = st.sketchPlaneNormal;
      window.dispatchEvent(
        new CustomEvent("arc-focus-plane", { detail: { normal: n } }),
      );
      return;
    }

    if (binding === "enter") {
      if (st.tool !== "select" || st.drafting) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("arc-draft-enter"));
        st.setTool("select");
        st.setDrafting(false);
        return;
      }
    }

    if (st.tool !== "select" && binding === "backspace") {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent("arc-draft-backspace"));
      return;
    }

    const action = map.get(binding);
    if (!action) return;
    e.preventDefault();
    runAction(action);
  };
  window.addEventListener("keydown", handler);
  return () => {
    unsubscribe();
    window.removeEventListener("keydown", handler);
  };
}

/** Validate an action id for the palette (kept for runtime tool checks). */
export function isToolAction(id: string): boolean {
  return TOOL_BY_ID.has(id as ToolId);
}
