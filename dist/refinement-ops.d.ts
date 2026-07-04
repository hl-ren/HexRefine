import type { BoxRange, HexSelectionRegularizationOptions, Mesh, Point, RefineOptions, RefinementPreview, RefinementResult, RefinementRole, RegularizedHexSelection, ReplaceElement } from "./types.js";
import { type DistanceFunction, type DistanceSelection } from "./distance.js";
export interface ClassifiedReplacement extends ReplaceElement {
    role: RefinementRole;
    templateCode: number;
}
export declare function refineByElementIds(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): Mesh;
export declare function buildRefinementReplacements(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): ClassifiedReplacement[];
export declare function refineByElementIdsWithReport(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): RefinementResult;
export declare function refineByBox(mesh: Mesh, box: BoxRange, options?: RefineOptions): Mesh;
export declare function refineByBoxWithReport(mesh: Mesh, box: BoxRange, options?: RefineOptions): RefinementResult;
export declare function refineByDistanceFunction(mesh: Mesh, distanceFunction: DistanceFunction, distValue?: number, options?: RefineOptions): Mesh;
export declare function refineByDistanceFunctionWithReport(mesh: Mesh, distanceFunction: DistanceFunction, distValue?: number, options?: RefineOptions): RefinementResult;
export declare function previewRefinementByElementIds(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): RefinementPreview;
export declare function previewRefinementByBox(mesh: Mesh, box: BoxRange, options?: RefineOptions): RefinementPreview;
export declare function previewRefinementByDistanceFunction(mesh: Mesh, distanceFunction: DistanceFunction, distValue?: number, options?: RefineOptions): RefinementPreview;
export declare function selectElementsByDistanceFunction(mesh: Mesh, distanceFunction: DistanceFunction, distValue?: number): DistanceSelection;
export declare function regularizeHexSelection(mesh: Mesh, candidateElementIds: readonly number[], options?: HexSelectionRegularizationOptions): RegularizedHexSelection;
export declare function pointInBox(point: Point, box: BoxRange): boolean;
