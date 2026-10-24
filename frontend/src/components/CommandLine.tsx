import { useEffect, useRef, useState } from "react";
import { Terminal } from "lucide-react";
import { actions } from "../lib/actions";
import { useArcStore } from "../lib/store";
import { EXPORT_FORMATS, TOOL_BY_ID } from "../data/tools";
import type { ToolId } from "../lib/types";

/** Executed commands, oldest first; shared across opens, capped at HISTORY_LIMIT. */
const HISTORY_LIMIT = 50;
const commandHistory: string[] = [];

const HELP_TEXT =
  "Tools: select move rotate scale | line polyline rectangle circle arc polygon | " +
  "offset trim extend fillet mirror | extrude revolve sweep loft extrude-face offset-face fillet-edge | " +
  "box sphere cylinder cone torus plane | dimension wall | " +
  "Actions: undo redo delete duplicate fit union subtract intersect new save open import export help";

type RunResult = "close" | "clear" | "keep";

/** Parse and run one command line; returns what should happen to the input. */
function runCommand(raw: string): RunResult {
  const st = useArcStore.getState();
  const tokens = raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "clear";
  const [cmd, ...args] = tokens;

  if (TOOL_BY_ID.has(cmd as ToolId) && !(cmd === "select" && args[0] === "all")) {
    const tool = cmd as ToolId;
    const def = TOOL_BY_ID.get(tool);
    actions.setTool(tool);
    st.setStatusMessage(def ? `Tool: ${def.label} — ${def.tip}` : `Tool: ${tool}`);
    return "close";
  }

  switch (cmd) {
    case "select":
      if (args[0] === "all") {
        void actions.selectAll();
        return "clear";
      }
      break;
    case "sketch":
      st.enterSketchMode({ tool: "line" });
      return "close";
    case "undo":
      void actions.undo();
      return "clear";
    case "redo":
      void actions.redo();
      return "clear";
    case "delete":
      void actions.deleteSelection();
      return "clear";
    case "duplicate":
      void actions.duplicateSelection();
      return "clear";
    case "fit":
      actions.fitView();
      return "clear";
    case "union":
      void actions.booleanApply("union");
      return "clear";
    case "subtract":
      void actions.booleanApply("difference");
      return "clear";
    case "intersect":
      void actions.booleanApply("intersection");
      return "clear";
    case "new":
      void actions.newDocument();
      return "clear";
    case "save":
      void actions.saveActive();
      return "clear";
    case "open":
      void actions.openDocument();
      return "clear";
    case "import":
      void actions.importFile();
      return "clear";
    case "export": {
      const format = args[0];
      if (format && EXPORT_FORMATS.some((f) => f.id === format)) {
        void actions.exportActive(format);
        return "clear";
      }
      st.setStatusMessage(`Usage: export ${EXPORT_FORMATS.map((f) => f.id).join(" | ")}`);
      return "keep";
    }
    case "material": {
      const query = args.join(" ").trim();
      if (!query) {
        st.setStatusMessage("Usage: material <id or label>");
        return "keep";
      }
      void actions.applyMaterial(query);
      return "clear";
    }
    case "help":
      st.setStatusMessage(HELP_TEXT);
      return "clear";
    default:
      break;
  }
  st.setStatusMessage(`Unknown command: ${cmd} — try help`);
  return "keep";
}

export function CommandLine() {
  const open = useArcStore((s) => s.commandLineOpen);
  const setOpen = useArcStore((s) => s.setCommandLineOpen);
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef("");
  const historyIndexRef = useRef(-1);

  useEffect(() => {
    if (!open) return;
    setValue("");
    draftRef.current = "";
    historyIndexRef.current = -1;
    inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const commit = () => {
    const raw = value.trim();
    if (!raw) return;
    if (commandHistory[commandHistory.length - 1] !== raw) {
      commandHistory.push(raw);
      if (commandHistory.length > HISTORY_LIMIT) {
        commandHistory.splice(0, commandHistory.length - HISTORY_LIMIT);
      }
    }
    const result = runCommand(raw);
    historyIndexRef.current = -1;
    if (result === "close") setOpen(false);
    else if (result === "clear") setValue("");
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
    <div className="fixed bottom-10 left-1/2 z-40 flex w-[560px] -translate-x-1/2 items-center gap-2 rounded-lg border border-base-300 bg-base-100 px-3 py-2 font-mono text-[12.5px] shadow-2xl">
      <Terminal size={13} className="shrink-0 text-base-500" />
      <input
        ref={inputRef}
        type="text"
        spellCheck={false}
        value={value}
        placeholder="Type a tool or command — help lists them …"
        onChange={(e) => {
          setValue(e.target.value);
          historyIndexRef.current = -1;
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
          } else if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            cycleHistory(true);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            cycleHistory(false);
          }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        className="w-full min-w-0 bg-transparent text-base-800 outline-none placeholder:text-base-500"
      />
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-base-500">
        enter run · esc close
      </span>
    </div>
  );
}
