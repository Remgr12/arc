import * as THREE from "three";
import { ipc } from "./ipc";
import { useArcStore } from "./store";
import type { EntityData } from "./types";
import { facePlaneInfo } from "../tools/topology";

export type MateType = "coincident" | "flush" | "concentric" | "distance";

export interface AssemblyMate {
  id: string;
  name: string;
  type: MateType;
  entityAId: string; // Reference component (fixed)
  entityBId: string; // Moving component
  faceA?: number | null;
  faceB?: number | null;
  offsetDistance?: number;
  createdAt: number;
}

const STORAGE_KEY = "arc:assembly_mates";

class AssemblyManager {
  private mates: Map<string, AssemblyMate> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as AssemblyMate[];
        this.mates = new Map(arr.map((m) => [m.id, m]));
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.mates.values())));
    } catch {
      // ignore
    }
  }

  public register(mate: AssemblyMate): void {
    this.mates.set(mate.id, mate);
    this.persist();
  }

  public list(): AssemblyMate[] {
    return Array.from(this.mates.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  public remove(id: string): void {
    this.mates.delete(id);
    this.persist();
  }

  public async reapplyMate(docId: string, mateId: string): Promise<boolean> {
    const mate = this.mates.get(mateId);
    if (!mate) return false;
    const scene = useArcStore.getState().scene;
    if (!scene) return false;
    const eA = scene.entities.find((e) => e.id === mate.entityAId);
    const eB = scene.entities.find((e) => e.id === mate.entityBId);
    if (!eA || !eB) return false;
    return this.applyMate(docId, mate.type, eA, eB, mate.faceA, mate.faceB, mate.offsetDistance ?? 0);
  }

  /**
   * Solve and apply an assembly mate between two entities / faces.
   * Calculates the exact rigid 3D transformation (rotation + translation)
   * to align Component B to Component A and commits it to the scene.
   */
  public async applyMate(
    docId: string,
    type: MateType,
    entityA: EntityData,
    entityB: EntityData,
    faceA: number | null = null,
    faceB: number | null = null,
    offset = 0,
  ): Promise<boolean> {
    if (entityA.id === entityB.id) return false;

    const infoA = facePlaneInfo(entityA, faceA);
    const infoB = facePlaneInfo(entityB, faceB);

    const normalA = new THREE.Vector3(...infoA.normal).normalize();
    const normalB = new THREE.Vector3(...infoB.normal).normalize();
    const originA = new THREE.Vector3(...infoA.origin);
    const originB = new THREE.Vector3(...infoB.origin);

    const posB = new THREE.Vector3(...entityB.transform.position);
    const rotB = new THREE.Quaternion(...entityB.transform.rotation);
    const sclB = new THREE.Vector3(...entityB.transform.scale);

    let targetRot = rotB.clone();
    let newPosB = posB.clone();

    if (type === "coincident" || type === "flush") {
      // Coincident: opposing normals (nB = -nA, faces touch). Flush: parallel normals (nB = nA).
      const targetNormalB = type === "coincident" ? normalA.clone().negate() : normalA.clone();
      const qAlign = new THREE.Quaternion().setFromUnitVectors(normalB, targetNormalB);

      // Rotate B's orientation
      targetRot = qAlign.clone().multiply(rotB).normalize();

      // Vector from B's transform origin to Face B's origin
      const bRelOrigin = originB.clone().sub(posB);
      // Rotate that relative vector
      const rotatedBRel = bRelOrigin.clone().applyQuaternion(qAlign);

      // Target position for Face B origin: originA + offset along normalA
      const targetFaceBOrigin = originA.clone().addScaledVector(normalA, offset);

      // Component B's new transform position = targetFaceBOrigin - rotatedBRel
      newPosB = targetFaceBOrigin.sub(rotatedBRel);
    } else if (type === "concentric") {
      // Coaxial alignment of cylinder centers
      const qAlign = new THREE.Quaternion().setFromUnitVectors(normalB, normalA);
      targetRot = qAlign.clone().multiply(rotB).normalize();

      // Align centerline: shift B perpendicularly so originB lies on the axis through originA along normalA
      const delta = originA.clone().sub(originB);
      const perpShift = delta.clone().addScaledVector(normalA, -delta.dot(normalA));
      newPosB = posB.clone().add(perpShift);
    } else if (type === "distance") {
      // Shift B along normalA until distance equals offset
      const curDist = originB.clone().sub(originA).dot(normalA);
      const shift = offset - curDist;
      newPosB = posB.clone().addScaledVector(normalA, shift);
    }

    try {
      await ipc.setTransform(
        docId,
        [
          {
            id: entityB.id,
            transform: {
              position: [newPosB.x, newPosB.y, newPosB.z],
              rotation: [targetRot.x, targetRot.y, targetRot.z, targetRot.w],
              scale: [sclB.x, sclB.y, sclB.z],
            },
          },
        ],
        true,
      );

      this.register({
        id: `mate-${Date.now()}`,
        name: `${type.toUpperCase()} (${entityB.name || "Part B"} → ${entityA.name || "Part A"})`,
        type,
        entityAId: entityA.id,
        entityBId: entityB.id,
        faceA,
        faceB,
        offsetDistance: offset,
        createdAt: Date.now(),
      });

      const scene = await ipc.getScene(docId);
      useArcStore.getState().setScene(scene);
      useArcStore.getState().setStatusMessage(`Mated ${entityB.name || "Part B"} to ${entityA.name || "Part A"} (${type})`);
      return true;
    } catch (err) {
      console.warn("Failed to apply mate:", err);
      return false;
    }
  }
}

export const assemblyManager = new AssemblyManager();
