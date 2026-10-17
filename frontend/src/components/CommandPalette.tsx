import { useEffect, useMemo, useState } from "react";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { TOOLS } from "../data/tools";
import { Modal, TextField } from "./ui";
import type { LucideIcon } from "lucide-react";

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  run: () => void;
  icon: LucideIcon | null;
}

export function CommandPalette() {
  const open = useArcStore((s) => s.paletteOpen);
  const overview = useArcStore((s) => s.overview);
  const [query, setQuery] = useState("");
  const setOpen = useArcStore((s) => s.setPaletteOpen);

  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const items = useMemo<PaletteItem[]>(() => {
    const list: PaletteItem[] = [];
    for (const tool of TOOLS) {
      list.push({
        id: `tool:${tool.id}`,
        label: tool.label,
        hint: "Tool",
        run: () => actions.setTool(tool.id),
        icon: tool.icon,
      });
    }
    for (const action of [
      { label: "New document", hint: "File", run: () => void actions.newDocument() },
      { label: "Open file…", hint: "File", run: () => actions.openDocument() },
      { label: "Save", hint: "File", run: () => void actions.saveActive() },
      { label: "Save As…", hint: "File", run: () => void actions.saveDocumentAs() },
      { label: "Export OBJ", hint: "File", run: () => void actions.exportActive("obj") },
      { label: "Export STL", hint: "File", run: () => void actions.exportActive("stl") },
      { label: "Undo", hint: "Edit", run: () => void actions.undo() },
      { label: "Redo", hint: "Edit", run: () => void actions.redo() },
      { label: "Duplicate selection", hint: "Edit", run: () => void actions.duplicateSelection() },
      { label: "Delete selection", hint: "Edit", run: () => void actions.deleteSelection() },
      { label: "Explode selection", hint: "Edit", run: () => void actions.explodeSelection() },
      { label: "Select all", hint: "Edit", run: () => void actions.selectAll() },
      { label: "Fit view", hint: "View", run: () => actions.fitView() },
      { label: "Add layer", hint: "Layers", run: () => void actions.addLayer() },
      { label: "Settings…", hint: "App", run: () => actions.openSettings() },
      { label: "Reload plugins", hint: "App", run: () => void actions.reloadPlugins() },
    ]) {
      list.push({ id: `action:${action.label}`, label: action.label, hint: action.hint, run: action.run, icon: null });
    }
    for (const doc of overview?.documents ?? []) {
      list.push({
        id: `doc:${doc.id}`,
        label: doc.name,
        hint: "Document",
        run: () => actions.switchDocument(doc.id),
        icon: null,
      });
    }
    return list;
  }, [overview]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items.slice(0, 12);
    return items
      .map((item) => ({ item, score: fuzzy(item.label.toLowerCase(), q) }))
      .filter((m) => m.score >= 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((m) => m.item);
  }, [items, query]);

  if (!open) return null;

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Command palette" width="w-[520px]">
      <div className="flex flex-col gap-2">
        <TextField
          value={query}
          onChange={setQuery}
          placeholder="Type a command…"
          className="text-[14px]"
        />
        <div className="flex flex-col">
          {filtered.map((item, index) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-base-700 hover:bg-base-200 ${
                  index === 0 ? "bg-base-200" : ""
                }`}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                {Icon ? <Icon size={14} /> : null}
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] uppercase tracking-wide text-base-500">{item.hint}</span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-2 py-4 text-center text-[12px] text-base-500">No matches.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Lightweight subsequence fuzz score; -1 means no match. */
function fuzzy(text: string, query: string): number {
  let ti = 0;
  let score = 0;
  let streak = 0;
  for (const char of query) {
    const found = text.indexOf(char, ti);
    if (found === -1) return -1;
    streak = found === ti ? streak + 2 : 1;
    score += streak;
    score -= found - ti > 0 ? 1 : 0;
    ti = found + 1;
  }
  return score;
}
