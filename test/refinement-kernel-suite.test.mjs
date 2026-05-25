import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// HexRefine project refinement kernel suite.
// This file intentionally stays within the project-local runtime build.

import * as api from "../dist/index.js";
const {
  findBoundaryPairs,
  checkNoHangingNodes,
  minElementEdgeLength,
  boxDistance,
  circleDistance,
  createHexUnitCubeMesh,
  createQ1UnitSquareMesh,
  createRefinementSession,
  previewRefinementByDistanceFunction,
  previewRefinementByBox,
  previewRefinementByElementIds,
  prepareSessionRefineSelection,
  refineByElementIds,
  refineByElementIdsWithReport,
  activeBuildCellIdByElementId,
  activeBuildElementIdByCellId,
  buildActiveMesh,
  buildActiveMeshWithMap,
  buildRefinementSessionExport,
  buildDefaultRefinementReplacements,
  buildRefinementReplacements,
  checkRefinementSessionCommandConformance,
  validateRefinementSessionSelection,
  refineByBox,
  refineByDistanceFunctionWithReport,
  refineByBoxWithReport,
  defaultRefinementPlanner,
  replayHexRefineCommandScript,
  parseMeshText,
  refineHexTo13Hex,
  refineHexTo27Hex,
  refineHexTo5Hex,
  redoRefinementSession,
  regularizeHexSessionSelection,
  regularizeHexSelection,
  remapSessionSetsToActiveMesh,
  refineQ1To3x3,
  refineQ1To4Q1,
  refineQ1To5Q1,
  refineSessionCell,
  refineSessionCells,
  refineSessionPatch,
  undoRefinementSession
} = api;

test("HexRefine offline memory planner selects a bounded heap from system RAM", async () => {
  const { offlineMemoryPlan } = await import("../scripts/offline-memory.mjs");
  const plan = offlineMemoryPlan();
  assert.equal(Number.isInteger(plan.totalMb), true);
  assert.equal(Number.isInteger(plan.maxOldSpaceMb), true);
  assert.equal(plan.maxOldSpaceMb >= 2048, true);
  assert.equal(plan.maxOldSpaceMb <= plan.totalMb, true);
  assert.equal(plan.currentHeapLimitMb > 0, true);
});

test("Q1 local templates match notebook element counts", () => {
  const quad = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1]
  ];

  assert.equal(refineQ1To3x3(quad).nodes.length, 16);
  assert.equal(refineQ1To3x3(quad).elements.length, 9);
  assert.equal(refineQ1To4Q1(quad).nodes.length, 8);
  assert.equal(refineQ1To4Q1(quad).elements.length, 4);
  assert.equal(refineQ1To5Q1(quad).nodes.length, 10);
  assert.equal(refineQ1To5Q1(quad).elements.length, 5);
});

test("Hex local templates match notebook element counts", () => {
  const hex = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1]
  ];

  assert.equal(refineHexTo27Hex(hex).nodes.length, 64);
  assert.equal(refineHexTo27Hex(hex).elements.length, 27);
  assert.equal(refineHexTo5Hex(hex).nodes.length, 16);
  assert.equal(refineHexTo5Hex(hex).elements.length, 5);
  const h13 = refineHexTo13Hex(hex);
  assert.equal(h13.nodes.length, 32);
  assert.equal(h13.elements.length, 13);
  assert.equal(checkNoHangingNodes(refineHexTo5Hex(hex)).ok, true);
  assert.equal(checkNoHangingNodes(h13).ok, true);
});

test("Hex local template coordinates match notebook parameter positions", () => {
  const hex = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 1]
  ];

  const h5 = refineHexTo5Hex(hex);
  assertPoint(h5.nodes[8], [0, 0, 1 / 3]);
  assertPoint(h5.nodes[9], [0, 0, 2 / 3]);
  assertPoint(h5.nodes[10], [0.5, 0, 2 / 3]);
  assertPoint(h5.nodes[11], [0.5, 0, 1 / 3]);
  assertPoint(h5.nodes[12], [0, 0.5, 1 / 3]);
  assertPoint(h5.nodes[13], [0, 0.5, 2 / 3]);

  const h13 = refineHexTo13Hex(hex);
  assertPoint(h13.nodes[12], [0, 1 / 3, 0.5]);
  assertPoint(h13.nodes[13], [1, 1 / 3, 0.5]);
  assertPoint(h13.nodes[14], [1, 2 / 3, 0.5]);
  assertPoint(h13.nodes[15], [0, 2 / 3, 0.5]);

  const h27 = refineHexTo27Hex(hex);
  assertPoint(h27.nodes[0], [0, 0, 0]);
  assertPoint(h27.nodes[1], [0, 0, 1 / 3]);
  assertPoint(h27.nodes[16], [1 / 3, 0, 0]);
  assertPoint(h27.nodes[21], [1 / 3, 1 / 3, 1 / 3]);
  assert.deepEqual(h27.elements[0], [1, 17, 21, 5, 2, 18, 22, 6]);
});

test("Hex refinement handles repeated local refinement without node-merge blowup", () => {
  const scaleMesh = (source, scale) => ({
    ...source,
    nodes: source.nodes.map((point) => [
      point[0] * scale[0],
      point[1] * scale[1],
      point[2] * scale[2]
    ])
  });
  let mesh = scaleMesh(createHexUnitCubeMesh(10, 10, 10), [10, 10, 10]);

  for (let step = 1; step <= 3; step += 1) {
    const lower = 5 - 2 / step;
    const upper = 5 + 2 / step;
    const selected = mesh.elements
      .map((element, index) => ({
        elementId: index + 1,
        center: element.reduce((total, nodeId) => {
          const point = mesh.nodes[nodeId - 1];
          total[0] += point[0];
          total[1] += point[1];
          total[2] += point[2];
          return total;
        }, [0, 0, 0]).map((value) => value / element.length)
      }))
      .filter(({ center }) =>
        center[0] >= lower && center[0] <= upper &&
        center[1] >= lower && center[1] <= upper &&
        center[2] >= lower && center[2] <= upper
      )
      .map(({ elementId }) => elementId);

    mesh = refineByElementIdsWithReport(mesh, selected, {
      regularizeHexSelection: false,
      includeTransitions: true
    }).mesh;
  }

  assert.equal(mesh.elements.length, 68376);
  assert.equal(mesh.nodes.length, 68839);
  assert.ok(minElementEdgeLength(mesh) > 0);
});

