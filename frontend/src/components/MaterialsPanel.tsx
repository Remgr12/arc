import { useEffect, type ReactNode } from "react";
import { Droplet, X } from "lucide-react";
import { ipc } from "../lib/ipc";
import { MATERIALS, materialColorCss } from "../lib/materials";
import { useArcStore } from "../lib/store";
import { Button, IconButton, Panel } from "./ui";

export const MATERIALS_TOGGLE_EVENT = "arc-materials-toggle";

export function MaterialsPanel() {
  const open = useArcStore((s) => s.materialsOpen);
  const setMaterialsOpen = useArcStore((s) => s.setMaterialsOpen);
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);

  useEffect(() => {
    const onToggle = (e: Event) => {
      const st = useArcStore.getState();
      const detail = (e as CustomEvent<boolean | undefined>).detail;
      st.setMaterialsOpen(typeof detail === "boolean" ? detail : !st.materialsOpen);
    };
    window.addEventListener(MATERIALS_TOGGLE_EVENT, onToggle);
    return () => window.removeEventListener(MATERIALS_TOGGLE_EVENT, onToggle);
  }, []);

  if (!open) return null;

  const docId = overview?.active ?? "";
  const selection = scene?.selection ?? [];

  const apply = (materialId: string | null, label: string) => {
    if (!docId) {
      useArcStore.getState().setStatusMessage("No active document");
      return;
    }
    if (selection.length === 0) {
      useArcStore.getState().setStatusMessage("Select an entity to apply a material");
      return;
    }
    for (const id of selection) {
      void ipc.setEntityMaterial(docId, id, materialId).catch(() => undefined);
    }
    useArcStore
      .getState()
      .setStatusMessage(
        materialId
          ? `Applied ${label} to ${selection.length} ${selection.length === 1 ? "entity" : "entities"}`
          : `Cleared material on ${selection.length} ${selection.length === 1 ? "entity" : "entities"}`,
      );
  };

  return (
    <Panel
      title="Materials"
      className="fixed right-[19rem] top-[52px] z-40 h-auto max-h-[min(70vh,560px)] w-60 rounded-md border border-base-300 shadow-xl"
      actions={
        <IconButton icon={<X size={14} />} title="Close" onClick={() => setMaterialsOpen(false)} />
      }
    >
      <div className="flex flex-col gap-0.5">
        {MATERIALS.map((m) => (
          <button
            key={m.id}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-base-200"
            onClick={() => apply(m.id, m.label)}
          >
            <span
              className="h-4 w-4 shrink-0 rounded-sm border border-black/20"
              style={{
                backgroundColor: materialColorCss(m.color),
                opacity: m.transparent ? 0.55 : 1,
              }}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[12.5px] text-base-800">{m.label}</span>
              <span className="block font-mono text-[10px] text-base-500">
                R {m.roughness.toFixed(2)} · M {m.metalness.toFixed(2)}
              </span>
            </span>
            {m.transparent && <Droplet size={12} className="shrink-0 text-base-500" />}
          </button>
        ))}
      </div>
      <Button variant="ghost" className="mt-2 w-full" onClick={() => apply(null, "")}>
        None / clear material
      </Button>
    </Panel>
  );
}

export function useMaterialsPanelMount(): ReactNode {
  return <MaterialsPanel />;
}
