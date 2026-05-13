export type Point = readonly number[];
export type MutablePoint = number[];
export type Element = readonly number[];
export type ElementKind = "Q1" | "H1";

export interface Mesh {
  /**
   * Coordinates are stored in array order, while element connectivity uses
   * 1-based node ids to stay compatible with the Mathematica notebooks and
   * Abaqus-style input files.
   */
  nodes: Point[];
  elements: Element[];
  kind?: ElementKind;
}

export interface LocalRefinement {
  nodes: Point[];
  elements: Element[];
  kind: ElementKind;
  source: string;
}

export interface BoundaryPair {
  selectedElementId: number;
  neighborElementId: number;
  selectedBoundary: number[];
  neighborBoundary: number[];
}

export interface ReplaceElement {
  elementId: number;
  refinement: LocalRefinement;
}

export interface RefineOptions {
  mergeTolerance?: number;
  includeTransitions?: boolean;
  transitionSupportElementIds?: readonly number[];
  regularizeHexSelection?: boolean;
  regularizeHexBoundaryShell?: boolean;
  regularizationTolerance?: number;
}

export interface HexSelectionRegularizationOptions {
  tolerance?: number;
  boundaryShellOnly?: boolean;
}

export interface HexIndexRange {
  min: [number, number, number];
  max: [number, number, number];
  dimensions: [number, number, number];
}

export interface RegularizedHexSelection {
  originalElementIds: number[];
  selectedElementIds: number[];
  addedElementIds: number[];
  removedElementIds: number[];
  gridDimensions?: [number, number, number];
  indexRange?: HexIndexRange;
  warnings: string[];
}

export type RefinementRole = "unchanged" | "selected" | "face-transition" | "edge-transition" | "corner-transition";

export interface RefinementCellData {
  parentElementId: number;
  role: RefinementRole;
  /**
   * Numeric template code for compact GUI/VTK coloring.
   * H1 uses 27/13/5; Q1 uses 9/4/5; unchanged cells use 0.
   */
  templateCode: number;
}

export interface RefinementSummary {
  selectedElementCount: number;
  faceTransitionElementCount: number;
  edgeTransitionElementCount: number;
  cornerTransitionElementCount: number;
  unchangedElementCount: number;
  outputNodeCount: number;
  outputElementCount: number;
}

export interface RefinementResult {
  mesh: Mesh;
  cellData: RefinementCellData[];
  summary: RefinementSummary;
  regularization?: RegularizedHexSelection;
}

export interface RefinementPlanItem {
  parentElementId: number;
  role: RefinementRole;
  templateCode: number;
  outputElementCount: number;
}

export interface RefinementPlanSummary {
  selectedElementCount: number;
  faceTransitionElementCount: number;
  edgeTransitionElementCount: number;
  cornerTransitionElementCount: number;
  unchangedElementCount: number;
  estimatedOutputElementCount: number;
}

export interface RefinementPreview {
  kind: ElementKind;
  plan: RefinementPlanItem[];
  summary: RefinementPlanSummary;
  regularization?: RegularizedHexSelection;
}

export interface BoxRange {
  min: Point;
  max: Point;
}