test("Hierarchical refinement session hides mother cells and supports undo redo", () => {
  const mesh = createHexUnitCubeMesh(1, 1, 1);
  const session = createRefinementSession(mesh);

  assert.equal(buildActiveMesh(session).elements.length, 1);
  assert.deepEqual([...session.activeLeafIds], ["e1"]);

  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const refined = buildActiveMesh(session);

  assert.equal(command.hiddenCellIds.length, 1);
  assert.equal(command.createdCellIds.length, 27);
  assert.equal(session.cells.get("e1").active, false);
  assert.equal(session.cells.get("e1").hidden, true);
  assert.equal(refined.kind, "H1");
  assert.equal(refined.elements.length, 27);
  assert.equal(refined.nodes.length, 64);

  const undone = undoRefinementSession(session);
  assert.equal(undone.id, command.id);
  assert.deepEqual([...session.activeLeafIds], ["e1"]);
  assert.equal(buildActiveMesh(session).elements.length, 1);

  const redone = redoRefinementSession(session);
  assert.equal(redone.id, command.id);
  assert.equal(buildActiveMesh(session).elements.length, 27);
});

test("Hierarchical refinement session assigns stable numeric cell ordinals", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  assert.equal(session.cells.get("e1").ordinal, 1);
  assert.equal(session.nextCellOrdinal, 2);

  refineSessionPatch(session, ["e1"]);
  const ordinals = [...session.cells.values()].map((cell) => cell.ordinal);
  assert.equal(new Set(ordinals).size, ordinals.length);
  assert.deepEqual(ordinals, [...ordinals].sort((a, b) => a - b));
  assert.equal(session.nextCellOrdinal, Math.max(...ordinals) + 1);

  undoRefinementSession(session);
  redoRefinementSession(session);
  buildActiveMeshWithMap(session, { mergeNodes: true });
});

test("Hierarchical active mesh build returns cell and node remaps", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const result = buildActiveMeshWithMap(session, { includeElementIdsByNodeId: true });
  const firstCellId = command.createdCellIds[0];
  const firstElementId = result.elementIdByCellId.get(firstCellId);
  assert.ok(firstElementId);
  assert.equal(result.mesh.elements.length, 27);
  assert.equal(result.cellIdByElementId.get(firstElementId), firstCellId);

  const firstSessionNodeId = session.cells.get(firstCellId).element[0];
  const outputNodeId = result.nodeIdBySessionNodeId.get(firstSessionNodeId);
  assert.ok(outputNodeId);
  assert.equal(result.sessionNodeIdByNodeId.get(outputNodeId), firstSessionNodeId);
  assert.deepEqual(result.sessionNodeIdsByNodeId.get(outputNodeId), [firstSessionNodeId]);
  assert.ok(result.elementIdsByNodeId.get(outputNodeId).includes(firstElementId));
});

test("Hierarchical active mesh build supports lean GUI cell remaps", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const result = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false
  });
  const firstCellId = command.createdCellIds[0];
  const firstElementId = activeBuildElementIdByCellId(session, result, firstCellId);
  assert.ok(firstElementId);
  assert.equal(result.cellIdByElementId.size, 0);
  assert.equal(result.elementIdByCellId.size, 0);
  assert.equal(activeBuildCellIdByElementId(result, firstElementId), firstCellId);
});

test("Hierarchical active mesh build composes node remaps after final merge", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  refineSessionCells(session, ["e1", "e2"], refineHexTo27Hex);
  const unmerged = buildActiveMeshWithMap(session);
  const merged = buildActiveMeshWithMap(session, { mergeNodes: true });
  assert.equal(unmerged.mesh.nodes.length, 128);
  assert.ok(merged.mesh.nodes.length < unmerged.mesh.nodes.length);
  assert.ok([...merged.sessionNodeIdsByNodeId.values()].some((sessionNodeIds) => sessionNodeIds.length > 1));

  for (const cellId of session.activeLeafIds) {
    for (const sessionNodeId of session.cells.get(cellId).element) {
      assert.ok(merged.nodeIdBySessionNodeId.get(sessionNodeId));
    }
  }
});

test("Hierarchical active mesh remaps stable cell and node sets for export", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const activeCellId = command.createdCellIds[0];
  const hiddenCellId = "e1";
  const sessionNodeId = session.cells.get(activeCellId).element[0];
  const inactiveNodeId = 999999;
  const build = buildActiveMeshWithMap(session, { mergeNodes: true });
  const activeElementId = build.elementIdByCellId.get(activeCellId);
  const activeNodeId = build.nodeIdBySessionNodeId.get(sessionNodeId);
  assert.ok(activeElementId);
  assert.ok(activeNodeId);
  const remap = remapSessionSetsToActiveMesh(build, {
    cellSets: new Map([
      ["ACTIVE_CORE", [activeCellId, activeCellId, hiddenCellId]]
    ]),
    nodeSets: {
      SELECTED_NODES: [sessionNodeId, sessionNodeId, inactiveNodeId]
    }
  });

  assert.deepEqual(remap.cellSets.get("ACTIVE_CORE"), [activeElementId]);
  assert.deepEqual(remap.missingCellIdsBySet.get("ACTIVE_CORE"), [hiddenCellId]);
  assert.deepEqual(remap.nodeSets.get("SELECTED_NODES"), [activeNodeId]);
  assert.deepEqual(remap.missingNodeIdsBySet.get("SELECTED_NODES"), [inactiveNodeId]);
});

test("Hierarchical export builds a merged flat mesh with remapped sets", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCells(session, ["e1", "e2"], refineHexTo27Hex);
  const cellId = command.createdCellIds[0];
  const nodeId = session.cells.get(cellId).element[0];
  const exported = buildRefinementSessionExport(session, {
    sets: {
      cellSets: { CORE: [cellId] },
      nodeSets: { CORNER: [nodeId] }
    }
  });
  const exportedElementId = exported.build.elementIdByCellId.get(cellId);
  const exportedNodeId = exported.build.nodeIdBySessionNodeId.get(nodeId);
  assert.ok(exportedElementId);
  assert.ok(exportedNodeId);

  assert.equal(exported.mesh.elements.length, 54);
  assert.ok(exported.mesh.nodes.length < buildActiveMeshWithMap(session).mesh.nodes.length);
  assert.deepEqual(exported.sets.cellSets.get("CORE"), [exportedElementId]);
  assert.deepEqual(exported.sets.nodeSets.get("CORNER"), [exportedNodeId]);
});

test("Refinement replacement plan exposes selected and transition templates", () => {
  const mesh = createHexUnitCubeMesh(2, 1, 1);
  const replacements = buildRefinementReplacements(mesh, [1], { includeTransitions: true });
  assert.equal(replacements.filter((replacement) => replacement.role === "selected").length, 1);
  assert.equal(replacements.filter((replacement) => replacement.role === "face-transition").length, 1);
});

