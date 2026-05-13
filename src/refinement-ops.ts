import type {
  BoxRange,
  HexSelectionRegularizationOptions,
  Mesh,
  Point,
  RefineOptions,
  RefinementCellData,
  RefinementPlanItem,
  RefinementPreview,
  RefinementResult,
  RefinementRole,
  RegularizedHexSelection,
  ReplaceElement
} from "./types.js";
import { type DistanceFunction, type DistanceSelection } from "./distance.js";
import {
  inferMeshKind,
  minElementEdgeLength,
  replaceElements,
  selectElementsByPredicate
} from "./mesh.js";
import { buildDefaultRefinementReplacements } from "./refinement-planner.js";
import { regularizeHexSelection as regularizeHexSelectionCore } from "./regularization.js";
import {
  pointInBox as pointInBoxCore,
  selectElementsByDistanceFunction as selectElementsByDistanceFunctionCore
} from "./mesh-selection.js";

export interface ClassifiedReplacement extends ReplaceElement {
  role: RefinementRole;
  templateCode: number;
}

export function refineByElementIds(mesh: Mesh, selectedElementIds: readonly number[], options: RefineOptions = {}): Mesh {
  return refineByElementIdsWithReport(mesh, selectedElementIds, options).mesh;
}

export function buildRefinementReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): ClassifiedReplacement[] {
  return buildDefaultRefinementReplacements(mesh, selectedElementIds, options);
}

export function refineByElementIdsWithReport(mesh: Mesh, selectedElementIds: readonly number[], options: RefineOptions = {}): RefinementResult {
  const selected = uniqueSorted(selectedElementIds);
  if (selected.length === 0) {
    return buildRefinementResult(mesh, mesh, [], selected.length);
  }

  const mergeTolerance = options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
  const replacements = buildDefaultRefinementReplacements(mesh, selected, {
    ...options,
    mergeTolerance
  });

  const refinedMesh = replaceElements(mesh, replacements, mergeTolerance);
  return buildRefinementResult(
    mesh,
    refinedMesh,
    replacements,
    selected.length
  );
}

export function refineByBox(mesh: Mesh, box: BoxRange, options: RefineOptions = {}): Mesh {
  return refineByBoxWithReport(mesh, box, options).mesh;
}

export function refineByBoxWithReport(mesh: Mesh, box: BoxRange, options: RefineOptions = {}): RefinementResult {
  const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
  const shouldRegularize = inferMeshKind(mesh) === "H1" && (options.regularizeHexSelection ?? true);
  if (!shouldRegularize) {
    return refineByElementIdsWithReport(mesh, candidateIds, options);
  }
  const regularizationOptions = options.regularizationTolerance === undefined
    ? {}
    : { tolerance: options.regularizationTolerance };
  const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
  const result = refineByElementIdsWithReport(mesh, regularization.selectedElementIds, {
    ...options,
    regularizeHexSelection: false
  });
  return {
    ...result,
    regularization
  };
}

export function refineByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0,
  options: RefineOptions = {}
): Mesh {
  return refineByDistanceFunctionWithReport(mesh, distanceFunction, distValue, options).mesh;
}

export function refineByDistanceFunctionWithReport(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0,
  options: RefineOptions = {}
): RefinementResult {
  const selection = selectElementsByDistanceFunction(mesh, distanceFunction, distValue);
  const candidateIds = selection.inside;
  const shouldRegularize = inferMeshKind(mesh) === "H1" && (options.regularizeHexSelection ?? true);
  if (!shouldRegularize) {
    return refineByElementIdsWithReport(mesh, candidateIds, options);
  }
  const regularizationOptions = options.regularizationTolerance === undefined
    ? {}
    : { tolerance: options.regularizationTolerance };
  const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
  const result = refineByElementIdsWithReport(mesh, regularization.selectedElementIds, {
    ...options,
    regularizeHexSelection: false
  });
  return {
    ...result,
    regularization
  };
}

export function previewRefinementByElementIds(mesh: Mesh, selectedElementIds: readonly number[], options: RefineOptions = {}): RefinementPreview {
  const kind = inferMeshKind(mesh);
  const selected = uniqueSorted(selectedElementIds);
  const replacements = buildDefaultRefinementReplacements(mesh, selected, options);
  return buildRefinementPreview(mesh, kind, replacements);
}

