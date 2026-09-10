import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import {
  healthyResponse, LAB_TAG, requireFunctionalSmoke, requireProtectedEnvironment, requireSuccessfulCi, run,
  validateAllowedCidr, validateAppUrl, validateAzureConfig, validateEvidence,
  validateFoundation, validateGroupOwnership, validateImageDigest, validatePublicIpv4,
  validateResourceGroup, validateWorkflowContext,
} from "../scripts/azure-lib.mjs";

const sha = "a".repeat(40);
const suffix = "abcdefghijkl3";
const uuid = "11111111-2222-3333-4444-555555555555";
const password = "Fixture-Only-Password-273!"; // Test-only validation input, never a deployed credential.

function environment() {
  return {
    GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_DEFAULT_BRANCH: "trunk", GITHUB_REF: "refs/heads/trunk",
    GITHUB_REPOSITORY: "learner/photo-lab", GITHUB_SHA: sha, GITHUB_RUN_ID: "12345", GITHUB_RUN_ATTEMPT: "1",
    AZURE_COST_ACKNOWLEDGED: "true",
    AZURE_CLIENT_ID: uuid, AZURE_PRINCIPAL_ID: uuid,
    AZURE_TENANT_ID: uuid, AZURE_SUBSCRIPTION_ID: uuid,
    AZURE_RESOURCE_GROUP: "rg-modernize-photo-lab", AZURE_LOCATION: "westeurope",
    AZURE_ALLOWED_CIDR: "8.8.8.8/32",
    SQL_ADMIN_PASSWORD: password, POSTGRES_ADMIN_PASSWORD: password,
    DOTNET_ADMIN_PASSWORD: password, JAVA_ADMIN_PASSWORD: password,
  };
}

function foundation() {
  return {
    registryName: `acr${suffix}`, registryLoginServer: `acr${suffix}.azurecr.io`,
    environmentName: `cae-${suffix}`, dotnetIdentityName: `id-dotnet-${suffix}`,
    javaIdentityName: `id-java-${suffix}`, sqlServerName: `sql-${suffix}`,
    sqlDatabaseName: "photoalbum", postgresServerName: `pg-${suffix}`,
    postgresDatabaseName: "photoalbum", blobAccountName: `st${suffix}`,
    blobContainerName: "photos", dotnetAppName: `ca-dotnet-${suffix}`, javaAppName: `ca-java-${suffix}`,
  };
}

function evidence() {
  return {
    schemaVersion: 1, repository: "learner/photo-lab", sourceSha: sha, runId: 12345, runAttempt: 1,
    tracks: Object.fromEntries(["dotnet", "java"].map((track) => [track, {
      imageDigest: `sha256:${"b".repeat(64)}`,
      containerApp: `ca-${track}-${suffix}`,
      url: `https://ca-${track}-${suffix}.example.westeurope.azurecontainerapps.io`,
      smokePassed: true,
    }])),
  };
}

test("Azure mutations require explicit manual acknowledgement and the actual default branch", () => {
  assert.equal(validateWorkflowContext(environment()).sourceSha, sha);
  for (const changes of [
    { GITHUB_ACTIONS: "false" }, { GITHUB_EVENT_NAME: "pull_request" },
    { GITHUB_EVENT_NAME: "push" }, { GITHUB_REF: "refs/heads/main" },
    { GITHUB_REF: "refs/tags/trunk" }, { AZURE_COST_ACKNOWLEDGED: "false" },
    { AZURE_COST_ACKNOWLEDGED: "" }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ID: "9007199254740992" },
    { GITHUB_SHA: "main" }, { GITHUB_REPOSITORY: "owner/repo\ninjection" }, { GITHUB_RUN_ATTEMPT: "0" },
  ]) assert.throws(() => validateWorkflowContext({ ...environment(), ...changes }));
});

test("deployment validates all identities, ingress, location and four runtime secrets", () => {
  assert.equal(validateAzureConfig(environment()).resourceGroup, "rg-modernize-photo-lab");
  for (const name of [
    "AZURE_CLIENT_ID", "AZURE_PRINCIPAL_ID", "AZURE_TENANT_ID", "AZURE_SUBSCRIPTION_ID",
    "AZURE_LOCATION", "AZURE_ALLOWED_CIDR", "SQL_ADMIN_PASSWORD", "POSTGRES_ADMIN_PASSWORD",
    "DOTNET_ADMIN_PASSWORD", "JAVA_ADMIN_PASSWORD",
  ]) assert.throws(() => validateAzureConfig({ ...environment(), [name]: "" }), name);
  for (const value of ["short", "abcdefghijklmnop", "LABADMIN-Example-Password-1!", `${password}\n`]) {
    assert.throws(() => validateAzureConfig({ ...environment(), SQL_ADMIN_PASSWORD: value }));
  }
  assert.doesNotThrow(() => validateAzureConfig({ ...environment(), SQL_ADMIN_PASSWORD: `Upper-lower-173;"'!` }));
  const noPasswords = environment();
  for (const key of Object.keys(noPasswords).filter((key) => key.endsWith("_PASSWORD"))) delete noPasswords[key];
  assert.doesNotThrow(() => validateAzureConfig(noPasswords, { requirePasswords: false }));
});

