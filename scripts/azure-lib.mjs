import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const LAB_TAG = "modernize-app-with-copilot";
export const TRACKS = ["dotnet", "java"];
export const STATE_DIRECTORY = resolve(".lab", "azure");
export const EVIDENCE_PATH = resolve(".lab", "deployment.json");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;

export function requireValue(value, name) {
  if (typeof value !== "string" || !value.trim() || /[\r\n\0]/.test(value)) {
    throw new Error(`${name} must be configured and must not contain line breaks.`);
  }
  return value;
}

export function validateResourceGroup(value) {
  requireValue(value, "AZURE_RESOURCE_GROUP");
  if (!/^rg-modernize-[a-z0-9](?:[a-z0-9-]{1,43}[a-z0-9])$/.test(value)) {
    throw new Error("Use a dedicated AZURE_RESOURCE_GROUP named rg-modernize-<lab-name> (3–45 suffix characters).");
  }
  return value;
}

function ipv4Number(value) {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(value)) {
    throw new Error("Expected a canonical IPv4 address.");
  }
  const octets = value.split(".").map(Number);
  if (octets.some((octet) => octet > 255)) throw new Error("Invalid IPv4 address.");
  return octets.reduce((address, octet) => (address * 256) + octet, 0);
}

export function validatePublicIpv4(value) {
  ipv4Number(value);
  const [a, b, c] = value.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || (a === 100 && b >= 64 && b <= 127)) {
    throw new Error("Use a public IPv4 egress address, not a private/local address.");
  }
  return value;
}

export function validateAllowedCidr(value) {
  requireValue(value, "AZURE_ALLOWED_CIDR");
  const match = /^([^/]+)\/(2[4-9]|3[0-2])$/.exec(value);
  if (!match) throw new Error("AZURE_ALLOWED_CIDR must be a public IPv4 /24 through /32, never 0.0.0.0/0.");
  const address = ipv4Number(validatePublicIpv4(match[1]));
  if (address % (2 ** (32 - Number(match[2]))) !== 0) {
    throw new Error("AZURE_ALLOWED_CIDR must use the canonical network address.");
  }
  return value;
}

export function validateWorkflowContext(env, acknowledgement = "AZURE_COST_ACKNOWLEDGED") {
  if (env.GITHUB_ACTIONS !== "true" || env.GITHUB_EVENT_NAME !== "workflow_dispatch") {
    throw new Error("This operation is restricted to a manually dispatched GitHub Actions workflow.");
  }
  const defaultBranch = requireValue(env.GITHUB_DEFAULT_BRANCH, "GITHUB_DEFAULT_BRANCH");
  if (env.GITHUB_REF !== `refs/heads/${defaultBranch}`) throw new Error("Only the repository default branch may deploy or delete.");
  if (env[acknowledgement] !== "true") throw new Error(`Explicit acknowledgement is required (${acknowledgement}).`);
  if (!REPOSITORY.test(env.GITHUB_REPOSITORY ?? "")) throw new Error("Invalid GitHub repository.");
  if (!SHA.test(env.GITHUB_SHA ?? "")) throw new Error("Invalid source commit SHA.");
  if (!/^[1-9]\d*$/.test(env.GITHUB_RUN_ID ?? "") || !Number.isSafeInteger(Number(env.GITHUB_RUN_ID))) {
    throw new Error("Invalid workflow run ID.");
  }
  if (!/^[1-9]\d{0,3}$/.test(env.GITHUB_RUN_ATTEMPT ?? "")) throw new Error("Invalid workflow run attempt.");
  return { repository: env.GITHUB_REPOSITORY, sourceSha: env.GITHUB_SHA, runId: Number(env.GITHUB_RUN_ID), runAttempt: Number(env.GITHUB_RUN_ATTEMPT) };
}

