import { access, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const desktopRoot = join(root, "release", "desktop");
const archs = parseArchs(process.env.DESKTOP_MAC_ARCHS ?? "arm64,x64");

for (const arch of archs) {
  const appDir = join(desktopRoot, `ComformHex-darwin-${arch}`);
  const appBundle = join(appDir, "ComformHex.app");
  const zipPath = join(desktopRoot, `ComformHex-darwin-${arch}.zip`);

  await access(appBundle);
  await rm(zipPath, { force: true });
  await run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", "ComformHex.app", zipPath], appDir);

  console.log(`Prepared macOS ${arch} desktop app: ${appBundle}`);
  console.log(`Prepared macOS ${arch} desktop zip: ${zipPath}`);
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

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
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
