import test from "node:test";
import assert from "node:assert/strict";
import { javaMajor, releaseMajor } from "../scripts/lab.mjs";

test("toolchain selection follows explicit source and target Java versions", () => {
  assert.equal(javaMajor("<java.version>1.8</java.version>"), 8);
  assert.equal(javaMajor("<java.version>8</java.version>"), 8);
  assert.equal(javaMajor("<java.version>25</java.version>"), 25);
  assert.throws(() => javaMajor("<java.version>$(injected)</java.version>"), /explicit/);
  assert.throws(() => javaMajor("<java.version>17</java.version>"), /explicit/);
});

test("installed JDK release files support legacy and modern numbering", () => {
  assert.equal(releaseMajor('JAVA_VERSION="1.8.0_462"'), 8);
  assert.equal(releaseMajor('JAVA_VERSION="25.0.1"'), 25);
  assert.equal(releaseMajor('JAVA_VERSION="25-ea"'), 25);
  assert.equal(releaseMajor("invalid"), undefined);
});
