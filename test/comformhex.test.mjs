import assert from "node:assert/strict";
import test from "node:test";

import {
  checkNoHangingNodes,
  createHexUnitCubeMesh,
  createRefinementSession,
  buildNativeSessionExportPlan,
  buildRefinementSessionExport,
  iterateLegacyVtkLines,
  iterateNativeSessionInpLines,
  iterateNativeSessionVtkLines,
  iteratePreparedInpLines,
  meshFromSerializable,
  meshToLegacyVtk,
  meshSelection,
  parseLegacyVtkMesh,
  parseMeshText,
  prepareExportMesh,
  refinementSessionExportToInp,
  refinementOps,
  replayHexRefineCommandScript
} from "../dist/index.js";

test("HexRefine project entry exposes mesh selection and non-field refinement", () => {
  const mesh = createHexUnitCubeMesh(3, 3, 3);
  const selected = meshSelection.selectElementsByDistanceFunction(mesh, (x, y, z) =>
    Math.min(0.75 - x, x - 0.25, 0.75 - y, y - 0.25, 0.75 - z, z - 0.25),
  0);

  assert.ok(selected.inside.length > 0);

  const result = refinementOps.refineByElementIdsWithReport(mesh, selected.inside, {
    regularizeHexSelection: true
  });
  assert.ok(result.mesh.elements.length > mesh.elements.length);

  const report = checkNoHangingNodes(result.mesh, 1e-8);
  assert.equal(report.ok, true);
});

test("HexRefine project command replay rebuilds a refined mesh with sets", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 2,
          nz: 2,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: { includeTransitions: true }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "CORE",
          elementIds: [1],
          material: { name: "steel", elasticModulus: 210000, poissonRatio: 0.3 }
        }
      }
    ]
  });

  assert.equal(replay.replayedCommandCount, 3);
  assert.ok(replay.mesh.elements.length > 8);
  assert.ok(replay.cellSets.has("CORE"));
  assert.equal(replay.cellSetMaterials.get("CORE")?.name, "steel");
  assert.equal(checkNoHangingNodes(replay.mesh, 1e-8).ok, true);
});

test("HexRefine project imports standard Quad and Hex meshes from JSON-like objects", () => {
  const quad = meshFromSerializable({
    nodes: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ],
    elements: [[1, 2, 3, 4]]
  });
  const quadResult = refinementOps.refineByElementIdsWithReport(quad, [1], {
    includeTransitions: true
  });

  const hex = meshFromSerializable({
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  });
  const hexResult = refinementOps.refineByElementIdsWithReport(hex, [1], {
    includeTransitions: true
  });

  assert.equal(quad.kind, "Q1");
  assert.equal(hex.kind, "H1");
  assert.ok(quadResult.mesh.elements.length > quad.elements.length);
  assert.ok(hexResult.mesh.elements.length > hex.elements.length);
});

test("HexRefine project command replay supports imported starting meshes", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.import",
        payload: {
          mesh: {
            nodes: [
              [0, 0, 0],
              [1, 0, 0],
              [1, 1, 0],
              [0, 1, 0],
              [0, 0, 1],
              [1, 0, 1],
              [1, 1, 1],
              [0, 1, 1]
            ],
            elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
          }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: { includeTransitions: true }
        }
      }
    ]
  });

  assert.equal(replay.mesh.kind, "H1");
  assert.ok(replay.mesh.elements.length > 1);
});

test("HexRefine project imports legacy VTK quad and hex meshes", () => {
  const quadVtk = meshToLegacyVtk({
    kind: "Q1",
    nodes: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1]
    ],
    elements: [[1, 2, 3, 4]]
  }, { title: "quad" });
  const hexVtk = meshToLegacyVtk({
    kind: "H1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  }, { title: "hex" });

  const quad = parseLegacyVtkMesh(quadVtk);
  const hex = parseMeshText(hexVtk, "box.vtk");

  assert.equal(quad.kind, "Q1");
  assert.equal(quad.elements.length, 1);
  assert.equal(hex.kind, "H1");
  assert.equal(hex.elements.length, 1);
});

