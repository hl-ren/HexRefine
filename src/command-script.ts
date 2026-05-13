import type { ActiveMeshBuildResult, CellId, RefinementSession, RefinementSessionCell } from "./refinement-session.js";
import type { Mesh, Point } from "./types.js";
import {
  buildActiveMeshWithMap,
  createRefinementSession,
  isRefinableSessionCell,
  redoRefinementSession,
  refineSessionPatch,
  undoRefinementSession
} from "./refinement-session.js";
import { createHexUnitCubeMesh, createQ1UnitSquareMesh } from "./grid.js";
import { meshFromSerializable } from "./mesh-io.js";
import { buildDefaultRefinementReplacements } from "./refinement-planner.js";
import { prepareSessionRefineSelection } from "./session-selection-prep.js";

export interface ComformHexCommand {
  index?: number;
  time?: string;
  kind: string;
  payload?: Record<string, unknown>;
}

export interface ComformHexCommandScript {
  format?: string;
  version?: number;
  app?: string;
  createdAt?: string;
  savedAt?: string;
  commands: ComformHexCommand[];
}

export interface ComformHexMaterial {
  name: string;
  elasticModulus?: number;
  poissonRatio?: number;
}

export interface ComformHexReplayResult {
  session: RefinementSession;
  mesh: Mesh;
  mergeTolerance?: number;
  cellSets: Map<string, CellId[]>;
  nodeSets: Map<string, number[]>;
  cellSetMaterials: Map<string, ComformHexMaterial>;
  warnings: string[];
  selectionDiagnostics: ComformHexReplaySelectionDiagnostic[];
  replayedCommandCount: number;
}

export interface ReplayComformHexCommandScriptOptions {
  gridOverride?: {
    kind?: "Q1" | "H1";
    nx?: number;
    ny?: number;
    nz?: number;
    bounds?: {
      min: Point;
      max: Point;
    };
  };
  mergeTolerance?: number;
  selectionStrategy?: "recorded" | "replay";
  strict?: boolean;
}

interface ReplayRankSelection {
  kind: "level-rank-range";
  level: number;
  domainDimensions: [number, number, number];
  range: {
    min: [number, number, number];
    max: [number, number, number];
  };
  sourceElementCount?: number;
}

interface ReplayRankIndex {
  coordinates: [number[], number[], number[]];
  elementIdByRank: Map<string, number>;
  ranksByElementId: Map<number, [number, number, number]>;
  tolerance: number;
}

interface ReplayScreenView {
  kind: "screen-ortho-view";
  projectionMode?: "perspective" | "parallel";
  canvas: {
    width: number;
    height: number;
  };
  camera: {
    yaw: number;
    pitch: number;
    roll: number;
    zoom: number;
    center: [number, number, number];
  };
}
const replayPerspectiveStrength = 2.4;

export interface ComformHexReplaySelectionDiagnostic {
  commandKind: "refine.patch";
  selectionSource: "state.selected-elements" | "payload.replaySelection" | "payload.cellIds" | "payload.elementIds";
  sourceElementCount?: number;
  preparedElementCount?: number;
  preparedCellCount?: number;
  stabilizedCellCount?: number;
  expandedCandidateCount?: number;
  boundedCoreCount?: number;
  outerElementCount?: number;
  transitionEscapeCount?: number;
  warnings: string[];
  notice?: string;
}

const replayFaceSets = {
  Q1: [[0, 1, 2, 3]],
  H1: [
    [0, 1, 2, 3],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [1, 2, 6, 5],
    [2, 3, 7, 6],
    [3, 0, 4, 7]
  ]
} as const;

interface ReplayState {
  session: RefinementSession | undefined;
  mergeTolerance: number | undefined;
  cellSets: Map<string, CellId[]>;
  nodeSets: Map<string, number[]>;
  cellSetMaterials: Map<string, ComformHexMaterial>;
  hiddenElementIds: Set<number>;
  selectedElementIds: Set<number>;
  selectedNodeIds: Set<number>;
  deleteUndoSnapshots: ReplaySnapshot[];
  deleteRedoSnapshots: ReplaySnapshot[];
  warnings: string[];
  selectionDiagnostics: ComformHexReplaySelectionDiagnostic[];
  replayedCommandCount: number;
}

interface ReplaySnapshot {
  session: RefinementSession;
  mergeTolerance: number | undefined;
  cellSets: Map<string, CellId[]>;
  nodeSets: Map<string, number[]>;
  cellSetMaterials: Map<string, ComformHexMaterial>;
  hiddenElementIds: Set<number>;
  selectedElementIds: Set<number>;
  selectedNodeIds: Set<number>;
}

