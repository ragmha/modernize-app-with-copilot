import test from "node:test";
import assert from "node:assert/strict";
import { compareWorkflowLocks } from "../scripts/check-review-lock.mjs";

const lock = `# gh-aw-metadata: {"compiler_version":"v0.86.2","frontmatter_hash":"abc"}
# gh-aw-manifest: {"actions":[{"repo":"example/action","sha":"123"}]}
name: Example
on:
  workflow_dispatch:
permissions:
  contents: read
jobs:
  example:
    runs-on: ubuntu-24.04
    steps:
      - uses: example/action@123
      - run: |
          echo "hello"
`;

test("lock comparison tolerates only non-executable YAML comments and formatting", () => {
  const generated = lock.replace("uses: example/action@123", "uses: example/action@123 # 123");
  assert.doesNotThrow(() => compareWorkflowLocks(lock, generated.replace(/\n/g, "\r\n")));
});

test("lock comparison still rejects permission, script, compiler and dependency changes", () => {
  for (const generated of [
    lock.replace("contents: read", "contents: write"),
    lock.replace('echo "hello"', 'echo "changed"'),
    lock.replace("v0.86.2", "v0.88.7"),
    lock.replace('"sha":"123"', '"sha":"456"'),
    lock.replace('"frontmatter_hash":"abc"', '"frontmatter_hash":"different"'),
  ]) assert.throws(() => compareWorkflowLocks(lock, generated));
});

test("missing metadata and duplicate YAML keys fail explicitly", () => {
  assert.throws(() => compareWorkflowLocks(lock, lock.replace("# gh-aw-metadata:", "# absent:")), /missing/);
  assert.throws(() => compareWorkflowLocks(lock, `${lock}\nname: Duplicate\n`), /unique|repeated|duplicate/i);
});
