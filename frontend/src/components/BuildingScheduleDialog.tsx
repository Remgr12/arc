import { useEffect, useState, useMemo } from "react";
import {
  Download,
  RefreshCw,
  BrickWall,
  DoorOpen,
  Layers,
  Table,
  Search,
  Building,
  Columns,
  Footprints,
  PieChart,
} from "lucide-react";
import { useArcStore } from "../lib/store";
import { ipc } from "../lib/ipc";
import { Button, Modal, cn } from "./ui";
import type { BuildingSchedule } from "../lib/types";

export function BuildingScheduleDialog() {
  const open = useArcStore((s) => s.buildingScheduleOpen);
  const setOpen = useArcStore((s) => s.setBuildingScheduleOpen);
  const overview = useArcStore((s) => s.overview);
  const scene = useArcStore((s) => s.scene);
  const sceneVersion = useArcStore((s) => s.sceneVersion);
  const settings = useArcStore((s) => s.settings);

  const isDefaultImperial =
    settings?.units === "imperial" || settings?.units === "in" || settings?.units === "ft";
  const [isImperial, setIsImperial] = useState(isDefaultImperial);

  useEffect(() => {
    setIsImperial(isDefaultImperial);
  }, [isDefaultImperial]);

  const [schedule, setSchedule] = useState<BuildingSchedule | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "summary" | "walls" | "openings" | "rooms" | "structure"
  >("summary");
  const [searchQuery, setSearchQuery] = useState("");

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

  // Derive detailed entity records from the current scene for rich takeoffs
  const detailedData = useMemo(() => {
    if (!scene?.entities) return null;

    const walls: {
      id: string;
      name: string;
      lengthM: number;
      widthMm: number;
      heightM: number;
      areaM2: number;
      volumeM3: number;
      elevationM: number;
    }[] = [];

    const openings: {
      id: string;
      kind: "Door" | "Window";
      name: string;
      widthMm: number;
      heightMm: number;
      sillMm: number;
      areaM2: number;
      elevationM: number;
    }[] = [];

    const structures: {
      id: string;
      kind: "Column" | "Beam" | "Stair" | "Roof" | "Slab";
      name: string;
      desc: string;
      quantity: number;
    }[] = [];

    for (const e of scene.entities) {
      if (!e.visible) continue;
      const g = e.geometry as Record<string, unknown> | undefined;
      if (!g) continue;
      const elev = (e.transform?.position?.[1] ?? 0) / 100;

      if (e.kind === "wall" && Array.isArray(g.path)) {
        const path = g.path as [number, number][];
        let lenCm = 0;
        for (let i = 0; i < path.length - 1; i++) {
          lenCm += Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
        }
        const wCm = typeof g.width === "number" ? g.width : 20;
        const hCm = typeof g.height === "number" ? g.height : 300;
        const lenM = lenCm / 100;
        const areaM2 = (lenCm * hCm) / 10000;
        const volM3 = (lenCm * hCm * wCm) / 1000000;

        walls.push({
          id: e.id,
          name: e.name || "Wall",
          lengthM: lenM,
          widthMm: wCm * 10,
          heightM: hCm / 100,
          areaM2,
          volumeM3: volM3,
          elevationM: elev,
        });
      } else if (e.kind === "door") {
        const w = (typeof g.width === "number" ? g.width : 90) * 10;
        const h = (typeof g.height === "number" ? g.height : 210) * 10;
        openings.push({
          id: e.id,
          kind: "Door",
          name: e.name || "Door",
          widthMm: w,
          heightMm: h,
          sillMm: 0,
          areaM2: (w * h) / 1000000,
          elevationM: elev,
        });
      } else if (e.kind === "window") {
        const w = (typeof g.width === "number" ? g.width : 120) * 10;
        const h = (typeof g.height === "number" ? g.height : 150) * 10;
        openings.push({
          id: e.id,
          kind: "Window",
          name: e.name || "Window",
          widthMm: w,
          heightMm: h,
          sillMm: 900,
          areaM2: (w * h) / 1000000,
          elevationM: elev,
        });
      } else if (e.kind === "column") {
        structures.push({
          id: e.id,
          kind: "Column",
          name: e.name || "Column",
          desc: `Sides: ${g.sides ?? 4}, Radius: ${g.radius ?? 20}cm, H: ${g.height ?? 300}cm`,
          quantity: 1,
        });
      } else if (e.kind === "beam") {
        structures.push({
          id: e.id,
          kind: "Beam",
          name: e.name || "Beam",
          desc: `Length: ${((Number(g.length) || 100) / 100).toFixed(2)}m, W: ${g.width ?? 20}cm, H: ${g.height ?? 40}cm`,
          quantity: 1,
        });
      } else if (e.kind === "stair") {
        structures.push({
          id: e.id,
          kind: "Stair",
          name: e.name || "Staircase",
          desc: `${g.count ?? 16} risers, Rise: ${g.rise ?? 18}cm, Run: ${g.run ?? 28}cm`,
          quantity: 1,
        });
      } else if (e.kind === "roof") {
        structures.push({
          id: e.id,
          kind: "Roof",
          name: e.name || "Roof",
          desc: `Pitch: ${g.pitch_deg ?? 30}°, Footprint: ${((Number(g.width) || 100) / 100).toFixed(1)}×${((Number(g.depth) || 100) / 100).toFixed(1)}m`,
          quantity: 1,
        });
      } else if (e.kind === "slab") {
        structures.push({
          id: e.id,
          kind: "Slab",
          name: e.name || "Floor Slab",
          desc: `Thickness: ${g.height ?? 20}cm`,
          quantity: 1,
        });
      }
    }

    return { walls, openings, structures };
  }, [scene?.entities]);

  const totalWallVolumeM3 = useMemo(() => {
    return (detailedData?.walls ?? []).reduce((sum, w) => sum + w.volumeM3, 0);
  }, [detailedData]);

  const totalOpeningsAreaM2 = useMemo(() => {
    return (detailedData?.openings ?? []).reduce((sum, o) => sum + o.areaM2, 0);
  }, [detailedData]);

  const totalRoomAreaM2 = useMemo(() => {
    return (schedule?.rooms ?? []).reduce((sum, r) => sum + r.areaM2, 0);
  }, [schedule]);

  const exportCsv = () => {
    if (!schedule) return;
    let csv = "Category,Type/Mark,Width (mm),Height (mm),Length (m),Area (m²),Volume (m³),Level Elev (m)\n";

    // Walls
    for (const w of detailedData?.walls ?? []) {
      csv += `Wall,${w.name},${w.widthMm},${(w.heightM * 1000).toFixed(0)},${w.lengthM.toFixed(2)},${w.areaM2.toFixed(2)},${w.volumeM3.toFixed(3)},+${w.elevationM.toFixed(2)}\n`;
    }

    // Openings
    for (const o of detailedData?.openings ?? []) {
      csv += `${o.kind},${o.name},${o.widthMm},${o.heightMm},-,${o.areaM2.toFixed(2)},-,+${o.elevationM.toFixed(2)}\n`;
    }

    // Rooms
    for (const r of schedule.rooms) {
      csv += `Room,${r.name} (${r.number}),-,-,-,${r.areaM2.toFixed(2)},-,-\n`;
    }

    // Structure
    for (const s of detailedData?.structures ?? []) {
      csv += `${s.kind},${s.name},-,${s.desc},-,-,-,-\n`;
    }

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `BIM_Schedule_${overview?.active ?? "model"}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!open) return null;

  const filteredWalls = (detailedData?.walls ?? []).filter((w) =>
    w.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredOpenings = (detailedData?.openings ?? []).filter((o) =>
    o.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredRooms = (schedule?.rooms ?? []).filter(
    (r) =>
      r.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.number.toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const filteredStructures = (detailedData?.structures ?? []).filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.kind.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="BIM Building Schedule & Quantities"
      width="w-[880px]"
    >
      <div className="flex flex-col gap-4 text-[13px]">
        {/* Navigation Tabs & Search Bar */}
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
              <span>Walls ({detailedData?.walls.length ?? schedule?.wallCount ?? 0})</span>
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
              <span>Doors & Windows ({detailedData?.openings.length ?? ((schedule?.doorCount ?? 0) + (schedule?.windowCount ?? 0))})</span>
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
              <span>Rooms ({schedule?.rooms.length ?? 0})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("structure")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1 font-medium transition-colors cursor-pointer",
                activeTab === "structure"
                  ? "bg-accent-500/15 text-accent-500 font-semibold"
                  : "text-base-600 hover:bg-base-200",
              )}
            >
              <Columns size={13} />
              <span>Structure ({detailedData?.structures.length ?? 0})</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {/* Metric / Imperial Unit Selector */}
            <div className="flex items-center rounded-lg border border-base-300 bg-base-100 p-0.5">
              <button
                type="button"
                onClick={() => setIsImperial(false)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-semibold transition-colors cursor-pointer",
                  !isImperial ? "bg-accent-500 text-white shadow-2xs" : "text-base-600 hover:text-base-900",
                )}
              >
                Metric
              </button>
              <button
                type="button"
                onClick={() => setIsImperial(true)}
                className={cn(
                  "rounded px-2 py-0.5 text-xs font-semibold transition-colors cursor-pointer",
                  isImperial ? "bg-accent-500 text-white shadow-2xs" : "text-base-600 hover:text-base-900",
                )}
              >
                Imperial
              </button>
            </div>

            {activeTab !== "summary" && (
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-2 text-base-400" />
                <input
                  type="text"
                  placeholder="Filter elements…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-7 w-36 rounded-md border border-base-300 bg-base-50 pl-7 pr-2 text-xs text-base-800 placeholder-base-400 focus:w-48 focus:border-accent-500 focus:bg-base-100 transition-all outline-none"
                />
              </div>
            )}
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

        {/* Content Area */}
        {loading && !schedule ? (
          <div className="py-16 text-center text-base-500">
            <RefreshCw size={20} className="mx-auto mb-2 animate-spin text-accent-500" />
            Calculating BIM building quantities…
          </div>
        ) : !schedule ? (
          <div className="py-16 text-center text-base-500">
            No architectural BIM elements found in current document.
          </div>
        ) : (
          <div className="max-h-[500px] overflow-y-auto pr-1">
            {activeTab === "summary" && (
              <div className="flex flex-col gap-3.5">
                {/* Metric Cards Grid */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="rounded-lg border border-base-200 bg-base-50/60 p-3">
                    <div className="flex items-center justify-between text-base-500">
                      <span className="font-semibold text-xs text-base-600">Gross Floor Area</span>
                      <Building size={14} className="text-blue-500" />
                    </div>
                    <div className="mt-2 text-xl font-bold tracking-tight text-base-900">
                      {isImperial
                        ? (Math.max(schedule.floorAreaM2, totalRoomAreaM2) * 10.7639).toFixed(1)
                        : Math.max(schedule.floorAreaM2, totalRoomAreaM2).toFixed(1)}{" "}
                      <span className="text-xs font-normal text-base-500">
                        {isImperial ? "sq ft" : "m²"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-base-500">
                      {schedule.rooms.length} zoned rooms
                    </div>
                  </div>

                  <div className="rounded-lg border border-base-200 bg-base-50/60 p-3">
                    <div className="flex items-center justify-between text-base-500">
                      <span className="font-semibold text-xs text-base-600">Wall Assembly</span>
                      <BrickWall size={14} className="text-amber-500" />
                    </div>
                    <div className="mt-2 text-xl font-bold tracking-tight text-base-900">
                      {isImperial
                        ? (schedule.totalWallLengthM * 3.28084).toFixed(1)
                        : schedule.totalWallLengthM.toFixed(1)}{" "}
                      <span className="text-xs font-normal text-base-500">
                        {isImperial ? "ft length" : "m length"}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-base-500">
                      {isImperial
                        ? `${(schedule.totalWallAreaM2 * 10.7639).toFixed(1)} sq ft surface, ${(totalWallVolumeM3 * 1.30795).toFixed(1)} cu yd vol`
                        : `${schedule.totalWallAreaM2.toFixed(1)} m² surface, ${totalWallVolumeM3.toFixed(1)} m³ vol`}
                    </div>
                  </div>

                  <div className="rounded-lg border border-base-200 bg-base-50/60 p-3">
                    <div className="flex items-center justify-between text-base-500">
                      <span className="font-semibold text-xs text-base-600">Openings Glazing</span>
                      <DoorOpen size={14} className="text-emerald-500" />
                    </div>
                    <div className="mt-2 text-xl font-bold tracking-tight text-base-900">
                      {schedule.doorCount + schedule.windowCount}{" "}
                      <span className="text-xs font-normal text-base-500">units</span>
                    </div>
                    <div className="mt-1 text-[11px] text-base-500">
                      {isImperial
                        ? `${schedule.doorCount} doors, ${schedule.windowCount} windows (${(totalOpeningsAreaM2 * 10.7639).toFixed(1)} sq ft)`
                        : `${schedule.doorCount} doors, ${schedule.windowCount} windows (${totalOpeningsAreaM2.toFixed(1)} m²)`}
                    </div>
                  </div>

                  <div className="rounded-lg border border-base-200 bg-base-50/60 p-3">
                    <div className="flex items-center justify-between text-base-500">
                      <span className="font-semibold text-xs text-base-600">Structure & Framing</span>
                      <Columns size={14} className="text-purple-500" />
                    </div>
                    <div className="mt-2 text-xl font-bold tracking-tight text-base-900">
                      {schedule.columnCount + schedule.beamCount + schedule.roofCount + schedule.stairCount}{" "}
                      <span className="text-xs font-normal text-base-500">elements</span>
                    </div>
                    <div className="mt-1 text-[11px] text-base-500">
                      {schedule.columnCount} cols, {schedule.beamCount} beams, {schedule.roofCount} roofs, {schedule.stairCount} stairs
                    </div>
                  </div>
                </div>

                {/* Building Storeys & Model Overview */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-base-200 bg-base-50/40 p-3.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-base-800">
                      <Layers size={13} className="text-accent-500" />
                      <span>Building Storeys ({scene?.levels?.length ?? 1})</span>
                    </div>
                    <div className="mt-2.5 flex flex-col gap-1.5 text-xs">
                      {(scene?.levels ?? [{ id: "lvl-1", name: "Level 1", elevation: 0, height: 300 }]).map((l) => (
                        <div
                          key={l.id}
                          className="flex items-center justify-between rounded border border-base-200/80 bg-base-100 px-2.5 py-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "h-1.5 w-1.5 rounded-full",
                                l.id === scene?.activeLevel ? "bg-accent-500" : "bg-base-300",
                              )}
                            />
                            <span className="font-medium text-base-800">{l.name}</span>
                          </div>
                          <div className="flex items-center gap-3 font-mono text-[11px] text-base-500">
                            <span>Elev: +{l.elevation} cm</span>
                            <span className="text-base-300">|</span>
                            <span>H: {l.height} cm</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-lg border border-base-200 bg-base-50/40 p-3.5">
                    <div className="flex items-center gap-1.5 font-semibold text-xs text-base-800">
                      <PieChart size={13} className="text-emerald-500" />
                      <span>Space Program Breakdown</span>
                    </div>
                    <div className="mt-2.5 flex flex-col gap-1.5 text-xs">
                      {schedule.rooms.slice(0, 4).map((r, i) => {
                        const total = Math.max(1, totalRoomAreaM2);
                        const pct = Math.min(100, Math.round((r.areaM2 / total) * 100));
                        return (
                          <div key={i} className="flex flex-col gap-0.5">
                            <div className="flex items-center justify-between text-[11.5px]">
                              <span className="font-medium text-base-700">{r.name}</span>
                              <span className="font-mono text-base-500">
                                {r.areaM2.toFixed(1)} m² ({pct}%)
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-200">
                              <div
                                className="h-full rounded-full bg-accent-500/70"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                      {schedule.rooms.length === 0 && (
                        <div className="py-4 text-center text-xs text-base-400">
                          Use the Room tool to define spaces for area schedule takeoff.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "walls" && (
              <div className="flex flex-col gap-2">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-base-200 font-semibold text-base-600 bg-base-50/50">
                    <tr>
                      <th className="py-2 px-2.5">Wall Mark / Name</th>
                      <th className="py-2 px-2.5">Thickness ({isImperial ? "in" : "mm"})</th>
                      <th className="py-2 px-2.5">Height ({isImperial ? "ft" : "m"})</th>
                      <th className="py-2 px-2.5">Length ({isImperial ? "ft" : "m"})</th>
                      <th className="py-2 px-2.5">Surface Area ({isImperial ? "sq ft" : "m²"})</th>
                      <th className="py-2 px-2.5">Volume ({isImperial ? "cu yd" : "m³"})</th>
                      <th className="py-2 px-2.5">Level Elevation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-100 text-base-700">
                    {filteredWalls.map((w, i) => (
                      <tr key={i} className="hover:bg-base-50/50 transition-colors">
                        <td className="py-2 px-2.5 font-medium text-base-900">{w.name}</td>
                        <td className="py-2 px-2.5 font-mono">
                          {isImperial ? `${(w.widthMm / 25.4).toFixed(1)} in` : `${w.widthMm} mm`}
                        </td>
                        <td className="py-2 px-2.5 font-mono">
                          {isImperial ? `${(w.heightM * 3.28084).toFixed(2)} ft` : `${w.heightM.toFixed(2)} m`}
                        </td>
                        <td className="py-2 px-2.5 font-mono">
                          {isImperial ? `${(w.lengthM * 3.28084).toFixed(2)} ft` : `${w.lengthM.toFixed(2)} m`}
                        </td>
                        <td className="py-2 px-2.5 font-mono font-medium">
                          {isImperial ? `${(w.areaM2 * 10.7639).toFixed(1)} sq ft` : `${w.areaM2.toFixed(2)} m²`}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-base-500">
                          {isImperial ? `${(w.volumeM3 * 1.30795).toFixed(2)} cu yd` : `${w.volumeM3.toFixed(2)} m³`}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-base-500">
                          {isImperial ? `+${(w.elevationM * 3.28084).toFixed(2)} ft` : `+${w.elevationM.toFixed(2)} m`}
                        </td>
                      </tr>
                    ))}
                    {filteredWalls.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-base-400">
                          No matching walls found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "openings" && (
              <div className="flex flex-col gap-2">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-base-200 font-semibold text-base-600 bg-base-50/50">
                    <tr>
                      <th className="py-2 px-2.5">Category</th>
                      <th className="py-2 px-2.5">Mark / Name</th>
                      <th className="py-2 px-2.5">Width ({isImperial ? "in" : "mm"})</th>
                      <th className="py-2 px-2.5">Height ({isImperial ? "in" : "mm"})</th>
                      <th className="py-2 px-2.5">Sill Height ({isImperial ? "in" : "mm"})</th>
                      <th className="py-2 px-2.5">Glazing Area ({isImperial ? "sq ft" : "m²"})</th>
                      <th className="py-2 px-2.5">Level Elevation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-100 text-base-700">
                    {filteredOpenings.map((o, i) => (
                      <tr key={i} className="hover:bg-base-50/50 transition-colors">
                        <td className="py-2 px-2.5">
                          <span
                            className={cn(
                              "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold",
                              o.kind === "Door"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-sky-500/10 text-sky-600",
                            )}
                          >
                            {o.kind}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 font-medium text-base-900">{o.name}</td>
                        <td className="py-2 px-2.5 font-mono">
                          {isImperial ? `${(o.widthMm / 25.4).toFixed(1)} in` : `${o.widthMm} mm`}
                        </td>
                        <td className="py-2 px-2.5 font-mono">
                          {isImperial ? `${(o.heightMm / 25.4).toFixed(1)} in` : `${o.heightMm} mm`}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-base-500">
                          {isImperial ? `${(o.sillMm / 25.4).toFixed(1)} in` : `${o.sillMm} mm`}
                        </td>
                        <td className="py-2 px-2.5 font-mono font-medium">
                          {isImperial ? `${(o.areaM2 * 10.7639).toFixed(1)} sq ft` : `${o.areaM2.toFixed(2)} m²`}
                        </td>
                        <td className="py-2 px-2.5 font-mono text-base-500">
                          {isImperial ? `+${(o.elevationM * 3.28084).toFixed(2)} ft` : `+${o.elevationM.toFixed(2)} m`}
                        </td>
                      </tr>
                    ))}
                    {filteredOpenings.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-base-400">
                          No doors or windows found in current project.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "rooms" && (
              <div className="flex flex-col gap-2">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-base-200 font-semibold text-base-600 bg-base-50/50">
                    <tr>
                      <th className="py-2 px-2.5">Room Number</th>
                      <th className="py-2 px-2.5">Space Name</th>
                      <th className="py-2 px-2.5">Floor Area ({isImperial ? "sq ft" : "m²"})</th>
                      <th className="py-2 px-2.5">% of Total Program</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-100 text-base-700">
                    {filteredRooms.map((r, i) => {
                      const total = Math.max(1, totalRoomAreaM2);
                      const pct = Math.min(100, Math.round((r.areaM2 / total) * 100));
                      return (
                        <tr key={i} className="hover:bg-base-50/50 transition-colors">
                          <td className="py-2.5 px-2.5 font-mono text-base-500">{r.number}</td>
                          <td className="py-2.5 px-2.5 font-medium text-base-900">{r.name}</td>
                          <td className="py-2.5 px-2.5 font-mono font-semibold text-accent-600">
                            {isImperial
                              ? `${(r.areaM2 * 10.7639).toFixed(1)} sq ft`
                              : `${r.areaM2.toFixed(2)} m²`}
                          </td>
                          <td className="py-2.5 px-2.5 font-mono text-base-500">{pct}%</td>
                        </tr>
                      );
                    })}
                    {filteredRooms.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-base-400">
                          No rooms defined yet. Use the Room tool to tag spaces.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "structure" && (
              <div className="flex flex-col gap-2">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-base-200 font-semibold text-base-600 bg-base-50/50">
                    <tr>
                      <th className="py-2 px-2.5">Category</th>
                      <th className="py-2 px-2.5">Element Name</th>
                      <th className="py-2 px-2.5">Structural Specifications</th>
                      <th className="py-2 px-2.5">Quantity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-base-100 text-base-700">
                    {filteredStructures.map((s, i) => (
                      <tr key={i} className="hover:bg-base-50/50 transition-colors">
                        <td className="py-2 px-2.5 font-medium text-base-600">
                          <span className="inline-flex items-center rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-purple-600">
                            {s.kind}
                          </span>
                        </td>
                        <td className="py-2 px-2.5 font-medium text-base-900">{s.name}</td>
                        <td className="py-2 px-2.5 text-base-600">{s.desc}</td>
                        <td className="py-2 px-2.5 font-mono">{s.quantity}</td>
                      </tr>
                    ))}
                    {filteredStructures.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-base-400">
                          No columns, beams, stairs or roofs placed yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Dialog Footer */}
        <div className="flex items-center justify-between border-t border-base-200 pt-3 text-xs text-base-500">
          <div className="flex items-center gap-1.5">
            <Footprints size={12} className="text-accent-500" />
            <span>Modeled on Revit & BIMCraft Takeoff Specifications</span>
          </div>
          <Button variant="primary" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
