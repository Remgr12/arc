import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, Modal } from "./ui";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";

const UNSUPPORTED =
  "Updates are handled by the package manager on this install type";

export function UpdateDialog() {
  const notice = useArcStore((s) => s.updateNotice);
  const [busy, setBusy] = useState(false);

  if (!notice?.available) return null;

  const installable = notice.installable;
  const dismiss = () => {
    if (notice.version) {
      useArcStore.getState().dismissUpdateNotice(notice.version);
    } else {
      useArcStore.getState().setUpdateNotice(null);
    }
  };

  const install = () => {
    setBusy(true);
    useArcStore
      .getState()
      .setStatusMessage("Downloading update — arc restarts once it is installed");
    ipc
      .installUpdate()
      .catch((error) => {
        useArcStore.getState().setStatusMessage(`Update failed: ${String(error)}`);
      })
      .finally(() => setBusy(false));
  };

  return (
    <Modal open onClose={() => !busy && dismiss()} title="Update available" width="w-[420px]">
      <div className="flex flex-col gap-3">
        <p className="text-[14px] font-semibold text-base-800">
          {notice.version ? `arc ${notice.version} is available` : "A new version is available"}
        </p>
        {notice.notes && notice.notes !== UNSUPPORTED && (
          <p className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-base-150 p-2 font-mono text-[11.5px] leading-relaxed text-base-700">
            {notice.notes}
          </p>
        )}
        <p className="text-[12.5px] leading-relaxed text-base-600">
          {installable
            ? "The new version downloads in the background and arc restarts afterwards."
            : "This installation is managed by the system package manager, so update it there."}
        </p>
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={dismiss} disabled={busy}>
            Later
          </Button>
          {installable && (
            <Button variant="primary" onClick={install} disabled={busy}>
              {busy ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
              {busy ? "Downloading…" : "Update now"}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
