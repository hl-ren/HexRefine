import type { Element, ElementKind, LocalRefinement, Mesh, Point, RefinementRole } from "./types.js";
import { type ConformanceReport } from "./conformance.js";
export type CellId = string;
export type RefinementSessionCellRole = "base" | RefinementRole;
export interface RefinementSessionCell {
    id: CellId;
    ordinal: number;
    parentId?: CellId;
    level: number;
    role: RefinementSessionCellRole;
    kind: ElementKind;
    element: Element;
    children: CellId[];
    active: boolean;
    hidden: boolean;
    sourceElementId?: number;
    template?: string;
}
export interface RefinementSessionCommand {
    id: string;
    kind: "refine";
    hiddenCellIds: CellId[];
    createdCellIds: CellId[];
    createdNodeIds: number[];
}
export interface RefinementSession {
    baseMesh: Mesh;
    kind: ElementKind;
    nodes: Point[];
    cells: Map<CellId, RefinementSessionCell>;
    activeLeafIds: Set<CellId>;
    sortedActiveLeafIds: CellId[];
    sortedActiveLeafIdsDirty: boolean;
    activeLeafIdsByNodeKey: Map<string, CellId[]>;
    undoStack: RefinementSessionCommand[];
    redoStack: RefinementSessionCommand[];
    nextCommandId: number;
    nextCellOrdinal: number;
}
export interface BuildActiveMeshOptions {
    mergeNodes?: boolean;
    mergeTolerance?: number;
    includeElementIdsByNodeId?: boolean;
    includeCellIdByElementId?: boolean;
    includeElementIdByCellId?: boolean;
    includeSessionNodeIdByNodeId?: boolean;
    includeSessionNodeIdsByNodeId?: boolean;
}
export interface ActiveMeshBuildResult {
    mesh: Mesh;
    cellIdByElementId: Map<number, CellId>;
    elementIdByCellId: Map<CellId, number>;
    cellIdsByElementIdArray?: CellId[];
    elementIdByCellOrdinalArray?: Int32Array;
    nodeIdBySessionNodeId: Map<number, number>;
    sessionNodeIdByNodeId: Map<number, number>;
    sessionNodeIdsByNodeId: Map<number, number[]>;
    elementIdsByNodeId?: Map<number, number[]>;
}
export type RefinementSessionNamedSets<T extends string | number> = ReadonlyMap<string, readonly T[]> | Record<string, readonly T[]>;
export interface RefinementSessionSetRemapInput {
    cellSets?: RefinementSessionNamedSets<CellId>;
    nodeSets?: RefinementSessionNamedSets<number>;
}
export interface ActiveMeshSetRemapResult {
    cellSets: Map<string, number[]>;
    nodeSets: Map<string, number[]>;
    missingCellIdsBySet: Map<string, CellId[]>;
    missingNodeIdsBySet: Map<string, number[]>;
}
export interface RefinementSessionExportOptions extends BuildActiveMeshOptions {
    sets?: RefinementSessionSetRemapInput;
}
export interface RefinementSessionExportResult {
    mesh: Mesh;
    build: ActiveMeshBuildResult;
    sets: ActiveMeshSetRemapResult;
}
export interface RefinementSessionLocalConformanceReport {
    report: ConformanceReport;
    mesh: Mesh;
    activeBuild: ActiveMeshBuildResult;
    checkedCellIds: CellId[];
    checkedElementIds: number[];
    seedCellIds: CellId[];
    seedElementIds: number[];
}
export interface RefinementSessionSelectionValidation {
    ok: boolean;
    cellIds: CellId[];
    level: number | undefined;
    missingCellIds: CellId[];
    inactiveCellIds: CellId[];
    transitionCellIds: CellId[];
    mixedLevelCellIds: CellId[];
    errors: string[];
}
export type LocalRefinementFactory = (vertices: Point[]) => LocalRefinement;
export interface RefinementSessionPatchOptions {
    includeTransitions?: boolean;
    transitionSupportCellIds?: readonly CellId[];
    mergeTolerance?: number;
    activeBuild?: ActiveMeshBuildResult;
}
export declare function createRefinementSession(mesh: Mesh): RefinementSession;
export declare function buildActiveMesh(session: RefinementSession, options?: BuildActiveMeshOptions): Mesh;
export declare function buildActiveMeshWithMap(session: RefinementSession, options?: BuildActiveMeshOptions): ActiveMeshBuildResult;
export declare function activeBuildCellIdByElementId(build: ActiveMeshBuildResult, elementId: number): CellId | undefined;
export declare function activeBuildElementIdByCellId(session: RefinementSession, build: ActiveMeshBuildResult, cellId: CellId): number | undefined;
export declare function remapSessionSetsToActiveMesh(build: ActiveMeshBuildResult, sets: RefinementSessionSetRemapInput): ActiveMeshSetRemapResult;
export declare function buildRefinementSessionExport(session: RefinementSession, options?: RefinementSessionExportOptions): RefinementSessionExportResult;
export declare function checkRefinementSessionCommandConformance(session: RefinementSession, command: RefinementSessionCommand, tolerance?: number, activeBuild?: ActiveMeshBuildResult): RefinementSessionLocalConformanceReport;
export declare function refineSessionCell(session: RefinementSession, cellId: CellId, factory: LocalRefinementFactory): RefinementSessionCommand;
export declare function refineSessionCells(session: RefinementSession, cellIds: CellId[], factory: LocalRefinementFactory): RefinementSessionCommand;
export declare function refineSessionPatch(session: RefinementSession, cellIds: CellId[], options?: RefinementSessionPatchOptions): RefinementSessionCommand;
export declare function validateRefinementSessionSelection(session: RefinementSession, cellIds: CellId[]): RefinementSessionSelectionValidation;
export declare function isRefinableSessionCell(cell: RefinementSessionCell): boolean;
export declare function undoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined;
export declare function redoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined;