test("Default refinement planner preserves Q1 and Hex template roles", () => {
  const q1 = createQ1UnitSquareMesh(2, 1);
  const q1Plan = buildDefaultRefinementReplacements(q1, [1], { includeTransitions: true })
    .map((replacement) => [replacement.role, replacement.templateCode]);
  assert.deepEqual(q1Plan, [
    ["selected", 9],
    ["edge-transition", 4]
  ]);

  const hex = createHexUnitCubeMesh(2, 1, 1);
  const hexPlan = defaultRefinementPlanner.plan(hex, [1], { includeTransitions: true })
    .map((replacement) => [replacement.role, replacement.templateCode]);
  assert.deepEqual(hexPlan, [
    ["selected", 27],
    ["face-transition", 13]
  ]);
});

test("HexRefine command script replays grid, refinement, sets, and materials", () => {
  const script = {
    format: "hexrefine-command-script",
    version: 1,
    app: "HexRefine",
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "refine.patch",
        payload: {
          cellIds: ["e1"],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "CORE",
          cellIds: ["e1/1", "e1/2"],
          material: { name: "MAT-CORE", elasticModulus: 100, poissonRatio: 0.25 }
        }
      }
    ]
  };

  const replay = replayHexRefineCommandScript(script);
  assert.equal(replay.replayedCommandCount, 3);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mergeTolerance, 1e-9);
  assert.equal(replay.mesh.kind, "H1");
  assert.equal(replay.mesh.elements.length, 40);
  assert.deepEqual(replay.cellSets.get("CORE"), ["e1/1", "e1/2"]);
  assert.equal(replay.cellSetMaterials.get("CORE").name, "MAT-CORE");
  assert.equal(checkNoHangingNodes(replay.mesh).ok, true);
});

test("HexRefine command script reports the default grid merge tolerance", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 1,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 2, 1] }
        }
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 1);
  assert.equal(replay.mergeTolerance, Math.hypot(2, 2, 1) * 1e-10);
});

test("HexRefine command script replays single-cell pick and hide-pick commands", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.pick",
        payload: {
          elementId: 2,
          selectionMode: "add"
        }
      },
      {
        kind: "view.hide-selected",
        payload: {}
      },
      {
        kind: "view.hide-elements",
        payload: {
          elementIds: [3]
        }
      },
      {
        kind: "select.all",
        payload: {
          target: "cells"
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "VISIBLE"
        }
      }
    ]
  }, { selectionStrategy: "replay" });

  assert.equal(replay.warnings.length, 0);
  assert.deepEqual(replay.cellSets.get("VISIBLE"), ["e1"]);
});

test("HexRefine command script can replay compact keep-mode deletion", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "delete.elements",
        payload: {
          mode: "keep",
          keptElementIds: [2],
          deletedElementCount: 2,
          sourceElementCount: 3
        }
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 2);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mesh.elements.length, 1);
  assert.equal(replay.mesh.elements[0].length, 8);
  assert.equal(replay.mesh.elements[0].every((nodeId) => nodeId >= 1 && nodeId <= replay.mesh.nodes.length), true);
});

test("HexRefine command script can replay delete undo and redo", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 3,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [3, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "delete.elements",
        payload: {
          mode: "delete",
          elementIds: [2],
          deletedElementCount: 1,
          sourceElementCount: 3
        }
      },
      {
        kind: "undo.delete"
      },
      {
        kind: "redo.delete"
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 4);
  assert.equal(replay.warnings.length, 0);
  assert.equal(replay.mesh.elements.length, 2);
  assert.equal(checkNoHangingNodes(replay.mesh).ok, true);
});

test("HexRefine command script can replay coordinate-box selection on a denser offline grid", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.coordinate-box",
        payload: {
          target: "cells",
          box: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "LEFT",
          elementIds: [1]
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const recorded = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "recorded"
  });
  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(recorded.cellSets.get("LEFT")?.length, 1);
  assert.equal(replayed.cellSets.get("LEFT")?.length, 2);
  assert.ok(replayed.mesh.elements.length > recorded.mesh.elements.length);
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine command script can replay coordinate-box removal on a denser offline grid", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.all",
        payload: {
          target: "cells"
        }
      },
      {
        kind: "select.coordinate-box",
        payload: {
          target: "cells",
          mode: "remove",
          box: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "RIGHT"
        }
      }
    ]
  };

  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(replayed.cellSets.get("RIGHT")?.length, 2);
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine command script can replay screen-rect selection through recorded mesh-space bounds", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [100, 100], max: [260, 260] },
          meshBox: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const recorded = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "recorded"
  });
  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(recorded.mesh.elements.length, 42);
  assert.equal(replayed.warnings.length, 0);
  assert.equal(replayed.mesh.elements.length, 68);
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine command script can replay screen-rect selection through recorded view parameters", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 4,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [4, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [300, 0], max: [500, 600] },
          viewSelection: {
            kind: "screen-ortho-view",
            projectionMode: "parallel",
            canvas: { width: 800, height: 600 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 100,
              center: [2, 0.5, 0.5]
            }
          },
          meshBox: { min: [0, 0, 0], max: [4, 1, 1] }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "VIEW",
          elementIds: [2, 3]
        }
      }
    ]
  };

  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 8, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(replayed.cellSets.get("VIEW")?.length, 4);
  assert.deepEqual(replayed.cellSets.get("VIEW"), ["e3", "e4", "e5", "e6"]);
});

