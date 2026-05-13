import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packageJsonPath = join(root, "package.json");
const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
const releaseName = `${packageJson.name}-${packageJson.version}`;
const releaseRoot = join(root, "release");
const outputRoot = join(releaseRoot, releaseName);
const webRoot = join(outputRoot, "web");
const pagesRoot = join(releaseRoot, "pages");

await mkdir(releaseRoot, { recursive: true });
await rm(outputRoot, { recursive: true, force: true });
await rm(pagesRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const copyEntries = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "RELEASE.md",
  "package.json",
  "tsconfig.json",
  "tsconfig.build.json",
  "dist",
  "src",
  "docs",
  "examples",
  "test"
];

for (const entry of copyEntries) {
  await copyClean(join(root, entry), join(outputRoot, entry));
}

await mkdir(webRoot, { recursive: true });
await copyClean(join(root, "dist"), join(webRoot, "dist"));
await copyClean(join(root, "docs"), join(webRoot, "docs"));
await copyClean(join(root, "examples", "browser"), join(webRoot, "examples", "browser"));
await copyClean(join(root, "examples", "output"), join(webRoot, "examples", "output"));
await copyClean(join(root, "README.md"), join(webRoot, "README.md"));
await copyClean(join(root, "LICENSE"), join(webRoot, "LICENSE"));

await writeFile(join(webRoot, "index.html"), webIndexHtml(), "utf8");
await writeFile(join(webRoot, ".nojekyll"), "", "utf8");
await writeFile(join(webRoot, "examples", "browser", "runtime-config.js"), browserRuntimeConfig("public", 500000), "utf8");

const manifest = {
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  license: packageJson.license,
  generatedAt: new Date().toISOString(),
  entrypoints: {
    module: "dist/index.js",
    types: "dist/index.d.ts",
    browser: "web/index.html",
    workbench: "web/examples/browser/comformhex.html"
  },
  commands: {
    test: "npm test",
    build: "npm run build",
    examples: "npm run examples:vtk"
  }
};

await writeFile(join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(join(webRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await copyClean(webRoot, pagesRoot);
await writeFile(join(pagesRoot, "examples", "browser", "runtime-config.js"), browserRuntimeConfig("public", 500000), "utf8");

console.log(`Prepared release folder: ${outputRoot}`);
console.log(`Prepared static web bundle: ${webRoot}`);
console.log(`Prepared GitHub Pages bundle: ${pagesRoot}`);

function webIndexHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="0; url=./examples/browser/comformhex.html">
    <title>ComformHex</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0c0f12;
        color: #edf3f6;
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      a {
        color: #37d2bf;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>ComformHex</h1>
      <p><a href="./examples/browser/comformhex.html">Open the browser workbench</a></p>
    </main>
  </body>
</html>
`;
}

function browserRuntimeConfig(appMode, guiElementLimit) {
  return `window.COMFORMHEX_RUNTIME = ${JSON.stringify({
    appMode,
    guiElementLimit
  }, null, 2)};\n`;
}

function copyClean(source, target) {
  return cp(source, target, {
    recursive: true,
    filter: (path) => {
      const basename = path.split(/[/\\]/).at(-1) ?? "";
      return basename !== ".DS_Store" && !basename.startsWith("._");
    }
  });
}