export function replayComformHexCommandScript(
  script: ComformHexCommandScript,
  options: ReplayComformHexCommandScriptOptions = {}
): ComformHexReplayResult {
  if (!script || !Array.isArray(script.commands)) {
    throw new Error("ComformHex command script must contain a commands array");
  }

  const state: ReplayState = {
    session: undefined,
    mergeTolerance: options.mergeTolerance,
    cellSets: new Map(),
    nodeSets: new Map(),
    cellSetMaterials: new Map(),
    hiddenElementIds: new Set(),
    selectedElementIds: new Set(),
    selectedNodeIds: new Set(),
    deleteUndoSnapshots: [],
    deleteRedoSnapshots: [],
    warnings: [],
    selectionDiagnostics: [],
    replayedCommandCount: 0
  };

  for (const command of script.commands) {
    replayCommand(state, command, options);
  }

  if (!state.session) {
    throw new Error("ComformHex command script did not create a grid");
  }

  const active = buildActiveMeshWithMap(state.session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  return {
    session: state.session,
    mesh: active.mesh,
    ...(state.mergeTolerance !== undefined ? { mergeTolerance: state.mergeTolerance } : {}),
    cellSets: state.cellSets,
    nodeSets: state.nodeSets,
    cellSetMaterials: state.cellSetMaterials,
    warnings: state.warnings,
    selectionDiagnostics: state.selectionDiagnostics,
    replayedCommandCount: state.replayedCommandCount
  };
}

function replayCommand(
  state: ReplayState,
  command: ComformHexCommand,
  options: ReplayComformHexCommandScriptOptions
): void {
  const payload = command.payload ?? {};
  switch (command.kind) {
    case "grid.generate":
      replayGridGenerate(state, payload, options);
      break;
    case "grid.import":
      replayGridImport(state, payload);
      break;
    case "grid.counts-from-dx":
    case "refine.preview":
      break;
    case "select.screen-rect":
    case "select.screen-circle":
      if (replayUsesSelectionState(options)) {
        replayScreenSelectionCommand(state, command.kind, payload, options);
      }
      break;
    case "select.pick":
      replaySelectPick(state, payload);
      break;
    case "select.coordinate-box":
      replaySelectCoordinateBox(state, payload);
      break;
    case "select.all":
      replaySelectAll(state, payload);
      break;
    case "select.invert":
      replaySelectInvert(state, payload);
      break;
    case "select.clear":
      replayClearSelection(state);
      break;
    case "view.hide-selected":
      replayHideSelected(state);
      break;
    case "view.hide-elements":
      replayHideElements(state, payload);
      break;
    case "view.show-hidden":
      replayShowHidden(state);
      break;
    case "refine.patch":
      replayRefinePatch(state, payload, options);
      break;
    case "delete.elements":
      replayDeleteElements(state, payload, options);
      break;
    case "undo.delete":
      replayUndoDelete(state, options);
      break;
    case "redo.delete":
      replayRedoDelete(state, options);
      break;
    case "undo.refine":
      requireSession(state);
      undoRefinementSession(state.session!);
      resetReplayViewState(state);
      break;
    case "redo.refine":
      requireSession(state);
      redoRefinementSession(state.session!);
      resetReplayViewState(state);
      break;
    case "set.nodes.save":
      replaySaveNodeSet(state, payload, options);
      break;
    case "set.cells.save":
      replaySaveCellSet(state, payload, options);
      break;
    case "material.assign":
      replayAssignMaterial(state, payload);
      break;
    case "set.delete":
      replayDeleteSet(state, payload);
      break;
    default:
      handleWarning(state, options, `unsupported command kind: ${command.kind}`);
      return;
  }
  state.replayedCommandCount += 1;
}

function replayGridGenerate(
  state: ReplayState,
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions
): void {
  const override = options.gridOverride;
  const kind = readString(override?.kind ?? payload.kind, "H1") === "Q1" ? "Q1" : "H1";
  const nx = readPositiveInteger(override?.nx ?? payload.nx, 1);
  const ny = readPositiveInteger(override?.ny ?? payload.ny, 1);
  const nz = kind === "Q1" ? 1 : readPositiveInteger(override?.nz ?? payload.nz, 1);
  const bounds = override?.bounds
    ? normalizeBounds(override.bounds, kind)
    : readBounds(payload.bounds, kind);
  const unit = kind === "Q1"
    ? createQ1UnitSquareMesh(nx, ny)
    : createHexUnitCubeMesh(nx, ny, nz);
  const mesh = transformMeshToBounds(unit, bounds);

  state.session = createRefinementSession(mesh);
  state.mergeTolerance = readOptionalNumber(payload.mergeTolerance) ?? defaultMergeTolerance(bounds);
  state.cellSets.clear();
  state.nodeSets.clear();
  state.cellSetMaterials.clear();
  state.deleteUndoSnapshots = [];
  state.deleteRedoSnapshots = [];
  resetReplayViewState(state);
}

function replayGridImport(state: ReplayState, payload: Record<string, unknown>): void {
  const mesh = meshFromSerializable("mesh" in payload ? payload.mesh : payload);
  state.session = createRefinementSession(mesh);
  state.mergeTolerance = readOptionalNumber(payload.mergeTolerance) ?? defaultMergeTolerance(boundsOfMesh(mesh));
  state.cellSets.clear();
  state.nodeSets.clear();
  state.cellSetMaterials.clear();
  state.deleteUndoSnapshots = [];
  state.deleteRedoSnapshots = [];
  resetReplayViewState(state);
}

function replayRefinePatch(
  state: ReplayState,
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions
): void {
  state.deleteRedoSnapshots = [];
  const session = requireSession(state);
  const commandOptions = readObject(payload.options);
  const includeTransitions = readBoolean(commandOptions.includeTransitions, true);
  const regularizeHexSelection = readBoolean(commandOptions.regularizeHexSelection, false);
  const mergeTolerance = readOptionalNumber(commandOptions.mergeTolerance) ?? state.mergeTolerance;
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const cellIds = readStringArray(payload.cellIds);
  const elementIds = readNumberArray(payload.elementIds);
  const replaySelection = resolveReplayRefineSelection(state, payload, options, session, active, {
    includeTransitions,
    regularizeHexSelection,
    ...(mergeTolerance !== undefined ? { mergeTolerance } : {})
  });
  const selectedCellIds = replaySelection.usedReplaySelectionSource
    ? replaySelection.cellIds
    : cellIds.length > 0
      ? cellIds
      : elementIds
        .map((elementId) => active.cellIdByElementId.get(elementId))
        .filter((cellId): cellId is CellId => cellId !== undefined);
  const transitionSupportCellIds = replaySelection.usedReplaySelectionSource
    ? replaySelection.transitionSupportCellIds
    : readStringArray(payload.transitionSupportCellIds);
  if (selectedCellIds.length === 0) {
    handleWarning(state, options, "refine.patch command has no replayable cells");
    return;
  }
  for (const warning of replaySelection.warnings) {
    handleWarning(state, options, warning);
  }
  refineSessionPatch(session, selectedCellIds, {
    includeTransitions,
    transitionSupportCellIds,
    activeBuild: active,
    ...(mergeTolerance !== undefined ? { mergeTolerance } : {})
  });
  resetReplayViewState(state);
}

interface ReplayResolvedElementSelection {
  source: "state.selected-elements" | "payload.replaySelection";
  elementIds: number[];
  warnings: string[];
}

interface ReplayResolvedPatchSelection {
  usedReplaySelectionSource: boolean;
  cellIds: CellId[];
  transitionSupportCellIds: CellId[];
  warnings: string[];
}

function resolveReplayRefineSelection(
  state: ReplayState,
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions,
  session: RefinementSession,
  active: ActiveMeshBuildResult,
  prepareOptions: {
    includeTransitions: boolean;
    regularizeHexSelection: boolean;
    mergeTolerance?: number;
  }
): ReplayResolvedPatchSelection {
  if (!replayUsesSelectionState(options)) {
    return { usedReplaySelectionSource: false, cellIds: [], transitionSupportCellIds: [], warnings: [] };
  }

  const resolved = resolveReplayRefineElementSelection(state, payload, session, active);
  if (!resolved) {
    return { usedReplaySelectionSource: false, cellIds: [], transitionSupportCellIds: [], warnings: [] };
  }

  const prepared = prepareSessionRefineSelection(session, active, resolved.elementIds, prepareOptions);
  const stabilized = prepared.cellIds.length > 0
    ? stabilizeReplaySelectionForPatch(session, active, prepared.cellIds, {
        includeTransitions: prepareOptions.includeTransitions,
        ...(prepareOptions.mergeTolerance !== undefined ? { mergeTolerance: prepareOptions.mergeTolerance } : {})
      })
    : { cellIds: prepared.cellIds };
  const warnings = uniqueStrings([
    ...resolved.warnings,
    ...prepared.warnings,
    ...("warning" in stabilized && stabilized.warning ? [stabilized.warning] : [])
  ]);

  state.selectionDiagnostics.push({
    commandKind: "refine.patch",
    selectionSource: resolved.source,
    sourceElementCount: resolved.elementIds.length,
    preparedElementCount: prepared.elementIds.length,
    preparedCellCount: prepared.cellIds.length,
    stabilizedCellCount: stabilized.cellIds.length,
    ...(prepared.expandedCandidateCount !== undefined ? { expandedCandidateCount: prepared.expandedCandidateCount } : {}),
    ...(prepared.boundedCoreCount !== undefined ? { boundedCoreCount: prepared.boundedCoreCount } : {}),
    ...(prepared.outerElementIds ? { outerElementCount: prepared.outerElementIds.length } : {}),
    ...(prepared.transitionEscapeCount !== undefined ? { transitionEscapeCount: prepared.transitionEscapeCount } : {}),
    warnings,
    ...(prepared.notice ? { notice: prepared.notice } : {})
  });

  return {
    usedReplaySelectionSource: true,
    cellIds: stabilized.cellIds,
    transitionSupportCellIds: prepared.outerCellIds ?? [],
    warnings
  };
}

function resolveReplayRefineElementSelection(
  state: ReplayState,
  payload: Record<string, unknown>,
  session: RefinementSession,
  active: ActiveMeshBuildResult
): ReplayResolvedElementSelection | null {
  if (state.selectedElementIds.size > 0) {
    const selection = activeElementIdsFromReplaySelectionState(state, active);
    return {
      source: "state.selected-elements",
      elementIds: selection.elementIds,
      warnings: uniqueStrings([
        ...(selection.warning ? [selection.warning] : [])
      ])
    };
  }

  const payloadRankSelection = readReplayRankSelection(payload.replaySelection);
  if (!payloadRankSelection) {
    return null;
  }

  const selection = activeElementIdsFromReplayRankSelection(session, payloadRankSelection, undefined, active);
  return {
    source: "payload.replaySelection",
    elementIds: selection.elementIds,
    warnings: uniqueStrings([
      ...(selection.warning ? [selection.warning] : [])
    ])
  };
}

function replayDeleteElements(
  state: ReplayState,
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions
): void {
  const session = requireSession(state);
  const mode = readString(payload.mode, "delete");
  const deletedElementIds = replayUsesSelectionState(options) && state.selectedElementIds.size > 0
    ? new Set([...state.selectedElementIds])
    : new Set(readNumberArray(payload.elementIds));
  const keptElementIds = new Set(readNumberArray(payload.keptElementIds));
  if (mode !== "keep" && deletedElementIds.size === 0) {
    handleWarning(state, options, "delete.elements command has no element ids");
    return;
  }

  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  state.deleteUndoSnapshots.push(captureReplaySnapshot(state));
  state.deleteRedoSnapshots = [];
  const elements = mode === "keep"
    ? active.mesh.elements.filter((_, index) => keptElementIds.has(index + 1))
    : active.mesh.elements.filter((_, index) => !deletedElementIds.has(index + 1));
  const mesh = {
    nodes: active.mesh.nodes,
    elements
  };
  state.session = createRefinementSession(active.mesh.kind ? { ...mesh, kind: active.mesh.kind } : mesh);
  state.cellSets.clear();
  state.nodeSets.clear();
  state.cellSetMaterials.clear();
  resetReplayViewState(state);
}

function replayUndoDelete(
  state: ReplayState,
  options: ReplayComformHexCommandScriptOptions
): void {
  const snapshot = state.deleteUndoSnapshots.pop();
  if (!snapshot) {
    handleWarning(state, options, "undo.delete command has no prior delete state");
    return;
  }
  state.deleteRedoSnapshots.push(captureReplaySnapshot(state));
  restoreReplaySnapshot(state, snapshot);
}

function replayRedoDelete(
  state: ReplayState,
  options: ReplayComformHexCommandScriptOptions
): void {
  const snapshot = state.deleteRedoSnapshots.pop();
  if (!snapshot) {
    handleWarning(state, options, "redo.delete command has no redo state");
    return;
  }
  state.deleteUndoSnapshots.push(captureReplaySnapshot(state));
  restoreReplaySnapshot(state, snapshot);
}

function replaySaveNodeSet(
  state: ReplayState,
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions
): void {
  state.deleteRedoSnapshots = [];
  const name = sanitizeName(readString(payload.name, `NSET-${state.nodeSets.size + 1}`));
  const sessionNodeIds = readNumberArray(payload.sessionNodeIds);
  if (!replayUsesSelectionState(options) && sessionNodeIds.length > 0) {
    state.nodeSets.set(name, sessionNodeIds);
    return;
  }

  const session = requireSession(state);
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: true
  });
  const nodeIds = replayUsesSelectionState(options) && state.selectedNodeIds.size > 0
    ? [...state.selectedNodeIds]
    : readNumberArray(payload.nodeIds);
  const mapped = nodeIds.flatMap((nodeId) => active.sessionNodeIdsByNodeId.get(nodeId) ?? []);
  if (mapped.length === 0 && sessionNodeIds.length > 0) {
    state.nodeSets.set(name, sessionNodeIds);
    return;
  }
  state.nodeSets.set(name, uniqueSorted(mapped));
}

