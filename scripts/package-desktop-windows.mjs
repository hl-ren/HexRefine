import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const electronPackage = await import("../node_modules/electron/package.json", {
  with: { type: "json" }
});

const electronVersion = electronPackage.default.version;
const zipName = `electron-v${electronVersion}-win32-x64.zip`;
const zipDir = join(root, "release", "electron-zips");
const zipPath = join(zipDir, zipName);
const mirror = normalizeMirror(process.env.ELECTRON_MIRROR ?? "https://npmmirror.com/mirrors/electron/");
const downloadUrl = `${mirror}${electronVersion}/${zipName}`;

await mkdir(zipDir, { recursive: true });

if (!(await hasUsableZip(zipPath))) {
  console.log(`Downloading Electron Windows runtime: ${downloadUrl}`);
  await execFileAsync("curl", ["-L", "--fail", "--progress-bar", downloadUrl, "-o", zipPath], {
    cwd: root,
    maxBuffer: 1024 * 1024
  });
} else {
  console.log(`Using cached Electron Windows runtime: ${zipPath}`);
}

await execFileAsync(
  join(root, "node_modules", ".bin", "electron-packager"),
  [
    "release/desktop-app",
    "ComformHex",
    "--platform=win32",
    "--arch=x64",
    "--out=release/desktop",
    "--overwrite",
    "--asar",
    `--electron-version=${electronVersion}`,
    `--electron-zip-dir=${zipDir}`
  ],
  {
    cwd: root,
    stdio: "inherit"
  }
);

function normalizeMirror(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

async function hasUsableZip(path) {
  try {
    const info = await stat(path);
    return info.size > 100 * 1024 * 1024;
  } catch {
    return false;
  }
}
