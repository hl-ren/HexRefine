import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { join } from "node:path";

import {
  buildNativeSessionExportPlan,
  buildRefinementSessionExport,
  iterateLegacyVtkLines,
  iterateNativeSessionInpLines,
  iterateNativeSessionVtkLines,
  iteratePreparedInpLines,
  meshToLegacyVtk,
  missingSetSummary,
  prepareExportMesh,
  preparedExportToInp,
  replayComformHexCommandScript
} from "../dist/index.js";

export async function runOfflineExportJob(script, options = {}) {
  if (!script || !Array.isArray(script.commands)) {
    throw new Error("offline export requires a command script with a commands array");
  }

  const includeInp = options.includeInp === true;
  const scaleFactor = normalizeScaleFactor(options.scaleFactor ?? 1.2);
  const gridPlan = buildOfflineGridPlan(script, scaleFactor);
  const replay = replayComformHexCommandScript(script, {
    strict: false,
    selectionStrategy: "replay",
    ...(gridPlan.gridOverride ? { gridOverride: gridPlan.gridOverride } : {})
  });
  const nativeExport = shouldUseNativeSessionExport(replay.session.kind, options.exportKind);
  if (nativeExport) {
    return runNativeOfflineExport(script, options, replay, gridPlan, scaleFactor, includeInp);
  }
  const exported = buildRefinementSessionExport(replay.session, {
    mergeNodes: true,
    ...(replay.mergeTolerance !== undefined ? { mergeTolerance: replay.mergeTolerance } : {}),
    sets: {
      cellSets: replay.cellSets,
      nodeSets: replay.nodeSets
    }
  });
  const prepared = prepareExportMesh(exported, options.exportKind);
  const inpOptions = {
    title: "ComformHex offline export",
    materials: replay.cellSetMaterials
  };
  const inpText = !options.outputDir && includeInp
    ? preparedExportToInp(prepared, inpOptions)
    : undefined;
  const missing = missingSetSummary(prepared.sets);
  const manifest = {
    scaleFactor,
    replayedCommandCount: replay.replayedCommandCount,
    warnings: [...gridPlan.warnings, ...replay.warnings],
    selectionDiagnostics: replay.selectionDiagnostics,
    includeInp,
    exportKind: prepared.mesh.kind,
    baseGrid: gridPlan.baseGrid,
    scaledGrid: gridPlan.scaledGrid,
    mergeTolerance: replay.mergeTolerance,
    output: {
      kind: prepared.mesh.kind ?? "unknown",
      nodeCount: prepared.mesh.nodes.length,
      elementCount: prepared.mesh.elements.length,
      cellSetCount: replay.cellSets.size,
      nodeSetCount: replay.nodeSets.size,
      missingCellSetEntries: missing.missingCells,
      missingNodeSetEntries: missing.missingNodes
    }
  };

  if (!options.outputDir) {
    const vtkText = meshToLegacyVtk(prepared.mesh, {
      title: "ComformHex offline export"
    });
    return {
      manifest,
      vtkText,
      ...(inpText !== undefined ? { inpText } : {})
    };
  }

  const baseName = sanitizeBaseName(options.baseName ?? "comformhex-offline");
  await mkdir(options.outputDir, { recursive: true });
  const vtkPath = join(options.outputDir, `${baseName}.vtk`);
  const inpPath = includeInp ? join(options.outputDir, `${baseName}.inp`) : undefined;
  const jobPath = join(options.outputDir, `${baseName}-job.json`);
  await writeLinesToFile(
    vtkPath,
    iterateLegacyVtkLines(prepared.mesh, { title: "ComformHex offline export" })
  );
  if (inpPath) {
    await writeLinesToFile(inpPath, iteratePreparedInpLines(prepared, inpOptions));
  }
  await writeFile(jobPath, `${JSON.stringify({
    ...manifest,
    commandScript: script
  }, null, 2)}\n`, "utf8");

  return {
    manifest,
    vtkPath,
    ...(inpPath ? { inpPath } : {}),
    jobPath
  };
}

async function runNativeOfflineExport(script, options, replay, gridPlan, scaleFactor, includeInp) {
  const plan = buildNativeSessionExportPlan(replay.session, {
    ...(replay.mergeTolerance !== undefined ? { mergeTolerance: replay.mergeTolerance } : {}),
    sets: {
      cellSets: replay.cellSets,
      nodeSets: replay.nodeSets
    }
  });
  const inpOptions = {
    title: "ComformHex offline export",
    materials: replay.cellSetMaterials
  };
  const missing = missingSetSummary(plan.sets);
  const manifest = {
    scaleFactor,
    replayedCommandCount: replay.replayedCommandCount,
    warnings: [...gridPlan.warnings, ...replay.warnings],
    selectionDiagnostics: replay.selectionDiagnostics,
    includeInp,
    exportKind: plan.kind,
    exportMode: "native-session-stream",
    baseGrid: gridPlan.baseGrid,
    scaledGrid: gridPlan.scaledGrid,
    mergeTolerance: replay.mergeTolerance,
    output: {
      kind: plan.kind,
      nodeCount: plan.nodes.length,
      elementCount: plan.activeCellIds.length,
      cellSetCount: replay.cellSets.size,
      nodeSetCount: replay.nodeSets.size,
      missingCellSetEntries: missing.missingCells,
      missingNodeSetEntries: missing.missingNodes
    }
  };

  if (!options.outputDir) {
    const vtkText = `${[...iterateNativeSessionVtkLines(plan, { title: "ComformHex offline export" })].join("\n")}\n`;
    const inpText = includeInp
      ? `${[...iterateNativeSessionInpLines(plan, inpOptions)].join("\n")}\n`
      : undefined;
    return {
      manifest,
      vtkText,
      ...(inpText !== undefined ? { inpText } : {})
    };
  }

  const baseName = sanitizeBaseName(options.baseName ?? "comformhex-offline");
  await mkdir(options.outputDir, { recursive: true });
  const vtkPath = join(options.outputDir, `${baseName}.vtk`);
  const inpPath = includeInp ? join(options.outputDir, `${baseName}.inp`) : undefined;
  const jobPath = join(options.outputDir, `${baseName}-job.json`);
  await writeLinesToFile(vtkPath, iterateNativeSessionVtkLines(plan, { title: "ComformHex offline export" }));
  if (inpPath) {
    await writeLinesToFile(inpPath, iterateNativeSessionInpLines(plan, inpOptions));
  }
  await writeFile(jobPath, `${JSON.stringify({
    ...manifest,
    commandScript: script
  }, null, 2)}\n`, "utf8");
  return {
    manifest,
    vtkPath,
    ...(inpPath ? { inpPath } : {}),
    jobPath
  };
}

