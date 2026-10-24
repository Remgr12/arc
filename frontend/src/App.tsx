import { useEffect } from "react";
import { initEvents } from "./lib/events";
import { installKeybinds } from "./lib/keybinds";
import { Viewport } from "./components/Viewport";
import { TopBar } from "./components/TopBar";
import { StatusBar } from "./components/StatusBar";
import { ToolRail } from "./components/ToolRail";
import { ProjectPanel } from "./components/ProjectPanel";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { CommandPalette } from "./components/CommandPalette";
import { SettingsDialog } from "./components/SettingsDialog";
import { UpdateDialog } from "./components/UpdateDialog";
import { StartupScreen } from "./components/StartupScreen";
import { Onboarding } from "./components/Onboarding";
import { actions } from "./lib/actions";
import { decideStartupFlow } from "./lib/workspace";
import { useArcStore } from "./lib/store";

import { useMaterialsPanelMount } from "./components/MaterialsPanel";
import { CommandLine } from "./components/CommandLine";

import { ContextDock } from "./components/ContextDock";
import { ModeBanner } from "./components/ModeBanner";
import { SelectionHud } from "./components/SelectionHud";
import { UtilityRail } from "./components/UtilityRail";
import { ContextMenu } from "./components/ContextMenu";
import { Dashboard } from "./components/Dashboard";

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

  const view = useArcStore((s) => s.view);

  return (
    <div className="flex h-full w-full flex-col bg-base-50 text-base-800">
      {view === "editor" && <TopBar />}
      <div className="relative flex min-h-0 flex-1">
        {/* Keep the WebGL viewport mounted at all times; cover with dashboard when in home view. */}
        <div
          className={
            "flex min-h-0 min-w-0 flex-1 " +
            (view === "dashboard" ? "invisible pointer-events-none" : "")
          }
        >
          <ToolRail />
          <div className="relative min-w-0 flex-1">
            <Viewport />
            <ContextDock />
            <ModeBanner />
            <SelectionHud />
            {/* Positioned below the top-right 3D ViewCube (112px + 14px margin) */}
            <div className="pointer-events-none absolute right-3 top-[140px] z-30">
              <div className="pointer-events-auto rounded-2xl border border-base-200 bg-base-50/95 p-1.5 shadow-lg shadow-black/20 backdrop-blur-md">
                <UtilityRail />
              </div>
            </div>
            <ContextMenu />
          </div>
          <aside className="flex w-[280px] shrink-0 flex-col border-l border-base-200 bg-base-50">
            <div className="min-h-0 flex-1">
              <ProjectPanel />
            </div>
            <div className="h-[320px] shrink-0 border-t border-base-200">
              <PropertiesPanel />
            </div>
          </aside>
        </div>
        {view === "dashboard" && (
          <div className="view-fade-in absolute inset-0 z-20 overflow-hidden bg-base-50">
            <Dashboard />
          </div>
        )}
      </div>
      {view === "editor" && <StatusBar />}
      <CommandLine />
      <CommandPalette />
      <SettingsDialog />
      <UpdateDialog />
      <StartupScreen />
      <Onboarding />
      {materialsMount}
    </div>
  );
}
