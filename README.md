# Modernize applications with GitHub Copilot

Modernize **both** an ASP.NET Core application and a Java application, from
assessment through a reviewed deployment to **Azure Container Apps**, using
GitHub Copilot, GitHub Codespaces, and GitHub Actions.

[![Copy Exercise](https://img.shields.io/badge/Copy_Exercise-%E2%86%92-1f883d?style=for-the-badge&logo=github&labelColor=197935)](https://github.com/new?template_owner=ragmha&template_name=modernize-app-with-copilot&owner=%40me&name=my-app-modernization&description=Hands-on+ASP.NET+and+Java+modernization+with+GitHub+Copilot&visibility=public)

## Welcome

This is a community **GitHub Skills-style** adaptation of Microsoft's app-modernization
MicroHack, not an official GitHub Skills course or a production-ready application.
It uses pinned, attributed Azure sample source rather than unrelated replacement demos.

| Track | Real starting point | Required learner result |
| --- | --- | --- |
| ASP.NET Core PhotoAlbum | .NET 9 / EF Core 9; Windows LocalDB configuration; local photo files | .NET 10 / EF Core 10; Azure SQL; private Blob Storage with managed identity; Azure Container Apps |
| Java PhotoAlbum | Java 8 / Spring Boot 2.7.18; Oracle SQL and binary storage | Java 25 / Spring Boot 4.0.x; PostgreSQL; Azure Container Apps |

**Who:** developers comfortable with Git, pull requests, and basic .NET/Java concepts.
**Time:** plan for 4-6 hours, plus Azure identity/setup and deployment time.
**Prerequisites:** a GitHub account, Copilot access and sufficient usage allowance,
Codespaces/Actions availability, and an Azure subscription with an administrator
able to configure scoped lab permissions and OIDC federation.

### Start in your own copy

1. Use **Copy Exercise** above or **Use this template -> Create a new repository**.
   Create a new repository, not a fork. Public repositories simplify sharing;
   private repositories consume the applicable Actions allowance.
2. Leave Issues and Actions enabled. After the initial workflows run, open the
   **Exercise: Modernize both apps with Copilot** issue in **your new repository**.
3. Follow its **Open Codespace** link, or use **Code -> Codespaces** in your new repository.
   The issue link is generated for your copy; do not work in the author's template.
4. Follow the lesson comments. Submit changes through reviewed pull requests.
   The coach checks the default branch after CI; repository writers can comment `/check`.

If the issue does not appear, inspect [Actions](../../actions), then manually run
**Exercise coach** with `preview` left false. Organization policies may require an
administrator to enable a tool or approve a first workflow run.

## Learning journey

| Checkpoint | Work | How progress is established |
| --- | --- | --- |
| 1. Baseline and guardrails | Inspect both apps; run tests; author a bounded custom agent | Learner evidence, agent file, successful current-commit CI |
| 2. Assess and plan | Use Copilot or Modernize; identify cloud blockers; obtain human approval | Both assessment reports and reviewed plan |
| 3. Upgrade | .NET 10/EF 10 and Java 25/Boot 4.0; preserve behavior | Project/container consistency plus real builds and tests |
| 4. Migrate dependencies | Azure SQL/Blob and Oracle-to-PostgreSQL changes | Code/configuration checks, regression tests, migration evidence |
| 5. Agentic review | Adapt and compile a read-only gh-aw review with bounded safe outputs | Compiled workflow and an explicitly human-reviewed decision |
| 6. Deploy both | Approve provisioning/deployment and run functional smoke tests in Azure | Verified deployment run and evidence for **both apps at the same source commit** |

All [lessons](.github/steps) are readable offline. The issue coach is a convenience,
not an authority to change cloud permissions or bypass human review. Structural
report checks do not assess the quality of your engineering reasoning.

## What is ready, and what you build

The repository supplies the real baseline applications, Codespaces toolchains,
local database setup, a six-checkpoint issue coach, deterministic CI, a compiled
agentic-review example, Azure infrastructure/deployment workflows, and smoke tooling.

**The application upgrades and cloud migrations are intentionally not pre-solved.**
The deployment preflight rejects the baseline until the required learner work
and evidence are present. Completing only one language track does not graduate.

- [Codespaces, local services, and troubleshooting](docs/codespaces.md)
- [Required Azure setup, configuration, deployment, and cleanup](docs/azure-setup.md)
- [Agentic workflow boundaries and optional live inference](docs/agentic-workflows.md)
- [Maintainer guide and reference mapping](docs/maintainers.md)
- [Source provenance](samples.lock.json) and [third-party notices](third_party/README.md)

## Costs and safety

**Both Azure deployments are required, but copying this template provisions nothing.**
Azure execution is manual, protected by an environment approval, and authenticated
using OIDC rather than an Azure client secret. Configure the dedicated lab identity,
variables, secrets, allowed network, and reviewer before dispatch.

Codespaces, Copilot, Actions, and Azure have separate allowances and charges.
Databases, registry, storage, and logs can incur charges even with Container Apps
scaled to zero. Budgets/alerts are not hard spending caps. Use synthetic data,
stop the Codespace, and deliberately clean up the lab when finished.

The normal Actions tests/coach do not require Copilot or Azure secrets. Running
the optional live agentic review uses separate Copilot authentication and usage.
Never expose real/customer photos, production credentials, or an unrestricted
sample administrator endpoint.

## References and attribution

Inspired by the authoring conventions and learning patterns in
[skills/exercise-creator](https://github.com/skills/exercise-creator),
[skills/exercise-template](https://github.com/skills/exercise-template),
[modernize-your-legacy-code-with-github-copilot](https://github.com/skills/modernize-your-legacy-code-with-github-copilot),
and [agentic-workflows-that-read-the-room](https://github.com/skills/agentic-workflows-that-read-the-room).

Curriculum adapted from
[Microsoft MicroHack: GHCP App Modernization](https://github.com/microsoft/MicroHack/tree/19cb6b0fd3ec53e35afd96786149b2bed50c839c/03-Azure/01-01-App%20Innovation/03_GHCPAppModernization).
Applications originate from [Azure-Samples/PhotoAlbum](https://github.com/Azure-Samples/PhotoAlbum)
and [Azure-Samples/PhotoAlbum-Java](https://github.com/Azure-Samples/PhotoAlbum-Java).
Their licenses and bundled notices are retained. See [LICENSE](LICENSE) and the
provenance ledger for scope and maintainer adaptations.
