import { create } from "zustand";

// --------------------------------------------------------------------------
// Themes. A theme is a flat set of hex colors: the Tailwind scale used by the
// UI plus three viewport colors. Built-ins ship in code; custom themes are
// stored in localStorage and can be imported/exported as simple JSON files:

//   { "name": "My theme", "colors": { "base-100": "#131313", ... } }

// A flat file without the wrapper works too, and a few shorthand aliases
// ("accent", "background", "grid", "grid-line") are accepted. Missing keys
// fall back to the default theme.
// --------------------------------------------------------------------------

export const THEME_COLOR_KEYS = [
  "base-50",
  "base-100",
  "base-150",
  "base-200",
  "base-300",
  "base-400",
  "base-500",
  "base-600",
  "base-700",
  "base-800",
  "accent-500",
  "accent-600",
  "accent-700",
  "viewport-bg",
  "viewport-grid",
  "viewport-grid-line",
] as const;

export type ThemeColorKey = (typeof THEME_COLOR_KEYS)[number];
export type ThemeColors = Record<ThemeColorKey, string>;

export interface Theme {
  id: string;
  name: string;
  builtin: boolean;
  colors: ThemeColors;
}

const CS_VARS: Record<ThemeColorKey, string> = {
  "base-50": "--color-base-50",
  "base-100": "--color-base-100",
  "base-150": "--color-base-150",
  "base-200": "--color-base-200",
  "base-300": "--color-base-300",
  "base-400": "--color-base-400",
  "base-500": "--color-base-500",
  "base-600": "--color-base-600",
  "base-700": "--color-base-700",
  "base-800": "--color-base-800",
  "accent-500": "--color-accent-500",
  "accent-600": "--color-accent-600",
  "accent-700": "--color-accent-700",
  "viewport-bg": "--color-viewport-bg",
  "viewport-grid": "--color-viewport-grid",
  "viewport-grid-line": "--color-viewport-grid-line",
};

const GRAPHITE: ThemeColors = {
  "base-50": "#0a0a0a",
  "base-100": "#131313",
  "base-150": "#181818",
  "base-200": "#1e1e1e",
  "base-300": "#282828",
  "base-400": "#383838",
  "base-500": "#555555",
  "base-600": "#868686",
  "base-700": "#b7b7b7",
  "base-800": "#e8e8e8",
  "accent-500": "#21b3ed",
  "accent-600": "#00a0dd",
  "accent-700": "#0086be",
  "viewport-bg": "#0c0c0e",
  "viewport-grid": "#302f38",
  "viewport-grid-line": "#222229",
};

