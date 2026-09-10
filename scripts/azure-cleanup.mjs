import { appendFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { az, validateAzureConfig, validateGroupOwnership } from "./azure-lib.mjs";

export async function cleanup(env = process.env) {
  const config = validateAzureConfig(env, { cleanup: true });
  const account = JSON.parse(await az(["account", "show", "--output", "json"]));
  if (account.id !== config.subscriptionId || account.tenantId !== env.AZURE_TENANT_ID ||
      account.environmentName !== "AzureCloud") throw new Error("Authenticated subscription/tenant/cloud does not match this lab.");
  const group = JSON.parse(await az(["group", "show", "--name", config.resourceGroup, "--output", "json"]));
  validateGroupOwnership(group, config);
  // No wildcard, subscription deletion, fallback region, or delete-and-recreate recovery.
  await az(["group", "delete", "--name", config.resourceGroup, "--yes"], { label: "Delete the explicitly confirmed lab resource group" });
  const exists = await az(["group", "exists", "--name", config.resourceGroup, "--output", "tsv"]);
  if (exists !== "false") throw new Error("The lab resource group still exists. Cleanup is not verified.");
  const summary = `Deleted and verified removal of the explicitly confirmed lab resource group \`${config.resourceGroup}\`.\n`;
  console.log(summary.trim());
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const command = process.argv[2] ?? "delete";
    if (command === "validate") validateAzureConfig(process.env, { cleanup: true });
    else if (command === "delete") await cleanup();
    else throw new Error("Usage: node scripts/azure-cleanup.mjs [validate|delete]");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
