import type { BoundaryPair, Element, ElementKind, LocalRefinement, Mesh, Point, ReplaceElement } from "./types.js";
export interface NodeMergeResult {
    mesh: Mesh;
    nodeIdByInputNodeId: Map<number, number>;
    inputNodeIdsByNodeId: Map<number, number[]>;
    nodeIdByInputNodeIdArray?: number[];
    inputNodeIdsByNodeIdArray?: number[][];
}
export declare function inferMeshKind(mesh: Mesh): ElementKind;
export declare function elementVertices(mesh: Mesh, element: Element): Point[];
export declare function elementCenter(mesh: Mesh, element: Element): Point;
export declare function elementCenters(mesh: Mesh): Point[];
export declare function selectElementsByPredicate(mesh: Mesh, predicate: (center: Point, element: Element, elementId: number) => boolean): number[];
export declare function findBoundaryPairs(mesh: Mesh, selectedElementIds: readonly number[]): BoundaryPair[];
export declare function replaceElements(mesh: Mesh, replacements: readonly ReplaceElement[], mergeTolerance: number): Mesh;
export declare function mergeCoincidentNodes(mesh: Mesh, tolerance: number): Mesh;
export declare function mergeCoincidentNodesWithMap(mesh: Mesh, tolerance: number): NodeMergeResult;
export declare function minElementEdgeLength(mesh: Mesh): number;
export declare function instantiateOnElement(mesh: Mesh, elementId: number, factory: (vertices: Point[]) => LocalRefinement): ReplaceElement;
