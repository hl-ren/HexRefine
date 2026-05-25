import fs from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { offlineMemoryPlan } from "./offline-memory.mjs";

import {
  buildNativeSessionExportPlan,
  iterateNativeSessionInpLines,
  iterateNativeSessionVtkLines,
  missingSetSummary,
  replayHexRefineCommandScript
} from "../dist/index.js";

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }

  const options = parseArgs(args);
  if (!options.scriptPath) {
    printUsage();
    throw new Error("missing command script path");
  }

  const scriptPath = path.resolve(options.scriptPath);
  const outputVtkPath = options.vtkPath ? path.resolve(options.vtkPath) : undefined;
  const outputInpPath = options.inpPath ? path.resolve(options.inpPath) : undefined;
  const raw = await fs.readFile(scriptPath, "utf8");
  const script = JSON.parse(raw);
  const memoryPlan = offlineMemoryPlan({
    requestedMb: process.env.HEXREFINE_OFFLINE_HEAP_MB ?? process.env.COMFORMHEX_OFFLINE_HEAP_MB
  });

  const replay = replayHexRefineCommandScript(script, {
    strict: options.strict,
    selectionStrategy: options.selectionStrategy,
    ...(options.gridOverride ? { gridOverride: options.gridOverride } : {})
  });

  const nativePlan = buildNativeSessionExportPlan(replay.session, {
    ...(replay.mergeTolerance !== undefined ? { mergeTolerance: replay.mergeTolerance } : {}),
    sets: {
      cellSets: replay.cellSets,
      nodeSets: replay.nodeSets
    }
  });

  if (outputVtkPath) {
    await fs.mkdir(path.dirname(outputVtkPath), { recursive: true });
    await writeLinesToFile(outputVtkPath, iterateNativeSessionVtkLines(nativePlan, {
      title: "HexRefine offline replay export"
    }));
  }

  if (outputInpPath) {
    await fs.mkdir(path.dirname(outputInpPath), { recursive: true });
    await writeLinesToFile(outputInpPath, iterateNativeSessionInpLines(nativePlan, {
      title: "HexRefine offline replay export",
      materials: replay.cellSetMaterials
    }));
  }

  const nativeMissing = missingSetSummary(nativePlan.sets);
  const summary = {
    script: scriptPath,
    selectionStrategy: options.selectionStrategy,
    replayedCommandCount: replay.replayedCommandCount,
    exportMode: "native-session-stream",
    meshKind: nativePlan.kind,
    outputNodeCount: nativePlan.nodes.length,
    outputElementCount: nativePlan.activeCellIds.length,
    cellSetCount: replay.cellSets.size,
    nodeSetCount: replay.nodeSets.size,
    missingCellSetEntries: nativeMissing.missingCells,
    missingNodeSetEntries: nativeMissing.missingNodes,
    warnings: replay.warnings,
    memory: {
      systemMb: memoryPlan.totalMb,
      freeMb: memoryPlan.freeMb,
      maxOldSpaceMb: memoryPlan.currentHeapLimitMb,
      requestedMaxOldSpaceMb: memoryPlan.maxOldSpaceMb,
      source: process.env.HEXREFINE_OFFLINE_MEMORY_SOURCE ?? process.env.COMFORMHEX_OFFLINE_MEMORY_SOURCE ?? memoryPlan.source
    },
    outputs: {
      ...(outputVtkPath ? { vtk: outputVtkPath } : {}),
      ...(outputInpPath ? { inp: outputInpPath } : {})
    }
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return;

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

function parseArgs(args) {
  const options = parseEnvOptions();
  const allowNpmPassthroughValues = hasNpmConfigOverrides();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    switch (value) {
      case "--vtk":
        options.vtkPath = requireValue(args, ++index, value);
        break;
      case "--inp":
        options.inpPath = requireValue(args, ++index, value);
        break;
      case "--nx":
        options.gridOverride = { ...(options.gridOverride ?? {}), nx: parsePositiveInteger(requireValue(args, ++index, value), value) };
        break;
      case "--ny":
        options.gridOverride = { ...(options.gridOverride ?? {}), ny: parsePositiveInteger(requireValue(args, ++index, value), value) };
        break;
      case "--nz":
        options.gridOverride = { ...(options.gridOverride ?? {}), nz: parsePositiveInteger(requireValue(args, ++index, value), value) };
        break;
      case "--kind": {
        const kind = requireValue(args, ++index, value);
        if (kind !== "Q1" && kind !== "H1") {
          throw new Error(`invalid ${value} value: ${kind}`);
        }
        options.gridOverride = { ...(options.gridOverride ?? {}), kind };
        break;
      }
      case "--bounds":
        options.gridOverride = { ...(options.gridOverride ?? {}), bounds: parseBounds(requireValue(args, ++index, value)) };
        break;
      case "--selection":
        options.selectionStrategy = parseSelectionStrategy(requireValue(args, ++index, value));
        break;
      case "--strict":
        options.strict = true;
        break;
      default:
        if (value.startsWith("--")) {
          throw new Error(`unknown option: ${value}`);
        }
        if (!options.scriptPath) {
          options.scriptPath = value;
        } else if (!allowNpmPassthroughValues) {
          throw new Error(`unexpected positional argument: ${value}`);
        } else if (options.vtkPath === "true") {
          options.vtkPath = value;
        } else if (options.inpPath === "true") {
          options.inpPath = value;
        }
        break;
    }
  }

  return options;
}

