import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const guiPath = join(root, "examples", "browser", "refinement-gui.html");
const distRoot = join(root, "dist");
const outputPath = join(root, "examples", "browser", "hexrefine-standalone.html");
const legacyOutputPath = join(root, "examples", "browser", "comformhex-standalone.html");

const guiHtml = await readFile(guiPath, "utf8");
const importMap = await buildImportMap(distRoot);
const transformed = buildStandaloneHtml(guiHtml, importMap);
await writeFile(outputPath, transformed, "utf8");
await writeFile(legacyOutputPath, redirectHtml("hexrefine-standalone.html", "HexRefine Standalone"), "utf8");
console.log(`Prepared standalone file: ${outputPath}`);

async function buildImportMap(distDir) {
  const entries = await readdir(distDir, { withFileTypes: true });
  const imports = {};
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) {
      continue;
    }
    const source = await readFile(join(distDir, entry.name), "utf8");
    const rewritten = rewriteModuleSpecifiers(source);
    const specifier = standaloneSpecifier(entry.name);
    imports[specifier] = toDataUrl(rewritten);
    if (entry.name === "index.js") {
      imports["../../dist/index.js"] = imports[specifier];
    }
  }
  return imports;
}

function buildStandaloneHtml(html, importMap) {
  const runtimeScript = `<script>window.HEXREFINE_RUNTIME={appMode:"internal",guiElementLimit:null};window.COMFORMHEX_RUNTIME=window.HEXREFINE_RUNTIME;window.HEXREFINE_STANDALONE=true;window.COMFORMHEX_STANDALONE=true;</script>`;
  const importMapScript = `<script type="importmap">${JSON.stringify({ imports: importMap }, null, 2)}</script>`;
  const importBlock = `import {
        activeBuildCellIdByElementId,
        activeBuildElementIdByCellId,
        buildActiveMeshWithMap,
        buildRefinementSessionExport,
        checkNoHangingNodes,
        checkRefinementSessionCommandConformance,
        iterateLegacyVtkLines,
        iteratePreparedInpLines,
        createRefinementSession,
        createHexUnitCubeMesh,
        createQ1UnitSquareMesh,
        missingSetSummary,
        parseMeshText,
        prepareExportMesh,
        prepareSessionRefineSelection,
        previewRefinementByElementIds,
        growQ1BoundaryLayer,
        replaceQ1BlockWithRectangleCircleTemplate,
        refineSessionPatch,
        regularizeHexSelection,
        replayHexRefineCommandScript,
        redoRefinementSession,
        undoRefinementSession
      } from "hexrefine/index.js";`;

  const workerReplacement = `async function runRefinementWorker(request) {
        workerStatus = "inline";
        updateStats();
        const totalStart = performance.now();
        try {
          if (request.kind === "check-hanging") {
            const report = checkNoHangingNodes(request.mesh, request.tolerance);
            return {
              ok: true,
              kind: request.kind,
              report,
              elapsedMs: performance.now() - totalStart
            };
          }

          if (request.kind === "export-vtk") {
            const exported = buildRefinementSessionExport(request.session, {
              mergeNodes: true,
              mergeTolerance: request.mergeTolerance,
              sets: {
                cellSets: request.cellSets,
                nodeSets: request.nodeSets
              }
            });
            const prepared = prepareExportMesh(exported, request.exportKind);
            const scalars = {};
            if (request.lastCellData && request.lastCellData.length > 0) {
              scalars.role = prepared.sourceElementIds.map((sourceElementId) => roleCode(request.lastCellData[sourceElementId - 1]?.role ?? "unchanged"));
              scalars.template_code = prepared.sourceElementIds.map((sourceElementId) => request.lastCellData[sourceElementId - 1]?.templateCode ?? 0);
              scalars.parent_element_id = prepared.sourceElementIds.map((sourceElementId) => request.lastCellData[sourceElementId - 1]?.parentElementId ?? sourceElementId);
            } else {
              const selectedIds = new Set(request.selectedElementIds ?? []);
              scalars.selected = prepared.sourceElementIds.map((sourceElementId) => selectedIds.has(sourceElementId) ? 1 : 0);
            }
            return {
              ok: true,
              kind: request.kind,
              parts: linesToBlobParts(iterateLegacyVtkLines(prepared.mesh, {
                title: "HexRefine standalone mesh",
                cellScalars: scalars
              })),
              missing: missingSetSummary(prepared.sets),
              elapsedMs: performance.now() - totalStart
            };
          }

          if (request.kind === "export-inp") {
            const exported = buildRefinementSessionExport(request.session, {
              mergeNodes: true,
              mergeTolerance: request.mergeTolerance,
              sets: {
                cellSets: request.cellSets,
                nodeSets: request.nodeSets
              }
            });
            const prepared = prepareExportMesh(exported, request.exportKind ?? request.elementKind);
            return {
              ok: true,
              kind: request.kind,
              parts: linesToBlobParts(iteratePreparedInpLines(prepared, {
                title: "HexRefine standalone mesh",
                elementKind: request.exportKind ?? request.elementKind,
                materials: request.materials ?? []
              })),
              missing: missingSetSummary(prepared.sets),
              elapsedMs: performance.now() - totalStart
            };
          }

          if (request.kind === "refresh-session-view") {
            const activeBuildStart = performance.now();
            const activeBuild = buildActiveMeshWithMap(request.session, {
              mergeNodes: true,
              mergeTolerance: request.mergeTolerance,
              includeElementIdsByNodeId: Boolean(request.command),
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
            return {
              ok: true,
              kind: request.kind,
              activeBuild,
              cellData: request.includeCellData ? buildActiveCellDataFromSession(activeBuild) : null,
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
            };
          }

          throw new Error(\`standalone mode does not support task: \${request.kind}\`);
        } catch (error) {
          workerStatus = "failed";
          updateStats();
          throw error instanceof Error ? error : new Error(String(error));
        }
      }

      function linesToBlobParts(lines, targetPartBytes = 4 * 1024 * 1024) {
        const parts = [];
        let chunk = "";
        for (const line of lines) {
          chunk += \`\${line}\\n\`;
          if (chunk.length >= targetPartBytes) {
            parts.push(chunk);
            chunk = "";
          }
        }
        if (chunk.length > 0) {
          parts.push(chunk);
        }
        return parts;
      }`;

  const offlineReplacement = `async function exportOfflineJob() {
        setStatus("Offline Job is not available in the single-file standalone build. Use VTK/INP export or save the command script and run the full workbench for offline replay.", false);
      }`;

  let output = html;
  output = output.replace('<script src="./runtime-config.js"></script>', runtimeScript + "\n    " + importMapScript);
  output = output.replace(/import\s*\{[\s\S]*?\}\s*from "\.\.\/\.\.\/dist\/index\.js";/, importBlock);
  output = output.replace(
    /function runRefinementWorker\(request\) \{[\s\S]*?\r?\n      \}\r?\n\r?\n      function createMesh\(\) \{/,
    `${workerReplacement}\n\n      function createMesh() {`
  );
  output = output.replace(
    /async function exportOfflineJob\(\) \{[\s\S]*?\r?\n      \}\r?\n\r?\n      function reportMissingExportSets/,
    `${offlineReplacement}\n\n      function reportMissingExportSets`
  );
  output = output.replace('const restoreAutosaveButton = document.querySelector("#restore-autosave");', 'const restoreAutosaveButton = document.querySelector("#restore-autosave");\n      const standaloneMode = Boolean(globalThis.HEXREFINE_STANDALONE || globalThis.COMFORMHEX_STANDALONE);');
  output = output.replace(
    '      syncKindControls();\n      syncExportKindOptions();\n      setMiddleBox();',
    `      if (standaloneMode) {\n        exportOfflineButton.disabled = true;\n        offlineScaleEl.disabled = true;\n        offlineReleaseMemoryEl.disabled = true;\n        restoreAutosaveButton.disabled = true;\n        statWorkerEl.textContent = "inline";\n      }\n\n      syncKindControls();\n      syncExportKindOptions();\n      setMiddleBox();`
  );
  output = output.replace(/<title>ComformHex[^<]*<\/title>|<title>HexRefine[^<]*<\/title>/, '<title>HexRefine Standalone</title>');
  return output;
}

function toDataUrl(source) {
  return `data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`;
}

function standaloneSpecifier(fileName) {
  return `hexrefine/${fileName}`;
}

function rewriteModuleSpecifiers(source) {
  return source
    .replaceAll(/from "\.\/([^"]+\.js)"/g, (_match, fileName) => `from "${standaloneSpecifier(fileName)}"`)
    .replaceAll(/from '\.\/([^']+\.js)'/g, (_match, fileName) => `from "${standaloneSpecifier(fileName)}"`)
    .replaceAll(/import\("\.\/([^"]+\.js)"\)/g, (_match, fileName) => `import("${standaloneSpecifier(fileName)}")`)
    .replaceAll(/import\('\.\/([^']+\.js)'\)/g, (_match, fileName) => `import("${standaloneSpecifier(fileName)}")`);
}

function redirectHtml(target, title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="refresh" content="0; url=./${target}">
    <title>${title}</title>
  </head>
  <body>
    <p><a href="./${target}">Open ${title}</a></p>
  </body>
</html>
`;
}
