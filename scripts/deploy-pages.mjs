import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const releasePages = join(root, "release", "pages");
const worktreeDir = join(root, "release", "gh-pages-worktree");
const remote = readArg("--remote") ?? "origin";
const branch = readArg("--branch") ?? "gh-pages";
const shouldPush = process.argv.includes("--push");
const skipBuild = process.argv.includes("--skip-build");

if (!skipBuild) {
  run("npm", ["run", "pages:build"], { cwd: root });
}

await verifyPagesBundle();
await prepareWorktree();
await replaceWorktreeContents();
await writeFile(join(worktreeDir, ".nojekyll"), "", "utf8");

run("git", ["add", "-A"], { cwd: worktreeDir });
const status = git(["status", "--porcelain"], { cwd: worktreeDir }).trim();
if (!status) {
  console.log("GitHub Pages bundle is already up to date.");
} else {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  run("git", ["commit", "-m", `Deploy HexRefine pages ${timestamp}`], { cwd: worktreeDir });
  console.log(`Committed GitHub Pages bundle on ${branch}.`);
}

if (shouldPush) {
  run("git", ["push", remote, branch], { cwd: worktreeDir });
  console.log(`Pushed ${branch} to ${remote}.`);
} else {
  console.log("");
  console.log("Dry deploy complete. To push the prepared gh-pages branch, run:");
  console.log(`  git -C "${worktreeDir}" push ${remote} ${branch}`);
  console.log("");
  console.log("Or run the npm push shortcut:");
  console.log("  npm run pages:deploy:push");
}

console.log("");
console.log("Verify after GitHub Pages updates:");
console.log(`  https://hl-ren.github.io/HexRefine/examples/browser/refinement-gui.html?v=${Date.now()}`);

async function verifyPagesBundle() {
  const requiredFiles = [
    "index.html",
    ".nojekyll",
    join("examples", "browser", "refinement-gui.html"),
    join("examples", "browser", "hexrefine-standalone.html"),
    join("examples", "browser", "runtime-config.js")
  ];
  for (const file of requiredFiles) {
    const path = join(releasePages, file);
    if (!existsSync(path)) {
      throw new Error(`missing release/pages file: ${file}`);
    }
  }

  const guiHtml = await readFile(join(releasePages, "examples", "browser", "refinement-gui.html"), "utf8");
  const standaloneHtml = await readFile(join(releasePages, "examples", "browser", "hexrefine-standalone.html"), "utf8");
  const requiredMarkers = [
    "elementsToDelete = new Set",
    "const nextMesh ="
  ];
  for (const marker of requiredMarkers) {
    if (!guiHtml.includes(marker)) {
      throw new Error(`release/pages refinement-gui.html is missing marker: ${marker}`);
    }
    if (!standaloneHtml.includes(marker)) {
      throw new Error(`release/pages hexrefine-standalone.html is missing marker: ${marker}`);
    }
  }

  const runtimeConfig = await readFile(join(releasePages, "examples", "browser", "runtime-config.js"), "utf8");
  if (!runtimeConfig.includes('"appMode": "public"')) {
    throw new Error("release/pages runtime-config.js is not configured for public mode");
  }
}

async function prepareWorktree() {
  await mkdir(join(root, "release"), { recursive: true });
  if (existsSync(worktreeDir)) {
    run("git", ["worktree", "remove", "--force", worktreeDir], { cwd: root, allowFailure: true });
    await rm(worktreeDir, { recursive: true, force: true });
  }

  run("git", ["fetch", remote, branch], { cwd: root, allowFailure: true });
  const hasLocalBranch = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    cwd: root,
    allowFailure: true
  }).ok;
  const hasRemoteBranch = git(["show-ref", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`], {
    cwd: root,
    allowFailure: true
  }).ok;

  if (hasRemoteBranch) {
    run("git", ["worktree", "add", "-B", branch, worktreeDir, `${remote}/${branch}`], { cwd: root });
    return;
  }
  if (hasLocalBranch) {
    run("git", ["worktree", "add", worktreeDir, branch], { cwd: root });
    return;
  }

  run("git", ["worktree", "add", "--detach", worktreeDir, "HEAD"], { cwd: root });
  run("git", ["switch", "--orphan", branch], { cwd: worktreeDir });
}

async function replaceWorktreeContents() {
  const entries = await readdir(worktreeDir);
  await Promise.all(entries
    .filter((entry) => entry !== ".git")
    .map((entry) => rm(join(worktreeDir, entry), { recursive: true, force: true })));
  await cp(releasePages, worktreeDir, {
    recursive: true,
    filter: (source) => {
      const basename = source.split(/[/\\]/).at(-1) ?? "";
      return basename !== ".DS_Store" && !basename.startsWith("._");
    }
  });
}

function readArg(name) {
  const prefix = `${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

function git(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd ?? root,
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr || result.stdout}`);
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    trim() {
      return (result.stdout ?? "").trim();
    }
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}
