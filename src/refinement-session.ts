import type { Element, ElementKind, LocalRefinement, Mesh, Point, RefinementRole } from "./types.js";
import { elementVertices, inferMeshKind, mergeCoincidentNodesWithMap, minElementEdgeLength } from "./mesh.js";
import { buildDefaultRefinementReplacements } from "./refinement-planner.js";
import { checkNoHangingNodes, type ConformanceReport } from "./conformance.js";

export type CellId = string;
export type RefinementSessionCellRole = "base" | RefinementRole;

export interface RefinementSessionCell {
  id: CellId;
  ordinal: number;
  parentId?: CellId;
  level: number;
  role: RefinementSessionCellRole;
  kind: ElementKind;
  element: Element;
  children: CellId[];
  active: boolean;
  hidden: boolean;
  sourceElementId?: number;
  template?: string;
}

export interface RefinementSessionCommand {
  id: string;
  kind: "refine";
  hiddenCellIds: CellId[];
  createdCellIds: CellId[];
  createdNodeIds: number[];
}

export interface RefinementSession {
  baseMesh: Mesh;
  kind: ElementKind;
  nodes: Point[];
  cells: Map<CellId, RefinementSessionCell>;
  activeLeafIds: Set<CellId>;
  sortedActiveLeafIds: CellId[];
  sortedActiveLeafIdsDirty: boolean;
  activeLeafIdsByNodeKey: Map<string, CellId[]>;
  undoStack: RefinementSessionCommand[];
  redoStack: RefinementSessionCommand[];
  nextCommandId: number;
  nextCellOrdinal: number;
}

const cellIdPartsCache = new Map<CellId, number[]>();

export interface BuildActiveMeshOptions {
  mergeNodes?: boolean;
  mergeTolerance?: number;
  includeElementIdsByNodeId?: boolean;
  includeCellIdByElementId?: boolean;
  includeElementIdByCellId?: boolean;
  includeSessionNodeIdByNodeId?: boolean;
  includeSessionNodeIdsByNodeId?: boolean;
}

export interface ActiveMeshBuildResult {
  mesh: Mesh;
  cellIdByElementId: Map<number, CellId>;
  elementIdByCellId: Map<CellId, number>;
  cellIdsByElementIdArray?: CellId[];
  elementIdByCellOrdinalArray?: Int32Array;
  nodeIdBySessionNodeId: Map<number, number>;
  sessionNodeIdByNodeId: Map<number, number>;
  sessionNodeIdsByNodeId: Map<number, number[]>;
  elementIdsByNodeId?: Map<number, number[]>;
}

export type RefinementSessionNamedSets<T extends string | number> =
  | ReadonlyMap<string, readonly T[]>
  | Record<string, readonly T[]>;

export interface RefinementSessionSetRemapInput {
  cellSets?: RefinementSessionNamedSets<CellId>;
  nodeSets?: RefinementSessionNamedSets<number>;
}

export interface ActiveMeshSetRemapResult {
  cellSets: Map<string, number[]>;
  nodeSets: Map<string, number[]>;
  missingCellIdsBySet: Map<string, CellId[]>;
  missingNodeIdsBySet: Map<string, number[]>;
}

export interface RefinementSessionExportOptions extends BuildActiveMeshOptions {
  sets?: RefinementSessionSetRemapInput;
}

export interface RefinementSessionExportResult {
  mesh: Mesh;
  build: ActiveMeshBuildResult;
  sets: ActiveMeshSetRemapResult;
}

export interface RefinementSessionLocalConformanceReport {
  report: ConformanceReport;
  mesh: Mesh;
  activeBuild: ActiveMeshBuildResult;
  checkedCellIds: CellId[];
  checkedElementIds: number[];
  seedCellIds: CellId[];
  seedElementIds: number[];
}

export interface RefinementSessionSelectionValidation {
  ok: boolean;
  cellIds: CellId[];
  level: number | undefined;
  missingCellIds: CellId[];
  inactiveCellIds: CellId[];
  transitionCellIds: CellId[];
  mixedLevelCellIds: CellId[];
  errors: string[];
}

export type LocalRefinementFactory = (vertices: Point[]) => LocalRefinement;

export interface RefinementSessionPatchOptions {
  includeTransitions?: boolean;
  transitionSupportCellIds?: readonly CellId[];
  mergeTolerance?: number;
  activeBuild?: ActiveMeshBuildResult;
}

export function createRefinementSession(mesh: Mesh): RefinementSession {
  const kind = inferMeshKind(mesh);
  const cells = new Map<CellId, RefinementSessionCell>();
  const activeLeafIds = new Set<CellId>();
  const activeLeafIdsByNodeKey = new Map<string, CellId[]>();

  mesh.elements.forEach((element, index) => {
    const id = baseCellId(index + 1);
    cells.set(id, {
      id,
      ordinal: index + 1,
      level: 0,
      role: "base",
      kind,
      element: [...element],
      children: [],
      active: true,
      hidden: false,
      sourceElementId: index + 1,
      template: "base"
    });
    activeLeafIds.add(id);
    for (const nodeId of element) {
      const point = mesh.nodes[nodeId - 1];
      if (!point) {
        throw new Error(`base cell ${id} references missing node ${nodeId}`);
      }
      const key = exactActiveMergeKey(point);
      const ownerIds = activeLeafIdsByNodeKey.get(key) ?? [];
      ownerIds.push(id);
      activeLeafIdsByNodeKey.set(key, ownerIds);
    }
  });

  return {
    baseMesh: cloneMesh(mesh),
    kind,
    nodes: mesh.nodes.map((point) => [...point]),
    cells,
    activeLeafIds,
    sortedActiveLeafIds: [...activeLeafIds],
    sortedActiveLeafIdsDirty: false,
    activeLeafIdsByNodeKey,
    undoStack: [],
    redoStack: [],
    nextCommandId: 1,
    nextCellOrdinal: mesh.elements.length + 1
  };
}

