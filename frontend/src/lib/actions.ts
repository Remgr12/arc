import * as THREE from "three";
import { ipc } from "./ipc";
import { useArcStore } from "./store";
import { MATERIALS } from "./materials";
import { DEFAULT_GEOMETRY } from "../data/tools";
import { deriveFaces, facePlaneInfo } from "../tools/topology";
import type { Geometry, ProjectMode, ToolId, Transform } from "./types";

function guard<A extends unknown[]>(
  action: (...args: A) => Promise<unknown>,
): (...args: A) => void {
  return (...args: A) => {
    void Promise.resolve(action(...args)).catch((e: unknown) => {
      useArcStore.getState().setStatusMessage(`Error: ${String(e)}`);
    });
  };
}

function requireDoc(): string {
  const id = useArcStore.getState().overview?.active;
  if (!id) throw new Error("no active document");
  return id;
}

export const actions = {  booleanApply: guard(async (operation: "union" | "difference" | "intersection") => {
    const docId = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene) return;
    const [first, second] = scene.selection;
    if (!first || !second) {
      useArcStore.getState().setStatusMessage("Select exactly two solid entities to combine");
      return;
    }
    try {
      const result = await ipc.csgApply(docId, operation, first, second);
      const overview = await ipc.getState();
      useArcStore.getState().setOverview(overview);
      useArcStore.getState().setScene(await ipc.getScene(docId));
      await ipc.setSelection(docId, [result.id], result.id);
      useArcStore
        .getState()
        .setStatusMessage(`${operation[0].toUpperCase()}${operation.slice(1)} created`);
    } catch (error) {
      useArcStore.getState().setStatusMessage(`Boolean failed: ${String(error)}`);
    }
  }),

  refresh: guard(async () => {
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
  }),

  newDocument: guard(async (name?: string, mode?: ProjectMode) => {
    await ipc.newDocument(name, mode);
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
    useArcStore.getState().setView("editor");
  }),

  openDocument: guard(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      title: "Open document",
      filters: [{ name: "arc documents", extensions: ["arc", "json"] }],
    });
    if (!path) return;
    await actions.openRecent(path as string);
  }),

  openRecent: guard(async (path: string) => {
    if (!path) return;
    await ipc.openDocument(path);
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
    useArcStore.getState().setView("editor");
  }),

  /** Open a workspace project by path, reusing an already-open document. */
  openProjectPath: guard(async (path: string) => {
    if (!path) return;
    const overview = useArcStore.getState().overview;
    const existing = overview?.documents.find((d) => d.path === path);
    if (existing) {
      await ipc.setActiveDocument(existing.id);
      useArcStore.getState().setScene(await ipc.getScene(existing.id));
    } else {
      await ipc.openDocument(path);
      const next = await ipc.getState();
      useArcStore.getState().setOverview(next);
      if (next.active) {
        useArcStore.getState().setScene(await ipc.getScene(next.active));
      }
    }
    useArcStore.getState().setView("editor");
  }),

  /** Create a named project inside the workspace folder and open it. */
  createWorkspaceProject: guard(async (rawName: string, mode?: ProjectMode) => {
    const name = rawName.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!name) return;
    let folder = useArcStore.getState().workspaceFolder;
    if (!folder) {
      useArcStore.getState().setStatusMessage("Set a workspace folder first");
      return;
    }
    folder = folder.replace(/[\\/]+$/, "");
    const doc = await ipc.newDocument(name, mode);
    const filePath = `${folder}/${name}.arc`;
    await ipc.saveDocument(doc.id, filePath);
    useArcStore.getState().addProjectToCache(folder, {
      name,
      path: filePath,
      modified: Math.floor(Date.now() / 1000),
      size: 0,
    });
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
    useArcStore.getState().setStatusMessage(`Created ${name}`);
    useArcStore.getState().setView("editor");
  }),

  importFile: guard(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({
      title: "Import geometry",
      filters: [
        {
          name: "Geometry (STEP / STL / OBJ / DXF)",
          extensions: ["step", "stp", "stl", "obj", "dxf"],
        },
      ],
    });
    if (!path) return;
    let docId = useArcStore.getState().overview?.active ?? null;
    if (!docId) {
      const created = await ipc.newDocument();
      docId = created.id;
    }
    const result = await ipc.importFile(docId, path as string);
    const overview = await ipc.getState();
    useArcStore.getState().setOverview(overview);
    if (overview.active) {
      useArcStore.getState().setScene(await ipc.getScene(overview.active));
    }
    useArcStore
      .getState()
      .setStatusMessage(`Imported ${result.entities_created.length} entities from ${result.format.toUpperCase()}`);
    useArcStore.getState().setView("editor");
  }),

  saveActive: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    const existing = scene?.path ?? undefined;
    if (existing) {
      await ipc.saveDocument(id, existing);
    } else {
      await saveDocumentAs();
    }
    useArcStore.getState().setStatusMessage("Saved");
    await maybeCaptureThumbnail(id);
  }),
  saveDocumentAs: guard(async () => {
    await saveDocumentAs();
  }),

  closeActive: guard(async () => {
    const id = requireDoc();
    await ipc.closeDocument(id);
  }),

  switchDocument: guard(async (id?: string) => {
    if (!id) return;
    await ipc.setActiveDocument(id);
  }),

  undo: guard(async () => {
    const id = requireDoc();
    await ipc.undo(id);
    useArcStore.getState().setStatusMessage("Undo");
  }),

  redo: guard(async () => {
    const id = requireDoc();
    await ipc.redo(id);
    useArcStore.getState().setStatusMessage("Redo");
  }),

  /** SolveSpace-style rapid workplane activation (W key). */
  activateWorkplane: () => {
    const st = useArcStore.getState();
    const scene = st.scene;
    const selFace = st.selFace;
    if (selFace && scene) {
      const entity = scene.entities.find((e) => e.id === selFace.entityId);
      if (entity) {
        const info = facePlaneInfo(entity, selFace.face);
        st.enterSketchMode({
          height: info.height,
          origin: info.origin,
          normal: info.normal,
          label: info.label,
          tool: "line",
        });
        window.dispatchEvent(
          new CustomEvent("arc-focus-plane", { detail: { normal: info.normal } }),
        );
        st.setStatusMessage(`Workplane: ${info.label}`);
        return;
      }
    }
    const primaryId = scene?.primary || scene?.selection[scene.selection.length - 1];
    if (primaryId && scene) {
      const entity = scene.entities.find((e) => e.id === primaryId);
      if (entity && (entity.kind === "plane" || (entity.geometry as Record<string, unknown>)?.type === "plane")) {
        const pos = entity.transform.position;
        const rot = entity.transform.rotation;
        const q = new THREE.Quaternion(rot[0], rot[1], rot[2], rot[3]);
        const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(q).normalize();
        st.enterSketchMode({
          height: pos[1],
          origin: pos,
          normal: [normal.x, normal.y, normal.z],
          label: entity.name || "Plane",
          tool: "line",
        });
        window.dispatchEvent(
          new CustomEvent("arc-focus-plane", { detail: { normal: [normal.x, normal.y, normal.z] } }),
        );
        st.setStatusMessage(`Workplane: ${entity.name || "Plane"}`);
        return;
      }
    }
    if (st.sketchMode) {
      window.dispatchEvent(
        new CustomEvent("arc-focus-plane", { detail: { normal: st.sketchPlaneNormal } }),
      );
      st.setStatusMessage("Aligned normal to workplane");
      return;
    }
    st.enterSketchMode({ tool: "line" });
    window.dispatchEvent(
      new CustomEvent("arc-focus-plane", { detail: { normal: [0, 1, 0] } }),
    );
    st.setStatusMessage("Workplane: Ground (Y = 0)");
  },

  /** Toggle construction / reference geometry mode for selected sketch entities. */
  toggleConstruction: guard(async () => {
    const docId = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length === 0) return;
    for (const id of scene.selection) {
      const entity = scene.entities.find((e) => e.id === id);
      if (!entity) continue;
      const isConst = entity.name?.startsWith("[C] ");
      const newName = isConst ? entity.name.replace(/^\[C\]\s*/, "") : `[C] ${entity.name}`;
      await ipc.setEntityProps(docId, entity.id, { name: newName });
    }
    const first = scene.entities.find((e) => e.id === scene.selection[0]);
    const isNow = !first?.name?.startsWith("[C] ");
    useArcStore.getState().setStatusMessage(isNow ? "Construction geometry ON" : "Construction geometry OFF");
  }),

  /** Orient viewport camera to standard orthogonal CAD views. */
  setStandardView: (view: "front" | "top" | "right" | "iso" | "back" | "bottom" | "left") => {
    window.dispatchEvent(new CustomEvent("arc-standard-view", { detail: { view } }));
  },

  /** Set cross-section clipping plane aligned to a face. */
  sectionOnFace: guard(async (entityId?: string, faceIndex?: number) => {
    const st = useArcStore.getState();
    const scene = st.scene;
    if (!scene) return;
    const targetId = entityId ?? st.selFace?.entityId ?? scene.selection[0];
    const targetFace = faceIndex ?? st.selFace?.face ?? 0;
    const entity = scene.entities.find((e) => e.id === targetId);
    if (!entity) return;
    const info = facePlaneInfo(entity, targetFace);
    st.setSectionView(true);
    st.setSectionOffset(Math.round(info.height));
    st.setStatusMessage(`Section view on Face ${targetFace}`);
  }),

  /** 1-click 3D print export (STL format). */
  exportSelectedStl: guard(async () => {
    const st = useArcStore.getState();
    if (!st.scene || st.scene.selection.length === 0) {
      st.setStatusMessage("Select a solid entity to export STL");
      return;
    }
    await actions.exportActive("stl");
  }),

  duplicateSelection: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length === 0) return;
    const created = await ipc.duplicateEntities(id, scene.selection);
    if (created.length > 0) {
      await ipc.setSelection(id, created, created[0]);
    }
  }),

  deleteSelection: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length === 0) return;
    await ipc.deleteEntities(id, scene.selection);
    await ipc.setSelection(id, [], null);
  }),

  explodeSelection: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.selection.length < 2) {
      useArcStore.getState().setStatusMessage("Explode needs two or more selected entities");
      return;
    }
    await ipc.explodeEntities(id, scene.selection, 40);
  }),

  /** Hollow out the selected solid (leaving the selected face, or +Y top face, open) with wall thickness `t`. */
  shellSelection: guard(async (rawThickness: number = 2) => {
    const docId = requireDoc();
    const store = useArcStore.getState();
    const scene = store.scene;
    if (!scene || scene.selection.length === 0) {
      store.setStatusMessage("Select a solid or face to Shell / Hollow");
      return;
    }
    const t = Math.max(0.2, rawThickness);
    const targetId =
      (store.selKind === "face" && store.selFace?.entityId) ||
      scene.primary ||
      scene.selection[scene.selection.length - 1];
    const entity = scene.entities.find((e) => e.id === targetId);
    if (!entity || entity.category === "sketch") {
      store.setStatusMessage("Shell requires a 3D solid body");
      return;
    }

    let localNormal = new THREE.Vector3(0, 1, 0);
    if (store.selKind === "face" && store.selFace?.entityId === entity.id) {
      const fGroup = deriveFaces(entity).find((f) => f.index === store.selFace?.face);
      if (fGroup) localNormal.set(...fGroup.normal).normalize();
    }

    const geom = entity.geometry as Record<string, unknown>;
    let cutterGeom: Geometry | null = null;
    const localOffset = new THREE.Vector3();

    if (entity.kind === "box" || entity.kind === "column" || entity.kind === "beam" || entity.kind === "slab") {
      const w = typeof geom.width === "number" ? geom.width : 20;
      const h =
        typeof geom.height === "number"
          ? geom.height
          : typeof geom.thickness === "number"
            ? geom.thickness
            : 20;
      const d =
        typeof geom.depth === "number"
          ? geom.depth
          : typeof geom.length === "number"
            ? geom.length
            : 20;
      const openX = Math.abs(localNormal.x) > 0.7;
      const openZ = Math.abs(localNormal.z) > 0.7;
      const iw = Math.max(0.2, openX ? w - t + 0.1 : w - 2 * t);
      const ih = Math.max(0.2, !openX && !openZ ? h - t + 0.1 : h - 2 * t);
      const id = Math.max(0.2, openZ ? d - t + 0.1 : d - 2 * t);
      if (openX) localOffset.set(Math.sign(localNormal.x) * (t + 0.1) * 0.5, 0, 0);
      else if (openZ) localOffset.set(0, 0, Math.sign(localNormal.z) * (t + 0.1) * 0.5);
      else localOffset.set(0, Math.sign(localNormal.y || 1) * (t + 0.1) * 0.5, 0);
      cutterGeom = { type: "box", width: iw, height: ih, depth: id };
    } else if (entity.kind === "cylinder") {
      const r = typeof geom.radius === "number" ? geom.radius : 12;
      const h = typeof geom.height === "number" ? geom.height : 28;
      const segs = typeof geom.segments === "number" ? geom.segments : 32;
      const ir = Math.max(0.2, r - t);
      const ih = Math.max(0.2, h - t + 0.1);
      localOffset.set(0, localNormal.y < -0.5 ? -0.1 : t, 0);
      cutterGeom = { type: "cylinder", radius: ir, height: ih, segments: segs };
    } else if (entity.kind === "cone") {
      const r = typeof geom.radius === "number" ? geom.radius : 14;
      const h = typeof geom.height === "number" ? geom.height : 28;
      const segs = typeof geom.segments === "number" ? geom.segments : 32;
      cutterGeom = {
        type: "cone",
        radius: Math.max(0.2, r - t),
        height: Math.max(0.2, h - t * 1.4),
        segments: segs,
      };
      localOffset.set(0, -0.05, 0);
    } else if (entity.kind === "sphere") {
      const r = typeof geom.radius === "number" ? geom.radius : 14;
      const segs = typeof geom.segments === "number" ? geom.segments : 32;
      cutterGeom = { type: "sphere", radius: Math.max(0.2, r - t), segments: segs };
      localOffset.copy(localNormal).multiplyScalar(t * 0.6);
    } else if (entity.kind === "extrude" && Array.isArray(geom.polygon)) {
      const poly = geom.polygon as [number, number][];
      const h = typeof geom.height === "number" ? geom.height : 20;
      let cx = 0;
      let cz = 0;
      for (const [px, pz] of poly) {
        cx += px;
        cz += pz;
      }
      cx /= poly.length || 1;
      cz /= poly.length || 1;
      const insetPoly: [number, number][] = poly.map(([px, pz]) => {
        const dx = px - cx;
        const dz = pz - cz;
        const dist = Math.hypot(dx, dz) || 1;
        const k = Math.max(0.1, (dist - t) / dist);
        return [cx + dx * k, cz + dz * k];
      });
      cutterGeom = {
        type: "extrude",
        polygon: insetPoly,
        height: Math.max(0.2, h - t + 0.1),
      };
      localOffset.set(0, (localNormal.y < -0.5 ? -1 : 1) * (t + 0.1) * 0.5, 0);
    } else if (entity.triPositions && entity.triPositions.length >= 9) {
      // Fallback for arbitrary B-rep solids: compute local bounding box and shell with an inset box
      const pos = entity.triPositions;
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        minX = Math.min(minX, pos[i]); maxX = Math.max(maxX, pos[i]);
        minY = Math.min(minY, pos[i + 1]); maxY = Math.max(maxY, pos[i + 1]);
        minZ = Math.min(minZ, pos[i + 2]); maxZ = Math.max(maxZ, pos[i + 2]);
      }
      const w = maxX - minX;
      const h = maxY - minY;
      const d = maxZ - minZ;
      localOffset.set(
        (minX + maxX) * 0.5,
        (minY + maxY) * 0.5 + (localNormal.y < -0.5 ? -1 : 1) * (t + 0.1) * 0.5,
        (minZ + maxZ) * 0.5,
      );
      cutterGeom = {
        type: "box",
        width: Math.max(0.2, w - 2 * t),
        height: Math.max(0.2, h - t + 0.1),
        depth: Math.max(0.2, d - 2 * t),
      };
    }

    if (!cutterGeom) {
      store.setStatusMessage("Shell is not supported on this geometry kind");
      return;
    }

    const quat = new THREE.Quaternion(...entity.transform.rotation);
    const scl = new THREE.Vector3(...entity.transform.scale);
    const worldOffset = localOffset.multiply(scl).applyQuaternion(quat);
    const cutterPos: [number, number, number] = [
      entity.transform.position[0] + worldOffset.x,
      entity.transform.position[1] + worldOffset.y,
      entity.transform.position[2] + worldOffset.z,
    ];

    const cutter = await ipc.createEntity(docId, cutterGeom, "Shell Cutter");
    await ipc.setTransform(
      docId,
      [
        {
          id: cutter.id,
          transform: {
            position: cutterPos,
            rotation: entity.transform.rotation,
            scale: entity.transform.scale,
          },
        },
      ],
      false,
    );
    try {
      const res = await ipc.csgApply(docId, "difference", entity.id, cutter.id);
      const overview = await ipc.getState();
      store.setOverview(overview);
      store.setScene(await ipc.getScene(docId));
      await ipc.setSelection(docId, [res.id], res.id);
      store.setStatusMessage(`Shelled solid (wall thickness ${t} cm)`);
    } catch (err) {
      await ipc.deleteEntities(docId, [cutter.id]);
      store.setStatusMessage(`Shell failed: ${String(err)}`);
    }
  }),

  /** Bevel the currently selected 3D edge at 45° by `distance` using a CSG cutter. */
  chamferSelectedEdge: guard(async (rawDistance: number = 2) => {
    const docId = requireDoc();
    const store = useArcStore.getState();
    const scene = store.scene;
    const selEdge = store.selEdge;
    if (!scene || !selEdge) {
      store.setStatusMessage("Select an edge first to Chamfer");
      return;
    }
    const entity = scene.entities.find((e) => e.id === selEdge.entityId);
    const segIndex = Number.parseInt(selEdge.key.split(":")[1] ?? "-1", 10);
    if (!entity || !entity.lines || segIndex < 0 || (segIndex + 1) * 6 > entity.lines.length) {
      store.setStatusMessage("Cannot resolve selected edge geometry");
      return;
    }
    const d = Math.max(0.2, rawDistance);
    const o = segIndex * 6;
    const pos = new THREE.Vector3(...entity.transform.position);
    const quat = new THREE.Quaternion(...entity.transform.rotation);
    const scl = new THREE.Vector3(...entity.transform.scale);
    const mat = new THREE.Matrix4().compose(pos, quat, scl);

    const A = new THREE.Vector3(entity.lines[o], entity.lines[o + 1], entity.lines[o + 2]).applyMatrix4(mat);
    const B = new THREE.Vector3(entity.lines[o + 3], entity.lines[o + 4], entity.lines[o + 5]).applyMatrix4(mat);
    const M = A.clone().add(B).multiplyScalar(0.5);
    const edgeVec = B.clone().sub(A);
    const edgeLen = edgeVec.length();
    if (edgeLen < 1e-4) return;
    const uVec = edgeVec.clone().normalize();

    // Compute world center of the solid from its triangle positions
    const center = pos.clone();
    if (entity.triPositions && entity.triPositions.length >= 9) {
      const box = new THREE.Box3();
      const v = new THREE.Vector3();
      for (let i = 0; i < entity.triPositions.length; i += 3) {
        v.set(entity.triPositions[i], entity.triPositions[i + 1], entity.triPositions[i + 2]).applyMatrix4(mat);
        box.expandByPoint(v);
      }
      if (!box.isEmpty()) box.getCenter(center);
    }

    const outward = M.clone().sub(center);
    outward.addScaledVector(uVec, -outward.dot(uVec));
    if (outward.lengthSq() < 1e-6) {
      outward.crossVectors(uVec, new THREE.Vector3(0, 1, 0));
      if (outward.lengthSq() < 1e-6) outward.crossVectors(uVec, new THREE.Vector3(1, 0, 0));
    }
    outward.normalize();
    const bVec = new THREE.Vector3().crossVectors(uVec, outward).normalize();

    const cutterH = d * 3;
    const cutterW = edgeLen + d * 4;
    const cutterD = d * 4;
    // Place cutter so its inner face (-cutterH/2 along outward) lies at M - (d / sqrt(2)) * outward
    const shift = cutterH * 0.5 - d * Math.SQRT1_2;
    const cutterCenter = M.clone().addScaledVector(outward, shift);
    const basisMat = new THREE.Matrix4().makeBasis(uVec, outward, bVec);
    const cutterQuat = new THREE.Quaternion().setFromRotationMatrix(basisMat);

    const cutter = await ipc.createEntity(
      docId,
      { type: "box", width: cutterW, height: cutterH, depth: cutterD },
      "Chamfer Cutter",
    );
    await ipc.setTransform(
      docId,
      [
        {
          id: cutter.id,
          transform: {
            position: [cutterCenter.x, cutterCenter.y, cutterCenter.z],
            rotation: [cutterQuat.x, cutterQuat.y, cutterQuat.z, cutterQuat.w],
            scale: [1, 1, 1],
          },
        },
      ],
      false,
    );
    try {
      const res = await ipc.csgApply(docId, "difference", entity.id, cutter.id);
      const overview = await ipc.getState();
      store.setOverview(overview);
      store.setScene(await ipc.getScene(docId));
      await ipc.setSelection(docId, [res.id], res.id);
      store.setStatusMessage(`Chamfered edge (${d} cm × 45°)`);
    } catch (err) {
      await ipc.deleteEntities(docId, [cutter.id]);
      store.setStatusMessage(`Chamfer failed: ${String(err)}`);
    }
  }),

  /** Create a linear array of `count` copies spaced by `spacing` along `axis` ("x" | "y" | "z"). */
  linearPattern: guard(
    async (opts?: { count?: number; spacing?: number; axis?: "x" | "y" | "z" }) => {
      const docId = requireDoc();
      const store = useArcStore.getState();
      const scene = store.scene;
      if (!scene || scene.selection.length === 0) {
        store.setStatusMessage("Select entities to create a Linear Pattern");
        return;
      }
      const count = Math.max(2, Math.min(32, Math.round(opts?.count ?? 3)));
      const spacing = opts?.spacing ?? 30;
      const axis = opts?.axis ?? "x";
      const step: [number, number, number] =
        axis === "x" ? [spacing, 0, 0] : axis === "y" ? [0, spacing, 0] : [0, 0, spacing];

      const sourceEntities = scene.selection
        .map((id) => scene.entities.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e));

      const allIds = [...scene.selection];
      const updates: { id: string; transform: Transform }[] = [];

      for (let k = 1; k < count; k++) {
        for (const src of sourceEntities) {
          const [dupId] = await ipc.duplicateEntities(docId, [src.id]);
          if (!dupId) continue;
          allIds.push(dupId);
          updates.push({
            id: dupId,
            transform: {
              position: [
                src.transform.position[0] + step[0] * k,
                src.transform.position[1] + step[1] * k,
                src.transform.position[2] + step[2] * k,
              ],
              rotation: [...src.transform.rotation] as [number, number, number, number],
              scale: [...src.transform.scale] as [number, number, number],
            },
          });
        }
      }
      if (updates.length > 0) {
        await ipc.setTransform(docId, updates, true);
        await ipc.setSelection(docId, allIds, allIds[allIds.length - 1] ?? null);
        store.setScene(await ipc.getScene(docId));
        store.setStatusMessage(
          `Linear Pattern: ${count}× along ${axis.toUpperCase()} (${spacing} cm spacing)`,
        );
      }
    },
  ),

  /** Create a circular array of `count` copies rotated over `angleDeg` around `axis` ("x" | "y" | "z"). */
  circularPattern: guard(
    async (opts?: { count?: number; angleDeg?: number; axis?: "x" | "y" | "z" }) => {
      const docId = requireDoc();
      const store = useArcStore.getState();
      const scene = store.scene;
      if (!scene || scene.selection.length === 0) {
        store.setStatusMessage("Select entities to create a Circular Pattern");
        return;
      }
      const count = Math.max(2, Math.min(36, Math.round(opts?.count ?? 6)));
      const angleDeg = opts?.angleDeg ?? 360;
      const axis = opts?.axis ?? "y";
      const axisVec =
        axis === "x"
          ? new THREE.Vector3(1, 0, 0)
          : axis === "y"
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(0, 0, 1);

      const sourceEntities = scene.selection
        .map((id) => scene.entities.find((e) => e.id === id))
        .filter((e): e is NonNullable<typeof e> => Boolean(e));

      const allIds = [...scene.selection];
      const updates: { id: string; transform: Transform }[] = [];
      const stepDeg = Math.abs(angleDeg - 360) < 1e-3 ? 360 / count : angleDeg / (count - 1);

      for (const src of sourceEntities) {
        const origPos = new THREE.Vector3(...src.transform.position);
        const origQuat = new THREE.Quaternion(...src.transform.rotation);
        // If the entity is sitting right on the rotation axis, orbit around a 30 cm radius ring
        const radial = origPos.clone().addScaledVector(axisVec, -origPos.dot(axisVec));
        const pivot =
          radial.lengthSq() < 1e-3
            ? origPos
                .clone()
                .add(
                  axis === "y"
                    ? new THREE.Vector3(-30, 0, 0)
                    : new THREE.Vector3(0, -30, 0),
                )
            : new THREE.Vector3(0, 0, 0);

        for (let k = 1; k < count; k++) {
          const [dupId] = await ipc.duplicateEntities(docId, [src.id]);
          if (!dupId) continue;
          allIds.push(dupId);
          const rad = (stepDeg * k * Math.PI) / 180;
          const rotQ = new THREE.Quaternion().setFromAxisAngle(axisVec, rad);
          const nextPos = origPos.clone().sub(pivot).applyQuaternion(rotQ).add(pivot);
          const nextQuat = rotQ.clone().multiply(origQuat);
          updates.push({
            id: dupId,
            transform: {
              position: [nextPos.x, nextPos.y, nextPos.z],
              rotation: [nextQuat.x, nextQuat.y, nextQuat.z, nextQuat.w],
              scale: [...src.transform.scale] as [number, number, number],
            },
          });
        }
      }
      if (updates.length > 0) {
        await ipc.setTransform(docId, updates, true);
        await ipc.setSelection(docId, allIds, allIds[allIds.length - 1] ?? null);
        store.setScene(await ipc.getScene(docId));
        store.setStatusMessage(
          `Circular Pattern: ${count}× around ${axis.toUpperCase()} (${angleDeg}°)`,
        );
      }
    },
  ),

  applyMaterial: guard(async (query: string) => {
    const docId = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene) return;
    if (scene.selection.length === 0) {
      useArcStore.getState().setStatusMessage("Select entities to apply a material");
      return;
    }
    const q = query.trim().toLowerCase();
    if (!q) {
      useArcStore.getState().setStatusMessage("Usage: material <id or label>");
      return;
    }
    const material =
      MATERIALS.find((m) => m.id.toLowerCase() === q) ??
      MATERIALS.find((m) => m.label.toLowerCase() === q) ??
      MATERIALS.find(
        (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q),
      );
    if (!material) {
      useArcStore.getState().setStatusMessage(`No material matching "${query.trim()}"`);
      return;
    }
    for (const id of scene.selection) {
      await ipc.setEntityMaterial(docId, id, material.id);
    }
    useArcStore.getState().setScene(await ipc.getScene(docId));
    useArcStore
      .getState()
      .setStatusMessage(
        `Applied ${material.label} to ${scene.selection.length} ${scene.selection.length === 1 ? "entity" : "entities"}`,
      );
  }),

  selectAll: guard(async () => {
    const id = requireDoc();
    const scene = useArcStore.getState().scene;
    if (!scene || scene.entities.length === 0) return;
    const ids = scene.entities.filter((e) => !e.locked).map((e) => e.id);
    await ipc.setSelection(id, ids, ids[ids.length - 1] ?? null);
  }),

  clearSelection: guard(async () => {
    const id = requireDoc();
    await ipc.setSelection(id, [], null);
  }),

  /** Toggle isolation: hide everything not selected; off restores previously visible items. */
  isolateSelection: guard(async () => {
    const id = requireDoc();
    const store = useArcStore.getState();
    const scene = store.scene;
    if (!scene) return;
    if (store.isolated) {
      const toRestore =
        store.isolatedHiddenIds.length > 0
          ? new Set(store.isolatedHiddenIds)
          : new Set(scene.entities.map((e) => e.id));
      for (const entity of scene.entities) {
        if (!entity.visible && toRestore.has(entity.id)) {
          await ipc.setEntityProps(id, entity.id, { visible: true });
        }
      }
      store.setIsolatedHiddenIds([]);
      store.setIsolated(false);
      store.setStatusMessage("Exited isolate mode");
      return;
    }
    if (scene.selection.length === 0) {
      store.setStatusMessage("Select something to isolate");
      return;
    }
    const hiddenIds: string[] = [];
    for (const entity of scene.entities) {
      const shouldHide = !scene.selection.includes(entity.id);
      if (shouldHide && entity.visible) {
        hiddenIds.push(entity.id);
        await ipc.setEntityProps(id, entity.id, { visible: false });
      }
    }
    store.setIsolatedHiddenIds(hiddenIds);
    store.setIsolated(true);
    store.setStatusMessage(`Isolated ${scene.selection.length} entities`);
  }),

  setTool: (tool: ToolId) => {
    useArcStore.getState().setTool(tool);
  },

  setLayerActive: guard(async (layerId?: string) => {
    const id = requireDoc();
    if (!layerId) return;
    await ipc.setActiveLayer(id, layerId);
  }),

  addLayer: guard(async () => {
    const id = requireDoc();
    await ipc.addLayer(id);
  }),

  exportActive: guard(async (format?: string) => {
    const fmt = (format ?? "obj") as string;
    const id = requireDoc();
    const { save } = await import("@tauri-apps/plugin-dialog");
    const ext =
      fmt === "step"
        ? "step"
        : fmt === "gltf"
          ? "gltf"
          : fmt === "obj"
            ? "obj"
            : "stl";
    const path = await save({
      title: `Export ${fmt === "stl_ascii" ? "STL ASCII" : fmt.toUpperCase()}`,
      filters: [{ name: fmt === "stl_ascii" ? "STL ASCII" : fmt.toUpperCase(), extensions: [ext] }],
      defaultPath: `${useArcStore.getState().scene?.name ?? "scene"}.${ext}`,
    });
    if (!path) return;
    await ipc.exportScene(id, path as string, fmt);
    useArcStore.getState().setStatusMessage(`Exported ${(path as string).slice(-40)}`);
  }),

  fitView: () => {
    window.dispatchEvent(new CustomEvent("arc-fit-view"));
  },

  togglePalette: () => {
    const st = useArcStore.getState();
    st.setPaletteOpen(!st.paletteOpen);
  },

  openSettings: () => {
    useArcStore.getState().setSettingsOpen(true);
  },

  openPlugins: () => {
    useArcStore.getState().setPluginsOpen(true);
  },

  openCommandLine: guard(async () => {
    useArcStore.getState().setCommandLineOpen(true);
  }),

  reloadPlugins: guard(async () => {
    const list = await ipc.reloadPlugins();
    useArcStore.getState().setPlugins(list);
  }),

  focusEntity: (entityId: string) => {
    window.dispatchEvent(
      new CustomEvent("arc-focus-entity", { detail: { entityId } }),
    );
  },
};

