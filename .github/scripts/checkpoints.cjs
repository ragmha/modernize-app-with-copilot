const REPORTS = {
  1: [["evidence/01-baseline.md", [".NET baseline", "Java baseline", "Tests", "Copilot guardrails"]]],
  2: [
    ["evidence/02-assessment.md", [".NET assessment", "Java assessment", "Cloud blockers"]],
    ["evidence/02-plan.md", ["Changes", "Acceptance criteria", "Rollback", "Human approval"]],
  ],
  4: [["evidence/04-migration.md", [".NET SQL and Blob", "Java PostgreSQL", "Persistence", "Configuration"]]],
  5: [["evidence/05-agentic-review.md", ["Workflow boundaries", "Findings", "Human decision"]]],
};

function reportProblems(path, content, headings) {
  if (!content) return [`Add ${path}.`];
  const problems = [];
  if (/\b(?:TODO|TBD|replace-me)\b|<your[^>]*>/i.test(content)) {
    problems.push(`Replace the unfinished placeholders in ${path}.`);
  }
  for (const heading of headings) {
    const sections = content.split(/^##\s+/m).slice(1);
    const section = sections.find((text) => text.split(/\r?\n/, 1)[0].trim() === heading);
    const body = section?.slice(section.indexOf("\n") + 1).trim();
    if (!body || body.length < 40) {
      problems.push(`In ${path}, add "## ${heading}" with at least 40 characters of concrete evidence.`);
    }
  }
  return problems;
}

function deploymentProblems(evidence, { repository, sha, runId, runAttempt }) {
  if (!evidence) return ["Run Deploy to Azure successfully for both tracks on this main-branch commit."];
  const problems = [];
  if (evidence.schemaVersion !== 1 || evidence.repository !== repository ||
      evidence.sourceSha !== sha || !Number.isSafeInteger(evidence.runId) ||
      evidence.runId !== Number(runId) || !Number.isSafeInteger(evidence.runAttempt) ||
      evidence.runAttempt < 1 || evidence.runAttempt !== Number(runAttempt)) {
    problems.push("Deployment evidence must match this repository, source commit, and verified Actions run and attempt.");
  }
  for (const track of ["dotnet", "java"]) {
    const item = evidence.tracks?.[track];
    if (!item || item.smokePassed !== true || !/sha256:[a-f0-9]{64}$/.test(item.imageDigest ?? "") ||
        !/^[a-z][a-z0-9-]{0,31}$/.test(item.containerApp ?? "")) {
      problems.push(`${track}: missing successful functional smoke result, image digest, or Container App name.`);
    }
    try {
      const url = new URL(item?.url);
      if (url.protocol !== "https:" || !url.hostname.endsWith(".azurecontainerapps.io") ||
          url.username || url.password || url.search || url.hash || url.pathname !== "/") {
        problems.push(`${track}: supply the actual HTTPS Azure Container Apps origin.`);
      }
    } catch {
      problems.push(`${track}: missing a valid deployed application URL.`);
    }
  }
  return problems;
}

async function evaluateStep(step, context) {
  const { readText, listPaths, ciPassed } = context;
  const problems = [];
  const need = (condition, message) => { if (!condition) problems.push(message); };
  if (!Number.isInteger(step) || step < 1 || step > 6) throw new Error(`Unknown checkpoint: ${step}`);
  for (const [path, headings] of REPORTS[step] ?? []) {
    problems.push(...reportProblems(path, await readText(path), headings));
  }
  if (step === 1) {
    const agent = await readText(".github/agents/team-modernizer.agent.md");
    need(agent?.includes("description:") && agent?.includes("tools:") && /approv/i.test(agent),
      "Create .github/agents/team-modernizer.agent.md with a description, explicit tools, and human-approval boundaries.");
  }
  if (step === 3) {
    for (const path of ["apps/dotnet/PhotoAlbum/PhotoAlbum.csproj", "apps/dotnet/PhotoAlbum.Tests/PhotoAlbum.Tests.csproj"]) {
      const project = await readText(path);
      need(/<TargetFramework>\s*net10\.0\s*<\/TargetFramework>/.test(project ?? ""),
        `${path}: explicitly target net10.0.`);
      const ef = [...(project ?? "").matchAll(/<PackageReference\b[^>]*Include="Microsoft\.EntityFrameworkCore[^"]*"[^>]*Version="([^"]+)"/g)];
      need(ef.length > 0 && ef.every((match) => /^10\./.test(match[1])),
        `${path}: update every explicit EF Core package to a compatible 10.x version.`);
    }
    const dotnetDocker = await readText("apps/dotnet/Dockerfile");
    need(/dotnet\/sdk:10\.0/.test(dotnetDocker ?? "") && /dotnet\/aspnet:10\.0/.test(dotnetDocker ?? ""),
      "Update both .NET Docker build and runtime images to 10.0.");
    const pom = await readText("apps/java/pom.xml") ?? "";
    const parent = pom.match(/<parent>([\s\S]*?)<\/parent>/)?.[1] ?? "";
    need(/<artifactId>spring-boot-starter-parent<\/artifactId>/.test(parent) &&
      /<version>\s*4\.0\.[^<]+\s*<\/version>/.test(parent), "Upgrade the Spring Boot parent to a patched 4.0.x release.");
    need(/<java.version>\s*25\s*<\/java.version>/.test(pom), "Set the Java target to 25 in pom.xml.");
    for (const property of ["source", "target", "release"]) {
      const value = pom.match(new RegExp(`<maven\\.compiler\\.${property}>([^<]+)</maven\\.compiler\\.${property}>`))?.[1]?.trim();
      need(value === undefined || value === "25" || value === "${java.version}",
        `Align maven.compiler.${property} with Java 25 (or remove the redundant property).`);
    }
    const javaDocker = await readText("apps/java/Dockerfile");
    need((javaDocker?.match(/(?:eclipse-temurin|openjdk)[-:]25/g)?.length ?? 0) >= 2,
      "Update Java Docker build and runtime images to Java 25.");
  }
  if (step === 4) {
    const project = await readText("apps/dotnet/PhotoAlbum/PhotoAlbum.csproj") ?? "";
    need(project.includes('Include="Azure.Storage.Blobs"') && project.includes('Include="Azure.Identity"'),
      "Add Azure Blob Storage and Azure Identity dependencies to the .NET application.");
    const paths = await listPaths();
    const cs = paths.filter((path) => path.startsWith("apps/dotnet/PhotoAlbum/") && path.endsWith(".cs"));
    let managedBlob = "";
    for (const path of cs) managedBlob += await readText(path) ?? "";
    need(managedBlob.includes("BlobServiceClient") && managedBlob.includes("DefaultAzureCredential"),
      "Implement the .NET cloud photo store with BlobServiceClient and DefaultAzureCredential.");
    const pom = await readText("apps/java/pom.xml") ?? "";
    need(/<artifactId>\s*postgresql\s*<\/artifactId>/.test(pom) && !/ojdbc|com\.oracle\.database/.test(pom),
      "Replace the Oracle JDBC dependency with PostgreSQL.");
    for (const path of paths.filter((name) => name.startsWith("apps/java/src/main/java/") && name.endsWith(".java"))) {
      const source = await readText(path) ?? "";
      need(!/\b(?:ROWNUM|NVL|SYSTIMESTAMP)\b|NUMBER\s*\(\s*\d/i.test(source),
        `${path}: remove Oracle-specific SQL/type expressions, including obsolete examples in comments.`);
      need(!/import\s+javax\.(?:persistence|validation|servlet)/.test(source),
        `${path}: migrate the relevant javax imports to Jakarta.`);
    }
  }
  if (step === 5) {
    const workflow = await readText(".github/workflows/modernization-review.md");
    const lock = await readText(".github/workflows/modernization-review.lock.yml");
    need(workflow?.includes("workflow_dispatch") && workflow?.includes("safe-outputs:") &&
      workflow?.includes("contents: read"), "Keep the agentic review manually dispatched, read-only, and bounded by safe outputs.");
    need(/^\s+max:\s*1\s*$/m.test(workflow ?? "") && /read-only:\s*true/.test(workflow ?? ""),
      "Keep the review's one-issue safe-output limit and read-only GitHub tools.");
    need(/checkout:\s*false/.test(workflow ?? "") && /bash:\s*false/.test(workflow ?? "") && /edit:\s*false/.test(workflow ?? ""),
      "Disable checkout, shell, and edit tools for the read-only agentic review.");
    need(lock?.includes("gh-aw") && lock?.includes("workflow_dispatch"), "Compile and commit modernization-review.lock.yml.");
  }
  if (step === 6) problems.push(...deploymentProblems(context.azureEvidence, context));
  if (!ciPassed) problems.push("Wait for a successful CI push run on this exact default-branch commit.");
  return { step, passed: problems.length === 0, problems };
}

module.exports = { evaluateStep, deploymentProblems, reportProblems, REPORTS };
