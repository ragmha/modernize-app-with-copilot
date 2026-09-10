import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const root = fileURLToPath(new URL("../", import.meta.url));
const maximumArchiveBytes = 16 * 1024 * 1024;
const maximumExpandedBytes = 64 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function safeRelativePath(value) {
  if (typeof value !== "string" || !value || /[\\:\0]/.test(value) ||
      value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error("Unsafe relative sample path.");
  }
  return value;
}

function localPath(base, path) {
  return resolve(base, ...safeRelativePath(path).split("/"));
}

async function assertNoLinks(path) {
  const rel = relative(root, path);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Sample operations must stay inside this repository.");
  }
  let current = root;
  for (const segment of rel.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Refusing a symbolic link or junction.");
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
  }
}

function allowed(path, sample) {
  return sample.include.some((entry) => entry.endsWith("/") ? path.startsWith(entry) : path === entry);
}

function instructionPath(path) {
  return path.split("/").some((segment) =>
    /^(?:\.github|\.squad|\.claude|\.specify|AGENTS\.md|CLAUDE\.md|SKILL\.md|copilot-instructions\.md)$/i.test(segment));
}

export function extractAllowlist(archive, sample) {
  if (archive.length > maximumArchiveBytes || digest(archive) !== sample.archiveSha256) {
    throw new Error("Pinned archive SHA-256 or size verification failed.");
  }
  const tar = gunzipSync(archive, { maxOutputLength: maximumExpandedBytes });
  const files = new Map();
  const field = (header, start, length) =>
    header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const sizeText = field(header, 124, 12).trim();
    if (!/^[0-7]+$/.test(sizeText)) throw new Error("Unsupported tar size.");
    const size = Number.parseInt(sizeText, 8);
    const checksum = Number.parseInt(field(header, 148, 8).trim(), 8);
    const computed = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (checksum !== computed || offset + 512 + size > tar.length) {
      throw new Error("Invalid tar header or truncated entry.");
    }
    const type = String.fromCharCode(header[156]);
    const prefix = field(header, 345, 155);
    const entry = `${prefix ? `${prefix}/` : ""}${field(header, 0, 100)}`;
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    // GitHub's global PAX commit metadata is data, never an executable file.
    if (type === "g" || type === "x" || type === "5") continue;
    if (!entry.startsWith(`${sample.archiveRoot}/`)) throw new Error("Unexpected archive root.");
    const path = safeRelativePath(entry.slice(sample.archiveRoot.length + 1));
    if (!allowed(path, sample)) continue;
    if (instructionPath(path)) throw new Error("Instructions are not part of the application allowlist.");
    if (type !== "0" && type !== "\0") throw new Error("Only regular sample files may be imported.");
    if (files.has(path)) throw new Error("Duplicate archive entry.");
    files.set(path, Buffer.from(data));
  }
  for (const entry of sample.include) {
    if (![...files.keys()].some((path) => entry.endsWith("/") ? path.startsWith(entry) : path === entry)) {
      throw new Error(`Allowlisted entry was not present: ${entry}`);
    }
  }
  return files;
}

async function loadArchive(track, sample, archiveDirectory) {
  if (archiveDirectory) {
    const path = resolve(root, archiveDirectory, `${track}.tar.gz`);
    await assertNoLinks(path);
    return readFile(path);
  }
  const url = new URL(sample.archiveUrl);
  if (url.origin !== "https://codeload.github.com" ||
      !/^[a-f0-9]{40}$/.test(sample.commit) || !url.pathname.endsWith(`/tar.gz/${sample.commit}`)) {
    throw new Error("Only immutable GitHub codeload archives are accepted.");
  }
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Archive download failed with HTTP ${response.status}.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maximumArchiveBytes) throw new Error("Archive download exceeds the size limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function verifySample(sample, base = root) {
  if (!sample.files?.length) throw new Error("Sample has no recorded file inventory.");
  const destination = localPath(base, sample.destination);
  for (const file of sample.files) {
    const path = localPath(destination, file.path);
    await assertNoLinks(path);
    const actual = await readFile(path);
    if (digest(actual) !== file.vendoredSha256) {
      throw new Error(`Snapshot differs at ${sample.destination}/${file.path}. Learner edits are never reset.`);
    }
  }
}