test("resource-group safeguards reject general, empty and malformed names", () => {
  assert.equal(validateResourceGroup("rg-modernize-example"), "rg-modernize-example");
  for (const name of ["", "DefaultResourceGroup-WEU", "prod", "shared", "rg-default", "MC_cluster", "rg-modernize-", "rg-modernize-xy", "rg-modernize-demo;echo", "rg-modernize-demo/other"]) {
    assert.throws(() => validateResourceGroup(name), name);
  }
});

test("allowed ingress is a canonical narrow public IPv4 network, never all internet", () => {
  for (const value of ["8.8.8.8/32", "8.8.8.0/24", "1.1.1.0/28"]) assert.equal(validateAllowedCidr(value), value);
  for (const value of [
    "0.0.0.0/0", "1.0.0.0/8", "8.8.8.1/24", "10.0.0.0/24", "127.0.0.1/32",
    "192.168.1.2/32", "172.16.0.0/24", "100.64.0.1/32", "169.254.1.2/32",
    "::/0", "256.1.2.3/32", "08.8.8.8/32", "8.8.8.8/33", "8.8.8.8", "8.8.8.8/32\n",
    "192.0.2.1/32", "198.51.100.1/32", "203.0.113.1/32", "198.18.0.1/32",
  ]) assert.throws(() => validateAllowedCidr(value), value);
  assert.equal(validatePublicIpv4("1.1.1.1"), "1.1.1.1");
  assert.throws(() => validatePublicIpv4("1.1.1.1/32"));
});

test("group ownership is checked against exact name, subscription and repository tags", () => {
  const config = validateAzureConfig(environment());
  const group = {
    name: config.resourceGroup,
    id: `/subscriptions/${uuid}/resourceGroups/${config.resourceGroup}`,
    tags: { lab: LAB_TAG, repository: config.repository },
    properties: { provisioningState: "Succeeded" },
  };
  assert.equal(validateGroupOwnership(group, config), group);
  for (const value of [
    { ...group, name: "rg-modernize-other" },
    { ...group, id: `/subscriptions/other/resourceGroups/${config.resourceGroup}` },
    { ...group, tags: {} }, { ...group, tags: { ...group.tags, repository: "other/repository" } },
    { ...group, properties: { provisioningState: "Deleting" } },
  ]) assert.throws(() => validateGroupOwnership(value, config));
});

test("cleanup requires both its own acknowledgement and an exact typed group", () => {
  const env = { ...environment(), AZURE_DELETE_ACKNOWLEDGED: "true", AZURE_DELETE_RESOURCE_GROUP: "rg-modernize-photo-lab" };
  assert.doesNotThrow(() => validateAzureConfig(env, { cleanup: true }));
  assert.throws(() => validateAzureConfig({ ...env, AZURE_DELETE_RESOURCE_GROUP: "rg-modernize-other" }, { cleanup: true }));
  assert.throws(() => validateAzureConfig({ ...env, AZURE_DELETE_ACKNOWLEDGED: "false" }, { cleanup: true }));
  assert.throws(() => validateAzureConfig({ ...env, AZURE_DELETE_RESOURCE_GROUP: "rg-modernize-photo-lab " }, { cleanup: true }));
});

test("foundation output is constrained to the intended registry, databases and application names", () => {
  assert.equal(validateFoundation(foundation()).blobContainerName, "photos");
  assert.throws(() => validateFoundation({ ...foundation(), registryLoginServer: "attacker.example" }));
  assert.throws(() => validateFoundation({ ...foundation(), dotnetAppName: "production" }));
  assert.throws(() => validateFoundation({ ...foundation(), blobContainerName: "other-data" }));
  assert.throws(() => validateImageDigest("latest"));
  assert.throws(() => validateImageDigest(`sha256:${"z".repeat(64)}`));
});