test("HexRefine project auto-detects Abaqus INP, LS-DYNA K, and VTU meshes from file suffixes", () => {
  const abaqusInp = [
    "*Heading",
    "HexRefine Abaqus import",
    "*Node",
    "10, 0, 0, 0",
    "20, 1, 0, 0",
    "30, 1, 1, 0",
    "40, 0, 1, 0",
    "50, 0, 0, 1",
    "60, 1, 0, 1",
    "70, 1, 1, 1",
    "80, 0, 1, 1",
    "*Element, type=C3D8",
    "100, 10, 20, 30, 40, 50, 60, 70, 80"
  ].join("\n");
  const lsdynaKeyword = [
    "*KEYWORD",
    "*NODE",
    "101, 0, 0, 0",
    "102, 1, 0, 0",
    "103, 1, 1, 0",
    "104, 0, 1, 0",
    "*ELEMENT_SHELL",
    "1, 1, 101, 102, 103, 104",
    "*END"
  ].join("\n");
  const vtu = [
    "<?xml version=\"1.0\"?>",
    "<VTKFile type=\"UnstructuredGrid\" version=\"0.1\" byte_order=\"LittleEndian\">",
    "  <UnstructuredGrid>",
    "    <Piece NumberOfPoints=\"4\" NumberOfCells=\"1\">",
    "      <Points>",
    "        <DataArray type=\"Float64\" NumberOfComponents=\"3\" format=\"ascii\">",
    "          0 0 0  1 0 0  1 1 0  0 1 0",
    "        </DataArray>",
    "      </Points>",
    "      <Cells>",
    "        <DataArray type=\"Int32\" Name=\"connectivity\" format=\"ascii\">0 1 2 3</DataArray>",
    "        <DataArray type=\"Int32\" Name=\"offsets\" format=\"ascii\">4</DataArray>",
    "        <DataArray type=\"UInt8\" Name=\"types\" format=\"ascii\">9</DataArray>",
    "      </Cells>",
    "    </Piece>",
    "  </UnstructuredGrid>",
    "</VTKFile>"
  ].join("\n");

  const abaqus = parseMeshText(abaqusInp, "block.inp");
  const lsdyna = parseMeshText(lsdynaKeyword, "shell.k");
  const quadVtu = parseMeshText(vtu, "quad.vtu");

  assert.equal(abaqus.kind, "H1");
  assert.deepEqual(abaqus.elements, [[1, 2, 3, 4, 5, 6, 7, 8]]);
  assert.equal(lsdyna.kind, "Q1");
  assert.deepEqual(lsdyna.elements, [[1, 2, 3, 4]]);
  assert.equal(quadVtu.kind, "Q1");
  assert.deepEqual(quadVtu.elements, [[1, 2, 3, 4]]);
});

test("HexRefine project streams legacy VTK lines without changing file content", () => {
  const mesh = {
    kind: "H1",
    nodes: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  };
  const options = {
    title: "streamed",
    cellScalars: {
      selected: [1]
    }
  };

  const text = meshToLegacyVtk(mesh, options);
  const streamed = `${[...iterateLegacyVtkLines(mesh, options)].join("\n")}\n`;

  assert.equal(streamed, text);
});

test("HexRefine project streams INP lines without changing file content", () => {
  const exported = buildRefinementSessionExport(createRefinementSession(createHexUnitCubeMesh(1, 1, 1)), {
    mergeNodes: true
  });
  const options = { title: "HexRefine streaming INP smoke" };
  const prepared = prepareExportMesh(exported, "H8");
  const streamed = `${[...iteratePreparedInpLines(prepared, options)].join("\n")}\n`;
  const text = refinementSessionExportToInp(exported, options);

  assert.equal(streamed, text);
});

test("HexRefine project streams native session VTK and INP without materializing flat elements", () => {
  const session = createRefinementSession(createHexUnitCubeMesh(2, 1, 1));
  const sets = {
    cellSets: new Map([["LEFT", ["e1"]]]),
    nodeSets: new Map([["CORNER", [1, 2]]])
  };
  const exported = buildRefinementSessionExport(session, {
    mergeNodes: true,
    mergeTolerance: 1e-9,
    sets
  });
  const prepared = prepareExportMesh(exported, "H8");
  const plan = buildNativeSessionExportPlan(session, {
    mergeTolerance: 1e-9,
    sets
  });
  const vtkOptions = { title: "HexRefine native session VTK smoke" };
  const inpOptions = { title: "HexRefine native session INP smoke" };

  const flatVtk = `${[...iterateLegacyVtkLines(prepared.mesh, vtkOptions)].join("\n")}\n`;
  const nativeVtk = `${[...iterateNativeSessionVtkLines(plan, vtkOptions)].join("\n")}\n`;
  const flatInp = `${[...iteratePreparedInpLines(prepared, inpOptions)].join("\n")}\n`;
  const nativeInp = `${[...iterateNativeSessionInpLines(plan, inpOptions)].join("\n")}\n`;

  assert.equal(nativeVtk, flatVtk);
  assert.equal(nativeInp, flatInp);
  assert.equal(plan.activeCellIds.length, 2);
});

test("HexRefine project converts Q1 export meshes to T3 and Q9 before writing", () => {
  const exported = {
    mesh: {
      kind: "Q1",
      nodes: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1]
      ],
      elements: [[1, 2, 3, 4]]
    },
    build: null,
    sets: {
      cellSets: new Map([["FACE", [1]]]),
      nodeSets: new Map([["EDGE", [1, 2]]]),
      missingCellIdsBySet: new Map(),
      missingNodeIdsBySet: new Map()
    }
  };

  const triangles = prepareExportMesh(exported, "T3");
  assert.equal(triangles.mesh.kind, "T3");
  assert.equal(triangles.mesh.elements.length, 2);
  assert.deepEqual(triangles.mesh.elements[0], [1, 2, 3]);
  assert.deepEqual(triangles.mesh.elements[1], [1, 3, 4]);
  assert.deepEqual(triangles.sets.cellSets.get("FACE"), [1, 2]);

  const q9 = prepareExportMesh(exported, "Q9");
  assert.equal(q9.mesh.kind, "Q9");
  assert.equal(q9.mesh.nodes.length, 9);
  assert.equal(q9.mesh.elements[0].length, 9);
  assert.deepEqual(q9.sets.cellSets.get("FACE"), [1]);
  assert.deepEqual(q9.sets.nodeSets.get("EDGE"), [1, 2]);
});

