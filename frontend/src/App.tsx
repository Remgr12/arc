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
import { StatusPill } from "./components/StatusPill";
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
  const dashboardTransition = useArcStore((s) => s.dashboardTransition);

  return (
    <div className="flex h-full w-full flex-col bg-base-50 text-base-800">
      <TopBar />
      <div
        className={
          "flex min-h-0 flex-1 transition-transform duration-300 ease-in-out " +
          (dashboardTransition ? "-translate-x-full" : "translate-x-0")
        }
      >
        {view === "editor" ? (
          // Editor view
          <>
            <ToolRail />
            <div className="relative min-w-0 flex-1">
              <Viewport />
              <ContextDock />
              <ModeBanner />
              <StatusPill />
              <div className="pointer-events-none absolute right-3 top-1/2 z-40 -translate-y-1/2">
                <div className="pointer-events-auto rounded-2xl border border-base-200 bg-base-50/95 px-1.5 py-1.5 shadow-lg shadow-black/10 backdrop-blur-md">
                  <UtilityRail />
                </div>
              </div>
              <ContextMenu />
            </div>
            <aside className="flex w-[260px] shrink-0 flex-col border-l border-base-200 bg-base-100">
              <div className="min-h-0 flex-1">
                <ProjectPanel />
              </div>
              <div className="h-[300px] shrink-0 border-t border-base-200">
                <PropertiesPanel />
              </div>
            </aside>
          </>
        ) : (
          // Dashboard view - use Dashboard component
          <Dashboard />
        )}
      </div>
      <StatusBar />
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
