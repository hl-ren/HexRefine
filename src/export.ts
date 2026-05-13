import type {
  ActiveMeshSetRemapResult,
  CellId,
  RefinementSession,
  RefinementSessionExportResult,
  RefinementSessionNamedSets,
  RefinementSessionSetRemapInput
} from "./refinement-session.js";
import type { Element, ElementKind, Mesh, Point } from "./types.js";
import { inferMeshKind } from "./mesh.js";

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

export type InpMaterialEntries =
  | ReadonlyMap<string, InpMaterial>
  | Iterable<readonly [string, InpMaterial]>;

export interface InpOptions {
  title?: string;
  elementKind?: ExportTargetKind;
  materials?: InpMaterialEntries;
}

const H1_EXPORT_EDGES: readonly [number, number][] = [
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 1],
  [5, 6],
  [6, 7],
  [7, 8],
  [8, 5],
  [1, 5],
  [2, 6],
  [3, 7],
  [4, 8]
];

export function exportKindOptionsForMeshKind(kind: ElementKind): readonly ExportElementKind[] {
  return kind === "Q1"
    ? ["Q4", "T3", "Q9"]
    : ["H8", "H20"];
}

export function normalizeExportKind(meshKind: ElementKind, requested?: ExportTargetKind): ExportElementKind {
  if (meshKind === "Q1") {
    if (requested === "T3" || requested === "Q9" || requested === "Q4") {
      return requested;
    }
    return "Q4";
  }
  if (requested === "H20") {
    return "H20";
  }
  return "H8";
}

export function prepareExportMesh(
  exported: RefinementSessionExportResult,
  requestedKind?: ExportTargetKind
): PreparedExportResult {
  const meshKind = inferMeshKind(exported.mesh);
  const exportKind = normalizeExportKind(meshKind, requestedKind);
  const converted = convertMeshForExport(exported.mesh, exportKind);
  return {
    mesh: converted.mesh,
    sourceElementIds: converted.sourceElementIds,
    sets: remapExportSets(exported.sets, converted.sourceElementIds)
  };
}

export function convertMeshForExport(mesh: Mesh, requestedKind?: ExportTargetKind): {
  mesh: ExportMesh;
  sourceElementIds: number[];
} {
  const meshKind = inferMeshKind(mesh);
  const exportKind = normalizeExportKind(meshKind, requestedKind);
  if (exportKind === "Q4") {
    return {
      mesh: { kind: "Q4", nodes: mesh.nodes, elements: mesh.elements },
      sourceElementIds: sequence(mesh.elements.length)
    };
  }
  if (exportKind === "H8") {
    return {
      mesh: { kind: "H8", nodes: mesh.nodes, elements: mesh.elements },
      sourceElementIds: sequence(mesh.elements.length)
    };
  }
  if (exportKind === "T3") {
    return convertQuadMeshToTriangles(mesh);
  }
  if (exportKind === "Q9") {
    return elevateQuadMeshToQ9(mesh);
  }
  return elevateHexMeshToH20(mesh);
}

