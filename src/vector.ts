import type { MutablePoint, Point } from "./types.js";

export function add(a: Point, b: Point): MutablePoint {
  assertSameDimension(a, b);
  return a.map((value, index) => value + mustGet(b, index));
}

export function sub(a: Point, b: Point): MutablePoint {
  assertSameDimension(a, b);
  return a.map((value, index) => value - mustGet(b, index));
}

export function scale(a: Point, factor: number): MutablePoint {
  return a.map((value) => value * factor);
}

export function mix(points: readonly Point[], weights: readonly number[]): MutablePoint {
  if (points.length === 0) {
    throw new Error("mix requires at least one point");
  }
  if (points.length !== weights.length) {
    throw new Error("mix requires the same number of points and weights");
  }
  const dimension = points[0]?.length ?? 0;
  const result = Array.from({ length: dimension }, () => 0);
  for (let i = 0; i < points.length; i += 1) {
    const point = mustGet(points, i);
    const weight = mustGet(weights, i);
    if (point.length !== dimension) {
      throw new Error("all points in mix must have the same dimension");
    }
    for (let d = 0; d < dimension; d += 1) {
      result[d] = (result[d] ?? 0) + mustGet(point, d) * weight;
    }
  }
  return result;
}

export function lerp(a: Point, b: Point, t: number): MutablePoint {
  assertSameDimension(a, b);
  return a.map((value, index) => value * (1 - t) + mustGet(b, index) * t);
}

export function norm(a: Point): number {
  return Math.sqrt(a.reduce((total, value) => total + value * value, 0));
}

export function distance(a: Point, b: Point): number {
  return norm(sub(a, b));
}

export function centroid(points: readonly Point[]): MutablePoint {
  if (points.length === 0) {
    throw new Error("centroid requires at least one point");
  }
  const weight = 1 / points.length;
  return mix(points, points.map(() => weight));
}

export function pointEquals(a: Point, b: Point, tolerance: number): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return distance(a, b) <= tolerance;
}

export function assertSameDimension(a: Point, b: Point): void {
  if (a.length !== b.length) {
    throw new Error(`point dimension mismatch: ${a.length} vs ${b.length}`);
  }
}

export function mustGet<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) {
    throw new Error(`index ${index} is out of range`);
  }
  return value;
}
