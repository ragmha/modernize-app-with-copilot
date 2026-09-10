## Step 1: Establish the baseline and your AI guardrails

Welcome! You are the modernization team for two versions of a photo-album application.
Both must retain their behavior and eventually run in Azure. Start by understanding
what actually exists, rather than asking an agent to rewrite everything.

| Track | Starting point | Required outcome |
| --- | --- | --- |
| ASP.NET Core | .NET 9, EF Core 9, Windows LocalDB configuration, local photo files | .NET 10, Azure SQL, Blob Storage, Container Apps |
| Java | Java 8, Spring Boot 2.7.18, Oracle-specific SQL and binary storage | Java 25, Spring Boot 4.0.x, PostgreSQL, Container Apps |

The .NET app is already ASP.NET Core, **not** a .NET Framework application.
The samples have educational limitations; use synthetic photos and private Codespaces ports.

### Activity

1. [Create a Codespace in **your copy**](https://codespaces.new/{{repository}}). Choose an x64 machine with at least 4 cores and 16 GB RAM. Wait for post-create setup.
2. Sign in to GitHub Copilot in VS Code. Check that your account/policy permits the features you intend to use.
3. Create a branch: `git switch -c lab/baseline`.
4. Run `npm run lab -- doctor`, then test each track separately with `npm run lab -- test dotnet` and `npm run lab -- test java`.
5. Explore one app at a time using its scoped prompt below. Read that app's project files, database configuration, photo services, and tests before switching tracks. Existing tests are a baseline, not proof of successful cloud migration.
6. Read [Copilot guidance](https://github.com/{{repository}}/blob/{{branch}}/.github/copilot-instructions.md) and the provided coach/skill. Create `.github/agents/team-modernizer.agent.md` with `description`, explicit `tools`, and human-approval boundaries. Have it honor the selected track and leave the other app untouched. Keep assessment read-only; require approval before edits, migrations, or provisioning.
7. Create `evidence/01-baseline.md` with these exact second-level headings: `.NET baseline`, `Java baseline`, `Tests`, `Copilot guardrails`. Record concrete observations and command outcomes under each (at least 40 characters per section, no unfinished placeholders). Never paste tokens or passwords.
8. Open a pull request, inspect its diff, wait for **CI**, and merge.

### Choose the prompt for your current track

Run these as separate requests. Each assessment covers only the selected app;
complete both before submitting your baseline report.

#### ASP.NET Core track

```text
Inspect only apps/dotnet without modifying any files. Do not inspect or change
apps/java. Explain this app's framework and EF Core versions, authentication,
photo storage, SQL Server/LocalDB assumptions, and test coverage.
Identify what is known from source versus what needs a runtime check, and cite
the relevant .NET file paths. Return only the ASP.NET Core baseline findings.
Do not run commands, provision Azure resources, or rewrite application behavior.
```

#### Java track

```text
Inspect only apps/java without modifying any files. Do not inspect or change
apps/dotnet. Explain this app's Java and Spring Boot versions, authentication,
photo storage, Oracle-specific database assumptions, and test coverage.
Identify what is known from source versus what needs a runtime check, and cite
the relevant Java file paths. Return only the Java baseline findings.
Do not run commands, provision Azure resources, or rewrite application behavior.
```

For optional local UI exploration, follow [Codespaces services](https://github.com/{{repository}}/blob/{{branch}}/docs/codespaces.md).
Starting SQL Server/Oracle is explicit and requires reviewing their license terms;
the unit-test baseline does not start those services.

The coach watches the default branch after CI. Comment `/check` here if you need to retry.
