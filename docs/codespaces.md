# Codespaces and the local baseline

Open a Codespace in **your generated exercise repository**, not in the template.
Use Linux x64, at least 4 cores/16 GB RAM, and enough storage for both SDKs and databases.
The configuration installs .NET 9/10, JDK 8/25, Maven, Node, GitHub CLI, Azure CLI,
and Docker-in-Docker. Runtime channels receive servicing updates; application
source snapshots are pinned independently in `samples.lock.json`.

Post-create installs exercise tooling, creates an ignored `.env` with random
exercise-only passwords, and installs pinned gh-aw if it is absent. It does not
sign in to Azure, install the proprietary Modernize CLI, start databases, or deploy.
Rebuilding preserves an existing `.env`; it never silently rotates credentials.

```bash
npm run lab -- doctor
npm run lab -- test both
```

The Java helper selects the JDK matching `java.version` in the POM. Do not force
the Java 8 baseline onto JDK 25 and interpret that failure as a source defect.
The upstream POM spells Java 8 as `1.8`; the helper normalizes that notation
without editing the pinned baseline.
Fast .NET tests use EF InMemory; the original Java test uses H2. These tests do
not prove real SQL Server/Oracle/PostgreSQL behavior.

## Optional local application UI

The baseline requires real local databases to exercise the UI. Before starting
SQL Server Developer and Oracle Free, read and accept their applicable terms:

- [SQL Server container quickstart and EULA](https://learn.microsoft.com/sql/linux/quickstart-install-connect-docker)
- [Oracle Database Free licensing](https://www.oracle.com/database/free/)
- [Oracle Free container documentation](https://github.com/gvenzl/oci-oracle-free)

Then, in a Codespaces terminal:

```bash
ACCEPT_SQLSERVER_EULA=Y ACCEPT_ORACLE_TERMS=Y npm run lab -- services:start
npm run lab -- services:status
```

The command waits for healthy databases. The Java container's built-in application
user initialization targets `FREEPDB1`; obsolete upstream `XE` init scripts are not used.
After the Java dependency migration, the helper selects PostgreSQL instead of Oracle.
Database images are pinned to reviewed Linux x64 digests; review and update those
pins deliberately before an organized workshop.

Run each app in a separate terminal:

```bash
npm run lab -- run dotnet
```

```bash
npm run lab -- run java
```

Use VS Code's **Ports** tab to open 5134 (.NET) and 8080 (Java). Codespaces ports
are private by default; confirm and keep both **private** in that tab. Visibility
is a Codespaces control, not a supported `portsAttributes.visibility` setting.
Database ports bind only to loopback and are not automatically forwarded.
Use the exercise-only administrator password in your ignored `.env`; never paste
the file into an issue, report, screenshot, commit, or shared terminal recording.
ASP.NET uses form/cookie login; Java's baseline uses HTTP Basic. The .NET upload
page is initially public but anti-forgery-protected, and Java disables CSRF upstream.
These are explicit assessment topics, not production security guarantees.

The source baseline .NET LocalDB connection is Windows-specific. The run helper
supplies a Linux SQL Server connection via environment variables without disguising
this portability adaptation as the learner's cloud migration.

The functional runner accepts an application URL and an administrator password in
`SMOKE_ADMIN_PASSWORD`; see its `--help` or source for usage. Use only the generated
exercise data. Remote smoke targets must use HTTPS.

## Stop and troubleshoot

```bash
npm run lab -- services:stop
```

This stops containers without deleting photo/database volumes. Do not use
`docker compose down --volumes` unless you deliberately intend to destroy lab data.
Stop the Codespace when finished; stopped databases do not stop Codespaces billing.

If post-create fails, inspect its log, address the failed download/policy/tool, then
rerun `bash .devcontainer/post-create.sh`. Rebuild the devcontainer after changing
features. A recovery-mode Codespace is not evidence that setup succeeded.

For memory pressure, stop the unused database/app, or choose a larger Codespace.
If an organization prevents Docker, Copilot, MCP, extensions, or image pulls, an
administrator must resolve that policy; do not bypass it.

## MCP and modernization CLI

`.vscode/mcp.json` configures Microsoft's public documentation MCP endpoint. VS Code
may require trust/approval before starting it. It is not Azure authentication and
does not grant deployment access.

The optional pinned `scripts/install-modernize.sh` uses a reviewed release/hash.
Do not include that proprietary CLI bundle in this repository or publish it in a
derived container image. The normal Copilot Chat path is sufficient for the lessons.

Sources: [Dev containers](https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/introduction-to-dev-containers),
[feature definitions](https://github.com/devcontainers/features),
[Modernize CLI](https://github.com/microsoft/modernize-cli).
