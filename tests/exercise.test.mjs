import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const exercise = createRequire(import.meta.url)("../.github/scripts/exercise.cjs");
const { relevantCompletion, parseState, stateBody } = exercise;

test("state round-trips and rejects invalid checkpoint numbers", () => {
  assert.deepEqual(parseState(stateBody(3, "learner/repo", "abc")), { schema: 1, step: 3, sha: "abc" });
  assert.equal(parseState("not an exercise"), undefined);
  assert.throws(() => parseState('<!-- modernization-exercise:{"schema":1,"step":999} -->'), /invalid state/);
});

test("privileged coach ignores stale, failed, fork, branch, and unrelated completion events", () => {
  const run = {
    conclusion: "success", head_repository: { full_name: "learner/repo" },
    head_branch: "main", head_sha: "abc", path: ".github/workflows/ci.yml",
  };
  assert.equal(relevantCompletion(run, "learner/repo", "main", "abc"), true);
  for (const mutation of [
    { conclusion: "failure" }, { head_repository: { full_name: "fork/repo" } },
    { head_branch: "feature" }, { head_sha: "old" }, { path: ".github/workflows/imposter.yml" },
  ]) {
    assert.equal(relevantCompletion({ ...run, ...mutation }, "learner/repo", "main", "abc"), false);
  }
});

test("template repositories do not initialize themselves on push", async () => {
  let notice;
  await exercise({
    github: { rest: { repos: { get: async () => ({ data: { is_template: true } }) } } },
    context: { repo: { owner: "author", repo: "template" }, eventName: "push", payload: {} },
    core: { notice: (message) => { notice = message; } },
  });
  assert.match(notice, /learner copies/);
});

test("the canonical author repository stays protected if its template flag is accidentally cleared", async () => {
  let notice;
  await exercise({
    github: { rest: { repos: { get: async () => ({ data: { is_template: false } }) } } },
    context: { repo: { owner: "ragmha", repo: "modernize-app-with-copilot" }, eventName: "push", payload: {} },
    core: { notice: (message) => { notice = message; } },
  });
  assert.match(notice, /learner copies/);
});

test("a copied repository gets a bot issue, the first lesson, and actionable feedback", async () => {
  const created = [];
  const comments = [];
  const listIssues = () => {};
  const listComments = () => {};
  const github = {
    paginate: async (method) => method === listIssues ? created : comments,
    rest: {
      repos: {
        get: async () => ({ data: { is_template: false, has_issues: true, default_branch: "main" } }),
        getBranch: async () => ({ data: { commit: { sha: "abc" } } }),
        getContent: async () => { throw Object.assign(new Error("missing learner work"), { status: 404 }); },
      },
      actions: { listWorkflowRuns: async () => ({ data: { workflow_runs: [] } }) },
      issues: {
        listForRepo: listIssues, listComments,
        create: async ({ body, title }) => {
          const issue = { number: 1, title, body, user: { login: "github-actions[bot]" } };
          created.push(issue);
          return { data: issue };
        },
        createComment: async ({ body }) => {
          const comment = { id: comments.length + 1, body, user: { login: "github-actions[bot]" } };
          comments.push(comment);
          return { data: comment };
        },
      },
    },
  };
  await exercise({
    github,
    context: { repo: { owner: "learner", repo: "repo" }, eventName: "push", payload: { ref: "refs/heads/main" } },
    core: { notice() {} },
  });
  assert.equal(created.length, 1);
  assert.equal(parseState(created[0].body).step, 1);
  assert.ok(comments.some((item) => item.body.includes("modernization-lesson:1")));
  assert.ok(comments.some((item) => item.body.includes("evidence/01-baseline.md")));
});

test("read-only outsiders cannot drive a privileged check", async () => {
  let notice;
  await exercise({
    github: { rest: { repos: {
      get: async () => ({ data: { is_template: false, has_issues: true, default_branch: "main" } }),
      getBranch: async () => ({ data: { commit: { sha: "abc" } } }),
      getCollaboratorPermissionLevel: async () => ({ data: { permission: "read" } }),
    } } },
    context: {
      repo: { owner: "learner", repo: "repo" }, eventName: "issue_comment",
      payload: { issue: {}, comment: { body: "/check", user: { login: "outsider" } } },
    },
    core: { notice: (message) => { notice = message; } },
  });
  assert.match(notice, /Only a repository writer/);
});