test("readiness rejects login HTML, redirects and unhealthy or arbitrary 200 responses", () => {
  assert.equal(healthyResponse(200, "Healthy"), true);
  assert.equal(healthyResponse(200, '{"status":"ok"}', "application/json; charset=utf-8"), true);
  assert.equal(healthyResponse(200, '{"status":"UP"}', "application/json"), true);
  for (const [status, body, type] of [
    [200, "<html>Login</html>", "text/html"], [302, "Healthy", "text/plain"],
    [503, '{"status":"ok"}', "application/json"], [200, '{"status":"unhealthy"}', "application/json"],
    [200, '{"success":true}', "application/json"], [200, '{"status":"ok"}', "text/html"],
    [200, "", "application/json"], [200, "not-json", "application/json"],
  ]) assert.equal(healthyResponse(status, body, type), false);
});

test("evidence accepts exactly two successful actual-track digests on this commit and run", () => {
  const value = evidence();
  assert.equal(validateEvidence(value, validateWorkflowContext(environment())), value);
  for (const mutate of [
    (item) => { delete item.tracks.java; },
    (item) => { item.tracks.java.smokePassed = false; },
    (item) => { item.tracks.java.smokePassed = "true"; },
    (item) => { item.tracks.java.imageDigest = "latest"; },
    (item) => { item.sourceSha = "c".repeat(40); },
    (item) => { item.repository = "other/repo"; },
    (item) => { item.runId += 1; },
    (item) => { item.runAttempt += 1; },
    (item) => { item.password = "not-allowed"; },
    (item) => { item.tracks.dotnet.connectionString = "not-allowed"; },
    (item) => { item.tracks.java.containerApp = item.tracks.dotnet.containerApp; },
    (item) => { item.tracks.java.url = "https://example.com"; },
    (item) => { item.schemaVersion = 2; },
  ]) {
    const invalid = structuredClone(value);
    mutate(invalid);
    assert.throws(() => validateEvidence(invalid, validateWorkflowContext(environment())));
  }
});

test("a zero-exit health-only or incomplete smoke cannot become deployment evidence", () => {
  const origin = evidence().tracks.dotnet.url;
  const result = {
    track: "dotnet", origin, mode: "functional", status: "passed", functionalSmoke: true,
    checks: ["database-readiness", "authentication", "upload", "list", "download-bytes", "previous-next-navigation", "back-to-gallery", "delete"],
    photosCreated: 2, photosDeleted: 2,
  };
  assert.equal(requireFunctionalSmoke(JSON.stringify(result), "dotnet", origin).photosCreated, 2);
  for (const change of [
    { functionalSmoke: false, mode: "health-only" }, { status: "ok" },
    { photosCreated: 0, photosDeleted: 0 }, { photosDeleted: 1 },
    { checks: ["database-readiness"] }, { track: "java" }, { origin: "https://example.com" },
  ]) assert.throws(() => requireFunctionalSmoke(JSON.stringify({ ...result, ...change }), "dotnet", origin));
  assert.throws(() => requireFunctionalSmoke("Readiness only", "dotnet", origin));
});

test("evidence URLs must identify the actual app and contain no credentials or metadata", () => {
  const { containerApp, url } = evidence().tracks.dotnet;
  assert.equal(validateAppUrl(url, containerApp), url);
  for (const value of [
    url.replace("https:", "http:"), `${url}?token=secret`, `${url}#fragment`,
    `${url}/health`, url.replace("https://", "https://name:password@"),
    `${url}.attacker.example`, url.replace("ca-dotnet-", "ca-java-"),
  ]) assert.throws(() => validateAppUrl(value, containerApp));
});

test("CI gate requires the genuine completed CI workflow and final job on the expected branch SHA", () => {
  const expected = { sourceSha: sha, defaultBranch: "trunk" };
  const run = { id: 100, name: "CI", path: ".github/workflows/ci.yml", head_sha: sha, head_branch: "trunk", event: "push", status: "completed", conclusion: "success" };
  const job = { run_id: 100, name: "CI", status: "completed", conclusion: "success" };
  assert.equal(requireSuccessfulCi([run], [job], expected).id, 100);
  for (const change of [
    { head_sha: "d".repeat(40) }, { head_branch: "feature" }, { event: "pull_request" },
    { path: ".github/workflows/other.yml" }, { conclusion: "failure" }, { status: "in_progress" },
  ]) assert.throws(() => requireSuccessfulCi([{ ...run, ...change }], [job], expected));
  for (const change of [{ conclusion: "skipped" }, { name: "Other" }, { run_id: 101 }]) {
    assert.throws(() => requireSuccessfulCi([run], [{ ...job, ...change }], expected));
  }
  assert.throws(() => requireSuccessfulCi([{ ...run, id: 101, conclusion: "failure" }, run], [job], expected));
  assert.throws(() => requireSuccessfulCi([{ ...run, id: 101, status: "in_progress", conclusion: null }, run], [job], expected));
});