function replaySaveCellSet(
  state: ReplayState,
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions
): void {
  state.deleteRedoSnapshots = [];
  const name = sanitizeName(readString(payload.name, `ELSET-${state.cellSets.size + 1}`));
  const cellIds = readStringArray(payload.cellIds);
  if (!replayUsesSelectionState(options) && cellIds.length > 0) {
    state.cellSets.set(name, cellIds);
  } else {
    const session = requireSession(state);
    const active = buildActiveMeshWithMap(session, {
      ...activeBuildOptions(state),
      includeSessionNodeIdByNodeId: false,
      includeSessionNodeIdsByNodeId: false
    });
    const elementIds = replayUsesSelectionState(options) && state.selectedElementIds.size > 0
      ? [...state.selectedElementIds]
      : readNumberArray(payload.elementIds);
    const replayedCellIds = elementIds
      .map((elementId) => active.cellIdByElementId.get(elementId))
      .filter((cellId): cellId is CellId => cellId !== undefined);
    state.cellSets.set(name, replayedCellIds.length > 0 ? replayedCellIds : cellIds);
  }

  const material = readMaterial(payload.material);
  if (material) {
    state.cellSetMaterials.set(name, material);
  }
}

function replayAssignMaterial(state: ReplayState, payload: Record<string, unknown>): void {
  state.deleteRedoSnapshots = [];
  const name = sanitizeName(readString(payload.setName, ""));
  const material = readMaterial(payload.material);
  if (name && material) {
    state.cellSetMaterials.set(name, material);
  }
}

function replayDeleteSet(state: ReplayState, payload: Record<string, unknown>): void {
  state.deleteRedoSnapshots = [];
  const name = sanitizeName(readString(payload.name, ""));
  if (!name) {
    return;
  }
  state.nodeSets.delete(name);
  state.cellSets.delete(name);
  state.cellSetMaterials.delete(name);
}

function replayScreenSelectionCommand(
  state: ReplayState,
  commandKind: "select.screen-rect" | "select.screen-circle",
  payload: Record<string, unknown>,
  options: ReplayComformHexCommandScriptOptions
): void {
  const screenView = readReplayScreenView(payload.viewSelection);
  if (screenView) {
    if (commandKind === "select.screen-circle") {
      replaySelectScreenCircle(state, payload, screenView);
    } else {
      replaySelectScreenRect(state, payload, screenView);
    }
    return;
  }

  const rankSelection = readReplayRankSelection(payload.rankSelection);
  if (rankSelection) {
    replaySelectRankSelection(state, {
      target: payload.target,
      additive: payload.additive,
      selectionMode: payload.selectionMode,
      mode: payload.mode
    }, rankSelection);
    return;
  }

  const meshBox = readObject(payload.meshBox);
  if ("min" in meshBox && "max" in meshBox) {
    replaySelectCoordinateBox(state, {
      target: payload.target,
      additive: payload.additive,
      selectionMode: payload.selectionMode,
      mode: payload.mode,
      box: meshBox
    });
    return;
  }

  handleWarning(state, options, `screen-space selection is not replayable offline: ${commandKind}`);
}

function replaySelectRankSelection(
  state: ReplayState,
  payload: Record<string, unknown>,
  rankSelection: ReplayRankSelection
): void {
  const session = requireSession(state);
  const additive = readBoolean(payload.additive, false);
  const selectionMode = normalizeSelectionCombinationMode(payload.selectionMode, additive);
  const remove = selectionMode === "remove";
  const selection = activeElementIdsFromReplayRankSelection(session, rankSelection, state);
  const next = selectionMode === "replace" ? new Set<number>() : new Set(state.selectedElementIds);
  for (const elementId of selection.elementIds) {
    if (remove) {
      next.delete(elementId);
    } else {
      next.add(elementId);
    }
  }
  state.selectedElementIds = next;
}

function replaySelectScreenRect(
  state: ReplayState,
  payload: Record<string, unknown>,
  view: ReplayScreenView
): void {
  const session = requireSession(state);
  const target = readString(payload.target, "cells") === "nodes" ? "nodes" : "cells";
  const additive = readBoolean(payload.additive, false);
  const selectionMode = normalizeSelectionCombinationMode(payload.selectionMode, additive);
  const remove = selectionMode === "remove";
  const mode = readString(payload.mode, "through") === "surface" ? "surface" : "through";
  const rect = readObject(payload.rect);
  const min = readPoint(rect.min, [0, 0, 0]);
  const max = readPoint(rect.max, [view.canvas.width, view.canvas.height, 0]);
  const xMin = Math.min(min[0] ?? 0, max[0] ?? 0);
  const xMax = Math.max(min[0] ?? 0, max[0] ?? 0);
  const yMin = Math.min(min[1] ?? 0, max[1] ?? 0);
  const yMax = Math.max(min[1] ?? 0, max[1] ?? 0);
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: target === "nodes"
  });

  if (target === "nodes") {
    const next = selectionMode === "replace" ? new Set<number>() : new Set(state.selectedNodeIds);
    active.mesh.nodes.forEach((point, index) => {
      const projected = projectPointWithView(point, view);
      if (projected.x >= xMin && projected.x <= xMax && projected.y >= yMin && projected.y <= yMax) {
        if (remove) {
          next.delete(index + 1);
        } else {
          next.add(index + 1);
        }
      }
    });
    state.selectedNodeIds = next;
    return;
  }

  const next = selectionMode === "replace" ? new Set<number>() : new Set(state.selectedElementIds);
  if (mode === "surface") {
    const items = buildReplaySurfaceItems(active.mesh, view, state.hiddenElementIds);
    for (const item of items) {
      if (surfaceFaceHitsRect(item, xMin, xMax, yMin, yMax)) {
        if (remove) {
          next.delete(item.elementId);
        } else {
          next.add(item.elementId);
        }
      }
    }
  } else {
    active.mesh.elements.forEach((element, index) => {
      const elementId = index + 1;
      if (state.hiddenElementIds.has(elementId)) {
        return;
      }
      const projected = projectPointWithView(elementCenter3(active.mesh, element), view);
      if (projected.x >= xMin && projected.x <= xMax && projected.y >= yMin && projected.y <= yMax) {
        if (remove) {
          next.delete(elementId);
        } else {
          next.add(elementId);
        }
      }
    });
  }
  state.selectedElementIds = next;
}

