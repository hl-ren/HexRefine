import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { formatMemoryPlan, offlineMemoryPlan } from "./offline-memory.mjs";

const scriptPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-offline-workflow.mjs");

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--heap-info")) {
    process.stdout.write(`${JSON.stringify(offlineMemoryPlan(), null, 2)}\n`);
    return;
  }
  const plan = offlineMemoryPlan();
  process.stderr.write(`[ComformHex offline] memory plan: ${formatMemoryPlan(plan)}\n`);

  const nodeArgs = [
    `--max-old-space-size=${plan.maxOldSpaceMb}`,
    scriptPath,
    ...args
  ];
  const child = spawn(process.execPath, nodeArgs, {
    stdio: "inherit",
    env: {
      ...process.env,
      COMFORMHEX_OFFLINE_HEAP_MB: String(plan.maxOldSpaceMb),
      COMFORMHEX_OFFLINE_MEMORY_SOURCE: plan.source
    }
  });

  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => {
      if (signal) {
        reject(new Error(`offline job terminated by ${signal}`));
      } else {
        resolve(exitCode ?? 1);
      }
    });
  });
  process.exitCode = code;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
