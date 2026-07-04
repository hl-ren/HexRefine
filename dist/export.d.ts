import type { ActiveMeshSetRemapResult, CellId, RefinementSession, RefinementSessionExportResult, RefinementSessionSetRemapInput } from "./refinement-session.js";
import type { Element, ElementKind, Mesh, Point } from "./types.js";
export interface VtkOptions {
    title?: string;
    cellScalars?: Record<string, readonly number[]>;
}
export type ExportElementKind = "Q4" | "T3" | "Q9" | "H8" | "H20";
export type ExportTargetKind = "native" | ExportElementKind | ElementKind;
export interface ExportMesh {
    kind: ExportElementKind;
    nodes: Point[];
    elements: Element[];
}
export interface PreparedExportResult {
    mesh: ExportMesh;
    sourceElementIds: number[];
    sets: ActiveMeshSetRemapResult;
}
export interface NativeSessionExportPlan {
    kind: "Q4" | "H8";
    session: RefinementSession;
    activeCellIds: CellId[];
    nodes: Point[];
    nodeIdBySessionNodeId: Map<number, number>;
    sets: ActiveMeshSetRemapResult;
}
export interface NativeSessionExportOptions {
    mergeTolerance?: number;
    sets?: RefinementSessionSetRemapInput;
}
export interface InpMaterial {
    name: string;
    elasticModulus?: number;
    poissonRatio?: number;
}
export type InpMaterialEntries = ReadonlyMap<string, InpMaterial> | Iterable<readonly [string, InpMaterial]>;
export interface InpOptions {
    title?: string;
    elementKind?: ExportTargetKind;
    materials?: InpMaterialEntries;
    includeBoundarySets?: boolean;
}
export declare function exportKindOptionsForMeshKind(kind: ElementKind): readonly ExportElementKind[];
export declare function normalizeExportKind(meshKind: ElementKind, requested?: ExportTargetKind): ExportElementKind;
export declare function prepareExportMesh(exported: RefinementSessionExportResult, requestedKind?: ExportTargetKind): PreparedExportResult;
export declare function convertMeshForExport(mesh: Mesh, requestedKind?: ExportTargetKind): {
    mesh: ExportMesh;
    sourceElementIds: number[];
};
export declare function buildNativeSessionExportPlan(session: RefinementSession, options?: NativeSessionExportOptions): NativeSessionExportPlan;
export declare function iterateLegacyVtkLines(mesh: Mesh | ExportMesh, options?: VtkOptions): Generator<string>;
export declare function iterateNativeSessionVtkLines(plan: NativeSessionExportPlan, options?: VtkOptions): Generator<string>;
export declare function meshToLegacyVtk(mesh: Mesh | ExportMesh, options?: VtkOptions): string;
export declare function refinementSessionExportToInp(exported: RefinementSessionExportResult, options?: InpOptions): string;
export declare function preparedExportToInp(prepared: PreparedExportResult, options?: InpOptions): string;
export declare function iterateNativeSessionInpLines(plan: NativeSessionExportPlan, options?: InpOptions): Generator<string>;
export declare function iteratePreparedInpLines(prepared: PreparedExportResult, options?: InpOptions): Generator<string>;
export declare function missingSetSummary(sets: RefinementSessionExportResult["sets"]): {
    missingCells: number;
    missingNodes: number;
};
