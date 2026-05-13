export type DistanceFunction = (...coords: number[]) => number;
export type DistancePoint = readonly number[];

export interface DistanceSelection {
  inside: number[];
  inDistanceBand: number[];
  values: number[];
}

export function Or0(...values: readonly number[]): number {
  assertNonEmpty(values, "Or0");
  return Math.max(...values);
}

export function And0(...values: readonly number[]): number {
  assertNonEmpty(values, "And0");
  return Math.min(...values);
}

export function Not0(value: number): number {
  return -value;
}

export function findPointsByDistanceFunction(
  points: readonly DistancePoint[],
  distanceFunction: DistanceFunction,
  distValue: number
): DistanceSelection {
  const inside: number[] = [];
  const inDistanceBand: number[] = [];
  const values: number[] = [];

  points.forEach((point, index) => {
    const value = distanceFunction(...point);
    values.push(value);
    if (value < distValue) {
      return;
    }
    if (value >= 0) {
      inside.push(index + 1);
    } else {
      inDistanceBand.push(index + 1);
    }
  });

  return { inside, inDistanceBand, values };
}

export function boxDistance(min: DistancePoint, max: DistancePoint): DistanceFunction {
  if (min.length !== max.length) {
    throw new Error("boxDistance requires min and max with the same dimension");
  }
  return (...coords: number[]) => {
    if (coords.length !== min.length) {
      throw new Error(`boxDistance expected ${min.length} coordinates, got ${coords.length}`);
    }
    const constraints: number[] = [];
    for (let i = 0; i < coords.length; i += 1) {
      constraints.push(coords[i]! - min[i]!);
      constraints.push(max[i]! - coords[i]!);
    }
    return And0(...constraints);
  };
}

export function sphereDistance(center: DistancePoint, radius: number): DistanceFunction {
  if (radius < 0) {
    throw new Error("sphereDistance radius must be non-negative");
  }
  return (...coords: number[]) => {
    if (coords.length !== center.length) {
      throw new Error(`sphereDistance expected ${center.length} coordinates, got ${coords.length}`);
    }
    return radius - distance(coords, center);
  };
}

export function circleDistance(center: DistancePoint, radius: number): DistanceFunction {
  if (center.length !== 2) {
    throw new Error("circleDistance requires a 2D center");
  }
  return sphereDistance(center, radius);
}

export function halfSpaceDistance(normal: DistancePoint, offset: number): DistanceFunction {
  const normalLength = distance(normal, Array.from({ length: normal.length }, () => 0));
  if (normalLength === 0) {
    throw new Error("halfSpaceDistance normal must be non-zero");
  }
  return (...coords: number[]) => {
    if (coords.length !== normal.length) {
      throw new Error(`halfSpaceDistance expected ${normal.length} coordinates, got ${coords.length}`);
    }
    return (dot(normal, coords) - offset) / normalLength;
  };
}

export function bandDistance(distanceFunction: DistanceFunction, innerOffset: number, outerOffset: number): DistanceFunction {
  if (innerOffset > outerOffset) {
    throw new Error("bandDistance innerOffset must be <= outerOffset");
  }
  return (...coords: number[]) => {
    const value = distanceFunction(...coords);
    return And0(value - innerOffset, outerOffset - value);
  };
}

function assertNonEmpty(values: readonly number[], name: string): void {
  if (values.length === 0) {
    throw new Error(`${name} requires at least one value`);
  }
}

function dot(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    total += a[i]! * b[i]!;
  }
  return total;
}

function distance(a: readonly number[], b: readonly number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i]! - b[i]!;
    total += delta * delta;
  }
  return Math.sqrt(total);
}