export function buildActiveMesh(session: RefinementSession, options: BuildActiveMeshOptions = {}): Mesh {
  return buildActiveMeshWithMap(session, options).mesh;
}

export function buildActiveMeshWithMap(
  session: RefinementSession,
  options: BuildActiveMeshOptions = {}
): ActiveMeshBuildResult {
  return buildActiveMeshForCellIdsWithMap(session, sortedActiveLeafIds(session), options);
}

function buildActiveMeshForCellIdsWithMap(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions = {}
): ActiveMeshBuildResult {
  const includeSessionNodeIdByNodeId = options.includeSessionNodeIdByNodeId ?? true;
  const includeSessionNodeIdsByNodeId = options.includeSessionNodeIdsByNodeId ?? true;
  const includeCellIdByElementId = options.includeCellIdByElementId ?? true;
  const includeElementIdByCellId = options.includeElementIdByCellId ?? true;
  const includeReverseNodeMaps = includeSessionNodeIdByNodeId || includeSessionNodeIdsByNodeId;
  if (options.mergeNodes && options.mergeTolerance !== undefined) {
    return buildMergedActiveMeshDirect(
      session,
      activeIds,
      options,
      includeSessionNodeIdByNodeId,
      includeSessionNodeIdsByNodeId,
      includeCellIdByElementId,
      includeElementIdByCellId
    );
  }
  const compactNodeIdBySessionNodeId = new Map<number, number>();
  const sessionNodeIdByCompactNodeId = includeReverseNodeMaps ? new Map<number, number>() : undefined;
  const sessionNodeIdsByCompactNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;
  const nodes: Point[] = [];
  const compactNodeId = (sessionNodeId: number, cellId: CellId): number => {
    const mapped = compactNodeIdBySessionNodeId.get(sessionNodeId);
    if (mapped !== undefined) {
      return mapped;
    }
    const node = session.nodes[sessionNodeId - 1];
    if (!node) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const nextNodeId = nodes.length + 1;
    compactNodeIdBySessionNodeId.set(sessionNodeId, nextNodeId);
    sessionNodeIdByCompactNodeId?.set(nextNodeId, sessionNodeId);
    sessionNodeIdsByCompactNodeId?.set(nextNodeId, [sessionNodeId]);
    nodes.push(node);
    return nextNodeId;
  };

  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  const cellIdsByElementIdArray: CellId[] = new Array(activeIds.length + 1);
  const elementIdByCellOrdinalArray = new Int32Array(Math.max(session.nextCellOrdinal + 1, session.cells.size + 1));
  const elements = activeIds.map((cellId, index) => {
    const elementId = index + 1;
    const cell = requiredCell(session, cellId);
    if (includeCellIdByElementId) {
      cellIdByElementId.set(elementId, cellId);
    }
    cellIdsByElementIdArray[elementId] = cellId;
    if (includeElementIdByCellId) {
      elementIdByCellId.set(cellId, elementId);
    }
    if (cell.ordinal < elementIdByCellOrdinalArray.length) {
      elementIdByCellOrdinalArray[cell.ordinal] = elementId;
    }
    return cell.element.map((nodeId) => compactNodeId(nodeId, cellId));
  });

  const mesh: Mesh = { kind: session.kind, nodes, elements };
  if (!options.mergeNodes) {
    const result: ActiveMeshBuildResult = {
      mesh,
      cellIdByElementId,
      elementIdByCellId,
      cellIdsByElementIdArray,
      elementIdByCellOrdinalArray,
      nodeIdBySessionNodeId: compactNodeIdBySessionNodeId,
      sessionNodeIdByNodeId: sessionNodeIdByCompactNodeId ?? new Map<number, number>(),
      sessionNodeIdsByNodeId: sessionNodeIdsByCompactNodeId ?? new Map<number, number[]>()
    };
    if (options.includeElementIdsByNodeId) {
      result.elementIdsByNodeId = buildElementIdsByNodeId(mesh.elements);
    }
    return result;
  }

  const mergeTolerance = options.mergeTolerance ?? minElementEdgeLength(mesh) * 0.0005;
  const merged = mergeCoincidentNodesWithMap(mesh, mergeTolerance);
  const nodeIdBySessionNodeId = new Map<number, number>();
  const sessionNodeIdByNodeId = includeSessionNodeIdByNodeId ? new Map<number, number>() : undefined;
  const sessionNodeIdsByNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;

  for (const [sessionNodeId, compactNodeId] of compactNodeIdBySessionNodeId) {
    const mergedNodeId = merged.nodeIdByInputNodeIdArray?.[compactNodeId] ?? merged.nodeIdByInputNodeId.get(compactNodeId);
    if (mergedNodeId === undefined) {
      throw new Error(`missing merged node id for active node ${compactNodeId}`);
    }
    nodeIdBySessionNodeId.set(sessionNodeId, mergedNodeId);
  }
  if (includeReverseNodeMaps) {
    const mergedInputGroups = merged.inputNodeIdsByNodeIdArray
      ? merged.inputNodeIdsByNodeIdArray.entries()
      : merged.inputNodeIdsByNodeId.entries();
    for (const [mergedNodeId, compactNodeIds] of mergedInputGroups) {
      if (!compactNodeIds || compactNodeIds.length === 0) {
        continue;
      }
      const sessionNodeIds = compactNodeIds.map((compactNodeId) => {
        const sessionNodeId = sessionNodeIdByCompactNodeId!.get(compactNodeId);
        if (sessionNodeId === undefined) {
          throw new Error(`missing session node id for active node ${compactNodeId}`);
        }
        return sessionNodeId;
      });
      sessionNodeIdByNodeId?.set(mergedNodeId, sessionNodeIds[0]!);
      sessionNodeIdsByNodeId?.set(mergedNodeId, sessionNodeIds);
    }
  }

  const result: ActiveMeshBuildResult = {
    mesh: merged.mesh,
    cellIdByElementId,
    elementIdByCellId,
    cellIdsByElementIdArray,
    elementIdByCellOrdinalArray,
    nodeIdBySessionNodeId,
    sessionNodeIdByNodeId: sessionNodeIdByNodeId ?? new Map<number, number>(),
    sessionNodeIdsByNodeId: sessionNodeIdsByNodeId ?? new Map<number, number[]>()
  };
  if (options.includeElementIdsByNodeId) {
    result.elementIdsByNodeId = buildElementIdsByNodeId(merged.mesh.elements);
  }
  return result;
}

