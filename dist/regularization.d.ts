import type { HexSelectionRegularizationOptions, Mesh, RegularizedHexSelection } from "./types.js";
export declare function regularizeHexSelection(mesh: Mesh, candidateElementIds: readonly number[], options?: HexSelectionRegularizationOptions): RegularizedHexSelection;
