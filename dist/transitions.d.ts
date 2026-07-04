import type { BoundaryPair, Mesh, RefineOptions, RefinementRole, ReplaceElement } from "./types.js";
export interface ClassifiedHexReplacement extends ReplaceElement {
    role: RefinementRole;
    templateCode: number;
}
export declare function buildHexClassifiedReplacements(mesh: Mesh, selected: readonly number[], options?: RefineOptions): ClassifiedHexReplacement[];
export declare function hexFaceTransitionReplacements(mesh: Mesh, boundaryPairs: readonly BoundaryPair[], mergeTolerance: number): ClassifiedHexReplacement[];
export declare function hexEdgeTransitionReplacements(mesh: Mesh, boundaryPairs: readonly BoundaryPair[]): ClassifiedHexReplacement[];
