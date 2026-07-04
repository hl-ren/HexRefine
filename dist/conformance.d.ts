import type { Mesh } from "./types.js";
export interface HangingEntity {
    kind: "node-on-edge" | "node-on-face" | "overlapping-edge" | "overlapping-face";
    nodeId?: number;
    ownerElementId: number;
    otherElementId: number;
    boundary: number[];
    otherBoundary: number[];
    message: string;
}
export interface ConformanceReport {
    ok: boolean;
    hanging: HangingEntity[];
    unmatchedInteriorBoundaryCount: number;
}
export declare function checkNoHangingNodes(mesh: Mesh, tolerance?: number): ConformanceReport;
