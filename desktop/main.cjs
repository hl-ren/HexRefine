const { app, BrowserWindow, dialog, shell } = require("electron");
const { randomUUID } = require("node:crypto");
const { createReadStream, createWriteStream, existsSync, statSync } = require("node:fs");
const { once } = require("node:events");
const http = require("node:http");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".d.ts", "text/plain; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".vtk", "text/plain; charset=utf-8"]
]);

let server;
let serverUrl;
const offlineJobs = new Map();

app.setName("ComformHex");

app.whenReady().then(async () => {
  try {
    serverUrl = await startStaticServer();
    createWindow(serverUrl);
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "ComformHex failed to start",
      message: error instanceof Error ? error.message : String(error)
    });
    app.quit();
  }
});

app.on("window-all-closed", () => {
  if (server) {
    server.close();
    server = undefined;
  }
  app.quit();
});

function createWindow(url) {
  const window = new BrowserWindow({
    width: 1420,
    height: 940,
    minWidth: 980,
    minHeight: 680,
    title: "ComformHex",
    backgroundColor: "#0c0f12",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  window.removeMenu();
  window.loadURL(url);

  window.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
}

function startStaticServer() {
  const webRoot = path.join(__dirname, "web");
  if (!existsSync(path.join(webRoot, "index.html"))) {
    throw new Error(`missing desktop web bundle at ${webRoot}`);
  }

  server = http.createServer((request, response) => {
    Promise.resolve(handleDesktopRequest(request, response, webRoot)).catch((error) => {
      response.writeHead(500, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      response.end(JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to bind local desktop server"));
        return;
      }
      resolve(`http://127.0.0.1:${address.port}/`);
    });
  });
}

async function handleDesktopRequest(request, response, webRoot) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "POST" && requestUrl.pathname === "/api/offline-export") {
    await handleOfflineExportRequest(request, response);
    return;
  }
  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/offline-export/")) {
    handleOfflineDownloadRequest(requestUrl, response);
    return;
  }

  const pathname = decodeURIComponent(requestUrl.pathname);
  const safePath = normalizeRequestPath(pathname);
  const filePath = resolveStaticPath(webRoot, safePath);

  if (!filePath) {
    if (pathname.startsWith("/api/")) {
      writeJson(response, 404, { ok: false, error: `Unknown API route: ${pathname}` });
      return;
    }
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath);
  response.writeHead(200, {
    "content-type": mimeTypes.get(extension) ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}

async function handleOfflineExportRequest(request, response) {
  const body = await readJsonBody(request);
  const jobId = randomUUID();
  const outputDir = path.join(tmpdir(), "comformhex-offline-jobs", jobId);
  const job = await runOfflineExportJobDesktop(body?.script, {
    scaleFactor: body?.scaleFactor,
    exportKind: body?.exportKind,
    outputDir,
    baseName: "comformhex-offline",
    includeInp: body?.includeInp === true
  });
  offlineJobs.set(jobId, {
    vtkPath: job.vtkPath,
    inpPath: job.inpPath,
    jobPath: job.jobPath
  });
  writeJson(response, 200, {
    ok: true,
    jobId,
    summary: job.manifest,
    files: {
      vtk: {
        name: "comformhex-offline.vtk",
        url: `/api/offline-export/${jobId}/comformhex-offline.vtk`
      },
      ...(job.inpPath ? {
        inp: {
          name: "comformhex-offline.inp",
          url: `/api/offline-export/${jobId}/comformhex-offline.inp`
        }
      } : {}),
      job: {
        name: "comformhex-offline-job.json",
        url: `/api/offline-export/${jobId}/comformhex-offline-job.json`
      }
    }
  });
}

function handleOfflineDownloadRequest(requestUrl, response) {
  const [, , , jobId, fileName] = requestUrl.pathname.split("/");
  if (!jobId || !fileName) {
    writeJson(response, 404, { ok: false, error: "offline export file not found" });
    return;
  }
  const job = offlineJobs.get(jobId);
  if (!job) {
    writeJson(response, 404, { ok: false, error: "offline export job expired or missing" });
    return;
  }
  const filePath = fileName === "comformhex-offline.vtk"
    ? job.vtkPath
    : fileName === "comformhex-offline.inp"
      ? job.inpPath
      : fileName === "comformhex-offline-job.json"
        ? job.jobPath
        : undefined;
  if (!filePath || !existsSync(filePath)) {
    writeJson(response, 404, { ok: false, error: "offline export artifact not found" });
    return;
  }
  response.writeHead(200, {
    "content-type": mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${fileName}"`
  });
  createReadStream(filePath).pipe(response);
}

function normalizeRequestPath(pathname) {
  if (pathname === "/" || pathname === "") {
    return "index.html";
  }
  return pathname.replace(/^\/+/, "");
}

function resolveStaticPath(root, requestPath) {
  const candidate = path.resolve(root, requestPath);
  if (!candidate.startsWith(path.resolve(root) + path.sep) && candidate !== path.resolve(root)) {
    return undefined;
  }
  if (!existsSync(candidate)) {
    return undefined;
  }
  const stat = statSync(candidate);
  if (stat.isDirectory()) {
    const indexPath = path.join(candidate, "index.html");
    return existsSync(indexPath) ? indexPath : undefined;
  }
  return stat.isFile() ? candidate : undefined;
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  return text ? JSON.parse(text) : {};
}

async function runOfflineExportJobDesktop(script, options = {}) {
  if (!script || !Array.isArray(script.commands)) {
    throw new Error("offline export requires a command script with a commands array");
  }

  const api = await import(pathToFileURL(path.join(__dirname, "web", "dist", "index.js")).href);
  const includeInp = options.includeInp === true;
  const scaleFactor = normalizeScaleFactor(options.scaleFactor ?? 1.2);
  const gridPlan = buildOfflineGridPlan(script, scaleFactor);
  const replay = api.replayComformHexCommandScript(script, {
    strict: false,
    selectionStrategy: "replay",
    ...(gridPlan.gridOverride ? { gridOverride: gridPlan.gridOverride } : {})
  });
  const exported = api.buildRefinementSessionExport(replay.session, {
    mergeNodes: true,
    ...(replay.mergeTolerance !== undefined ? { mergeTolerance: replay.mergeTolerance } : {}),
    sets: {
      cellSets: replay.cellSets,
      nodeSets: replay.nodeSets
    }
  });
  const prepared = api.prepareExportMesh(exported, options.exportKind);
  const inpText = includeInp
    ? api.preparedExportToInp(prepared, {
        title: "ComformHex offline export",
        materials: replay.cellSetMaterials
      })
    : undefined;
  const missing = api.missingSetSummary(prepared.sets);
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

  const fsPromises = await import("node:fs/promises");
  await fsPromises.mkdir(options.outputDir, { recursive: true });
  const vtkPath = path.join(options.outputDir, "comformhex-offline.vtk");
  const inpPath = includeInp ? path.join(options.outputDir, "comformhex-offline.inp") : undefined;
  const jobPath = path.join(options.outputDir, "comformhex-offline-job.json");
  await writeLinesToFileDesktop(
    vtkPath,
    api.iterateLegacyVtkLines(prepared.mesh, { title: "ComformHex offline export" })
  );
  if (inpPath && inpText !== undefined) {
    await fsPromises.writeFile(inpPath, inpText, "utf8");
  }
  await fsPromises.writeFile(jobPath, `${JSON.stringify({
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

async function writeLinesToFileDesktop(filePath, lines) {
  const stream = createWriteStream(filePath, { encoding: "utf8" });
  const finished = new Promise((resolve, reject) => {
    stream.once("finish", resolve);
    stream.once("error", reject);
  });
  try {
    for (const line of lines) {
      if (!stream.write(`${line}\n`)) {
        await waitForDrainDesktop(stream);
      }
    }
    stream.end();
    await finished;
  } catch (error) {
    stream.destroy(error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
}

async function waitForDrainDesktop(stream) {
  await Promise.race([
    once(stream, "drain"),
    once(stream, "error").then(([error]) => Promise.reject(error))
  ]);
}

function buildOfflineGridPlan(script, scaleFactor) {
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
    baseGrid: { kind, nx: baseNx, ny: baseNy, nz: baseNz, bounds, targetDx: baseTargetDx },
    scaledGrid: {
      kind,
      nx: scaledNx,
      ny: scaledNy,
      nz: scaledNz,
      bounds,
      targetDx: baseTargetDx !== undefined ? baseTargetDx / scaleFactor : undefined
    },
    gridOverride: { kind, nx: scaledNx, ny: scaledNy, nz: scaledNz, bounds }
  };
}

function normalizeScaleFactor(value) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`invalid offline scale factor: ${value}`);
  }
  return number;
}

function readPositiveInteger(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function readOptionalPositiveNumber(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function scaleCount(count, factor) {
  return Math.max(1, Math.ceil(count * factor - 1e-9));
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
  return { min: normalizedMin, max: normalizedMax };
}

function toPoint3(value) {
  return [
    Number(value[0]) || 0,
    Number(value[1]) || 0,
    Number(value[2]) || 0
  ];
}
