import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { evaluateStep, deploymentProblems, reportProblems, REPORTS } = createRequire(import.meta.url)("../.github/scripts/checkpoints.cjs");

function context(files = {}, extra = {}) {
  return { readText: async (path) => files[path], listPaths: async () => Object.keys(files), ciPassed: true, ...extra };
}
function report(headings) {
  return headings.map((heading) => `## ${heading}\nConcrete observations, commands, outcomes, and a deliberate human decision for this track.`).join("\n\n");
}
function completeEvidence() {
  return {
    schemaVersion: 1, repository: "learner/exercise", sourceSha: "a".repeat(40), runId: 123, runAttempt: 1,
    tracks: Object.fromEntries(["dotnet", "java"].map((track) => [track, {
      containerApp: `album-${track}`, url: `https://album-${track}.example.azurecontainerapps.io`,
      imageDigest: `sha256:${"b".repeat(64)}`, smokePassed: true,
    }])),
  };
}
const identity = { repository: "learner/exercise", sha: "a".repeat(40), runId: 123, runAttempt: 1 };

test("reports need every heading and substantive non-placeholder text", () => {
  const headings = REPORTS[1][0][1];
  assert.deepEqual(reportProblems("report.md", report(headings), headings), []);
  assert.equal(reportProblems("report.md", undefined, headings).length, 1);
  assert.ok(reportProblems("report.md", `${report(headings)}\nTODO finish`, headings).length);
  assert.ok(reportProblems("report.md", "## Tests\nfine", headings).length);
});

test("baseline requires learner-authored agent, both tracks, and current CI", async () => {
  const files = {
    "evidence/01-baseline.md": report(REPORTS[1][0][1]),
    ".github/agents/team-modernizer.agent.md": "---\ndescription: Plan both tracks\ntools: [read]\n---\nRequire human approval.",
  };
  assert.equal((await evaluateStep(1, context(files))).passed, true);
  assert.equal((await evaluateStep(1, context(files, { ciPassed: false }))).passed, false);
  delete files[".github/agents/team-modernizer.agent.md"];
  assert.equal((await evaluateStep(1, context(files))).passed, false);
});

test("a version-only Java edit and a one-track upgrade do not pass", async () => {
  const result = await evaluateStep(3, context({ "apps/java/pom.xml": "<java.version>25</java.version>" }));
  assert.equal(result.passed, false);
  assert.ok(result.problems.some((problem) => problem.includes("net10.0")));
  assert.ok(result.problems.some((problem) => problem.includes("Spring Boot")));
});

test("coherent two-track framework and container changes pass", async () => {
  const project = '<TargetFramework>net10.0</TargetFramework><PackageReference Include="Microsoft.EntityFrameworkCore.SqlServer" Version="10.0.1" />';
  const files = {
    "apps/dotnet/PhotoAlbum/PhotoAlbum.csproj": project,
    "apps/dotnet/PhotoAlbum.Tests/PhotoAlbum.Tests.csproj": project,
    "apps/dotnet/Dockerfile": "FROM mcr.microsoft.com/dotnet/sdk:10.0\nFROM mcr.microsoft.com/dotnet/aspnet:10.0",
    "apps/java/pom.xml": "<parent><artifactId>spring-boot-starter-parent</artifactId><version>4.0.2</version></parent><java.version>25</java.version>",
    "apps/java/Dockerfile": "FROM maven:3.9-eclipse-temurin-25\nFROM eclipse-temurin:25-jre",
  };
  assert.equal((await evaluateStep(3, context(files))).passed, true);
  files["apps/java/pom.xml"] += "<maven.compiler.target>8</maven.compiler.target>";
  assert.equal((await evaluateStep(3, context(files))).passed, false);
});

test("cloud migrations reject remaining Oracle SQL", async () => {
  const files = {
    "evidence/04-migration.md": report(REPORTS[4][0][1]),
    "apps/dotnet/PhotoAlbum/PhotoAlbum.csproj": '<PackageReference Include="Azure.Storage.Blobs" /><PackageReference Include="Azure.Identity" />',
    "apps/dotnet/PhotoAlbum/Store.cs": "new BlobServiceClient(uri, new DefaultAzureCredential());",
    "apps/java/pom.xml": "<artifactId>postgresql</artifactId>",
    "apps/java/src/main/java/Repository.java": 'String query = "SELECT * FROM photos WHERE ROWNUM < 10";',
  };
  assert.equal((await evaluateStep(4, context(files))).passed, false);
  files["apps/java/src/main/java/Repository.java"] = 'String query = "SELECT * FROM photos LIMIT 10";';
  assert.equal((await evaluateStep(4, context(files))).passed, true);
});

test("Azure completion requires both real current-commit track results", () => {
  const evidence = completeEvidence();
  assert.deepEqual(deploymentProblems(evidence, identity), []);
  assert.ok(deploymentProblems(undefined, identity).length);
  assert.ok(deploymentProblems(evidence, { ...identity, sha: "c".repeat(40) }).length);
  assert.ok(deploymentProblems(evidence, { ...identity, runId: 124 }).length);
  assert.ok(deploymentProblems(evidence, { ...identity, runAttempt: 2 }).length);
  delete evidence.tracks.java;
  assert.ok(deploymentProblems(evidence, identity).length);
});

test("the agentic checkpoint preserves actual tool and output boundaries", async () => {
  const files = {
    "evidence/05-agentic-review.md": report(REPORTS[5][0][1]),
    ".github/workflows/modernization-review.md": "workflow_dispatch\ncontents: read\ncheckout: false\ntools:\n  bash: false\n  edit: false\n  read-only: true\nsafe-outputs:\n  create-issue:\n    max: 1\n",
    ".github/workflows/modernization-review.lock.yml": "# gh-aw\nworkflow_dispatch",
  };
  assert.equal((await evaluateStep(5, context(files))).passed, true);
  files[".github/workflows/modernization-review.md"] =
    files[".github/workflows/modernization-review.md"].replace("max: 1", "max: 10");
  assert.equal((await evaluateStep(5, context(files))).passed, false);
});

test("cloud evidence rejects non-Azure origins, secrets in URLs, and unsuccessful smoke", () => {
  for (const url of ["https://attacker.example", "http://app.example.azurecontainerapps.io",
    "https://user:password@app.example.azurecontainerapps.io", "https://app.example.azurecontainerapps.io/?token=secret"]) {
    const evidence = completeEvidence();
    evidence.tracks.java.url = url;
    assert.ok(deploymentProblems(evidence, identity).length);
  }
  const evidence = completeEvidence();
  evidence.tracks.dotnet.smokePassed = false;
  assert.ok(deploymentProblems(evidence, identity).length);
});

test("unknown checkpoints are explicit errors", async () => {
  await assert.rejects(() => evaluateStep(99, context()), /Unknown checkpoint/);
});
