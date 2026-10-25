import * as THREE from "three";
import { ipc } from "../lib/ipc";
import { useArcStore } from "../lib/store";
import { featureHistory } from "../lib/featureHistory";
import type { EntityData, Geometry } from "../lib/types";

/**
 * 2D Geometric Constraint Types (SolveSpace / PlanG style).
 */
export type Constraint2DKind =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "distance"
  | "parallel"
  | "perpendicular"
  | "equal_length"
  | "tangent"
  | "concentric"
  | "fixed";

export interface Constraint2D {
  id: string;
  kind: Constraint2DKind;
  entityId?: string; // Entity this constraint belongs to
  p1: number; // Point index 1
  p2?: number; // Point index 2
  p3?: number; // Point index 3 (for segments 2)
  p4?: number; // Point index 4
  value?: number; // Target distance, radius, or angle
  label?: string;
}

export interface SolverResult {
  points: THREE.Vector2[];
  converged: boolean;
  iterations: number;
  finalError: number;
}

/**
 * Evaluates residual error for a single constraint given current point positions.
 */
function evaluateResidual(c: Constraint2D, pts: THREE.Vector2[]): number[] {
  const p1 = pts[c.p1];
  if (!p1) return [0];

  switch (c.kind) {
    case "horizontal": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      if (!p2) return [0];
      return [p2.y - p1.y];
    }
    case "vertical": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      if (!p2) return [0];
      return [p2.x - p1.x];
    }
    case "coincident": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      if (!p2) return [0, 0];
      return [p2.x - p1.x, p2.y - p1.y];
    }
    case "distance": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      if (!p2) return [0];
      const target = c.value ?? 10;
      const curDist = p1.distanceTo(p2);
      return [curDist - target];
    }
    case "equal_length": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      const p3 = c.p3 !== undefined ? pts[c.p3] : null;
      const p4 = c.p4 !== undefined ? pts[c.p4] : null;
      if (!p2 || !p3 || !p4) return [0];
      const len1 = p1.distanceTo(p2);
      const len2 = p3.distanceTo(p4);
      return [len1 - len2];
    }
    case "parallel": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      const p3 = c.p3 !== undefined ? pts[c.p3] : null;
      const p4 = c.p4 !== undefined ? pts[c.p4] : null;
      if (!p2 || !p3 || !p4) return [0];
      const dx1 = p2.x - p1.x;
      const dy1 = p2.y - p1.y;
      const dx2 = p4.x - p3.x;
      const dy2 = p4.y - p3.y;
      // 2D Cross product of directions should be 0
      return [dx1 * dy2 - dy1 * dx2];
    }
    case "perpendicular": {
      const p2 = c.p2 !== undefined ? pts[c.p2] : null;
      const p3 = c.p3 !== undefined ? pts[c.p3] : null;
      const p4 = c.p4 !== undefined ? pts[c.p4] : null;
      if (!p2 || !p3 || !p4) return [0];
      const dx1 = p2.x - p1.x;
      const dy1 = p2.y - p1.y;
      const dx2 = p4.x - p3.x;
      const dy2 = p4.y - p3.y;
      // 2D Dot product of directions should be 0
      return [dx1 * dx2 + dy1 * dy2];
    }
    case "fixed": {
      const targetU = c.value ?? p1.x;
      return [p1.x - targetU];
    }
    default:
      return [0];
  }
}

/**
 * 2D Damped Gauss-Newton / Levenberg-Marquardt Constraint Solver (SolveSpace style).
 * Fast, stable numerical relaxation in < 3ms for typical sketch loops.
 */
