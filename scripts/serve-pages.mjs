import { createReadStream, existsSync, statSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { runOfflineExportJob } from "./offline-export.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJsonPath = join(root, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const webRoot = join(root, "release", `${packageJson.name}-${packageJson.version}`, "web");
const offlineJobs = new Map();
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".d.ts", "text/plain; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".inp", "text/plain; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".vtk", "text/plain; charset=utf-8"]
]);

try {
  await access(webRoot);
} catch {
  console.error(`Web bundle not found: ${webRoot}`);
  console.error("Run \"npm run pages:build\" first.");
  process.exit(1);
}

const server = http.createServer((request, response) => {
  Promise.resolve(handleRequest(request, response)).catch((error) => {
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

server.listen(8080, "127.0.0.1", () => {
  console.log(`HexRefine pages server ready at http://127.0.0.1:8080`);
});

async function handleRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && requestUrl.pathname === "/examples/browser/runtime-config.js") {
    response.writeHead(200, {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "no-store"
    });
    response.end(`window.HEXREFINE_RUNTIME = ${JSON.stringify({
      appMode: "internal",
      guiElementLimit: null
    }, null, 2)};\nwindow.COMFORMHEX_RUNTIME = window.HEXREFINE_RUNTIME;\n`);
    return;
  }
  if (request.method === "POST" && requestUrl.pathname === "/api/offline-export") {
    await handleOfflineExportRequest(request, response);
    return;
  }
  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/offline-export/")) {
    handleOfflineDownloadRequest(requestUrl, response);
    return;
  }
  handleStaticRequest(requestUrl.pathname, response);
}

async function handleOfflineExportRequest(request, response) {
  const body = await readJsonBody(request);
  const script = body?.script;
  const scaleFactor = body?.scaleFactor;
  const jobId = randomUUID();
  const outputDir = join(tmpdir(), "hexrefine-offline-jobs", jobId);
  const job = await runOfflineExportJob(script, {
    scaleFactor,
    exportKind: body?.exportKind,
    outputDir,
    baseName: "hexrefine-offline",
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
        name: "hexrefine-offline.vtk",
        url: `/api/offline-export/${jobId}/hexrefine-offline.vtk`
      },
      ...(job.inpPath ? {
        inp: {
          name: "hexrefine-offline.inp",
          url: `/api/offline-export/${jobId}/hexrefine-offline.inp`
        }
      } : {}),
      job: {
        name: "hexrefine-offline-job.json",
        url: `/api/offline-export/${jobId}/hexrefine-offline-job.json`
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

  const filePath = fileName === "hexrefine-offline.vtk"
    ? job.vtkPath
    : fileName === "hexrefine-offline.inp"
      ? job.inpPath
      : fileName === "hexrefine-offline-job.json"
        ? job.jobPath
        : undefined;
  if (!filePath || !existsSync(filePath)) {
    writeJson(response, 404, { ok: false, error: "offline export artifact not found" });
    return;
  }

  response.writeHead(200, {
    "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store",
    "content-disposition": `attachment; filename="${fileName}"`
  });
  createReadStream(filePath).pipe(response);
}

function handleStaticRequest(pathname, response) {
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

  response.writeHead(200, {
    "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}

function normalizeRequestPath(pathname) {
  if (pathname === "/" || pathname === "") {
    return "index.html";
  }
  return pathname.replace(/^\/+/, "");
}

function resolveStaticPath(rootDir, requestPath) {
  const rootPath = resolve(rootDir);
  const candidate = resolve(rootDir, requestPath);
  if (!candidate.startsWith(rootPath + sep) && candidate !== rootPath) {
    return undefined;
  }
  if (!existsSync(candidate)) {
    return undefined;
  }
  const stat = statSync(candidate);
  if (stat.isDirectory()) {
    const indexPath = join(candidate, "index.html");
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