test("HexRefine offline replay filters transition and mixed-level cells before a second refine", () => {
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 1,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [2, 1, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [120, 120], max: [320, 320] },
          meshBox: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const replayed = replayHexRefineCommandScript(script, {
    gridOverride: { nx: 4, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(replayed.mesh.elements.length > 68, true);
  assert.equal(
    replayed.warnings.some((warning) => warning.includes("offline replay shrank the refine core")),
    true
  );
  assert.equal(checkNoHangingNodes(replayed.mesh).ok, true);
});

test("HexRefine offline replay prefers current screen replay selection over stored refine patch ranges", () => {
  const replaySelection = {
    kind: "level-rank-range",
    level: 0,
    domainDimensions: [4, 1, 1],
    range: {
      min: [0, 0, 0],
      max: [0, 0, 0]
    },
    sourceElementCount: 1
  };
  const refinePatch = {
    kind: "refine.patch",
    payload: {
      elementIds: [1],
      replaySelection,
      options: {
        includeTransitions: true,
        mergeTolerance: 1e-9
      }
    }
  };
  const baseGrid = {
    kind: "grid.generate",
    payload: {
      kind: "H1",
      nx: 4,
      ny: 1,
      nz: 1,
      bounds: { min: [0, 0, 0], max: [4, 1, 1] },
      mergeTolerance: 1e-9
    }
  };
  const coarseScreenScript = {
    commands: [
      baseGrid,
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [300, 0], max: [500, 600] },
          viewSelection: {
            kind: "screen-ortho-view",
            canvas: { width: 800, height: 600 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 100,
              center: [2, 0.5, 0.5]
            }
          },
          meshBox: { min: [0, 0, 0], max: [4, 1, 1] }
        }
      },
      refinePatch
    ]
  };
  const directScript = {
    commands: [
      baseGrid,
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: { min: [300, 0], max: [500, 600] },
          viewSelection: {
            kind: "screen-ortho-view",
            canvas: { width: 800, height: 600 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 100,
              center: [2, 0.5, 0.5]
            }
          },
          meshBox: { min: [0, 0, 0], max: [4, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          options: {
            includeTransitions: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const coarseReplay = replayHexRefineCommandScript(coarseScreenScript, {
    gridOverride: { nx: 8, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });
  const directReplay = replayHexRefineCommandScript(directScript, {
    gridOverride: { nx: 8, ny: 1, nz: 1 },
    selectionStrategy: "replay"
  });

  assert.equal(coarseReplay.mesh.elements.length, directReplay.mesh.elements.length);
  assert.equal(JSON.stringify(coarseReplay.mesh.elements), JSON.stringify(directReplay.mesh.elements));
  assert.equal(checkNoHangingNodes(coarseReplay.mesh).ok, true);
});

test("HexRefine offline replay honors Hex regularization for scaled screen selections", () => {
  const baseCommands = [
    {
      kind: "grid.generate",
      payload: {
        kind: "H1",
        nx: 10,
        ny: 2,
        nz: 1,
        bounds: { min: [0, 0, 0], max: [10, 2, 1] },
        mergeTolerance: 1e-9
      }
    },
    {
      kind: "select.screen-rect",
      payload: {
        target: "cells",
        additive: false,
        mode: "through",
        rect: {
          min: [796.7999877929688, 420.3999938964844],
          max: [968, 741.2000122070312]
        },
        viewSelection: {
          kind: "screen-ortho-view",
          canvas: { width: 1180, height: 846 },
          camera: {
            yaw: 0,
            pitch: 0,
            roll: 0,
            zoom: 80.208,
            center: [5, 1, 0.5]
          }
        },
        meshBox: {
          min: [4.5, 0.5, 0.5],
          max: [5.5, 1.5, 0.5]
        },
        rankSelection: {
          kind: "level-rank-range",
          level: 0,
          domainDimensions: [10, 2, 1],
          range: {
            min: [4, 0, 0],
            max: [5, 1, 0]
          },
          sourceElementCount: 4
        }
      }
    }
  ];
  const replay = (regularizeHexSelection) => replayHexRefineCommandScript({
    commands: [
      ...baseCommands,
      {
        kind: "refine.patch",
        payload: {
          options: {
            includeTransitions: true,
            regularizeHexSelection,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  }, {
    gridOverride: { nx: 30, ny: 6, nz: 3 },
    selectionStrategy: "replay"
  });

  const rawReplay = replay(false);
  const regularizedReplay = replay(true);

  assert.equal(checkNoHangingNodes(rawReplay.mesh).ok, true);
  assert.equal(checkNoHangingNodes(regularizedReplay.mesh).ok, true);
  assert.ok(regularizedReplay.mesh.elements.length < rawReplay.mesh.elements.length);
  assert.equal(regularizedReplay.selectionDiagnostics.length, 1);
  assert.equal(regularizedReplay.selectionDiagnostics[0].commandKind, "refine.patch");
  assert.equal(regularizedReplay.selectionDiagnostics[0].selectionSource, "state.selected-elements");
  assert.equal(regularizedReplay.selectionDiagnostics[0].warnings.length, 0);
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].notice,
    "Found a regular uvw shell from the selection, then refined its core."
  );
  assert.ok((regularizedReplay.selectionDiagnostics[0].sourceElementCount ?? 0) > 0);
  assert.equal(regularizedReplay.selectionDiagnostics[0].expandedCandidateCount, regularizedReplay.selectionDiagnostics[0].sourceElementCount);
  assert.ok((regularizedReplay.selectionDiagnostics[0].outerElementCount ?? 0) >= (regularizedReplay.selectionDiagnostics[0].preparedElementCount ?? 0));
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].preparedElementCount,
    regularizedReplay.selectionDiagnostics[0].preparedCellCount
  );
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].preparedCellCount,
    regularizedReplay.selectionDiagnostics[0].stabilizedCellCount
  );
  assert.equal(
    regularizedReplay.selectionDiagnostics[0].boundedCoreCount,
    regularizedReplay.selectionDiagnostics[0].preparedCellCount
  );
});

test("HexRefine offline export manifest includes replay selection diagnostics", async () => {
  const { runOfflineExportJob } = await import("../scripts/offline-export.mjs");
  const script = {
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 10,
          ny: 2,
          nz: 1,
          bounds: { min: [0, 0, 0], max: [10, 2, 1] },
          mergeTolerance: 1e-9
        }
      },
      {
        kind: "select.screen-rect",
        payload: {
          target: "cells",
          additive: false,
          mode: "through",
          rect: {
            min: [796.7999877929688, 420.3999938964844],
            max: [968, 741.2000122070312]
          },
          viewSelection: {
            kind: "screen-ortho-view",
            canvas: { width: 1180, height: 846 },
            camera: {
              yaw: 0,
              pitch: 0,
              roll: 0,
              zoom: 80.208,
              center: [5, 1, 0.5]
            }
          }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          options: {
            includeTransitions: true,
            regularizeHexSelection: true,
            mergeTolerance: 1e-9
          }
        }
      }
    ]
  };

  const result = await runOfflineExportJob(script, { scaleFactor: 3 });
  assert.equal(Array.isArray(result.manifest.selectionDiagnostics), true);
  assert.equal(result.manifest.selectionDiagnostics.length, 1);
  assert.equal(result.manifest.selectionDiagnostics[0].commandKind, "refine.patch");
  assert.equal(result.manifest.selectionDiagnostics[0].selectionSource, "state.selected-elements");
});

test("HexRefine offline export defaults to VTK without INP output", async () => {
  const { runOfflineExportJob } = await import("../scripts/offline-export.mjs");
  const outputDir = await mkdtemp(join(tmpdir(), "hexrefine-offline-test-"));
  try {
    const result = await runOfflineExportJob({
      commands: [
        {
          kind: "grid.generate",
          payload: {
            kind: "H1",
            nx: 4,
            ny: 1,
            nz: 1,
            bounds: { min: [0, 0, 0], max: [4, 1, 1] },
            mergeTolerance: 1e-9
          }
        }
      ]
    }, {
      scaleFactor: 1.2,
      outputDir,
      baseName: "default-vtk-only"
    });

    assert.equal(result.manifest.includeInp, false);
    assert.equal("inpPath" in result, false);
    assert.equal(existsSync(join(outputDir, "default-vtk-only.inp")), false);
    assert.equal(existsSync(join(outputDir, "default-vtk-only.vtk")), true);
    assert.equal(existsSync(join(outputDir, "default-vtk-only-job.json")), true);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("HexRefine shared session selection prep matches the GUI Hex core workflow", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(10, 2, 1));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const selectedElementIds = [5, 6, 15, 16];
  const prepared = prepareSessionRefineSelection(session, active, selectedElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.deepEqual(prepared.elementIds, [...selectedElementIds].sort((a, b) => a - b));
  assert.deepEqual(prepared.cellIds, ["e5", "e6", "e15", "e16"]);
  assert.equal(prepared.expandedCandidateCount, 8);
  assert.equal(prepared.boundedCoreCount, 4);
  assert.equal(prepared.transitionEscapeCount, undefined);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep regularizes disconnected Hex regions independently", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(12, 6, 6));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const leftBlock = idsInIndexBlock(12, 6, 6, [2, 2, 2], [3, 3, 3]);
  const rightBlock = idsInIndexBlock(12, 6, 6, [8, 2, 2], [9, 3, 3]);
  const selectedElementIds = [...leftBlock, ...rightBlock];

  const prepared = prepareSessionRefineSelection(session, active, selectedElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.deepEqual(prepared.elementIds, [...selectedElementIds].sort((a, b) => a - b));
  assert.equal(prepared.regularization?.components?.length, 2);
  assert.equal(prepared.sourceElementCount, 16);
  assert.equal(prepared.boundedCoreCount, 16);
  assert.equal(prepared.regularization.selectedElementIds.length, 128);
  assert.match(prepared.notice, /2 disconnected uvw blocks/);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep uses a hollow uvw shell before growing outward", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(7, 7, 7));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const coreIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4]);
  const centerId = elementIdAt(7, 7, 7, 3, 3, 3);
  const shellIds = coreIds.filter((elementId) => elementId !== centerId);

  const prepared = prepareSessionRefineSelection(session, active, shellIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(prepared.expandedCandidateCount, 26);
  assert.equal(prepared.boundedCoreCount, 1);
  assert.equal(prepared.regularization.selectedElementIds.length, 27);
  assert.equal(prepared.elementIds.includes(centerId), true);
  assert.deepEqual(prepared.elementIds, [centerId]);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep accepts a solid 3x3x3 layer and refines only its center", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(7, 7, 7));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const layerIds = idsInIndexBlock(7, 7, 7, [2, 2, 2], [4, 4, 4]);
  const centerId = elementIdAt(7, 7, 7, 3, 3, 3);

  const prepared = prepareSessionRefineSelection(session, active, layerIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(prepared.expandedCandidateCount, 27);
  assert.equal(prepared.boundedCoreCount, 1);
  assert.equal(prepared.regularization.selectedElementIds.length, 27);
  assert.deepEqual(prepared.elementIds, [centerId]);
  assert.equal(prepared.warnings.length, 0);
});

test("HexRefine shared session selection prep omits transition support on model boundaries", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(7, 7, 7));
  const active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    includeCellIdByElementId: false,
    includeElementIdByCellId: false,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const boundaryCoreIds = idsInIndexBlock(7, 7, 7, [0, 2, 2], [2, 4, 4]);
  const centerId = elementIdAt(7, 7, 7, 1, 3, 3);
  const shellIds = boundaryCoreIds.filter((elementId) => elementId !== centerId);

  const prepared = prepareSessionRefineSelection(session, active, shellIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(prepared.expandedCandidateCount, 26);
  assert.equal(prepared.boundedCoreCount, 2);
  assert.deepEqual(prepared.regularization.indexRange.dimensions, [3, 3, 3]);
  assert.equal(prepared.elementIds.includes(centerId), true);
  assert.deepEqual(prepared.elementIds, [
    elementIdAt(7, 7, 7, 0, 3, 3),
    centerId
  ]);
  assert.equal(prepared.warnings.length, 0);

  refineSessionPatch(session, prepared.cellIds, {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const refined = buildActiveMesh(session, { mergeNodes: true });
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("HexRefine shared session selection prep handles folded uvw support blocks from imported VTK", () => {
  const mesh = parseMeshText(
    readFileSync(join("Test uvw Block", "Test1-ConformHex.vtk"), "utf8"),
    "Test1-ConformHex.vtk"
  );
  const cases = [
    {
      selected: [1, 2, 3, 4, 5, 6],
      core: [1, 2, 3, 4, 5, 6],
      support: [1, 2, 3, 4, 5, 6, 7, 9, 10]
    },
    {
      selected: [14, 15, 16, 17],
      core: [14, 15, 16, 17],
      support: [10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]
    },
    {
      selected: [1, 2, 3, 4, 5, 6, 7, 9, 10],
      core: [1, 2, 3, 4, 5, 6],
      support: [1, 2, 3, 4, 5, 6, 7, 9, 10]
    },
    {
      selected: [10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23],
      core: [14, 15, 16, 17],
      support: [10, 11, 13, 14, 15, 16, 17, 19, 20, 21, 22, 23]
    }
  ];

  assert.equal(checkNoHangingNodes(mesh).ok, true);
  for (const item of cases) {
    const session = createRefinementSession(mesh);
    const active = buildActiveMeshWithMap(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    const prepared = prepareSessionRefineSelection(session, active, item.selected, {
      includeTransitions: true,
      regularizeHexSelection: true,
      mergeTolerance: 1e-9
    });

    assert.deepEqual(prepared.elementIds, item.core);
    assert.deepEqual(prepared.outerElementIds, item.support);
    assert.deepEqual(prepared.warnings, []);

    refineSessionPatch(session, prepared.cellIds, {
      includeTransitions: true,
      transitionSupportCellIds: prepared.outerCellIds,
      mergeTolerance: 1e-9,
      activeBuild: active
    });
    const refined = buildActiveMesh(session, {
      mergeNodes: true,
      mergeTolerance: 1e-9
    });
    assert.equal(checkNoHangingNodes(refined, 1e-8).ok, true);
  }
});

test("HexRefine shared session selection prep keeps uvw domains local after distant refinement", () => {
  const mesh = createHexUnitCubeMesh(8, 3, 3);
  const session = createRefinementSession(mesh);
  let active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const firstCommand = refineSessionPatch(session, ["e1"], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  const firstSelectedChildren = firstCommand.createdCellIds
    .filter((cellId) => session.cells.get(cellId)?.role === "selected");

  active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const beforeFarElementIds = firstSelectedChildren
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId) => elementId !== undefined)
    .sort((a, b) => a - b);
  const beforeFar = prepareSessionRefineSelection(session, active, beforeFarElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  refineSessionPatch(session, ["e72"], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: active
  });
  active = buildActiveMeshWithMap(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9
  });
  const afterFarElementIds = firstSelectedChildren
    .map((cellId) => activeBuildElementIdByCellId(session, active, cellId))
    .filter((elementId) => elementId !== undefined)
    .sort((a, b) => a - b);
  const afterFar = prepareSessionRefineSelection(session, active, afterFarElementIds, {
    includeTransitions: true,
    regularizeHexSelection: true,
    mergeTolerance: 1e-9
  });

  assert.equal(firstSelectedChildren.length, 27);
  assert.equal(beforeFar.elementIds.length, 8);
  assert.equal(afterFar.elementIds.length, beforeFar.elementIds.length);
  assert.equal(afterFar.outerElementIds.length, beforeFar.outerElementIds.length);
  assert.deepEqual(afterFar.warnings, []);
});

test("Hierarchical patch refinement creates selected and transition children", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionPatch(session, ["e1"], { includeTransitions: true });
  const active = buildActiveMesh(session, { mergeNodes: true });
  const localCheck = checkRefinementSessionCommandConformance(session, command);
  const selectedChildren = command.createdCellIds.filter((cellId) => session.cells.get(cellId).role === "selected");
  const transitionChildren = command.createdCellIds.filter((cellId) => session.cells.get(cellId).role === "face-transition");

  assert.equal(command.hiddenCellIds.length, 2);
  assert.equal(selectedChildren.length, 27);
  assert.equal(transitionChildren.length, 13);
  assert.equal(active.elements.length, 40);
  assert.equal(checkNoHangingNodes(active).ok, true);
  assert.equal(localCheck.report.ok, true);
  assert.ok(localCheck.checkedCellIds.length <= active.elements.length);
  assert.throws(
    () => refineSessionPatch(session, [transitionChildren[0]], { includeTransitions: true }),
    /transition layer cells cannot be refined/
  );
});

test("Hierarchical patch refinement can reuse a prebuilt active mesh", () => {
  const sessionA = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const sessionB = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const prebuilt = buildActiveMeshWithMap(sessionB, { mergeNodes: true, mergeTolerance: 1e-9 });

  const commandA = refineSessionPatch(sessionA, ["e1"], { includeTransitions: true, mergeTolerance: 1e-9 });
  const commandB = refineSessionPatch(sessionB, ["e1"], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: prebuilt
  });
  const activeA = buildActiveMesh(sessionA, { mergeNodes: true });
  const activeB = buildActiveMesh(sessionB, { mergeNodes: true });

  assert.deepEqual(commandB.hiddenCellIds, commandA.hiddenCellIds);
  assert.equal(commandB.createdCellIds.length, commandA.createdCellIds.length);
  assert.equal(activeB.nodes.length, activeA.nodes.length);
  assert.equal(activeB.elements.length, activeA.elements.length);
  assert.equal(checkNoHangingNodes(activeB).ok, true);
});

test("Hierarchical patch refinement local active build matches global rebuild after prior refinement", () => {
  const sessionA = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const sessionB = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const firstA = refineSessionPatch(sessionA, ["e1"], { includeTransitions: true, mergeTolerance: 1e-9 });
  refineSessionPatch(sessionB, ["e1"], { includeTransitions: true, mergeTolerance: 1e-9 });
  const childId = firstA.createdCellIds.find((cellId) => sessionA.cells.get(cellId).role === "selected");
  assert.ok(childId);

  const commandA = refineSessionPatch(sessionA, [childId], { includeTransitions: true, mergeTolerance: 1e-9 });
  const prebuilt = buildActiveMeshWithMap(sessionB, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    includeSessionNodeIdByNodeId: false,
    includeSessionNodeIdsByNodeId: false
  });
  const commandB = refineSessionPatch(sessionB, [childId], {
    includeTransitions: true,
    mergeTolerance: 1e-9,
    activeBuild: prebuilt
  });
  const activeA = buildActiveMesh(sessionA, { mergeNodes: true, mergeTolerance: 1e-9 });
  const activeB = buildActiveMesh(sessionB, { mergeNodes: true, mergeTolerance: 1e-9 });

  assert.deepEqual(commandA.hiddenCellIds, commandB.hiddenCellIds);
  assert.equal(commandA.createdCellIds.length, commandB.createdCellIds.length);
  assert.equal(activeA.nodes.length, activeB.nodes.length);
  assert.equal(activeA.elements.length, activeB.elements.length);
  assert.equal(checkNoHangingNodes(activeA).ok, true);
  assert.equal(checkNoHangingNodes(activeB).ok, true);
});

test("Hierarchical local conformance check catches missing transition layers", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const localCheck = checkRefinementSessionCommandConformance(session, command);

  assert.equal(localCheck.report.ok, false);
  assert.ok(localCheck.report.hanging.length > 0);
  assert.ok(localCheck.checkedCellIds.includes("e2"));
});

test("Hierarchical refinement session only refines active cells on the same level", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const childId = command.createdCellIds[0];

  assert.equal(validateRefinementSessionSelection(session, [childId]).ok, true);

  const crossLevel = validateRefinementSessionSelection(session, [childId, "e2"]);
  assert.equal(crossLevel.ok, false);
  assert.deepEqual(crossLevel.mixedLevelCellIds, ["e2"]);
  assert.match(crossLevel.errors.join("; "), /crosses levels/);
  assert.throws(
    () => refineSessionCells(session, [childId, "e2"], refineHexTo27Hex),
    /crosses levels/
  );
});

test("Hierarchical refinement session rejects transition-layer cells as refine cores", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(1, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const transitionCellId = command.createdCellIds[0];
  session.cells.get(transitionCellId).role = "face-transition";

  const validation = validateRefinementSessionSelection(session, [transitionCellId]);
  assert.equal(validation.ok, false);
  assert.deepEqual(validation.transitionCellIds, [transitionCellId]);
  assert.match(validation.errors.join("; "), /transition layer cells cannot be refined/);
  assert.throws(
    () => refineSessionCell(session, transitionCellId, refineHexTo27Hex),
    /transition layer cells cannot be refined/
  );
});

test("Hex session regularization uses active same-level refinable cells", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const command = refineSessionCell(session, "e1", refineHexTo27Hex);
  const childId = command.createdCellIds[0];

  const childSelection = regularizeHexSessionSelection(session, [childId]);
  assert.equal(childSelection.ok, true);
  assert.equal(childSelection.level, 1);
  assert.deepEqual(childSelection.originalCellIds, [childId]);
  assert.ok(childSelection.selectedCellIds.includes(childId));

  const mixedLevelSelection = regularizeHexSessionSelection(session, [childId, "e2"]);
  assert.equal(mixedLevelSelection.ok, true);
  assert.equal(mixedLevelSelection.level, 1);
  assert.deepEqual(mixedLevelSelection.ignoredCellIds, ["e2"]);
  assert.equal(mixedLevelSelection.selectedCellIds.includes(childId), true);
  assert.match(mixedLevelSelection.warnings.join("; "), /multiple refinement levels/);

  session.cells.get(command.createdCellIds[1]).role = "edge-transition";
  const transitionSelection = regularizeHexSessionSelection(session, [command.createdCellIds[1], childId, "e2"]);
  assert.equal(transitionSelection.ok, true);
  assert.equal(transitionSelection.level, 1);
  assert.deepEqual(transitionSelection.ignoredCellIds, [command.createdCellIds[1], "e2"]);
  assert.equal(transitionSelection.selectedCellIds.includes(childId), true);

  const onlyTransitionSelection = regularizeHexSessionSelection(session, [command.createdCellIds[1]]);
  assert.equal(onlyTransitionSelection.ok, false);
  assert.deepEqual(onlyTransitionSelection.ignoredCellIds, [command.createdCellIds[1]]);
});

test("Hex session regularization can grow a local topology layer before uvw crop", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(3, 1, 1));
  const grown = regularizeHexSessionSelection(session, ["e2"], { growTopologyLayers: 1 });

  assert.equal(grown.ok, true);
  assert.deepEqual(grown.sourceCellIds, ["e2"]);
  assert.deepEqual(grown.expandedCellIds, ["e1", "e2", "e3"]);
  assert.deepEqual(grown.selectedCellIds, ["e1", "e2", "e3"]);
  assert.match(grown.warnings.join("; "), /grew selection by topology layer/);
});