export const BUILTIN_THEMES: Theme[] = [
  { id: "graphite", name: "Graphite", builtin: true, colors: GRAPHITE },
  {
    id: "midnight",
    name: "Midnight",
    builtin: true,
    colors: {
      "base-50": "#070b14",
      "base-100": "#0b101d",
      "base-150": "#0f1626",
      "base-200": "#131c31",
      "base-300": "#1a2542",
      "base-400": "#26345a",
      "base-500": "#3e5284",
      "base-600": "#6d84b8",
      "base-700": "#a3b6d8",
      "base-800": "#dde5f2",
      "accent-500": "#4d9fff",
      "accent-600": "#2f7ef2",
      "accent-700": "#245fc4",
      "viewport-bg": "#060a12",
      "viewport-grid": "#1c2545",
      "viewport-grid-line": "#121930",
    },
  },
  {
    id: "forest",
    name: "Forest",
    builtin: true,
    colors: {
      "base-50": "#070b08",
      "base-100": "#0c120e",
      "base-150": "#111813",
      "base-200": "#161e18",
      "base-300": "#1f2b23",
      "base-400": "#2c3e32",
      "base-500": "#3f5a47",
      "base-600": "#6f9180",
      "base-700": "#a7c2b2",
      "base-800": "#dce8e0",
      "accent-500": "#4ccf7f",
      "accent-600": "#2fb464",
      "accent-700": "#26914f",
      "viewport-bg": "#080d0a",
      "viewport-grid": "#1e2a22",
      "viewport-grid-line": "#14201a",
    },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    builtin: true,
    colors: {
      "base-50": "#f5f7fb",
      "base-100": "#eaeef6",
      "base-150": "#e0e7f0",
      "base-200": "#d2dcea",
      "base-300": "#b9c8de",
      "base-400": "#8ea3c4",
      "base-500": "#5f7799",
      "base-600": "#3d516e",
      "base-700": "#24334b",
      "base-800": "#0f1826",
      "accent-500": "#3577f6",
      "accent-600": "#1f5fe0",
      "accent-700": "#1a4bba",
      "viewport-bg": "#f0f4fa",
      "viewport-grid": "#cbd5e7",
      "viewport-grid-line": "#dde5f0",
    },
  },
  {
    id: "paper",
    name: "Paper",
    builtin: true,
    colors: {
      "base-50": "#f7f5ef",
      "base-100": "#efece2",
      "base-150": "#e6e2d4",
      "base-200": "#dbd6c5",
      "base-300": "#c8c2af",
      "base-400": "#a09a87",
      "base-500": "#787264",
      "base-600": "#514c41",
      "base-700": "#2f2c24",
      "base-800": "#15130d",
      "accent-500": "#d97a2b",
      "accent-600": "#c06317",
      "accent-700": "#9c4f10",
      "viewport-bg": "#f2efe7",
      "viewport-grid": "#d8d2c0",
      "viewport-grid-line": "#e3ded0",
    },
  },
];

export const DEFAULT_THEME = BUILTIN_THEMES[0];

// -------------------------------------------------------------------- parsing

/** Normalize any CSS color ("#abc", "#aabbccdd", "rgb(...)") to #rrggbb[aa]. */
export function normalizeColor(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#123456";
  ctx.fillStyle = value;
  const parsed = ctx.fillStyle;
  if (typeof parsed !== "string" || parsed === "#123456") return null;
  const rgba = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(parsed);
  if (rgba) {
    const hex = rgba
      .slice(1, 4)
      .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
      .join("");
    const alpha = rgba[4] !== undefined ? Number(rgba[4]) : 1;
    return alpha < 0.999 ? `${hex}${Math.round(alpha * 255).toString(16).padStart(2, "0")}` : `#${hex}`;
  }
  return parsed.toLowerCase();
}

const ALIASES: Record<string, ThemeColorKey> = {
  accent: "accent-600",
  background: "viewport-bg",
  bg: "viewport-bg",
  viewport: "viewport-bg",
  canvas: "viewport-bg",
  grid: "viewport-grid",
  "grid-line": "viewport-grid-line",
  gridline: "viewport-grid-line",
  theme: "viewport-bg",
};

export interface ParseResult {
  theme?: Theme;
  error?: string;
}

/** Parse an imported theme from raw file text. */
export function parseThemeFile(text: string, fallbackName: string, id: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `Not valid JSON: ${String(error).split("\n")[0]}` };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { error: "Expected a JSON object with color values." };
  }
  const raw = data as Record<string, unknown>;
  const source = (typeof raw.colors === "object" && raw.colors !== null ? raw.colors : raw) as Record<
    string,
    unknown
  >;
  const colors = { ...DEFAULT_THEME.colors };
  const provided: [ThemeColorKey, string][] = [];

  for (const [key, value] of Object.entries(source)) {
    if (key === "name" || typeof value !== "string") continue;
    const target = (THEME_COLOR_KEYS as readonly string[]).includes(key)
      ? (key as ThemeColorKey)
      : ALIASES[key.toLowerCase()];
    if (!target) continue; // unknown keys are ignored
    const hex = normalizeColor(value);
    if (!hex) return { error: `"${key}" is not a valid color: ${value}` };
    provided.push([target, hex]);
  }
  if (provided.length === 0) {
    return { error: "No recognized color values found." };
  }
  for (const [key, hex] of provided) colors[key] = hex;

  const nameInput = typeof raw.name === "string" ? raw.name.trim() : "";
  const name = nameInput || fallbackName.replace(/\.[^.]+$/, "").trim() || "Imported theme";
  return { theme: { id, name, builtin: false, colors } };
}

