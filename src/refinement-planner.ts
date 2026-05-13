import type { BoundaryPair, Mesh, RefineOptions, RefinementRole, ReplaceElement } from "./types.js";
import { elementVertices, findBoundaryPairs, inferMeshKind, instantiateOnElement, minElementEdgeLength } from "./mesh.js";
import { alignQuadCornerToSecond, alignQuadEdgeToFirst, sharedNodes } from "./topology.js";
import { refineQ1To3x3, refineQ1To4Q1, refineQ1To5Q1 } from "./templates.js";
import { buildHexClassifiedReplacements } from "./transitions.js";

export interface ClassifiedReplacement extends ReplaceElement {
  role: RefinementRole;
  templateCode: number;
}

export interface RefinementPlanner {
  plan(mesh: Mesh, selectedElementIds: readonly number[], options?: RefineOptions): ClassifiedReplacement[];
}

export const defaultRefinementPlanner: RefinementPlanner = {
  plan: buildDefaultRefinementReplacements
};

export function buildDefaultRefinementReplacements(
  mesh: Mesh,
  selectedElementIds: readonly number[],
  options: RefineOptions = {}
): ClassifiedReplacement[] {
  const kind = inferMeshKind(mesh);
  const selected = uniqueSorted(selectedElementIds);
  if (selected.length === 0) {
    return [];
  }
  if (kind === "H1") {
    return buildHexClassifiedReplacements(mesh, selected, options);
  }

  const includeTransitions = options.includeTransitions ?? true;
  const replacements: ClassifiedReplacement[] = [];
  for (const elementId of selected) {
    replacements.push(classifyReplacement(instantiateOnElement(mesh, elementId, refineQ1To3x3), "selected", 9));
  }
  if (includeTransitions) {
    replacements.push(...q1TransitionReplacements(mesh, findBoundaryPairs(mesh, selected)));
  }
  return replacements;
}

function q1TransitionReplacements(mesh: Mesh, boundaryPairs: readonly BoundaryPair[]): ClassifiedReplacement[] {
  const byNeighbor = groupBy(boundaryPairs, (pair) => pair.neighborElementId);
  const replacements: ClassifiedReplacement[] = [];

  for (const [neighborIdText, pairs] of byNeighbor) {
    const neighborElementId = Number(neighborIdText);
    const neighborElement = mesh.elements[neighborElementId - 1];
    if (!neighborElement) {
      throw new Error(`neighbor element id ${neighborElementId} is out of range`);
    }

    if (pairs.length >= 2) {
      const corner = sharedNodes(pairs[0]!.neighborBoundary, pairs[1]!.neighborBoundary)[0];
      if (corner === undefined) {
        continue;
      }
      const alignedElement = alignQuadCornerToSecond(neighborElement, corner);
      replacements.push({
        elementId: neighborElementId,
        refinement: refineQ1To5Q1(elementVertices(mesh, alignedElement)),
        role: "corner-transition",
        templateCode: 5
      });
      continue;
    }

    const pair = pairs[0]!;
    const alignedElement = alignQuadEdgeToFirst(neighborElement, pair.neighborBoundary);
    replacements.push({
      elementId: neighborElementId,
      refinement: refineQ1To4Q1(elementVertices(mesh, alignedElement)),
      role: "edge-transition",
      templateCode: 4
    });
  }

  return replacements;
}

function classifyReplacement(replacement: ReplaceElement, role: RefinementRole, templateCode: number): ClassifiedReplacement {
  return {
    ...replacement,
    role,
    templateCode
  };
}

function groupBy<T>(values: readonly T[], key: (value: T) => number): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const value of values) {
    const text = String(key(value));
    const group = result.get(text) ?? [];
    group.push(value);
    result.set(text, group);
  }
  return result;
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
