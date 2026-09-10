# Maintaining and facilitating this exercise

## Reference mapping

| Reference | Applied pattern | Deliberate adaptation |
| --- | --- | --- |
| [Exercise Creator](https://github.com/skills/exercise-creator) | Audience/objectives, progressive theory/activity/feedback, human refinement | A six-checkpoint dual-track curriculum rather than a generic generated outline |
| [Exercise Template](https://github.com/skills/exercise-template) | Copy-exercise entry point, template repository, issue-driven lessons | A small Node/REST coach, no workflow-enabling cascade or README-writing token |
| [Legacy-code modernization exercise](https://github.com/skills/modernize-your-legacy-code-with-github-copilot) | Understand a real legacy app, preserve behavior, modernize with Copilot | Actual PhotoAlbum .NET and Java sources, not the reference's COBOL/Node application |
| [Agentic workflows exercise](https://github.com/skills/agentic-workflows-that-read-the-room) | Context-aware, narrow agent task and bounded output | One manually requested modernization-review issue; no unattended deployment authority |
| [Microsoft MicroHack](https://github.com/microsoft/MicroHack/tree/19cb6b0fd3ec53e35afd96786149b2bed50c839c/03-Azure/01-01-App%20Innovation/03_GHCPAppModernization) | Foundations -> assessment/upgrades -> cloud migration/deployment | Linux Codespaces baseline, deterministic Actions, scoped OIDC, both Azure outcomes mandatory |

The custom coach intentionally avoids a second set of step workflows and
write-to-README state transitions. It uses `issues: write` only to teach and
`actions: read` to check trusted results. Conventional CI has read-only access.
This is compatible with default read-only workflow permissions; no repository-wide
write-token setting or automatic PR approval is required.

The creator recommends at most five short steps and about an hour. This workshop
deliberately extends that to six multi-hour checkpoints because the requested
outcome includes two technology stacks and two real Azure deployments.

The reference review used these snapshots:

| Repository | Commit |
| --- | --- |
| skills/exercise-creator | `0cd52d0c2abc1296945258c2c662eb82a5e6b328` |
| skills/exercise-template | `fd6e4ab0aa6fa78bdfd44cc84fb4cb594f690e0d` |
| skills/modernize-your-legacy-code-with-github-copilot | `5172a5c58cfa7e25480981ca0b72c4714ff99754` |
| skills/agentic-workflows-that-read-the-room | `33622ce1d008b8dce6a1ee84963481850f2c0a30` |

Their MIT-licensed pedagogical patterns informed the original curriculum here.
The source coach does not copy the reference modernization grader's superficial
file checks as a substitute for executing tests, or treat a closed unmerged PR as success.

## Template behavior

The remote **Template repository** setting must remain enabled. The README copy
URL must use `template_owner=ragmha&template_name=modernize-app-with-copilot`.
That setting lives on GitHub, not in a file.

The coach inspects `is_template` and also excludes the canonical author's repository,
so an accidentally cleared template setting cannot start it.
A learner-generated copy is not a template and initializes on its default-branch
push. To preview lessons here, manually dispatch **Exercise coach** with
`preview=true`. Do not fabricate upgraded code or Azure evidence to make the
authoring template appear graduated.

Template copies do not inherit Azure environments, protection rules, federated
credentials, secrets, or runtime data. Every learner must perform Azure setup.
The template's README deliberately avoids a Codespaces badge hard-coded to the
author's repository; the issue supplies a copy-specific link.

## Coach and grading boundaries

`.github/scripts/exercise.cjs` checks only the trusted default branch.
It never checks out a PR head in its write-enabled job. It rejects stale,
failed, foreign-repository, non-default-branch, and unrelated workflow completions.
Only repository writers can request `/check`; arbitrary issue content is not
interpolated into shell commands.

`.github/scripts/checkpoints.cjs` is shared with the local checkpoint command.
Reports are checked structurally; humans assess their substance. Runtime/version
guards catch common mistakes but are not a production audit.

Completion requires the latest successful `ci.yml` **push** run on the exact
default-branch SHA and a successful `deploy-azure.yml` **workflow_dispatch** run
for that SHA. The coach reads only the bounded `deployment.json` data member
from the `azure-deployment-evidence` artifact, checks repository/run identity,
and requires both track results from the current run attempt. It does not execute artifact content.

## Validation and updates

```bash
npm ci --ignore-scripts
npm run verify
npm run lab -- test both
npm run compile:review
```

CI covers exercise automation, each application's tests, both container builds,
and Bicep compilation without Azure login. **Codespaces image** builds and runs
the actual devcontainer without publishing it or starting database services.
An approved learner deployment is the separate end-to-end cloud validation.

Retain the intentionally older baseline versions until revising the curriculum.
Do not let a dependency bot silently solve or change the starting exercise.
When updating snapshots, review upstream changes and licenses, refresh
`samples.lock.json` and the adaptation ledger, then replay a fresh learner copy.
Never overwrite a learner's edited app directories with a bootstrap script.

`.gitattributes` preserves vendored application/license bytes so checkout does
not change the recorded snapshot hashes through line-ending normalization.
Exercise tooling and documentation use LF.

Keep action references at full commit SHAs and local database images at reviewed
Linux x64 digests. The compiled gh-aw workflow's metadata contains source hashes,
runtime/action/container pins, and required secret names. Regenerate it with
`npm run compile:review`; do not hand-edit its embedded runtime.

Before a facilitated workshop, verify subscription quota, region availability,
organizational Copilot/Codespaces/Actions policies, artifact retention, image
availability, and Azure environment approvals. Have learners estimate cost and
identify exactly which resource group cleanup will destroy.

## Known scope limits

- Actual .NET Framework applications require Windows; this sample is ASP.NET Core.
- The original unit tests are deliberately limited. Learners add behavioral and target-database coverage.
- Local SQL Server/Oracle require explicit license acceptance; they are not auto-started.
- Live agentic inference is optional and separately credentialed. Both Azure deployments are mandatory.
- The modernization CLI is proprietary and downloaded only on an explicit learner action.
- The source samples are learning material, not production security or operational certification.
- Azure resources are not created during template authoring; subscription-specific deployment is
  performed and evidenced by each learner's approved workflow.