function replaySelectScreenCircle(
  state: ReplayState,
  payload: Record<string, unknown>,
  view: ReplayScreenView
): void {
  const session = requireSession(state);
  const target = readString(payload.target, "cells") === "nodes" ? "nodes" : "cells";
  const additive = readBoolean(payload.additive, false);
  const selectionMode = normalizeSelectionCombinationMode(payload.selectionMode, additive);
  const remove = selectionMode === "remove";
  const mode = readString(payload.mode, "through") === "surface" ? "surface" : "through";
  const circle = readObject(payload.circle);
  const center = readPoint(circle.center, [view.canvas.width * 0.5, view.canvas.height * 0.5, 0]);
  const radius = Math.max(0, readOptionalNumber(circle.radius) ?? 0);
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: target === "nodes"
  });

  if (target === "nodes") {
    const next = selectionMode === "replace" ? new Set<number>() : new Set(state.selectedNodeIds);
    active.mesh.nodes.forEach((point, index) => {
      const projected = projectPointWithView(point, view);
      if (pointInCircle2(projected, { x: center[0] ?? 0, y: center[1] ?? 0 }, radius)) {
        if (remove) {
          next.delete(index + 1);
        } else {
          next.add(index + 1);
        }
      }
    });
    state.selectedNodeIds = next;
    return;
  }

  const next = selectionMode === "replace" ? new Set<number>() : new Set(state.selectedElementIds);
  if (mode === "surface") {
    const items = buildReplaySurfaceItems(active.mesh, view, state.hiddenElementIds);
    for (const item of items) {
      if (surfaceFaceHitsCircle(item, { x: center[0] ?? 0, y: center[1] ?? 0 }, radius)) {
        if (remove) {
          next.delete(item.elementId);
        } else {
          next.add(item.elementId);
        }
      }
    }
  } else {
    active.mesh.elements.forEach((element, index) => {
      const elementId = index + 1;
      if (state.hiddenElementIds.has(elementId)) {
        return;
      }
      const projected = projectPointWithView(elementCenter3(active.mesh, element), view);
      if (pointInCircle2(projected, { x: center[0] ?? 0, y: center[1] ?? 0 }, radius)) {
        if (remove) {
          next.delete(elementId);
        } else {
          next.add(elementId);
        }
      }
    });
  }
  state.selectedElementIds = next;
}

function replaySelectCoordinateBox(state: ReplayState, payload: Record<string, unknown>): void {
  const session = requireSession(state);
  const target = readString(payload.target, "cells") === "nodes" ? "nodes" : "cells";
  const additive = readBoolean(payload.additive, false);
  const mode = normalizeSelectionCombinationMode(payload.selectionMode ?? payload.mode, additive);
  const remove = mode === "remove";
  const box = normalizeBounds(readBounds(payload.box, session.kind === "Q1" ? "Q1" : "H1"), session.kind);
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: target === "nodes"
  });

  if (target === "nodes") {
    const next = mode === "replace" ? new Set<number>() : new Set(state.selectedNodeIds);
    active.mesh.nodes.forEach((point, index) => {
      const nodeId = index + 1;
      if (pointInBounds(toPoint3(point), box)) {
        if (remove) {
          next.delete(nodeId);
        } else {
          next.add(nodeId);
        }
      }
    });
    state.selectedNodeIds = next;
    return;
  }

  const next = mode === "replace" ? new Set<number>() : new Set(state.selectedElementIds);
  active.mesh.elements.forEach((element, index) => {
    const elementId = index + 1;
    if (state.hiddenElementIds.has(elementId)) {
      return;
    }
    if (pointInBounds(elementCenter3(active.mesh, element), box)) {
      if (remove) {
        next.delete(elementId);
      } else {
        next.add(elementId);
      }
    }
  });
  state.selectedElementIds = next;
}

function replaySelectAll(state: ReplayState, payload: Record<string, unknown>): void {
  const session = requireSession(state);
  const target = readString(payload.target, "cells") === "nodes" ? "nodes" : "cells";
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: target === "nodes"
  });
  if (target === "nodes") {
    state.selectedNodeIds = new Set(active.mesh.nodes.map((_, index) => index + 1));
    return;
  }
  state.selectedElementIds = new Set(
    active.mesh.elements
      .map((_, index) => index + 1)
      .filter((elementId) => !state.hiddenElementIds.has(elementId))
  );
}

function replaySelectInvert(state: ReplayState, payload: Record<string, unknown>): void {
  const session = requireSession(state);
  const target = readString(payload.target, "cells") === "nodes" ? "nodes" : "cells";
  const active = buildActiveMeshWithMap(session, {
    ...activeBuildOptions(state),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: target === "nodes"
  });
  if (target === "nodes") {
    const next = new Set<number>();
    active.mesh.nodes.forEach((_, index) => {
      const nodeId = index + 1;
      if (!state.selectedNodeIds.has(nodeId)) {
        next.add(nodeId);
      }
    });
    state.selectedNodeIds = next;
    return;
  }
  const next = new Set<number>();
  active.mesh.elements.forEach((_, index) => {
    const elementId = index + 1;
    if (!state.hiddenElementIds.has(elementId) && !state.selectedElementIds.has(elementId)) {
      next.add(elementId);
    }
  });
  state.selectedElementIds = next;
}

function replayClearSelection(state: ReplayState): void {
  state.selectedElementIds = new Set();
  state.selectedNodeIds = new Set();
}

function replaySelectPick(state: ReplayState, payload: Record<string, unknown>): void {
  const elementIds = readPickedElementIds(payload);
  if (elementIds.length === 0) {
    return;
  }
  const mode = normalizeSelectionCombinationMode(payload.selectionMode ?? payload.mode, payload.additive === true);
  const next = mode === "replace" ? new Set<number>() : new Set(state.selectedElementIds);
  for (const elementId of elementIds) {
    if (state.hiddenElementIds.has(elementId)) {
      continue;
    }
    if (mode === "remove") {
      next.delete(elementId);
    } else {
      next.add(elementId);
    }
  }
  state.selectedElementIds = next;
  state.selectedNodeIds = new Set();
}

function replayHideSelected(state: ReplayState): void {
  for (const elementId of state.selectedElementIds) {
    state.hiddenElementIds.add(elementId);
  }
  state.selectedElementIds = new Set();
}

function replayHideElements(state: ReplayState, payload: Record<string, unknown>): void {
  for (const elementId of readPickedElementIds(payload)) {
    state.hiddenElementIds.add(elementId);
    state.selectedElementIds.delete(elementId);
  }
}

function replayShowHidden(state: ReplayState): void {
  state.hiddenElementIds = new Set();
}

function requireSession(state: ReplayState): RefinementSession {
  if (!state.session) {
    throw new Error("ComformHex command script must start with grid.generate or grid.import before mesh operations");
  }
  return state.session;
}

function captureReplaySnapshot(state: ReplayState): ReplaySnapshot {
  const session = requireSession(state);
  return {
    session: cloneRefinementSessionState(session),
    mergeTolerance: state.mergeTolerance,
    cellSets: cloneCellSets(state.cellSets),
    nodeSets: cloneNodeSets(state.nodeSets),
    cellSetMaterials: cloneMaterialAssignments(state.cellSetMaterials),
    hiddenElementIds: new Set(state.hiddenElementIds),
    selectedElementIds: new Set(state.selectedElementIds),
    selectedNodeIds: new Set(state.selectedNodeIds)
  };
}