export function buildNativeSessionExportPlan(
  session: RefinementSession,
  options: NativeSessionExportOptions = {}
): NativeSessionExportPlan {
  const kind = session.kind === "Q1" ? "Q4" : "H8";
  const activeCellIds = [...session.activeLeafIds]
    .sort((a, b) => (session.cells.get(a)?.ordinal ?? 0) - (session.cells.get(b)?.ordinal ?? 0));
  const nodes: Point[] = [];
  const nodeIdBySessionNodeId = new Map<number, number>();
  const exactNodeIdByKey = new Map<string, number>();
  const tolerance = Math.max(0, options.mergeTolerance ?? 0);
  const toleranceSquared = tolerance * tolerance;
  const buckets = tolerance > 0 ? new Map<string, number[]>() : undefined;

  for (const cellId of activeCellIds) {
    const cell = session.cells.get(cellId);
    if (!cell || !cell.active || cell.hidden) {
      continue;
    }
    for (const sessionNodeId of cell.element) {
      if (nodeIdBySessionNodeId.has(sessionNodeId)) {
        continue;
      }
      const point = session.nodes[sessionNodeId - 1];
      if (!point) {
        throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
      }
      let nodeId: number | undefined;
      if (tolerance === 0) {
        const key = exactPointKey(point);
        nodeId = exactNodeIdByKey.get(key);
        if (nodeId === undefined) {
          nodeId = nodes.length + 1;
          nodes.push(point);
          exactNodeIdByKey.set(key, nodeId);
        }
      } else {
        nodeId = findNativeExportNodeId(point, nodes, buckets!, tolerance, toleranceSquared);
        if (nodeId === undefined) {
          nodeId = nodes.length + 1;
          nodes.push(point);
          addNativeExportBucket(point, nodeId, buckets!, tolerance);
        }
      }
      nodeIdBySessionNodeId.set(sessionNodeId, nodeId);
    }
  }

  return {
    kind,
    session,
    activeCellIds,
    nodes,
    nodeIdBySessionNodeId,
    sets: remapNativeSessionSets(activeCellIds, nodeIdBySessionNodeId, options.sets ?? {})
  };
}

export function* iterateLegacyVtkLines(mesh: Mesh | ExportMesh, options: VtkOptions = {}): Generator<string> {
  const spec = vtkCellSpec(mesh);
  const title = sanitizeTitle(options.title ?? "ComformHex mesh");
  const scalarEntries = Object.entries(options.cellScalars ?? {});

  for (const [name, values] of scalarEntries) {
    if (values.length !== mesh.elements.length) {
      throw new Error(`cell scalar ${name} has ${values.length} values, expected ${mesh.elements.length}`);
    }
  }

  yield "# vtk DataFile Version 3.0";
  yield title;
  yield "ASCII";
  yield "DATASET UNSTRUCTURED_GRID";
  yield `POINTS ${mesh.nodes.length} double`;

  for (const point of mesh.nodes) {
    yield formatPoint3(point);
  }

  const cellIntCount = mesh.elements.reduce((total, element) => total + element.length + 1, 0);
  yield `CELLS ${mesh.elements.length} ${cellIntCount}`;
  for (const element of mesh.elements) {
    if (element.length !== spec.expectedNodeCount) {
      throw new Error(`VTK export expected ${spec.expectedNodeCount}-node elements for ${spec.kind}, got ${element.length}`);
    }
    yield `${element.length} ${element.map((nodeId) => nodeId - 1).join(" ")}`;
  }

  yield `CELL_TYPES ${mesh.elements.length}`;
  for (let i = 0; i < mesh.elements.length; i += 1) {
    yield String(spec.vtkCellType);
  }

  if (scalarEntries.length > 0) {
    yield `CELL_DATA ${mesh.elements.length}`;
    for (const [name, values] of scalarEntries) {
      yield `SCALARS ${sanitizeName(name)} double 1`;
      yield "LOOKUP_TABLE default";
      for (const value of values) {
        yield formatNumber(value);
      }
    }
  }
}

export function* iterateNativeSessionVtkLines(plan: NativeSessionExportPlan, options: VtkOptions = {}): Generator<string> {
  const spec = nativeSessionVtkSpec(plan.kind);
  const title = sanitizeTitle(options.title ?? "ComformHex mesh");
  const scalarEntries = Object.entries(options.cellScalars ?? {});
  for (const [name, values] of scalarEntries) {
    if (values.length !== plan.activeCellIds.length) {
      throw new Error(`cell scalar ${name} has ${values.length} values, expected ${plan.activeCellIds.length}`);
    }
  }

  yield "# vtk DataFile Version 3.0";
  yield title;
  yield "ASCII";
  yield "DATASET UNSTRUCTURED_GRID";
  yield `POINTS ${plan.nodes.length} double`;
  for (const point of plan.nodes) {
    yield formatPoint3(point);
  }

  yield `CELLS ${plan.activeCellIds.length} ${plan.activeCellIds.length * (spec.expectedNodeCount + 1)}`;
  for (const cellId of plan.activeCellIds) {
    const element = nativeSessionMappedElement(plan, cellId, spec.expectedNodeCount);
    yield `${element.length} ${element.map((nodeId) => nodeId - 1).join(" ")}`;
  }

  yield `CELL_TYPES ${plan.activeCellIds.length}`;
  for (let index = 0; index < plan.activeCellIds.length; index += 1) {
    yield String(spec.vtkCellType);
  }

  if (scalarEntries.length > 0) {
    yield `CELL_DATA ${plan.activeCellIds.length}`;
    for (const [name, values] of scalarEntries) {
      yield `SCALARS ${sanitizeName(name)} double 1`;
      yield "LOOKUP_TABLE default";
      for (const value of values) {
        yield formatNumber(value);
      }
    }
  }
}

