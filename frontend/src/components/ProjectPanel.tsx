import { useState } from "react";
import { Eye, EyeOff, Layers, Lock, LockOpen, Plus, Trash2, X } from "lucide-react";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { Button, IconButton, Panel } from "./ui";

/** Left panel: open documents, entity outline, layers. */
export function ProjectPanel() {
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);
  const [tab, setTab] = useState<"scene" | "layers">("scene");
  const docId = overview?.active ?? "";

  const documentRow = (d: { id: string; name: string; dirty: boolean; path: string | null }) => {
    const active = overview?.active === d.id;
    return (
      <div
        key={d.id}
        className={`group flex h-7 items-center gap-1 rounded-md px-1.5 text-[12.5px] ${
          active ? "bg-base-200 text-base-800" : "text-base-600 hover:bg-base-200"
        }`}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => actions.switchDocument(d.id)}
        >
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? "bg-accent-500" : "bg-base-400"}`} />
          <span className="truncate">{d.name}</span>
          {d.dirty && <span className="shrink-0 text-[10px] text-accent-500">•</span>}
        </button>
        <IconButton
          icon={<X size={12} />}
          title="Close document"
          className="opacity-0 group-hover:opacity-100"
          onClick={() => void ipc.closeDocument(d.id).catch(() => undefined)}
        />
      </div>
    );
  };

  return (
    <Panel
      title={tab === "scene" ? "Project" : "Layers"}
      className="border-b border-base-300"
      actions={
        <>
          <IconButton
            icon={<Layers size={13} />}
            title={tab === "scene" ? "Show layers" : "Show scene"}
            onClick={() => setTab(tab === "scene" ? "layers" : "scene")}
          />
          {tab === "layers" ? (
            <IconButton
              icon={<Plus size={13} />}
              title="Add layer"
              disabled={docId === ""}
              onClick={() => void actions.addLayer()}
            />
          ) : (
            <IconButton
              icon={<Plus size={13} />}
              title="New document"
              onClick={() => void actions.newDocument()}
            />
          )}
        </>
      }
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div>
          <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
            Documents
          </div>
          {(overview?.documents ?? []).length === 0 ? (
            <div className="px-1 text-[12px] text-base-500">No documents. Create one to start.</div>
          ) : (
            <div className="flex flex-col gap-0.5">{(overview?.documents ?? []).map(documentRow)}</div>
          )}
        </div>

        {tab === "scene" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
              Entities
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {!scene || scene.entities.length === 0 ? (
                <div className="px-1 text-[12px] text-base-500">
                  Nothing here yet. Pick a tool and click in the viewport.
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {scene.entities.map((entity) => {
                    const selected = scene.selection.includes(entity.id);
                    const layer = scene.layers.find((l) => l.id === entity.layer);
                    const hidden = !entity.visible || (layer ? !layer.visible : false);
                    return (
                      <div
                        key={entity.id}
                        className={`group flex h-6 items-center gap-1 rounded px-1.5 text-[12px] ${
                          scene.primary === entity.id
                            ? "bg-accent-600/20 text-base-800"
                            : selected
                              ? "bg-base-200 text-base-800"
                              : "text-base-600 hover:bg-base-200"
                        }`}
                      >
                        <button
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                          onClick={() => {
                            void ipc
                              .setSelection(docId, selected ? scene.selection : [entity.id], entity.id)
                              .catch(() => undefined);
                          }}
                          onDoubleClick={() => actions.focusEntity(entity.id)}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-sm"
                            style={{
                              backgroundColor: toCss(
                                entity.color ?? layer?.color ?? [0.62, 0.62, 0.65, 1],
                              ),
                            }}
                          />
                          <span className="truncate">{entity.name}</span>
                          {entity.locked && <Lock size={9} className="shrink-0 text-base-500" />}
                          {hidden && <EyeOff size={10} className="shrink-0 text-base-500" />}
                        </button>
                        <IconButton
                          icon={entity.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                          title={entity.visible ? "Hide" : "Show"}
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() =>
                            void ipc
                              .setEntityProps(docId, entity.id, { visible: !entity.visible })
                              .catch(() => undefined)
                          }
                        />
                        <IconButton
                          icon={entity.locked ? <Lock size={11} /> : <LockOpen size={11} />}
                          title={entity.locked ? "Unlock" : "Lock"}
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() =>
                            void ipc
                              .setEntityProps(docId, entity.id, { locked: !entity.locked })
                              .catch(() => undefined)
                          }
                        />
                        <IconButton
                          icon={<Trash2 size={11} />}
                          title="Delete"
                          className="opacity-0 group-hover:opacity-100"
                          onClick={() => void ipc.deleteEntities(docId, [entity.id]).catch(() => undefined)}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <LayersBody />
        )}
      </div>
    </Panel>
  );
}

function LayersBody() {
  const docId = useArcStore((s) => s.overview?.active ?? "");
  const scene = useArcStore((s) => s.scene);
  const layers = scene?.layers ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
        Layers
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {layers.map((layer) => {
          const active = scene?.activeLayer === layer.id;
          const count = scene?.entities.filter((e) => e.layer === layer.id).length ?? 0;
          return (
            <div
              key={layer.id}
              className={`group flex h-7 items-center gap-1 rounded px-1.5 text-[12px] ${
                active ? "bg-base-200 text-base-800" : "text-base-600 hover:bg-base-200"
              }`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                title="Set active layer"
                onClick={() => void ipc.setActiveLayer(docId, layer.id).catch(() => undefined)}
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
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded border border-base-400"
                />
                <span className="truncate">{layer.name}</span>
                <span className="shrink-0 text-[10px] text-base-500">{count}</span>
              </button>
              <IconButton
                icon={layer.visible ? <Eye size={12} /> : <EyeOff size={12} />}
                title={layer.visible ? "Hide layer" : "Show layer"}
                onClick={() =>
                  void ipc.setLayerVisible(docId, layer.id, !layer.visible).catch(() => undefined)
                }
              />
              <IconButton
                icon={layer.locked ? <Lock size={12} /> : <LockOpen size={12} />}
                title={layer.locked ? "Unlock layer" : "Lock layer"}
                onClick={() =>
                  void ipc.setLayerLocked(docId, layer.id, !layer.locked).catch(() => undefined)
                }
              />
              {layers.length > 1 && (
                <IconButton
                  icon={<Trash2 size={12} />}
                  title="Delete layer"
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => void ipc.deleteLayer(docId, layer.id).catch(() => undefined)}
                />
              )}
            </div>
          );
        })}
        {layers.length === 0 && (
          <div className="px-1 text-[12px] text-base-500">No layers.</div>
        )}
      </div>
      <Button className="mt-2" onClick={() => void actions.addLayer()}>
        <Plus size={13} /> Add layer
      </Button>
    </div>
  );
}

function toCss(color: [number, number, number, number]): string {
  const hex = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`;
}
