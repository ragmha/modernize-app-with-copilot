## Step 5: Automate a bounded modernization review

A GitHub Agentic Workflow is written in Markdown and compiled to a GitHub Actions
workflow. The agent can interpret context; conventional CI still makes deterministic
build/test decisions, and humans still decide whether to accept recommendations.

This exercise includes `modernization-review.md` and its generated `.lock.yml`.
Do not hand-edit the generated lock file.

### Activity

1. Read `.github/workflows/modernization-review.md`. It is manually triggered,
   has read-only repository access, and can create at most one review issue through safe outputs.
2. Tailor its instructions to your assessment, acceptance criteria, and discovered migration risks.
3. Compile it with the pinned gh-aw version:

   ```bash
   npm run compile:review
   ```

4. Inspect and commit both the Markdown changes and generated lock/manifest changes.
   The npm command also pins the runtime action to its release commit.
5. Perform a human review of the findings/expected behavior. Write `evidence/05-agentic-review.md`
   with headings `Workflow boundaries`, `Findings`, `Human decision`.
6. Run `npm run checkpoint -- 5`, review the PR, and merge after CI.

### Optional live agent run

For a personal repository, configure an appropriately scoped `COPILOT_GITHUB_TOKEN`
secret following [the agentic-workflow guide](https://github.com/{{repository}}/blob/{{branch}}/docs/agentic-workflows.md).
Then manually dispatch the review from Actions. This may consume Copilot usage.
Do not put that token in source, an issue, a report, or a Codespaces command history.

Live inference is optional because credential/policy availability differs.
If you do not run it, explicitly label your evidence **manual review; no live agent run**.
Do not claim that compilation performed an AI review.

The agent cannot approve its own suggestions, merge PRs, or deploy Azure.
Prompt instructions are not a security boundary; workflow permissions and safe
outputs enforce the important limits.