function restoreReplaySnapshot(state: ReplayState, snapshot: ReplaySnapshot): void {
  state.session = cloneRefinementSessionState(snapshot.session);
  state.mergeTolerance = snapshot.mergeTolerance;
  state.cellSets = cloneCellSets(snapshot.cellSets);
  state.nodeSets = cloneNodeSets(snapshot.nodeSets);
  state.cellSetMaterials = cloneMaterialAssignments(snapshot.cellSetMaterials);
  state.hiddenElementIds = new Set(snapshot.hiddenElementIds);
  state.selectedElementIds = new Set(snapshot.selectedElementIds);
  state.selectedNodeIds = new Set(snapshot.selectedNodeIds);
}

function activeBuildOptions(state: ReplayState): { mergeNodes: true; mergeTolerance?: number } {
  return {
    mergeNodes: true,
    ...(state.mergeTolerance !== undefined ? { mergeTolerance: state.mergeTolerance } : {})
  };
}

function transformMeshToBounds(source: Mesh, bounds: { min: Point; max: Point }): Mesh {
  const span = [
    bounds.max[0]! - bounds.min[0]!,
    bounds.max[1]! - bounds.min[1]!,
    (bounds.max[2] ?? 0) - (bounds.min[2] ?? 0)
  ] as [number, number, number];
  const nodes = source.nodes.map((point) => [
    bounds.min[0]! + (point[0] ?? 0) * span[0],
    bounds.min[1]! + (point[1] ?? 0) * span[1],
    ...(point.length >= 3 ? [(bounds.min[2] ?? 0) + (point[2] ?? 0) * span[2]] : [])
  ]);
  return source.kind ? { kind: source.kind, nodes, elements: source.elements.map((element) => [...element]) } : { nodes, elements: source.elements.map((element) => [...element]) };
}

function replayUsesSelectionState(options: ReplayComformHexCommandScriptOptions): boolean {
  return options.selectionStrategy === "replay";
}

function resetReplayViewState(state: ReplayState): void {
  state.hiddenElementIds = new Set();
  state.selectedElementIds = new Set();
  state.selectedNodeIds = new Set();
}

function normalizeBounds(bounds: { min: Point; max: Point }, kind: "Q1" | "H1"): { min: Point; max: Point } {
  const minPoint = toPoint3(bounds.min);
  const maxPoint = toPoint3(bounds.max);
  const min: [number, number, number] = [
    Math.min(minPoint[0], maxPoint[0]),
    Math.min(minPoint[1], maxPoint[1]),
    Math.min(minPoint[2], maxPoint[2])
  ];
  const max: [number, number, number] = [
    Math.max(minPoint[0], maxPoint[0]),
    Math.max(minPoint[1], maxPoint[1]),
    Math.max(minPoint[2], maxPoint[2])
  ];
  if (kind === "Q1") {
    min[2] = 0;
    max[2] = 0;
  }
  return { min, max };
}

function toPoint3(point: Point): [number, number, number] {
  return [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0];
}

function pointInBounds(point: Point, bounds: { min: Point; max: Point }): boolean {
  const p = toPoint3(point);
  const min = toPoint3(bounds.min);
  const max = toPoint3(bounds.max);
  return p[0] >= min[0] && p[0] <= max[0]
    && p[1] >= min[1] && p[1] <= max[1]
    && p[2] >= min[2] && p[2] <= max[2];
}

function elementCenter3(mesh: Mesh, element: readonly number[]): [number, number, number] {
  const center: [number, number, number] = [0, 0, 0];
  for (const nodeId of element) {
    const point = toPoint3(mesh.nodes[nodeId - 1] ?? []);
    center[0] += point[0];
    center[1] += point[1];
    center[2] += point[2];
  }
  const scale = element.length > 0 ? 1 / element.length : 0;
  center[0] *= scale;
  center[1] *= scale;
  center[2] *= scale;
  return center;
}

function projectPointWithView(point: Point, view: ReplayScreenView): { x: number; y: number; z: number } {
  const p = toPoint3(point);
  const x = p[0] - view.camera.center[0];
  const y = p[1] - view.camera.center[1];
  const z = p[2] - view.camera.center[2];
  const cy = Math.cos(view.camera.yaw);
  const sy = Math.sin(view.camera.yaw);
  const cp = Math.cos(view.camera.pitch);
  const sp = Math.sin(view.camera.pitch);
  const x1 = x * cy - z * sy;
  const z1 = x * sy + z * cy;
  const y2 = y * cp - z1 * sp;
  const z2 = y * sp + z1 * cp;
  const cr = Math.cos(view.camera.roll);
  const sr = Math.sin(view.camera.roll);
  const xr = x1 * cr - y2 * sr;
  const yr = x1 * sr + y2 * cr;
  const perspectiveDistance = perspectiveDistanceForReplayView(view);
  const perspectiveScale = view.projectionMode === "parallel"
    ? 1
    : perspectiveDistance / Math.max(1e-6, perspectiveDistance - z2);
  return {
    x: view.canvas.width * 0.5 + xr * view.camera.zoom * perspectiveScale,
    y: view.canvas.height * 0.5 - yr * view.camera.zoom * perspectiveScale,
    z: z2
  };
}

function perspectiveDistanceForReplayView(view: ReplayScreenView): number {
  const viewport = Math.max(1, Math.min(view.canvas.width || 1, view.canvas.height || 1));
  return Math.max(1e-6, (viewport / Math.max(view.camera.zoom, 1e-9)) * replayPerspectiveStrength);
}

function buildReplaySurfaceItems(
  mesh: Mesh,
  view: ReplayScreenView,
  hiddenElementIds: ReadonlySet<number>
): Array<{ elementId: number; points: Array<{ x: number; y: number; z: number }>; face: readonly number[]; depth: number }> {
  if ((mesh.kind ?? "H1") === "Q1") {
    return mesh.elements
      .map((element, index) => ({
        elementId: index + 1,
        points: element.map((nodeId) => projectPointWithView(mesh.nodes[nodeId - 1] ?? [], view)),
        face: replayFaceSets.Q1[0],
        depth: 0
      }))
      .filter((item) => !hiddenElementIds.has(item.elementId))
      .map((item) => ({
        ...item,
        depth: item.points.reduce((sum, point) => sum + point.z, 0) / item.points.length
      }));
  }

  const ownerMap = new Map<string, { items: Array<{ elementIndex: number; elementId: number; faceIndex: number }> }>();
  mesh.elements.forEach((element, elementIndex) => {
    replayFaceSets.H1.forEach((face, faceIndex) => {
      const key = face
        .map((localIndex) => element[localIndex] ?? -1)
        .sort((a, b) => a - b)
        .join(":");
      const item = { elementIndex, elementId: elementIndex + 1, faceIndex };
      const existing = ownerMap.get(key);
      if (existing) {
        existing.items.push(item);
      } else {
        ownerMap.set(key, { items: [item] });
      }
    });
  });

  const surface: Array<{ elementId: number; points: Array<{ x: number; y: number; z: number }>; face: readonly number[]; depth: number }> = [];
  for (const owner of ownerMap.values()) {
    const activeOwners = owner.items.filter((item) => !hiddenElementIds.has(item.elementId));
    if (activeOwners.length === 0) {
      continue;
    }
    const isBoundaryFace = owner.items.length === 1;
    const isVisibilityCutFace = activeOwners.length < owner.items.length;
    if (!isBoundaryFace && !isVisibilityCutFace) {
      continue;
    }
    for (const activeOwner of activeOwners) {
      const element = mesh.elements[activeOwner.elementIndex];
      const face = replayFaceSets.H1[activeOwner.faceIndex];
      if (!element || !face || !isReplayFaceVisible(mesh, element, face, view)) {
        continue;
      }
      const points = element.map((nodeId) => projectPointWithView(mesh.nodes[nodeId - 1] ?? [], view));
      const depth = face.reduce<number>((sum, localIndex) => sum + (points[localIndex]?.z ?? 0), 0) / face.length;
      surface.push({
        elementId: activeOwner.elementId,
        points,
        face,
        depth
      });
    }
  }
  return surface.sort((a, b) => a.depth - b.depth);
}