export function solveSketchConstraints(
  initialPoints: THREE.Vector2[],
  constraints: Constraint2D[],
  fixedIndices: Set<number> = new Set(),
  maxIterations = 25,
  tolerance = 1e-4,
): SolverResult {
  if (constraints.length === 0 || initialPoints.length === 0) {
    return {
      points: initialPoints.map((p) => p.clone()),
      converged: true,
      iterations: 0,
      finalError: 0,
    };
  }

  const n = initialPoints.length;
  // Vector X has length 2 * n (x0, y0, x1, y1, ...)
  const x = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    x[2 * i] = initialPoints[i].x;
    x[2 * i + 1] = initialPoints[i].y;
  }

  const getPts = (vec: Float64Array): THREE.Vector2[] => {
    const out: THREE.Vector2[] = [];
    for (let i = 0; i < n; i++) {
      out.push(new THREE.Vector2(vec[2 * i], vec[2 * i + 1]));
    }
    return out;
  };

  let lambda = 1e-3;
  let iter = 0;
  let converged = false;
  let lastError = Infinity;

  while (iter < maxIterations) {
    iter++;
    const currentPts = getPts(x);

    // Collect all residual components
    const residuals: number[] = [];
    for (const c of constraints) {
      const r = evaluateResidual(c, currentPts);
      for (const val of r) residuals.push(val);
    }

    let totalError = 0;
    for (const r of residuals) totalError += r * r;
    totalError = Math.sqrt(totalError);

    if (totalError < tolerance) {
      converged = true;
      lastError = totalError;
      break;
    }

    // Numerical Jacobian calculation (central differences)
    const m = residuals.length;
    const J = new Float64Array(m * (2 * n));
    const eps = 1e-6;

    for (let paramIdx = 0; paramIdx < 2 * n; paramIdx++) {
      const ptIdx = Math.floor(paramIdx / 2);
      if (fixedIndices.has(ptIdx)) continue; // Fixed point derivative = 0

      const origVal = x[paramIdx];
      x[paramIdx] = origVal + eps;
      const ptsPlus = getPts(x);

      x[paramIdx] = origVal - eps;
      const ptsMinus = getPts(x);
      x[paramIdx] = origVal;

      let row = 0;
      for (const c of constraints) {
        const rPlus = evaluateResidual(c, ptsPlus);
        const rMinus = evaluateResidual(c, ptsMinus);
        for (let k = 0; k < rPlus.length; k++) {
          J[row * (2 * n) + paramIdx] = (rPlus[k] - rMinus[k]) / (2 * eps);
          row++;
        }
      }
    }

    // Normal equations: (J^T J + lambda * I) delta = -J^T R
    const JT_J = new Float64Array(2 * n * (2 * n));
    const JT_R = new Float64Array(2 * n);

    for (let i = 0; i < 2 * n; i++) {
      let jtr = 0;
      for (let r = 0; r < m; r++) {
        jtr += J[r * (2 * n) + i] * residuals[r];
      }
      JT_R[i] = -jtr;

      for (let j = 0; j < 2 * n; j++) {
        let sum = 0;
        for (let r = 0; r < m; r++) {
          sum += J[r * (2 * n) + i] * J[r * (2 * n) + j];
        }
        if (i === j) {
          sum += lambda;
          if (fixedIndices.has(Math.floor(i / 2))) sum += 1e8; // Huge damping on fixed points
        }
        JT_J[i * (2 * n) + j] = sum;
      }
    }

    // Solve using Gaussian elimination with partial pivoting
    const delta = solveLinearSystem(JT_J, JT_R, 2 * n);
    if (!delta) {
      lambda *= 10;
      continue;
    }

    // Candidate update
    const xNew = new Float64Array(x);
    for (let i = 0; i < 2 * n; i++) {
      if (!fixedIndices.has(Math.floor(i / 2))) {
        xNew[i] += delta[i];
      }
    }

    const testPts = getPts(xNew);
    let testError = 0;
    for (const c of constraints) {
      const r = evaluateResidual(c, testPts);
      for (const val of r) testError += val * val;
    }
    testError = Math.sqrt(testError);

    if (testError < totalError) {
      // Step accepted
      x.set(xNew);
      lambda = Math.max(1e-7, lambda * 0.5);
      lastError = testError;
    } else {
      // Step rejected, increase damping
      lambda = Math.min(1e5, lambda * 4.0);
    }
  }

  return {
    points: getPts(x),
    converged,
    iterations: iter,
    finalError: lastError,
  };
}

/**
 * Standard Gaussian elimination with partial pivoting for small linear systems.
 */
function solveLinearSystem(A: Float64Array, b: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(n * (n + 1));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      M[i * (n + 1) + j] = A[i * n + j];
    }
    M[i * (n + 1) + n] = b[i];
  }

  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxRow = col;
    let maxVal = Math.abs(M[col * (n + 1) + col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(M[row * (n + 1) + col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }

    if (maxVal < 1e-12) return null; // Singular

    // Swap rows
    if (maxRow !== col) {
      for (let k = 0; k <= n; k++) {
        const tmp = M[col * (n + 1) + k];
        M[col * (n + 1) + k] = M[maxRow * (n + 1) + k];
        M[maxRow * (n + 1) + k] = tmp;
      }
    }

    // Eliminate below
    const pivot = M[col * (n + 1) + col];
    for (let row = col + 1; row < n; row++) {
      const factor = M[row * (n + 1) + col] / pivot;
      for (let k = col; k <= n; k++) {
        M[row * (n + 1) + k] -= factor * M[col * (n + 1) + k];
      }
    }
  }

  // Back substitution
  const result = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = M[row * (n + 1) + n];
    for (let col = row + 1; col < n; col++) {
      sum -= M[row * (n + 1) + col] * result[col];
    }
    result[row] = sum / M[row * (n + 1) + row];
  }

  return result;
}

