import { useRef } from "react";
import { Check, Download, FolderInput, Plus, Trash2 } from "lucide-react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  BUILTIN_THEMES,
  DEFAULT_THEME,
  type Theme,
  exportThemeJson,
  nextCustomThemeId,
  parseThemeFile,
  useThemeStore,
} from "../lib/themes";
import { useArcStore } from "../lib/store";
import { Button, SelectField } from "./ui";
import { useWindowControlsStyle, detectPlatform, type WindowControlsStyle } from "../lib/platform";

/** Appearance section of the settings dialog: pick, import, export themes. */
export function ThemeSettings() {
  const custom = useThemeStore((s) => s.custom);
  const activeId = useThemeStore((s) => s.activeId);
  const setActive = useThemeStore((s) => s.setActive);
  const addCustom = useThemeStore((s) => s.addCustom);
  const removeCustom = useThemeStore((s) => s.removeCustom);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const { preference, setPreference } = useWindowControlsStyle();
  const detected = detectPlatform();

  const status = (msg: string) => useArcStore.getState().setStatusMessage(msg);

  const activeTheme = () =>
    [...BUILTIN_THEMES, ...custom].find((t) => t.id === activeId) ?? DEFAULT_THEME;

  const importFiles = async (files: FileList | null) => {
    if (!files) return;
    for (const file of files) {
      try {
        const text = await file.text();
        const { theme, error } = parseThemeFile(text, file.name, nextCustomThemeId());
        if (!theme) {
          status(error ?? "Could not read theme file");
          continue;
        }
        addCustom(theme);
        status(`Theme "${theme.name}" imported and applied`);
      } catch (error) {
        status(`Import failed: ${String(error)}`);
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportActive = async () => {
    const theme = activeTheme();
    const content = exportThemeJson(theme);
    try {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const path = await save({
        title: "Export theme",
        filters: [{ name: "arc theme", extensions: ["theme", "json"] }],
        defaultPath: `${theme.name}.theme.json`,
      });
      if (!path) return;
      await writeTextFile(path as string, content);
      status(`Theme exported to ${(path as string).split(/[/\\]/).pop()}`);
    } catch (error) {
      status(`Export failed: ${String(error)}`);
    }
  };

  const duplicateActive = () => {
    const theme = activeTheme();
    addCustom({ ...theme, id: nextCustomThemeId(), name: `${theme.name} copy`, builtin: false });
    status(`Custom theme created from ${theme.name}`);
  };

  const themes: Theme[] = [...BUILTIN_THEMES, ...custom];

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-base-500">
        Themes restyle the whole interface and the viewport. Import a theme from a simple JSON file
        with color values like{" "}
        <code className="rounded bg-base-200 px-1 font-mono text-[10px]">
          {"{ \"accent-600\": \"#4d9fff\" }"}
        </code>
        .
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,.theme,.arc-theme,application/json"
        multiple
        className="hidden"
        onChange={(e) => void importFiles(e.target.files)}
      />

      <div className="grid grid-cols-2 gap-2">
        {themes.map((theme) => {
          const active = theme.id === activeId;
          const colors = theme.colors;
          return (
            <div key={theme.id} className="relative">
              <button
                onClick={() => setActive(theme.id)}
                className={`group flex w-full flex-col overflow-hidden rounded-md border text-left transition-colors ${
                  active
                    ? "border-accent-600 ring-1 ring-accent-600/60"
                    : "border-base-300 hover:border-base-400"
                }`}
              >
                <div className="flex h-8 items-center gap-1 px-2" style={{ background: colors["viewport-bg"] }}>
                  {[colors["accent-600"], colors["base-500"], colors["base-300"], colors["base-100"]].map(
                    (c, i) => (
                      <span key={i} className="h-4 w-4 rounded-sm border border-black/20" style={{ background: c }} />
                    ),
                  )}
                  <span className="ml-auto text-[10px]" style={{ color: colors["base-500"] }}>
                    {theme.builtin ? "built-in" : "custom"}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-base-100 px-2 py-1.5">
                  <span className="text-[12.5px] text-base-800">{theme.name}</span>
                  {active && <Check size={12} className="text-accent-500" />}
                </div>
              </button>
              {!theme.builtin && (
                <button
                  title={`Delete ${theme.name}`}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-base-100/80 text-base-600 backdrop-blur transition-colors hover:text-base-800"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeCustom(theme.id);
                  }}
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-2 border-t border-base-300 pt-2">
        <Button onClick={() => fileRef.current?.click()}>
          <FolderInput size={13} /> Import theme
        </Button>
        <Button onClick={() => void exportActive()}>
          <Download size={13} /> Export
        </Button>
        <Button onClick={duplicateActive} title="Create an editable copy of the current theme">
          <Plus size={13} /> New from current
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-base-300 pt-3">
        <div className="text-[12px] font-medium text-base-800">Window Controls Style</div>
        <div className="text-[11px] text-base-500">
          Integrated minimize, maximize, and close buttons in the upper toolbar.
        </div>
        <div className="w-80 pt-1">
          <SelectField
            value={preference}
            options={[
              { value: "auto", label: `Auto (System default: ${detected})` },
              { value: "windows", label: "Windows (Minimize, Maximize, Close on right)" },
              { value: "macos", label: "macOS (Traffic lights on left)" },
              { value: "linux", label: "Linux (Clean rounded buttons on right)" },
            ]}
            onChange={(val) => setPreference(val as WindowControlsStyle)}
          />
        </div>
      </div>
    </div>
  );
}
