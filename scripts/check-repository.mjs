import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { listPaths } from "./checkpoint.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const files = await listPaths();
const need = (condition, message) => { if (!condition) failures.push(message); };
const text = (path) => readFile(resolve(root, path), "utf8");

for (const path of [
  "README.md", "LICENSE", "samples.lock.json", "third_party/README.md",
  "apps/dotnet/PhotoAlbum.sln", "apps/dotnet/LICENSE", "apps/java/pom.xml", "apps/java/LICENSE",
  ".devcontainer/devcontainer.json", ".github/workflows/ci.yml", ".github/workflows/exercise.yml",
  ".github/workflows/deploy-azure.yml", ".github/workflows/azure-oidc-subject.yml",
  ".github/workflows/cleanup-azure.yml", ".github/workflows/modernization-review.md",
  ".github/workflows/modernization-review.lock.yml", "docs/azure-setup.md",
]) need(files.includes(path), `Missing required repository surface: ${path}`);

for (const path of files.filter((path) => /\.(?:ya?ml)$/.test(path) &&
    !path.startsWith("apps/") && !path.startsWith("third_party/"))) {
  const document = parseDocument(await text(path), { uniqueKeys: true });
  for (const error of document.errors) failures.push(`${path}: ${error.message}`);
  if (!path.startsWith(".github/workflows/")) continue;
  const workflow = document.toJS();
  need(workflow?.name && workflow?.on && workflow?.jobs, `${path}: workflow requires name, on, and jobs.`);
  need(!workflow?.on?.pull_request_target, `${path}: untrusted PRs must not run with elevated privileges.`);
  for (const [jobId, job] of Object.entries(workflow?.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.uses && !step.uses.startsWith("./") && !step.uses.startsWith("docker://")) {
        need(/@[a-f0-9]{40}$/.test(step.uses), `${path}/${jobId}: pin action ${step.uses} to a full commit SHA.`);
      }
    }
  }
}

const devcontainer = JSON.parse(await text(".devcontainer/devcontainer.json"));
need(devcontainer.features?.["ghcr.io/devcontainers/features/dotnet:2"]?.additionalVersions === "9.0",
  "The Codespace must retain the source .NET SDK/runtime.");
need(devcontainer.features?.["ghcr.io/devcontainers/features/java:1"]?.additionalVersions === "8",
  "The Codespace must retain JDK 8 for the baseline.");
need(devcontainer.forwardPorts?.includes(5134) && devcontainer.forwardPorts?.includes(8080),
  "Expose both application development ports.");
need(devcontainer.otherPortsAttributes?.onAutoForward === "ignore", "Do not automatically expose database or unrelated ports.");
for (const port of ["5134", "8080"]) need(devcontainer.portsAttributes?.[port]?.protocol === "http", `Port ${port} must match its application's local HTTP listener.`);

const readme = await text("README.md");
need(readme.includes("template_owner=ragmha&template_name=modernize-app-with-copilot"),
  "Copy Exercise must point to the actual enabled template repository.");
need(!readme.includes("codespaces.new/ragmha/modernize-app-with-copilot"),
  "Do not send learners into the author's Codespace rather than their own copy.");
for (let step = 1; step <= 7; step++) {
  need(files.some((path) => path.startsWith(`.github/steps/${step}-`) && path.endsWith(".md")), `Missing lesson ${step}.`);
}

for (const path of files.filter((file) => file.endsWith(".md") &&
    !file.startsWith("apps/") && !file.startsWith("third_party/"))) {
  for (const match of (await text(path)).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1].split("#")[0];
    if (!target || /^(?:[a-z]+:|#|\/|\{\{)/i.test(target) || target.startsWith("../../")) continue;
    try {
      await access(resolve(root, dirname(path), decodeURIComponent(target)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      failures.push(`${path}: broken local link ${target}`);
    }
  }
}

if (failures.length) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Repository surfaces, YAML, action pins, Codespaces contract, and local documentation links are consistent.");
}