export function meshToLegacyVtk(mesh: Mesh | ExportMesh, options: VtkOptions = {}): string {
  let text = "";
  for (const line of iterateLegacyVtkLines(mesh, options)) {
    text += `${line}\n`;
  }
  return text;
}

export function refinementSessionExportToInp(
  exported: RefinementSessionExportResult,
  options: InpOptions = {}
): string {
  return preparedExportToInp(prepareExportMesh(exported, options.elementKind), options);
}

export function preparedExportToInp(
  prepared: PreparedExportResult,
  options: InpOptions = {}
): string {
  let text = "";
  for (const line of iteratePreparedInpLines(prepared, options)) {
    text += `${line}\n`;
  }
  return text;
}

export function* iterateNativeSessionInpLines(
  plan: NativeSessionExportPlan,
  options: InpOptions = {}
): Generator<string> {
  const materialBySet = normalizeMaterialEntries(options.materials);
  const spec = nativeSessionVtkSpec(plan.kind);
  yield "*Heading";
  yield sanitizeTitle(options.title ?? "ComformHex mesh");
  yield "*Node";

  for (let index = 0; index < plan.nodes.length; index += 1) {
    const point = toPoint3(plan.nodes[index]!);
    yield `${index + 1}, ${formatInpNumber(point[0])}, ${formatInpNumber(point[1])}, ${formatInpNumber(point[2])}`;
  }

  yield `*Element, type=${inpElementType(plan.kind)}`;
  for (let index = 0; index < plan.activeCellIds.length; index += 1) {
    const element = nativeSessionMappedElement(plan, plan.activeCellIds[index]!, spec.expectedNodeCount);
    yield `${index + 1}, ${element.join(", ")}`;
  }

  yield* iterateInpSets("Nset", plan.sets.nodeSets);
  yield* iterateInpSets("Elset", plan.sets.cellSets);
  for (const [setName] of plan.sets.cellSets) {
    const material = materialBySet.get(setName);
    if (!material) {
      continue;
    }
    const materialName = sanitizeSetName(material.name);
    yield `*Solid Section, elset=${sanitizeSetName(setName)}, material=${materialName}`;
    yield ",";
    yield `*Material, name=${materialName}`;
    yield "*Elastic";
    yield `${formatInpNumber(material.elasticModulus ?? 1)}, ${formatInpNumber(material.poissonRatio ?? 0.3)}`;
  }
}

export function* iteratePreparedInpLines(
  prepared: PreparedExportResult,
  options: InpOptions = {}
): Generator<string> {
  const elementKind = prepared.mesh.kind;
  const materialBySet = normalizeMaterialEntries(options.materials);
  yield "*Heading";
  yield sanitizeTitle(options.title ?? "ComformHex mesh");
  yield "*Node";

  for (let index = 0; index < prepared.mesh.nodes.length; index += 1) {
    const point = toPoint3(prepared.mesh.nodes[index]!);
    yield `${index + 1}, ${formatInpNumber(point[0])}, ${formatInpNumber(point[1])}, ${formatInpNumber(point[2])}`;
  }

  yield `*Element, type=${inpElementType(elementKind)}`;
  for (let index = 0; index < prepared.mesh.elements.length; index += 1) {
    yield `${index + 1}, ${prepared.mesh.elements[index]!.join(", ")}`;
  }

  yield* iterateInpSets("Nset", prepared.sets.nodeSets);
  yield* iterateInpSets("Elset", prepared.sets.cellSets);
  for (const [setName] of prepared.sets.cellSets) {
    const material = materialBySet.get(setName);
    if (!material) {
      continue;
    }
    const materialName = sanitizeSetName(material.name);
    yield `*Solid Section, elset=${sanitizeSetName(setName)}, material=${materialName}`;
    yield ",";
    yield `*Material, name=${materialName}`;
    yield "*Elastic";
    yield `${formatInpNumber(material.elasticModulus ?? 1)}, ${formatInpNumber(material.poissonRatio ?? 0.3)}`;
  }
}