test("Q1 mesh refinement adds transition elements on the boundary", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1]
    ],
    elements: [
      [1, 2, 5, 4],
      [2, 3, 6, 5]
    ]
  };

  const pairs = findBoundaryPairs(mesh, [1]);
  assert.equal(pairs.length, 1);

  const refined = refineByElementIds(mesh, [1]);
  assert.equal(refined.kind, "Q1");
  assert.equal(refined.elements.length, 13);
  assert.ok(refined.nodes.length > mesh.nodes.length);
  assert.equal(checkNoHangingNodes(refined).ok, true);
});

test("Hex mesh refinement adds face transition elements on the boundary", () => {
  const nodes = [
    [0, 0, 0],
    [1, 0, 0],
    [2, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [2, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [2, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
    [2, 1, 1]
  ];
  const mesh = {
    kind: "H1",
    nodes,
    elements: [
      [1, 2, 5, 4, 7, 8, 11, 10],
      [2, 3, 6, 5, 8, 9, 12, 11]
    ]
  };

  const refined = refineByElementIds(mesh, [1]);
  assert.equal(refined.kind, "H1");
  assert.equal(refined.elements.length, 40);
  assert.ok(refined.nodes.length > mesh.nodes.length);
});

test("Hex corner transition layer has no hanging nodes", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const refined = refineByElementIds(mesh, [1]);
  const report = checkNoHangingNodes(refined, 1e-9);

  assert.equal(refined.kind, "H1");
  assert.equal(report.hanging.length, 0);
  assert.equal(report.ok, true);
});

test("Hex refinement report identifies automatic transition templates", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const result = refineByElementIdsWithReport(mesh, [1]);
  const templateCounts = countBy(result.cellData.map((cell) => cell.templateCode));

  assert.equal(result.cellData.length, result.mesh.elements.length);
  assert.equal(result.summary.selectedElementCount, 1);
  assert.equal(result.summary.faceTransitionElementCount, 3);
  assert.equal(result.summary.edgeTransitionElementCount, 3);
  assert.equal(result.summary.unchangedElementCount, 1);
  assert.equal(templateCounts.get(27), 27);
  assert.equal(templateCounts.get(13), 39);
  assert.equal(templateCounts.get(5), 15);
  assert.equal(templateCounts.get(0), 1);
});

test("Hex refinement preview reports transition templates without replacing mesh", () => {
  const mesh = createHexUnitCubeMesh(2, 2, 2);
  const preview = previewRefinementByElementIds(mesh, [1]);
  const templateCounts = countBy(preview.plan.map((item) => item.templateCode));

  assert.equal(preview.kind, "H1");
  assert.equal(preview.plan.length, 7);
  assert.equal(preview.summary.selectedElementCount, 1);
  assert.equal(preview.summary.faceTransitionElementCount, 3);
  assert.equal(preview.summary.edgeTransitionElementCount, 3);
  assert.equal(preview.summary.unchangedElementCount, 1);
  assert.equal(preview.summary.estimatedOutputElementCount, 82);
  assert.equal(templateCounts.get(27), 1);
  assert.equal(templateCounts.get(13), 3);
  assert.equal(templateCounts.get(5), 3);
});

test("Hex selection regularization crops to a complete uvw block", () => {
  const mesh = createHexUnitCubeMesh(4, 4, 4);
  const ids = idsInIndexBlock(4, 4, 4, [1, 1, 1], [3, 3, 3]);
  const missingCenter = ids.filter((elementId) => elementId !== elementIdAt(4, 4, 4, 2, 2, 2));
  const regularized = regularizeHexSelection(mesh, missingCenter);

  assert.equal(regularized.addedElementIds.length, 0);
  assert.ok(regularized.removedElementIds.length > 0);
  assert.ok(regularized.selectedElementIds.length > 0);
  assert.ok(regularized.selectedElementIds.length < missingCenter.length);
  assert.equal(regularized.selectedElementIds.length, regularized.indexRange.dimensions.reduce((total, value) => total * value, 1));
  assert.equal(regularized.selectedElementIds.every((elementId) => missingCenter.includes(elementId)), true);
});

test("Hex selection regularization can fill a block interior from a complete uvw boundary shell", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const ids = idsInIndexBlock(5, 5, 5, [1, 1, 1], [3, 3, 3]);
  const centerId = elementIdAt(5, 5, 5, 2, 2, 2);
  const shellIds = ids.filter((elementId) => elementId !== centerId);
  const regularized = regularizeHexSelection(mesh, shellIds, {
    boundaryShellOnly: true
  });

  assert.deepEqual(regularized.indexRange.dimensions, [3, 3, 3]);
  assert.equal(regularized.selectedElementIds.length, 27);
  assert.deepEqual(regularized.addedElementIds, [centerId]);
  assert.equal(regularized.removedElementIds.length, 0);
});

