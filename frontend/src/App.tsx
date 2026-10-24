import { useEffect, useRef, useState } from "react";
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
  const [leftWidth, setLeftWidth] = useState(280);
  const isResizingRef = useRef(false);

  const startResizing = (e: React.PointerEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    const startX = e.clientX;
    const startW = leftWidth;

    const onMove = (ev: PointerEvent) => {
      if (!isResizingRef.current) return;
      const nextW = Math.max(220, Math.min(650, startW + (ev.clientX - startX)));
      setLeftWidth(nextW);
    };

    const onUp = () => {
      isResizingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

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
          {/* Shapr3D Left "Items" Sidebar (collapsible via Items button in ToolRail, View menu, or panel header) */}
          {leftSidebarOpen && (
            <aside
              style={{ width: `${leftWidth}px` }}
              className="relative anim-slide-right flex shrink-0 flex-col border-r border-base-200 bg-base-50"
            >
              <div className="min-h-0 flex-1 overflow-hidden">
                <ProjectPanel />
              </div>
              {/* Draggable right-edge resizer */}
              <div
                onPointerDown={startResizing}
                title="Drag to resize sidebar"
                className="group absolute -right-1.5 top-0 bottom-0 z-20 w-3 cursor-col-resize flex items-center justify-center hover:bg-accent-500/20 active:bg-accent-500/40"
              >
                <div className="h-8 w-0.5 rounded-full bg-base-300 transition-colors group-hover:bg-accent-500" />
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