export function missingSetSummary(sets: RefinementSessionExportResult["sets"]): { missingCells: number; missingNodes: number } {
  return {
    missingCells: [...sets.missingCellIdsBySet].reduce((total, [, ids]) => total + ids.length, 0),
    missingNodes: [...sets.missingNodeIdsBySet].reduce((total, [, ids]) => total + ids.length, 0)
  };
}

function convertQuadMeshToTriangles(mesh: Mesh): { mesh: ExportMesh; sourceElementIds: number[] } {
  const kind = inferMeshKind(mesh);
  if (kind !== "Q1") {
    throw new Error("T3 export conversion requires a Q1 mesh");
  }
  const elements: number[][] = [];
  const sourceElementIds: number[] = [];
  mesh.elements.forEach((element, index) => {
    const [n1, n2, n3, n4] = element;
    elements.push([n1!, n2!, n3!], [n1!, n3!, n4!]);
    sourceElementIds.push(index + 1, index + 1);
  });
  return {
    mesh: {
      kind: "T3",
      nodes: clonePoints(mesh.nodes),
      elements
    },
    sourceElementIds
  };
}

function elevateQuadMeshToQ9(mesh: Mesh): { mesh: ExportMesh; sourceElementIds: number[] } {
  const kind = inferMeshKind(mesh);
  if (kind !== "Q1") {
    throw new Error("Q9 export conversion requires a Q1 mesh");
  }
  const nodes = clonePoints(mesh.nodes);
  const edgeNodeByKey = new Map<string, number>();
  const elements: number[][] = [];
  const sourceElementIds: number[] = [];

  mesh.elements.forEach((element, index) => {
    const [n1, n2, n3, n4] = element;
    const mids = [
      midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n1!, n2!),
      midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n2!, n3!),
      midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n3!, n4!),
      midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, n4!, n1!)
    ];
    const centerId = appendPoint(nodes, averagePoints([
      mesh.nodes[n1! - 1]!,
      mesh.nodes[n2! - 1]!,
      mesh.nodes[n3! - 1]!,
      mesh.nodes[n4! - 1]!
    ]));
    elements.push([n1!, n2!, n3!, n4!, mids[0]!, mids[1]!, mids[2]!, mids[3]!, centerId]);
    sourceElementIds.push(index + 1);
  });

  return {
    mesh: { kind: "Q9", nodes, elements },
    sourceElementIds
  };
}

function elevateHexMeshToH20(mesh: Mesh): { mesh: ExportMesh; sourceElementIds: number[] } {
  const kind = inferMeshKind(mesh);
  if (kind !== "H1") {
    throw new Error("H20 export conversion requires an H1 mesh");
  }
  const nodes = clonePoints(mesh.nodes);
  const edgeNodeByKey = new Map<string, number>();
  const elements: number[][] = [];
  const sourceElementIds: number[] = [];

  mesh.elements.forEach((element, index) => {
    const mids = H1_EXPORT_EDGES.map(([a, b]) => midEdgeNodeId(nodes, mesh.nodes, edgeNodeByKey, element[a - 1]!, element[b - 1]!));
    elements.push([...element, ...mids]);
    sourceElementIds.push(index + 1);
  });

  return {
    mesh: { kind: "H20", nodes, elements },
    sourceElementIds
  };
}

