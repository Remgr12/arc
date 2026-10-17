import { create } from "zustand";
import { TOOLS } from "../data/tools";

// --------------------------------------------------------------------------
// Keybind profiles. A profile maps action ids (tools and commands) to key
// bindings. The built-in "Classic" profile mirrors the historical default
// layout; users can create, rename, reset and delete their own profiles and
// edit every binding with a live capture field. Stored in localStorage.
//
// A binding is a canonical string like "ctrl+shift+z", "delete", "b" or "f5".
// --------------------------------------------------------------------------

export type Binding = string;

export interface KeybindProfile {
  id: string;
  name: string;
  builtin: boolean;
  bindings: Record<string, Binding[]>;
}

export type ActionGroup = "Tools" | "File" | "Edit" | "View" | "App";

export interface ActionDef {
  id: string;
  label: string;
  group: ActionGroup;
}

export const ACTION_GROUPS: ActionGroup[] = ["Tools", "File", "Edit", "View", "App"];

export const ACTION_DEFS: ActionDef[] = [
  ...TOOLS.map((t) => ({ id: `tool:${t.id}`, label: t.label, group: "Tools" as ActionGroup })),
  { id: "doc:new", label: "New document", group: "File" },
  { id: "doc:open", label: "Open…", group: "File" },
  { id: "doc:save", label: "Save", group: "File" },
  { id: "doc:saveAs", label: "Save As…", group: "File" },
  { id: "doc:export", label: "Export model", group: "File" },
  { id: "edit:undo", label: "Undo", group: "Edit" },
  { id: "edit:redo", label: "Redo", group: "Edit" },
  { id: "edit:selectAll", label: "Select all", group: "Edit" },
  { id: "edit:duplicate", label: "Duplicate", group: "Edit" },
  { id: "edit:delete", label: "Delete selection", group: "Edit" },
  { id: "edit:explode", label: "Explode selection", group: "Edit" },
  { id: "edit:clear", label: "Clear selection / close menus", group: "View" },
  { id: "view:fit", label: "Fit view to selection", group: "View" },
  { id: "app:palette", label: "Command palette", group: "App" },
  { id: "app:settings", label: "Settings", group: "App" },
  { id: "app:plugins", label: "Reload plugins", group: "App" },
];

export const DEFAULT_BINDINGS: Record<string, Binding[]> = {
  "tool:select": ["v"],
  "tool:move": ["m"],
  "tool:box": ["b"],
  "tool:sphere": ["y"],
  "tool:cylinder": ["c"],
  "tool:cone": ["o"],
  "tool:torus": ["t"],
  "tool:plane": ["p"],
  "tool:circle": ["g"],
  "tool:line": ["l"],
  "tool:polyline": ["j"],
  "tool:rectangle": ["r"],
  "tool:dimension": ["d"],
  "tool:wall": ["h"],
  "doc:new": ["ctrl+n"],
  "doc:open": ["ctrl+o"],
  "doc:save": ["ctrl+s"],
  "doc:export": ["ctrl+e"],
  "edit:undo": ["ctrl+z"],
  "edit:redo": ["ctrl+shift+z", "ctrl+y"],
  "edit:selectAll": ["ctrl+a"],
  "edit:duplicate": ["ctrl+d"],
  "edit:delete": ["delete", "backspace"],
  "view:fit": ["f"],
  "app:palette": ["ctrl+k"],
  "app:settings": ["ctrl,"],
};

// ------------------------------------------------------------- binding helpers

const BARE_MODIFIERS = new Set([
  "shift",
  "control",
  "ctrl",
  "meta",
  "alt",
  "option",
  "capslock",
  "numlock",
  "scrolllock",
  "contextmenu",
  "dead",
  "unidentified",
]);

/** Canonical binding for a keyboard event, or null for bare modifiers. */
export function eventBinding(e: KeyboardEvent): Binding | null {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.metaKey) parts.push("meta");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  let key = e.key.toLowerCase();
  if (e.key === " ") key = "space";
  if (BARE_MODIFIERS.has(key) || key === "") return null;
  parts.push(key);
  return parts.join("+");
}

const DISPLAY_LABELS: Record<string, string> = {
  ctrl: "Ctrl",
  meta: "Cmd",
  alt: "Alt",
  shift: "Shift",
  space: "Space",
  escape: "Esc",
  enter: "Enter",
  backspace: "Backspace",
  delete: "Delete",
  tab: "Tab",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
};

/** Human display for a canonical binding, e.g. "Ctrl Shift Z". */
export function formatBinding(binding: Binding): string {
  return binding
    .split("+")
    .map((part) => {
      const known = DISPLAY_LABELS[part];
      if (known) return known;
      if (part.length === 1) return part.toUpperCase();
      return part[0].toUpperCase() + part.slice(1);
    })
    .join(" ");
}

/** Map of binding -> action id, first writer wins. */
export function bindingMapOf(bindings: Record<string, Binding[]>): Map<Binding, string> {
  const map = new Map<Binding, string>();
  for (const [action, list] of Object.entries(bindings)) {
    for (const binding of list) if (!map.has(binding)) map.set(binding, action);
  }
  return map;
}

