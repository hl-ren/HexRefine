import type { ElementKind, Mesh, Point } from "./types.js";
import { boundariesOf, boundaryKey } from "./topology.js";
import { inferMeshKind } from "./mesh.js";
import { distance } from "./vector.js";

export interface HangingEntity {
  kind: "node-on-edge" | "node-on-face" | "overlapping-edge" | "overlapping-face";
  nodeId?: number;
  ownerElementId: number;
  otherElementId: number;
  boundary: number[];
  otherBoundary: number[];
  message: string;
}

export interface ConformanceReport {
  ok: boolean;
  hanging: HangingEntity[];
  unmatchedInteriorBoundaryCount: number;
}

interface BoundaryRecord {
  elementId: number;
  nodeIds: number[];
  key: string;
  points?: Point[];
  bbox?: BoundaryBox;
}

interface BoundaryBox {
  min: [number, number, number];
  max: [number, number, number];
}

export function checkNoHangingNodes(mesh: Mesh, tolerance = 1e-9): ConformanceReport {
  const kind = inferMeshKind(mesh);
  const unmatched = collectUnmatchedBoundaries(mesh, kind);
  const hanging: HangingEntity[] = [];
  const seen = new Set<string>();

  compareNearbyUnmatchedBoundaries(mesh, unmatched, kind, tolerance, hanging, seen);

  return {
    ok: hanging.length === 0,
    hanging,
    unmatchedInteriorBoundaryCount: hanging.filter((issue) => issue.kind.startsWith("overlapping")).length
  };
}

function collectUnmatchedBoundaries(mesh: Mesh, kind: ElementKind): BoundaryRecord[] {
  const recordsByKey = new Map<string, BoundaryRecord | undefined>();
  mesh.elements.forEach((element, index) => {
    const elementId = index + 1;
    for (const nodeIds of boundariesOf(element, kind)) {
      const key = boundaryKey(nodeIds);
      if (recordsByKey.has(key)) {
        recordsByKey.set(key, undefined);
      } else {
        recordsByKey.set(key, { elementId, nodeIds, key });
      }
    }
  });
  return [...recordsByKey.values()].filter((record): record is BoundaryRecord => record !== undefined);
}

function compareNearbyUnmatchedBoundaries(
  mesh: Mesh,
  unmatched: BoundaryRecord[],
  kind: ElementKind,
  tolerance: number,
  hanging: HangingEntity[],
  seen: Set<string>
): void {
  if (unmatched.length <= 1) {
    return;
  }
  for (const boundary of unmatched) {
    boundary.points = boundaryPoints(mesh, boundary.nodeIds);
    boundary.bbox = boundaryBox(boundary.points);
  }
  const sweepAxis = chooseSweepAxis(unmatched);
  const sortedIndices = unmatched
    .map((_, index) => index)
    .sort((a, b) => unmatched[a]!.bbox!.min[sweepAxis] - unmatched[b]!.bbox!.min[sweepAxis]);
  const active: number[] = [];
  const compared = new Set<string>();

  for (const index of sortedIndices) {
    const boundary = unmatched[index]!;
    const boundaryMin = boundary.bbox!.min[sweepAxis];
    const stillActive = active.filter((otherIndex) =>
      unmatched[otherIndex]!.bbox!.max[sweepAxis] >= boundaryMin - tolerance
    );
    active.length = 0;
    active.push(...stillActive);
    for (const otherIndex of active) {
      const a = unmatched[otherIndex]!;
      const b = boundary;
      if (a.elementId === b.elementId || !boundaryBoxesOverlap(a.bbox!, b.bbox!, tolerance)) {
        continue;
      }
      const pairKey = otherIndex < index ? `${otherIndex}:${index}` : `${index}:${otherIndex}`;
      if (compared.has(pairKey)) {
        continue;
      }
      compared.add(pairKey);
      if (kind === "Q1") {
        addEdgeIssues(a, b, tolerance, hanging, seen);
      } else {
        addFaceIssues(a, b, tolerance, hanging, seen);
      }
    }
    active.push(index);
  }
}

function boundaryPoints(mesh: Mesh, nodeIds: readonly number[]): Point[] {
  return nodeIds.map((nodeId) => {
    const point = mesh.nodes[nodeId - 1];
    if (!point) {
      throw new Error(`missing node id ${nodeId}`);
    }
    return point;
  });
}

function boundaryBox(points: readonly Point[]): BoundaryBox {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = point[axis] ?? 0;
      min[axis] = Math.min(min[axis]!, value);
      max[axis] = Math.max(max[axis]!, value);
    }
  }
  return { min, max };
}

