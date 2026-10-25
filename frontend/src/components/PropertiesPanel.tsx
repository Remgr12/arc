import { useState } from "react";
import * as THREE from "three";
import { Box, History, Link2, PencilRuler, RefreshCw, Sliders, Trash2 } from "lucide-react";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { featureHistory } from "../lib/featureHistory";
import { assemblyManager } from "../lib/assembly";
import type { EntityData, Geometry, SceneData } from "../lib/types";
import { cn, NumField, Row, SelectField, TextField } from "./ui";

function Section({
  title,
  hint,
  children,
  className,
}: {
  title?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-2", className)}>
      {title && (
        <div className="flex items-baseline justify-between pb-1.5">
          <h3 className="text-[11px] font-semibold text-base-700">{title}</h3>
          {hint && <span className="text-[10px] text-base-500">{hint}</span>}
        </div>
      )}
      {children}
    </section>
  );
}

const AXIS = [
  { label: "X", color: "text-[#e5715f]" },
  { label: "Y", color: "text-[#8fbf5a]" },
  { label: "Z", color: "text-[#5a94e5]" },
];

/** Three number fields with dedicated axis badges so numbers never collide with X/Y/Z. */
function AxisFields({
  values,
  onCommit,
}: {
  values: [number, number, number];
  onCommit: (index: 0 | 1 | 2, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {AXIS.map((axis, i) => (
        <div
          key={axis.label}
          className="flex h-7.5 min-w-0 items-center overflow-hidden rounded-lg border border-base-300 bg-base-100 transition-all focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20"
        >
          <span
            className={cn(
              "flex h-full w-4 shrink-0 select-none items-center justify-center border-r border-base-200/70 bg-base-200/40 font-mono text-[10px] font-bold",
              axis.color,
            )}
          >
            {axis.label}
          </span>
          <div className="min-w-0 flex-1">
            <NumField
              value={values[i]}
              className="h-7 rounded-none border-0 bg-transparent px-1.5 text-[11px] focus:ring-0"
              onCommit={(value) => onCommit(i as 0 | 1 | 2, value)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Right panel: properties of the primary selected entity, plus Feature Tree and Assembly Mates. */
export function PropertiesPanel() {
  const [tab, setTab] = useState<"props" | "features" | "assembly">("props");
  const overview = useArcStore((s) => s.overview) as any;
  const scene = useArcStore((s) => s.scene) as any;
  const docId = overview?.active ?? "";
  const entity = scene?.entities.find((e: { id: string; primary?: string }) => e.id === scene.primary) ?? null;

  const featureCount = featureHistory.list().length;
  const mateCount = assemblyManager.list().length;

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-50">
      {/* Tab Switcher Header */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-200 bg-base-100/90 px-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setTab("props")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors",
              tab === "props"
                ? "bg-base-200 text-base-900 font-semibold"
                : "text-base-600 hover:bg-base-100 hover:text-base-800",
            )}
          >
            <Sliders size={12} strokeWidth={2} />
            <span>Inspector</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("features")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors",
              tab === "features"
                ? "bg-base-200 text-base-900 font-semibold"
                : "text-base-600 hover:bg-base-100 hover:text-base-800",
            )}
          >
            <History size={12} strokeWidth={2} />
            <span>History</span>
            {featureCount > 0 && (
              <span className="rounded-full bg-accent-500/20 px-1.5 py-0.2 min-w-[16px] text-center font-mono text-[9.5px] font-bold text-accent-400 shrink-0 leading-none">
                {featureCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setTab("assembly")}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors",
              tab === "assembly"
                ? "bg-base-200 text-base-900 font-semibold"
                : "text-base-600 hover:bg-base-100 hover:text-base-800",
            )}
          >
            <Link2 size={12} strokeWidth={2} />
            <span>Assembly</span>
            {mateCount > 0 && (
              <span className="rounded-full bg-accent-500/20 px-1.5 py-0.2 min-w-[16px] text-center font-mono text-[9.5px] font-bold text-accent-400 shrink-0 leading-none">
                {mateCount}
              </span>
            )}
          </button>
        </div>
        {tab === "props" && entity && (
          <span className="truncate max-w-[100px] rounded bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-600 shrink-0">{entity.kind}</span>
        )}
      </div>

      {/* Tab Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pb-3.5">
        {tab === "props" && (
          entity ? (
            <EntityForm docId={docId} entity={entity} scene={scene} />
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Box size={28} className="text-base-300 mb-2" />
              <p className="text-[12px] font-medium text-base-600">No selection</p>
              <p className="text-[11px] text-base-400 mt-0.5">Select a solid or sketch in the viewport</p>
            </div>
          )
        )}
        {tab === "features" && <FeaturesTab docId={docId} />}
        {tab === "assembly" && <AssemblyTab docId={docId} />}
      </div>
    </div>
  );
}

function FeaturesTab({ docId }: { docId: string }) {
  const scene = useArcStore((s) => s.scene);
  const [, setVersion] = useState(0);
  const features = featureHistory.list();

  const handleEditSketch = (sketchId?: string) => {
    if (!sketchId || !scene) return;
    const sketchEntity = scene.entities.find((e) => e.id === sketchId);
    if (!sketchEntity) return;

    const rot = sketchEntity.transform.rotation;
    const q = new THREE.Quaternion(rot[0], rot[1], rot[2], rot[3]);
    const normalVec = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    useArcStore.getState().enterSketchMode({
      origin: sketchEntity.transform.position,
      normal: [normalVec.x, normalVec.y, normalVec.z],
      label: `Edit ${sketchEntity.name || "Sketch"}`,
      tool: "line",
    });
    window.dispatchEvent(
      new CustomEvent("arc-focus-plane", {
        detail: { normal: [normalVec.x, normalVec.y, normalVec.z] },
      }),
    );
  };

  if (features.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-2 text-center">
        <History size={30} className="text-base-300 mb-2" />
        <span className="text-[12px] font-semibold text-base-700">No Parametric Features</span>
        <p className="text-[11px] text-base-500 mt-1">
          Extrude or cut any 2D sketch to build a parametric feature tree. Downstream solids update automatically when sketches change!
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 pt-3">
      {features.map((feat) => {
        const sketchEntity = feat.sketchEntityId ? scene?.entities.find((e) => e.id === feat.sketchEntityId) : null;
        return (
          <div key={feat.id} className="flex flex-col gap-2 rounded-xl border border-base-200 bg-base-100 p-2.5 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <Box size={13} className="text-accent-500 shrink-0" />
                <span className="text-[12px] font-semibold text-base-800 truncate">{feat.name}</span>
              </div>
              <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-400 shrink-0">
                {feat.operation}
              </span>
            </div>

            {sketchEntity && (
              <div className="flex items-center justify-between text-[11px] text-base-600">
                <span className="flex items-center gap-1 truncate">
                  <PencilRuler size={11} className="text-base-400 shrink-0" />
                  Driven by: <strong className="text-base-800 truncate">{sketchEntity.name || "Sketch"}</strong>
                </span>
                <button
                  type="button"
                  onClick={() => handleEditSketch(sketchEntity.id)}
                  className="shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-semibold text-accent-400 hover:bg-accent-500/15 transition-colors"
                >
                  Edit Sketch
                </button>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-base-200/50 pt-2 text-[11px]">
              <span className="text-base-500">Height:</span>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  step={1}
                  min={0.5}
                  value={feat.parameters.height}
                  onChange={(e) => {
                    const next = Number.parseFloat(e.target.value);
                    if (Number.isFinite(next) && next > 0) {
                      void featureHistory.updateFeatureHeight(docId, feat.id, next).then(() => setVersion((v) => v + 1));
                    }
                  }}
                  className="h-5 w-14 rounded border border-base-300 bg-base-50 px-1 text-center font-mono text-[11px] text-base-800"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (feat.sketchEntityId) {
                      void featureHistory.regenerate(feat.sketchEntityId, docId).then(() => setVersion((v) => v + 1));
                    }
                  }}
                  className="flex h-5 items-center gap-1 rounded bg-base-200 px-1.5 text-[10.5px] font-medium text-base-700 hover:bg-base-300 transition-colors"
                >
                  <RefreshCw size={10} />
                  <span>Regen</span>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AssemblyTab({ docId }: { docId: string }) {
  const scene = useArcStore((s) => s.scene);
  const [, setVersion] = useState(0);
  const mates = assemblyManager.list();

  if (mates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 px-2 text-center">
        <Link2 size={30} className="text-base-300 mb-2" />
        <span className="text-[12px] font-semibold text-base-700">No Assembly Mates</span>
        <p className="text-[11px] text-base-500 mt-1">
          Select 2 solid parts in the viewport and click Mate, Flush, or Concentric to align and snap them together.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5 pt-3">
      {mates.map((m) => {
        const eA = scene?.entities.find((e) => e.id === m.entityAId);
        const eB = scene?.entities.find((e) => e.id === m.entityBId);
        return (
          <div key={m.id} className="flex flex-col gap-2 rounded-xl border border-base-200 bg-base-100 p-2.5 shadow-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 min-w-0">
                <Link2 size={12} className="text-accent-500 shrink-0" />
                <span className="text-[12px] font-semibold text-base-800 truncate">{m.name}</span>
              </div>
              <span className="rounded bg-accent-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-accent-400 shrink-0">
                {m.type}
              </span>
            </div>

            <div className="flex flex-col gap-0.5 text-[11px] text-base-600">
              <span className="truncate">Ref (fixed): <strong className="text-base-800">{eA?.name || "Part A"}</strong></span>
              <span className="truncate">Moving: <strong className="text-base-800">{eB?.name || "Part B"}</strong></span>
              {typeof m.offsetDistance === "number" && m.offsetDistance !== 0 && (
                <span>Offset: <strong className="font-mono text-base-800">{m.offsetDistance}</strong></span>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-base-200/50 pt-2 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  void assemblyManager.reapplyMate(docId, m.id).then(() => setVersion((v) => v + 1));
                }}
                className="flex items-center gap-1 rounded bg-base-200 px-2 py-0.5 text-[10.5px] font-medium text-base-700 hover:bg-base-300 transition-colors"
              >
                <RefreshCw size={10} />
                <span>Re-align</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  assemblyManager.remove(m.id);
                  setVersion((v) => v + 1);
                }}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] text-danger-500 hover:bg-danger-50 transition-colors"
              >
                <Trash2 size={10} />
                <span>Remove</span>
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ParametricFeatureCard({
  docId,
  entity,
  scene,
}: {
  docId: string;
  entity: EntityData;
  scene: SceneData | null;
}) {
  const feat = featureHistory.get(entity.id);
  const downstream = featureHistory.getDownstreamFeatures(entity.id);

  if (!feat && downstream.length === 0) return null;

  const handleEditSketch = (sketchId: string) => {
    if (!scene) return;
    const sketchEntity = scene.entities.find((e) => e.id === sketchId);
    if (!sketchEntity) return;

    const rot = sketchEntity.transform.rotation;
    const q = new THREE.Quaternion(rot[0], rot[1], rot[2], rot[3]);
    const normalVec = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
    useArcStore.getState().enterSketchMode({
      origin: sketchEntity.transform.position,
      normal: [normalVec.x, normalVec.y, normalVec.z],
      label: `Edit ${sketchEntity.name || "Sketch"}`,
      tool: "line",
    });
    window.dispatchEvent(
      new CustomEvent("arc-focus-plane", {
        detail: { normal: [normalVec.x, normalVec.y, normalVec.z] },
      }),
    );
  };

  if (feat) {
    const driving = feat.sketchEntityId ? scene?.entities.find((e) => e.id === feat.sketchEntityId) : null;
    return (
      <Section title="Parametric Feature" className="mt-4 border-t border-base-200/60 pt-3">
        <div className="flex flex-col gap-2 rounded-lg border border-accent-500/20 bg-accent-500/5 p-2.5">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-semibold text-accent-400">{feat.name}</span>
            <span className="rounded bg-accent-500/20 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-accent-400 shrink-0">
              {feat.operation}
            </span>
          </div>
          {driving && (
            <div className="flex items-center justify-between text-[11px] text-base-600">
              <span>Driving: <strong className="text-base-800">{driving.name || "Sketch"}</strong></span>
              <button
                type="button"
                onClick={() => handleEditSketch(driving.id)}
                className="font-semibold text-accent-400 hover:underline"
              >
                Edit Sketch
              </button>
            </div>
          )}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-base-500">Extrusion Height:</span>
            <input
              type="number"
              step={1}
              min={0.5}
              value={feat.parameters.height}
              onChange={(e) => {
                const next = Number.parseFloat(e.target.value);
                if (Number.isFinite(next) && next > 0) {
                  void featureHistory.updateFeatureHeight(docId, feat.id, next);
                }
              }}
              className="h-5 w-14 rounded border border-base-300 bg-base-100 px-1 text-center font-mono text-[11px] text-base-800"
            />
          </div>
        </div>
      </Section>
    );
  }

  if (downstream.length > 0) {
    return (
      <Section title="Downstream Solids" className="mt-4 border-t border-base-200/60 pt-3">
        <div className="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-2.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-base-600">Drives <strong>{downstream.length}</strong> solid{downstream.length > 1 ? "s" : ""}:</span>
            <button
              type="button"
              onClick={() => void featureHistory.regenerate(entity.id, docId)}
              className="flex items-center gap-1 rounded bg-accent-500/15 px-2 py-0.5 font-semibold text-[10.5px] text-accent-400 hover:bg-accent-500/25 transition-colors"
            >
              <RefreshCw size={10} /> Regen All
            </button>
          </div>
          <div className="flex flex-col gap-1">
            {downstream.map((d) => (
              <span key={d.id} className="font-mono text-[10.5px] text-base-700">
                • {d.name} ({d.operation})
              </span>
            ))}
          </div>
        </div>
      </Section>
    );
  }

  return null;
}

function EntityForm({
  docId,
  entity,
  scene,
}: {
  docId: string;
  entity: EntityData;
  scene: SceneData | null;
}) {
  const t = entity.transform;
  const euler = quatToEuler(t.rotation);

  const patchTransform = (patch: Partial<EntityData["transform"]>) => {
    void ipc
      .setTransform(docId, [{ id: entity.id, transform: { ...t, ...patch } }], true)
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col pt-3">
      <Section>
        <Row label="Name">
          <TextField
            className="h-7"
            value={entity.name}
            onCommit={(name) =>
              void ipc.setEntityProps(docId, entity.id, { name }).catch(() => undefined)
            }
          />
        </Row>
        <Row label="Layer">
          <SelectField
            className="h-7 text-[12px]"
            value={entity.layer}
            options={(scene?.layers ?? []).map((l) => ({ value: l.id, label: l.name }))}
            onChange={(layerId) =>
              void ipc.setEntityProps(docId, entity.id, { layerId }).catch(() => undefined)
            }
          />
        </Row>
        <Row label="Color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={toHex(entity.color ?? [0.62, 0.62, 0.65, 1]).slice(0, 7)}
              onChange={(e) => {
                const hex = e.target.value;
                const color: [number, number, number, number] = [
                  parseInt(hex.slice(1, 3), 16) / 255,
                  parseInt(hex.slice(3, 5), 16) / 255,
                  parseInt(hex.slice(5, 7), 16) / 255,
                  entity.color?.[3] ?? 1,
                ];
                void ipc.setEntityProps(docId, entity.id, { color }).catch(() => undefined);
              }}
              className="h-6 w-9 cursor-pointer rounded-md border border-base-300 bg-base-200"
            />
            {entity.color && (
              <button
                type="button"
                className="rounded px-1.5 py-1 text-[11px] text-base-600 transition-colors hover:bg-base-200 hover:text-base-700"
                onClick={() => void ipc.setEntityProps(docId, entity.id, { color: null })}
              >
                Use layer color
              </button>
            )}
          </div>
        </Row>
      </Section>

      <Section title="Position" className="mt-4 border-t border-base-200 pt-3">
        <AxisFields
          values={t.position}
          onCommit={(axis, value) => {
            const next = [...t.position] as [number, number, number];
            next[axis] = value;
            patchTransform({ position: next });
          }}
        />
      </Section>

      <Section title="Rotation" hint="degrees" className="mt-4 border-t border-base-200 pt-3">
        <AxisFields
          values={[euler.x, euler.y, euler.z]}
          onCommit={(axis, value) => {
            const next = [euler.x, euler.y, euler.z];
            next[axis] = value;
            setEuler(next[0], next[1], next[2], patchTransform);
          }}
        />
      </Section>

      <Section title="Scale" className="mt-4 border-t border-base-200 pt-3">
        <AxisFields
          values={t.scale}
          onCommit={(axis, value) => {
            const next = [...t.scale] as [number, number, number];
            next[axis] = value;
            patchTransform({ scale: next });
          }}
        />
      </Section>

      <Section
        title="Geometry"
        className="mt-4 border-t border-base-200/60 pt-3"
      >
        <GeometryForm docId={docId} entity={entity} />
      </Section>

      <ParametricFeatureCard docId={docId} entity={entity} scene={scene} />

      <div className="mt-5 border-t border-base-200/60 pt-3 pb-1 transition-all duration-300">
        <button
          type="button"
          className="flex h-7 w-full items-center justify-center gap-2 rounded-md border border-base-300/50 text-[12px] text-base-600 transition-all duration-300 hover:border-danger-500/50 hover:bg-danger-600/15 hover:text-danger-500 hover:shadow-sm"
          onClick={() =>
            void ipc.deleteEntities(docId, [entity.id]).then(() =>
              ipc.setSelection(docId, [], null),
            )
          }
        >
          <Trash2 size={14} strokeWidth={1.75} /> Delete
        </button>
      </div>
    </div>
  );
}

function GeometryForm({ docId, entity }: { docId: string; entity: EntityData }) {
  const geometry = entity.geometry as Record<string, unknown>;
  const numericKeys = Object.keys(geometry).filter(
    (k) => typeof geometry[k] === "number" && k !== "type",
  );
  const pointKeys = Object.keys(geometry).filter((k) => isPointArray(geometry[k]));

  const update = (patch: Record<string, unknown>) => {
    void ipc
      .updateGeometry(docId, entity.id, { ...geometry, ...patch } as Geometry)
      .catch(() => undefined);
  };

  return (
    <div className="flex flex-col gap-1 py-0.5">
      {numericKeys.map((key) => (
        <Row key={key} label={humanize(key)}>
          <NumField
            className="h-7 px-2.5 text-[11.5px]"
            value={geometry[key] as number}
            onCommit={(value) => update({ [key]: value })}
          />
        </Row>
      ))}
      {pointKeys.map((key) => (
        <Row key={key} label={humanize(key)}>
          <TextField
            className="h-7 px-2.5 text-[11.5px]"
            mono
            value={JSON.stringify(geometry[key])}
            onCommit={(text) => {
              try {
                const parsed = JSON.parse(text) as unknown;
                if (validPoints(parsed)) update({ [key]: parsed });
              } catch {
                // keep previous value on bad input
              }
            }
            }
          />
        </Row>
      ))}
      {numericKeys.length === 0 && pointKeys.length === 0 && (
        <div className="text-[11px] text-base-500">No editable parameters.</div>
      )}
    </div>
  );
}

function isPointArray(v: unknown): boolean {
  return (
    Array.isArray(v) &&
    (v.length === 0 ||
      (v.length === 2 && Array.isArray(v[0])) ||
      (Array.isArray(v) && (v as unknown[]).every(
        (item) => typeof item === "number" || Array.isArray(item),
      )))
  );
}

function validPoints(v: unknown): boolean {
  if (!Array.isArray(v)) return false;
  return v.every(
    (item) =>
      typeof item === "number" ||
      (Array.isArray(item) && item.every((n) => typeof n === "number")),
  );
}

/** Sentence-case label for a snake_case geometry key. */
function humanize(key: string): string {
  const words = key.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function toHex(color: [number, number, number, number]): string {
  const h = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${h(color[0])}${h(color[1])}${h(color[2])}`;
}

const EULER_ORDER = "ZYX" as const;

function quatToEuler(q: [number, number, number, number]): { x: number; y: number; z: number } {
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion(q[0], q[1], q[2], q[3]),
    EULER_ORDER,
  );
  const d = (r: number) => Math.round(((r * 180) / Math.PI) * 10) / 10;
  return { x: d(euler.x), y: d(euler.y), z: d(euler.z) };
}

function setEuler(
  x: number,
  y: number,
  z: number,
  patch: (p: { rotation: [number, number, number, number] }) => void,
): void {
  const quat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, EULER_ORDER),
  );
  patch({ rotation: [quat.x, quat.y, quat.z, quat.w] });
}