function buildMergedActiveMeshDirect(
  session: RefinementSession,
  activeIds: readonly CellId[],
  options: BuildActiveMeshOptions,
  includeSessionNodeIdByNodeId: boolean,
  includeSessionNodeIdsByNodeId: boolean,
  includeCellIdByElementId: boolean,
  includeElementIdByCellId: boolean
): ActiveMeshBuildResult {
  const tolerance = options.mergeTolerance!;
  const toleranceSquared = tolerance * tolerance;
  const sessionNodes = session.nodes;
  const nodes: Point[] = [];
  const elements: Element[] = new Array(activeIds.length);
  const cellIdByElementId = new Map<number, CellId>();
  const elementIdByCellId = new Map<CellId, number>();
  const cellIdsByElementIdArray: CellId[] = new Array(activeIds.length + 1);
  const elementIdByCellOrdinalArray = new Int32Array(Math.max(session.nextCellOrdinal + 1, session.cells.size + 1));
  const nodeIdBySessionNodeIdArray = new Int32Array(sessionNodes.length + 1);
  const touchedSessionNodeIds: number[] = [];
  const sessionNodeIdByNodeId = includeSessionNodeIdByNodeId ? new Map<number, number>() : undefined;
  const sessionNodeIdsByNodeId = includeSessionNodeIdsByNodeId ? new Map<number, number[]>() : undefined;
  const exactNodeIndexByKey = tolerance === 0 ? new Map<string, number>() : undefined;
  const buckets = tolerance === 0 ? undefined : new Map<number, number[]>();

  for (let index = 0; index < activeIds.length; index += 1) {
    const cellId = activeIds[index]!;
    const elementId = index + 1;
    const cell = requiredCell(session, cellId);
    if (includeCellIdByElementId) {
      cellIdByElementId.set(elementId, cellId);
    }
    cellIdsByElementIdArray[elementId] = cellId;
    if (includeElementIdByCellId) {
      elementIdByCellId.set(cellId, elementId);
    }
    if (cell.ordinal < elementIdByCellOrdinalArray.length) {
      elementIdByCellOrdinalArray[cell.ordinal] = elementId;
    }
    const sourceElement = cell.element;
    const mappedElement = new Array<number>(sourceElement.length);
    for (let nodeOffset = 0; nodeOffset < sourceElement.length; nodeOffset += 1) {
      const sessionNodeId = sourceElement[nodeOffset]!;
      let nodeId = nodeIdBySessionNodeIdArray[sessionNodeId];
      if (nodeId === 0) {
        const point = sessionNodes[sessionNodeId - 1];
        if (!point) {
          throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
        }
        let nodeIndex: number | undefined;
        if (exactNodeIndexByKey) {
          const exactKey = exactActiveMergeKey(point);
          nodeIndex = exactNodeIndexByKey.get(exactKey);
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            nodes.push(point);
            exactNodeIndexByKey.set(exactKey, nodeIndex);
          }
        } else if (buckets) {
          nodeIndex = findMergedActiveNodeIndex(point, nodes, buckets, tolerance, toleranceSquared);
          if (nodeIndex === undefined) {
            nodeIndex = nodes.length;
            nodes.push(point);
            addActiveMergeBucket(point, nodeIndex, buckets, tolerance);
          }
        } else {
          nodeIndex = nodes.length;
          nodes.push(point);
        }
        nodeId = nodeIndex! + 1;
        nodeIdBySessionNodeIdArray[sessionNodeId] = nodeId;
        touchedSessionNodeIds.push(sessionNodeId);
        if (sessionNodeIdByNodeId && !sessionNodeIdByNodeId.has(nodeId)) {
          sessionNodeIdByNodeId.set(nodeId, sessionNodeId);
        }
        if (sessionNodeIdsByNodeId) {
          const sessionNodeIds = sessionNodeIdsByNodeId.get(nodeId) ?? [];
          sessionNodeIds.push(sessionNodeId);
          sessionNodeIdsByNodeId.set(nodeId, sessionNodeIds);
        }
      }
      mappedElement[nodeOffset] = nodeId!;
    }
    elements[index] = mappedElement;
  }

  const nodeIdBySessionNodeId = new Map<number, number>();
  for (const sessionNodeId of touchedSessionNodeIds) {
    nodeIdBySessionNodeId.set(sessionNodeId, nodeIdBySessionNodeIdArray[sessionNodeId]!);
  }

  const mesh: Mesh = { kind: session.kind, nodes, elements };
  const result: ActiveMeshBuildResult = {
    mesh,
    cellIdByElementId,
    elementIdByCellId,
    cellIdsByElementIdArray,
    elementIdByCellOrdinalArray,
    nodeIdBySessionNodeId,
    sessionNodeIdByNodeId: sessionNodeIdByNodeId ?? new Map<number, number>(),
    sessionNodeIdsByNodeId: sessionNodeIdsByNodeId ?? new Map<number, number[]>()
  };
  if (options.includeElementIdsByNodeId) {
    result.elementIdsByNodeId = buildElementIdsByNodeId(elements);
  }
  return result;
}