test("Hex selection regularization does not require shell cells on model-boundary sides", () => {
  const mesh = createHexUnitCubeMesh(5, 5, 5);
  const ids = idsInIndexBlock(5, 5, 5, [0, 1, 1], [3, 3, 3]);
  const boundaryFaceInteriorIds = ids.filter((elementId) => {
    const zeroBased = elementId - 1;
    const i = zeroBased % 5;
    const j = Math.floor(zeroBased / 5) % 5;
    const k = Math.floor(zeroBased / 25);
    return i === 0 && j > 1 && j < 3 && k > 1 && k < 3;
  });
  const candidateIds = ids.filter((elementId) => !boundaryFaceInteriorIds.includes(elementId));
  const regularized = regularizeHexSelection(mesh, candidateIds, {
    boundaryShellOnly: true
  });

  assert.deepEqual(regularized.indexRange.dimensions, [4, 3, 3]);
  assert.equal(regularized.selectedElementIds.length, 36);
  assert.deepEqual(regularized.addedElementIds, boundaryFaceInteriorIds);
  assert.equal(regularized.removedElementIds.length, 0);
});

test("Hex selection regularization infers uvw from topology on a deformed structured block", () => {
  const mesh = createDeformedHexBlock(4, 4, 4);
  const ids = idsInIndexBlock(4, 4, 4, [1, 1, 1], [2, 3, 2]);
  const regularized = regularizeHexSelection(mesh, ids);

  assert.deepEqual(regularized.gridDimensions, [4, 4, 4]);
  assert.deepEqual(regularized.indexRange.dimensions, [2, 3, 2]);
  assert.deepEqual(regularized.selectedElementIds, ids);
  assert.equal(regularized.removedElementIds.length, 0);
  assert.equal(regularized.warnings.some((warning) => warning.includes("falling back")), false);
});