function parseEnvOptions() {
  const gridOverride = {};
  const nx = process.env.npm_config_nx;
  const ny = process.env.npm_config_ny;
  const nz = process.env.npm_config_nz;
  const kind = process.env.npm_config_kind;
  const bounds = process.env.npm_config_bounds;
  if (nx) {
    gridOverride.nx = parsePositiveInteger(nx, "npm_config_nx");
  }
  if (ny) {
    gridOverride.ny = parsePositiveInteger(ny, "npm_config_ny");
  }
  if (nz) {
    gridOverride.nz = parsePositiveInteger(nz, "npm_config_nz");
  }
  if (kind) {
    if (kind !== "Q1" && kind !== "H1") {
      throw new Error(`invalid npm_config_kind value: ${kind}`);
    }
    gridOverride.kind = kind;
  }
  if (bounds) {
    gridOverride.bounds = parseBounds(bounds);
  }

  return {
    scriptPath: undefined,
    vtkPath: process.env.npm_config_vtk,
    inpPath: process.env.npm_config_inp,
    strict: process.env.npm_config_strict === "true",
    selectionStrategy: process.env.npm_config_selection ? parseSelectionStrategy(process.env.npm_config_selection) : "replay",
    gridOverride: Object.keys(gridOverride).length > 0 ? gridOverride : undefined
  };
}

function hasNpmConfigOverrides() {
  return [
    "npm_config_nx",
    "npm_config_ny",
    "npm_config_nz",
    "npm_config_kind",
    "npm_config_bounds",
    "npm_config_selection",
    "npm_config_vtk",
    "npm_config_inp",
    "npm_config_strict"
  ].some((key) => key in process.env);
}

function requireValue(args, index, flag) {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing value for ${flag}`);
  }
  return value;
}

function parsePositiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`invalid ${flag} value: ${value}`);
  }
  return parsed;
}

function parseSelectionStrategy(value) {
  if (value !== "recorded" && value !== "replay") {
    throw new Error(`invalid --selection value: ${value}`);
  }
  return value;
}

function parseBounds(value) {
  const [minText, maxText] = value.split(":");
  if (!minText || !maxText) {
    throw new Error(`invalid --bounds value: ${value}`);
  }
  return {
    min: parsePoint(minText),
    max: parsePoint(maxText)
  };
}

function parsePoint(text) {
  const parts = text.split(",").map((item) => Number(item.trim()));
  if (parts.length < 2 || parts.length > 3 || parts.some((item) => !Number.isFinite(item))) {
    throw new Error(`invalid point value: ${text}`);
  }
  return parts;
}

function printUsage() {
  process.stdout.write([
    "Usage:",
    "  node scripts/run-offline-auto.mjs <script.json> [--nx N] [--ny N] [--nz N] [--kind H1|Q1]",
    "    [--bounds minx,miny,minz:maxx,maxy,maxz] [--selection replay|recorded]",
    "    [--vtk output.vtk] [--inp output.inp] [--strict]",
    "",
    "Typical flow:",
    "  1. Use the GUI to record and export a command script on a coarse grid.",
    "  2. Replay the script offline with larger nx/ny/nz using --selection replay.",
    "  3. Export VTK or INP without loading the dense case in the browser.",
    "",
    "Memory:",
    "  run-offline-auto.mjs auto-selects Node --max-old-space-size from system RAM.",
    "  Override with HEXREFINE_OFFLINE_MAX_OLD_SPACE_MB=49152 or 48g if needed."
  ].join("\n"));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