function findMergedActiveNodeIndex(
  point: Point,
  nodes: readonly Point[],
  buckets: ReadonlyMap<number, readonly number[]>,
  tolerance: number,
  toleranceSquared: number
): number | undefined {
  let bestIndex: number | undefined;
  const px = point[0] ?? 0;
  const py = point[1] ?? 0;
  const pz = point[2] ?? 0;
  const i = Math.floor(px / tolerance);
  const j = Math.floor(py / tolerance);
  const k = Math.floor(pz / tolerance);
  if (point.length <= 2) {
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        for (const candidateIndex of buckets.get(activeMergeBucketHash2(i + di, j + dj)) ?? []) {
          if (bestIndex !== undefined && candidateIndex >= bestIndex) {
            continue;
          }
          const candidate = nodes[candidateIndex]!;
          const dx = (candidate[0] ?? 0) - px;
          const dy = (candidate[1] ?? 0) - py;
          if ((dx * dx) + (dy * dy) <= toleranceSquared) {
            bestIndex = candidateIndex;
          }
        }
      }
    }
    return bestIndex;
  }
  for (let di = -1; di <= 1; di += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let dk = -1; dk <= 1; dk += 1) {
        for (const candidateIndex of buckets.get(activeMergeBucketHash3(i + di, j + dj, k + dk)) ?? []) {
          if (bestIndex !== undefined && candidateIndex >= bestIndex) {
            continue;
          }
          const candidate = nodes[candidateIndex]!;
          const dx = (candidate[0] ?? 0) - px;
          const dy = (candidate[1] ?? 0) - py;
          const dz = (candidate[2] ?? 0) - pz;
          if ((dx * dx) + (dy * dy) + (dz * dz) <= toleranceSquared) {
            bestIndex = candidateIndex;
          }
        }
      }
    }
  }
  return bestIndex;
}

function addActiveMergeBucket(
  point: Point,
  nodeIndex: number,
  buckets: Map<number, number[]>,
  tolerance: number
): void {
  const key = activeMergeBucketKey(point, tolerance);
  const bucket = buckets.get(key) ?? [];
  bucket.push(nodeIndex);
  buckets.set(key, bucket);
}

function forEachActiveMergeCandidateKey(point: Point, tolerance: number, visit: (key: number) => void): void {
  const i = Math.floor((point[0] ?? 0) / tolerance);
  const j = Math.floor((point[1] ?? 0) / tolerance);
  const k = Math.floor((point[2] ?? 0) / tolerance);
  if (point.length <= 2) {
    for (let di = -1; di <= 1; di += 1) {
      for (let dj = -1; dj <= 1; dj += 1) {
        visit(activeMergeBucketHash2(i + di, j + dj));
      }
    }
    return;
  }
  for (let di = -1; di <= 1; di += 1) {
    for (let dj = -1; dj <= 1; dj += 1) {
      for (let dk = -1; dk <= 1; dk += 1) {
        visit(activeMergeBucketHash3(i + di, j + dj, k + dk));
      }
    }
  }
}

function activeMergeBucketKey(point: Point, tolerance: number): number {
  const i = Math.floor((point[0] ?? 0) / tolerance);
  const j = Math.floor((point[1] ?? 0) / tolerance);
  if (point.length <= 2) {
    return activeMergeBucketHash2(i, j);
  }
  return activeMergeBucketHash3(i, j, Math.floor((point[2] ?? 0) / tolerance));
}

function activeMergeBucketHash2(i: number, j: number): number {
  return i * 73856093 + j * 19349663;
}

function activeMergeBucketHash3(i: number, j: number, k: number): number {
  return i * 73856093 + j * 19349663 + k * 83492791;
}

function exactActiveMergeKey(point: Point): string {
  return point.length <= 2
    ? `${point[0] ?? 0}:${point[1] ?? 0}`
    : `${point[0] ?? 0}:${point[1] ?? 0}:${point[2] ?? 0}`;
}

