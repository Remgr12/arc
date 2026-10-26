import { useEffect, useState } from "react";
import {
  ArrowUpDown,
  Box,
  Check,
  Combine,
  Download,
  Eye,
  Grid3X3,
  Layers,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Orbit,
  PencilRuler,
  Plus,
  Scaling,
  Scissors,
  Slice,
  Sparkles,
  Square,
  Link2,
  Target,
  Equal,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { actions } from "../lib/actions";
import { faceEditable, faceParam } from "../tools/faceTools";
import { armExtrudeSelectedSketch } from "../tools/solid";
import { facePlaneInfo } from "../tools/topology";
import { assemblyManager } from "../lib/assembly";
import { constraintManager } from "../tools/constraints2d";
import type { EntityData, Geometry } from "../lib/types";
import { cn } from "./ui";
import * as THREE from "three";

interface DimSpec {
  key: string;
  shortLabel: string;
  fullLabel: string;
  value: number;
  min: number;
  step?: number;
  isInteger?: boolean;
  isActiveFaceParam?: boolean;
  apply: (newVal: number) => void;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildDimSpecs(
  docId: string,
  entity: EntityData,
  selFaceIndex: number | null,
  defaultStep: number,
): DimSpec[] {
  const geom = entity.geometry as Record<string, unknown>;
  const specs: DimSpec[] = [];
  const activeFace = selFaceIndex !== null ? faceParam(entity, selFaceIndex) : null;

  const updateGeom = (patch: Record<string, unknown>) => {
    void ipc
      .updateGeometry(docId, entity.id, { ...geom, ...patch } as Geometry)
      .catch(() => undefined);
  };

  const updateFaceAware = (key: "width" | "height" | "depth" | "radius", nextVal: number) => {
    const curVal = typeof geom[key] === "number" ? (geom[key] as number) : nextVal;
    const clamped = Math.max(0.05, round2(nextVal));
    const delta = clamped - curVal;
    updateGeom({ [key]: clamped });

    // If the user has a specific face selected that controls this parameter,
    // shift the entity along the face normal so the opposite face stays fixed.
    if (activeFace && activeFace.kind === key && activeFace.recenters && Math.abs(delta) > 1e-6) {
      const q = new THREE.Quaternion(
        entity.transform.rotation[0],
        entity.transform.rotation[1],
        entity.transform.rotation[2],
        entity.transform.rotation[3],
      );
      const worldAxis = activeFace.axis.clone().applyQuaternion(q).normalize();
      const factor = activeFace.shiftFactor ?? 0.5;
      const pos = entity.transform.position;
      void ipc
        .setTransform(
          docId,
          [
            {
              id: entity.id,
              transform: {
                position: [
                  pos[0] + worldAxis.x * delta * factor,
                  pos[1] + worldAxis.y * delta * factor,
                  pos[2] + worldAxis.z * delta * factor,
                ],
                rotation: entity.transform.rotation,
                scale: entity.transform.scale,
              },
            },
          ],
          true,
        )
        .catch(() => undefined);
    }
  };

  if (typeof geom.width === "number") {
    specs.push({
      key: "width",
      shortLabel: "W",
      fullLabel: "Width",
      value: round2(geom.width),
      min: 0.1,
      step: defaultStep,
      isActiveFaceParam: activeFace?.kind === "width",
      apply: (v) => updateFaceAware("width", v),
    });
  }
  if (typeof geom.depth === "number") {
    specs.push({
      key: "depth",
      shortLabel: "D",
      fullLabel: "Depth",
      value: round2(geom.depth),
      min: 0.1,
      step: defaultStep,
      isActiveFaceParam: activeFace?.kind === "depth",
      apply: (v) => updateFaceAware("depth", v),
    });
  }
  if (typeof geom.radius === "number") {
    specs.push({
      key: "radius",
      shortLabel: "R",
      fullLabel: "Radius",
      value: round2(geom.radius),
      min: 0.1,
      step: defaultStep,
      isActiveFaceParam: activeFace?.kind === "radius",
      apply: (v) => updateFaceAware("radius", v),
    });
  }
  if (typeof geom.base_radius === "number") {
    specs.push({
      key: "base_radius",
      shortLabel: "R",
      fullLabel: "Base Radius",
      value: round2(geom.base_radius),
      min: 0.1,
      step: defaultStep,
      apply: (v) => updateGeom({ base_radius: Math.max(0.1, round2(v)) }),
    });
  }
  if (typeof geom.tube === "number") {
    specs.push({
      key: "tube",
      shortLabel: "Tube",
      fullLabel: "Tube Radius",
      value: round2(geom.tube),
      min: 0.1,
      step: Math.min(defaultStep, 1),
      apply: (v) => updateGeom({ tube: Math.max(0.1, round2(v)) }),
    });
  }
  if (typeof geom.height === "number") {
    specs.push({
      key: "height",
      shortLabel: "H",
      fullLabel: "Height",
      value: round2(geom.height),
      min: 0.1,
      step: defaultStep,
      isActiveFaceParam: activeFace?.kind === "height",
      apply: (v) => updateFaceAware("height", v),
    });
  }
  if (typeof geom.thickness === "number") {
    specs.push({
      key: "thickness",
      shortLabel: "T",
      fullLabel: "Thickness",
      value: round2(geom.thickness),
      min: 0.1,
      step: defaultStep,
      apply: (v) => updateGeom({ thickness: Math.max(0.1, round2(v)) }),
    });
  }
  if (
    (geom.type === "polygon_curve" || geom.type === "polygon") &&
    typeof geom.sides === "number"
  ) {
    specs.push({
      key: "sides",
      shortLabel: "Sides",
      fullLabel: "Polygon Sides",
      value: Math.round(geom.sides),
      min: 3,
      step: 1,
      isInteger: true,
      apply: (v) => updateGeom({ sides: Math.max(3, Math.min(64, Math.round(v))) }),
    });
  }
  // 2D Line length editing
  if (geom.type === "line_curve" && Array.isArray(geom.end) && geom.end.length === 3) {
    const [dx, dy, dz] = geom.end as [number, number, number];
    const len = Math.hypot(dx, dy, dz);
    if (len > 1e-4) {
      specs.push({
        key: "length",
        shortLabel: "L",
        fullLabel: "Length",
        value: round2(len),
        min: 0.1,
        step: defaultStep,
        apply: (v) => {
          const target = Math.max(0.1, round2(v));
          const ratio = target / len;
          updateGeom({ end: [dx * ratio, dy * ratio, dz * ratio] });
        },
      });
    }
  }

  return specs;
}

function DimPill({
  spec,
  unitLabel,
}: {
  spec: DimSpec;
  unitLabel: string;
}) {
  const [text, setText] = useState(String(spec.value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setText(String(spec.value));
    }
  }, [spec.value, focused]);

  const commit = (raw: string) => {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed >= spec.min) {
      spec.apply(spec.isInteger ? Math.round(parsed) : parsed);
    } else {
      setText(String(spec.value));
    }
  };

  const stepBy = (dir: -1 | 1) => {
    const s = spec.step && spec.step > 0 ? spec.step : 1;
    const next = Math.max(spec.min, round2(spec.value + dir * s));
    spec.apply(spec.isInteger ? Math.round(next) : next);
  };

  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 rounded-lg border px-1.5 transition-colors whitespace-nowrap",
        spec.isActiveFaceParam
          ? "border-accent-500 bg-accent-500/12 text-accent-500"
          : "border-base-300 bg-base-100 text-base-700",
      )}
    >
      <span className="shrink-0 px-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-base-500">
        {spec.shortLabel}
      </span>
      <button
        type="button"
        tabIndex={-1}
        onClick={() => stepBy(-1)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
      >
        <Minus size={10} strokeWidth={2.2} />
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        style={{ width: `${Math.max(48, Math.min(100, (text.length + 1) * 8.5))}px` }}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.select();
        }}
        onBlur={(e) => {
          setFocused(false);
          commit(e.target.value);
        }}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            setText(String(spec.value));
            e.currentTarget.blur();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            stepBy(1);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            stepBy(-1);
          }
        }}
        className="h-5 min-w-[48px] max-w-[100px] rounded bg-base-50 px-1 text-center font-mono text-[11px] font-medium tabular-nums text-base-800 outline-none focus:ring-1 focus:ring-accent-500"
      />
      {!spec.isInteger && (
        <span className="shrink-0 text-[10px] font-mono text-base-500">{unitLabel}</span>
      )}
      <button
        type="button"
        tabIndex={-1}
        onClick={() => stepBy(1)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-base-500 transition-colors hover:bg-base-200 hover:text-base-800"
      >
        <Plus size={10} strokeWidth={2.2} />
      </button>
    </div>
  );
}

