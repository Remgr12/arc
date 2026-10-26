import { useEffect, useState } from "react";
import { Download, RefreshCw, BrickWall, DoorOpen, Layers, Table } from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { Button, Modal, cn } from "./ui";
import type { BuildingSchedule } from "../lib/types";

export function BuildingScheduleDialog() {
  const open = useArcStore((s) => s.buildingScheduleOpen);
  const setOpen = useArcStore((s) => s.setBuildingScheduleOpen);
  const overview = useArcStore((s) => s.overview);
  const sceneVersion = useArcStore((s) => s.sceneVersion);

  const [schedule, setSchedule] = useState<BuildingSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"summary" | "walls" | "openings" | "rooms">("summary");

  const docId = overview?.active;

  const loadSchedule = async () => {
    if (!docId) return;
    setLoading(true);
    try {
      const data = await ipc.getBuildingSchedule(docId);
      setSchedule(data);
    } catch (e) {
      console.error("Failed to load building schedule", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open && docId) {
      void loadSchedule();
    }
  }, [open, docId, sceneVersion]);

  const exportCsv = () => {
    if (!schedule) return;
    let csv = "Category,Name/Mark,Detail,Quantity\n";
    csv += `Walls,Total Walls,${schedule.totalWallLengthM.toFixed(2)} m,${schedule.wallCount}\n`;
    csv += `Walls,Surface Area,${schedule.totalWallAreaM2.toFixed(2)} m²,${schedule.wallCount}\n`;
    csv += `Floors,Floor Plate Area,${schedule.floorAreaM2.toFixed(2)} m²,1\n`;

    for (const d of schedule.doors) {
      csv += `Doors,${d.name},${d.widthCm}x${d.heightCm} cm,1\n`;
    }
    for (const w of schedule.windows) {
      csv += `Windows,${w.name},${w.widthCm}x${w.heightCm} cm,1\n`;
    }
    for (const r of schedule.rooms) {
      csv += `Rooms,${r.name} (${r.number}),${r.areaM2.toFixed(2)} m²,1\n`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `Schedule_${overview?.active ?? "model"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Building Schedule"
      width="w-[780px]"
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {/* Navigation Tabs */}
        <div className="flex items-center justify-between border-b border-base-200 pb-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setActiveTab("summary")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "summary"
                  ? "bg-accent-500/15 text-accent-500 font-semibold"
                  : "text-base-600 hover:bg-base-200",
              )}
            >
              <Table size={13} />
              <span>Summary</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("walls")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "walls"
                  ? "bg-accent-500/15 text-accent-500 font-semibold"
                  : "text-base-600 hover:bg-base-200",
              )}
            >
              <BrickWall size={13} />
              <span>Walls & Slabs</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("openings")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "openings"
                  ? "bg-accent-500/15 text-accent-500 font-semibold"
                  : "text-base-600 hover:bg-base-200",
              )}
            >
              <DoorOpen size={13} />
              <span>Doors & Windows</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("rooms")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "rooms"
                  ? "bg-accent-500/15 text-accent-500 font-semibold"
                  : "text-base-600 hover:bg-base-200",
              )}
            >
              <Layers size={13} />
              <span>Rooms & Areas</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void loadSchedule()} disabled={loading}>
              <RefreshCw size={13} className={cn(loading && "animate-spin")} />
              Refresh
            </Button>
            <Button variant="default" onClick={exportCsv} disabled={!schedule}>
              <Download size={13} />
              Export CSV
            </Button>
          </div>
        </div>

        {/* Content */}
        {loading && !schedule ? (
          <div className="py-12 text-center text-base-500">Calculating building quantities...</div>
        ) : !schedule ? (
          <div className="py-12 text-center text-base-500">No architectural data found in current document.</div>
        ) : (
          <div className="max-h-[460px] overflow-y-auto pr-1">
            {activeTab === "summary" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-base-200 bg-base-50/50 p-3.5">
                  <div className="flex items-center gap-2 text-base-500">
                    <BrickWall size={16} className="text-amber-500" />
                    <span className="font-semibold text-base-700">Walls</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-base-900">
                    {schedule.totalWallLengthM.toFixed(1)} <span className="text-xs font-normal text-base-500">m length</span>
                  </div>
                  <div className="mt-1 text-xs text-base-500">
                    {schedule.wallCount} wall segments · {schedule.totalWallAreaM2.toFixed(1)} m² surface
                  </div>
                </div>

                <div className="rounded-lg border border-base-200 bg-base-50/50 p-3.5">
                  <div className="flex items-center gap-2 text-base-500">
                    <Layers size={16} className="text-blue-500" />
                    <span className="font-semibold text-base-700">Floors & Roofs</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-base-900">
                    {schedule.floorAreaM2.toFixed(1)} <span className="text-xs font-normal text-base-500">m² floor area</span>
                  </div>
                  <div className="mt-1 text-xs text-base-500">
                    {schedule.roofCount} roofs · {schedule.columnCount} columns · {schedule.beamCount} beams
                  </div>
                </div>

                <div className="rounded-lg border border-base-200 bg-base-50/50 p-3.5">
                  <div className="flex items-center gap-2 text-base-500">
                    <DoorOpen size={16} className="text-emerald-500" />
                    <span className="font-semibold text-base-700">Openings</span>
                  </div>
                  <div className="mt-2 text-2xl font-bold tracking-tight text-base-900">
                    {schedule.doorCount + schedule.windowCount} <span className="text-xs font-normal text-base-500">openings</span>
                  </div>
                  <div className="mt-1 text-xs text-base-500">
                    {schedule.doorCount} doors · {schedule.windowCount} windows
                  </div>
                </div>

                <div className="col-span-3 rounded-lg border border-base-200 bg-base-50/50 p-4">
                  <h4 className="font-semibold text-base-800">Model Quantities Overview</h4>
                  <div className="mt-3 grid grid-cols-4 gap-4 text-xs">
                    <div>
                      <span className="text-base-500">Total BIM Elements:</span>
                      <p className="font-semibold text-base-800">{schedule.totalElements}</p>
                    </div>
                    <div>
                      <span className="text-base-500">Rooms Defined:</span>
                      <p className="font-semibold text-base-800">{schedule.roomCount}</p>
                    </div>
                    <div>
                      <span className="text-base-500">Staircases:</span>
                      <p className="font-semibold text-base-800">{schedule.stairCount}</p>
                    </div>
                    <div>
                      <span className="text-base-500">Furniture & Fixtures:</span>
                      <p className="font-semibold text-base-800">{schedule.furnitureCount}</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "walls" && (
              <div className="flex flex-col gap-3">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-base-200 font-semibold text-base-600">
                    <tr>
                      <th className="py-2">Item</th>
                      <th className="py-2">Count</th>
                      <th className="py-2">Total Length</th>
                      <th className="py-2">Total Surface Area</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-100 text-base-700">
                    <tr>
                      <td className="py-2.5 font-medium">Standard Structural Walls</td>
                      <td className="py-2.5">{schedule.wallCount}</td>
                      <td className="py-2.5">{schedule.totalWallLengthM.toFixed(2)} m</td>
                      <td className="py-2.5">{schedule.totalWallAreaM2.toFixed(2)} m²</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 font-medium">Floor Plates / Slabs</td>
                      <td className="py-2.5">1</td>
                      <td className="py-2.5">-</td>
                      <td className="py-2.5">{schedule.floorAreaM2.toFixed(2)} m²</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "openings" && (
              <div className="flex flex-col gap-4">
                <div>
                  <h4 className="font-semibold text-base-800">Doors ({schedule.doors.length})</h4>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="border-b border-base-200 font-semibold text-base-600">
                      <tr>
                        <th className="py-1.5">Mark / Name</th>
                        <th className="py-1.5">Width</th>
                        <th className="py-1.5">Height</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-100 text-base-700">
                      {schedule.doors.map((d, i) => (
                        <tr key={i}>
                          <td className="py-2 font-medium">{d.name}</td>
                          <td className="py-2">{d.widthCm} cm</td>
                          <td className="py-2">{d.heightCm} cm</td>
                        </tr>
                      ))}
                      {schedule.doors.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-3 text-center text-base-400">
                            No doors placed in model
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div>
                  <h4 className="font-semibold text-base-800">Windows ({schedule.windows.length})</h4>
                  <table className="mt-2 w-full text-left text-xs">
                    <thead className="border-b border-base-200 font-semibold text-base-600">
                      <tr>
                        <th className="py-1.5">Mark / Name</th>
                        <th className="py-1.5">Width</th>
                        <th className="py-1.5">Height</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-base-100 text-base-700">
                      {schedule.windows.map((w, i) => (
                        <tr key={i}>
                          <td className="py-2 font-medium">{w.name}</td>
                          <td className="py-2">{w.widthCm} cm</td>
                          <td className="py-2">{w.heightCm} cm</td>
                        </tr>
                      ))}
                      {schedule.windows.length === 0 && (
                        <tr>
                          <td colSpan={3} className="py-3 text-center text-base-400">
                            No windows placed in model
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "rooms" && (
              <div>
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-base-200 font-semibold text-base-600">
                    <tr>
                      <th className="py-2">Number</th>
                      <th className="py-2">Room Name</th>
                      <th className="py-2">Calculated Floor Area</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-100 text-base-700">
                    {schedule.rooms.map((r, i) => (
                      <tr key={i}>
                        <td className="py-2.5 font-mono text-base-500">{r.number}</td>
                        <td className="py-2.5 font-medium">{r.name}</td>
                        <td className="py-2.5 font-semibold text-base-900">{r.areaM2.toFixed(2)} m²</td>
                      </tr>
                    ))}
                    {schedule.rooms.length === 0 && (
                      <tr>
                        <td colSpan={3} className="py-6 text-center text-base-400">
                          No rooms defined yet. Use the Room tool to tag spaces.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end border-t border-base-200 pt-3">
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