function chooseSweepAxis(unmatched: readonly BoundaryRecord[]): 0 | 1 | 2 {
  let bestAxis: 0 | 1 | 2 = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const axis of [0, 1, 2] as const) {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let totalSpan = 0;
    for (const boundary of unmatched) {
      const box = boundary.bbox!;
      min = Math.min(min, box.min[axis]);
      max = Math.max(max, box.max[axis]);
      totalSpan += box.max[axis] - box.min[axis];
    }
    const globalSpan = max - min;
    const averageSpan = totalSpan / Math.max(unmatched.length, 1);
    const score = averageSpan > 0 ? globalSpan / averageSpan : globalSpan;
    if (score > bestScore) {
      bestScore = score;
      bestAxis = axis;
    }
  }
  return bestAxis;
}

function boundaryBoxesOverlap(a: BoundaryBox, b: BoundaryBox, tolerance: number): boolean {
  for (let axis = 0; axis < 3; axis += 1) {
    const overlap = Math.min(a.max[axis]!, b.max[axis]!) - Math.max(a.min[axis]!, b.min[axis]!);
    if (overlap < -tolerance) {
      return false;
    }
  }
  return true;
}

function addEdgeIssues(
  a: BoundaryRecord,
  b: BoundaryRecord,
  tolerance: number,
  hanging: HangingEntity[],
  seen: Set<string>
): void {
  const ap = a.points!;
  const bp = b.points!;
  if (!collinearSegments(ap[0]!, ap[1]!, bp[0]!, bp[1]!, tolerance)) {
    return;
  }
  if (!segmentsOverlap1d(ap[0]!, ap[1]!, bp[0]!, bp[1]!, tolerance)) {
    return;
  }
  const shared = new Set(a.nodeIds.filter((nodeId) => b.nodeIds.includes(nodeId)));
  if (shared.size === 2) {
    return;
  }
  addIssue("overlapping-edge", a, b, tolerance, hanging, seen);
  for (const [nodeId, point] of zipNodes(a)) {
    if (!shared.has(nodeId) && pointOnSegment(point, bp[0]!, bp[1]!, tolerance)) {
      addIssue("node-on-edge", a, b, tolerance, hanging, seen, nodeId);
    }
  }
  for (const [nodeId, point] of zipNodes(b)) {
    if (!shared.has(nodeId) && pointOnSegment(point, ap[0]!, ap[1]!, tolerance)) {
      addIssue("node-on-edge", b, a, tolerance, hanging, seen, nodeId);
    }
  }
}

function addFaceIssues(
  a: BoundaryRecord,
  b: BoundaryRecord,
  tolerance: number,
  hanging: HangingEntity[],
  seen: Set<string>
): void {
  const ap = a.points!;
  const bp = b.points!;
  if (!coplanarFaces(ap, bp, tolerance)) {
    return;
  }
  if (!axisAlignedBoxesOverlap(ap, bp, tolerance)) {
    return;
  }
  const shared = new Set(a.nodeIds.filter((nodeId) => b.nodeIds.includes(nodeId)));
  if (shared.size === 4) {
    return;
  }

  const aCenter = averagePoint(ap);
  const bCenter = averagePoint(bp);
  const hasActualOverlap = pointInQuad(aCenter, bp, tolerance) || pointInQuad(bCenter, ap, tolerance);
  if (!hasActualOverlap) {
    return;
  }

  addIssue("overlapping-face", a, b, tolerance, hanging, seen);
  for (const [nodeId, point] of zipNodes(a)) {
    if (!shared.has(nodeId) && pointInQuad(point, bp, tolerance)) {
      addIssue("node-on-face", a, b, tolerance, hanging, seen, nodeId);
    }
  }
  for (const [nodeId, point] of zipNodes(b)) {
    if (!shared.has(nodeId) && pointInQuad(point, ap, tolerance)) {
      addIssue("node-on-face", b, a, tolerance, hanging, seen, nodeId);
    }
  }
}

function addIssue(
  kind: HangingEntity["kind"],
  a: BoundaryRecord,
  b: BoundaryRecord,
  _tolerance: number,
  hanging: HangingEntity[],
  seen: Set<string>,
  nodeId?: number
): void {
  const key = [kind, nodeId ?? "", a.elementId, b.elementId, a.key, b.key].join("|");
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  const issue: HangingEntity = {
    kind,
    ownerElementId: a.elementId,
    otherElementId: b.elementId,
    boundary: a.nodeIds,
    otherBoundary: b.nodeIds,
    message: `${kind} between element ${a.elementId} [${a.nodeIds.join(",")}] and element ${b.elementId} [${b.nodeIds.join(",")}]`
  };
  if (nodeId !== undefined) {
    issue.nodeId = nodeId;
  }
  hanging.push(issue);
}

function zipNodes(boundary: BoundaryRecord): Array<[number, Point]> {
  const points = boundary.points!;
  return boundary.nodeIds.map((nodeId, index) => [nodeId, points[index]!] as [number, Point]);
}

function collinearSegments(a0: Point, a1: Point, b0: Point, b1: Point, tolerance: number): boolean {
  const axis = dominantAxis(a0, a1);
  for (const point of [b0, b1]) {
    if (distancePointToLine(point, a0, a1) > tolerance) {
      return false;
    }
  }
  return Math.abs((a1[axis] ?? 0) - (a0[axis] ?? 0)) > tolerance;
}

