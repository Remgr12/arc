import { useEffect, useRef, useState } from "react";
import { Check, Terminal, X } from "lucide-react";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { EXPORT_FORMATS, TOOL_BY_ID } from "../data/tools";
import { armExtrudeSelectedSketch } from "../tools/solid";
import type { ToolId } from "../lib/types";
import { cn } from "./ui";

const HISTORY_LIMIT = 50;
const commandHistory: string[] = [];

interface CommandDef {
  name: string;
  desc: string;
  run: (args: string[]) => { message: string; ok: boolean; close?: boolean };
}

const COMMANDS: CommandDef[] = [
  // Creation / Construction
  { name: "box", desc: "Construct 3D box solid", run: () => { actions.setTool("box"); return { message: "Tool set to Box", ok: true, close: true }; } },
  { name: "cylinder", desc: "Construct 3D cylinder solid", run: () => { actions.setTool("cylinder"); return { message: "Tool set to Cylinder", ok: true, close: true }; } },
  { name: "sphere", desc: "Construct 3D sphere solid", run: () => { actions.setTool("sphere"); return { message: "Tool set to Sphere", ok: true, close: true }; } },
  { name: "cone", desc: "Construct 3D cone solid", run: () => { actions.setTool("cone"); return { message: "Tool set to Cone", ok: true, close: true }; } },
  { name: "torus", desc: "Construct 3D torus solid", run: () => { actions.setTool("torus"); return { message: "Tool set to Torus", ok: true, close: true }; } },
  { name: "plane", desc: "Insert reference plane", run: () => { actions.setTool("plane"); return { message: "Tool set to Plane", ok: true, close: true }; } },
  { name: "wall", desc: "Draw architectural wall", run: () => { actions.setTool("wall"); return { message: "Tool set to Wall", ok: true, close: true }; } },

  // 2D Sketch Tools
  { name: "sketch", desc: "Enter 2D sketch mode", run: () => { useArcStore.getState().enterSketchMode({ tool: "line" }); return { message: "Entered Sketch Mode", ok: true, close: true }; } },
  { name: "line", desc: "Draw 2D sketch line", run: () => { actions.setTool("line"); return { message: "Tool set to Line", ok: true, close: true }; } },
  { name: "arc", desc: "Draw 2D sketch arc", run: () => { actions.setTool("arc"); return { message: "Tool set to Arc", ok: true, close: true }; } },
  { name: "polyline", desc: "Draw 2D connected polyline", run: () => { actions.setTool("polyline"); return { message: "Tool set to Polyline", ok: true, close: true }; } },
  { name: "rectangle", desc: "Draw 2D sketch rectangle", run: () => { actions.setTool("rectangle"); return { message: "Tool set to Rectangle", ok: true, close: true }; } },
  { name: "circle", desc: "Draw 2D sketch circle", run: () => { actions.setTool("circle"); return { message: "Tool set to Circle", ok: true, close: true }; } },
  { name: "polygon", desc: "Draw 2D sketch polygon", run: () => { actions.setTool("polygon"); return { message: "Tool set to Polygon", ok: true, close: true }; } },
  { name: "offset", desc: "Offset curve or face", run: () => { actions.setTool("offset"); return { message: "Tool set to Offset", ok: true, close: true }; } },
  { name: "trim", desc: "Trim sketch curves", run: () => { actions.setTool("trim"); return { message: "Tool set to Trim", ok: true, close: true }; } },
  { name: "mirror", desc: "Mirror sketch curves", run: () => { actions.setTool("mirror"); return { message: "Tool set to Mirror", ok: true, close: true }; } },

  // 3D Modeling Tools
  {
    name: "extrude",
    desc: "Extrude selected sketch or face",
    run: () => {
      armExtrudeSelectedSketch();
      actions.setTool("extrude");
      return { message: "Extrude tool active", ok: true, close: true };
    },
  },
  { name: "revolve", desc: "Revolve profile around axis", run: () => { actions.setTool("revolve"); return { message: "Tool set to Revolve", ok: true, close: true }; } },
  { name: "sweep", desc: "Sweep profile along path", run: () => { actions.setTool("sweep"); return { message: "Tool set to Sweep", ok: true, close: true }; } },
  { name: "loft", desc: "Loft between profiles", run: () => { actions.setTool("loft"); return { message: "Tool set to Loft", ok: true, close: true }; } },
  { name: "fillet", desc: "Round selected edge", run: () => { actions.setTool("fillet-edge"); return { message: "Tool set to Fillet", ok: true, close: true }; } },
  { name: "chamfer", desc: "Bevel selected edge 45°", run: () => { void actions.chamferSelectedEdge(2); return { message: "Chamfer applied (2 cm)", ok: true, close: true }; } },
  { name: "shell", desc: "Hollow solid body", run: () => { void actions.shellSelection(2); return { message: "Shell applied (2 cm wall)", ok: true, close: true }; } },

  // Transform & Measure
  { name: "select", desc: "Selection tool", run: (args) => { if (args[0] === "all") { void actions.selectAll(); return { message: "Selected all items", ok: true }; } actions.setTool("select"); return { message: "Tool set to Select", ok: true, close: true }; } },
  { name: "move", desc: "Move / Rotate transform tool", run: () => { actions.setTool("move"); return { message: "Tool set to Move", ok: true, close: true }; } },
  { name: "rotate", desc: "Rotate transform tool", run: () => { actions.setTool("rotate"); return { message: "Tool set to Rotate", ok: true, close: true }; } },
  { name: "scale", desc: "Scale transform tool", run: () => { actions.setTool("scale"); return { message: "Tool set to Scale", ok: true, close: true }; } },
  { name: "measure", desc: "Measure distance between points", run: () => { actions.setTool("dimension"); return { message: "Measure tool active", ok: true, close: true }; } },
  { name: "dimension", desc: "Dimension annotation", run: () => { actions.setTool("dimension"); return { message: "Dimension tool active", ok: true, close: true }; } },

  // CSG Booleans
  { name: "union", desc: "Combine selected solids (Boolean Union)", run: () => { void actions.booleanApply("union"); return { message: "Boolean Union applied", ok: true, close: true }; } },
  { name: "subtract", desc: "Cut selected solids (Boolean Difference)", run: () => { void actions.booleanApply("difference"); return { message: "Boolean Difference applied", ok: true, close: true }; } },
  { name: "intersect", desc: "Intersect selected solids", run: () => { void actions.booleanApply("intersection"); return { message: "Boolean Intersection applied", ok: true, close: true }; } },

  // Document & Edit Actions
  { name: "undo", desc: "Undo last change", run: () => { void actions.undo(); return { message: "Undone", ok: true }; } },
  { name: "redo", desc: "Redo last change", run: () => { void actions.redo(); return { message: "Redone", ok: true }; } },
  { name: "delete", desc: "Delete selected items", run: () => { void actions.deleteSelection(); return { message: "Deleted selection", ok: true }; } },
  { name: "duplicate", desc: "Duplicate selected items", run: () => { void actions.duplicateSelection(); return { message: "Duplicated selection", ok: true }; } },
  { name: "fit", desc: "Fit camera to view model", run: () => { actions.fitView(); return { message: "View fitted", ok: true, close: true }; } },
  { name: "save", desc: "Save active document", run: () => { void actions.saveActive(); return { message: "Document saved", ok: true }; } },
  { name: "new", desc: "Create new document", run: () => { void actions.newDocument(); return { message: "New document created", ok: true, close: true }; } },
  { name: "open", desc: "Open document from disk", run: () => { void actions.openDocument(); return { message: "Opening document…", ok: true, close: true }; } },
  { name: "import", desc: "Import 3D model", run: () => { void actions.importFile(); return { message: "Importing file…", ok: true, close: true }; } },
  {
    name: "export",
    desc: `Export model (${EXPORT_FORMATS.map((f) => f.id).join(", ")})`,
    run: (args) => {
      const fmt = args[0];
      if (fmt && EXPORT_FORMATS.some((f) => f.id === fmt)) {
        void actions.exportActive(fmt);
        return { message: `Exporting as ${fmt.toUpperCase()}…`, ok: true, close: true };
      }
      return { message: `Usage: export ${EXPORT_FORMATS.map((f) => f.id).join(" | ")}`, ok: false };
    },
  },
  { name: "settings", desc: "Open settings dialog", run: () => { actions.openSettings(); return { message: "Opened Settings", ok: true, close: true }; } },
  {
    name: "fast",
    desc: "Toggle Fast performance mode",
    run: () => {
      const cur = useArcStore.getState().lowSpecMode;
      useArcStore.getState().setLowSpecMode(!cur);
      return { message: `Fast mode ${!cur ? "ON" : "OFF"}`, ok: true };
    },
  },
];