function remapExportSets(sets: ActiveMeshSetRemapResult, sourceElementIds: readonly number[]): ActiveMeshSetRemapResult {
  const exportedElementIdsBySource = new Map<number, number[]>();
  sourceElementIds.forEach((sourceElementId, index) => {
    let ids = exportedElementIdsBySource.get(sourceElementId);
    if (!ids) {
      ids = [];
      exportedElementIdsBySource.set(sourceElementId, ids);
    }
    ids.push(index + 1);
  });

  const cellSets = new Map<string, number[]>();
  for (const [name, ids] of sets.cellSets) {
    const expanded: number[] = [];
    for (const sourceId of ids) {
      expanded.push(...(exportedElementIdsBySource.get(sourceId) ?? []));
    }
    cellSets.set(name, uniqueSortedNumbers(expanded));
  }

  return {
    cellSets,
    nodeSets: cloneNumberMap(sets.nodeSets),
    missingCellIdsBySet: cloneGenericMap(sets.missingCellIdsBySet),
    missingNodeIdsBySet: cloneNumberMap(sets.missingNodeIdsBySet)
  };
}

function vtkCellSpec(mesh: Mesh | ExportMesh): { kind: ExportElementKind; vtkCellType: number; expectedNodeCount: number } {
  const kind = exportMeshKind(mesh);
  switch (kind) {
    case "T3":
      return { kind, vtkCellType: 5, expectedNodeCount: 3 };
    case "Q4":
      return { kind, vtkCellType: 9, expectedNodeCount: 4 };
    case "Q9":
      return { kind, vtkCellType: 28, expectedNodeCount: 9 };
    case "H8":
      return { kind, vtkCellType: 12, expectedNodeCount: 8 };
    case "H20":
      return { kind, vtkCellType: 25, expectedNodeCount: 20 };
  }
}

function exportMeshKind(mesh: Mesh | ExportMesh): ExportElementKind {
  if (mesh.kind === "T3" || mesh.kind === "Q4" || mesh.kind === "Q9" || mesh.kind === "H8" || mesh.kind === "H20") {
    return mesh.kind;
  }
  const inferred = inferMeshKind(mesh as Mesh);
  return inferred === "Q1" ? "Q4" : "H8";
}

function inpElementType(kind: ExportElementKind): string {
  switch (kind) {
    case "T3": return "CPS3";
    case "Q4": return "CPS4";
    case "Q9": return "CPS9";
    case "H8": return "C3D8";
    case "H20": return "C3D20";
  }
}