export function validateAzureConfig(env, { cleanup = false, requirePasswords = true } = {}) {
  const context = validateWorkflowContext(env, cleanup ? "AZURE_DELETE_ACKNOWLEDGED" : "AZURE_COST_ACKNOWLEDGED");
  const resourceGroup = validateResourceGroup(env.AZURE_RESOURCE_GROUP);
  for (const name of ["AZURE_CLIENT_ID", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID"]) {
    if (!UUID.test(env[name] ?? "")) throw new Error(`${name} must be a UUID.`);
  }
  if (cleanup) {
    if (env.AZURE_DELETE_RESOURCE_GROUP !== resourceGroup) throw new Error("Typed resource group must exactly equal AZURE_RESOURCE_GROUP.");
    return { ...context, resourceGroup, subscriptionId: env.AZURE_SUBSCRIPTION_ID };
  }
  if (!UUID.test(env.AZURE_PRINCIPAL_ID ?? "")) throw new Error("AZURE_PRINCIPAL_ID must be the service principal object ID.");
  if (!/^[a-z][a-z0-9]+$/.test(env.AZURE_LOCATION ?? "")) throw new Error("AZURE_LOCATION must be an Azure region name.");
  validateAllowedCidr(env.AZURE_ALLOWED_CIDR);
  if (requirePasswords) {
    for (const name of ["SQL_ADMIN_PASSWORD", "POSTGRES_ADMIN_PASSWORD", "DOTNET_ADMIN_PASSWORD", "JAVA_ADMIN_PASSWORD"]) {
      const value = requireValue(env[name], name);
      if (value.length < 16 || value.length > 128 || !/[A-Z]/.test(value) ||
          !/[a-z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value) ||
          /[^\x20-\x7E]/.test(value) || value.toLowerCase().includes("labadmin")) {
        throw new Error(`${name}: use 16–128 printable ASCII characters, upper/lowercase, a digit and punctuation; do not include labadmin.`);
      }
    }
  }
  return { ...context, resourceGroup, subscriptionId: env.AZURE_SUBSCRIPTION_ID };
}

export function validateGroupOwnership(group, config) {
  const expectedId = `/subscriptions/${config.subscriptionId}/resourceGroups/${config.resourceGroup}`;
  if (group?.name !== config.resourceGroup || group.id?.toLowerCase() !== expectedId.toLowerCase() ||
      group.tags?.lab !== LAB_TAG || group.tags?.repository !== config.repository ||
      group.properties?.provisioningState !== "Succeeded") {
    throw new Error("Refusing this resource group: name, subscription, ownership tags or provisioning state do not match the dedicated lab.");
  }
  return group;
}

export function validateFoundation(value) {
  const patterns = {
    registryName: /^acr[a-z0-9]{13}$/,
    registryLoginServer: /^acr[a-z0-9]{13}\.azurecr\.io$/,
    environmentName: /^cae-[a-z0-9]{13}$/,
    dotnetIdentityName: /^id-dotnet-[a-z0-9]{13}$/,
    javaIdentityName: /^id-java-[a-z0-9]{13}$/,
    sqlServerName: /^sql-[a-z0-9]{13}$/,
    postgresServerName: /^pg-[a-z0-9]{13}$/,
    blobAccountName: /^st[a-z0-9]{13}$/,
    dotnetAppName: /^ca-dotnet-[a-z0-9]{13}$/,
    javaAppName: /^ca-java-[a-z0-9]{13}$/,
  };
  for (const [name, pattern] of Object.entries(patterns)) {
    if (!pattern.test(value?.[name] ?? "")) throw new Error(`Invalid foundation output: ${name}.`);
  }
  if (value.registryLoginServer !== `${value.registryName}.azurecr.io` ||
      value.sqlDatabaseName !== "photoalbum" || value.postgresDatabaseName !== "photoalbum" ||
      value.blobContainerName !== "photos") throw new Error("Unexpected foundation database, container or registry.");
  return value;
}

export function validateImageDigest(value) {
  if (!DIGEST.test(value ?? "")) throw new Error("An actual sha256 image manifest digest is required.");
  return value;
}

export function validateAppUrl(value, containerApp) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== "/" || !url.hostname.startsWith(`${containerApp}.`) ||
      !url.hostname.endsWith(".azurecontainerapps.io")) {
    throw new Error("Expected the deployed Container App HTTPS URL, without credentials, query or path.");
  }
  return value;
}

export function validateEvidence(evidence, expected) {
  if (evidence?.schemaVersion !== 1 || !REPOSITORY.test(evidence.repository ?? "") ||
      !SHA.test(evidence.sourceSha ?? "") || !Number.isSafeInteger(evidence.runId) || evidence.runId <= 0 ||
      !Number.isSafeInteger(evidence.runAttempt) || evidence.runAttempt < 1 || evidence.runAttempt > 9999 ||
      JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify(["repository", "runAttempt", "runId", "schemaVersion", "sourceSha", "tracks"]) ||
      JSON.stringify(Object.keys(evidence.tracks ?? {}).sort()) !== JSON.stringify(TRACKS)) {
    throw new Error("Invalid deployment evidence schema; both tracks are mandatory.");
  }
  if (expected && (evidence.repository !== expected.repository || evidence.sourceSha !== expected.sourceSha ||
      evidence.runId !== expected.runId || evidence.runAttempt !== expected.runAttempt)) throw new Error("Evidence does not belong to this repository, commit, run and attempt.");
  for (const track of TRACKS) {
    const item = evidence.tracks[track];
    if (!item || item.smokePassed !== true || !/^ca-(dotnet|java)-[a-z0-9]{13}$/.test(item.containerApp ?? "") ||
        !item.containerApp.startsWith(`ca-${track}-`) ||
        JSON.stringify(Object.keys(item).sort()) !== JSON.stringify(["containerApp", "imageDigest", "smokePassed", "url"])) {
      throw new Error(`Invalid ${track} evidence: a successful real smoke and non-secret metadata are required.`);
    }
    validateImageDigest(item.imageDigest);
    validateAppUrl(item.url, item.containerApp);
  }
  return evidence;
}