test("Hex box refinement uses regularized selection metadata", () => {
  const mesh = createHexUnitCubeMesh(10, 10, 10);
  const result = refineByBoxWithReport(mesh, {
    min: [0.18, 0.18, 0.18],
    max: [0.72, 0.62, 0.52]
  });

  assert.ok(result.regularization);
  assert.deepEqual(result.regularization.indexRange.dimensions, [5, 4, 3]);
  assert.equal(result.summary.selectedElementCount, 60);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});

test("Hex box preview includes regularized selection metadata", () => {
  const mesh = createHexUnitCubeMesh(10, 10, 10);
  const preview = previewRefinementByBox(mesh, {
    min: [0.18, 0.18, 0.18],
    max: [0.72, 0.62, 0.52]
  });

  assert.ok(preview.regularization);
  assert.deepEqual(preview.regularization.indexRange.dimensions, [5, 4, 3]);
  assert.equal(preview.summary.selectedElementCount, 60);
  assert.equal(preview.summary.estimatedOutputElementCount, 3880);
});

test("Distance-function refinement uses inside set and automatic transitions", () => {
  const mesh = createHexUnitCubeMesh(10, 10, 10);
  const result = refineByDistanceFunctionWithReport(mesh, boxDistance([0, 0, 0], [0.5, 0.5, 0.5]), -0.1);
  const preview = previewRefinementByDistanceFunction(mesh, boxDistance([0, 0, 0], [0.5, 0.5, 0.5]), -0.1);

  assert.equal(result.summary.selectedElementCount, 125);
  assert.equal(result.summary.faceTransitionElementCount, 75);
  assert.equal(result.summary.edgeTransitionElementCount, 15);
  assert.equal(preview.summary.estimatedOutputElementCount, result.mesh.elements.length);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});