function midEdgeNodeId(
  nodes: Point[],
  sourceNodes: readonly Point[],
  edgeNodeByKey: Map<string, number>,
  nodeA: number,
  nodeB: number
): number {
  const key = edgeKey(nodeA, nodeB);
  const existing = edgeNodeByKey.get(key);
  if (existing !== undefined) {
    return existing;
  }
  const point = averagePoints([sourceNodes[nodeA - 1]!, sourceNodes[nodeB - 1]!]);
  const nodeId = appendPoint(nodes, point);
  edgeNodeByKey.set(key, nodeId);
  return nodeId;
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function appendPoint(nodes: Point[], point: Point): number {
  nodes.push(point);
  return nodes.length;
}

function averagePoints(points: readonly Point[]): Point {
  const dimension = Math.max(2, ...points.map((point) => Math.min(3, point.length)));
  const sums: [number, number, number] = [0, 0, 0];
  for (const point of points) {
    sums[0] += point[0] ?? 0;
    sums[1] += point[1] ?? 0;
    sums[2] += point[2] ?? 0;
  }
  const averaged = sums.map((sum) => sum / points.length);
  return averaged.slice(0, dimension);
}

function appendInpSets(lines: string[], keyword: string, sets: ReadonlyMap<string, readonly number[]>): void {
  for (const [name, ids] of sets) {
    lines.push(`*${keyword}, ${keyword.toLowerCase()}=${sanitizeSetName(name)}`);
    for (const chunk of chunkIds(ids, 16)) {
      lines.push(chunk.join(", "));
    }
  }
}

function* iterateInpSets(keyword: string, sets: ReadonlyMap<string, readonly number[]>): Generator<string> {
  for (const [name, ids] of sets) {
    yield `*${keyword}, ${keyword.toLowerCase()}=${sanitizeSetName(name)}`;
    for (const chunk of chunkIds(ids, 16)) {
      yield chunk.join(", ");
    }
  }
}

function chunkIds(ids: readonly number[], chunkSize: number): number[][] {
  const sorted = [...ids].sort((a, b) => a - b);
  const chunks: number[][] = [];
  for (let start = 0; start < sorted.length; start += chunkSize) {
    chunks.push(sorted.slice(start, start + chunkSize));
  }
  return chunks;
}

function clonePoints(points: readonly Point[]): Point[] {
  return points.map((point) => [...point]);
}

function cloneNumberMap(map: ReadonlyMap<string, readonly number[]>): Map<string, number[]> {
  return new Map([...map].map(([name, ids]) => [name, [...ids]]));
}

function cloneGenericMap<T>(map: ReadonlyMap<string, readonly T[]>): Map<string, T[]> {
  return new Map([...map].map(([name, ids]) => [name, [...ids]]));
}

function sequence(length: number): number[] {
  return Array.from({ length }, (_, index) => index + 1);
}

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function remapNativeSessionSets(
  activeCellIds: readonly CellId[],
  nodeIdBySessionNodeId: ReadonlyMap<number, number>,
  sets: RefinementSessionSetRemapInput
): ActiveMeshSetRemapResult {
  const elementIdByCellId = new Map<CellId, number>();
  activeCellIds.forEach((cellId, index) => elementIdByCellId.set(cellId, index + 1));

  const cellSets = new Map<string, number[]>();
  const nodeSets = new Map<string, number[]>();
  const missingCellIdsBySet = new Map<string, CellId[]>();
  const missingNodeIdsBySet = new Map<string, number[]>();

  for (const [name, cellIds] of namedSetEntries(sets.cellSets)) {
    const elementIds: number[] = [];
    const missingCellIds: CellId[] = [];
    for (const cellId of uniquePreserveOrder(cellIds)) {
      const elementId = elementIdByCellId.get(cellId);
      if (elementId === undefined) {
        missingCellIds.push(cellId);
      } else {
        elementIds.push(elementId);
      }
    }
    cellSets.set(name, uniqueSortedNumbers(elementIds));
    if (missingCellIds.length > 0) {
      missingCellIdsBySet.set(name, missingCellIds);
    }
  }

  for (const [name, sessionNodeIds] of namedSetEntries(sets.nodeSets)) {
    const nodeIds: number[] = [];
    const missingNodeIds: number[] = [];
    for (const sessionNodeId of uniquePreserveOrder(sessionNodeIds)) {
      const nodeId = nodeIdBySessionNodeId.get(sessionNodeId);
      if (nodeId === undefined) {
        missingNodeIds.push(sessionNodeId);
      } else {
        nodeIds.push(nodeId);
      }
    }
    nodeSets.set(name, uniqueSortedNumbers(nodeIds));
    if (missingNodeIds.length > 0) {
      missingNodeIdsBySet.set(name, missingNodeIds);
    }
  }

  return {
    cellSets,
    nodeSets,
    missingCellIdsBySet,
    missingNodeIdsBySet
  };
}

function nativeSessionMappedElement(
  plan: NativeSessionExportPlan,
  cellId: CellId,
  expectedNodeCount: number
): number[] {
  const cell = plan.session.cells.get(cellId);
  if (!cell) {
    throw new Error(`missing active cell ${cellId}`);
  }
  if (cell.element.length !== expectedNodeCount) {
    throw new Error(`native session export expected ${expectedNodeCount}-node elements for ${plan.kind}, got ${cell.element.length}`);
  }
  return cell.element.map((sessionNodeId) => {
    const nodeId = plan.nodeIdBySessionNodeId.get(sessionNodeId);
    if (nodeId === undefined) {
      throw new Error(`active cell ${cellId} references unmapped node ${sessionNodeId}`);
    }
    return nodeId;
  });
}

function nativeSessionVtkSpec(kind: "Q4" | "H8"): { vtkCellType: number; expectedNodeCount: number } {
  return kind === "Q4"
    ? { vtkCellType: 9, expectedNodeCount: 4 }
    : { vtkCellType: 12, expectedNodeCount: 8 };
}

function findNativeExportNodeId(
  point: Point,
  nodes: readonly Point[],
  buckets: ReadonlyMap<string, readonly number[]>,
  tolerance: number,
  toleranceSquared: number
): number | undefined {
  for (const key of nativeExportCandidateKeys(point, tolerance)) {
    for (const nodeId of buckets.get(key) ?? []) {
      const candidate = nodes[nodeId - 1];
      if (!candidate) {
        continue;
      }
      const dx = (candidate[0] ?? 0) - (point[0] ?? 0);
      const dy = (candidate[1] ?? 0) - (point[1] ?? 0);
      const dz = (candidate[2] ?? 0) - (point[2] ?? 0);
      if (dx * dx + dy * dy + dz * dz <= toleranceSquared) {
        return nodeId;
      }
    }
  }
  return undefined;
}

function addNativeExportBucket(
  point: Point,
  nodeId: number,
  buckets: Map<string, number[]>,
  tolerance: number
): void {
  const key = nativeExportBucketKey(point, tolerance);
  const bucket = buckets.get(key) ?? [];
  bucket.push(nodeId);
  buckets.set(key, bucket);
}

function nativeExportCandidateKeys(point: Point, tolerance: number): string[] {
  const [i, j, k] = nativeExportBucketCoords(point, tolerance);
  const keys: string[] = [];
  for (let dk = -1; dk <= 1; dk += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let di = -1; di <= 1; di += 1) {
        keys.push(`${i + di}:${j + dj}:${k + dk}`);
      }
    }
  }
  return keys;
}

