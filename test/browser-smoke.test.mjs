import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

test("ComformHex browser GUI imports the project-local runtime build", async () => {
  const redirect = await readFile(new URL("examples/browser/comformhex.html", projectRoot), "utf8");
  const gui = await readFile(new URL("examples/browser/refinement-gui.html", projectRoot), "utf8");
  const worker = await readFile(new URL("examples/browser/refinement-worker.js", projectRoot), "utf8");

  assert.match(redirect, /url=\.\/refinement-gui\.html/);
  assert.match(gui, /from\s+"..\/..\/dist\/index\.js"/);
  assert.match(worker, /from\s+"..\/..\/dist\/index\.js"/);
  assert.doesNotMatch(gui, /dist\/comformhex\.js/);
  assert.doesNotMatch(worker, /dist\/comformhex\.js/);
  assert.match(gui, /meshMergeTolerance\s*=\s*replay\.mergeTolerance\s*\?\?\s*meshMergeTolerance/);
  assert.match(gui, /function\s+buildActiveCellDataFromSession/);
  assert.match(gui, /activeBuildCellIdByElementId/);
  assert.match(gui, /includeCellIdByElementId:\s*false/);
  assert.doesNotMatch(gui, /cellIdByElementId\?\?\.has|cellIdByElementId\.has/);
  const standaloneBuilder = await readFile(new URL("scripts/build-standalone-lite.mjs", projectRoot), "utf8");
  assert.match(standaloneBuilder, /activeBuildCellIdByElementId/);
  assert.match(standaloneBuilder, /activeBuildElementIdByCellId/);
  assert.match(gui, /id="import-mesh"/);
  assert.match(gui, /id="webgl-preview"/);
  assert.match(gui, /id="projection-toggle"/);
  assert.match(gui, /projectionMode\s*=\s*"perspective"/);
  assert.match(gui, /function\s+toggleProjectionMode/);
  assert.match(gui, /function\s+webglSurfaceProxyForCurrentMesh/);
  assert.match(gui, /function\s+surfaceFaceRecordsForCurrentVisibility/);
  assert.match(gui, /function\s+sortedFaceNodeIds/);
  assert.match(gui, /function\s+drawWebglWorldPositions/);
  assert.match(gui, /webgl world surface/);
  assert.match(gui, /parseMeshText/);
  assert.match(gui, /prepareSessionRefineSelection/);
  assert.match(gui, /accept="application\/json,.json,.vtk,.vtu,.inp,.k,.key,text\/plain"/);
  assert.doesNotMatch(gui, /cellData:\s*\[\]/);
  assert.doesNotMatch(gui, /Regularized block rejected:/);

  const runtime = await import("../dist/index.js");
  assert.equal(typeof runtime.createHexUnitCubeMesh, "function");
  assert.equal(typeof runtime.meshFromSerializable, "function");
  assert.equal(typeof runtime.parseMeshText, "function");
  assert.equal(typeof runtime.parseLegacyVtkMesh, "function");
  assert.equal(typeof runtime.prepareSessionRefineSelection, "function");
  assert.equal(typeof runtime.refineByElementIdsWithReport, "function");
});
