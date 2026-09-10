const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { evaluateStep } = require("./checkpoints.cjs");

const STATE = /<!-- modernization-exercise:(\{[^\n]+\}) -->/;
const FEEDBACK = "<!-- modernization-exercise-feedback -->";
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/deploy-azure.yml"];
const LESSONS = [
  "", "1-baseline.md", "2-assessment.md", "3-upgrade.md",
  "4-migration.md", "5-agentic-review.md", "6-azure.md", "7-finish.md",
];

function parseState(body) {
  const value = body?.match(STATE)?.[1];
  if (!value) return undefined;
  const state = JSON.parse(value);
  if (state.schema !== 1 || !Number.isInteger(state.step) || state.step < 1 || state.step > 7) {
    throw new Error("The exercise issue has invalid state. Restore its original state marker before retrying.");
  }
  return state;
}

function relevantCompletion(run, repository, branch, sha) {
  return run?.conclusion === "success" && run.head_repository?.full_name === repository &&
    run.head_branch === branch && run.head_sha === sha && WORKFLOWS.includes(run.path);
}

function stateBody(step, repository, sha) {
  return [
    "# Modernize both applications with GitHub Copilot",
    `<!-- modernization-exercise:${JSON.stringify({ schema: 1, step, sha })} -->`,
    step === 7 ? "**Exercise complete: both applications deployed and smoke-tested in Azure.**" :
      `**Current checkpoint: ${step} of 6.** Follow the lesson comments below.`,
    "Work on a branch in Codespaces, open a pull request, wait for CI, and merge your reviewed changes.",
    "The coach checks the default branch after CI. A repository writer can comment `/check` to retry.",
    "No Azure resource is created by copying this exercise. Deployment requires your explicit configuration and approval.",
    `[Actions](https://github.com/${repository}/actions) | [Curriculum](https://github.com/${repository}/tree/HEAD/.github/steps)`,
  ].join("\n\n");
}

