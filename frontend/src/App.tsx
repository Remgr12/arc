import { useEffect, useRef } from "react";
import { initEvents } from "./lib/events";
import { installKeybinds } from "./lib/keybinds";
import { Viewport } from "./components/Viewport";
import { TopBar, StatusBar } from "./components/TopBar";
import { ToolPalette } from "./components/ToolPalette";
import { ProjectPanel } from "./components/ProjectPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { actions } from "./lib/actions";
import { useArcStore } from "./lib/store";

export default function App() {
  const okRef = useRef(false);

  useEffect(() => {
    if (okRef.current) return;
    okRef.current = true;
    let unlistenEvents: (() => void) | null = null;
    void initEvents()
      .then((unlisten) => {
        unlistenEvents = unlisten;
        void actions.refresh();
      })
      .catch((error) => {
        useArcStore.getState().setStatusMessage(`Init failed: ${String(error)}`);
      });
    const unlistenKeys = installKeybinds();
    return () => {
      unlistenKeys();
      unlistenEvents?.();
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-base-50 text-base-800">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolPalette />
        <div className="relative min-w-0 flex-1">
          <Viewport />
          <ToolHint />
        </div>
        <aside className="flex w-72 shrink-0 flex-col border-l border-base-300 bg-base-100">
          <div className="min-h-0 flex-1 overflow-hidden">
            <ProjectPanel />
          </div>
          <div className="h-[300px] shrink-0 border-t border-base-300">
            <PropertiesPanel />
          </div>
        </aside>
      </div>
      <StatusBar />
      <CommandPalette />
      <SettingsDialog />
    </div>
  );
}

function ToolHint() {
  const tool = useArcStore((s) => s.tool);
  const hints: Record<string, string> = {
    select: "Click to select · Shift-click multi · drag empty space does nothing · right-drag pans, middle-drag orbits, wheel zooms",
    move: "Click an entity and drag on the ground plane · snap follows settings",
    line: "Click two points · finish with double-click or Escape",
    polyline: "Click points · finish with double-click",
    dimension: "Click start…end to place a dimension line",
    wall: "Click points along the path · finish with double-click",
  };
  const hint = hints[tool] ?? "Click in the viewport to place · right-drag pans · middle-drag orbits";
  return (
    <div className="pointer-events-none absolute top-3 left-1/2 w-[70%] -translate-x-1/2 truncate rounded-full bg-base-50/85 px-4 py-1 text-center text-[11px] text-base-700 shadow-sm backdrop-blur-sm">
      {hint}
    </div>
  );
}
