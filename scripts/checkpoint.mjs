import { readFile, readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import checkpoints from "../.github/scripts/checkpoints.cjs";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function readText(path) {
  try {
    return await readFile(resolve(root, path), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

export async function listPaths(directory = root) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if ([".git", ".tools", ".validation", "node_modules", "bin", "obj", "target"].includes(item.name)) continue;
    const path = resolve(directory, item.name);
    if (item.isDirectory()) result.push(...await listPaths(path));
    else if (item.isFile()) result.push(relative(root, path).split(sep).join("/"));
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv[2];
  const steps = argument === "deploy" ? [1, 2, 3, 4, 5] : [Number(argument)];
  if (steps.some((step) => !Number.isInteger(step) || step < 1 || step > 5)) {
    throw new Error("Usage: node scripts/checkpoint.mjs <1|2|3|4|5|deploy>. Cloud evidence is checked only by Actions.");
  }
  let failed = false;
  for (const step of steps) {
    // The local command checks files; the Actions orchestrator independently checks CI.
    const result = await checkpoints.evaluateStep(step, { readText, listPaths, ciPassed: true });
    console.log(`Checkpoint ${step}: ${result.passed ? "ready" : "not ready"}`);
    for (const problem of result.problems) console.error(`  - ${problem}`);
    failed ||= !result.passed;
  }
  process.exitCode = failed ? 1 : 0;
}
