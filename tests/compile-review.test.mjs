import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { compilerInvocation, requireCompilerVersion, runtimeRevision } from "../scripts/compile-review.mjs";

test("the compiler must report the exact pinned version before changing the lock", () => {
  assert.doesNotThrow(() => requireCompilerVersion("gh aw version v0.86.2\n"));
  for (const output of ["gh aw version v0.88.7", "v0.86.2", "", "gh aw version v0.86.20"]) {
    assert.throws(() => requireCompilerVersion(output), /Expected gh-aw/);
  }
  assert.match(runtimeRevision, /^[a-f0-9]{40}$/);
});

test("explicit compiler paths bypass preinstalled extensions without shell evaluation", () => {
  assert.deepEqual(compilerInvocation(undefined), { command: "gh", prefix: ["aw"] });
  const binary = resolve("compiler-fixture");
  assert.deepEqual(compilerInvocation(binary), { command: binary, prefix: [] });
  assert.throws(() => compilerInvocation("compiler --unexpected-command"), /absolute path/);
});
