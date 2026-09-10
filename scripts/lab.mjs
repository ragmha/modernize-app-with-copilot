import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));

export function javaMajor(pom) {
  const value = pom.match(/<java.version>\s*(1\.8|8|25)\s*<\/java.version>/)?.[1];
  if (!value) throw new Error("This exercise supports explicit java.version 1.8/8 (baseline) or 25 (target).");
  return value === "1.8" ? 8 : Number(value);
}

export function releaseMajor(release) {
  const value = release.match(/^JAVA_VERSION="([^"]+)"/m)?.[1];
  if (!value) return undefined;
  return Number(value.startsWith("1.") ? value.split(".")[1] : value.split(/[.+-]/)[0]);
}

function javaEnvironment(major) {
  const candidates = [process.env[`JAVA_HOME_${major}_X64`], process.env.JAVA_HOME];
  for (const directory of ["/usr/local/sdkman/candidates/java", "/usr/lib/jvm"]) {
    if (existsSync(directory)) {
      candidates.push(...readdirSync(directory, { withFileTypes: true })
        .filter((item) => item.isDirectory() || item.isSymbolicLink()).map((item) => join(directory, item.name)));
    }
  }
  const home = candidates.find((candidate) => candidate && existsSync(join(candidate, "release")) &&
    releaseMajor(readFileSync(join(candidate, "release"), "utf8")) === major);
  if (!home) throw new Error(`JDK ${major} was not found. Rebuild the devcontainer or install that JDK and set JAVA_HOME.`);
  return { ...process.env, JAVA_HOME: home, PATH: `${join(home, "bin")}${delimiter}${process.env.PATH}` };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit", ...options });
  if (result.error) throw new Error(`Cannot run ${command}: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? result.signal}.`);
}

function setup() {
  const path = join(root, ".env");
  if (existsSync(path)) {
    console.log("Existing ignored .env preserved; no credentials changed.");
    return;
  }
  const password = () => `Aa1!${randomBytes(24).toString("hex")}`;
  const keys = ["SQLSERVER_PASSWORD", "ORACLE_PASSWORD", "APP_USER_PASSWORD", "POSTGRES_PASSWORD", "APP_ADMIN_PASSWORD"];
  writeFileSync(path, `${keys.map((key) => `${key}=${password()}`).join("\n")}\n`, { flag: "wx", mode: 0o600 });
  console.log("Created ignored .env with exercise-only random passwords. Do not commit or share it.");
}

function loadLocalEnvironment() {
  const file = join(root, ".env");
  if (!existsSync(file)) throw new Error("Missing .env. Run npm run lab -- setup first.");
  process.loadEnvFile(file);
}

function required(name) {
  if (!process.env[name]) throw new Error(`Set ${name}; no implicit password or success fallback is used.`);
  return process.env[name];
}

async function main(command, track) {
  const pom = () => readFileSync(join(root, "apps", "java", "pom.xml"), "utf8");
  if (command === "java-version") {
    console.log(javaMajor(pom()));
    return;
  }
  if (command === "setup") return setup();
  if (command === "doctor") {
    run("node", ["--version"]);
    run("dotnet", ["--list-sdks"]);
    for (const major of [8, 25]) run("java", ["-version"], { env: javaEnvironment(major) });
    run("mvn", ["--version"], { env: javaEnvironment(javaMajor(pom())) });
    run("gh", ["--version"]);
    run("docker", ["--version"]);
    console.log("Toolchain inspection complete. Database and Azure services were not started.");
    return;
  }
  if (command === "services:start") {
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error("The database baseline is supported only in the Linux x64 Codespace, not ARM emulation.");
    }
    loadLocalEnvironment();
    if (process.env.ACCEPT_SQLSERVER_EULA !== "Y" || process.env.ACCEPT_ORACLE_TERMS !== "Y") {
      throw new Error("Read docs/codespaces.md and the database terms first. Then explicitly set ACCEPT_SQLSERVER_EULA=Y and ACCEPT_ORACLE_TERMS=Y for this command.");
    }
    run("docker", ["compose", "up", "--detach", "--wait", "--wait-timeout", "600",
      "sql", /<artifactId>\s*postgresql\s*<\/artifactId>/.test(pom()) ? "postgres" : "oracle"]);
    return;
  }
  if (command === "services:stop" || command === "services:status") {
    loadLocalEnvironment();
    run("docker", ["compose", command === "services:stop" ? "stop" : "ps"]);
    return;
  }
  if (!["test", "run"].includes(command) || !["dotnet", "java", "both"].includes(track) || (command === "run" && track === "both")) {
    throw new Error("Usage: npm run lab -- setup|doctor|services:start|services:stop|services:status; or test dotnet|java|both; or run dotnet|java.");
  }
  if (command === "test") {
    if (track !== "java") run("dotnet", ["test", "PhotoAlbum.sln", "--configuration", "Release"], { cwd: join(root, "apps", "dotnet") });
    if (track !== "dotnet") run("mvn", ["--update-snapshots", "--batch-mode", "--no-transfer-progress", "verify"],
      { cwd: join(root, "apps", "java"), env: javaEnvironment(javaMajor(pom())) });
    return;
  }
  loadLocalEnvironment();
  if (track === "dotnet") {
    const env = {
      ...process.env, ASPNETCORE_ENVIRONMENT: "Development", ASPNETCORE_URLS: "http://0.0.0.0:5134",
      ConnectionStrings__DefaultConnection: process.env.ConnectionStrings__DefaultConnection ||
        `Server=127.0.0.1,1433;Database=PhotoAlbumDb;User Id=sa;Password=${required("SQLSERVER_PASSWORD")};TrustServerCertificate=True`,
      Admin__Username: "admin", Admin__Password: required("APP_ADMIN_PASSWORD"),
    };
    run("dotnet", ["run", "--no-launch-profile", "--project", "PhotoAlbum/PhotoAlbum.csproj"],
      { cwd: join(root, "apps", "dotnet"), env });
  } else {
    const migrated = /<artifactId>\s*postgresql\s*<\/artifactId>/.test(pom());
    const env = {
      ...javaEnvironment(javaMajor(pom())), SERVER_PORT: "8080", SPRING_PROFILES_ACTIVE: process.env.SPRING_PROFILES_ACTIVE || "docker",
      SPRING_DATASOURCE_URL: migrated ? "jdbc:postgresql://127.0.0.1:5432/photoalbum" : "jdbc:oracle:thin:@127.0.0.1:1521/FREEPDB1",
      SPRING_DATASOURCE_USERNAME: "photoalbum",
      SPRING_DATASOURCE_PASSWORD: required(migrated ? "POSTGRES_PASSWORD" : "APP_USER_PASSWORD"),
      APP_ADMIN_PASSWORD: required("APP_ADMIN_PASSWORD"),
    };
    run("mvn", ["--batch-mode", "--no-transfer-progress", "spring-boot:run"], { cwd: join(root, "apps", "java"), env });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv[2], process.argv[3]);
}