async function exercise({ github, context, core }) {
  const { owner, repo } = context.repo;
  const repository = `${owner}/${repo}`;
  const metadata = (await github.rest.repos.get({ owner, repo })).data;
  const preview = context.eventName === "workflow_dispatch" && String(context.payload.inputs?.preview) === "true";
  if ((metadata.is_template || repository === "ragmha/modernize-app-with-copilot") && !preview) {
    core.notice("Template source: the exercise starts in learner copies. Dispatch with preview=true to preview the coach here.");
    return;
  }
  if (!metadata.has_issues) throw new Error("Enable Issues in repository settings so the exercise coach can post lessons.");
  const branch = metadata.default_branch;
  const sha = (await github.rest.repos.getBranch({ owner, repo, branch })).data.commit.sha;
  if (context.eventName === "push" && context.payload.ref !== `refs/heads/${branch}`) return;
  if (context.eventName === "workflow_run" &&
      !relevantCompletion(context.payload.workflow_run, repository, branch, sha)) {
    core.notice("Ignoring a failed, stale, foreign, or unrelated workflow completion.");
    return;
  }
  if (context.eventName === "issue_comment") {
    if (context.payload.issue.pull_request || context.payload.comment.body.trim() !== "/check") return;
    const permission = (await github.rest.repos.getCollaboratorPermissionLevel({
      owner, repo, username: context.payload.comment.user.login,
    })).data.permission;
    if (!["admin", "maintain", "write"].includes(permission)) {
      core.notice("Only a repository writer may request an exercise check.");
      return;
    }
  }

  const issues = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: "all", per_page: 100 });
  let issue = issues.find((item) => !item.pull_request && item.user?.login === "github-actions[bot]" && STATE.test(item.body ?? ""));
  const lesson = (step) => fs.readFileSync(path.join(__dirname, "..", "steps", LESSONS[step]), "utf8")
    .replaceAll("{{repository}}", repository).replaceAll("{{branch}}", branch);
  if (!issue) {
    issue = (await github.rest.issues.create({
      owner, repo, title: "Exercise: Modernize both apps with Copilot", body: stateBody(1, repository, sha),
    })).data;
  }
  if (context.eventName === "issue_comment" && context.payload.issue.number !== issue.number) return;
  let state = parseState(issue.body);
  if (!state) throw new Error("Exercise issue state is missing.");
  if (state.step === 7) {
    core.notice("This exercise is already complete.");
    return;
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    owner, repo, issue_number: issue.number, per_page: 100,
  });
  async function postLesson(step) {
    const marker = `<!-- modernization-lesson:${step} -->`;
    if (!comments.some((comment) => comment.user?.login === "github-actions[bot]" && comment.body.includes(marker))) {
      const comment = (await github.rest.issues.createComment({
        owner, repo, issue_number: issue.number, body: `${marker}\n${lesson(step)}`,
      })).data;
      comments.push(comment);
    }
  }
  await postLesson(state.step);

  const cache = new Map();
  async function readText(filePath) {
    if (!cache.has(filePath)) {
      try {
        const file = (await github.rest.repos.getContent({ owner, repo, path: filePath, ref: sha })).data;
        if (Array.isArray(file) || file.type !== "file" || file.encoding !== "base64" || file.size > 1_000_000) {
          throw new Error(`Expected a small, ordinary text file: ${filePath}`);
        }
        cache.set(filePath, Buffer.from(file.content, "base64").toString("utf8"));
      } catch (error) {
        if (error.status !== 404) throw error;
        cache.set(filePath, undefined);
      }
    }
    return cache.get(filePath);
  }
  let tree;
  async function listPaths() {
    if (!tree) {
      const response = (await github.rest.git.getTree({ owner, repo, tree_sha: sha, recursive: "1" })).data;
      if (response.truncated) throw new Error("The repository tree is too large for the exercise grader.");
      tree = response.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
    }
    return tree;
  }
  async function latestRun(workflow, event) {
    const runs = (await github.rest.actions.listWorkflowRuns({
      owner, repo, workflow_id: workflow, head_sha: sha, branch, event, per_page: 20,
    })).data.workflow_runs;
    return runs.find((run) => run.head_sha === sha && run.head_repository?.full_name === repository && run.head_branch === branch);
  }
  const ci = await latestRun("ci.yml", "push");
  const ciPassed = ci?.conclusion === "success";
  let azureEvidence;
  let deploymentRun;
  if (state.step <= 6 && ciPassed) {
    deploymentRun = await latestRun("deploy-azure.yml", "workflow_dispatch");
    if (deploymentRun?.conclusion === "success") {
      const artifacts = await github.paginate(github.rest.actions.listWorkflowRunArtifacts, {
        owner, repo, run_id: deploymentRun.id, per_page: 100,
      });
      const artifact = artifacts.find((item) => item.name === "azure-deployment-evidence" && !item.expired);
      if (artifact) {
        if (artifact.size_in_bytes > 2_000_000) throw new Error("Unexpectedly large deployment evidence artifact.");
        const response = await github.rest.actions.downloadArtifact({ owner, repo, artifact_id: artifact.id, archive_format: "zip" });
        const directory = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "exercise-evidence-"));
        const archive = path.join(directory, "evidence.zip");
        try {
          fs.writeFileSync(archive, Buffer.from(response.data));
          // Read one bounded data member without extracting files or executing artifact content.
          const json = execFileSync("unzip", ["-p", archive, "deployment.json"], { encoding: "utf8", timeout: 10_000, maxBuffer: 65_536 });
          azureEvidence = JSON.parse(json);
        } finally {
          if (fs.existsSync(archive)) fs.unlinkSync(archive);
          fs.rmdirSync(directory);
        }
      }
    }
  }

  while (state.step <= 6) {
    const result = await evaluateStep(state.step, {
      readText, listPaths, ciPassed, azureEvidence, repository, sha,
      runId: deploymentRun?.id, runAttempt: deploymentRun?.run_attempt,
    });
    if (!result.passed) {
      const body = `${FEEDBACK}\n### Checkpoint ${state.step}: not ready yet\n\n${result.problems.map((problem) => `- ${problem}`).join("\n")}\n\nChecked commit \`${sha.slice(0, 12)}\`. Review the current lesson, then merge your fixes or comment \`/check\`.`;
      const feedback = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.body.includes(FEEDBACK));
      if (feedback) {
        if (feedback.body !== body) await github.rest.issues.updateComment({ owner, repo, comment_id: feedback.id, body });
      } else {
        await github.rest.issues.createComment({ owner, repo, issue_number: issue.number, body });
      }
      core.notice(`Checkpoint ${state.step} needs learner work.`);
      return;
    }
    const currentSha = (await github.rest.repos.getBranch({ owner, repo, branch })).data.commit.sha;
    if (currentSha !== sha) {
      core.notice("The default branch moved during grading; wait for CI on the new commit.");
      return;
    }
    state = { ...state, step: state.step + 1 };
    await github.rest.issues.update({
      owner, repo, issue_number: issue.number, body: stateBody(state.step, repository, sha),
      ...(state.step === 7 ? { state: "closed", state_reason: "completed" } : {}),
    });
    await postLesson(state.step);
  }
  const feedback = comments.find((comment) => comment.user?.login === "github-actions[bot]" && comment.body.includes(FEEDBACK));
  if (feedback) {
    await github.rest.issues.updateComment({
      owner, repo, comment_id: feedback.id, body: `${FEEDBACK}\nAll six checkpoints passed for \`${sha.slice(0, 12)}\`. Both Azure functional smoke results are recorded in deployment run ${deploymentRun.id}.`,
    });
  }
}

module.exports = exercise;
module.exports.parseState = parseState;
module.exports.relevantCompletion = relevantCompletion;
module.exports.stateBody = stateBody;
