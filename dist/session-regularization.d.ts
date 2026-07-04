import type { HexSelectionRegularizationOptions, Mesh, RegularizedHexSelection } from "./types.js";
import { type CellId, type RefinementSession, type RefinementSessionSelectionValidation } from "./refinement-session.js";
export interface RegularizedHexSessionSelection {
    ok: boolean;
    level: number | undefined;
    sourceCellIds: CellId[];
    expandedCellIds: CellId[];
    originalCellIds: CellId[];
    selectedCellIds: CellId[];
    addedCellIds: CellId[];
    removedCellIds: CellId[];
    ignoredCellIds: CellId[];
    regularization: RegularizedHexSelection;
    validation: RefinementSessionSelectionValidation;
    warnings: string[];
}
export interface HexSessionSelectionRegularizationOptions extends HexSelectionRegularizationOptions {
    growTopologyLayers?: number;
    domain?: HexSessionRegularizationDomain;
}
export interface HexSessionRegularizationDomain {
    level: number;
    cellIds: CellId[];
    mesh: Mesh;
    cellIdByElementId: Map<number, CellId>;
    elementIdByCellId: Map<CellId, number>;
}
export declare function regularizeHexSessionSelection(session: RefinementSession, candidateCellIds: readonly CellId[], options?: HexSessionSelectionRegularizationOptions): RegularizedHexSessionSelection;
export declare function buildHexSessionRegularizationDomain(session: RefinementSession, level: number): HexSessionRegularizationDomain;
