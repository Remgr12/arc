import * as THREE from "three";
import { Trash2 } from "lucide-react";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import type { EntityData, Geometry, SceneData } from "../lib/types";
import { Button, NumField, Panel, Row, SelectField, TextField } from "./ui";

/** Right panel: properties of the primary selected entity. */
export function PropertiesPanel() {
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);
  const docId = overview?.active ?? "";
  const entity = scene?.entities.find((e) => e.id === scene.primary) ?? null;

  if (!entity) {
    return (
      <Panel title="Properties">
        <div className="px-1 text-[12px] text-base-500">
          Select an entity to inspect it. Shift-click to build a multi-selection.
        </div>
      </Panel>
    );
  }

  return (
    <Panel title="Properties">
      <EntityForm docId={docId} entity={entity} scene={scene} />
    </Panel>
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
    <div className="flex flex-col gap-1.5">
      <Row label="Name">
        <TextField
          value={entity.name}
          onCommit={(name) =>
            void ipc.setEntityProps(docId, entity.id, { name }).catch(() => undefined)
          }
        />
      </Row>
      <Row label="Layer">
        <SelectField
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
            className="h-7 w-10 cursor-pointer rounded border border-base-400 bg-base-100"
          />
          {entity.color && (
            <Button
              variant="ghost"
              onClick={() => void ipc.setEntityProps(docId, entity.id, { color: null })}
            >
              Use layer color
            </Button>
          )}
        </div>
      </Row>

      <div className="mt-1 border-t border-base-300 pt-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
        Position
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField value={t.position[0]} onCommit={(x) => patchTransform({ position: [x, t.position[1], t.position[2]] })} />
        <NumField value={t.position[1]} onCommit={(y) => patchTransform({ position: [t.position[0], y, t.position[2]] })} />
        <NumField value={t.position[2]} onCommit={(z) => patchTransform({ position: [t.position[0], t.position[1], z] })} />
      </div>

      <div className="mt-1 border-t border-base-300 pt-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
        Rotation (deg)
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField value={euler.x} onCommit={(x) => setEuler(x, euler.y, euler.z, patchTransform)} />
        <NumField value={euler.y} onCommit={(y) => setEuler(euler.x, y, euler.z, patchTransform)} />
        <NumField value={euler.z} onCommit={(z) => setEuler(euler.x, euler.y, z, patchTransform)} />
      </div>

      <div className="mt-1 border-t border-base-300 pt-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
        Scale
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <NumField value={t.scale[0]} onCommit={(x) => patchTransform({ scale: [x, t.scale[1], t.scale[2]] })} />
        <NumField value={t.scale[1]} onCommit={(y) => patchTransform({ scale: [t.scale[0], y, t.scale[2]] })} />
        <NumField value={t.scale[2]} onCommit={(z) => patchTransform({ scale: [t.scale[0], t.scale[1], z] })} />
      </div>

      <div className="mt-1 border-t border-base-300 pt-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
        Geometry ({entity.kind})
      </div>
      <GeometryForm docId={docId} entity={entity} />

      <div className="mt-2 flex gap-2">
        <Button
          variant="danger"
          onClick={() =>
            void ipc.deleteEntities(docId, [entity.id]).then(() =>
              ipc.setSelection(docId, [], null),
            )
          }
        >
          <Trash2 size={13} /> Delete
        </Button>
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
    <div className="flex flex-col gap-1">
      {numericKeys.map((key) => (
        <Row key={key} label={humanize(key)}>
          <NumField
            value={geometry[key] as number}
            onCommit={(value) => update({ [key]: value })}
          />
        </Row>
      ))}
      {pointKeys.map((key) => (
        <Row key={key} label={humanize(key)}>
          <TextField
            mono
            value={JSON.stringify(geometry[key])}
            onCommit={(text) => {
              try {
                const parsed = JSON.parse(text) as unknown;
                if (validPoints(parsed)) update({ [key]: parsed });
              } catch {
                // keep previous value on bad input
              }
            }}
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

function humanize(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  const d = (r: number) => Math.round((r * 180) / Math.PI);
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