export function activeBuildCellIdByElementId(build: ActiveMeshBuildResult, elementId: number): CellId | undefined {
  return build.cellIdsByElementIdArray?.[elementId] ?? build.cellIdByElementId.get(elementId);
}

export function activeBuildElementIdByCellId(
  session: RefinementSession,
  build: ActiveMeshBuildResult,
  cellId: CellId
): number | undefined {
  const ordinal = session.cells.get(cellId)?.ordinal;
  if (ordinal !== undefined) {
    const elementId = build.elementIdByCellOrdinalArray?.[ordinal];
    if (elementId) {
      return elementId;
    }
  }
  return build.elementIdByCellId.get(cellId);
}

export function remapSessionSetsToActiveMesh(
  build: ActiveMeshBuildResult,
  sets: RefinementSessionSetRemapInput
): ActiveMeshSetRemapResult {
  const cellSets = new Map<string, number[]>();
  const nodeSets = new Map<string, number[]>();
  const missingCellIdsBySet = new Map<string, CellId[]>();
  const missingNodeIdsBySet = new Map<string, number[]>();

  for (const [name, cellIds] of namedSetEntries(sets.cellSets)) {
    const elementIds: number[] = [];
    const missingCellIds: CellId[] = [];
    for (const cellId of uniquePreserveOrder(cellIds)) {
      const elementId = build.elementIdByCellId.get(cellId);
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
      const nodeId = build.nodeIdBySessionNodeId.get(sessionNodeId);
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

export function buildRefinementSessionExport(
  session: RefinementSession,
  options: RefinementSessionExportOptions = {}
): RefinementSessionExportResult {
  const buildOptions: BuildActiveMeshOptions = { mergeNodes: options.mergeNodes ?? true };
  if (options.mergeTolerance !== undefined) {
    buildOptions.mergeTolerance = options.mergeTolerance;
  }
  const build = buildActiveMeshWithMap(session, buildOptions);
  return {
    mesh: build.mesh,
    build,
    sets: remapSessionSetsToActiveMesh(build, options.sets ?? {})
  };
}

export function checkRefinementSessionCommandConformance(
  session: RefinementSession,
  command: RefinementSessionCommand,
  tolerance = 1e-9,
  activeBuild?: ActiveMeshBuildResult
): RefinementSessionLocalConformanceReport {
  const active = activeBuild ?? buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: tolerance,
    includeElementIdsByNodeId: true
  });
  const seedElementIds = command.createdCellIds
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId): elementId is number => elementId !== undefined)
    .sort((a, b) => a - b);
  const local = buildLocalActiveMeshAroundElements(active, seedElementIds);
  const report = local.mesh.elements.length === 0
    ? { ok: true, hanging: [], unmatchedInteriorBoundaryCount: 0 }
    : checkNoHangingNodes(local.mesh, tolerance);
  return {
    report,
    mesh: local.mesh,
    activeBuild: active,
    checkedCellIds: local.checkedCellIds,
    checkedElementIds: local.checkedElementIds,
    seedCellIds: seedElementIds
      .map((elementId) => activeBuildCellIdByElementId(active, elementId))
      .filter((cellId): cellId is CellId => cellId !== undefined),
    seedElementIds
  };
}

export function refineSessionCell(
  session: RefinementSession,
  cellId: CellId,
  factory: LocalRefinementFactory
): RefinementSessionCommand {
  return refineSessionCells(session, [cellId], factory);
}

export function refineSessionCells(
  session: RefinementSession,
  cellIds: CellId[],
  factory: LocalRefinementFactory
): RefinementSessionCommand {
  const validation = validateRefinementSessionSelection(session, cellIds);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const parentIds = validation.cellIds.sort(compareCellIds);
  const createdCellIds: CellId[] = [];
  const createdNodeIds: number[] = [];
  const hiddenCellIds: CellId[] = [];
  const meshView = sessionMeshView(session);

  for (const parentId of parentIds) {
    const parent = requiredCell(session, parentId);
    const refinement = factory(elementVertices(meshView, parent.element));
    if (refinement.kind !== parent.kind) {
      throw new Error(`refinement kind ${refinement.kind} does not match parent kind ${parent.kind}`);
    }

    const nodeOffset = session.nodes.length;
    for (const [index, point] of refinement.nodes.entries()) {
      session.nodes.push([...point]);
      createdNodeIds.push(nodeOffset + index + 1);
    }

    const parentCreatedCellIds: CellId[] = [];
    const firstChildIndex = parent.children.length + 1;
    refinement.elements.forEach((element, index) => {
      const childId = `${parentId}/${firstChildIndex + index}`;
      parentCreatedCellIds.push(childId);
      createdCellIds.push(childId);
      const child: RefinementSessionCell = {
        id: childId,
        ordinal: nextCellOrdinal(session),
        parentId,
        level: parent.level + 1,
        role: "selected",
        kind: parent.kind,
        element: element.map((nodeId) => nodeId + nodeOffset),
        children: [],
        active: true,
        hidden: false,
        template: refinement.source
      };
      if (parent.sourceElementId !== undefined) {
        child.sourceElementId = parent.sourceElementId;
      }
      session.cells.set(childId, child);
      addActiveLeafCellId(session, childId);
    });

    parent.children.push(...parentCreatedCellIds);
    parent.active = false;
    parent.hidden = true;
    removeActiveLeafCellId(session, parentId);
    hiddenCellIds.push(parentId);
  }

  const command: RefinementSessionCommand = {
    id: `cmd-${session.nextCommandId}`,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    createdNodeIds
  };
  session.nextCommandId += 1;
  session.undoStack.push(command);
  session.redoStack = [];
  return command;
}