function shouldUseNativeSessionExport(sessionKind, exportKind) {
  if (!exportKind || exportKind === "native") {
    return true;
  }
  return sessionKind === "Q1"
    ? exportKind === "Q1" || exportKind === "Q4"
    : exportKind === "H1" || exportKind === "H8";
}

async function writeLinesToFile(filePath, lines) {
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  const finished = new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });
  try {
    for (const line of lines) {
      if (!stream.write(`${line}\n`)) {
        await waitForDrain(stream);
      }
    }
    stream.end();
    await finished;
  } catch (error) {
    stream.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function waitForDrain(stream) {
  await Promise.race([
    once(stream, "drain"),
    once(stream, "error").then(([error]) => Promise.reject(error))
  ]);
}

export function buildOfflineGridPlan(script, scaleFactor) {
  const initialGridCommand = script.commands.find((command) =>
    command?.kind === "grid.generate" || command?.kind === "grid.import"
  );
  if (!initialGridCommand) {
    return {
      warnings: ["offline export could not find the initial grid command; using recorded script as-is."],
      baseGrid: null,
      scaledGrid: null,
      gridOverride: undefined
    };
  }

  if (initialGridCommand.kind === "grid.import") {
    return {
      warnings: ["offline export kept the imported starting mesh as-is because nx/ny/nz scaling only applies to generated grids."],
      baseGrid: { kind: "import" },
      scaledGrid: { kind: "import" },
      gridOverride: undefined
    };
  }

  const payload = initialGridCommand.payload ?? {};
  const kind = payload.kind === "Q1" ? "Q1" : "H1";
  const baseNx = readPositiveInteger(payload.nx, 1);
  const baseNy = readPositiveInteger(payload.ny, 1);
  const baseNz = kind === "Q1" ? 1 : readPositiveInteger(payload.nz, 1);
  const bounds = normalizeBounds(payload.bounds, kind);
  const baseTargetDx = readOptionalPositiveNumber(payload.targetDx);
  const scaledNx = scaleCount(baseNx, scaleFactor);
  const scaledNy = scaleCount(baseNy, scaleFactor);
  const scaledNz = kind === "Q1" ? 1 : scaleCount(baseNz, scaleFactor);

  return {
    warnings: [],
    baseGrid: {
      kind,
      nx: baseNx,
      ny: baseNy,
      nz: baseNz,
      bounds,
      targetDx: baseTargetDx
    },
    scaledGrid: {
      kind,
      nx: scaledNx,
      ny: scaledNy,
      nz: scaledNz,
      bounds,
      targetDx: baseTargetDx !== undefined ? baseTargetDx / scaleFactor : undefined
    },
    gridOverride: {
      kind,
      nx: scaledNx,
      ny: scaledNy,
      nz: scaledNz,
      bounds
    }
  };
}

function normalizeScaleFactor(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`invalid offline scale factor: ${value}`);
  }
  return number;
}

function scaleCount(count, factor) {
  return Math.max(1, Math.ceil(count * factor - 1e-9));
}

function readPositiveInteger(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function readOptionalPositiveNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function normalizeBounds(value, kind) {
  const source = value && typeof value === "object" ? value : {};
  const min = toPoint3(Array.isArray(source.min) ? source.min : [0, 0, 0]);
  const max = toPoint3(Array.isArray(source.max) ? source.max : (kind === "Q1" ? [1, 1, 0] : [1, 1, 1]));
  const normalizedMin = [
    Math.min(min[0], max[0]),
    Math.min(min[1], max[1]),
    Math.min(min[2], max[2])
  ];
  const normalizedMax = [
    Math.max(min[0], max[0]),
    Math.max(min[1], max[1]),
    Math.max(min[2], max[2])
  ];
  if (kind === "Q1") {
    normalizedMin[2] = 0;
    normalizedMax[2] = 0;
  }
  return {
    min: normalizedMin,
    max: normalizedMax
  };
}

function toPoint3(value) {
  return [
    Number(value[0]) || 0,
    Number(value[1]) || 0,
    Number(value[2]) || 0
  ];
}

function sanitizeBaseName(value) {
  const clean = String(value || "").trim().replace(/[^A-Za-z0-9._-]/g, "-");
  return clean || "comformhex-offline";
}