export function previewRefinementByBox(mesh: Mesh, box: BoxRange, options: RefineOptions = {}): RefinementPreview {
  const kind = inferMeshKind(mesh);
  const candidateIds = selectElementsByPredicate(mesh, (center) => pointInBox(center, box));
  const shouldRegularize = kind === "H1" && (options.regularizeHexSelection ?? true);
  if (!shouldRegularize) {
    return previewRefinementByElementIds(mesh, candidateIds, options);
  }
  const regularizationOptions = options.regularizationTolerance === undefined
    ? {}
    : { tolerance: options.regularizationTolerance };
  const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
  const preview = previewRefinementByElementIds(mesh, regularization.selectedElementIds, {
    ...options,
    regularizeHexSelection: false
  });
  return {
    ...preview,
    regularization
  };
}

export function previewRefinementByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0,
  options: RefineOptions = {}
): RefinementPreview {
  const selection = selectElementsByDistanceFunction(mesh, distanceFunction, distValue);
  const candidateIds = selection.inside;
  const kind = inferMeshKind(mesh);
  const shouldRegularize = kind === "H1" && (options.regularizeHexSelection ?? true);
  if (!shouldRegularize) {
    return previewRefinementByElementIds(mesh, candidateIds, options);
  }
  const regularizationOptions = options.regularizationTolerance === undefined
    ? {}
    : { tolerance: options.regularizationTolerance };
  const regularization = regularizeHexSelection(mesh, candidateIds, regularizationOptions);
  const preview = previewRefinementByElementIds(mesh, regularization.selectedElementIds, {
    ...options,
    regularizeHexSelection: false
  });
  return {
    ...preview,
    regularization
  };
}

export function selectElementsByDistanceFunction(
  mesh: Mesh,
  distanceFunction: DistanceFunction,
  distValue = 0
): DistanceSelection {
  return selectElementsByDistanceFunctionCore(mesh, distanceFunction, distValue);
}

export function regularizeHexSelection(
  mesh: Mesh,
  candidateElementIds: readonly number[],
  options: HexSelectionRegularizationOptions = {}
): RegularizedHexSelection {
  return regularizeHexSelectionCore(mesh, candidateElementIds, options);
}

export function pointInBox(point: Point, box: BoxRange): boolean {
  return pointInBoxCore(point, box);
}

function buildRefinementResult(inputMesh: Mesh, mesh: Mesh, replacements: readonly ClassifiedReplacement[], selectedElementCount: number): RefinementResult {
  const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
  const cellData: RefinementCellData[] = [];

  for (let index = 0; index < inputMesh.elements.length; index += 1) {
    const elementId = index + 1;
    if (!replacedIds.has(elementId)) {
      cellData.push({
        parentElementId: elementId,
        role: "unchanged",
        templateCode: 0
      });
    }
  }

  for (const replacement of replacements) {
    for (let i = 0; i < replacement.refinement.elements.length; i += 1) {
      cellData.push({
        parentElementId: replacement.elementId,
        role: replacement.role,
        templateCode: replacement.templateCode
      });
    }
  }

  const countRole = (role: RefinementRole) => replacements.filter((replacement) => replacement.role === role).length;
  return {
    mesh,
    cellData,
    summary: {
      selectedElementCount,
      faceTransitionElementCount: countRole("face-transition"),
      edgeTransitionElementCount: countRole("edge-transition"),
      cornerTransitionElementCount: countRole("corner-transition"),
      unchangedElementCount: cellData.filter((cell) => cell.role === "unchanged").length,
      outputNodeCount: mesh.nodes.length,
      outputElementCount: mesh.elements.length
    }
  };
}

function buildRefinementPreview(mesh: Mesh, kind: "Q1" | "H1", replacements: readonly ClassifiedReplacement[]): RefinementPreview {
  const replacedIds = new Set(replacements.map((replacement) => replacement.elementId));
  const plan: RefinementPlanItem[] = replacements
    .map((replacement) => ({
      parentElementId: replacement.elementId,
      role: replacement.role,
      templateCode: replacement.templateCode,
      outputElementCount: replacement.refinement.elements.length
    }))
    .sort((a, b) => a.parentElementId - b.parentElementId || a.templateCode - b.templateCode);
  const countRole = (role: RefinementRole) => plan.filter((item) => item.role === role).length;
  const unchangedElementCount = mesh.elements.length - replacedIds.size;
  return {
    kind,
    plan,
    summary: {
      selectedElementCount: countRole("selected"),
      faceTransitionElementCount: countRole("face-transition"),
      edgeTransitionElementCount: countRole("edge-transition"),
      cornerTransitionElementCount: countRole("corner-transition"),
      unchangedElementCount,
      estimatedOutputElementCount: unchangedElementCount + plan.reduce((total, item) => total + item.outputElementCount, 0)
    }
  };
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