export function CommandLine() {
  const open = useArcStore((s) => s.commandLineOpen);
  const setOpen = useArcStore((s) => s.setCommandLineOpen);
  const [value, setValue] = useState("");
  const [feedback, setFeedback] = useState<{ message: string; ok: boolean } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef("");
  const historyIndexRef = useRef(-1);

  useEffect(() => {
    if (!open) return;
    setValue("");
    setFeedback(null);
    setSelectedIdx(0);
    draftRef.current = "";
    historyIndexRef.current = -1;
    inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const trimmed = value.trim().toLowerCase();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const query = tokens[0] ?? "";

  const matches = query
    ? COMMANDS.filter((c) => c.name.startsWith(query) || c.name.includes(query)).slice(0, 5)
    : [];

  const execute = (rawText: string) => {
    const raw = rawText.trim();
    if (!raw) return;

    if (commandHistory[commandHistory.length - 1] !== raw) {
      commandHistory.push(raw);
      if (commandHistory.length > HISTORY_LIMIT) {
        commandHistory.splice(0, commandHistory.length - HISTORY_LIMIT);
      }
    }

    const words = raw.toLowerCase().split(/\s+/).filter(Boolean);
    const cmd = words[0];
    const args = words.slice(1);

    const match = COMMANDS.find((c) => c.name === cmd);
    if (match) {
      const res = match.run(args);
      setFeedback({ message: res.message, ok: res.ok });
      if (res.close) {
        window.setTimeout(() => setOpen(false), 380);
      }
      return;
    }

    // Check if it's a tool ID in TOOL_BY_ID
    if (TOOL_BY_ID.has(cmd as ToolId)) {
      actions.setTool(cmd as ToolId);
      const def = TOOL_BY_ID.get(cmd as ToolId);
      setFeedback({ message: `Tool set to ${def?.label ?? cmd}`, ok: true });
      window.setTimeout(() => setOpen(false), 380);
      return;
    }

    setFeedback({ message: `Unknown command: "${cmd}". Try box, line, extrude, etc.`, ok: false });
  };

  const cycleHistory = (up: boolean) => {
    if (commandHistory.length === 0) return;
    const index = historyIndexRef.current;
    if (up) {
      if (index === -1) draftRef.current = value;
      const next = index === -1 ? commandHistory.length - 1 : Math.max(0, index - 1);
      historyIndexRef.current = next;
      setValue(commandHistory[next]);
      return;
    }
    if (index === -1) return;
    if (index + 1 >= commandHistory.length) {
      historyIndexRef.current = -1;
      setValue(draftRef.current);
      return;
    }
    historyIndexRef.current = index + 1;
    setValue(commandHistory[index + 1]);
  };

  return (
    <div className="fixed bottom-10 left-1/2 z-40 flex w-[560px] -translate-x-1/2 flex-col rounded-xl border border-base-300 bg-base-100 shadow-2xl">
      <div className="flex h-11 w-full items-center gap-2 px-3 font-mono text-[13px]">
        <Terminal size={15} className="shrink-0 text-base-500" />
        <input
          ref={inputRef}
          type="text"
          spellCheck={false}
          value={value}
          placeholder="Type a tool or command"
          onChange={(e) => {
            setValue(e.target.value);
            setFeedback(null);
            setSelectedIdx(0);
            historyIndexRef.current = -1;
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (matches.length > 0 && selectedIdx >= 0 && selectedIdx < matches.length) {
                execute(matches[selectedIdx].name);
              } else {
                execute(value);
              }
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              if (matches.length > 0) {
                setSelectedIdx((i) => (i <= 0 ? matches.length - 1 : i - 1));
              } else {
                cycleHistory(true);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              if (matches.length > 0) {
                setSelectedIdx((i) => (i >= matches.length - 1 ? 0 : i + 1));
              } else {
                cycleHistory(false);
              }
            }
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className="flex-1 w-full min-w-0 bg-transparent text-base-800 outline-none placeholder:text-base-500"
        />
      </div>

      {/* Live Matching Suggestions */}
      {matches.length > 0 && !feedback && (
        <div className="flex flex-col border-t border-base-200/80 p-1.5 font-mono text-[12px]">
          {matches.map((m, idx) => (
            <button
              key={m.name}
              type="button"
              onClick={() => execute(m.name)}
              className={cn(
                "flex h-7 items-center justify-between rounded-lg px-2 text-left transition-colors",
                idx === selectedIdx
                  ? "bg-accent-500/15 text-accent-500 font-semibold"
                  : "text-base-700 hover:bg-base-200 hover:text-base-900",
              )}
            >
              <span className="font-semibold text-base-900">{m.name}</span>
              <span className="text-[11px] text-base-500">{m.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Execution feedback */}
      {feedback && (
        <div
          className={cn(
            "flex items-center gap-1.5 border-t px-3 py-1.5 font-mono text-[11.5px]",
            feedback.ok
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
              : "border-red-500/30 bg-red-500/10 text-red-400",
          )}
        >
          {feedback.ok ? <Check size={13} strokeWidth={2.5} /> : <X size={13} strokeWidth={2.5} />}
          <span>{feedback.message}</span>
        </div>
      )}
    </div>
  );
}
