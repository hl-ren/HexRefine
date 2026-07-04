import type { Mesh, RefineOptions, RefinementRole, ReplaceElement } from "./types.js";
export interface ClassifiedReplacement extends ReplaceElement {
    role: RefinementRole;
    templateCode: number;
}
export interface RefinementPlanner {
    plan(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): ClassifiedReplacement[];
}
export declare const defaultRefinementPlanner: RefinementPlanner;
export declare function buildDefaultRefinementReplacements(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): ClassifiedReplacement[];