/** Which action already owns this binding inside a profile (if any). */
export function conflictFor(
  bindings: Record<string, Binding[]>,
  binding: Binding,
  ignore?: string,
): string | null {
  for (const [action, list] of Object.entries(bindings)) {
    if (action !== ignore && list.includes(binding)) return action;
  }
  return null;
}

// ----------------------------------------------------------------------- store

interface ProfileState {
  profiles: KeybindProfile[];
  activeId: string;
  active: () => KeybindProfile;
  setActive: (id: string) => void;
  create: () => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  reset: (id: string) => void;
  setBinding: (id: string, action: string, binding: Binding, replacing?: Binding) => void;
  clearBinding: (id: string, action: string, binding: Binding) => void;
}

const STORE_KEY = "arc.keybinds.v1";

function makeBuiltin(): KeybindProfile {
  return {
    id: "classic",
    name: "Classic",
    builtin: true,
    bindings: DEFAULT_BINDINGS,
  };
}

function loadPersisted(): { profiles: KeybindProfile[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { profiles?: KeybindProfile[]; activeId?: string };
      const profiles = [makeBuiltin(), ...(Array.isArray(data.profiles) ? data.profiles : [])].filter(
        (p, index, all) =>
          p &&
          typeof p.id === "string" &&
          typeof p.name === "string" &&
          p.bindings &&
          (p.builtin === true) === (p.id === "classic") &&
          all.findIndex((x) => x.id === p.id) === index,
      );
      const activeId = profiles.some((p) => p.id === data.activeId)
        ? (data.activeId as string)
        : profiles[0].id;
      return { profiles, activeId };
    }
  } catch {
    // ignore corrupt state
  }
  return { profiles: [makeBuiltin()], activeId: "classic" };
}

function newProfileId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `profile-${uuid}`;
}

function withProfile(
  state: ProfileState,
  id: string,
  edit: (profile: KeybindProfile) => KeybindProfile,
): KeybindProfile[] {
  return state.profiles.map((p) => (p.id === id && !p.builtin ? edit(p) : p));
}

const initial = loadPersisted();

export const useKeybindStore = create<ProfileState>((set, get) => ({
  profiles: initial.profiles,
  activeId: initial.activeId,
  active: () => get().profiles.find((p) => p.id === get().activeId) ?? get().profiles[0],
  setActive: (activeId) => set({ activeId }),
  create: () =>
    set((st) => {
      const source = st.profiles.find((p) => p.id === st.activeId) ?? makeBuiltin();
      const n = st.profiles.filter((p) => !p.builtin).length + 1;
      const profile: KeybindProfile = {
        id: newProfileId(),
        name: `Profile ${n}`,
        builtin: false,
        bindings: Object.fromEntries(
          Object.entries(source.bindings).map(([action, list]) => [action, [...list]]),
        ),
      };
      return { profiles: [...st.profiles, profile], activeId: profile.id };
    }),
  rename: (id, name) => set((st) => ({ profiles: withProfile(st, id, (p) => ({ ...p, name: name.trim() || p.name })) })),
  remove: (id) =>
    set((st) => {
      if (id === "classic") return st;
      const profiles = st.profiles.filter((p) => p.id !== id);
      return {
        profiles,
        activeId: st.activeId === id ? "classic" : st.activeId,
      };
    }),
  reset: (id) =>
    set((st) => ({
      profiles: withProfile(st, id, (p) => ({
        ...p,
        bindings: Object.fromEntries(
          Object.entries(DEFAULT_BINDINGS).map(([action, list]) => [action, [...list]]),
        ),
      })),
    })),
  setBinding: (id, action, binding, replacing) =>
    set((st) => ({
      profiles: withProfile(st, id, (p) => {
        const bindings = Object.fromEntries(
          Object.entries(p.bindings).map(([key, list]) => [key, list.filter((b) => b !== binding)]),
        );
        if (!bindings[action]) bindings[action] = [];
        const list = bindings[action].filter((b) => b !== replacing);
        if (replacing) {
          const at = bindings[action].indexOf(replacing);
          list.splice(at === -1 ? list.length : at, 0, binding);
        } else {
          list.push(binding);
        }
        bindings[action] = list.filter((b) => b.length > 0);
        if (bindings[action].length === 0) delete bindings[action];
        return { ...p, bindings };
      }),
    })),
  clearBinding: (id, action, binding) =>
    set((st) => ({
      profiles: withProfile(st, id, (p) => {
        const list = (p.bindings[action] ?? []).filter((b) => b !== binding);
        const bindings = { ...p.bindings };
        if (list.length > 0) bindings[action] = list;
        else delete bindings[action];
        return { ...p, bindings };
      }),
    })),
}));

useKeybindStore.subscribe((state) => {
  const data = JSON.stringify({
    profiles: state.profiles.filter((p) => !p.builtin),
    activeId: state.activeId,
  });
  try {
    localStorage.setItem(STORE_KEY, data);
  } catch {
    // ignore storage failures
  }
});

export function getActiveProfile(): KeybindProfile {
  const st = useKeybindStore.getState();
  return st.profiles.find((p) => p.id === st.activeId) ?? st.profiles[0];
}