export function refineSessionPatch(
  session: RefinementSession,
  cellIds: CellId[],
  options: RefinementSessionPatchOptions = {}
): RefinementSessionCommand {
  const validation = validateRefinementSessionSelection(session, cellIds);
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const active = options.activeBuild ?? buildRefinementPatchActiveMesh(session, validation.cellIds, options);
  const selectedElementIds = validation.cellIds
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId): elementId is number => elementId !== undefined);
  if (selectedElementIds.length !== validation.cellIds.length) {
    throw new Error("refinement selection contains cells outside the active mesh");
  }

  const replacements = buildDefaultRefinementReplacements(active.mesh, selectedElementIds, {
    includeTransitions: options.includeTransitions ?? true,
    transitionSupportElementIds: (options.transitionSupportCellIds ?? [])
      .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
      .filter((elementId): elementId is number => elementId !== undefined),
    regularizeHexSelection: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  });
  const parentIds = new Set<CellId>();
  for (const replacement of replacements) {
    const parentId = activeBuildCellIdByElementId(active, replacement.elementId);
    if (parentId === undefined) {
      throw new Error(`replacement parent element ${replacement.elementId} is outside the active mesh`);
    }
    const parent = requiredCell(session, parentId);
    if (!isRefinableSessionCell(parent)) {
      throw new Error(`transition layer cells cannot be refined: ${parentId}`);
    }
    if (parent.level !== validation.level) {
      throw new Error(`refinement patch crosses levels: ${parentId}`);
    }
    parentIds.add(parentId);
  }

  const hiddenCellIds = [...parentIds].sort(compareCellIds);
  const createdCellIds: CellId[] = [];
  const createdNodeIds: number[] = [];

  for (const replacement of replacements) {
    const parentId = activeBuildCellIdByElementId(active, replacement.elementId)!;
    const parent = requiredCell(session, parentId);
    const nodeOffset = session.nodes.length;
    for (const [index, point] of replacement.refinement.nodes.entries()) {
      session.nodes.push([...point]);
      createdNodeIds.push(nodeOffset + index + 1);
    }

    const parentCreatedCellIds: CellId[] = [];
    const firstChildIndex = parent.children.length + 1;
    replacement.refinement.elements.forEach((element, index) => {
      const childId = `${parentId}/${firstChildIndex + index}`;
      parentCreatedCellIds.push(childId);
      createdCellIds.push(childId);
      const child: RefinementSessionCell = {
        id: childId,
        ordinal: nextCellOrdinal(session),
        parentId,
        level: parent.level + 1,
        role: replacement.role,
        kind: parent.kind,
        element: element.map((nodeId) => nodeId + nodeOffset),
        children: [],
        active: true,
        hidden: false,
        template: String(replacement.templateCode)
      };
      if (parent.sourceElementId !== undefined) {
        child.sourceElementId = parent.sourceElementId;
      }
      session.cells.set(childId, child);
      addActiveLeafCellId(session, childId);
    });
    parent.children.push(...parentCreatedCellIds);
  }

  for (const parentId of hiddenCellIds) {
    const parent = requiredCell(session, parentId);
    parent.active = false;
    parent.hidden = true;
    removeActiveLeafCellId(session, parentId);
  }

  const command: RefinementSessionCommand = {
    id: `cmd-${session.nextCommandId}`,
    kind: "refine",
    hiddenCellIds,
    createdCellIds,
    createdNodeIds
  };
  session.nextCommandId += 1;
  session.undoStack.push(command);
  session.redoStack = [];
  return command;
}

function buildRefinementPatchActiveMesh(
  session: RefinementSession,
  selectedCellIds: readonly CellId[],
  options: RefinementSessionPatchOptions
): ActiveMeshBuildResult {
  const activeIds = collectRefinementPatchActiveCellIds(session, selectedCellIds);
  return buildActiveMeshForCellIdsWithMap(session, activeIds, {
    mergeNodes: true,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false,
    ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
  });
}

function collectRefinementPatchActiveCellIds(
  session: RefinementSession,
  selectedCellIds: readonly CellId[]
): CellId[] {
  const haloCellIds = new Set<CellId>(selectedCellIds);

  for (const cellId of selectedCellIds) {
    const cell = requiredCell(session, cellId);
    for (const sessionNodeId of cell.element) {
      const point = session.nodes[sessionNodeId - 1];
      if (!point) {
        throw new Error(`selected cell ${cellId} references missing node ${sessionNodeId}`);
      }
      for (const ownerId of session.activeLeafIdsByNodeKey.get(exactActiveMergeKey(point)) ?? []) {
        haloCellIds.add(ownerId);
      }
    }
  }

  return sortedActiveLeafIds(session).filter((cellId) => haloCellIds.has(cellId));
}

