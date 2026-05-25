import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const appRoot = join(root, "release", "desktop-app");
const pagesRoot = join(root, "release", "pages");

await rm(appRoot, { recursive: true, force: true });
await mkdir(appRoot, { recursive: true });

await copyClean(join(root, "desktop", "main.cjs"), join(appRoot, "main.cjs"));
await copyClean(pagesRoot, join(appRoot, "web"));
await copyClean(join(root, "LICENSE"), join(appRoot, "LICENSE"));
await copyClean(join(root, "README.md"), join(appRoot, "README.md"));

await writeFile(join(appRoot, "package.json"), `${JSON.stringify({
  name: "hexrefine-desktop",
  productName: "HexRefine",
  version: packageJson.version,
  description: "Desktop wrapper for the HexRefine browser workbench.",
  private: true,
  type: "commonjs",
  main: "main.cjs",
  license: packageJson.license
}, null, 2)}\n`, "utf8");

console.log(`Prepared desktop app source: ${appRoot}`);

function copyClean(source, target) {
  return cp(source, target, {
    recursive: true,
    filter: (path) => !path.endsWith(".DS_Store")
  });
}
