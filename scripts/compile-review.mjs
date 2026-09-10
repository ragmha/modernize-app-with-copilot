import { spawnSync } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const compilerVersion = "v0.86.2";
export const runtimeRevision = "6aab9e5b5c91c615506061f09bedd81a23babe3c";

export function compilerInvocation(binary) {
  if (binary) {
    if (!isAbsolute(binary)) throw new Error("GH_AW_BINARY must be an absolute path to the verified compiler.");
    return { command: binary, prefix: [] };
  }
  return { command: "gh", prefix: ["aw"] };
}

export function requireCompilerVersion(output) {
  if (output.trim() !== `gh aw version ${compilerVersion}`) {
    throw new Error(`Expected gh-aw ${compilerVersion}. Install that version or use the provided Codespace; a different compiler must not rewrite the lock file.`);
  }
}

export function compileReview(binary = process.env.GH_AW_BINARY) {
  const { command, prefix } = compilerInvocation(binary);
  const version = spawnSync(command, [...prefix, "--version"], { encoding: "utf8", timeout: 60_000 });
  if (version.error || version.status !== 0) {
    throw new Error("The pinned gh-aw compiler could not run. Follow docs/agentic-workflows.md.");
  }
  requireCompilerVersion(version.stdout + version.stderr);
  const result = spawnSync(command, [
    ...prefix, "compile", "modernization-review", "--no-check-update",
    "--action-mode", "action", "--action-tag", runtimeRevision,
  ], { stdio: "inherit", timeout: 300_000 });
  if (result.error || result.status !== 0) throw new Error(`Agentic workflow compilation failed (${result.status ?? result.signal ?? "could not start"}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) compileReview();
