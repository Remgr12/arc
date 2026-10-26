import { useState } from "react";
import { Eye, EyeOff, FileText, Layers, Lock, LockOpen, Plus, Shapes, Trash2, X } from "lucide-react";
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
        "group flex h-8.5 items-center gap-2 rounded-lg px-3 transition-colors",
        active
          ? "bg-accent-500/15 text-base-900 border border-accent-500/30"
          : "text-base-700 hover:bg-base-200 hover:text-base-900",
      )}
    >
      <button
        type="button"
        title={doc.path ?? doc.name}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => actions.switchDocument(doc.id)}
      >
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            active ? "bg-accent-500 shadow-xs shadow-accent-500" : "bg-base-400",
          )}
        />
        <span
          className={cn(
            "truncate text-[12.5px]",
            active ? "font-semibold text-base-900" : "text-base-700",
          )}
        >
          {doc.name}
        </span>
        {doc.dirty && (
          <span className="shrink-0 rounded bg-accent-500/20 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-accent-400 leading-none">
            unsaved
          </span>
        )}
      </button>
      <IconButton
        icon={<X size={12} strokeWidth={2} />}
        title="Close"
        size="sm"
        className="h-6 w-6 opacity-0 group-hover:opacity-100"
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

  const handleSelect = (e: React.MouseEvent) => {
    useArcStore.getState().setSelectionRef(null);
    let next: string[];
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      next = selected
        ? scene.selection.filter((id) => id !== entity.id)
        : [...scene.selection, entity.id];
    } else {
      next = [entity.id];
    }
    const nextPrimary = next[next.length - 1] ?? null;
    void ipc.setSelection(docId, next, nextPrimary).catch(() => undefined);
  };

  const handleDelete = () => {
    const nextSel = scene.selection.filter((id) => id !== entity.id);
    const nextPrimary = nextSel[nextSel.length - 1] ?? null;
    void ipc
      .deleteEntities(docId, [entity.id])
      .then(() => {
        if (selected) {
          useArcStore.getState().setSelectionRef(null);
          return ipc.setSelection(docId, nextSel, nextPrimary);
        }
        return undefined;
      })
      .catch(() => undefined);
  };

  return (
    <div
      className={cn(
        "group flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors",
        primary
          ? "bg-accent-500/20 text-base-800"
          : selected
            ? "bg-base-200 text-base-800"
            : "text-base-600 hover:bg-base-200/70 hover:text-base-800",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={handleSelect}
        onDoubleClick={() => actions.focusEntity(entity.id)}
      >
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-sm border border-black/20"
          style={{ backgroundColor: toCss(entity.color ?? layer?.color ?? [0.62, 0.62, 0.65, 1]) }}
        />
        <span className={cn("truncate text-[12px]", selected && "font-medium")}>{entity.name}</span>
        <span className="ml-auto shrink-0 font-mono text-[10px] text-base-500 opacity-0 group-hover:opacity-100">
          {entity.kind}
        </span>
        {entity.locked && <Lock size={10} strokeWidth={1.75} className="shrink-0 text-base-500" />}
        {hidden && <EyeOff size={10} strokeWidth={1.75} className="shrink-0 text-base-500" />}
      </button>
      <IconButton
        icon={entity.visible ? <Eye size={11} strokeWidth={1.75} /> : <EyeOff size={11} strokeWidth={1.75} />}
        title={entity.visible ? "Hide" : "Show"}
        size="sm"
        className={cn("h-5 w-5", entity.visible ? "opacity-0 group-hover:opacity-100" : "opacity-80")}
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
        className={cn("h-5 w-5", entity.locked ? "opacity-80" : "opacity-0 group-hover:opacity-100")}
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
        className="h-5 w-5 opacity-0 hover:text-danger-500 group-hover:opacity-100"
        onClick={handleDelete}
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
        "group flex h-7 items-center gap-1.5 rounded-md px-2 transition-colors",
        active ? "bg-accent-500/15 text-base-800" : "hover:bg-base-200/70",
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
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          title="Active layer"
          onClick={() => void ipc.setActiveLayer(docId, layer.id).catch(() => undefined)}
          onDoubleClick={() => setEditing(true)}
        >
          <span className={cn("truncate text-[12px]", active ? "font-medium text-base-800" : "text-base-600")}>
            {layer.name}
          </span>
          <span className="ml-auto shrink-0 rounded bg-base-200 px-1.5 py-0.5 text-[10px] tabular-nums text-base-500">
            {count}
          </span>
        </button>
      )}
      <IconButton
        icon={layer.visible ? <Eye size={11} strokeWidth={1.75} /> : <EyeOff size={11} strokeWidth={1.75} />}
        title={layer.visible ? "Hide" : "Show"}
        size="sm"
        className={cn("h-5 w-5", layer.visible ? "opacity-0 group-hover:opacity-100" : "opacity-80")}
        onClick={() => void ipc.setLayerVisible(docId, layer.id, !layer.visible).catch(() => undefined)}
      />
      <IconButton
        icon={layer.locked ? <Lock size={11} strokeWidth={1.75} /> : <LockOpen size={11} strokeWidth={1.75} />}
        title={layer.locked ? "Unlock" : "Lock"}
        size="sm"
        className={cn("h-5 w-5", layer.locked ? "opacity-80" : "opacity-0 group-hover:opacity-100")}
        onClick={() => void ipc.setLayerLocked(docId, layer.id, !layer.locked).catch(() => undefined)}
      />
      {canDelete && (
        <IconButton
          icon={<Trash2 size={11} strokeWidth={1.75} />}
          title="Delete"
          size="sm"
          className="h-5 w-5 opacity-0 hover:text-danger-500 group-hover:opacity-100"
          onClick={() => void ipc.deleteLayer(docId, layer.id).catch(() => undefined)}
        />
      )}
    </div>
  );
}