export function validateRefinementSessionSelection(
  session: RefinementSession,
  cellIds: CellId[]
): RefinementSessionSelectionValidation {
  const uniqueCellIds = [...new Set(cellIds)];
  const missingCellIds: CellId[] = [];
  const inactiveCellIds: CellId[] = [];
  const transitionCellIds: CellId[] = [];
  const mixedLevelCellIds: CellId[] = [];
  const errors: string[] = [];
  let level: number | undefined;

  if (uniqueCellIds.length === 0) {
    errors.push("refinement selection must contain at least one cell");
  }

  for (const cellId of uniqueCellIds) {
    const cell = session.cells.get(cellId);
    if (!cell) {
      missingCellIds.push(cellId);
      continue;
    }
    if (!cell.active || cell.hidden || !session.activeLeafIds.has(cellId)) {
      inactiveCellIds.push(cellId);
    }
    if (isTransitionSessionCell(cell)) {
      transitionCellIds.push(cellId);
    }
    if (level === undefined) {
      level = cell.level;
    } else if (cell.level !== level) {
      mixedLevelCellIds.push(cellId);
    }
  }

  if (missingCellIds.length > 0) {
    errors.push(`cells do not exist: ${missingCellIds.join(", ")}`);
  }
  if (inactiveCellIds.length > 0) {
    errors.push(`cells are not active leaves: ${inactiveCellIds.join(", ")}`);
  }
  if (transitionCellIds.length > 0) {
    errors.push(`transition layer cells cannot be refined: ${transitionCellIds.join(", ")}`);
  }
  if (mixedLevelCellIds.length > 0) {
    errors.push(`refinement selection crosses levels: ${mixedLevelCellIds.join(", ")}`);
  }

  return {
    ok: errors.length === 0,
    cellIds: uniqueCellIds,
    level,
    missingCellIds,
    inactiveCellIds,
    transitionCellIds,
    mixedLevelCellIds,
    errors
  };
}

export function isRefinableSessionCell(cell: RefinementSessionCell): boolean {
  return cell.active && !cell.hidden && !isTransitionSessionCell(cell);
}

function isTransitionSessionCell(cell: RefinementSessionCell): boolean {
  return isTransitionSessionRole(cell.role);
}

function isTransitionSessionRole(role: RefinementSessionCellRole): boolean {
  return role === "face-transition" || role === "edge-transition" || role === "corner-transition";
}

export function undoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined {
  const command = session.undoStack.pop();
  if (!command) {
    return undefined;
  }
  for (const cellId of command.createdCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.hiddenCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = true;
    cell.hidden = false;
    addActiveLeafCellId(session, cellId);
  }
  session.redoStack.push(command);
  return command;
}

export function redoRefinementSession(session: RefinementSession): RefinementSessionCommand | undefined {
  const command = session.redoStack.pop();
  if (!command) {
    return undefined;
  }
  for (const cellId of command.hiddenCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = false;
    cell.hidden = true;
    removeActiveLeafCellId(session, cellId);
  }
  for (const cellId of command.createdCellIds) {
    const cell = requiredCell(session, cellId);
    cell.active = true;
    cell.hidden = false;
    addActiveLeafCellId(session, cellId);
  }
  session.undoStack.push(command);
  return command;
}

function baseCellId(elementId: number): CellId {
  return `e${elementId}`;
}

function cloneMesh(mesh: Mesh): Mesh {
  const clone = {
    nodes: mesh.nodes.map((point) => [...point]),
    elements: mesh.elements.map((element) => [...element])
  };
  return mesh.kind ? { ...clone, kind: mesh.kind } : clone;
}

function requiredCell(session: RefinementSession, cellId: CellId): RefinementSessionCell {
  const cell = session.cells.get(cellId);
  if (!cell) {
    throw new Error(`cell ${cellId} does not exist`);
  }
  return cell;
}

function addActiveLeafCellId(session: RefinementSession, cellId: CellId): void {
  if (session.activeLeafIds.has(cellId)) {
    return;
  }
  const cell = requiredCell(session, cellId);
  session.activeLeafIds.add(cellId);
  session.sortedActiveLeafIdsDirty = true;
  for (const sessionNodeId of cell.element) {
    const point = session.nodes[sessionNodeId - 1];
    if (!point) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const key = exactActiveMergeKey(point);
    const ownerIds = session.activeLeafIdsByNodeKey.get(key) ?? [];
    ownerIds.push(cellId);
    session.activeLeafIdsByNodeKey.set(key, ownerIds);
  }
}

function removeActiveLeafCellId(session: RefinementSession, cellId: CellId): void {
  const cell = requiredCell(session, cellId);
  if (!session.activeLeafIds.delete(cellId)) {
    return;
  }
  session.sortedActiveLeafIdsDirty = true;
  for (const sessionNodeId of cell.element) {
    const point = session.nodes[sessionNodeId - 1];
    if (!point) {
      throw new Error(`active cell ${cellId} references missing node ${sessionNodeId}`);
    }
    const key = exactActiveMergeKey(point);
    const ownerIds = session.activeLeafIdsByNodeKey.get(key);
    if (!ownerIds) {
      continue;
    }
    const nextOwnerIds = ownerIds.filter((ownerId) => ownerId !== cellId);
    if (nextOwnerIds.length === 0) {
      session.activeLeafIdsByNodeKey.delete(key);
    } else {
      session.activeLeafIdsByNodeKey.set(key, nextOwnerIds);
    }
  }
}