test("command execution surfaces failures and timeouts without logging protected stderr", async () => {
  assert.equal(await run(process.execPath, ["-e", 'process.stdout.write("ok")'], { timeout: 5000 }), "ok");
  await assert.rejects(
    run(process.execPath, ["-e", 'process.stderr.write("sensitive-fixture"); process.exit(7)'], { label: "fixture", timeout: 5000 }),
    (error) => error.message.includes("exit 7") && !error.message.includes("sensitive-fixture"),
  );
  await assert.rejects(run(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 100 }), /timed out/);
});

test("the azure environment must have required reviewers and only the exact default branch", () => {
  const env = {
    protection_rules: [{ type: "required_reviewers", reviewers: [{ reviewer: { id: 1 } }] }],
    deployment_branch_policy: { custom_branch_policies: true },
  };
  const rules = [{ name: "trunk", type: "branch" }];
  assert.doesNotThrow(() => requireProtectedEnvironment(env, rules, "trunk"));
  assert.throws(() => requireProtectedEnvironment({}, rules, "trunk"));
  assert.throws(() => requireProtectedEnvironment({ ...env, protection_rules: [] }, rules, "trunk"));
  for (const policy of [[], [{ name: "*", type: "branch" }], [{ name: "trunk", type: "tag" }], [...rules, { name: "feature", type: "branch" }]]) {
    assert.throws(() => requireProtectedEnvironment(env, policy, "trunk"));
  }
});

