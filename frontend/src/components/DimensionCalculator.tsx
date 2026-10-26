import { useState, useEffect, useRef } from "react";
import { Calculator, Check, ChevronDown, Ruler, X } from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { cn } from "./ui";
import type { Geometry } from "../lib/types";

export interface SelectedEdgeInfo {
  entityId: string;
  segIndex?: number;
  lengthCm: number;
  p0: [number, number, number];
  p1: [number, number, number];
  screenX: number;
  screenY: number;
  entityKind: string;
}

/** Formats dimension in ONLY metric or ONLY imperial (never both at once). */
export function formatDimension(cm: number, isImperial: boolean): string {
  if (!Number.isFinite(cm) || cm <= 0) return isImperial ? "0\"" : "0 cm";
  if (isImperial) {
    const totalInches = cm / 2.54;
    const feet = Math.floor(totalInches / 12);
    const inches = totalInches - feet * 12;
    if (feet > 0) {
      return inches > 0.05 ? `${feet}' ${inches.toFixed(1)}"` : `${feet}'`;
    }
    return `${totalInches.toFixed(1)}"`;
  }
  if (cm >= 100) {
    return `${(cm / 100).toFixed(2)} m`;
  }
  return `${cm.toFixed(1)} cm`;
}

/** Safely evaluate math expression or imperial string into centimeters. */
export function parseDimensionInput(input: string, isImperial: boolean): number | null {
  const raw = input.trim();
  if (!raw) return null;

  // 1. Check for imperial string like 5' 6" or 12ft 4in
  const feetInchesMatch = raw.match(/^(?:(\d+(?:\.\d+)?)\s*(?:'|ft))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i);
  if (feetInchesMatch && (feetInchesMatch[1] || feetInchesMatch[2])) {
    const feet = Number(feetInchesMatch[1]) || 0;
    const inches = Number(feetInchesMatch[2]) || 0;
    const totalCm = feet * 30.48 + inches * 2.54;
    if (totalCm > 0) return totalCm;
  }

  // 2. Standard math expression evaluation
  const clean = raw.replace(/,/g, ".").replace(/[^0-9+\-*/().]/g, "");
  if (!clean) return null;
  try {
    const val = Function(`"use strict"; return (${clean});`)();
    if (typeof val === "number" && Number.isFinite(val) && val > 0) {
      return isImperial ? val * 2.54 : val;
    }
  } catch {
    // invalid expression
  }
  return null;
}

interface DimensionCalculatorProps {
  info: SelectedEdgeInfo | null;
  onClose?: () => void;
}

export function DimensionCalculator({ info, onClose }: DimensionCalculatorProps) {
  const settings = useArcStore((s) => s.settings);
  const scene = useArcStore((s) => s.scene);
  const overview = useArcStore((s) => s.overview);
  const docId = overview?.active;

  const isImperial =
    settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";

  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState("");
  const [previewVal, setPreviewVal] = useState<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const handleClose = () => {
    setOpen(false);
    onClose?.();
  };

  // Sync initial expression when info changes
  useEffect(() => {
    if (!info) {
      setOpen(false);
      return;
    }
    const displayVal = isImperial ? (info.lengthCm / 2.54).toFixed(1) : info.lengthCm.toFixed(1);
    setExpr(displayVal);
    setPreviewVal(info.lengthCm);
  }, [info, isImperial]);

  // Update live preview when expr changes
  useEffect(() => {
    if (!expr) {
      setPreviewVal(null);
      return;
    }
    const parsedCm = parseDimensionInput(expr, isImperial);
    setPreviewVal(parsedCm);
  }, [expr, isImperial]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!info || info.screenX <= 0 || info.screenY <= 0) return null;

  const handleApply = async () => {
    if (!previewVal || previewVal <= 0 || !docId || !scene) return;
    const entity = scene.entities.find((e) => e.id === info.entityId);
    if (!entity) return;

    const newLenCm = previewVal;
    const currentLenCm = info.lengthCm;
    if (Math.abs(newLenCm - currentLenCm) < 0.01) {
      setOpen(false);
      return;
    }

    try {
      const g = entity.geometry as Record<string, unknown>;
      const kind = entity.kind;

      if (kind === "line" || kind === "line_curve") {
        const end = (g.end as [number, number, number]) || [1, 0, 0];
        const oldLen = Math.hypot(end[0], end[1], end[2]) || 1;
        const scale = newLenCm / oldLen;
        await ipc.updateGeometry(docId, entity.id, {
          type: "line_curve",
          end: [end[0] * scale, end[1] * scale, end[2] * scale],
        } as unknown as Geometry);
      } else if (kind === "wall") {
        const path = (g.path as [number, number][]) || [];
        if (path.length >= 2) {
          const scale = newLenCm / currentLenCm;
          const newPath = path.map((pt, idx) => {
            if (idx === 0) return pt;
            const dx = pt[0] - path[0][0];
            const dz = pt[1] - path[0][1];
            return [path[0][0] + dx * scale, path[0][1] + dz * scale];
          });
          await ipc.updateGeometry(docId, entity.id, {
            ...g,
            type: "wall",
            path: newPath,
          } as unknown as Geometry);
        }
      } else if (kind === "box") {
        await ipc.updateGeometry(docId, entity.id, {
          ...g,
          type: "box",
          width: newLenCm,
        } as unknown as Geometry);
      } else if (kind === "circle" || kind === "circle_curve") {
        await ipc.updateGeometry(docId, entity.id, {
          ...g,
          type: "circle_curve",
          radius: newLenCm * 0.5,
        } as unknown as Geometry);
      } else if (kind === "polyline" || kind === "polyline_curve") {
        const pts = (g.points as [number, number, number][]) || [];
        if (pts.length >= 2) {
          const scale = newLenCm / currentLenCm;
          const newPts = pts.map((pt, idx) => {
            if (idx === 0) return pt;
            const dx = pt[0] - pts[0][0];
            const dy = pt[1] - pts[0][1];
            const dz = pt[2] - pts[0][2];
            return [pts[0][0] + dx * scale, pts[0][1] + dy * scale, pts[0][2] + dz * scale];
          });
          await ipc.updateGeometry(docId, entity.id, {
            ...g,
            type: "polyline_curve",
            points: newPts,
          } as unknown as Geometry);
        }
      } else {
        // Fallback: update scale of entity
        const scaleFactor = newLenCm / currentLenCm;
        const curScale = entity.transform.scale || [1, 1, 1];
        await ipc.setTransform(
          docId,
          [
            {
              id: entity.id,
              transform: {
                ...entity.transform,
                scale: [curScale[0] * scaleFactor, curScale[1], curScale[2] * scaleFactor],
              },
            },
          ],
          true,
        );
      }

      useArcStore.getState().setStatusMessage(`Length updated to ${formatDimension(newLenCm, isImperial)}`);
      setOpen(false);
    } catch (err) {
      console.error("Failed to update dimension:", err);
    }
  };

  const handleStep = (delta: number) => {
    const cur = previewVal ?? info.lengthCm;
    const deltaCm = isImperial ? delta * 2.54 : delta;
    const nextCm = Math.max(0.5, cur + deltaCm);
    setPreviewVal(nextCm);
    setExpr(isImperial ? (nextCm / 2.54).toFixed(1) : nextCm.toFixed(1));
  };

  const formattedLength = formatDimension(info.lengthCm, isImperial);

  return (
    <div
      style={{
        position: "absolute",
        left: `${info.screenX}px`,
        top: `${info.screenY}px`,
        transform: "translate(-50%, -50%)",
        zIndex: 35,
      }}
      className="pointer-events-auto"
      ref={popoverRef}
    >
      {/* Floating Dimension Indicator Pill */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        title="Click to calculate and edit length"
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-mono font-semibold shadow-lg backdrop-blur-md transition-all cursor-pointer",
          open
            ? "border-accent-500 bg-accent-500 text-white ring-2 ring-accent-500/25"
            : "border-base-300/90 bg-base-100/95 text-base-900 hover:border-accent-500 hover:bg-base-100 hover:scale-105 active:scale-95",
        )}
      >
        <Ruler size={12} className={open ? "text-white" : "text-accent-500"} strokeWidth={2} />
        <span>{formattedLength}</span>
        <ChevronDown size={11} className={cn("transition-transform duration-150", open && "rotate-180")} />
      </button>

      {/* Mini Interactive Calculator Popover */}
      {open && (
        <div className="anim-pop absolute left-1/2 top-full mt-2 -translate-x-1/2 flex w-64 flex-col gap-2 rounded-2xl border border-base-300 bg-base-100/95 p-3 shadow-2xl backdrop-blur-md text-xs text-base-800">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-base-200/80 pb-1.5">
            <span className="flex items-center gap-1.5 font-semibold text-[11px] text-base-600 uppercase tracking-wider">
              <Calculator size={12} className="text-accent-500" />
              Dimension Calculator
            </span>
            <button
              type="button"
              onClick={handleClose}
              className="text-base-400 hover:text-base-700 cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>

          {/* Expression Input Field */}
          <div className="flex flex-col gap-1">
            <div className="relative flex items-center">
              <input
                autoFocus
                value={expr}
                onChange={(e) => setExpr(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleApply();
                  } else if (e.key === "Escape") {
                    handleClose();
                  }
                }}
                placeholder={isImperial ? "e.g. 12' 6\" or 45 * 2" : "e.g. 500 or 1200 / 2"}
                className="w-full rounded-xl border border-base-300 bg-base-50 px-2.5 py-1.5 font-mono text-[13px] font-semibold text-base-900 outline-none focus:border-accent-500 focus:bg-base-100 transition-colors"
              />
              <span className="absolute right-2.5 font-mono text-[10.5px] font-bold text-base-400 select-none">
                {isImperial ? "in" : "cm"}
              </span>
            </div>

            {/* Live Result Preview */}
            {previewVal !== null && (
              <div className="flex items-center justify-between px-1 text-[10.5px] text-base-500">
                <span>Result:</span>
                <span className="font-mono font-semibold text-accent-500">
                  {formatDimension(previewVal, isImperial)}
                </span>
              </div>
            )}
          </div>

          {/* Quick Delta Steppers */}
          <div className="flex items-center justify-between gap-1 border-t border-base-200/70 pt-1.5">
            {isImperial ? (
              <>
                <button
                  type="button"
                  onClick={() => handleStep(-12)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  -1'
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(-1)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  -1"
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(1)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  +1"
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(12)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  +1'
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleStep(-50)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  -50
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(-10)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  -10
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(10)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  +10
                </button>
                <button
                  type="button"
                  onClick={() => handleStep(50)}
                  className="flex-1 rounded-lg border border-base-200 bg-base-50 py-1 font-mono text-[10px] font-medium text-base-700 hover:bg-base-200 cursor-pointer"
                >
                  +50
                </button>
              </>
            )}
          </div>

          {/* Calculator Numeric Keypad */}
          <div className="grid grid-cols-4 gap-1 text-[11px] font-mono">
            {["7", "8", "9", "/"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setExpr((prev) => prev + k)}
                className="flex h-7 items-center justify-center rounded-lg border border-base-200 bg-base-50 font-medium text-base-800 hover:bg-base-200 active:scale-95 transition-all cursor-pointer"
              >
                {k}
              </button>
            ))}
            {["4", "5", "6", "*"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setExpr((prev) => prev + k)}
                className="flex h-7 items-center justify-center rounded-lg border border-base-200 bg-base-50 font-medium text-base-800 hover:bg-base-200 active:scale-95 transition-all cursor-pointer"
              >
                {k}
              </button>
            ))}
            {["1", "2", "3", "-"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setExpr((prev) => prev + k)}
                className="flex h-7 items-center justify-center rounded-lg border border-base-200 bg-base-50 font-medium text-base-800 hover:bg-base-200 active:scale-95 transition-all cursor-pointer"
              >
                {k}
              </button>
            ))}
            {["0", ".", "C", "+"].map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  if (k === "C") setExpr("");
                  else setExpr((prev) => prev + k);
                }}
                className={cn(
                  "flex h-7 items-center justify-center rounded-lg border border-base-200 py-0.5 font-medium transition-all active:scale-95 cursor-pointer",
                  k === "C" ? "bg-red-500/10 text-red-600 hover:bg-red-500/20" : "bg-base-50 text-base-800 hover:bg-base-200",
                )}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-1.5 pt-1">
            <button
              type="button"
              onClick={() => {
                if (previewVal !== null) {
                  setExpr(isImperial ? (previewVal / 2.54).toFixed(1) : previewVal.toFixed(1));
                }
              }}
              className="flex-1 h-8 rounded-xl border border-base-300 bg-base-100 text-[11.5px] font-semibold text-base-700 hover:bg-base-200 cursor-pointer"
            >
              = Calculate
            </button>
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={!previewVal || previewVal <= 0}
              className="flex-1 h-8 flex items-center justify-center gap-1 rounded-xl bg-accent-500 text-[11.5px] font-semibold text-white shadow-xs hover:bg-accent-600 active:scale-95 disabled:opacity-40 cursor-pointer transition-all"
            >
              <Check size={12} strokeWidth={2.5} />
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
