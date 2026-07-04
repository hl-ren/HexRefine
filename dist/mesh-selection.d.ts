import type { BoxRange, Mesh, Point } from "./types.js";
import { type DistanceFunction, type DistanceSelection } from "./distance.js";
export declare function pointInBox(point: Point, box: BoxRange): boolean;
export declare function selectElementsByDistanceFunction(mesh: Mesh, distanceFunction: DistanceFunction, distValue?: number): DistanceSelection;