function isReplayFaceVisible(mesh: Mesh, element: readonly number[], face: readonly number[], view: ReplayScreenView): boolean {
  const worldPoints = face.map((localIndex) => toPoint3(mesh.nodes[(element[localIndex] ?? 1) - 1] ?? []));
  const normal = faceNormal(worldPoints);
  const faceCenter = averagePoint(worldPoints);
  const elementCenter = elementCenter3(mesh, element);
  const outward = dot3(normal, [
    faceCenter[0] - elementCenter[0],
    faceCenter[1] - elementCenter[1],
    faceCenter[2] - elementCenter[2]
  ]) >= 0 ? normal : [-normal[0], -normal[1], -normal[2]];
  return dot3(outward, viewAxisForView(view)) > -0.02;
}

function faceNormal(points: readonly Point[]): [number, number, number] {
  const a = subtract3(points[1] ?? [0, 0, 0], points[0] ?? [0, 0, 0]);
  const b = subtract3(points[2] ?? [0, 0, 0], points[0] ?? [0, 0, 0]);
  return normalize3(cross3(a, b));
}

function averagePoint(points: readonly Point[]): [number, number, number] {
  const total: [number, number, number] = [0, 0, 0];
  for (const point of points) {
    const p = toPoint3(point);
    total[0] += p[0];
    total[1] += p[1];
    total[2] += p[2];
  }
  return [total[0] / points.length, total[1] / points.length, total[2] / points.length];
}

function viewAxisForView(view: ReplayScreenView): [number, number, number] {
  const cy = Math.cos(view.camera.yaw);
  const sy = Math.sin(view.camera.yaw);
  const cp = Math.cos(view.camera.pitch);
  const sp = Math.sin(view.camera.pitch);
  return [sy * cp, sp, cy * cp];
}

function subtract3(a: Point, b: Point): [number, number, number] {
  const pa = toPoint3(a);
  const pb = toPoint3(b);
  return [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
}

function cross3(a: Point, b: Point): [number, number, number] {
  const pa = toPoint3(a);
  const pb = toPoint3(b);
  return [
    pa[1] * pb[2] - pa[2] * pb[1],
    pa[2] * pb[0] - pa[0] * pb[2],
    pa[0] * pb[1] - pa[1] * pb[0]
  ];
}

function dot3(a: Point, b: Point): number {
  const pa = toPoint3(a);
  const pb = toPoint3(b);
  return pa[0] * pb[0] + pa[1] * pb[1] + pa[2] * pb[2];
}

function normalize3(a: Point): [number, number, number] {
  const pa = toPoint3(a);
  const length = Math.hypot(pa[0], pa[1], pa[2]);
  return length <= 1e-12 ? [0, 0, 1] : [pa[0] / length, pa[1] / length, pa[2] / length];
}

function surfaceFaceHitsRect(
  item: { points: Array<{ x: number; y: number }>; face: readonly number[] },
  xMin: number,
  xMax: number,
  yMin: number,
  yMax: number
): boolean {
  const polygon = item.face.map((localIndex) => item.points[localIndex]!).filter(Boolean);
  if (polygon.some((point) => point.x >= xMin && point.x <= xMax && point.y >= yMin && point.y <= yMax)) {
    return true;
  }
  const center = polygon.reduce((acc, point) => ({
    x: acc.x + point.x / polygon.length,
    y: acc.y + point.y / polygon.length
  }), { x: 0, y: 0 });
  if (center.x >= xMin && center.x <= xMax && center.y >= yMin && center.y <= yMax) {
    return true;
  }
  const corners = [
    { x: xMin, y: yMin },
    { x: xMax, y: yMin },
    { x: xMax, y: yMax },
    { x: xMin, y: yMax }
  ];
  if (corners.some((corner) => pointInPolygon2(corner, polygon))) {
    return true;
  }
  const rectEdges = [
    [corners[0], corners[1]],
    [corners[1], corners[2]],
    [corners[2], corners[3]],
    [corners[3], corners[0]]
  ] as Array<[{ x: number; y: number }, { x: number; y: number }]>;
  for (let i = 0; i < polygon.length; i += 1) {
    const edge = [polygon[i]!, polygon[(i + 1) % polygon.length]!] as const;
    if (rectEdges.some((rectEdge) => segmentsIntersect2(edge[0], edge[1], rectEdge[0], rectEdge[1]))) {
      return true;
    }
  }
  return false;
}

function surfaceFaceHitsCircle(
  item: { points: Array<{ x: number; y: number }>; face: readonly number[] },
  center: { x: number; y: number },
  radius: number
): boolean {
  const polygon = item.face.map((localIndex) => item.points[localIndex]!).filter(Boolean);
  if (polygon.some((point) => pointInCircle2(point, center, radius))) {
    return true;
  }
  if (pointInPolygon2(center, polygon)) {
    return true;
  }
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    if (distancePointToSegment2(center, a, b) <= radius + 1e-9) {
      return true;
    }
  }
  return false;
}

function pointInPolygon2(point: { x: number; y: number }, polygon: Array<{ x: number; y: number }>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    const crosses = (pi.y > point.y) !== (pj.y > point.y)
      && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y + 1e-12) + pi.x;
    if (crosses) {
      inside = !inside;
    }
  }
  return inside;
}

function segmentsIntersect2(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
  d: { x: number; y: number }
): boolean {
  const ab = orientation2(a, b, c) * orientation2(a, b, d);
  const cd = orientation2(c, d, a) * orientation2(c, d, b);
  return ab <= 0 && cd <= 0
    && Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <= Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) + 1e-9
    && Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <= Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) + 1e-9;
}

function orientation2(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }): number {
  const value = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (Math.abs(value) <= 1e-9) {
    return 0;
  }
  return value > 0 ? 1 : -1;
}