test("Q1 distance-function refinement supports circular regions", () => {
  const mesh = {
    kind: "Q1",
    nodes: [
      [0, 0],
      [0.5, 0],
      [1, 0],
      [0, 0.5],
      [0.5, 0.5],
      [1, 0.5],
      [0, 1],
      [0.5, 1],
      [1, 1]
    ],
    elements: [
      [1, 2, 5, 4],
      [2, 3, 6, 5],
      [4, 5, 8, 7],
      [5, 6, 9, 8]
    ]
  };
  const result = refineByDistanceFunctionWithReport(mesh, circleDistance([0.25, 0.25], 0.2));

  assert.equal(result.summary.selectedElementCount, 1);
  assert.equal(result.summary.edgeTransitionElementCount, 2);
  assert.equal(result.summary.cornerTransitionElementCount, 0);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-9).ok, true);
});

test("Hex block refinement examples have no hanging nodes", () => {
  const oneEighth = refineByBox(createHexUnitCubeMesh(10, 10, 10), {
    min: [0, 0, 0],
    max: [0.5, 0.5, 0.5]
  });
  const middleCube = refineByBox(createHexUnitCubeMesh(10, 10, 10), {
    min: [0.3, 0.3, 0.3],
    max: [0.7, 0.7, 0.7]
  });

  assert.equal(checkNoHangingNodes(oneEighth, 1e-8).ok, true);
  assert.equal(checkNoHangingNodes(middleCube, 1e-8).ok, true);
});


function assertPoint(actual, expected, tolerance = 1e-12) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < expected.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= tolerance, `coordinate ${i}: ${actual[i]} != ${expected[i]}`);
  }
}

function countBy(values) {
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function elementIdAt(nx, ny, _nz, i, j, k) {
  return k * nx * ny + j * nx + i + 1;
}

function idsInIndexBlock(nx, ny, nz, min, max) {
  const ids = [];
  for (let k = min[2]; k <= max[2]; k += 1) {
    for (let j = min[1]; j <= max[1]; j += 1) {
      for (let i = min[0]; i <= max[0]; i += 1) {
        ids.push(elementIdAt(nx, ny, nz, i, j, k));
      }
    }
  }
  return ids;
}

function createDeformedHexBlock(nx, ny, nz) {
  const mesh = createHexUnitCubeMesh(nx, ny, nz);
  return {
    ...mesh,
    nodes: mesh.nodes.map(([x, y, z]) => [
      x + 0.15 * y + 0.07 * z * z,
      y + 0.11 * x * z,
      z + 0.09 * x * y
    ])
  };
}
