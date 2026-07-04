import type { CellId, RefinementSession } from "./refinement-session.js";
import type { Mesh, Point } from "./types.js";
export interface ComformHexCommand {
    index?: number;
    time?: string;
    kind: string;
    payload?: Record<string, unknown>;
}
export interface ComformHexCommandScript {
    format?: string;
    version?: number;
    app?: string;
    createdAt?: string;
    savedAt?: string;
    commands: ComformHexCommand[];
}
export interface ComformHexMaterial {
    name: string;
    elasticModulus?: number;
    poissonRatio?: number;
}
export interface ComformHexReplayResult {
    session: RefinementSession;
    mesh: Mesh;
    mergeTolerance?: number;
    cellSets: Map<string, CellId[]>;
    nodeSets: Map<string, number[]>;
    cellSetMaterials: Map<string, ComformHexMaterial>;
    warnings: string[];
    selectionDiagnostics: ComformHexReplaySelectionDiagnostic[];
    replayedCommandCount: number;
}
export interface ReplayComformHexCommandScriptOptions {
    gridOverride?: {
        kind?: "Q1" | "H1";
        nx?: number;
        ny?: number;
        nz?: number;
        bounds?: {
            min: Point;
            max: Point;
        };
    };
    mergeTolerance?: number;
    selectionStrategy?: "recorded" | "replay";
    strict?: boolean;
}
export interface ComformHexReplaySelectionDiagnostic {
    commandKind: "refine.patch";
    selectionSource: "state.selected-elements" | "payload.replaySelection" | "payload.cellIds" | "payload.elementIds";
    sourceElementCount?: number;
    preparedElementCount?: number;
    preparedCellCount?: number;
    stabilizedCellCount?: number;
    expandedCandidateCount?: number;
    boundedCoreCount?: number;
    outerElementCount?: number;
    transitionEscapeCount?: number;
    warnings: string[];
    notice?: string;
}
export type HexRefineCommand = ComformHexCommand;
export type HexRefineCommandScript = ComformHexCommandScript;
export type HexRefineMaterial = ComformHexMaterial;
export type HexRefineReplayResult = ComformHexReplayResult;
export type ReplayHexRefineCommandScriptOptions = ReplayComformHexCommandScriptOptions;
export type HexRefineReplaySelectionDiagnostic = ComformHexReplaySelectionDiagnostic;
export declare function replayComformHexCommandScript(script: ComformHexCommandScript, options?: ReplayComformHexCommandScriptOptions): ComformHexReplayResult;
export declare const replayHexRefineCommandScript: typeof replayComformHexCommandScript;
