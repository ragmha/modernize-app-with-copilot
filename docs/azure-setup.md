# Required Azure deployment: both modernization tracks

This exercise is complete only after **both upgraded applications** run in Azure and pass authenticated upload, read-back, and delete smoke tests from the same current default-branch commit. A local demo, one successful track, an old deployment, or a manually written evidence file does not satisfy this stage.

**Nothing in repository setup provisions Azure.** This page authors the later learner-operated deployment. Do not create resources, identities, permissions, or secrets until you have the subscription owner's approval. Never give Azure credentials to Copilot, a pull request workflow, or an agentic review workflow.

## What the approved workflow will create

The original templates in `infra/` target **one existing resource group**, not a subscription. Names derive from that group's ID and your repository. The workflow never creates, adopts, recreates, or searches for a replacement resource group.

| Component | Lab configuration |
| --- | --- |
| Container Registry | Basic; authenticated public endpoint; admin account and anonymous pull disabled; legacy Azure RBAC mode |
| Container Apps | Two Linux/amd64 application images; Consumption workload profile; 0–1 replicas **per app**; single active revision; HTTPS-only external ingress on port 8080 |
| App identities | Separate user-assigned identities, each with `AcrPull` scoped to this registry |
| ASP.NET persistence | Azure SQL Database Basic, 5 DTUs, 2 GiB; encrypted connection through a private endpoint; public SQL access disabled |
| ASP.NET photos | Standard LRS Blob Storage; private `photos` container and blob private endpoint; public access and account-key authentication disabled |
| Blob permissions | Only the ASP.NET identity gets `Storage Blob Data Contributor`, scoped to the **photos container**, not the account or resource group |
| Java persistence | PostgreSQL Flexible Server 16, `Standard_B1ms` Burstable, 32 GiB; private delegated subnet; TLS required; 7-day backups; no HA or automatic storage growth |
| Networking | One VNet with separate Container Apps, PostgreSQL, and private-endpoint subnets; private DNS links; no public database ports or “allow all Azure services” SQL firewall rule |
| Logs | Log Analytics, 30-day retention, 1 GiB daily ingestion cap |

This is deliberately a small **learning** deployment, not a production reference architecture. Database administrator credentials are used by the apps to simplify the migration exercise. A production design needs least-privilege database users, durable shared authentication/data-protection keys, secret rotation, recovery tests, availability design, monitoring, and stronger end-user identity. Scaling to zero can invalidate in-memory sessions; it must not lose database records or photos.

### Costs are real even at zero app replicas

ACR, both databases, storage, private endpoints, DNS, network infrastructure, and log retention can keep billing when apps are idle. A replica limit and Log Analytics ingestion cap are **not spending caps**. Initial deployment and database provisioning can take tens of minutes. Platform-managed Container Apps infrastructure may appear in an automatically managed resource group; do not edit or independently delete it.

