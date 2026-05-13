import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const desktopRoot = join(root, "release", "desktop");
const appDir = join(desktopRoot, "ComformHex-win32-x64");
const zipPath = join(desktopRoot, "ComformHex-win32-x64.zip");

await rm(zipPath, { force: true });
await execFileAsync("zip", ["-qr", zipPath, "ComformHex-win32-x64"], {
  cwd: desktopRoot
});

console.log(`Prepared Windows desktop app: ${appDir}`);
console.log(`Prepared Windows desktop zip: ${zipPath}`);