function distancePointToSegment2(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) {
    return Math.hypot(point.x - a.x, point.y - a.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  const closest = {
    x: a.x + dx * t,
    y: a.y + dy * t
  };
  return Math.hypot(point.x - closest.x, point.y - closest.y);
}

function pointInCircle2(point: { x: number; y: number }, center: { x: number; y: number }, radius: number): boolean {
  return Math.hypot(point.x - center.x, point.y - center.y) <= radius + 1e-9;
}

function activeElementIdsFromReplaySelectionState(
  state: ReplayState,
  build: ActiveMeshBuildResult
): { elementIds: number[]; warning?: string } {
  const next = uniqueSorted([...state.selectedElementIds].filter((elementId) => build.cellIdByElementId.has(elementId)));
  const droppedCount = state.selectedElementIds.size - next.length;
  return {
    elementIds: next,
    ...(droppedCount > 0 ? { warning: `offline replay refreshed the recorded selection and dropped ${droppedCount} stale element ids.` } : {})
  };
}

function joinWarnings(warnings: readonly string[]): string | undefined {
  const uniqueWarnings = uniqueStrings(warnings);
  return uniqueWarnings.length > 0 ? uniqueWarnings.join(" ") : undefined;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function stabilizeReplaySelectionForPatch(
  session: RefinementSession,
  active: ActiveMeshBuildResult,
  candidateCellIds: readonly CellId[],
  options: { includeTransitions: boolean; mergeTolerance?: number }
): { cellIds: CellId[]; warning?: string } {
  let currentCellIds = [...candidateCellIds];
  const originalCount = currentCellIds.length;
  const selectedLevel = session.cells.get(currentCellIds[0] ?? "")?.level;
  for (let iteration = 0; iteration < 8 && currentCellIds.length > 0; iteration += 1) {
    const selectedElementIds = currentCellIds
      .map((cellId) => active.elementIdByCellId.get(cellId))
      .filter((elementId): elementId is number => elementId !== undefined);
    const replacements = buildDefaultRefinementReplacements(active.mesh, selectedElementIds, {
      includeTransitions: options.includeTransitions,
      regularizeHexSelection: false,
      ...(options.mergeTolerance !== undefined ? { mergeTolerance: options.mergeTolerance } : {})
    });
    const offendingElementIds = replacements
      .map((replacement) => replacement.elementId)
      .filter((elementId, index, array) => array.indexOf(elementId) === index)
      .filter((elementId) => {
        const parentId = active.cellIdByElementId.get(elementId);
        if (!parentId) {
          return false;
        }
        const parent = session.cells.get(parentId);
        return Boolean(!parent || !isRefinableSessionCell(parent) || parent.level !== selectedLevel);
      });
    if (offendingElementIds.length === 0) {
      return currentCellIds.length === originalCount
        ? { cellIds: currentCellIds }
        : {
            cellIds: currentCellIds,
            warning: `offline replay shrank the refine core from ${originalCount} to ${currentCellIds.length} cells to avoid transition or mixed-level parents.`
          };
    }

    const offendingNodeIds = new Set<number>();
    for (const elementId of offendingElementIds) {
      const element = active.mesh.elements[elementId - 1];
      if (!element) {
        continue;
      }
      for (const nodeId of element) {
        offendingNodeIds.add(nodeId);
      }
    }
    const nextCellIds = currentCellIds.filter((cellId) => {
      const elementId = active.elementIdByCellId.get(cellId);
      const element = elementId ? active.mesh.elements[elementId - 1] : undefined;
      return Boolean(element && !element.some((nodeId) => offendingNodeIds.has(nodeId)));
    });
    if (nextCellIds.length === currentCellIds.length) {
      break;
    }
    currentCellIds = nextCellIds;
  }

  return {
    cellIds: currentCellIds,
    ...(currentCellIds.length === 0
      ? { warning: "offline replay could not isolate a safe refine core from the recorded selection." }
      : { warning: `offline replay shrank the refine core from ${originalCount} to ${currentCellIds.length} cells to avoid transition or mixed-level parents.` })
  };
}

function compareReplayCellIds(a: CellId, b: CellId): number {
  const ap = replayCellIdParts(a);
  const bp = replayCellIdParts(b);
  for (let index = 0; index < Math.max(ap.length, bp.length); index += 1) {
    const av = ap[index] ?? -1;
    const bv = bp[index] ?? -1;
    if (av !== bv) {
      return av - bv;
    }
  }
  return a.localeCompare(b);
}

function replayCellIdParts(cellId: CellId): number[] {
  return cellId.split("/").map((part) => Number(part.replace(/^e/, "")));
}

function activeElementIdsFromReplayRankSelection(
  session: RefinementSession,
  rankSelection: ReplayRankSelection,
  state?: ReplayState,
  activeBuild?: ActiveMeshBuildResult
): { elementIds: number[]; warning?: string } {
  const build = activeBuild ?? buildActiveMeshWithMap(session, {
    ...(state ? activeBuildOptions(state) : { mergeNodes: true }),
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const domainElementIds: number[] = [];
  for (const cellId of session.activeLeafIds) {
    const cell = session.cells.get(cellId);
    const elementId = build.elementIdByCellId.get(cellId);
    if (
      elementId !== undefined
      && cell
      && isRefinableSessionCell(cell)
      && cell.level === rankSelection.level
    ) {
      domainElementIds.push(elementId);
    }
  }
  const sortedDomainElementIds = domainElementIds.sort((a, b) => a - b);
  if (sortedDomainElementIds.length === 0) {
    return {
      elementIds: [],
      warning: `offline replay could not find refinable cells at recorded level ${rankSelection.level}.`
    };
  }
  const index = centerRankIndexForElementIds(build.mesh, sortedDomainElementIds);
  const currentDimensions = index.coordinates.map((values) => values.length) as [number, number, number];
  const scaledRange = scaleReplayRankRange(rankSelection.range, rankSelection.domainDimensions, currentDimensions);
  return {
    elementIds: exactElementIdsInReplayRange(scaledRange, index)
  };
}

function centerRankIndexForElementIds(mesh: Mesh, elementIds: readonly number[]): ReplayRankIndex {
  const tolerance = Math.max(minElementSize(mesh, elementIds) * 1e-6, 1e-9);
  const centers = elementIds
    .map((elementId) => ({
      elementId,
      center: elementCenter3(mesh, mesh.elements[elementId - 1] ?? [])
    }))
    .filter((item) => item.center.every(Number.isFinite));
  const coordinates = [0, 1, 2].map((axis) =>
    uniqueSortedCoordinates(centers.map((item) => item.center[axis] ?? 0), tolerance)
  ) as [number[], number[], number[]];
  const elementIdByRank = new Map<string, number>();
  const ranksByElementId = new Map<number, [number, number, number]>();
  for (const item of centers) {
    const ranks = [0, 1, 2].map((axis) =>
      coordinateRank(coordinates[axis] ?? [], item.center[axis] ?? 0, tolerance)
    ) as [number, number, number];
    elementIdByRank.set(`${ranks[0]}:${ranks[1]}:${ranks[2]}`, item.elementId);
    ranksByElementId.set(item.elementId, ranks);
  }
  return { coordinates, elementIdByRank, ranksByElementId, tolerance };
}

function exactElementIdsInReplayRange(
  range: { min: [number, number, number]; max: [number, number, number] },
  index: ReplayRankIndex
): number[] {
  const ids: number[] = [];
  for (let i = range.min[0]; i <= range.max[0]; i += 1) {
    for (let j = range.min[1]; j <= range.max[1]; j += 1) {
      for (let k = range.min[2]; k <= range.max[2]; k += 1) {
        const elementId = index.elementIdByRank.get(`${i}:${j}:${k}`);
        if (elementId !== undefined) {
          ids.push(elementId);
        }
      }
    }
  }
  return ids.sort((a, b) => a - b);
}

function scaleReplayRankRange(
  range: { min: [number, number, number]; max: [number, number, number] },
  sourceDimensions: [number, number, number],
  targetDimensions: [number, number, number]
): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [0, 0, 0];
  const max: [number, number, number] = [0, 0, 0];
  for (let axis = 0; axis < 3; axis += 1) {
    const sourceDim = Math.max(1, sourceDimensions[axis] ?? 1);
    const targetDim = Math.max(1, targetDimensions[axis] ?? 1);
    const startRatio = Math.min(Math.max((range.min[axis] ?? 0) / sourceDim, 0), 1);
    const endRatio = Math.min(Math.max(((range.max[axis] ?? 0) + 1) / sourceDim, 0), 1);
    const scaledMin = Math.floor(startRatio * targetDim + 1e-9);
    const scaledMax = Math.ceil(endRatio * targetDim - 1e-9) - 1;
    min[axis] = Math.min(targetDim - 1, Math.max(0, scaledMin));
    const currentMin = min[axis] ?? 0;
    max[axis] = Math.min(targetDim - 1, Math.max(currentMin, scaledMax));
  }
  return { min, max };
}

function minElementSize(mesh: Mesh, elementIds: readonly number[]): number {
  let size = Infinity;
  for (const elementId of elementIds) {
    const element = mesh.elements[elementId - 1];
    if (!element) {
      continue;
    }
    const points = element.map((nodeId) => toPoint3(mesh.nodes[nodeId - 1] ?? []));
    for (let i = 0; i < points.length; i += 1) {
      for (let j = i + 1; j < points.length; j += 1) {
        const a = points[i]!;
        const b = points[j]!;
        const distance = Math.hypot(
          a[0] - b[0],
          a[1] - b[1],
          a[2] - b[2]
        );
        if (distance > 1e-12) {
          size = Math.min(size, distance);
        }
      }
    }
  }
  return Number.isFinite(size) ? size : 1;
}

function uniqueSortedCoordinates(values: readonly number[], tolerance: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const unique: number[] = [];
  for (const value of sorted) {
    if (unique.length === 0 || Math.abs(value - unique[unique.length - 1]!) > tolerance) {
      unique.push(value);
    }
  }
  return unique;
}

function coordinateRank(coordinates: readonly number[], value: number, tolerance: number): number {
  for (let index = 0; index < coordinates.length; index += 1) {
    if (Math.abs((coordinates[index] ?? 0) - value) <= tolerance) {
      return index;
    }
  }
  let closestIndex = 0;
  let closestDistance = Infinity;
  for (let index = 0; index < coordinates.length; index += 1) {
    const distance = Math.abs((coordinates[index] ?? 0) - value);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }
  return closestIndex;
}

function readBounds(value: unknown, kind: "Q1" | "H1"): { min: Point; max: Point } {
  const object = readObject(value);
  const min = readPoint(object.min, kind === "Q1" ? [0, 0, 0] : [0, 0, 0]);
  const max = readPoint(object.max, kind === "Q1" ? [1, 1, 0] : [1, 1, 1]);
  return { min, max };
}

function readReplayRankSelection(value: unknown): ReplayRankSelection | null {
  const object = readObject(value);
  if (readString(object.kind, "") !== "level-rank-range") {
    return null;
  }
  const rangeObject = readObject(object.range);
  const domainDimensions = readNonNegativeIntegerTuple(object.domainDimensions)
    .map((item) => Math.max(1, item));
  if (domainDimensions.length !== 3) {
    return null;
  }
  const min = readNonNegativeIntegerTuple(rangeObject.min);
  const max = readNonNegativeIntegerTuple(rangeObject.max);
  if (min.length !== 3 || max.length !== 3) {
    return null;
  }
  return {
    kind: "level-rank-range",
    level: Math.max(0, Math.round(readOptionalNumber(object.level) ?? 0)),
    domainDimensions: domainDimensions as [number, number, number],
    range: {
      min: min as [number, number, number],
      max: max as [number, number, number]
    },
    ...(object.sourceElementCount !== undefined
      ? { sourceElementCount: Math.max(0, Math.round(readOptionalNumber(object.sourceElementCount) ?? 0)) }
      : {})
  };
}

function readNonNegativeIntegerTuple(value: unknown): [number, number, number] | [] {
  if (!Array.isArray(value) || value.length < 3) {
    return [];
  }
  const tuple = value
    .slice(0, 3)
    .map((item) => Math.max(0, Math.round(readOptionalNumber(item) ?? Number(item) ?? 0)));
  return tuple.length === 3 ? tuple as [number, number, number] : [];
}

function readReplayScreenView(value: unknown): ReplayScreenView | null {
  const object = readObject(value);
  if (readString(object.kind, "") !== "screen-ortho-view") {
    return null;
  }
  const canvasObject = readObject(object.canvas);
  const cameraObject = readObject(object.camera);
  const center = readPoint(cameraObject.center, [0, 0, 0]);
  return {
    kind: "screen-ortho-view",
    projectionMode: readString(object.projectionMode, "perspective") === "parallel" ? "parallel" : "perspective",
    canvas: {
      width: Math.max(1, readPositiveInteger(canvasObject.width, 1)),
      height: Math.max(1, readPositiveInteger(canvasObject.height, 1))
    },
    camera: {
      yaw: readOptionalNumber(cameraObject.yaw) ?? 0,
      pitch: readOptionalNumber(cameraObject.pitch) ?? 0,
      roll: readOptionalNumber(cameraObject.roll) ?? 0,
      zoom: Math.max(1e-9, readOptionalNumber(cameraObject.zoom) ?? 1),
      center: [center[0] ?? 0, center[1] ?? 0, center[2] ?? 0]
    }
  };
}

function defaultMergeTolerance(bounds: { min: Point; max: Point }): number {
  const span = Math.hypot(
    bounds.max[0]! - bounds.min[0]!,
    bounds.max[1]! - bounds.min[1]!,
    (bounds.max[2] ?? 0) - (bounds.min[2] ?? 0)
  );
  return Math.max(span * 1e-10, 1e-10);
}

function cloneMesh(mesh: Mesh): Mesh {
  return {
    ...(mesh.kind ? { kind: mesh.kind } : {}),
    nodes: mesh.nodes.map((point) => [...point]),
    elements: mesh.elements.map((element) => [...element])
  };
}

function cloneRefinementSessionState(session: RefinementSession): RefinementSession {
  const cells = new Map<CellId, RefinementSessionCell>();
  for (const [cellId, cell] of session.cells) {
    cells.set(cellId, {
      ...cell,
      element: [...cell.element],
      children: [...cell.children]
    });
  }
  return {
    baseMesh: cloneMesh(session.baseMesh),
    kind: session.kind,
    nodes: session.nodes.map((point) => [...point]),
    cells,
    activeLeafIds: new Set(session.activeLeafIds),
    sortedActiveLeafIds: [...session.sortedActiveLeafIds],
    sortedActiveLeafIdsDirty: session.sortedActiveLeafIdsDirty,
    activeLeafIdsByNodeKey: new Map(
      [...session.activeLeafIdsByNodeKey.entries()].map(([key, cellIds]) => [key, [...cellIds]])
    ),
    undoStack: session.undoStack.map((command) => ({
      ...command,
      hiddenCellIds: [...command.hiddenCellIds],
      createdCellIds: [...command.createdCellIds],
      createdNodeIds: [...command.createdNodeIds]
    })),
    redoStack: session.redoStack.map((command) => ({
      ...command,
      hiddenCellIds: [...command.hiddenCellIds],
      createdCellIds: [...command.createdCellIds],
      createdNodeIds: [...command.createdNodeIds]
    })),
    nextCommandId: session.nextCommandId,
    nextCellOrdinal: session.nextCellOrdinal
  };
}

function cloneCellSets(source: Map<string, CellId[]>): Map<string, CellId[]> {
  return new Map([...source].map(([name, ids]) => [name, [...ids]]));
}

function cloneNodeSets(source: Map<string, number[]>): Map<string, number[]> {
  return new Map([...source].map(([name, ids]) => [name, [...ids]]));
}

function cloneMaterialAssignments(source: Map<string, ComformHexMaterial>): Map<string, ComformHexMaterial> {
  return new Map([...source].map(([name, material]) => [name, { ...material }]));
}

function boundsOfMesh(mesh: Mesh): { min: Point; max: Point } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const node of mesh.nodes) {
    min[0] = Math.min(min[0], node[0] ?? 0);
    min[1] = Math.min(min[1], node[1] ?? 0);
    min[2] = Math.min(min[2], node[2] ?? 0);
    max[0] = Math.max(max[0], node[0] ?? 0);
    max[1] = Math.max(max[1], node[1] ?? 0);
    max[2] = Math.max(max[2], node[2] ?? 0);
  }
  return { min, max };
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeSelectionCombinationMode(value: unknown, additiveFallback = false): "replace" | "add" | "remove" {
  if (value === "remove") {
    return "remove";
  }
  if (value === "add") {
    return "add";
  }
  return additiveFallback ? "add" : "replace";
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function readPoint(value: unknown, fallback: Point): Point {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  return [
    readOptionalNumber(value[0]) ?? fallback[0] ?? 0,
    readOptionalNumber(value[1]) ?? fallback[1] ?? 0,
    readOptionalNumber(value[2]) ?? fallback[2] ?? 0
  ];
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return uniqueSorted(value
    .map((item) => typeof item === "number" ? item : Number(item))
    .filter((item) => Number.isInteger(item) && item > 0));
}

function readPickedElementIds(payload: Record<string, unknown>): number[] {
  const ids = readNumberArray(payload.elementIds);
  const elementId = readOptionalNumber(payload.elementId);
  if (elementId !== undefined && Number.isInteger(elementId) && elementId > 0) {
    ids.push(elementId);
  }
  return uniqueSorted(ids);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item): item is string => typeof item === "string"))].sort();
}

function readMaterial(value: unknown): ComformHexMaterial | undefined {
  const object = readObject(value);
  const name = sanitizeName(readString(object.name, ""));
  if (!name) {
    return undefined;
  }
  const elasticModulus = readOptionalNumber(object.elasticModulus);
  const poissonRatio = readOptionalNumber(object.poissonRatio);
  return {
    name,
    ...(elasticModulus !== undefined ? { elasticModulus } : {}),
    ...(poissonRatio !== undefined ? { poissonRatio } : {})
  };
}

function sanitizeName(name: string): string {
  return String(name || "").trim().replace(/[^A-Za-z0-9_+-]/g, "_");
}

function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function handleWarning(
  state: ReplayState,
  options: ReplayComformHexCommandScriptOptions,
  warning: string
): void {
  if (options.strict) {
    throw new Error(warning);
  }
  state.warnings.push(warning);
}
