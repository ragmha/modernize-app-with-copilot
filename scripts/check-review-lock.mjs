import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const root = fileURLToPath(new URL("../", import.meta.url));
const lockPath = ".github/workflows/modernization-review.lock.yml";

function metadata(source, kind) {
  const prefix = `# gh-aw-${kind}: `;
  const line = source.split(/\r?\n/).find((value) => value.startsWith(prefix));
  if (!line) throw new Error(`The compiled workflow is missing its ${kind} header.`);
  return JSON.parse(line.slice(prefix.length));
}

function workflow(source) {
  const document = parseDocument(source, { uniqueKeys: true });
  if (document.errors.length) throw new Error(document.errors.map((error) => error.message).join("\n"));
  return document.toJS();
}

export function compareWorkflowLocks(committed, compiled) {
  for (const kind of ["metadata", "manifest"]) {
    assert.deepStrictEqual(metadata(compiled, kind), metadata(committed, kind),
      `Compiled ${kind} differs. Run npm run compile:review and commit the generated lock.`);
  }
  // Platform-specific action-reference comments do not change the executable workflow.
  assert.deepStrictEqual(workflow(compiled), workflow(committed),
    "Compiled workflow content differs. Run npm run compile:review and commit the generated lock.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const committed = execFileSync("git", ["show", `HEAD:${lockPath}`],
    { cwd: root, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  compareWorkflowLocks(committed, readFileSync(resolve(root, lockPath), "utf8"));
  console.log("Compiled workflow, source hashes, compiler version, and dependency manifest match the committed lock.");
}