async function workflow(name) {
  return parse(await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8"));
}

test("Container Apps probes stay within the selected Azure API's numeric limits", async () => {
  const source = await readFile(new URL("../infra/apps.bicep", import.meta.url), "utf8");
  const probes = source.slice(source.indexOf("var probes ="), source.indexOf("var scale ="));
  const thresholds = [...probes.matchAll(/failureThreshold:\s*(\d+)/g)].map((match) => Number(match[1]));
  const periods = [...probes.matchAll(/periodSeconds:\s*(\d+)/g)].map((match) => Number(match[1]));
  assert.equal(thresholds.length, 2);
  assert.ok(thresholds.every((value) => value >= 1 && value <= 10));
  assert.ok(periods.every((value) => value >= 1 && value <= 240));
  assert.equal(periods[0] * thresholds[0], 600);
});

test("Azure workflows are manual, default-branch-only and SHA-pinned with no root write token", async () => {
  for (const name of ["deploy-azure", "azure-oidc-subject", "cleanup-azure"]) {
    const value = await workflow(name);
    assert.deepEqual(Object.keys(value.on), ["workflow_dispatch"]);
    assert.deepEqual(value.permissions, { contents: "read" });
    for (const job of Object.values(value.jobs)) {
      assert.match(job.if, /github\.event_name == 'workflow_dispatch'/);
      assert.match(job.if, /github\.event\.repository\.default_branch/);
      for (const step of job.steps) {
        if (step.uses) assert.match(step.uses, /^[^@]+@[0-9a-f]{40}$/);
      }
      if (job.permissions?.["id-token"] === "write") assert.equal(job.environment, "azure");
    }
  }
});

test("deployment builds and tests both images before any protected Azure work", async () => {
  const value = await workflow("deploy-azure");
  assert.equal(value.name, "Deploy to Azure");
  assert.equal(value.concurrency.group, "azure");
  assert.equal(value.concurrency["cancel-in-progress"], false);
  assert.equal(value.on.workflow_dispatch.inputs.acknowledge_costs.default, false);
  assert.equal(value.jobs.preflight.permissions["id-token"], undefined);
  assert.equal(value.jobs.preflight.environment, undefined);
  assert.equal(value.jobs.azure.needs, "preflight");
  const preflight = JSON.stringify(value.jobs.preflight);
  assert.match(preflight, /node scripts\/checkpoint\.mjs deploy/);
  assert.match(preflight, /dotnet test apps\/dotnet\/PhotoAlbum\.sln/);
  assert.match(preflight, /apps\/java\/pom\.xml verify/);
  assert.match(preflight, /for track in dotnet java/);
  assert.doesNotMatch(preflight, /secrets\.|azure\/login|docker push|az deployment group create/);
  assert.doesNotMatch(JSON.stringify(value.jobs.azure.steps), /docker build|npm ci/);
  const uploadIndex = value.jobs.azure.steps.findIndex((step) => step.with?.name === "azure-deployment-evidence");
  const revokeIndex = value.jobs.azure.steps.findIndex((step) => step.run?.includes("revoke-smoke-access"));
  assert.ok(revokeIndex > 0 && uploadIndex > revokeIndex);
  assert.match(value.jobs.azure.steps[revokeIndex].if, /always\(\)/);
  assert.equal(value.jobs.azure.steps[uploadIndex].if, undefined);
  assert.equal(value.jobs.azure.steps[uploadIndex].with["retention-days"], 14);
  assert.equal(value.jobs.azure.steps[uploadIndex].with["if-no-files-found"], "error");
  assert.equal(value.jobs.azure.steps[uploadIndex].with.overwrite, true);
});

test("OIDC inspection never prints the token and records only the real non-secret claims", async () => {
  const value = await workflow("azure-oidc-subject");
  const script = value.jobs.claims.steps[0].with.script;
  assert.match(script, /core\.getIDToken\("api:\/\/AzureADTokenExchange"\)/);
  assert.match(script, /core\.setSecret\(token\)/);
  assert.match(script, /JSON\.stringify\(\{ iss, aud, sub \}/);
  assert.doesNotMatch(script, /console\.log|core\.info|setOutput|exportVariable|addCodeBlock\(token/);
  assert.doesNotMatch(JSON.stringify(value), /azure\/login/);
});

test("cleanup is serialized with deployment and asks for an exact group plus separate approval", async () => {
  const value = await workflow("cleanup-azure");
  assert.deepEqual(value.concurrency, { group: "azure", "cancel-in-progress": false });
  assert.equal(value.on.workflow_dispatch.inputs.resource_group.required, true);
  assert.equal(value.on.workflow_dispatch.inputs.acknowledge_deletion.default, false);
  assert.equal(value.jobs.cleanup.environment, "azure");
  const script = await readFile(new URL("../scripts/azure-cleanup.mjs", import.meta.url), "utf8");
  assert.ok(script.indexOf("validateGroupOwnership(group, config)") < script.indexOf('"group", "delete"'));
  assert.match(script, /"group", "delete", "--name", config\.resourceGroup, "--yes"/);
  assert.match(script, /"group", "exists", "--name", config\.resourceGroup/);
  assert.doesNotMatch(script, /--no-wait|--ids|\baz group list\b/);
});

test("infrastructure keeps credentials secure, data private, identities scoped and replicas bounded", async () => {
  const main = await readFile(new URL("../infra/main.bicep", import.meta.url), "utf8");
  const apps = await readFile(new URL("../infra/apps.bicep", import.meta.url), "utf8");
  assert.match(main, /targetScope = 'resourceGroup'/);
  assert.match(apps, /targetScope = 'resourceGroup'/);
  assert.match(main, /adminUserEnabled: false/);
  assert.match(main, /roleAssignmentMode: 'LegacyRegistryPermissions'/);
  assert.match(main, /sku: \{\s+name: 'Basic'/);
  assert.match(main, /scope: photos/);
  assert.match(main, /scope: registry/);
  assert.match(main, /publicNetworkAccess: 'Disabled'/);
  assert.match(main, /allowBlobPublicAccess: false/);
  assert.match(main, /allowSharedKeyAccess: false/);
  assert.match(main, /dailyQuotaGb: 1/);
  assert.match(main, /retentionInDays: 30/);
  assert.match(main, /name: 'Standard_B1ms'/);
  assert.match(main, /workloadProfileType: 'Consumption'/);
  for (const name of ["sqlAdminPassword", "postgresAdminPassword", "dotnetAdminPassword", "javaAdminPassword"]) {
    assert.match(apps, new RegExp(`@secure\\(\\)\\s+param ${name} string`));
  }
  assert.match(apps, /minReplicas: 0/);
  assert.match(apps, /maxReplicas: 1/);
  assert.match(apps, /allowInsecure: false/);
  assert.match(apps, /path: '\/health'/);
  assert.match(apps, /BlobStorage__ServiceUri/);
  assert.match(apps, /SPRING_DATASOURCE_PASSWORD/);
  assert.doesNotMatch(main + apps, /mcr\.microsoft\.com\/.*hello|quickstart|0\.0\.0\.0\/0|TrustServerCertificate=True|publicAccess: 'Blob'/);
});
