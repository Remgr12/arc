import { useEffect } from "react";
import { X } from "lucide-react";
import { initEvents } from "./lib/events";
import { installKeybinds } from "./lib/keybinds";
import { Viewport } from "./components/Viewport";
import { TopBar } from "./components/TopBar";
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
  const leftSidebarOpen = useArcStore((s) => s.leftSidebarOpen);
  const rightSidebarOpen = useArcStore((s) => s.rightSidebarOpen);
  const setRightSidebarOpen = useArcStore((s) => s.setRightSidebarOpen);

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
          {/* Shapr3D Left "Items" Sidebar (collapsible via Items button in ToolRail) */}
          {leftSidebarOpen && (
            <aside className="anim-slide-right flex w-[236px] shrink-0 flex-col border-r border-base-200 bg-base-50">
              <div className="min-h-0 flex-1">
                <ProjectPanel />
              </div>
            </aside>
          )}

          {/* Center 3D Viewport with floating Shapr3D Left Dock & Right Controls */}
          <div className="relative min-w-0 flex-1">
            <Viewport />
            <ToolRail />
            <ModeBanner />
            <SelectionHud />
            <UtilityRail />
            <ContextMenu />
          </div>

          {/* Shapr3D Right "History & Inspector" Sidebar (collapsible via History button) */}
          {rightSidebarOpen && (
            <aside className=" flex w-[268px] shrink-0 flex-col border-l border-base-200 bg-base-50">
              <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-200 px-3">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-base-600">
                  History & Inspector
                </span>
                <button
                  type="button"
                  onClick={() => setRightSidebarOpen(false)}
                  className="flex h-6 w-6 items-center justify-center rounded-md text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
                >
                  <X size={13} strokeWidth={1.8} />
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <PropertiesPanel />
              </div>
            </aside>
          )}
        </div>
        {view === "dashboard" && (
          <div className="view-fade-in absolute inset-0 z-20 overflow-hidden bg-base-50">
            <Dashboard />
          </div>
        )}
      </div>
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
