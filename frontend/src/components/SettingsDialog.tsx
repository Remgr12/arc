import { RefreshCw } from "lucide-react";
import { actions } from "../lib/actions";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { Button, Checkbox, Modal, Row, SelectField, TextField } from "./ui";
import type { Settings } from "../lib/types";
import { Logo } from "./Logo";

export function SettingsDialog() {
  const open = useArcStore((s) => s.settingsOpen);
  const settings = useArcStore((s) => s.settings);
  const plugins = useArcStore((s) => s.pluginsList);

  if (!open) return null;

  const patch = (updates: Partial<Settings>) => {
    if (!settings) return;
    void ipc
      .setSettings({ ...settings, ...updates })
      .then((next) => useArcStore.getState().updateSettings(next))
      .catch(() => undefined);
  };

  return (
    <Modal
      open={open}
      onClose={() => useArcStore.getState().setSettingsOpen(false)}
      title="Settings"
    >
      <div className="flex flex-col gap-1">
        {!settings ? (
          <div className="text-[12px] text-base-500">Loading…</div>
        ) : (
          <>
            <Row label="Units">
              <SelectField
                value={settings.units}
                options={[
                  { value: "metric", label: "Metric (cm)" },
                  { value: "imperial", label: "Imperial (in)" },
                ]}
                onChange={(units) => patch({ units })}
              />
            </Row>
            <Row label="Grid size">
              <TextField
                mono
                value={String(settings.grid_size)}
                onCommit={(text) => {
                  const value = parseFloat(text);
                  if (Number.isFinite(value) && value > 0) patch({ grid_size: value });
                }}
              />
            </Row>
            <Row label="Snapping">
              <Checkbox
                checked={settings.snap_enabled}
                onChange={(snap_enabled) => patch({ snap_enabled })}
                label="Snap to grid"
              />
            </Row>
            <Row label="Grid">
              <Checkbox
                checked={settings.show_grid}
                onChange={(show_grid) => patch({ show_grid })}
                label="Show grid"
              />
            </Row>
            <Row label="Axes">
              <Checkbox
                checked={settings.show_axes}
                onChange={(show_axes) => patch({ show_axes })}
                label="Show axes"
              />
            </Row>

            <div className="mt-3 mb-1 flex items-center justify-between border-t border-base-300 pt-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-base-500">
                Plugins
              </span>
              <Button variant="ghost" onClick={() => void actions.reloadPlugins()}>
                <RefreshCw size={12} /> Reload
              </Button>
            </div>
            {plugins.length === 0 ? (
              <div className="text-[12px] text-base-500">
                No plugins found in the plugin directories.
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {plugins.map((plugin) => (
                  <div
                    key={plugin.name}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[12.5px] text-base-700 hover:bg-base-200"
                    title={plugin.error ?? plugin.path}
                  >
                    <input
                      type="checkbox"
                      checked={plugin.enabled}
                      onChange={(e) =>
                        void ipc
                          .setPluginEnabled(plugin.name, e.target.checked)
                          .catch(() => undefined)
                      }
                      className="h-3.5 w-3.5 cursor-pointer appearance-none rounded-sm border border-base-500 checked:border-accent-600 checked:bg-accent-600"
                    />
                    <span className="flex-1 truncate">{plugin.name}</span>
                    <span
                      className={`text-[10px] ${plugin.ok ? "text-emerald-500" : "text-red-400"}`}
                    >
                      {plugin.ok ? "ok" : "error"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
      <div className="mt-4 flex items-center gap-2.5 border-t border-base-300 pt-3">
        <Logo size={16} />
        <div className="flex flex-col leading-tight">
          <span className="text-[11px] font-semibold text-base-700">arc</span>
          <span className="text-[10px] text-base-500">
            dual-licensed under MIT OR Apache-2.0
          </span>
        </div>
        <a
          href="https://remgr12.github.io/arc/"
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-[10px] text-base-500 underline-offset-2 hover:text-base-300 hover:underline"
        >
          website
        </a>
      </div>
    </Modal>
  );
}