function pointOnSegment(point: Point, a: Point, b: Point, tolerance: number): boolean {
  if (distancePointToLine(point, a, b) > tolerance) {
    return false;
  }
  const axis = dominantAxis(a, b);
  const value = point[axis] ?? 0;
  const min = Math.min(a[axis] ?? 0, b[axis] ?? 0) - tolerance;
  const max = Math.max(a[axis] ?? 0, b[axis] ?? 0) + tolerance;
  return value >= min && value <= max;
}

function segmentsOverlap1d(a0: Point, a1: Point, b0: Point, b1: Point, tolerance: number): boolean {
  const axis = dominantAxis(a0, a1);
  const aMin = Math.min(a0[axis] ?? 0, a1[axis] ?? 0);
  const aMax = Math.max(a0[axis] ?? 0, a1[axis] ?? 0);
  const bMin = Math.min(b0[axis] ?? 0, b1[axis] ?? 0);
  const bMax = Math.max(b0[axis] ?? 0, b1[axis] ?? 0);
  return Math.min(aMax, bMax) - Math.max(aMin, bMin) > tolerance;
}

function coplanarFaces(a: readonly Point[], b: readonly Point[], tolerance: number): boolean {
  const normal = cross(sub(a[1]!, a[0]!), sub(a[3]!, a[0]!));
  const normalLength = norm3(normal);
  if (normalLength <= tolerance) {
    return false;
  }
  for (const point of b) {
    const signedDistance = Math.abs(dot(normal, sub(point, a[0]!)) / normalLength);
    if (signedDistance > tolerance) {
      return false;
    }
  }
  return true;
}

function pointInQuad(point: Point, quad: readonly Point[], tolerance: number): boolean {
  if (!coplanarFaces(quad, [point, point, point, point], tolerance)) {
    return false;
  }
  const normal = cross(sub(quad[1]!, quad[0]!), sub(quad[3]!, quad[0]!));
  const drop = dominantNormalAxis(normal);
  const polygon = quad.map((p) => dropAxis(p, drop));
  const p = dropAxis(point, drop);
  return pointInPolygon2d(p, polygon, tolerance);
}

function pointInPolygon2d(point: readonly [number, number], polygon: readonly [number, number][], tolerance: number): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (distancePointToSegment2d(point, pi, pj) <= tolerance) {
      return true;
    }
    const intersects = pi[1] > point[1] !== pj[1] > point[1] &&
      point[0] < ((pj[0] - pi[0]) * (point[1] - pi[1])) / (pj[1] - pi[1]) + pi[0];
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function axisAlignedBoxesOverlap(a: readonly Point[], b: readonly Point[], tolerance: number): boolean {
  const dimension = a[0]?.length ?? 0;
  for (let d = 0; d < dimension; d += 1) {
    const aValues = a.map((point) => point[d] ?? 0);
    const bValues = b.map((point) => point[d] ?? 0);
    const overlap = Math.min(Math.max(...aValues), Math.max(...bValues)) -
      Math.max(Math.min(...aValues), Math.min(...bValues));
    if (overlap < -tolerance) {
      return false;
    }
  }
  return true;
}

function averagePoint(points: readonly Point[]): Point {
  const dimension = points[0]?.length ?? 0;
  return Array.from({ length: dimension }, (_, d) =>
    points.reduce((total, point) => total + (point[d] ?? 0), 0) / points.length
  );
}

function dominantAxis(a: Point, b: Point): number {
  let axis = 0;
  let best = -Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const value = Math.abs((b[i] ?? 0) - (a[i] ?? 0));
    if (value > best) {
      best = value;
      axis = i;
    }
  }
  return axis;
}

function dominantNormalAxis(normal: readonly [number, number, number]): number {
  const values = normal.map((value) => Math.abs(value));
  return values.indexOf(Math.max(...values));
}

function distancePointToLine(point: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const ap = sub(point, a);
  const abLength = norm3(ab);
  if (abLength === 0) {
    return distance(point, a);
  }
  return norm3(cross(ab, ap)) / abLength;
}

function distancePointToSegment2d(point: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = point[0] - a[0];
  const apy = point[1] - a[1];
  const lengthSquared = abx * abx + aby * aby;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSquared));
  const x = a[0] + t * abx;
  const y = a[1] + t * aby;
  return Math.hypot(point[0] - x, point[1] - y);
}

function dropAxis(point: Point, axis: number): [number, number] {
  const values = [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
  values.splice(axis, 1);
  return [values[0]!, values[1]!];
}

function sub(a: Point, b: Point): [number, number, number] {
  return [
    (a[0] ?? 0) - (b[0] ?? 0),
    (a[1] ?? 0) - (b[1] ?? 0),
    (a[2] ?? 0) - (b[2] ?? 0)
  ];
}

function cross(a: readonly [number, number, number], b: readonly [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

function dot(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function norm3(a: readonly [number, number, number]): number {
  return Math.hypot(a[0], a[1], a[2]);
}