function nativeExportBucketKey(point: Point, tolerance: number): string {
  return nativeExportBucketCoords(point, tolerance).join(":");
}

function nativeExportBucketCoords(point: Point, tolerance: number): [number, number, number] {
  return [
    Math.floor((point[0] ?? 0) / tolerance),
    Math.floor((point[1] ?? 0) / tolerance),
    Math.floor((point[2] ?? 0) / tolerance)
  ];
}

function exactPointKey(point: Point): string {
  return point.length <= 2
    ? `${point[0] ?? 0}:${point[1] ?? 0}`
    : `${point[0] ?? 0}:${point[1] ?? 0}:${point[2] ?? 0}`;
}

function namedSetEntries<T extends string | number>(
  sets: RefinementSessionNamedSets<T> | undefined
): Array<[string, readonly T[]]> {
  if (!sets) {
    return [];
  }
  return sets instanceof Map ? [...sets.entries()] : Object.entries(sets);
}

function uniquePreserveOrder<T extends string | number>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function formatPoint3(point: Point): string {
  if (point.length !== 2 && point.length !== 3) {
    throw new Error(`VTK export supports 2D or 3D points, got dimension ${point.length}`);
  }
  return [
    formatNumber(point[0] ?? 0),
    formatNumber(point[1] ?? 0),
    formatNumber(point[2] ?? 0)
  ].join(" ");
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toPrecision(15).replace(/0+$/, "").replace(/\.$/, "");
}

function formatInpNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : Number(value).toPrecision(12).replace(/0+$/, "").replace(/\.$/, "");
}

function normalizeMaterialEntries(materials: InpMaterialEntries | undefined): Map<string, InpMaterial> {
  if (!materials) {
    return new Map();
  }
  return materials instanceof Map ? new Map(materials) : new Map(materials);
}

function sanitizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_") || "scalar";
}

function sanitizeSetName(name: string): string {
  const clean = String(name || "SET").trim().replace(/[^A-Za-z0-9_+-]/g, "_");
  return clean || "SET";
}

function sanitizeTitle(title: string): string {
  return title.replace(/[\r\n]/g, " ").slice(0, 240);
}

function toPoint3(point: readonly number[]): [number, number, number] {
  return [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
}
