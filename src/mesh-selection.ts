import type {
  BoxRange,
  Mesh,
  Point
} from "./types.js";
import { elementCenter } from "./mesh.js";
import { findPointsByDistanceFunction, type DistanceFunction, type DistanceSelection } from "./distance.js";

export function pointInBox(point: Point, box: BoxRange): boolean {
  if (point.length !== box.min.length || point.length !== box.max.length) {
    throw new Error("point and box dimensions must match");
  }
  return point.every((value, index) => value >= box.min[index]! && value <= box.max[index]!);
}

export function selectElementsByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0
): DistanceSelection {
  const centers = mesh.elements.map((element) => elementCenter(mesh, element));
  return findPointsByDistanceFunction(centers, distanceFunction, distValue);
}