export function healthyResponse(status, body, contentType = "") {
  if (status !== 200) return false;
  if (/^healthy$/i.test(body.trim())) return true;
  if (!contentType.toLowerCase().includes("application/json")) return false;
  try {
    const result = JSON.parse(body);
    return typeof result.status === "string" && /^(healthy|up|ok)$/i.test(result.status);
  } catch {
    return false;
  }
}

export function requireFunctionalSmoke(output, track, url) {
  let result;
  try {
    result = JSON.parse(output);
  } catch {
    throw new Error("The smoke runner must emit a structured functional result, not readiness-only output.");
  }
  const checks = [
    "database-readiness", "authentication", "upload", "list", "download-bytes",
    "previous-next-navigation", "back-to-gallery", "delete",
  ];
  if (result?.track !== track || result.origin !== new URL(url).origin ||
      result.mode !== "functional" || result.status !== "passed" || result.functionalSmoke !== true ||
      !Array.isArray(result.checks) || !checks.every((check) => result.checks.includes(check)) ||
      !Number.isSafeInteger(result.photosCreated) || result.photosCreated < 2 ||
      result.photosDeleted !== result.photosCreated) {
    throw new Error("A full authenticated smoke on the expected track/origin, byte checks, navigation and verified own-photo deletion are required.");
  }
  return result;
}

export function requireSuccessfulCi(runs, jobs, expected) {
  const run = runs.find((candidate) => candidate.name === "CI" &&
    candidate.path === ".github/workflows/ci.yml" && candidate.head_sha === expected.sourceSha &&
    candidate.head_branch === expected.defaultBranch && candidate.event === "push");
  if (!run || run.status !== "completed" || run.conclusion !== "success" ||
      !jobs.some((job) => job.run_id === run.id && job.name === "CI" &&
      job.status === "completed" && job.conclusion === "success")) {
    throw new Error("A successful CI workflow and final CI job on this default-branch SHA are required.");
  }
  return run;
}

export function requireProtectedEnvironment(environment, branchPolicies, defaultBranch) {
  const reviews = environment?.protection_rules?.find((rule) => rule.type === "required_reviewers");
  if (!reviews?.reviewers?.length || environment?.deployment_branch_policy?.custom_branch_policies !== true ||
      branchPolicies?.length !== 1 || branchPolicies[0].name !== defaultBranch ||
      branchPolicies[0].type !== "branch") {
    throw new Error("Configure azure with at least one required reviewer and exactly one deployment branch rule: the repository default branch (no tags or wildcards).");
  }
}

export async function writeJson(path, data, { privateFile = false } = {}) {
  await mkdir(resolve(path, ".."), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, { mode: privateFile ? 0o600 : 0o644 });
}

export function run(command, args, { label = command, env = process.env, timeout = 40 * 60_000, input } = {}) {
  return new Promise((fulfill, reject) => {
    const child = spawn(command, args, { env, shell: false, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let outputBytes = 0;
    let failure;
    let forceTimer;
    function stop(message) {
      if (failure) return;
      failure = new Error(message);
      child.kill("SIGTERM");
      forceTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forceTimer.unref();
    }
    function clearTimers() {
      clearTimeout(timer);
      clearTimeout(forceTimer);
    }
    const timer = setTimeout(() => stop(`${label} timed out; no successful result was accepted.`), timeout);
    child.stdout.setEncoding("utf8").on("data", (data) => {
      outputBytes += Buffer.byteLength(data);
      if (outputBytes > 16 * 1024 * 1024) {
        stop(`${label} exceeded its output limit; no successful result was accepted.`);
      } else stdout += data;
    });
    child.stderr.resume();
    child.on("error", () => {
      clearTimers();
      reject(new Error(`${label} could not start. Check the required local tools.`));
    });
    child.on("close", (code) => {
      clearTimers();
      // Cloud errors can echo secure parameters. Keep diagnostics in the Azure portal, not public workflow logs.
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`${label} failed (exit ${code}); inspect the protected Azure deployment diagnostics. Output was not logged.`));
      else fulfill(stdout.trim());
    });
    child.stdin.on("error", () => stop(`${label} could not receive its standard input.`));
    child.stdin.end(input);
  });
}

export async function az(args, options = {}) {
  return run("az", [...args, "--only-show-errors"], options);
}

export const delay = (milliseconds) => new Promise((fulfill) => setTimeout(fulfill, milliseconds));
