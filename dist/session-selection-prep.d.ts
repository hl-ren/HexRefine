import type { ActiveMeshBuildResult, CellId, RefinementSession } from "./refinement-session.js";
import type { HexIndexRange, RefineOptions, RegularizedHexSelection } from "./types.js";
interface RankIndex {
    coordinates: [number[], number[], number[]];
    elementIdByRank: Map<string, number>;
    ranksByElementId: Map<number, [number, number, number]>;
    tolerance: number;
}
interface StructuredRegularizedHexSelection extends RegularizedHexSelection {
    rankIndex?: RankIndex;
    components?: Array<{
        originalElementIds: number[];
        selectedElementIds: number[];
        addedElementIds: number[];
        removedElementIds: number[];
        gridDimensions?: [number, number, number];
        indexRange?: HexIndexRange;
        warnings: string[];
    }>;
}
export interface PreparedSessionRefineSelection {
    elementIds: number[];
    cellIds: CellId[];
    regularization?: StructuredRegularizedHexSelection;
    outerElementIds?: number[];
    outerCellIds?: CellId[];
    sourceElementCount?: number;
    expandedCandidateCount?: number;
    boundedCoreCount?: number;
    transitionEscapeCount?: number;
    warnings: string[];
    notice?: string;
}
export declare function prepareSessionRefineSelection(session: RefinementSession, active: ActiveMeshBuildResult, selectedElementIds: readonly number[], options?: RefineOptions): PreparedSessionRefineSelection;
export {};
