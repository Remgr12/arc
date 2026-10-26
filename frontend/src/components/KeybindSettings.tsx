import { useEffect, useState } from "react";
import { Plus, RotateCcw, Trash2, X } from "lucide-react";
import {
  type Binding,
  ACTION_DEFS,
  ACTION_GROUPS,
  eventBinding,
  formatBinding,
  useKeybindStore,
} from "../lib/keybindProfiles";
import { uiCapture } from "../lib/uiCapture";
import { cn } from "./ui";

// --------------------------------------------------------------------------
// Keyboard section of the settings dialog: switch between profiles, create
// and manage custom ones, and edit every binding by capturing keystrokes.
// --------------------------------------------------------------------------

export function KeybindSettings() {
  const profiles = useKeybindStore((s) => s.profiles);
  const activeId = useKeybindStore((s) => s.activeId);
  const setActive = useKeybindStore((s) => s.setActive);
  const create = useKeybindStore((s) => s.create);
  const rename = useKeybindStore((s) => s.rename);
  const remove = useKeybindStore((s) => s.remove);
  const reset = useKeybindStore((s) => s.reset);
  const [capturing, setCapturing] = useState<{ action: string; replacing?: Binding } | null>(null);

  const profile = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const editable = !profile.builtin;

  const commit = (binding: Binding | null) => {
    if (binding && capturing) {
      useKeybindStore
        .getState()
        .setBinding(profile.id, capturing.action, binding, capturing.replacing);
    }
    setCapturing(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={activeId}
          onChange={(e) => setActive(e.target.value)}
          className="min-w-0 flex-1 rounded-md border border-base-400 bg-base-100 px-2 py-1 text-[12.5px] text-base-800 outline-none focus:border-accent-600"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.builtin ? " (built-in)" : ""}
            </option>
          ))}
        </select>
        <button
          title="New profile"
          onClick={create}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base-600 transition-colors hover:bg-base-300 hover:text-base-800"
        >
          <Plus size={14} />
        </button>
        {editable && (
          <>
            <button
              title="Reset"
              onClick={() => reset(profile.id)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base-600 transition-colors hover:bg-base-300 hover:text-base-800"
            >
              <RotateCcw size={13} />
            </button>
            <button
              title="Delete"
              onClick={() => remove(profile.id)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-base-600 transition-colors hover:bg-base-300 hover:text-base-800"
            >
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>

      {editable ? (
        <ProfileNameField value={profile.name} onCommit={(name) => rename(profile.id, name)} />
      ) : (
        <div className="text-[11px] text-base-500">
          The Classic profile is read-only. Create a profile to make custom bindings.
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {ACTION_GROUPS.map((group: (typeof ACTION_GROUPS)[number]) => (
          <div key={group} className="mb-2">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-base-500">
              {group}
            </div>
            <div className="flex flex-col gap-0.5">
              {ACTION_DEFS.filter((d) => d.group === group).map((def) => {
                const isCapturing = capturing?.action === def.id;
                return (
                  <div
                    key={def.id}
                    className={cn(
                      "flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] hover:bg-base-200",
                      isCapturing && "bg-base-200",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-base-700">{def.label}</span>
                    {isCapturing && editable ? (
                      <CaptureRow onCommit={commit} onCancel={() => setCapturing(null)} />
                    ) : (
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        {(profile.bindings[def.id] ?? []).map((binding) => (
                          <span
                            key={binding}
                            className="group/chip flex items-center gap-1 rounded border border-base-400 bg-base-100 px-1.5 py-0.5 font-mono text-[10.5px] text-base-700"
                          >
                            <button
                              disabled={!editable}
                              title={
                                editable
                                  ? `Click to rebind (now ${formatBinding(binding)})`
                                  : "The built-in profile is read-only"
                              }
                              onClick={
                                editable ? () => setCapturing({ action: def.id, replacing: binding }) : undefined
                              }
                              className={cn(editable && "cursor-pointer hover:text-base-900")}
                            >
                              {formatBinding(binding)}
                            </button>
                            {editable && (
                              <button
                                title="Remove"
                                onClick={() =>
                                  useKeybindStore.getState().clearBinding(profile.id, def.id, binding)
                                }
                                className="text-base-500 opacity-0 transition-opacity hover:text-base-900 group-hover/chip:opacity-100"
                              >
                                <X size={11} />
                              </button>
                            )}
                          </span>
                        ))}
                        {editable && (
                          <button
                            title="Add"
                            onClick={() => setCapturing({ action: def.id })}
                            className="flex items-center rounded border border-dashed border-base-400 px-1.5 py-0.5 text-[10.5px] text-base-500 hover:border-accent-600 hover:text-accent-500"
                          >
                            <Plus size={11} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileNameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      value={text}
      spellCheck={false}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          onCommit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        }
        e.stopPropagation();
      }}
      className="w-full rounded-md border border-base-400 bg-base-100 px-2 py-1 text-[12.5px] text-base-800 outline-none focus:border-accent-600"
    />
  );
}

function CaptureRow({
  onCommit,
  onCancel,
}: {
  onCommit: (binding: Binding | null) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    uiCapture.active = true;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        onCancel();
        return;
      }
      const binding = eventBinding(e);
      if (!binding) return; // bare modifier: keep listening
      e.preventDefault();
      e.stopImmediatePropagation();
      onCommit(binding);
    };
    window.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      uiCapture.active = false;
    };
  }, [onCancel, onCommit]);

  return (
    <span className="flex items-center gap-2 rounded border border-accent-600 px-2 py-0.5 font-mono text-[10.5px] text-base-700">
      Press keys…
      <span className="font-sans text-[10px] text-base-500">· Esc cancels</span>
      <button title="Cancel" onClick={onCancel} className="text-base-500 hover:text-base-900">
        <X size={11} />
      </button>
    </span>
  );
}