/**
 * Floating bottom-center Selection & Dimension HUD inside the viewport.
 * Lets the user click a face/edge/entity first and immediately get contextual
 * actions (Extrude Face, Offset Face, Sketch on Face, Fillet Edge) alongside
 * live +/- and click-to-type dimension pills.
 */
export function SelectionHud() {
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);
  const tool = useArcStore((s) => s.tool);
  const selKind = useArcStore((s) => s.selKind);
  const selFace = useArcStore((s) => s.selFace);
  const selEdge = useArcStore((s) => s.selEdge);
  const dimSnapStep = useArcStore((s) => s.dimSnapStep);
  const settings = useArcStore((s) => s.settings);

  const [subPanel, setSubPanel] = useState<"none" | "shell" | "chamfer" | "pattern">("none");
  const [shellT, setShellT] = useState(2);
  const [chamferD, setChamferD] = useState(2);
  const [patKind, setPatKind] = useState<"linear" | "circular">("linear");
  const [patAxis, setPatAxis] = useState<"x" | "y" | "z">("x");
  const [patCount, setPatCount] = useState(3);
  const [patSpacing, setPatSpacing] = useState(30);

  const docId = overview?.active ?? "";
  if (!scene || !docId || scene.selection.length === 0) return null;

  const primaryId =
    (selKind === "face" && selFace?.entityId) ||
    (selKind === "edge" && selEdge?.entityId) ||
    scene.primary ||
    scene.selection[scene.selection.length - 1];
  const entity = scene.entities.find((e) => e.id === primaryId) ?? null;
  if (!entity) return null;

  const isImperial =
    settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";
  const unitLabel = isImperial ? "in" : "cm";
  const effectiveStep = dimSnapStep > 0 ? dimSnapStep : 1;

  const dims = buildDimSpecs(
    docId,
    entity,
    selKind === "face" && selFace?.entityId === entity.id ? selFace.face : null,
    effectiveStep,
  );

  const isFace = selKind === "face" && selFace !== null;
  const isEdge = selKind === "edge" && selEdge !== null;
  const isSketch = entity.category === "sketch";
  const canEditFace = faceEditable(entity.kind);

  let multiInfo: {
    dist: number;
    dx: number;
    dy: number;
    dz: number;
    canBoolean: boolean;
    canMate: boolean;
    canSketchConstraint: boolean;
    e1: EntityData;
    e2: EntityData;
  } | null = null;

  if (scene.selection.length >= 2) {
    const e1 = scene.entities.find((e) => e.id === scene.selection[0]);
    const e2 = scene.entities.find((e) => e.id === scene.selection[1]);
    if (e1 && e2) {
      const p1 = new THREE.Vector3(...e1.transform.position);
      const p2 = new THREE.Vector3(...e2.transform.position);
      const d = p1.distanceTo(p2);
      const dx = Math.abs(p2.x - p1.x);
      const dy = Math.abs(p2.y - p1.y);
      const dz = Math.abs(p2.z - p1.z);
      const isSolid1 = e1.category === "solid" || e1.category === "primitive" || e1.kind === "csg";
      const isSolid2 = e2.category === "solid" || e2.category === "primitive" || e2.kind === "csg";
      const canBoolean = isSolid1 && isSolid2;
      const canMate = isSolid1 && isSolid2;
      const canSketchConstraint = e1.category === "sketch" && e2.category === "sketch";
      multiInfo = {
        dist: round2(d),
        dx: round2(dx),
        dy: round2(dy),
        dz: round2(dz),
        canBoolean,
        canMate,
        canSketchConstraint,
        e1,
        e2,
      };
    }
  }

  let bbox: { w: number; d: number; h: number } | null = null;
  if (!isSketch && !isFace && !isEdge && entity.triPositions && entity.triPositions.length >= 9) {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    const pos = entity.triPositions;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    const sx = entity.transform.scale[0] || 1;
    const sy = entity.transform.scale[1] || 1;
    const sz = entity.transform.scale[2] || 1;
    bbox = {
      w: round2((maxX - minX) * sx),
      h: round2((maxY - minY) * sy),
      d: round2((maxZ - minZ) * sz),
    };
  }

  return (
    <div className="anim-slide-up pointer-events-none absolute bottom-3 left-1/2 z-30 flex max-w-[calc(100vw-340px)] -translate-x-1/2 flex-col items-center gap-1.5">
      {/* Multi-selection live clearance, delta, and boolean bar */}
      {multiInfo && (
        <div className="anim-slide-up pointer-events-auto flex flex-wrap items-center gap-2.5 rounded-full border border-base-300 bg-base-100 px-3.5 py-1 text-[11px] shadow-md backdrop-blur-md">
          <span className="font-semibold text-accent-400 shrink-0">
            {scene.selection.length} Selected
          </span>
          <span className="font-mono text-base-700 shrink-0">
            Dist: <strong className="font-semibold">{multiInfo.dist}</strong> {unitLabel}
          </span>
          <span className="font-mono text-base-500 shrink-0">
            ΔX: {multiInfo.dx}, ΔY: {multiInfo.dy}, ΔZ: {multiInfo.dz}
          </span>
          {multiInfo.canBoolean && (
            <>
              <span className="h-3 w-px bg-base-300" />
              <button
                type="button"
                title="Union"
                onClick={() => void actions.booleanApply("union")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Combine size={12} strokeWidth={2} />
                <span>Union</span>
              </button>
              <button
                type="button"
                title="Subtract"
                onClick={() => void actions.booleanApply("difference")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Scissors size={12} strokeWidth={2} />
                <span>Cut</span>
              </button>
              <button
                type="button"
                title="Intersect"
                onClick={() => void actions.booleanApply("intersection")}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Layers size={12} strokeWidth={2} />
                <span>Intersect</span>
              </button>
            </>
          )}

          {multiInfo.canMate && (
            <>
              <span className="h-3 w-px bg-base-300" />
              <button
                type="button"
                onClick={() => {
                  const selFaceA = selKind === "face" && selFace?.entityId === multiInfo!.e1.id ? selFace.face : null;
                  const selFaceB = selKind === "face" && selFace?.entityId === multiInfo!.e2.id ? selFace.face : null;
                  void assemblyManager.applyMate(docId, "coincident", multiInfo!.e1, multiInfo!.e2, selFaceA, selFaceB);
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-accent-400 hover:bg-accent-500/15 transition-colors"
              >
                <Link2 size={12} strokeWidth={2} />
                <span>Mate</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const selFaceA = selKind === "face" && selFace?.entityId === multiInfo!.e1.id ? selFace.face : null;
                  const selFaceB = selKind === "face" && selFace?.entityId === multiInfo!.e2.id ? selFace.face : null;
                  void assemblyManager.applyMate(docId, "flush", multiInfo!.e1, multiInfo!.e2, selFaceA, selFaceB);
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <span>Flush</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  void assemblyManager.applyMate(docId, "concentric", multiInfo!.e1, multiInfo!.e2);
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Target size={12} strokeWidth={2} />
                <span>Concentric</span>
              </button>
            </>
          )}

          {multiInfo.canSketchConstraint && (
            <>
              <span className="h-3 w-px bg-base-300" />
              <button
                type="button"
                onClick={() => void constraintManager.applyCoincident(docId, multiInfo!.e1, multiInfo!.e2)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-semibold text-accent-400 hover:bg-accent-500/15 transition-colors"
              >
                <Link2 size={12} strokeWidth={2} />
                <span>Coincident</span>
              </button>
              <button
                type="button"
                onClick={() => void constraintManager.applyEqualLength(docId, multiInfo!.e1, multiInfo!.e2)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Equal size={12} strokeWidth={2} />
                <span>Equal</span>
              </button>
              <button
                type="button"
                onClick={() => void constraintManager.applyParallel(docId, multiInfo!.e1, multiInfo!.e2)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <span>Parallel</span>
              </button>
              <button
                type="button"
                onClick={() => void constraintManager.applyPerpendicular(docId, multiInfo!.e1, multiInfo!.e2)}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <span>Perp</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Optional parameter sub-bar for Shell, Chamfer, or Pattern */}
      {subPanel === "shell" && (
        <div className="anim-slide-up pointer-events-auto flex items-center gap-2 rounded-xl border border-base-300 bg-base-100 px-3 py-1.5 text-[11.5px] shadow-md">
          <Box size={13} className="text-accent-500" />
          <span className="font-semibold text-base-800">Shell Wall Thickness:</span>
          <button
            type="button"
            onClick={() => setShellT((v) => Math.max(0.5, round2(v - effectiveStep)))}
            className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
          >
            <Minus size={10} />
          </button>
          <input
            type="number"
            step={effectiveStep}
            min={0.2}
            value={shellT}
            onChange={(e) => setShellT(Math.max(0.2, Number.parseFloat(e.target.value) || 1))}
            className="h-5 w-14 rounded border border-base-300 bg-base-100 px-1 text-center font-mono text-[11.5px] text-base-800"
          />
          <span className="font-mono text-[10.5px] text-base-500">{unitLabel}</span>
          <button
            type="button"
            onClick={() => setShellT((v) => round2(v + effectiveStep))}
            className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
          >
            <Plus size={10} />
          </button>
          <button
            type="button"
            onClick={() => {
              void actions.shellSelection(shellT);
              setSubPanel("none");
            }}
            className="ml-1 flex h-6 items-center gap-1 rounded-lg bg-accent-500 px-2.5 text-[11px] font-semibold text-white hover:bg-accent-600"
          >
            <Check size={12} /> Apply Shell
          </button>
        </div>
      )}

      {subPanel === "chamfer" && (
        <div className="anim-slide-up pointer-events-auto flex items-center gap-2 rounded-xl border border-base-300 bg-base-100 px-3 py-1.5 text-[11.5px] shadow-md">
          <Slice size={13} className="text-accent-500" />
          <span className="font-semibold text-base-800">Chamfer Distance (45°):</span>
          <button
            type="button"
            onClick={() => setChamferD((v) => Math.max(0.5, round2(v - effectiveStep)))}
            className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
          >
            <Minus size={10} />
          </button>
          <input
            type="number"
            step={effectiveStep}
            min={0.2}
            value={chamferD}
            onChange={(e) => setChamferD(Math.max(0.2, Number.parseFloat(e.target.value) || 1))}
            className="h-5 w-14 rounded border border-base-300 bg-base-100 px-1 text-center font-mono text-[11.5px] text-base-800"
          />
          <span className="font-mono text-[10.5px] text-base-500">{unitLabel}</span>
          <button
            type="button"
            onClick={() => setChamferD((v) => round2(v + effectiveStep))}
            className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
          >
            <Plus size={10} />
          </button>
          <button
            type="button"
            onClick={() => {
              void actions.chamferSelectedEdge(chamferD);
              setSubPanel("none");
            }}
            className="ml-1 flex h-6 items-center gap-1 rounded-lg bg-accent-500 px-2.5 text-[11px] font-semibold text-white hover:bg-accent-600"
          >
            <Check size={12} /> Apply Chamfer
          </button>
        </div>
      )}

      {subPanel === "pattern" && (
        <div className="anim-slide-up pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl border border-base-300 bg-base-100 px-3 py-1.5 text-[11.5px] shadow-md">
          <div className="flex items-center rounded-lg border border-base-300 bg-base-100 p-0.5">
            <button
              type="button"
              onClick={() => {
                setPatKind("linear");
                setPatAxis("x");
                setPatCount(3);
              }}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                patKind === "linear" ? "bg-accent-500 text-white" : "text-base-600 hover:text-base-900",
              )}
            >
              <Grid3X3 size={11} /> Linear
            </button>
            <button
              type="button"
              onClick={() => {
                setPatKind("circular");
                setPatAxis("y");
                setPatCount(6);
              }}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                patKind === "circular" ? "bg-accent-500 text-white" : "text-base-600 hover:text-base-900",
              )}
            >
              <Orbit size={11} /> Circular
            </button>
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[10.5px] font-semibold uppercase text-base-500">Axis</span>
            {(["x", "y", "z"] as const).map((ax) => (
              <button
                key={ax}
                type="button"
                onClick={() => setPatAxis(ax)}
                className={cn(
                  "h-5 w-5 rounded font-mono text-[11px] font-semibold uppercase transition-colors",
                  patAxis === ax
                    ? "bg-accent-500 text-white"
                    : "bg-base-200 text-base-700 hover:bg-base-300",
                )}
              >
                {ax}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="text-[10.5px] font-semibold uppercase text-base-500">Count</span>
            <button
              type="button"
              onClick={() => setPatCount((c) => Math.max(2, c - 1))}
              className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
            >
              <Minus size={10} />
            </button>
            <span className="w-6 text-center font-mono font-semibold text-base-800">{patCount}×</span>
            <button
              type="button"
              onClick={() => setPatCount((c) => Math.min(32, c + 1))}
              className="flex h-5 w-5 items-center justify-center rounded bg-base-200 text-base-700 hover:bg-base-300"
            >
              <Plus size={10} />
            </button>
          </div>

          {patKind === "linear" && (
            <div className="flex items-center gap-1">
              <span className="text-[10.5px] font-semibold uppercase text-base-500">Step</span>
              <input
                type="number"
                step={effectiveStep}
                value={patSpacing}
                onChange={(e) => setPatSpacing(Number.parseFloat(e.target.value) || 20)}
                className="h-5 w-14 rounded border border-base-300 bg-base-100 px-1 text-center font-mono text-[11px] text-base-800"
              />
              <span className="font-mono text-[10px] text-base-500">{unitLabel}</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (patKind === "linear") {
                void actions.linearPattern({ count: patCount, spacing: patSpacing, axis: patAxis });
              } else {
                void actions.circularPattern({ count: patCount, angleDeg: 360, axis: patAxis });
              }
              setSubPanel("none");
            }}
            className="flex h-6 items-center gap-1 rounded-lg bg-accent-500 px-2.5 text-[11px] font-semibold text-white hover:bg-accent-600"
          >
            <Check size={12} /> Create Pattern
          </button>
        </div>
      )}

      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-2 rounded-xl border border-base-300 bg-base-100 px-3.5 py-1.5 shadow-md">
        {/* Selection badge */}
        <div className="flex max-w-[170px] items-center gap-1.5 pr-1">
          <span className="truncate text-[12px] font-semibold text-base-800">
            {isFace
              ? `Face ${selFace.face}`
              : isEdge
                ? "Edge"
                : entity.name || entity.kind}
          </span>
        </div>

        {/* Plane quick action: Sketch on Plane */}
        {entity && (entity.kind === "plane" || (entity.geometry as Record<string, unknown>)?.type === "plane") && !isFace && !isEdge && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const pos = entity.transform.position;
                  const rot = entity.transform.rotation;
                  const q = new THREE.Quaternion(rot[0], rot[1], rot[2], rot[3]);
                  const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
                  useArcStore.getState().enterSketchMode({
                    height: pos[1],
                    origin: pos,
                    normal: [normal.x, normal.y, normal.z],
                    label: entity.name || "Plane",
                    tool: "line",
                  });
                  window.dispatchEvent(
                    new CustomEvent("arc-focus-plane", { detail: { normal: [normal.x, normal.y, normal.z] } }),
                  );
                }}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-accent-500/15 px-2.5 text-[12px] font-semibold text-accent-500 hover:bg-accent-500 hover:text-white transition-colors"
              >
                <PencilRuler size={13} strokeWidth={1.8} />
                Sketch on Plane
              </button>
            </div>
          </>
        )}

        {/* Face-first quick actions */}
        {isFace && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex items-center gap-1">
              {canEditFace && (
                <button
                  type="button"
                  onClick={() => useArcStore.getState().setTool("extrude-face")}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                    tool === "extrude-face"
                      ? "bg-accent-500 text-white shadow-xs"
                      : "bg-accent-500/15 text-accent-500 hover:bg-accent-500 hover:text-white",
                  )}
                >
                  <ArrowUpDown size={13} strokeWidth={2} />
                  Extrude
                </button>
              )}
              {canEditFace && (
                <button
                  type="button"
                  onClick={() => useArcStore.getState().setTool("offset-face")}
                  className={cn(
                    "flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors",
                    tool === "offset-face"
                      ? "bg-accent-500 text-white shadow-xs"
                      : "text-base-700 hover:bg-base-200",
                  )}
                >
                  <Scaling size={13} strokeWidth={1.8} />
                  Offset
                </button>
              )}
              <button
                type="button"
                onClick={() => setSubPanel((p) => (p === "shell" ? "none" : "shell"))}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium transition-colors",
                  subPanel === "shell"
                    ? "bg-accent-500 text-white shadow-xs"
                    : "text-base-700 hover:bg-base-200",
                )}
              >
                <Box size={13} strokeWidth={1.8} />
                Shell
              </button>
              <button
                type="button"
                onClick={() => {
                  const info = facePlaneInfo(entity, selFace.face);
                  useArcStore.getState().enterSketchMode({
                    height: info.height,
                    origin: info.origin,
                    normal: info.normal,
                    label: info.label,
                    tool: "rectangle",
                  });
                  window.dispatchEvent(
                    new CustomEvent("arc-focus-plane", { detail: { normal: info.normal } }),
                  );
                }}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-base-700 transition-colors hover:bg-base-200"
              >
                <PencilRuler size={13} strokeWidth={1.8} />
                Sketch
              </button>
            </div>
          </>
        )}

        {/* Edge-first quick actions */}
        {isEdge && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => useArcStore.getState().setTool("fillet-edge")}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                  tool === "fillet-edge"
                    ? "bg-accent-500 text-white shadow-xs"
                    : "bg-accent-500/15 text-accent-500 hover:bg-accent-500 hover:text-white",
                  )}
              >
                <Sparkles size={13} strokeWidth={2} />
                Fillet
              </button>
              <button
                type="button"
                onClick={() => setSubPanel((p) => (p === "chamfer" ? "none" : "chamfer"))}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                  subPanel === "chamfer"
                    ? "bg-accent-500 text-white shadow-xs"
                    : "text-base-700 hover:bg-base-200",
                )}
              >
                <Slice size={13} strokeWidth={1.8} />
                Chamfer
              </button>
            </div>
          </>
        )}

        {/* Solid body quick actions (Shell + Pattern) when whole solid is selected */}
        {!isSketch && !isFace && !isEdge && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSubPanel((p) => (p === "shell" ? "none" : "shell"))}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                  subPanel === "shell"
                    ? "bg-accent-500 text-white shadow-xs"
                    : "text-base-700 hover:bg-base-200",
                )}
              >
                <Box size={13} strokeWidth={1.8} />
                Shell
              </button>
              <button
                type="button"
                onClick={() => setSubPanel((p) => (p === "pattern" ? "none" : "pattern"))}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                  subPanel === "pattern"
                    ? "bg-accent-500 text-white shadow-xs"
                    : "text-base-700 hover:bg-base-200",
                )}
              >
                <Grid3X3 size={13} strokeWidth={1.8} />
                Pattern
              </button>
              <button
                type="button"
                onClick={() => void actions.isolateSelection()}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Eye size={13} strokeWidth={1.8} />
                Isolate
              </button>
              <button
                type="button"
                onClick={() => void actions.exportSelectedStl()}
                className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[12px] font-medium text-base-700 hover:bg-base-200 transition-colors"
              >
                <Download size={13} strokeWidth={1.8} />
                STL
              </button>
            </div>
          </>
        )}

        {/* Sketch-first quick action */}
        {isSketch && !isFace && !isEdge && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  const rot = entity.transform.rotation;
                  const q = new THREE.Quaternion(rot[0], rot[1], rot[2], rot[3]);
                  const normalVec = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
                  useArcStore.getState().enterSketchMode({
                    origin: entity.transform.position,
                    normal: [normalVec.x, normalVec.y, normalVec.z],
                    label: `Edit ${entity.name || "Sketch"}`,
                    tool: "line",
                  });
                  window.dispatchEvent(
                    new CustomEvent("arc-focus-plane", {
                      detail: { normal: [normalVec.x, normalVec.y, normalVec.z] },
                    }),
                  );
                }}
                className="flex h-7 items-center gap-1.5 rounded-lg bg-accent-500/15 px-2.5 text-[12px] font-semibold text-accent-500 hover:bg-accent-500 hover:text-white transition-colors"
              >
                <PencilRuler size={13} strokeWidth={1.8} />
                Edit / Draw
              </button>
              <button
                type="button"
                onClick={() => {
                  armExtrudeSelectedSketch();
                  useArcStore.getState().setTool("extrude");
                }}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium transition-colors",
                  tool === "extrude"
                    ? "bg-accent-500 text-white shadow-xs"
                    : "bg-accent-500/15 text-accent-500 hover:bg-accent-500 hover:text-white",
                )}
              >
                <ArrowUpDown size={13} strokeWidth={2} />
                Extrude
              </button>

              {/* SolveSpace-style rapid geometric constraints with Lucide icons */}
              {(entity.kind === "line" || entity.kind === "line_curve" || entity.kind === "polyline_curve") && (
                <>
                  <button
                    type="button"
                    onClick={() => void constraintManager.applyHorizontal(docId, entity)}
                    className="flex h-7 items-center gap-1.5 rounded-md bg-base-200/90 px-2 font-mono text-[11px] font-semibold text-base-700 hover:bg-accent-500 hover:text-white transition-colors"
                  >
                    <MoveHorizontal size={13} strokeWidth={2} />
                    <span>Horiz</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void constraintManager.applyVertical(docId, entity)}
                    className="flex h-7 items-center gap-1.5 rounded-md bg-base-200/90 px-2 font-mono text-[11px] font-semibold text-base-700 hover:bg-accent-500 hover:text-white transition-colors"
                  >
                    <MoveVertical size={13} strokeWidth={2} />
                    <span>Vert</span>
                  </button>
                </>
              )}
              {(entity.kind === "rectangle" || entity.kind === "rectangle_curve") && (
                <button
                  type="button"
                  onClick={() => void constraintManager.applySquare(docId, entity)}
                  className="flex h-7 items-center gap-1.5 rounded-md bg-base-200/90 px-2 font-mono text-[11px] font-semibold text-base-700 hover:bg-accent-500 hover:text-white transition-colors"
                >
                  <Square size={13} strokeWidth={2} />
                  <span>Square</span>
                </button>
              )}

              {/* Construction toggle (X key) */}
              <button
                type="button"
                onClick={() => void actions.toggleConstruction()}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded-md px-2 font-mono text-[11px] font-semibold transition-colors",
                  entity.name?.startsWith("[C] ")
                    ? "bg-amber-500 text-white shadow-xs"
                    : "bg-base-200/90 text-base-700 hover:bg-base-200 hover:text-base-900",
                )}
              >
                <PencilRuler size={13} strokeWidth={2} />
                <span>{entity.name?.startsWith("[C] ") ? "Const [X]" : "Const"}</span>
              </button>
            </div>
          </>
        )}

        {/* Live editable dimensions */}
        {dims.length > 0 && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex flex-wrap items-center gap-2">
              {dims.map((spec) => (
                <DimPill key={`${entity.id}-${spec.key}`} spec={spec} unitLabel={unitLabel} />
              ))}
            </div>
          </>
        )}

        {/* Live bounding box dimensions */}
        {bbox && (
          <>
            <span className="h-4 w-px bg-base-200" />
            <div className="flex items-center gap-1.5 font-mono text-[11px] text-base-600">
              <span className="font-semibold text-base-500 uppercase text-[9px]">Box</span>
              <span>{bbox.w} × {bbox.h} × {bbox.d} {unitLabel}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
