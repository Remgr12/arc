import * as THREE from "three";
import { Trash2 } from "lucide-react";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
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

/** Three number fields with tiny axis letters, for position / rotation / scale. */
function AxisFields({
  values,
  onCommit,
}: {
  values: [number, number, number];
  onCommit: (index: 0 | 1 | 2, value: number) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {AXIS.map((axis, i) => (
        <div key={axis.label} className="relative">
          <span
            className={cn(
              "pointer-events-none absolute left-1.5 top-1/2 -translate-y-1/2 font-mono text-[10px]",
              axis.color,
            )}
          >
            {axis.label}
          </span>
          <NumField
            value={values[i]}
            className="pl-4"
            onCommit={(value) => onCommit(i as 0 | 1 | 2, value)}
          />
        </div>
      ))}
    </div>
  );
}

/** Right panel: properties of the primary selected entity. */
export function PropertiesPanel() {
  const overview = useArcStore((s) => s.overview) as any;
  const scene = useArcStore((s) => s.scene) as any;
  const docId = overview?.active ?? "";
  const entity = scene?.entities.find((e: { id: string; primary?: string }) => e.id === scene.primary) ?? null;

  if (!entity) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-base-50">
        <PanelHeader title="Properties" />
        <div className="flex flex-1 items-start px-3 pt-3">
          <p className="text-[12px] leading-relaxed text-base-500">
            Select an item to inspect its transform, layer, and parametric dimensions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-50">
      <PanelHeader title="Properties" hint={entity.kind} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <EntityForm docId={docId} entity={entity} scene={scene} />
      </div>
    </div>
  );
}

function PanelHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-200 bg-base-100/80 px-3">
      <span className="text-[12px] font-semibold text-base-800">{title}</span>
      {hint && (
        <span className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[10px] text-base-600">{hint}</span>
      )}
    </div>
  );
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
            className="h-6"
            value={geometry[key] as number}
            onCommit={(value) => update({ [key]: value })}
          />
        </Row>
      ))}
      {pointKeys.map((key) => (
        <Row key={key} label={humanize(key)}>
          <TextField
            className="h-6"
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