/** Right panel: tabbed browser for scene Items, Layers, and Open Documents. */
export function ProjectPanel() {
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);
  const [mode, setMode] = useState<"items" | "layers" | "docs">("items");
  const docId = overview?.active ?? "";
  const documents = overview?.documents ?? [];

  const grouped = CATEGORIES.map((category) => ({
    category,
    entities: (scene?.entities ?? []).filter((e) => e.category === category),
  })).filter((g) => g.entities.length > 0);

  const itemCount = scene?.entities.length ?? 0;
  const layerCount = scene?.layers.length ?? 0;
  const docCount = documents.length;

  const handlePlus = () => {
    if (mode === "layers") {
      void actions.addLayer();
    } else if (mode === "docs") {
      void actions.newDocument();
    } else {
      useArcStore.getState().enterSketchMode({ tool: "line" });
    }
  };

  const plusTitle =
    mode === "layers" ? "Add layer" : mode === "docs" ? "New document" : "Start new sketch";

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-50">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-base-200 bg-base-100/80 px-2.5">
        <div className="flex items-center gap-1">
          {(
            [
              { id: "items", label: "Items", count: itemCount, icon: Shapes },
              { id: "layers", label: "Layers", count: layerCount, icon: Layers },
              { id: "docs", label: "Docs", count: docCount, icon: FileText },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = mode === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setMode(tab.id)}
                className={cn(
                  "flex h-7.5 items-center gap-1.5 rounded-md px-2.5 text-[11.5px] font-medium transition-colors",
                  active
                    ? "bg-base-200 text-base-800 shadow-xs"
                    : "text-base-600 hover:bg-base-200/50 hover:text-base-800",
                )}
              >
                <Icon size={12} strokeWidth={1.75} className={active ? "text-accent-500" : "text-base-500"} />
                <span>{tab.label}</span>
                <span className="shrink-0 rounded bg-base-300/60 px-1.5 py-0.2 text-[10px] tabular-nums text-base-600 leading-none">
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            icon={<Plus size={14} strokeWidth={1.75} />}
            title={plusTitle}
            disabled={mode === "layers" && docId === ""}
            size="sm"
            onClick={handlePlus}
            className="hover:bg-base-200"
          />
          <IconButton
            icon={<X size={13} strokeWidth={2} />}
            title="Hide"
            size="sm"
            onClick={() => useArcStore.getState().setLeftSidebarOpen(false)}
            className="hover:bg-base-200"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {mode === "items" && (
          <div className="flex flex-col gap-2">
            {!scene || scene.entities.length === 0 ? (
              <div className="rounded-lg border border-dashed border-base-300 px-3 py-6 text-center text-[12px] text-base-500">
                No items
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.category} className="flex flex-col gap-0.5">
                  <div className="flex items-baseline justify-between px-2 py-0.5">
                    <span className="text-[10.5px] font-semibold uppercase tracking-wider text-base-500">
                      {CATEGORY_LABELS[group.category]}
                    </span>
                    <span className="text-[10px] tabular-nums text-base-500">
                      {group.entities.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {group.entities.map((entity) => (
                      <EntityRow key={entity.id} entity={entity} docId={docId} scene={scene} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {mode === "layers" && (
          <div className="flex flex-col gap-0.5">
            {!scene || scene.layers.length === 0 ? (
              <div className="px-2 py-4 text-center text-[12px] text-base-500">No layers.</div>
            ) : (
              scene.layers.map((layer) => (
                <LayerRow
                  key={layer.id}
                  layer={layer}
                  docId={docId}
                  active={scene.activeLayer === layer.id}
                  count={scene.entities.filter((e) => e.layer === layer.id).length}
                  canDelete={scene.layers.length > 1}
                  onRename={(name) => void ipc.renameLayer(docId, layer.id, name).catch(() => undefined)}
                />
              ))
            )}
          </div>
        )}

        {mode === "docs" && (
          <div className="flex flex-col gap-0.5">
            {documents.length === 0 ? (
              <div className="px-2 py-4 text-center text-[12px] text-base-500">No open documents.</div>
            ) : (
              documents.map((d) => (
                <DocumentRow key={d.id} doc={d} active={overview?.active === d.id} />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