Before approving the workflow, use the [Azure pricing calculator](https://azure.microsoft.com/pricing/calculator/) for your chosen region, confirm the listed SKUs are available, and set a subscription budget/alert with its owner. Budget alerts do not stop resources. Delete the lab after grading. There is no automatic region fallback, SKU escalation, or delete/recreate recovery.

## 1. Protect GitHub before configuring Azure

In **your exercise repository**, not this template:

Template copies do **not** inherit the source repository's environments, reviewers, branch protections, variables, or secrets. Every learner must complete this setup; protecting the source repository does not protect its copies.

1. Protect the repository's actual default branch and require the final **CI** check. Use pull requests and independent review where available; for solo practice, deliberately inspect each diff before merging. Never accept unreviewed workflow changes.
2. Create the GitHub Actions environment named exactly **`azure`**.
3. Add **at least one required reviewer** who can approve the cost and deployment. Prefer preventing self-review and disallowing administrator bypass.
4. Under environment **Deployment branches and tags**, choose **Selected branches and tags** and add exactly **one branch rule** equal to your default branch, usually `main`. Do not add a tag rule, wildcard, or a broad “all protected branches” policy.
5. Keep runtime secrets only in that environment. Do not put them in repository files, Codespaces dotfiles, Copilot secrets, workflow inputs, or logs.

The workflows check required reviewers and the exact branch rule before Azure access. Merely writing `environment: azure` in YAML does not protect an unconfigured environment. On a plan that does not support required reviewers for your repository visibility, resolve that limitation before deployment; do not remove this protection to make the lab pass.

For solo practice, name yourself as the environment reviewer and leave **Prevent self-review** off so you can explicitly approve the deployment. For independent approval, invite a second reviewer and enable it. Formal pull-request approvals also require another person; GitHub does not let you approve your own PR.

All three Azure workflows are **manual `workflow_dispatch` only**, restricted to the repository default branch. Deployment and cleanup share the `azure` concurrency group with `cancel-in-progress: false`.

## 2. Discover the actual OIDC subject — do not guess

Run **Actions → Inspect Azure OIDC subject → Run workflow** on the default branch, then have the environment reviewer approve it. This workflow does not log in to Azure or create resources.

Its summary contains only `iss`, `aud`, and `sub`. It requests the audience `api://AzureADTokenExchange` with `core.getIDToken`, decodes the claims, and **never prints or uploads the JWT**. Copy the three actual summary values into the federated identity credential.

For repositories created after **July 15, 2026**, GitHub's immutable default subject can include both owner and repository IDs; renames/transfers and organization-customized subjects also matter. Older examples of a name-only `repo:...:environment:azure` subject are not reliable for this new repository. The environment subject does not itself prove a default branch: the environment's exact branch rule and the workflow guards are essential. Repeat inspection and review trust deliberately after a rename, transfer, or subject customization.

See GitHub's [immutable subject claims](https://docs.github.com/en/actions/reference/security/oidc#immutable-subject-claims) and [OIDC in Azure](https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure).

## 3. One-time, explicitly approved Azure bootstrap

An Azure administrator can supply an existing dedicated lab identity and group, or perform this setup after approval. This is outside the deployment workflow. It requires authority to create an Entra application/service principal and assign roles. No client secret or certificate is needed.

Use an **otherwise empty, dedicated group** named `rg-modernize-<lab-name>`; the suffix must be 3–45 lowercase letters/digits/hyphens, starting and ending with a letter/digit. Shared, general-purpose, system, and default groups are refused by name and ownership checks.

The following Bash commands illustrate the approved administrator step; fill in your own non-secret identifiers. Run them in your own signed-in CLI, **not through an agent without approval**:

```bash
# Review the account/subscription explicitly before any create command.
az account show --query '{subscription:id,tenant:tenantId,name:name}' -o table
SUBSCRIPTION_ID="<approved-subscription-id>"
TENANT_ID="<approved-tenant-id>"
RESOURCE_GROUP="rg-modernize-<your-lab-name>"
LOCATION="<approved-region>"
REPOSITORY="<your-owner>/<your-exercise-repository>"
az account set --subscription "$SUBSCRIPTION_ID"

az group create --name "$RESOURCE_GROUP" --location "$LOCATION" \
  --tags lab=modernize-app-with-copilot repository="$REPOSITORY"
CLIENT_ID=$(az ad app create --display-name "modernize-lab-oidc" --query appId -o tsv)
PRINCIPAL_ID=$(az ad sp create --id "$CLIENT_ID" --query id -o tsv)
GROUP_ID=$(az group show --name "$RESOURCE_GROUP" --query id -o tsv)

az role assignment create --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal --role Contributor --scope "$GROUP_ID"
az role assignment create --assignee-object-id "$PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Role Based Access Control Administrator" --scope "$GROUP_ID"
```

**Contributor cannot assign Azure roles.** The second role is needed for the narrowly scoped runtime/push assignments created by Bicep. Give both roles only on this lab group, never on the subscription or tenant. If your organization requires conditional RBAC administrator assignments, have its administrator permit exactly the app-identity `AcrPull`, deployment-identity `AcrPush`, and container-scoped blob contributor assignments used here.

The deployment principal also needs **data-plane push rights**. `Contributor` alone is not `AcrPush`. The foundation template assigns `AcrPush` to `AZURE_PRINCIPAL_ID` on the new Basic registry; it separately assigns `AcrPull` to the two runtime identities. The workflow retries brief RBAC propagation delays rather than enabling the registry admin account.

Have a subscription administrator ensure these providers are registered before the lab: `Microsoft.App`, `Microsoft.ContainerService`, `Microsoft.ContainerRegistry`, `Microsoft.ManagedIdentity`, `Microsoft.Network`, `Microsoft.OperationalInsights`, `Microsoft.Sql`, `Microsoft.DBforPostgreSQL`, and `Microsoft.Storage`. Registration is a subscription operation and intentionally is **not** attempted with the group's deployment identity.

Create an Entra federated identity credential on the application using the **actual** issuer, audience, and subject from step 2. The Azure portal's “Other issuer” configuration lets you enter the exact subject instead of accepting a generated legacy subject. Alternatively, save this non-secret JSON under ignored `.lab/federated-identity.json`, replacing each placeholder with the exact inspected value:

```json
{
  "name": "github-azure-environment",
  "issuer": "<actual iss>",
  "subject": "<actual sub>",
  "audiences": ["<actual aud>"]
}
```

Then the approved administrator can run:

```bash
az ad app federated-credential create --id "$CLIENT_ID" \
  --parameters @.lab/federated-identity.json
```

See [Azure workload identity federation](https://learn.microsoft.com/entra/workload-id/workload-identity-federation) and [Bicep role assignments](https://learn.microsoft.com/azure/azure-resource-manager/bicep/scenarios-rbac). Do not use `AZURE_CREDENTIALS`, publish profiles, an ACR admin password, or an application client secret.

## 4. Configure the `azure` environment

### Environment variables (not secrets)

| Variable | Value |
| --- | --- |
| `AZURE_CLIENT_ID` | Entra application's application/client ID used by `azure/login` |
| `AZURE_PRINCIPAL_ID` | **Service principal object ID**, not application/client ID; used for scoped `AcrPush` |
| `AZURE_TENANT_ID` | Approved tenant UUID |
| `AZURE_SUBSCRIPTION_ID` | Approved subscription UUID |
| `AZURE_RESOURCE_GROUP` | Exact existing `rg-modernize-...` group with `lab=modernize-app-with-copilot` and `repository=<your-owner>/<repo>` tags |
| `AZURE_LOCATION` | One approved Azure public-cloud region, e.g. `westeurope`; no automatic fallback |
| `AZURE_ALLOWED_CIDR` | Your browser's **public IPv4 egress** address `/32`, or a deliberately approved canonical `/24`–`/31` network |

The browser CIDR is required. `0.0.0.0/0`, broad networks, private addresses, malformed addresses, and host-bit-set network ranges are rejected. Obtain your real public egress address from your network administrator or your own browser; a Codespace's egress is not necessarily your browser's egress. Corporate VPN changes may require updating the variable and redeploying.

### Environment secrets

Create four distinct passwords with a password manager:

| Secret | Destination |
| --- | --- |
| `SQL_ADMIN_PASSWORD` | Azure SQL `labadmin` and ASP.NET connection-string secret |
| `POSTGRES_ADMIN_PASSWORD` | PostgreSQL `labadmin` and Java datasource secret |
| `DOTNET_ADMIN_PASSWORD` | ASP.NET application admin login |
| `JAVA_ADMIN_PASSWORD` | Java application admin login |

Use 16–128 printable ASCII characters including uppercase, lowercase, a digit, and punctuation; do not include `labadmin` or line breaks. Both **application** usernames are `admin`; database usernames are `labadmin`. These are learner-provided GitHub environment secrets, passed as Bicep `@secure()` parameters into Container Apps secrets. Passwords are never derived from a repository name/hash.

The workflow does not expose these secrets to its build/test job. The deployment job uses short-lived OIDC authentication, stores parameter files and Docker's temporary login configuration only under ignored `.lab/azure/private/`, and removes that directory in `finally`. Do not upload `.lab/azure/`, raw deployment parameters, container environment dumps, or database exports. Only `.lab/deployment.json` is completion evidence.

## 5. Finish the application work before deploying

The baseline Dockerfiles intentionally still use .NET 9 and Java 8. Do **not** deploy those images. `node scripts/checkpoint.mjs deploy`, successful default-branch CI, both upgraded application test suites, and both image builds must all succeed before the privileged job can create paid resources.

### ASP.NET contract

Upgrade the solution, tests, dependencies, and Dockerfile to **.NET 10 / EF Core 10**. Replace LocalDB with the injected Azure SQL connection and replace local photo-file persistence with **Azure Blob Storage**. This is application work, not a connection-string-only change.

| Runtime configuration | Meaning |
| --- | --- |
| `ConnectionStrings__DefaultConnection` | Private Azure SQL endpoint; encryption enabled and server certificate validated |
| `Admin__Username`, `Admin__Password` | Application login; password comes from a Container Apps secret |
| `BlobStorage__ServiceUri` | Storage service endpoint, e.g. `https://<account>.blob.core.windows.net/` |
| `BlobStorage__ContainerName` | Preprovisioned private container, `photos` |
| `AZURE_CLIENT_ID` | **Runtime ASP.NET UAMI** client ID, not the workflow's OIDC client ID |
| `ASPNETCORE_URLS` | Internal listener `http://+:8080`; TLS terminates at Container Apps |
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true`; review forwarded-proxy handling so HTTPS login/CSRF redirects work correctly |

Use `Azure.Identity` / `DefaultAzureCredential` with the specified managed identity and `Azure.Storage.Blobs`. Read/write/delete via the existing container; do not list all accounts/containers or request account keys. Store durable blob keys in SQL and **stream photo reads through the app**. Returning a raw private blob URL to the browser will fail; enabling anonymous blob access or weakening permissions is not a fix.

Implement and test versioned EF migrations and a restart-safe initial schema migration inside the running application/VNet, with appropriate retry handling. Do not run SQL migrations from a public GitHub-hosted runner against an opened database firewall. Rehearse local-file-to-blob and record-key migration using representative fixture data, preserve upload validation, and record the result in the exercise evidence. Extend `/health` to verify both the database and the configured blob container without changing user data.

### Java contract

Upgrade **Java 8 → 25** and **Spring Boot 2.7.18 → 4.0**, including the Dockerfile, build plugins, Jakarta/Security changes, and tests. Replace the Oracle driver/dialect and Oracle-specific SQL; migrate identifier/sequence behavior and binary `BLOB` storage to PostgreSQL-compatible `bytea` mappings. Prove byte-for-byte image round trips against PostgreSQL, not just H2 or a successful JDBC connection.

| Runtime configuration | Meaning |
| --- | --- |
| `SPRING_PROFILES_ACTIVE` | `docker` |
| `SPRING_DATASOURCE_URL` | Private PostgreSQL JDBC URL with `sslmode=verify-full` and `org.postgresql.ssl.DefaultJavaSSLFactory` |
| `SPRING_DATASOURCE_USERNAME`, `SPRING_DATASOURCE_PASSWORD` | `labadmin` and the secret-injected database password |
| `SPRING_DATASOURCE_DRIVER_CLASS_NAME` | `org.postgresql.Driver`; the upgraded image must actually contain the driver |
| `SPRING_JPA_DATABASE_PLATFORM` | `org.hibernate.dialect.PostgreSQLDialect` |
| `SPRING_JPA_HIBERNATE_DDL_AUTO` | **`validate`**, not `create`/`update` |
| `APP_ADMIN_USERNAME`, `APP_ADMIN_PASSWORD` | `admin` and the secret-injected application login password |
| `SERVER_PORT`, `SERVER_FORWARD_HEADERS_STRATEGY` | `8080`, `framework` |

Add versioned PostgreSQL schema/data migrations, for example Flyway with its PostgreSQL database module, that execute inside the application before JPA validates the schema. An empty database will correctly fail without that learner work. Review Oracle data conversion, null/LOB behavior, native queries, backups and rollback rather than merely replacing a URL. The JDBC SSL factory uses the current JDK truststore while preserving hostname/certificate verification; do not use `sslmode=disable`, `trustServerCertificate`, or a non-validating factory.

Neither database is reachable directly from the public workflow runner or a normal Codespace. Local PostgreSQL/SQL development and fixtures belong in the local exercise; cloud schema changes run inside the private deployment boundary. See [pgJDBC SSL](https://jdbc.postgresql.org/documentation/ssl/).

## 6. Run and verify

1. Merge reviewed modernization work to the default branch. Wait for the **CI** workflow and its final **CI** job to succeed on that exact SHA.
2. Open **Actions → Deploy to Azure → Run workflow**. Select the default branch and explicitly acknowledge the costs.
3. The unprivileged job checks environment protections, the current branch SHA, CI, the deployment checkpoint, repository checks, both app test suites, Bicep compilation, and both Docker builds. It uploads **both image archives** from that run with 1-day retention.
4. Review that commit and the resource/cost plan, then approve the **azure** environment job. If the default branch moved while approval was pending, dispatch again; stale approvals do not deploy.
5. The protected job validates configuration and group ownership, creates the foundation, obtains scoped `AcrPush`, pushes the prebuilt images tagged with the commit SHA, resolves their registry manifest digests, and creates both apps **by digest**. It never deploys a public hello-world placeholder, builds with Azure write credentials, or pulls artifacts from another workflow/PR.
6. The runner queries `https://api.ipify.org` **without credentials** to discover its public IPv4. It temporarily adds one `/32` allow rule, `github-smoke-<run-id>`, to each app. This is necessary because browser access is limited to your configured CIDR.
7. It checks the latest ready revision and exact expected image, then requires a real `/health` response, not an HTML login page/redirect/arbitrary HTTP 200. It runs:

   ```bash
   node scripts/smoke-apps.mjs --track dotnet --url "<deployed-dotnet-HTTPS-URL>"
   node scripts/smoke-apps.mjs --track java --url "<deployed-java-HTTPS-URL>"
   ```

   Each invocation receives only its own `SMOKE_ADMIN_USERNAME=admin` / `SMOKE_ADMIN_PASSWORD` and essential process environment. It uses the track's native authentication: ASP.NET form/cookie login with CSRF protection, or Java's stateless HTTP Basic authentication over HTTPS. It uploads two tiny PNGs, reads and checks identical bytes, exercises gallery/previous/next navigation, and verifies deletion of **its own** photos. Java's upstream baseline disables CSRF; review that security choice during modernization rather than claiming this smoke proves CSRF protection for Java.

   The deployment also validates the runner's structured result: expected track and exact origin, `mode: functional`, `functionalSmoke: true`, all required checks, and equal created/deleted photo counts. A zero exit code from `--health-only`, incomplete cleanup, or readiness alone cannot produce completion evidence.
8. A `finally` block removes runner access on success/failure; an additional `always()` workflow step retries revocation. Removal errors fail the job. A force-cancelled/killed runner or Azure outage can still interrupt cleanup: inspect and remove any `github-smoke-*` rule in the two apps immediately, or run approved lab cleanup. Never broaden ingress to troubleshoot.

Only **after both smokes and rule removal succeed** does the workflow write `.lab/deployment.json` and upload artifact **`azure-deployment-evidence`** with **14-day retention**. Its schema is `infra/deployment-evidence.schema.json`: version 1, repository, source SHA, run ID, and both tracks' image digest, Container App name, HTTPS URL and `smokePassed: true`. It has no passwords, tokens, raw parameters, or photo contents.

Finish the exercise grading while the artifact remains available. Download a non-secret copy for your records if desired, but an expired artifact or manually fabricated JSON is not a substitute for a successful current-SHA **Deploy to Azure** run. If you update the default branch or let evidence expire before grading, rerun the required deployment and both smokes.

Evidence includes `runId` **and** `runAttempt`; successful reruns replace the artifact of the same name. An earlier attempt's evidence cannot complete a newer attempt.

## Troubleshooting without weakening the boundary

- **OIDC subject mismatch:** rerun the subject inspector in the same protected environment; compare the actual `iss`/`aud`/`sub`. Do not guess a legacy subject or create a client secret.
- **Role-assignment failure:** verify the service principal **object ID**, group-scoped RBAC administrator permission/conditions and ownership tags. Contributor alone is insufficient.
- **ACR push/pull denied:** allow RBAC propagation; verify scoped `AcrPush`/`AcrPull`, legacy registry RBAC mode and ARM audience authentication. Do not enable ACR admin.
- **Region/SKU/quota denial:** stop and ask the subscription owner to resolve availability in the selected region. Partial resources can still bill. There is no automatic regional retry, larger SKU, group deletion or re-creation.
- **App revision never ready:** inspect protected Azure deployment/container logs. Check migration failures, PostgreSQL bytea/driver compatibility, SQL/Blob DNS, managed identity, and login/forwarded-header handling. Public workflow logs deliberately suppress command output that could echo runtime secrets.
- **Cannot open an app from your browser:** verify your public IPv4/VPN egress matches `AZURE_ALLOWED_CIDR`. No database firewall or anonymous blob exception is needed.
- **One smoke failed:** no evidence artifact is accepted. Fix the relevant migration/upload/read/delete path, merge, pass CI and deploy **both** tracks again.

## 7. Explicit cleanup

After grading, open **Actions → Cleanup Azure lab → Run workflow** on the default branch. Type the exact configured `AZURE_RESOURCE_GROUP`, acknowledge permanent deletion, and obtain environment approval.

The script validates the dedicated name, exact typed match, subscription, tenant, ownership tags and group state **before** calling `az group delete --name <that-exact-group> --yes`. It waits and verifies that group no longer exists. There are no wildcards or subscription-wide deletes. **All lab photos and databases are permanently removed.** Do not put unrelated resources in this group.

Review Azure afterward for completion of platform-managed infrastructure cleanup and expected billing cessation. The independently created Entra application/federated credential is not in the resource group and is not deleted by this workflow; an administrator can explicitly retire that identity and the GitHub environment secrets when no longer needed. Do not revoke the identity before resource cleanup completes.

## First-party references

- [Container Apps VNet integration](https://learn.microsoft.com/azure/container-apps/vnet-custom) and [IP ingress restrictions](https://learn.microsoft.com/azure/container-apps/ip-restrictions)
- [Managed identity image pulls](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull) and [ACR built-in roles](https://learn.microsoft.com/azure/container-registry/container-registry-rbac-built-in-roles-overview)
- [PostgreSQL private networking](https://learn.microsoft.com/azure/postgresql/network/concepts-networking-private)
- [Azure SQL private endpoints](https://learn.microsoft.com/azure/azure-sql/database/private-endpoint-overview)
- [Azure Storage private endpoints](https://learn.microsoft.com/azure/storage/common/storage-private-endpoints) and [blob access with .NET managed identities](https://learn.microsoft.com/azure/storage/blobs/authorize-access-azure-active-directory)
- [Container Apps Bicep schema](https://learn.microsoft.com/azure/templates/microsoft.app/2025-01-01/containerapps) and [ACR Bicep schema](https://learn.microsoft.com/azure/templates/microsoft.containerregistry/2025-11-01/registries)

The templates and this guide are original lab material informed by these sources; they do not redistribute CLI binaries or a proprietary CLI image.
