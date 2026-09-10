import { appendFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  az, delay, EVIDENCE_PATH, healthyResponse, requireFunctionalSmoke, run, STATE_DIRECTORY, TRACKS,
  validateAppUrl, validateAzureConfig, validateEvidence, validateFoundation,
  validateGroupOwnership, validateImageDigest, validatePublicIpv4, writeJson,
} from "./azure-lib.mjs";

const privateDirectory = join(STATE_DIRECTORY, "private");
const statePath = join(STATE_DIRECTORY, "state.json");
const imageDirectory = resolve(".lab", "azure-images");

async function deployTemplate(name, template, parameters) {
  const path = join(privateDirectory, `${name}.parameters.json`);
  await writeJson(path, {
    $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentParameters.json#",
    contentVersion: "1.0.0.0",
    parameters: Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, { value }])),
  }, { privateFile: true });
  try {
    const result = await az([
      "deployment", "group", "create",
      "--resource-group", process.env.AZURE_RESOURCE_GROUP, "--name", name,
      "--mode", "Incremental", "--template-file", template, "--parameters", `@${path}`,
      "--query", "properties.outputs", "--output", "json",
    ], { label: `${template} resource-group deployment` });
    return JSON.parse(result);
  } finally {
    await rm(path, { force: true });
  }
}

export async function revokeSmokeAccess(env = process.env) {
  let state;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  const config = validateAzureConfig(env, { requirePasswords: false });
  const foundation = validateFoundation(state.foundation);
  if (state.repository !== config.repository || state.sourceSha !== config.sourceSha ||
      state.runId !== config.runId || state.runAttempt !== config.runAttempt || state.resourceGroup !== config.resourceGroup ||
      state.ruleName !== `github-smoke-${config.runId}`) throw new Error("Smoke-access state does not belong to this workflow run.");
  validateGroupOwnership(JSON.parse(await az([
    "group", "show", "--name", config.resourceGroup, "--output", "json",
  ])), config);
  const names = JSON.parse(await az([
    "containerapp", "list", "--resource-group", config.resourceGroup, "--query", "[].name", "--output", "json",
  ]));
  const failures = [];
  for (const track of TRACKS) {
    const name = foundation[`${track}AppName`];
    if (!names.includes(name)) continue;
    try {
      const rules = JSON.parse(await az([
        "containerapp", "ingress", "access-restriction", "list",
        "--resource-group", config.resourceGroup, "--name", name, "--output", "json",
      ]));
      if (!rules.some((rule) => rule.name === state.ruleName)) continue;
      await az([
        "containerapp", "ingress", "access-restriction", "remove",
        "--resource-group", config.resourceGroup, "--name", name, "--rule-name", state.ruleName,
        "--output", "none",
      ]);
      const remaining = JSON.parse(await az([
        "containerapp", "ingress", "access-restriction", "list",
        "--resource-group", config.resourceGroup, "--name", name, "--output", "json",
      ]));
      if (remaining.some((rule) => rule.name === state.ruleName)) throw new Error("Rule is still present.");
    } catch {
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`Could not remove temporary smoke access from ${failures.join(", ")}. Revoke it in Azure before continuing.`);
}

async function retry(operation, attempts = 12, interval = 10_000) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation(); } catch (error) {
      if (attempt >= attempts) throw error;
      await delay(interval);
    }
  }
}

async function assertRevision(name, image, suffix, resourceGroup) {
  return retry(async () => {
    const result = JSON.parse(await az([
      "containerapp", "show", "--resource-group", resourceGroup, "--name", name,
      "--query", "{image:properties.template.containers[0].image,latest:properties.latestRevisionName,ready:properties.latestReadyRevisionName,fqdn:properties.configuration.ingress.fqdn,state:properties.provisioningState}",
      "--output", "json",
    ]));
    if (result.state !== "Succeeded" || result.image !== image ||
        result.latest !== `${name}--${suffix}` || result.ready !== result.latest) {
      throw new Error(`The new ${name} revision is not ready with the expected image digest.`);
    }
    return validateAppUrl(`https://${result.fqdn}`, name);
  }, 40, 15_000);
}

