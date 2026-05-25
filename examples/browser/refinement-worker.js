import {
  activeBuildCellIdByElementId,
  buildActiveMeshWithMap,
  buildRefinementSessionExport,
  checkRefinementSessionCommandConformance,
  checkNoHangingNodes,
  iterateLegacyVtkLines,
  iteratePreparedInpLines,
  missingSetSummary,
  prepareExportMesh
} from "../../dist/index.js";

self.addEventListener("message", (event) => {
  const request = event.data;
  try {
    if (request.kind === "check-hanging") {
      const start = performance.now();
      const report = checkNoHangingNodes(request.mesh, request.tolerance);
      self.postMessage({
        ok: true,
        kind: request.kind,
        report,
        elapsedMs: performance.now() - start
      });
      return;
    }

    if (request.kind === "export-vtk") {
      const start = performance.now();
      const exported = buildExport(request);
      const prepared = prepareExportMesh(exported, request.exportKind);
      const exportMesh = prepared.mesh;
      const scalars = {};
      if (request.lastCellData && request.lastCellData.length > 0) {
        scalars.role = prepared.sourceElementIds.map((sourceElementId) =>
          roleCode(request.lastCellData[sourceElementId - 1]?.role ?? "unchanged")
        );
        scalars.template_code = prepared.sourceElementIds.map((sourceElementId) =>
          request.lastCellData[sourceElementId - 1]?.templateCode ?? 0
        );
        scalars.parent_element_id = prepared.sourceElementIds.map((sourceElementId) =>
          request.lastCellData[sourceElementId - 1]?.parentElementId ?? sourceElementId
        );
      } else {
        const selected = new Set(request.selectedElementIds ?? []);
        scalars.selected = prepared.sourceElementIds.map((sourceElementId) => selected.has(sourceElementId) ? 1 : 0);
      }
      const parts = linesToBlobParts(iterateLegacyVtkLines(exportMesh, {
        title: "HexRefine workbench mesh",
        cellScalars: scalars
      }));
      self.postMessage({
        ok: true,
        kind: request.kind,
        parts,
        missing: missingSetSummary(prepared.sets),
        elapsedMs: performance.now() - start
      });
      return;
    }

    if (request.kind === "export-inp") {
      const start = performance.now();
      const exported = buildExport(request);
      const prepared = prepareExportMesh(exported, request.exportKind ?? request.elementKind);
      const parts = linesToBlobParts(iteratePreparedInpLines(prepared, {
        title: "HexRefine workbench mesh",
        elementKind: request.exportKind ?? request.elementKind,
        materials: request.materials ?? []
      }));
      self.postMessage({
        ok: true,
        kind: request.kind,
        parts,
        missing: missingSetSummary(prepared.sets),
        elapsedMs: performance.now() - start
      });
      return;
    }

    if (request.kind === "refresh-session-view") {
      const totalStart = performance.now();
      const activeBuildStart = performance.now();
      const activeBuild = buildActiveMeshWithMap(request.session, {
        mergeNodes: true,
        mergeTolerance: request.mergeTolerance,
        includeElementIdsByNodeId: Boolean(request.command),
        includeCellIdByElementId: request.includeCellIdByElementId !== false,
        includeElementIdByCellId: request.includeElementIdByCellId !== false,
        includeSessionNodeIdByNodeId: false,
        includeSessionNodeIdsByNodeId: request.includeSessionNodeIdsByNodeId !== false
      });
      const activeBuildMs = performance.now() - activeBuildStart;
      const conformanceStart = performance.now();
      const localConformance = request.command
        ? checkRefinementSessionCommandConformance(
            request.session,
            request.command,
            request.mergeTolerance,
            activeBuild
          )
        : null;
      const conformanceMs = request.command ? performance.now() - conformanceStart : 0;
      self.postMessage({
        ok: true,
        kind: request.kind,
        activeBuild,
        cellData: request.includeCellData ? buildActiveCellDataFromSession(request.session, activeBuild) : null,
        localConformance: localConformance
          ? {
              report: localConformance.report,
              checkedCellIds: localConformance.checkedCellIds,
              checkedElementIds: localConformance.checkedElementIds,
              seedCellIds: localConformance.seedCellIds,
              seedElementIds: localConformance.seedElementIds
            }
          : null,
        activeBuildMs,
        conformanceMs,
        elapsedMs: performance.now() - totalStart
      });
      return;
    }

    throw new Error(`unknown worker task: ${request.kind}`);
  } catch (error) {
    self.postMessage({
      ok: false,
      kind: request.kind,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

function buildExport(request) {
  return buildRefinementSessionExport(request.session, {
    mergeNodes: true,
    mergeTolerance: request.mergeTolerance,
    sets: {
      cellSets: request.cellSets,
      nodeSets: request.nodeSets
    }
  });
}

function roleCode(role) {
  switch (role) {
    case "selected": return 4;
    case "face-transition": return 3;
    case "edge-transition": return 2;
    case "corner-transition": return 1;
    default: return 0;
  }
}

function buildActiveCellDataFromSession(session, build) {
  return build.mesh.elements.map((_, index) => {
    const elementId = index + 1;
    const cellId = activeBuildCellIdByElementId(build, elementId);
    const cell = cellId ? session.cells.get(cellId) : undefined;
    const templateCode = Number(cell?.template);
    return {
      parentElementId: cell?.sourceElementId ?? elementId,
      role: cell && cell.role !== "base" ? cell.role : "unchanged",
      templateCode: Number.isFinite(templateCode) ? templateCode : 0
    };
  });
}

function linesToBlobParts(lines, targetPartBytes = 4 * 1024 * 1024) {
  const parts = [];
  let chunk = "";
  for (const line of lines) {
    chunk += `${line}\n`;
    if (chunk.length >= targetPartBytes) {
      parts.push(chunk);
      chunk = "";
    }
  }
  if (chunk.length > 0) {
    parts.push(chunk);
  }
  return parts;
}