export function exportThemeJson(theme: Theme): string {
  return JSON.stringify({ name: theme.name, colors: theme.colors }, null, 2);
}

// --------------------------------------------------------------- css handling

let styleEl: HTMLStyleElement | null = null;

export function applyThemeCss(theme: Theme): void {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "arc-theme-overrides";
    document.head.appendChild(styleEl);
  }
  const rule = THEME_COLOR_KEYS.map((key) => `${CS_VARS[key]}: ${theme.colors[key]};`).join(" ");
  styleEl.textContent = `:root{${rule}}`;
}

export function isLightColor(hex: string): boolean {
  const c = normalizeColor(hex);
  if (!c) return false;
  const r = parseInt(c.slice(1, 3), 16) / 255;
  const g = parseInt(c.slice(3, 5), 16) / 255;
  const b = parseInt(c.slice(5, 7), 16) / 255;
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b) > 0.5;
}

// ---------------------------------------------------------------------- store

interface ThemeState {
  custom: Theme[];
  activeId: string;
  active: () => Theme;
  setActive: (id: string) => void;
  addCustom: (theme: Theme) => void;
  updateCustom: (theme: Theme) => void;
  removeCustom: (id: string) => void;
}

const STORE_KEY = "arc.themes.v1";

function loadPersisted(): { custom: Theme[]; activeId: string } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as { custom?: Theme[]; activeId?: string };
      const custom = (Array.isArray(data.custom) ? data.custom : []).filter(
        (t) => t && typeof t.name === "string" && t.colors,
      );
      return { custom, activeId: typeof data.activeId === "string" ? data.activeId : DEFAULT_THEME.id };
    }
  } catch {
    // ignore corrupt state
  }
  return { custom: [], activeId: DEFAULT_THEME.id };
}

export function themeById(id: string, custom: Theme[]): Theme {
  return (
    BUILTIN_THEMES.find((t) => t.id === id) ??
    custom.find((t) => t.id === id) ??
    DEFAULT_THEME
  );
}

const initial = loadPersisted();

export const useThemeStore = create<ThemeState>((set, get) => ({
  custom: initial.custom,
  activeId: initial.activeId,
  active: () => themeById(get().activeId, get().custom),
  setActive: (activeId) => set({ activeId }),
  addCustom: (theme) =>
    set((st) => ({ custom: [...st.custom, theme], activeId: theme.id })),
  updateCustom: (theme) =>
    set((st) => ({ custom: st.custom.map((t) => (t.id === theme.id ? theme : t)) })),
  removeCustom: (id) =>
    set((st) => ({
      custom: st.custom.filter((t) => t.id !== id),
      activeId: st.activeId === id ? DEFAULT_THEME.id : st.activeId,
    })),
}));

// Re-imported custom themes with the same file name get a fresh id; keep ids
// unique for localStorage bookkeeping.
export function nextCustomThemeId(): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `custom-${uuid}`;
}

// Persist and apply on every change.
useThemeStore.subscribe((state) => {
  applyThemeCss(themeById(state.activeId, state.custom));
  try {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({ custom: state.custom, activeId: state.activeId }),
    );
  } catch {
    // storage may be unavailable; theme still applies for the session
  }
});

applyThemeCss(themeById(initial.activeId, initial.custom));

// --------------------------------------------------------- viewport shortcuts

export interface ViewportPalette {
  bg: string;
  grid: string;
  gridLine: string;
  accent500: string;
  accent600: string;
  lightViewport: boolean;
}

export function viewportPalette(theme: Theme): ViewportPalette {
  return {
    bg: theme.colors["viewport-bg"],
    grid: theme.colors["viewport-grid"],
    gridLine: theme.colors["viewport-grid-line"],
    accent500: theme.colors["accent-500"],
    accent600: theme.colors["accent-600"],
    lightViewport: isLightColor(theme.colors["viewport-bg"]),
  };
}