async function waitForHealth(url) {
  await retry(async () => {
    const response = await fetch(`${url}/health`, { redirect: "manual", signal: AbortSignal.timeout(30_000) });
    const body = await response.text();
    if (!healthyResponse(response.status, body, response.headers.get("content-type") ?? "")) {
      throw new Error("Readiness must return Healthy or JSON status UP/ok/Healthy, not a login page, redirect or arbitrary HTTP 200.");
    }
  }, 30, 10_000);
}

export async function deploy(env = process.env) {
  const config = validateAzureConfig(env);
  await rm(EVIDENCE_PATH, { force: true });
  await mkdir(privateDirectory, { recursive: true, mode: 0o700 });
  const dockerEnv = { ...env, DOCKER_CONFIG: join(privateDirectory, "docker") };
  await mkdir(dockerEnv.DOCKER_CONFIG, { recursive: true, mode: 0o700 });
  let evidence;
  try {
    console.log("Checking both image archives before provisioning.");
    for (const track of TRACKS) {
      const archive = join(imageDirectory, `${track}.tar`);
      if (!(await stat(archive)).isFile()) throw new Error(`Missing ${track} image archive from the unprivileged job.`);
      await run("docker", ["load", "--input", archive], { env: dockerEnv, label: `Load ${track} image` });
      const image = JSON.parse(await run("docker", ["image", "inspect", `modernize-${track}:${config.sourceSha}`], { env: dockerEnv }));
      if (image[0]?.Config?.Labels?.["org.opencontainers.image.revision"] !== config.sourceSha ||
          image[0]?.Os !== "linux" || image[0]?.Architecture !== "amd64") {
        throw new Error(`${track} image does not match the built Linux/amd64 source commit.`);
      }
    }
    const account = JSON.parse(await az(["account", "show", "--output", "json"]));
    if (account.id !== config.subscriptionId || account.tenantId !== env.AZURE_TENANT_ID ||
        account.environmentName !== "AzureCloud") throw new Error("Azure login does not match the explicitly configured public-cloud subscription and tenant.");
    validateGroupOwnership(JSON.parse(await az([
      "group", "show", "--name", config.resourceGroup, "--output", "json",
    ])), config);
    console.log("Deploying the private data services and registry into the existing tagged lab resource group.");
    const result = await deployTemplate("modernize-foundation", "infra/main.bicep", {
      location: env.AZURE_LOCATION, repository: config.repository, deploymentPrincipalId: env.AZURE_PRINCIPAL_ID,
      sqlAdminPassword: env.SQL_ADMIN_PASSWORD, postgresAdminPassword: env.POSTGRES_ADMIN_PASSWORD,
    });
    const foundation = validateFoundation(result.foundation?.value);
    const state = { ...config, foundation, ruleName: `github-smoke-${config.runId}` };
    await writeJson(statePath, state);
    console.log("Publishing only the prebuilt application images using scoped AcrPush.");
    const tracks = {};
    for (const track of TRACKS) {
      const tag = `${foundation.registryLoginServer}/modernize-${track}:${config.sourceSha}`;
      await run("docker", ["tag", `modernize-${track}:${config.sourceSha}`, tag], { env: dockerEnv });
      // RBAC propagation is eventually consistent. Retry login and push, never enable ACR admin.
      await retry(async () => {
        await az(["acr", "login", "--name", foundation.registryName], { env: dockerEnv, label: "OIDC ACR login" });
        await run("docker", ["push", tag], { env: dockerEnv, label: `Push ${track} image` });
      }, 15, 20_000);
      const digest = validateImageDigest(await az([
        "acr", "repository", "show", "--name", foundation.registryName,
        "--image", `modernize-${track}:${config.sourceSha}`, "--query", "digest", "--output", "tsv",
      ]));
      tracks[track] = {
        imageDigest: digest,
        containerApp: foundation[`${track}AppName`],
        image: `${foundation.registryLoginServer}/modernize-${track}@${digest}`,
      };
    }
    const revisionSuffix = `r${config.runId}-${config.runAttempt}`;
    console.log("Deploying both upgraded images by immutable manifest digest.");
    await deployTemplate("modernize-apps", "infra/apps.bicep", {
      location: env.AZURE_LOCATION, repository: config.repository, foundation,
      sourceSha: config.sourceSha, revisionSuffix, allowedCidr: env.AZURE_ALLOWED_CIDR,
      dotnetImage: tracks.dotnet.image, javaImage: tracks.java.image,
      sqlAdminPassword: env.SQL_ADMIN_PASSWORD, postgresAdminPassword: env.POSTGRES_ADMIN_PASSWORD,
      dotnetAdminPassword: env.DOTNET_ADMIN_PASSWORD, javaAdminPassword: env.JAVA_ADMIN_PASSWORD,
    });
    const ipResponse = await fetch("https://api.ipify.org", { redirect: "error", signal: AbortSignal.timeout(15_000) });
    if (!ipResponse.ok) throw new Error("Could not discover the runner's public IPv4 address.");
    const runnerIp = validatePublicIpv4((await ipResponse.text()).trim());
    for (const track of TRACKS) {
      tracks[track].url = await assertRevision(tracks[track].containerApp, tracks[track].image, revisionSuffix, config.resourceGroup);
      await az([
        "containerapp", "ingress", "access-restriction", "set",
        "--resource-group", config.resourceGroup, "--name", tracks[track].containerApp,
        "--rule-name", state.ruleName, "--description", `Temporary smoke access for GitHub run ${config.runId}`,
        "--action", "Allow", "--ip-address", `${runnerIp}/32`, "--output", "none",
      ]);
    }
    for (const track of TRACKS) {
      console.log(`Checking ${track} readiness and authenticated upload/read/delete.`);
      await waitForHealth(tracks[track].url);
      const smokeOutput = await run(process.execPath, ["scripts/smoke-apps.mjs", "--track", track, "--url", tracks[track].url], {
        label: `${track} authenticated remote smoke`,
        timeout: 5 * 60_000,
        env: {
          PATH: env.PATH, HOME: env.HOME, CI: "true",
          SMOKE_ADMIN_USERNAME: "admin",
          SMOKE_ADMIN_PASSWORD: env[track === "dotnet" ? "DOTNET_ADMIN_PASSWORD" : "JAVA_ADMIN_PASSWORD"],
        },
      });
      requireFunctionalSmoke(smokeOutput, track, tracks[track].url);
      tracks[track].smokePassed = true;
      delete tracks[track].image;
    }
    evidence = validateEvidence({
      schemaVersion: 1, repository: config.repository, sourceSha: config.sourceSha,
      runId: config.runId, runAttempt: config.runAttempt, tracks,
    }, config);
  } finally {
    try {
      // Also called by an always() workflow step if this process fails or is interrupted.
      await revokeSmokeAccess(env);
    } finally {
      await rm(privateDirectory, { recursive: true, force: true });
    }
  }
  await writeJson(EVIDENCE_PATH, evidence);
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, [
      "## Both Azure tracks passed",
      `Source commit: \`${config.sourceSha}\`. Temporary runner ingress access was removed.`,
      ...TRACKS.map((track) => `- **${track}:** ${evidence.tracks[track].url} — \`${evidence.tracks[track].imageDigest}\``),
      "Download `azure-deployment-evidence` before its 14-day retention expires. Azure resources continue to incur costs until cleaned up.",
      "",
    ].join("\n"));
  }
  console.log("Both remote smokes passed; wrote non-secret .lab/deployment.json.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? "deploy";
    if (command === "validate") validateAzureConfig(process.env);
    else if (command === "revoke-smoke-access") await revokeSmokeAccess();
    else if (command === "deploy") await deploy();
    else throw new Error("Usage: node scripts/azure-deploy.mjs [validate|deploy|revoke-smoke-access]");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
