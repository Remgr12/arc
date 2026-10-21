import { useEffect } from "react";
import { initEvents } from "./lib/events";
import { installKeybinds } from "./lib/keybinds";
import { Viewport } from "./components/Viewport";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { ToolRail } from "./components/ToolRail";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { StartupScreen } from "./components/StartupScreen";
import { Onboarding } from "./components/Onboarding";
import { Dock } from "./components/Dock";
import { actions } from "./lib/actions";
import { decideStartupFlow } from "./lib/workspace";
import { useArcStore } from "./lib/store";

import { useMaterialsPanelMount } from "./components/MaterialsPanel";
import { CommandLine } from "./components/CommandLine";

export default function App() {
  const materialsMount = useMaterialsPanelMount();
  useEffect(() => {
    let cancelled = false;
    let unlistenEvents: (() => void) | null = null;
    void initEvents()
      .then((unlisten) => {
        if (cancelled) {
          void unlisten();
          return null;
        }
        unlistenEvents = unlisten;
        return actions.refresh();
      })
      .then(() => {
        if (cancelled) return;
        try {
          decideStartupFlow();
        } catch (bootError) {
          useArcStore
            .getState()
            .setStatusMessage(`Startup failed: ${String(bootError)}`);
        }
      })
      .catch((error) => {
        useArcStore.getState().setStatusMessage(`Init failed: ${String(error)}`);
      });
    const unlistenKeys = installKeybinds();
    return () => {
      cancelled = true;
      unlistenKeys();
      unlistenEvents?.();
    };
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-base-50 text-base-800">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <ToolRail />
        <div className="relative min-w-0 flex-1">
          <Viewport />
        </div>
        <div className="flex w-[260px] shrink-0 flex-col border-l border-base-200 bg-base-100">
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex h-full flex-col p-3">
              <h3 className="mb-3 text-[12px] font-semibold text-base-800">Tools</h3>
              <ToolsList />
            </div>
          </div>
          <div className="h-px bg-base-200" />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="flex h-full flex-col p-3">
              <h3 className="mb-3 text-[12px] font-semibold text-base-800">Entities</h3>
              <div className="flex flex-col gap-1">
                <div className="text-[12px] text-base-500">Entities list placeholder</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <StatusBar />
      <CommandLine />
      <CommandPalette />
      <SettingsDialog />
      <UpdateDialog />
      <StartupScreen />
      <Onboarding />
      {materialsMount}
      <Dock />
    </div>
  );
}

function ToolsList() {
  const scene = useArcStore((s) => s.scene);
  const setTool = useArcStore((s) => s.setTool);
  
  if (!scene) return null;
  
  return (
    <div className="flex flex-wrap gap-2">
      {[
        { id: "select", label: "Select", icon: "MousePointer2", category: "select" },
        { id: "move", label: "Move", icon: "Move3d", category: "select" },
        { id: "line", label: "Line", icon: "Minus", category: "sketch" },
        { id: "rectangle", label: "Rectangle", icon: "RectangleHorizontal", category: "sketch" },
        { id: "circle", label: "Circle", icon: "Circle", category: "sketch" },
        { id: "extrude", label: "Extrude", icon: "ArrowUpFromLine", category: "solid" },
        { id: "box", label: "Box", icon: "Box", category: "primitives" },
        { id: "sphere", label: "Sphere", icon: "Globe", category: "primitives" },
      ].map((tool) => {
        const isActive = useArcStore((s) => s.tool) === tool.id;
        const isSelected = useArcStore((s) => s.scene?.selection.includes(tool.id) || false);
        let className = "flex h-9 w-9 items-center justify-center rounded-lg border transition-all";
        if (isActive) {
          className += " border-accent-500 bg-accent-500/10 text-accent-600";
        } else if (isSelected) {
          className += " border-base-300 bg-base-50 text-base-700";
        } else {
          className += " border-base-200 bg-base-50 text-base-600 hover:border-base-300 hover:bg-base-100";
        }
        
        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => setTool(tool.id as any)}
            className={className}
            title={tool.label}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 9h6v6H9z" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        );
      })}
    </div>
  );
}
