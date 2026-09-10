# A review workflow that reads context without taking over

This exercise adapts the idea from
[skills/agentic-workflows-that-read-the-room](https://github.com/skills/agentic-workflows-that-read-the-room):
a small, well-bounded agent can interpret repository context and offer useful feedback.
It does not replace deterministic CI or a human decision.

The source is `.github/workflows/modernization-review.md`. GitHub runs the compiled
`.github/workflows/modernization-review.lock.yml`. Commit the source, generated lock,
and any compiler-generated action/secret manifest together.

## Author and compile

The pinned authoring version is **gh-aw v0.86.2**:

```bash
gh extension install github/gh-aw --pin v0.86.2
gh aw --version
npm run compile:review
```

The Codespace installs it when absent. If an existing installation uses a different
version, inspect it before deliberately changing it; do not assume compilation is
reproducible across compiler versions.

Review the generated diff. A successful compilation validates the configuration;
it does not call a model or prove that the agent gave good recommendations.
The npm command pins the `github/gh-aw-actions` runtime to the v0.86.2 release
commit `6aab9e5b5c91c615506061f09bedd81a23babe3c`; plain `gh aw compile` can restore
a floating runtime tag, which this repository's checks intentionally reject.
It also verifies the compiler's actual version, not just the requested installation
tag. CI uses the official `linux-amd64` v0.86.2 binary with SHA-256
`b8fd100d1d56a77b842ad28375ff361215a5aa1277db6b9a05d70054cde7260e`,
then invokes it directly through `GH_AW_BINARY`. A preinstalled runner extension
cannot silently substitute a newer compiler. No compiler binary is committed.

## Live inference is separate and optional

For a **personal repository**, follow the
[v0.86.2 authentication documentation](https://github.com/github/gh-aw/blob/v0.86.2/docs/src/content/docs/reference/auth.mdx)
to create a user-owned fine-grained token with **Copilot Requests** permission.
Store it as the Actions secret `COPILOT_GITHUB_TOKEN`. Never use a classic PAT,
commit the token, or put it into the report. Verify that your Copilot plan and
organization policies permit the requested use and billing.

The source explicitly uses `copilot-requests: none`. gh-aw also has an
organization-billed Actions-token inference route using `copilot-requests: write`;
that is not interchangeable with this personal-template setup and should not
be added merely to silence a compiler suggestion.

After reviewing the workflow, manually dispatch **Modernization review** on your
default branch. There are no scheduled, issue-triggered, or PR-triggered model calls.
The agent can read only the current repository's context and create at most one
review issue through safe outputs. Checkout, shell, edit tools, and additional
failure-report issues are explicitly disabled. It has no code-write, merge,
Azure, or deployment authority. Execution is limited to ten turns and fifteen minutes.

Use a nonsecret report to record the workflow run and your decision. If you did not
run live inference, label the result **manual review; no live agent run**.
Compilation and explicit human analysis satisfy this checkpoint; no fake model
output is needed. Azure deployment, in contrast, is mandatory for both tracks.

## Security boundaries

- GitHub tools are read-only; safe-output code alone receives the issue-write capability.
- The output limit is one issue. Read and verify recommendations before acting on them.
- Network access is declared. Repository content is treated as data, not an instruction source.
- Azure OIDC and database/runtime secrets are not used by this workflow.
- Do not embed a Modernize CLI execution inside this agent and assume its inference
  credential is available to shell tools. Those are different authentication paths.

Source: [GitHub Agentic Workflows](https://github.github.com/gh-aw/).
