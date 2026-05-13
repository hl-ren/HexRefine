import type { Mesh, Point } from "./types.js";

export function createQ1UnitSquareMesh(nx: number, ny: number): Mesh {
  assertPositiveInteger(nx, "nx");
  assertPositiveInteger(ny, "ny");

  const nodes: Point[] = [];
  for (let j = 0; j <= ny; j += 1) {
    for (let i = 0; i <= nx; i += 1) {
      nodes.push([i / nx, j / ny]);
    }
  }

  const nodeId = (i: number, j: number) => j * (nx + 1) + i + 1;
  const elements: number[][] = [];
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      elements.push([
        nodeId(i, j),
        nodeId(i + 1, j),
        nodeId(i + 1, j + 1),
        nodeId(i, j + 1)
      ]);
    }
  }

  return { kind: "Q1", nodes, elements };
}

export function createHexUnitCubeMesh(nx: number, ny: number, nz: number): Mesh {
  assertPositiveInteger(nx, "nx");
  assertPositiveInteger(ny, "ny");
  assertPositiveInteger(nz, "nz");

  const nodes: Point[] = [];
  for (let k = 0; k <= nz; k += 1) {
    for (let j = 0; j <= ny; j += 1) {
      for (let i = 0; i <= nx; i += 1) {
        nodes.push([i / nx, j / ny, k / nz]);
      }
    }
  }

  const nodeId = (i: number, j: number, k: number) =>
    k * (ny + 1) * (nx + 1) + j * (nx + 1) + i + 1;

  const elements: number[][] = [];
  for (let k = 0; k < nz; k += 1) {
    for (let j = 0; j < ny; j += 1) {
      for (let i = 0; i < nx; i += 1) {
        elements.push([
          nodeId(i, j, k),
          nodeId(i + 1, j, k),
          nodeId(i + 1, j + 1, k),
          nodeId(i, j + 1, k),
          nodeId(i, j, k + 1),
          nodeId(i + 1, j, k + 1),
          nodeId(i + 1, j + 1, k + 1),
          nodeId(i, j + 1, k + 1)
        ]);
      }
    }
  }

  return { kind: "H1", nodes, elements };
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}
