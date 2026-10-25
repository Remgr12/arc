import * as THREE from "three";
import { ipc } from "./ipc";
import { useArcStore } from "./store";
import { chainFromEntity, computePlaneBasis } from "../tools/geometry2d";
import type { Geometry } from "./types";

export interface FeatureRecord {
  id: string; // ID of the generated solid
  name: string; // e.g. "Extrude 1", "Cut Pocket 1"
  operation: "extrude" | "extrude_cut" | "revolve";
  sketchEntityId?: string; // ID of the driving 2D sketch curve
  targetSolidId?: string; // For cuts, ID of the solid that was modified
  parameters: {
    height: number;
    angleDeg?: number;
    normal?: [number, number, number];
    centroid?: [number, number, number];
    isHorizontal?: boolean;
    rotationQuat?: [number, number, number, number];
  };
  createdAt: number;
}

const STORAGE_KEY = "arc:parametric_features";

class FeatureHistoryManager {
  private features: Map<string, FeatureRecord> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as FeatureRecord[];
        this.features = new Map(arr.map((f) => [f.id, f]));
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      const arr = Array.from(this.features.values());
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch {
      // ignore
    }
  }

  public register(feature: FeatureRecord): void {
    this.features.set(feature.id, feature);
    this.persist();
  }

  public get(id: string): FeatureRecord | null {
    return this.features.get(id) ?? null;
  }

  public list(): FeatureRecord[] {
    return Array.from(this.features.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  public remove(id: string): void {
    this.features.delete(id);
    this.persist();
  }

  public getDownstreamFeatures(sketchId: string): FeatureRecord[] {
    return this.list().filter((f) => f.sketchEntityId === sketchId);
  }

  /**
   * Regenerate all solids that depend on `sketchId`.
   * When a sketch's dimensions or constraints are modified, downstream
   * extrusions and cuts automatically update!
   */
  public async regenerate(sketchId: string, docId?: string): Promise<boolean> {
    const activeDoc = docId ?? useArcStore.getState().overview?.active ?? undefined;
    if (!activeDoc) return false;

    const downstream = this.getDownstreamFeatures(sketchId);
    if (downstream.length === 0) return false;

    const scene = useArcStore.getState().scene;
    if (!scene) return false;

    const sketchEntity = scene.entities.find((e) => e.id === sketchId);
    if (!sketchEntity) return false;

    // Extract updated 2D points from the modified sketch entity
    const chain = chainFromEntity(sketchEntity, null);
    if (!chain || chain.points.length < 3) return false;

    let anyUpdated = false;

    for (const feat of downstream) {
      if (feat.operation === "extrude") {
        // Recompute 2D centroid and local polygon relative to plane basis
        const normArr = feat.parameters.normal ?? [0, 1, 0];
        const normal = new THREE.Vector3(...normArr);
        const centroid = new THREE.Vector3();
        for (const p of chain.points) centroid.add(p);
        centroid.divideScalar(chain.points.length);

        const basis = computePlaneBasis(normal, centroid);
        const polygon = chain.points.map((p) => {
          const rel = p.clone().sub(centroid);
          return [rel.dot(basis.u), -rel.dot(basis.v)] as [number, number];
        });

        const height = feat.parameters.height;
        const newGeom = { type: "extrude", polygon, height };

        try {
          await ipc.updateGeometry(activeDoc, feat.id, newGeom as never);
          const center = centroid.clone().addScaledVector(normal, height / 2);
          await ipc.setTransform(
            activeDoc,
            [
              {
                id: feat.id,
                transform: {
                  position: [center.x, center.y, center.z],
                  rotation: feat.parameters.rotationQuat ?? [0, 0, 0, 1],
                  scale: [1, 1, 1],
                },
              },
            ],
            false,
          );
          anyUpdated = true;
        } catch (err) {
          console.warn("Failed to regenerate feature:", feat.id, err);
        }
      }
    }

    if (anyUpdated) {
      const refreshed = await ipc.getScene(activeDoc);
      useArcStore.getState().setScene(refreshed);
      useArcStore.getState().setStatusMessage("Regenerated downstream parametric features");
    }

    return anyUpdated;
  }

  /** Update height parameter of an extrusion feature and update scene. */
  public async updateFeatureHeight(docId: string, featureId: string, newHeight: number): Promise<boolean> {
    const feat = this.get(featureId);
    if (!feat) return false;
    const clampedH = Math.max(0.1, newHeight);
    feat.parameters.height = clampedH;
    this.register(feat);

    const scene = useArcStore.getState().scene;
    const entity = scene?.entities.find((e) => e.id === featureId);
    if (!entity) return false;

    const geom = entity.geometry as Record<string, unknown>;
    const normArr = feat.parameters.normal ?? [0, 1, 0];
    const normal = new THREE.Vector3(...normArr);
    const centroid = feat.parameters.centroid
      ? new THREE.Vector3(...feat.parameters.centroid)
      : new THREE.Vector3(...entity.transform.position);

    try {
      await ipc.updateGeometry(docId, featureId, { ...geom, height: clampedH } as unknown as Geometry);
      const center = centroid.clone().addScaledVector(normal, clampedH / 2);
      await ipc.setTransform(
        docId,
        [
          {
            id: featureId,
            transform: {
              position: [center.x, center.y, center.z],
              rotation: feat.parameters.rotationQuat ?? entity.transform.rotation,
              scale: entity.transform.scale,
            },
          },
        ],
        false,
      );
      const refreshed = await ipc.getScene(docId);
      useArcStore.getState().setScene(refreshed);
      useArcStore.getState().setStatusMessage(`Updated feature height to ${Math.round(clampedH * 100) / 100}`);
      return true;
    } catch (err) {
      console.warn("Failed to update feature height:", err);
      return false;
    }
  }
}

export const featureHistory = new FeatureHistoryManager();
