import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const electronPackage = await import("../node_modules/electron/package.json", {
  with: { type: "json" }
});

const electronVersion = electronPackage.default.version;
const zipDir = join(root, "release", "electron-zips");
const mirror = normalizeMirror(process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/");
const archs = parseArchs(process.env.DESKTOP_MAC_ARCHS ?? "arm64,x64");

await mkdir(zipDir, { recursive: true });

for (const arch of archs) {
  const zipName = `electron-v${electronVersion}-darwin-${arch}.zip`;
  const zipPath = join(zipDir, zipName);
  const downloadUrl = `${mirror}${electronVersion}/${zipName}`;

  if (!(await hasUsableZip(zipPath))) {
    console.log(`Downloading Electron macOS ${arch} runtime: ${downloadUrl}`);
    await run("curl", ["-L", "--fail", "--progress-bar", downloadUrl, "-o", zipPath]);
  } else {
    console.log(`Using cached Electron macOS ${arch} runtime: ${zipPath}`);
  }

  await run(join(root, "node_modules", ".bin", "electron-packager"), [
    "release/desktop-app",
    "ComformHex",
    "--platform=darwin",
    `--arch=${arch}`,
    "--out=release/desktop",
    "--overwrite",
    "--asar",
    "--app-bundle-id=org.comformhex.app",
    `--electron-version=${electronVersion}`,
    `--electron-zip-dir=${zipDir}`
  ]);
}

function normalizeMirror(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function parseArchs(value) {
  const archs = value.split(",").map((arch) => arch.trim()).filter(Boolean);
  const supported = new Set(["arm64", "x64"]);
  for (const arch of archs) {
    if (!supported.has(arch)) {
      throw new Error(`Unsupported macOS desktop architecture: ${arch}`);
    }
  }
  return archs.length > 0 ? archs : ["arm64"];
}

async function hasUsableZip(path) {
  try {
    const info = await stat(path);
    return info.size > 100 * 1024 * 1024;
  } catch {
    return false;
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} failed with ${signal ?? `exit code ${code}`}`));
      }
    });
  });
}
