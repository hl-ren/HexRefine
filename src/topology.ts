import type { Element, ElementKind } from "./types.js";

export const Q1_EDGES: readonly number[][] = [
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 1]
];

export const H1_FACES: readonly number[][] = [
  [1, 2, 3, 4],
  [5, 6, 7, 8],
  [1, 5, 6, 2],
  [4, 8, 7, 3],
  [2, 6, 7, 3],
  [1, 5, 8, 4]
];

const H1_FACE_PERMUTATIONS: readonly number[][] = [
  [1, 2, 3, 4, 5, 6, 7, 8],
  [2, 3, 4, 1, 6, 7, 8, 5],
  [3, 4, 1, 2, 7, 8, 5, 6],
  [4, 1, 2, 3, 8, 5, 6, 7],
  [1, 5, 6, 2, 4, 8, 7, 3],
  [5, 6, 2, 1, 8, 7, 3, 4],
  [6, 2, 1, 5, 7, 3, 4, 8],
  [2, 1, 5, 6, 3, 4, 8, 7],
  [2, 6, 7, 3, 1, 5, 8, 4],
  [6, 7, 3, 2, 5, 8, 4, 1],
  [7, 3, 2, 6, 8, 4, 1, 5],
  [3, 2, 6, 7, 4, 1, 5, 8],
  [1, 4, 8, 5, 2, 3, 7, 6],
  [4, 8, 5, 1, 3, 7, 6, 2],
  [8, 5, 1, 4, 7, 6, 2, 3],
  [5, 1, 4, 8, 6, 2, 3, 7],
  [5, 8, 7, 6, 1, 4, 3, 2],
  [8, 7, 6, 5, 4, 3, 2, 1],
  [7, 6, 5, 8, 3, 2, 1, 4],
  [6, 5, 8, 7, 2, 1, 4, 3],
  [3, 7, 8, 4, 2, 6, 5, 1],
  [7, 8, 4, 3, 6, 5, 1, 2],
  [8, 4, 3, 7, 5, 1, 2, 6],
  [4, 3, 7, 8, 1, 2, 6, 5]
];

export function elementKindFromNodeCount(nodeCount: number): ElementKind {
  if (nodeCount === 4) {
    return "Q1";
  }
  if (nodeCount === 8) {
    return "H1";
  }
  throw new Error(`unsupported element node count: ${nodeCount}`);
}

export function boundariesOf(element: Element, kind: ElementKind): number[][] {
  const templates = kind === "Q1" ? Q1_EDGES : H1_FACES;
  return templates.map((boundary) => boundary.map((localId) => getNode(element, localId)));
}

export function boundaryKey(boundary: readonly number[]): string {
  return [...boundary].sort((a, b) => a - b).join(":");
}

export function sameNodeSet(a: readonly number[], b: readonly number[]): boolean {
  return boundaryKey(a) === boundaryKey(b);
}

export function h1Permutations(element: Element): number[][] {
  if (element.length !== 8) {
    throw new Error("h1Permutations requires an 8-node H1/Hex element");
  }
  return H1_FACE_PERMUTATIONS.map((permutation) =>
    permutation.map((localId) => getNode(element, localId))
  );
}

export function alignHexFaceToBottom(element: Element, face: readonly number[]): number[] {
  const match = h1Permutations(element).find((permutation) =>
    sameNodeSet(permutation.slice(0, 4), face)
  );
  if (!match) {
    throw new Error(`face [${face.join(", ")}] is not part of element [${element.join(", ")}]`);
  }
  return match;
}

export function alignHexEdgeToVertical(element: Element, edge: readonly number[]): number[] {
  const match = h1Permutations(element).find((permutation) =>
    sameNodeSet([permutation[0]!, permutation[4]!], edge)
  );
  if (!match) {
    throw new Error(`edge [${edge.join(", ")}] is not part of element [${element.join(", ")}]`);
  }
  return match;
}

export function alignQuadEdgeToFirst(element: Element, edge: readonly number[]): number[] {
  if (element.length !== 4) {
    throw new Error("alignQuadEdgeToFirst requires a 4-node Q1 element");
  }
  for (let i = 0; i < 4; i += 1) {
    const current = element[i]!;
    const next = element[(i + 1) % 4]!;
    if (sameNodeSet([current, next], edge)) {
      return [current, next, element[(i + 2) % 4]!, element[(i + 3) % 4]!];
    }
  }
  throw new Error(`edge [${edge.join(", ")}] is not part of element [${element.join(", ")}]`);
}

export function alignQuadCornerToSecond(element: Element, cornerNodeId: number): number[] {
  if (element.length !== 4) {
    throw new Error("alignQuadCornerToSecond requires a 4-node Q1 element");
  }
  const index = element.indexOf(cornerNodeId);
  if (index < 0) {
    throw new Error(`node ${cornerNodeId} is not part of element [${element.join(", ")}]`);
  }
  return [
    element[(index + 3) % 4]!,
    element[index]!,
    element[(index + 1) % 4]!,
    element[(index + 2) % 4]!
  ];
}

export function sharedNodes(a: readonly number[], b: readonly number[]): number[] {
  const bSet = new Set(b);
  return a.filter((nodeId) => bSet.has(nodeId));
}

function getNode(element: Element, localId: number): number {
  const node = element[localId - 1];
  if (node === undefined) {
    throw new Error(`local node ${localId} is out of range for [${element.join(", ")}]`);
  }
  return node;
}
