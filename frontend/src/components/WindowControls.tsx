import { useEffect, useState } from "react";
import { Minus, Square, Copy, X, Maximize2 } from "lucide-react";
import type { Platform } from "../lib/platform";
import { cn } from "./ui";

interface WindowControlsProps {
  variant?: Platform;
  className?: string;
}

const isTauri =
  typeof window !== "undefined" &&
  Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

export function WindowControls({ variant = "windows", className }: WindowControlsProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFocused, setIsFocused] = useState(true);

  useEffect(() => {
    if (!isTauri) return;
    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    void (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const appWindow = getCurrentWindow();
        const max = await appWindow.isMaximized();
        setIsMaximized(max);

        unlistenResize = await appWindow.onResized(async () => {
          try {
            const nextMax = await appWindow.isMaximized();
            setIsMaximized(nextMax);
          } catch {
            // ignore
          }
        });

        unlistenFocus = await appWindow.onFocusChanged((event) => {
          setIsFocused(event.payload);
        });
      } catch {
        // ignore in preview/unsupported environments
      }
    })();

    return () => {
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, []);

  const handleMinimize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().minimize();
    } catch (err) {
      console.warn("Failed to minimize window:", err);
    }
  };

  const handleToggleMaximize = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isTauri) {
      setIsMaximized((prev) => !prev);
      return;
    }
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const appWindow = getCurrentWindow();
      await appWindow.toggleMaximize();
      const next = await appWindow.isMaximized();
      setIsMaximized(next);
    } catch (err) {
      console.warn("Failed to toggle maximize:", err);
    }
  };

  const handleClose = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isTauri) return;
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (err) {
      console.warn("Failed to close window:", err);
    }
  };

  if (variant === "macos") {
    return (
      <div
        className={cn(
          "group flex h-full items-center gap-2 pl-3 pr-2.5 select-none",
          !isFocused && "opacity-60",
          className,
        )}
      >
        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          title="Close"
          className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#ff5f56] border border-[#e0443e] cursor-pointer focus:outline-none transition-transform active:scale-95"
        >
          <X
            size={8}
            strokeWidth={2.5}
            className="stroke-[#4d0000] opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </button>

        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          title="Minimize"
          className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#ffbd2e] border border-[#dea123] cursor-pointer focus:outline-none transition-transform active:scale-95"
        >
          <Minus
            size={8}
            strokeWidth={2.5}
            className="stroke-[#995700] opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </button>

        {/* Maximize / Zoom */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          title={isMaximized ? "Restore" : "Zoom"}
          className="relative flex h-3 w-3 items-center justify-center rounded-full bg-[#27c93f] border border-[#1aab29] cursor-pointer focus:outline-none transition-transform active:scale-95"
        >
          <Maximize2
            size={7}
            strokeWidth={2.5}
            className="stroke-[#006500] opacity-0 group-hover:opacity-100 transition-opacity"
          />
        </button>
      </div>
    );
  }

  if (variant === "linux") {
    return (
      <div className={cn("flex h-full items-center gap-1 px-1.5 select-none", className)}>
        {/* Minimize */}
        <button
          type="button"
          onClick={handleMinimize}
          title="Minimize"
          className="flex h-7 w-8 items-center justify-center rounded text-base-500 hover:bg-base-200 hover:text-base-800 transition-colors focus:outline-none cursor-pointer"
        >
          <Minus size={14} strokeWidth={1.8} />
        </button>

        {/* Maximize / Restore */}
        <button
          type="button"
          onClick={handleToggleMaximize}
          title={isMaximized ? "Restore" : "Maximize"}
          className="flex h-7 w-8 items-center justify-center rounded text-base-500 hover:bg-base-200 hover:text-base-800 transition-colors focus:outline-none cursor-pointer"
        >
          {isMaximized ? (
            <Copy size={13} strokeWidth={1.8} />
          ) : (
            <Square size={13} strokeWidth={1.8} />
          )}
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={handleClose}
          title="Close"
          className="flex h-7 w-8 items-center justify-center rounded text-base-500 hover:bg-[#e81123] hover:text-white active:bg-[#c4101f] transition-colors focus:outline-none cursor-pointer"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  }

  // Windows style (default)
  return (
    <div className={cn("flex h-full items-center select-none", className)}>
      {/* Minimize */}
      <button
        type="button"
        onClick={handleMinimize}
        title="Minimize"
        className="flex h-full w-11 items-center justify-center text-base-500 hover:bg-base-200/80 active:bg-base-300 hover:text-base-800 transition-colors focus:outline-none cursor-pointer"
      >
        <Minus size={14} strokeWidth={1.8} />
      </button>

      {/* Maximize / Restore */}
      <button
        type="button"
        onClick={handleToggleMaximize}
        title={isMaximized ? "Restore" : "Maximize"}
        className="flex h-full w-11 items-center justify-center text-base-500 hover:bg-base-200/80 active:bg-base-300 hover:text-base-800 transition-colors focus:outline-none cursor-pointer"
      >
        {isMaximized ? (
          <Copy size={13} strokeWidth={1.8} />
        ) : (
          <Square size={13} strokeWidth={1.8} />
        )}
      </button>

      {/* Close */}
      <button
        type="button"
        onClick={handleClose}
        title="Close"
        className="flex h-full w-11 items-center justify-center text-base-500 hover:bg-[#e81123] hover:text-white active:bg-[#c4101f] transition-colors focus:outline-none cursor-pointer"
      >
        <X size={15} strokeWidth={1.8} />
      </button>
    </div>
  );
}
