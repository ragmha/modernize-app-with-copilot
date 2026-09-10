## Step 2: Assess and plan both applications

Assessment explains the starting point; a plan turns findings into small, reviewable
changes with acceptance criteria. Do not confuse generating a plan with executing it.

The provided MicroHack agents/templates use inconsistent historical targets.
For this exercise, use **.NET 10** and **Java 25 / Spring Boot 4.0.x**.

### Activity

1. Create `lab/assessment` from the updated default branch.
2. Use Copilot Chat and the read-only modernization coach to assess both applications.
3. Optionally install the pinned Modernize CLI with `bash scripts/install-modernize.sh --accept-license` after reading its linked terms. This downloads the official distribution for your use; the repository does not redistribute it.
4. With Modernize installed and GitHub authentication configured, run:

   ```bash
   modernize assess --source apps/dotnet --source apps/java --format markdown
   ```

5. Read the report critically. Investigate database, file persistence, authentication, secrets, obsolete packages, deployment, and test coverage.
6. Create `evidence/02-assessment.md` with headings `.NET assessment`, `Java assessment`, `Cloud blockers`.
7. Create `evidence/02-plan.md` with headings `Changes`, `Acceptance criteria`, `Rollback`, `Human approval`. Name the human reviewer and record approval or requested revisions. Include actual upload/read/delete and persistence checks, not just an HTTP homepage check.
8. Open, review, and merge the pull request after CI.

Example planning commands, **not execution commands**:

```bash
modernize plan create "Upgrade PhotoAlbum to .NET 10, preserve behavior, and prepare Azure SQL and Blob Storage for Azure Container Apps. Do not provision yet." --source apps/dotnet --plan-name dotnet-modernization
modernize plan create "Upgrade to Java 25 and Spring Boot 4.0, migrate Oracle queries and binary storage to PostgreSQL, preserve behavior, and prepare Azure Container Apps. Do not provision yet." --source apps/java --plan-name java-modernization
```

Mixed-language assessment is supported. Upgrade the languages **separately**.
Modernize authentication and Azure OIDC are different; an ordinary repository
`GITHUB_TOKEN` is not a universal Copilot credential.

The coach checks report structure and current CI, not the truth of your reasoning.
You and your reviewer remain responsible for the assessment.