test("HexRefine project converts H1 export meshes to H20 before writing", () => {
  const exported = {
    mesh: {
      kind: "H1",
      nodes: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1]
      ],
      elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
    },
    build: null,
    sets: {
      cellSets: new Map([["VOL", [1]]]),
      nodeSets: new Map(),
      missingCellIdsBySet: new Map(),
      missingNodeIdsBySet: new Map()
    }
  };

  const h20 = prepareExportMesh(exported, "H20");
  assert.equal(h20.mesh.kind, "H20");
  assert.equal(h20.mesh.nodes.length, 20);
  assert.equal(h20.mesh.elements[0].length, 20);
  assert.deepEqual(h20.sets.cellSets.get("VOL"), [1]);
});

test("HexRefine project reports user-friendly unsupported VTK cell type errors", () => {
  const unsupportedVtk = [
    "# vtk DataFile Version 3.0",
    "triangle",
    "ASCII",
    "DATASET UNSTRUCTURED_GRID",
    "POINTS 3 double",
    "0 0 0",
    "1 0 0",
    "0 1 0",
    "CELLS 1 4",
    "3 0 1 2",
    "CELL_TYPES 1",
    "5"
  ].join("\n");

  assert.throws(
    () => parseMeshText(unsupportedVtk, "triangle.vtk"),
    /supports CELL_TYPES 9 \(QUAD\) and 12 \(HEXAHEDRON\)/i
  );
});

test("HexRefine project hanging-node check handles highly nonuniform face scales", () => {
  const largeHex = {
    nodes: [
      [0, 0, 0],
      [1000000, 0, 0],
      [1000000, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
      [1000000, 0, 1],
      [1000000, 1, 1],
      [0, 1, 1]
    ],
    elements: [[1, 2, 3, 4, 5, 6, 7, 8]]
  };
  const tinyHexes = Array.from({ length: 16 }, (_, index) => {
    const offset = 10 + index * 2;
    const nodeBase = 8 + index * 8;
    const nodes = [
      [offset, 10, 10],
      [offset + 1, 10, 10],
      [offset + 1, 11, 10],
      [offset, 11, 10],
      [offset, 10, 11],
      [offset + 1, 10, 11],
      [offset + 1, 11, 11],
      [offset, 11, 11]
    ];
    const element = Array.from({ length: 8 }, (_, localIndex) => nodeBase + localIndex + 1);
    return { nodes, element };
  });
  const mesh = {
    kind: "H1",
    nodes: [
      ...largeHex.nodes,
      ...tinyHexes.flatMap((item) => item.nodes)
    ],
    elements: [
      ...largeHex.elements,
      ...tinyHexes.map((item) => item.element)
    ]
  };

  const report = checkNoHangingNodes(mesh, 1e-8);

  assert.equal(report.ok, true);
  assert.equal(report.hanging.length, 0);
});

test("HexRefine project can directly refine a local Hex on a non-block imported mesh", () => {
  const base = createHexUnitCubeMesh(3, 1, 2);
  const mesh = {
    kind: "H1",
    nodes: base.nodes,
    elements: base.elements.filter((_, index) => index !== 4)
  };

  const result = refinementOps.refineByElementIdsWithReport(mesh, [1], {
    includeTransitions: true,
    regularizeHexSelection: false
  });

  assert.ok(result.mesh.elements.length > mesh.elements.length);
  assert.equal(checkNoHangingNodes(result.mesh, 1e-8).ok, true);
});

test("HexRefine project exports refined sessions to VTK and INP", () => {
  const replay = replayHexRefineCommandScript({
    commands: [
      {
        kind: "grid.generate",
        payload: {
          kind: "H1",
          nx: 2,
          ny: 2,
          nz: 2,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] }
        }
      },
      {
        kind: "refine.patch",
        payload: {
          elementIds: [1],
          options: { includeTransitions: true }
        }
      },
      {
        kind: "set.cells.save",
        payload: {
          name: "CORE",
          elementIds: [1],
          material: { name: "steel", elasticModulus: 210000, poissonRatio: 0.3 }
        }
      }
    ]
  });

  const exported = buildRefinementSessionExport(replay.session, {
    sets: {
      cellSets: replay.cellSets,
      nodeSets: replay.nodeSets
    },
    mergeNodes: true,
    mergeTolerance: 1e-8
  });
  const vtk = meshToLegacyVtk(exported.mesh, { title: "HexRefine project export" });
  const inp = refinementSessionExportToInp(exported, {
    title: "HexRefine project export",
    materials: replay.cellSetMaterials
  });

  assert.match(vtk, /DATASET UNSTRUCTURED_GRID/);
  assert.match(inp, /\*Node/);
  assert.match(inp, /\*Element/);
  assert.match(inp, /\*Elset, elset=CORE/);
  assert.match(inp, /\*Material, name=steel/);
});
