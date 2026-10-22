import { useState } from "react";
import { Eye, EyeOff, Lock, LockOpen, Plus, Trash2, X } from "lucide-react";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { cn, IconButton } from "./ui";
import type { EntityData, GeometryCategory, LayerData } from "../lib/types";

const CATEGORIES: GeometryCategory[] = ["primitive", "sketch", "solid", "architecture", "annotation"];

const CATEGORY_LABELS: Record<GeometryCategory, string> = {
  primitive: "Primitives",
  sketch: "Sketches",
  solid: "Solids",
  architecture: "Architecture",
  annotation: "Annotations",
};

function toCss(color: [number, number, number, number]): string {
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`;
}

function DocumentRow({
  doc,
  active,
}: {
  doc: { id: string; name: string; dirty: boolean; path: string | null };
  active: boolean;
}) {
  return (
    <div
      className={cn(
        "group flex h-6 items-center gap-1.5 rounded px-1.5",
        active ? "bg-base-200" : "hover:bg-base-200",
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={() => actions.switchDocument(doc.id)}
      >
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            active ? "bg-accent-500" : "bg-base-400",
          )}
        />
        <span className={cn("truncate text-[12px]", active ? "text-base-800" : "text-base-600")}>
          {doc.name}
        </span>
        {doc.dirty && <span className="shrink-0 text-[10px] text-accent-500">•</span>}
      </button>
      <IconButton
        icon={<X size={11} strokeWidth={1.75} />}
        title="Close document"
        size="sm"
        className="h-4.5 w-4.5 opacity-0 group-hover:opacity-100"
        onClick={() => void ipc.closeDocument(doc.id).catch(() => undefined)}
      />
    </div>
  );
}

function EntityRow({
  entity,
  docId,
  scene,
}: {
  entity: EntityData;
  docId: string;
  scene: NonNullable<ReturnType<typeof useArcStore.getState>["scene"]>;
}) {
  const selected = scene.selection.includes(entity.id);
  const primary = scene.primary === entity.id;
  const layer = scene.layers.find((l) => l.id === entity.layer);
  const hidden = !entity.visible || (layer ? !layer.visible : false);

  return (
    <div
      className={cn(
        "group flex h-6 items-center gap-1.5 rounded px-1.5",
        primary
          ? "bg-accent-700/30 text-base-800"
          : selected
            ? "bg-base-200 text-base-800"
            : "text-base-600 hover:bg-base-200",
      )}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={() =>
          void ipc
            .setSelection(docId, selected ? scene.selection : [entity.id], entity.id)
            .catch(() => undefined)
        }
        onDoubleClick={() => actions.focusEntity(entity.id)}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-sm"
          style={{ backgroundColor: toCss(entity.color ?? layer?.color ?? [0.62, 0.62, 0.65, 1]) }}
        />
        <span className="truncate text-[12px]">{entity.name}</span>
        {entity.locked && <Lock size={9} strokeWidth={1.75} className="shrink-0 text-base-500" />}
        {hidden && <EyeOff size={10} strokeWidth={1.75} className="shrink-0 text-base-500" />}
      </button>
      <IconButton
        icon={entity.visible ? <Eye size={11} strokeWidth={1.75} /> : <EyeOff size={11} strokeWidth={1.75} />}
        title={entity.visible ? "Hide" : "Show"}
        size="sm"
        className={cn("h-4.5 w-4.5", entity.visible ? "opacity-0 group-hover:opacity-100" : "opacity-70")}
        onClick={() =>
          void ipc
            .setEntityProps(docId, entity.id, { visible: !entity.visible })
            .catch(() => undefined)
        }
      />
      <IconButton
        icon={entity.locked ? <Lock size={11} strokeWidth={1.75} /> : <LockOpen size={11} strokeWidth={1.75} />}
        title={entity.locked ? "Unlock" : "Lock"}
        size="sm"
        className="h-4.5 w-4.5 opacity-0 group-hover:opacity-100"
        onClick={() =>
          void ipc
            .setEntityProps(docId, entity.id, { locked: !entity.locked })
            .catch(() => undefined)
        }
      />
      <IconButton
        icon={<Trash2 size={11} strokeWidth={1.75} />}
        title="Delete"
        size="sm"
        className="h-4.5 w-4.5 opacity-0 group-hover:opacity-100"
        onClick={() => void ipc.deleteEntities(docId, [entity.id]).catch(() => undefined)}
      />
    </div>
  );
}

function LayerRow({
  layer,
  docId,
  active,
  count,
  canDelete,
  onRename,
}: {
  layer: LayerData;
  docId: string;
  active: boolean;
  count: number;
  canDelete: boolean;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div
      className={cn(
        "group flex h-6 items-center gap-1.5 rounded px-1.5",
        active ? "bg-base-200" : "hover:bg-base-200",
      )}
    >
      <input
        type="color"
        value={toCss(layer.color).slice(0, 7)}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const hex = e.target.value;
          const color: [number, number, number, number] = [
            parseInt(hex.slice(1, 3), 16) / 255,
            parseInt(hex.slice(3, 5), 16) / 255,
            parseInt(hex.slice(5, 7), 16) / 255,
            layer.color[3],
          ];
          void ipc.setLayerColor(docId, layer.id, color).catch(() => undefined);
        }}
        title="Layer color"
        className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border border-base-400"
      />
      {editing ? (
        <input
          autoFocus
          defaultValue={layer.name}
          spellCheck={false}
          onBlur={(e) => {
            setEditing(false);
            const name = e.target.value.trim();
            if (name && name !== layer.name) onRename(name);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              e.currentTarget.value = layer.name;
              e.currentTarget.blur();
            }
            e.stopPropagation();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="min-w-0 flex-1 rounded border border-accent-500 bg-base-200 px-1 text-[12px] text-base-800 outline-none"
        />
      ) : (
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title="Set active layer (double-click to rename)"
          onClick={() => void ipc.setActiveLayer(docId, layer.id).catch(() => undefined)}
          onDoubleClick={() => setEditing(true)}
        >
          <span className={cn("truncate text-[12px]", active ? "text-base-800" : "text-base-600")}>
            {layer.name}
          </span>
          <span className="shrink-0 text-[10px] tabular-nums text-base-500">{count}</span>
        </button>
      )}
      <IconButton
        icon={layer.visible ? <Eye size={11} strokeWidth={1.75} /> : <EyeOff size={11} strokeWidth={1.75} />}
        title={layer.visible ? "Hide layer" : "Show layer"}
        size="sm"
        className={cn("h-4.5 w-4.5", layer.visible ? "opacity-0 group-hover:opacity-100" : "opacity-70")}
        onClick={() => void ipc.setLayerVisible(docId, layer.id, !layer.visible).catch(() => undefined)}
      />
      <IconButton
        icon={layer.locked ? <Lock size={11} strokeWidth={1.75} /> : <LockOpen size={11} strokeWidth={1.75} />}
        title={layer.locked ? "Unlock layer" : "Lock layer"}
        size="sm"
        className="h-4.5 w-4.5 opacity-0 group-hover:opacity-100"
        onClick={() => void ipc.setLayerLocked(docId, layer.id, !layer.locked).catch(() => undefined)}
      />
      {canDelete && (
        <IconButton
          icon={<Trash2 size={11} strokeWidth={1.75} />}
          title="Delete layer"
          size="sm"
          className="h-4.5 w-4.5 opacity-0 group-hover:opacity-100"
          onClick={() => void ipc.deleteLayer(docId, layer.id).catch(() => undefined)}
        />
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-1.5 pb-0.5 pt-2 text-[10.5px] font-medium text-base-500 first:pt-0">{children}</div>
  );
}

/** Right panel: open documents plus an item outline (or layer list) with visibility toggles. */
export function ProjectPanel() {
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);
  const [mode, setMode] = useState<"items" | "layers">("items");
  const docId = overview?.active ?? "";
  const documents = overview?.documents ?? [];

  const grouped = CATEGORIES.map((category) => ({
    category,
    entities: (scene?.entities ?? []).filter((e) => e.category === category),
  })).filter((g) => g.entities.length > 0);

  const addLayerOrDoc = () => (mode === "layers" ? void actions.addLayer() : void actions.newDocument());

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-200 bg-base-50 px-3">
        <div className="flex items-center gap-2">
          {(["items", "layers"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                "-mb-px border-b-2 border-transparent px-2 py-0.5 text-[12px] font-medium transition-colors",
                mode === m ? "border-accent-500 text-base-800" : "text-base-600 hover:text-base-700",
              )}
            >
              {m === "items" ? "Items" : "Layers"}
            </button>
          ))}
        </div>
        <IconButton
          icon={<Plus size={14} strokeWidth={1.75} />}
          title={mode === "layers" ? "Add layer" : "New document"}
          disabled={mode === "layers" && docId === ""}
          size="sm"
          onClick={addLayerOrDoc}
          className="hover:bg-base-200"
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-base-200 bg-base-50 shadow-lg transition-all duration-300 hover:shadow-xl">
        <div className="flex min-h-0 w-[240px] shrink-0 flex-col border-r border-base-200 bg-base-50 transition-all duration-300 hover:bg-base-100">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-base-200 bg-base-100 px-3 transition-all duration-300">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
            <span className="text-[11.5px] font-medium text-base-700">Documents</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto transition-all duration-300">
            <div className="w-full space-y-0.5 py-1 transition-all duration-300">
              {documents.map((d) => (
                <DocumentRow key={d.id} doc={d} active={overview?.active === d.id} />
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden transition-all duration-300">
          {mode === "items" ? (
            <div className="mt-3 flex min-h-0 flex-col transition-all duration-300">
              <SectionLabel>Items</SectionLabel>
              {!scene || scene.entities.length === 0 ? (
                <div className="px-2 text-[12px] text-base-500">
                  Nothing here yet. Pick a tool and click in the viewport.
                </div>
              ) : (
                grouped.map((group) => (
                  <div key={group.category} className="transition-all duration-300">
                    <div className="mt-2.5 flex items-baseline justify-between px-2 pb-0.5 first:mt-0 transition-all duration-300">
                      <span className="text-[11px] font-medium text-base-500 transition-all duration-300">
                        {CATEGORY_LABELS[group.category]}
                      </span>
                      <span className="text-[10px] tabular-nums text-base-500/70 transition-all duration-300">
                        {group.entities.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-1 transition-all duration-300">
                      {group.entities.map((entity) => (
                        <EntityRow key={entity.id} entity={entity} docId={docId} scene={scene} />
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="mt-3 flex min-h-0 flex-col transition-all duration-300">
              <SectionLabel>Layers</SectionLabel>
              {!scene || scene.layers.length === 0 ? (
                <div className="px-2 text-[12px] text-base-500">No layers.</div>
              ) : (
                <div className="flex flex-col gap-1 transition-all duration-300">
                  {scene.layers.map((layer) => (
                    <LayerRow
                      key={layer.id}
                      layer={layer}
                      docId={docId}
                      active={scene.activeLayer === layer.id}
                      count={scene.entities.filter((e) => e.layer === layer.id).length}
                      canDelete={scene.layers.length > 1}
                      onRename={(name) => void ipc.renameLayer(docId, layer.id, name).catch(() => undefined)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