async function record(lock, tracks, archiveDirectory) {
  const adaptationPath = localPath(root, lock.adaptationFile);
  let patches = { schemaVersion: 1, samples: {} };
  try {
    patches = JSON.parse(await readFile(adaptationPath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  for (const track of tracks) {
    const sample = lock.samples[track];
    const upstream = extractAllowlist(await loadArchive(track, sample, archiveDirectory), sample);
    const adaptedPaths = new Set(sample.adaptations.map((item) => safeRelativePath(item.path)));
    const paths = [...new Set([...upstream.keys(), ...adaptedPaths])].sort();
    const inventory = [];
    const adaptations = [];
    for (const path of paths) {
      const absolutePath = localPath(localPath(root, sample.destination), path);
      await assertNoLinks(absolutePath);
      const bytes = await readFile(absolutePath);
      const sourceHash = upstream.has(path) ? digest(upstream.get(path)) : null;
      const finalHash = digest(bytes);
      if (sourceHash !== finalHash && !adaptedPaths.has(path)) {
        throw new Error(`Unrecorded source adaptation: ${sample.destination}/${path}`);
      }
      if (adaptedPaths.has(path)) {
        const content = bytes.toString("utf8");
        if (!Buffer.from(content).equals(bytes)) throw new Error("Adaptation is not UTF-8 text.");
        adaptations.push({ path, upstreamSha256: sourceHash, vendoredSha256: finalHash, content });
      }
      inventory.push({ path, upstreamSha256: sourceHash, vendoredSha256: finalHash });
    }
    sample.files = inventory;
    sample.importedFileCount = upstream.size;
    patches.samples[track] = adaptations;
  }
  await assertNoLinks(adaptationPath);
  await writeFile(adaptationPath, `${JSON.stringify(patches, null, 2)}\n`);
  lock.adaptationSha256 = digest(await readFile(adaptationPath));
  await writeFile(resolve(root, "samples.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
  console.log("Recorded reviewed adaptations and per-file hashes. No application files were changed.");
}

export async function importSamples(argv = process.argv.slice(2)) {
  let track = "all";
  let mode = "import";
  let archiveDirectory;
  const seen = new Set();
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (seen.has(argument)) throw new Error(`Duplicate argument: ${argument}`);
    seen.add(argument);
    if (argument === "--track") track = argv[++index];
    else if (argument === "--archive-dir") archiveDirectory = argv[++index];
    else if (argument === "--verify" || argument === "--record") {
      if (mode !== "import") throw new Error("Choose only one mode.");
      mode = argument.slice(2);
    } else if (argument === "--help") {
      console.log("node scripts/import-samples.mjs [--track all|dotnet|java] [--verify|--record] [--archive-dir relative-folder]");
      console.log("Import creates absent sample directories only. --verify is read-only. --record audits explicitly listed maintainer adaptations; it never rewrites application sources.");
      return;
    } else throw new Error(`Unknown argument: ${argument}. No force/reset mode exists.`);
  }
  if (!["all", "dotnet", "java"].includes(track) ||
      (seen.has("--archive-dir") && (!archiveDirectory || archiveDirectory.startsWith("--")))) {
    throw new Error("A valid track and archive directory value are required.");
  }
  const lock = JSON.parse(await readFile(resolve(root, "samples.lock.json"), "utf8"));
  if (lock.schemaVersion !== 1) throw new Error("Unsupported sample lock schema.");
  const tracks = track === "all" ? ["dotnet", "java"] : [track];
  if (mode === "verify") {
    for (const name of tracks) await verifySample(lock.samples[name]);
    console.log(`Verified recorded ${tracks.join(" and ")} snapshot files. No files changed.`);
    return;
  }
  if (mode === "record") {
    await record(lock, tracks, archiveDirectory);
    return;
  }
  // Preflight all destinations before any network request or filesystem write.
  for (const name of tracks) {
    const destination = localPath(root, lock.samples[name].destination);
    await assertNoLinks(destination);
    try {
      await lstat(destination);
      throw new Error(`Refusing to overwrite ${lock.samples[name].destination}; learner edits are never reset.`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const adaptationPath = localPath(root, lock.adaptationFile);
  await assertNoLinks(adaptationPath);
  const adaptationBytes = await readFile(adaptationPath);
  if (digest(adaptationBytes) !== lock.adaptationSha256) throw new Error("Adaptation file hash mismatch.");
  const patches = JSON.parse(adaptationBytes);
  const prepared = new Map();
  for (const name of tracks) {
    const sample = lock.samples[name];
    const files = extractAllowlist(await loadArchive(name, sample, archiveDirectory), sample);
    for (const patch of patches.samples[name]) {
      safeRelativePath(patch.path);
      if (!sample.adaptations.some((entry) => entry.path === patch.path)) {
        throw new Error("Adaptation is not declared in samples.lock.json.");
      }
      const upstreamHash = files.has(patch.path) ? digest(files.get(patch.path)) : null;
      if (upstreamHash !== patch.upstreamSha256 || digest(Buffer.from(patch.content)) !== patch.vendoredSha256) {
        throw new Error("Adaptation precondition or content hash mismatch.");
      }
      files.set(patch.path, Buffer.from(patch.content));
    }
    if (files.size !== sample.files.length) throw new Error("Sample inventory size mismatch.");
    for (const file of sample.files) {
      if (!files.has(file.path) || digest(files.get(file.path)) !== file.vendoredSha256) {
        throw new Error("Final snapshot does not match its recorded inventory.");
      }
    }
    prepared.set(name, files);
  }
  for (const [name, files] of prepared) {
    const destination = localPath(root, lock.samples[name].destination);
    await assertNoLinks(destination);
    await mkdir(dirname(destination), { recursive: true });
    // Not recursive: a concurrent learner-created directory must make this fail.
    await mkdir(destination);
    for (const [path, bytes] of files) {
      const target = localPath(destination, path);
      await assertNoLinks(target);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
    await verifySample(lock.samples[name]);
    console.log(`Imported and verified ${files.size} ${name} files from ${lock.samples[name].commit}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  importSamples().catch((error) => {
    console.error(`Sample import failed: ${error.message}`);
    process.exitCode = 1;
  });
}
