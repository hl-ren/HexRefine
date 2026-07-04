export type DistanceFunction = (...coords: number[]) => number;
export type DistancePoint = readonly number[];
export interface DistanceSelection {
    inside: number[];
    inDistanceBand: number[];
    values: number[];
}
export declare function Or0(...values: readonly number[]): number;
export declare function And0(...values: readonly number[]): number;
export declare function Not0(value: number): number;
export declare function findPointsByDistanceFunction(points: readonly DistancePoint[], distanceFunction: DistanceFunction, distValue: number): DistanceSelection;
export declare function boxDistance(min: DistancePoint, max: DistancePoint): DistanceFunction;
export declare function sphereDistance(center: DistancePoint, radius: number): DistanceFunction;
export declare function circleDistance(center: DistancePoint, radius: number): DistanceFunction;
export declare function halfSpaceDistance(normal: DistancePoint, offset: number): DistanceFunction;
export declare function bandDistance(distanceFunction: DistanceFunction, innerOffset: number, outerOffset: number): DistanceFunction;