function sortedActiveLeafIds(session: RefinementSession): readonly CellId[] {
  if (session.sortedActiveLeafIdsDirty) {
    session.sortedActiveLeafIds = [...session.activeLeafIds].sort((a, b) => cellOrdinal(session, a) - cellOrdinal(session, b));
    session.sortedActiveLeafIdsDirty = false;
  }
  return session.sortedActiveLeafIds;
}

function nextCellOrdinal(session: RefinementSession): number {
  const ordinal = session.nextCellOrdinal ?? session.cells.size + 1;
  session.nextCellOrdinal = ordinal + 1;
  return ordinal;
}

function cellOrdinal(session: RefinementSession, cellId: CellId): number {
  return session.cells.get(cellId)?.ordinal ?? Number.MAX_SAFE_INTEGER;
}

function sessionMeshView(session: RefinementSession): Mesh {
  return {
    kind: session.kind,
    nodes: session.nodes,
    elements: []
  };
}

function buildLocalActiveMeshAroundElements(
  build: ActiveMeshBuildResult,
  seedElementIds: readonly number[]
): {
  mesh: Mesh;
  checkedCellIds: CellId[];
  checkedElementIds: number[];
} {
  if (seedElementIds.length === 0) {
    return {
      mesh: build.mesh.kind ? { kind: build.mesh.kind, nodes: [], elements: [] } : { nodes: [], elements: [] },
      checkedCellIds: [],
      checkedElementIds: []
    };
  }

  const seedNodeIds = new Set<number>();
  const seedElementIdSet = new Set(seedElementIds);
  for (const elementId of seedElementIds) {
    for (const nodeId of build.mesh.elements[elementId - 1] ?? []) {
      seedNodeIds.add(nodeId);
    }
  }

  const checkedElementIds = checkedElementIdsAroundSeeds(build, seedElementIds, seedNodeIds, seedElementIdSet);

  const usedNodeIds = new Set<number>();
  for (const elementId of checkedElementIds) {
    for (const nodeId of build.mesh.elements[elementId - 1] ?? []) {
      usedNodeIds.add(nodeId);
    }
  }
  const nodeIdMap = new Map<number, number>();
  const nodes = [...usedNodeIds].sort((a, b) => a - b).map((nodeId, index) => {
    nodeIdMap.set(nodeId, index + 1);
    return build.mesh.nodes[nodeId - 1]!;
  });
  const elements = checkedElementIds.map((elementId) =>
    (build.mesh.elements[elementId - 1] ?? []).map((nodeId) => {
      const mapped = nodeIdMap.get(nodeId);
      if (mapped === undefined) {
        throw new Error(`local conformance mesh references missing node ${nodeId}`);
      }
      return mapped;
    })
  );

  return {
    mesh: build.mesh.kind ? { kind: build.mesh.kind, nodes, elements } : { nodes, elements },
    checkedCellIds: checkedElementIds
      .map((elementId) => activeBuildCellIdByElementId(build, elementId))
      .filter((cellId): cellId is CellId => cellId !== undefined),
    checkedElementIds
  };
}

function checkedElementIdsAroundSeeds(
  build: ActiveMeshBuildResult,
  seedElementIds: readonly number[],
  seedNodeIds: ReadonlySet<number>,
  seedElementIdSet: ReadonlySet<number>
): number[] {
  const checkedElementIds = new Set<number>(seedElementIds);
  if (build.elementIdsByNodeId) {
    for (const nodeId of seedNodeIds) {
      for (const elementId of build.elementIdsByNodeId.get(nodeId) ?? []) {
        checkedElementIds.add(elementId);
      }
    }
    return [...checkedElementIds].sort((a, b) => a - b);
  }

  for (let index = 0; index < build.mesh.elements.length; index += 1) {
    const elementId = index + 1;
    if (seedElementIdSet.has(elementId)) {
      continue;
    }
    const element = build.mesh.elements[index]!;
    if (element.some((nodeId) => seedNodeIds.has(nodeId))) {
      checkedElementIds.add(elementId);
    }
  }
  return [...checkedElementIds].sort((a, b) => a - b);
}

function buildElementIdsByNodeId(elements: readonly Element[]): Map<number, number[]> {
  const elementIdsByNodeId = new Map<number, number[]>();
  elements.forEach((element, index) => {
    const elementId = index + 1;
    for (const nodeId of element) {
      const elementIds = elementIdsByNodeId.get(nodeId) ?? [];
      elementIds.push(elementId);
      elementIdsByNodeId.set(nodeId, elementIds);
    }
  });
  return elementIdsByNodeId;
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

function uniqueSortedNumbers(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function compareCellIds(a: CellId, b: CellId): number {
  const ap = cellIdParts(a);
  const bp = cellIdParts(b);
  for (let i = 0; i < Math.max(ap.length, bp.length); i += 1) {
    const av = ap[i] ?? -1;
    const bv = bp[i] ?? -1;
    if (av !== bv) {
      return av - bv;
    }
  }
  return a.localeCompare(b);
}

function cellIdParts(cellId: CellId): number[] {
  const cached = cellIdPartsCache.get(cellId);
  if (cached) {
    return cached;
  }
  const parts = cellId.split("/").map((part) => Number(part.replace(/^e/, "")));
  cellIdPartsCache.set(cellId, parts);
  return parts;
}