export interface ActiveConstraintRecord {
  id: string;
  name: string;
  kind: Constraint2DKind;
  entityIds: string[];
  value?: number;
  createdAt: number;
}

const STORAGE_KEY = "arc:geometric_constraints_2d";

class ConstraintManager {
  private constraints: Map<string, ActiveConstraintRecord> = new Map();

  constructor() {
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const arr = JSON.parse(raw) as ActiveConstraintRecord[];
        this.constraints = new Map(arr.map((c) => [c.id, c]));
      }
    } catch {
      // ignore
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.constraints.values())));
    } catch {
      // ignore
    }
  }

  public register(record: ActiveConstraintRecord): void {
    this.constraints.set(record.id, record);
    this.persist();
  }

  public list(): ActiveConstraintRecord[] {
    return Array.from(this.constraints.values()).sort((a, b) => a.createdAt - b.createdAt);
  }

  public remove(id: string): void {
    this.constraints.delete(id);
    this.persist();
  }

  /** Constrain a line or polyline segment to be horizontal (along X axis). */
  public async applyHorizontal(docId: string, entity: EntityData): Promise<boolean> {
    const g = entity.geometry as Record<string, unknown>;
    if (entity.kind === "line" || entity.kind === "line_curve") {
      const end = (g.end as [number, number, number]) ?? [10, 0, 0];
      const len = Math.hypot(end[0], end[2]) || 10;
      const sign = end[0] < 0 ? -1 : 1;
      const newEnd: [number, number, number] = [sign * len, 0, 0];

      await ipc.updateGeometry(docId, entity.id, { ...g, end: newEnd } as unknown as Geometry);
      this.register({
        id: `c-${Date.now()}`,
        name: `Horizontal (${entity.name || "Line"})`,
        kind: "horizontal",
        entityIds: [entity.id],
        createdAt: Date.now(),
      });
      await featureHistory.regenerate(entity.id, docId);
      const scene = await ipc.getScene(docId);
      useArcStore.getState().setScene(scene);
      useArcStore.getState().setStatusMessage(`Constrained ${entity.name || "Line"} to Horizontal`);
      return true;
    }
    if (entity.kind === "polyline_curve") {
      const pts = (g.points as [number, number, number][]) ?? [];
      if (pts.length >= 2) {
        const newPts = pts.map((p) => [...p] as [number, number, number]);
        newPts[1][2] = newPts[0][2];
        await ipc.updateGeometry(docId, entity.id, { ...g, points: newPts } as unknown as Geometry);
        await featureHistory.regenerate(entity.id, docId);
        const scene = await ipc.getScene(docId);
        useArcStore.getState().setScene(scene);
        useArcStore.getState().setStatusMessage("Constrained polyline segment to Horizontal");
        return true;
      }
    }
    return false;
  }

  /** Constrain a line or polyline segment to be vertical (along Z axis). */
  public async applyVertical(docId: string, entity: EntityData): Promise<boolean> {
    const g = entity.geometry as Record<string, unknown>;
    if (entity.kind === "line" || entity.kind === "line_curve") {
      const end = (g.end as [number, number, number]) ?? [0, 0, 10];
      const len = Math.hypot(end[0], end[2]) || 10;
      const sign = end[2] < 0 ? -1 : 1;
      const newEnd: [number, number, number] = [0, 0, sign * len];

      await ipc.updateGeometry(docId, entity.id, { ...g, end: newEnd } as unknown as Geometry);
      this.register({
        id: `c-${Date.now()}`,
        name: `Vertical (${entity.name || "Line"})`,
        kind: "vertical",
        entityIds: [entity.id],
        createdAt: Date.now(),
      });
      await featureHistory.regenerate(entity.id, docId);
      const scene = await ipc.getScene(docId);
      useArcStore.getState().setScene(scene);
      useArcStore.getState().setStatusMessage(`Constrained ${entity.name || "Line"} to Vertical`);
      return true;
    }
    if (entity.kind === "polyline_curve") {
      const pts = (g.points as [number, number, number][]) ?? [];
      if (pts.length >= 2) {
        const newPts = pts.map((p) => [...p] as [number, number, number]);
        newPts[1][0] = newPts[0][0];
        await ipc.updateGeometry(docId, entity.id, { ...g, points: newPts } as unknown as Geometry);
        await featureHistory.regenerate(entity.id, docId);
        const scene = await ipc.getScene(docId);
        useArcStore.getState().setScene(scene);
        useArcStore.getState().setStatusMessage("Constrained polyline segment to Vertical");
        return true;
      }
    }
    return false;
  }

  /** Constrain length / dimension of entity. */
  public async applyDistance(docId: string, entity: EntityData, targetLen: number): Promise<boolean> {
    const g = entity.geometry as Record<string, unknown>;
    if (entity.kind === "line" || entity.kind === "line_curve") {
      const end = (g.end as [number, number, number]) ?? [10, 0, 0];
      const curLen = Math.hypot(end[0], end[2]) || 1;
      const ratio = targetLen / curLen;
      const newEnd: [number, number, number] = [end[0] * ratio, 0, end[2] * ratio];

      await ipc.updateGeometry(docId, entity.id, { ...g, end: newEnd } as unknown as Geometry);
      this.register({
        id: `c-${Date.now()}`,
        name: `Length ${Math.round(targetLen * 10) / 10} (${entity.name || "Line"})`,
        kind: "distance",
        value: targetLen,
        entityIds: [entity.id],
        createdAt: Date.now(),
      });
      await featureHistory.regenerate(entity.id, docId);
      const scene = await ipc.getScene(docId);
      useArcStore.getState().setScene(scene);
      useArcStore.getState().setStatusMessage(`Set length to ${Math.round(targetLen * 100) / 100}`);
      return true;
    }
    return false;
  }

  /** Make rectangle equal width and depth (square). */
  public async applySquare(docId: string, entity: EntityData): Promise<boolean> {
    const g = entity.geometry as Record<string, unknown>;
    const w = typeof g.width === "number" ? g.width : 10;
    await ipc.updateGeometry(docId, entity.id, { ...g, width: w, depth: w } as unknown as Geometry);
    this.register({
      id: `c-${Date.now()}`,
      name: `Square (${entity.name || "Rectangle"})`,
      kind: "equal_length",
      entityIds: [entity.id],
      createdAt: Date.now(),
    });
    await featureHistory.regenerate(entity.id, docId);
    const scene = await ipc.getScene(docId);
    useArcStore.getState().setScene(scene);
    useArcStore.getState().setStatusMessage("Constrained rectangle to Square");
    return true;
  }

  /** Coincident constraint between two sketch entities: snaps Entity B's start to Entity A's end. */
  public async applyCoincident(docId: string, entityA: EntityData, entityB: EntityData): Promise<boolean> {
    const posA = new THREE.Vector3(...entityA.transform.position);
    const rotA = new THREE.Quaternion(...entityA.transform.rotation);
    const gA = entityA.geometry as Record<string, unknown>;
    const endA = (gA.end as [number, number, number]) ?? [10, 0, 0];
    const localEndVecA = new THREE.Vector3(...endA);
    const worldEndA = posA.clone().add(localEndVecA.applyQuaternion(rotA));

    const tB = entityB.transform;
    await ipc.setTransform(
      docId,
      [
        {
          id: entityB.id,
          transform: {
            position: [worldEndA.x, worldEndA.y, worldEndA.z],
            rotation: tB.rotation,
            scale: tB.scale,
          },
        },
      ],
      true,
    );

    this.register({
      id: `c-${Date.now()}`,
      name: `Coincident (${entityB.name || "Sketch B"} → ${entityA.name || "Sketch A"})`,
      kind: "coincident",
      entityIds: [entityA.id, entityB.id],
      createdAt: Date.now(),
    });

    await featureHistory.regenerate(entityA.id, docId);
    await featureHistory.regenerate(entityB.id, docId);
    const scene = await ipc.getScene(docId);
    useArcStore.getState().setScene(scene);
    useArcStore.getState().setStatusMessage(`Snapped ${entityB.name || "Sketch B"} coincident to ${entityA.name || "Sketch A"}`);
    return true;
  }

  /** Make Entity B parallel to Entity A. */
  public async applyParallel(docId: string, entityA: EntityData, entityB: EntityData): Promise<boolean> {
    const gA = entityA.geometry as Record<string, unknown>;
    const gB = entityB.geometry as Record<string, unknown>;
    const endA = (gA.end as [number, number, number]) ?? [10, 0, 0];
    const endB = (gB.end as [number, number, number]) ?? [10, 0, 0];

    const angA = Math.atan2(endA[2], endA[0]);
    const lenB = Math.hypot(endB[0], endB[2]) || 10;
    const newEndB: [number, number, number] = [lenB * Math.cos(angA), 0, lenB * Math.sin(angA)];

    await ipc.updateGeometry(docId, entityB.id, { ...gB, end: newEndB } as unknown as Geometry);
    this.register({
      id: `c-${Date.now()}`,
      name: `Parallel (${entityB.name || "Line B"} ∥ ${entityA.name || "Line A"})`,
      kind: "parallel",
      entityIds: [entityA.id, entityB.id],
      createdAt: Date.now(),
    });

    await featureHistory.regenerate(entityB.id, docId);
    const scene = await ipc.getScene(docId);
    useArcStore.getState().setScene(scene);
    useArcStore.getState().setStatusMessage(`Made ${entityB.name || "Line B"} parallel to ${entityA.name || "Line A"}`);
    return true;
  }

  /** Make Entity B perpendicular to Entity A. */
  public async applyPerpendicular(docId: string, entityA: EntityData, entityB: EntityData): Promise<boolean> {
    const gA = entityA.geometry as Record<string, unknown>;
    const gB = entityB.geometry as Record<string, unknown>;
    const endA = (gA.end as [number, number, number]) ?? [10, 0, 0];
    const endB = (gB.end as [number, number, number]) ?? [10, 0, 0];

    const angPerp = Math.atan2(endA[2], endA[0]) + Math.PI / 2;
    const lenB = Math.hypot(endB[0], endB[2]) || 10;
    const newEndB: [number, number, number] = [lenB * Math.cos(angPerp), 0, lenB * Math.sin(angPerp)];

    await ipc.updateGeometry(docId, entityB.id, { ...gB, end: newEndB } as unknown as Geometry);
    this.register({
      id: `c-${Date.now()}`,
      name: `Perpendicular (${entityB.name || "Line B"} ⊥ ${entityA.name || "Line A"})`,
      kind: "perpendicular",
      entityIds: [entityA.id, entityB.id],
      createdAt: Date.now(),
    });

    await featureHistory.regenerate(entityB.id, docId);
    const scene = await ipc.getScene(docId);
    useArcStore.getState().setScene(scene);
    useArcStore.getState().setStatusMessage(`Made ${entityB.name || "Line B"} perpendicular to ${entityA.name || "Line A"}`);
    return true;
  }

  /** Make Entity B equal in length to Entity A. */
  public async applyEqualLength(docId: string, entityA: EntityData, entityB: EntityData): Promise<boolean> {
    const gA = entityA.geometry as Record<string, unknown>;
    const gB = entityB.geometry as Record<string, unknown>;
    const endA = (gA.end as [number, number, number]) ?? [10, 0, 0];
    const endB = (gB.end as [number, number, number]) ?? [10, 0, 0];

    const lenA = Math.hypot(endA[0], endA[2]) || 10;
    const lenB = Math.hypot(endB[0], endB[2]) || 1;
    const ratio = lenA / lenB;
    const newEndB: [number, number, number] = [endB[0] * ratio, 0, endB[2] * ratio];

    await ipc.updateGeometry(docId, entityB.id, { ...gB, end: newEndB } as unknown as Geometry);
    this.register({
      id: `c-${Date.now()}`,
      name: `Equal Length (${entityB.name || "Line B"} = ${entityA.name || "Line A"})`,
      kind: "equal_length",
      entityIds: [entityA.id, entityB.id],
      createdAt: Date.now(),
    });

    await featureHistory.regenerate(entityB.id, docId);
    const scene = await ipc.getScene(docId);
    useArcStore.getState().setScene(scene);
    useArcStore.getState().setStatusMessage(`Set ${entityB.name || "Line B"} length equal to ${entityA.name || "Line A"}`);
    return true;
  }
}

export const constraintManager = new ConstraintManager();