async function saveDocumentAs(): Promise<void> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const id = requireDoc();
  const scene = useArcStore.getState().scene;
  const path = await save({
    title: "Save document",
    filters: [{ name: "arc documents", extensions: ["arc", "json"] }],
    defaultPath: `${scene?.name ?? "Untitled"}.arc`,
  });
  if (!path) return;
  await ipc.saveDocument(id, path as string);
  await maybeCaptureThumbnail(id);
}
/** Ask the viewport renderer for the current frame (downscaled PNG data URL). */
export function requestViewportThumbnail(): Promise<string | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), 300);
    window.dispatchEvent(
      new CustomEvent("arc-capture-thumb", {
        detail: (url: string | null) => {
          window.clearTimeout(timer);
          resolve(url);
        },
      }),
    );
  });
}

/** Best-effort: capture the viewport and store it next to the saved file. */
async function maybeCaptureThumbnail(docId: string): Promise<void> {
  try {
    const scene = useArcStore.getState().scene;
    if (!scene || scene.entities.length === 0) {
      useArcStore.getState().setStatusMessage("Saved (thumbnail skipped: empty scene)");
      return;
    }
    const url = await requestViewportThumbnail();
    if (!url) {
      useArcStore.getState().setStatusMessage("Saved (thumbnail: no frame)");
      return;
    }
    await ipc.saveProjectThumbnail(docId, url);
  } catch (e) {
    useArcStore.getState().setStatusMessage(`Saved (thumbnail failed: ${String(e)})`);
  }
}

/** Create geometry for the active tool at a world point (creation tools). */
export function geometryForTool(tool: ToolId): { type: string } | null {
  return DEFAULT_GEOMETRY[tool] ?? null;
}
