import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { setTimeout as pause } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const redirects = new Set([301, 302, 303, 307, 308]);
const maximumResponseBytes = 2 * 1024 * 1024;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("--url must be an absolute application URL.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  requireCondition(url.protocol === "https:" || (url.protocol === "http:" && loopback),
    "Remote applications require HTTPS; HTTP is allowed only on localhost/loopback.");
  requireCondition(!url.username && !url.password, "Credentials must not appear in the URL.");
  requireCondition(url.pathname === "/" && !url.search && !url.hash,
    "--url must identify the application origin, without a path, query, or fragment.");
  return url;
}

export function sameOriginUrl(value, base) {
  const origin = new URL(base);
  let url;
  try {
    url = new URL(value, origin);
  } catch {
    throw new Error("The application returned an invalid URL.");
  }
  requireCondition(url.origin === origin.origin && !url.username && !url.password,
    "Refusing a cross-origin URL or embedded credentials.");
  requireCondition(["http:", "https:"].includes(url.protocol), "Unsupported application URL protocol.");
  url.hash = "";
  return url;
}

export function parseArguments(args) {
  const options = { healthOnly: false };
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    requireCondition(!seen.has(argument), `Duplicate option: ${argument}`);
    seen.add(argument);
    if (argument === "--health-only") options.healthOnly = true;
    else if (argument === "--help") options.help = true;
    else if (argument === "--track" || argument === "--url") {
      const value = args[++index];
      requireCondition(value && !value.startsWith("--"), `Missing value for ${argument}.`);
      options[argument.slice(2)] = value;
    } else throw new Error(`Unknown option: ${argument}`);
  }
  if (options.help) return options;
  requireCondition(["dotnet", "java"].includes(options.track), "--track must be dotnet or java.");
  options.url = validateBaseUrl(options.url).href;
  return options;
}

export function decodeHtml(value) {
  const named = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, code) => {
    if (code[0] !== "#") return named[code.toLowerCase()];
    const point = code[1].toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : entity;
  });
}

function markupOnly(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
}

export function parseAttributes(tag) {
  const result = Object.create(null);
  const attributes = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>\s*$/, "");
  for (const match of attributes.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
    const name = match[1].toLowerCase();
    requireCondition(!Object.hasOwn(result, name), "Ambiguous duplicate HTML attribute.");
    result[name] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function tags(html, name) {
  return [...markupOnly(html).matchAll(new RegExp(`<${name}\\b(?:"[^"]*"|'[^']*'|[^'">])*>`, "gi"))]
    .map((match) => parseAttributes(match[0]));
}

function forms(html) {
  return [...markupOnly(html).matchAll(/(<form\b(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)<\/form\s*>/gi)]
    .map((match) => ({ attributes: parseAttributes(match[1]), html: match[2], inputs: tags(match[2], "input") }));
}

function anchors(html) {
  return [...markupOnly(html).matchAll(/(<a\b(?:"[^"]*"|'[^']*'|[^'">])*>)([\s\S]*?)<\/a\s*>/gi)]
    .map((match) => ({
      ...parseAttributes(match[1]),
      text: decodeHtml(match[2].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(),
    }));
}

export function parseCsrf(html, { required = true } = {}) {
  const tokens = tags(html, "input").filter((input) =>
    input.type?.toLowerCase() === "hidden" && ["__RequestVerificationToken", "_csrf"].includes(input.name));
  const unique = new Map(tokens.map((token) => [`${token.name}\0${token.value}`, token]));
  requireCondition(unique.size <= 1, "Ambiguous CSRF tokens in the selected form.");
  if (!unique.size) {
    requireCondition(!required, "Expected a CSRF token in the selected form.");
    return null;
  }
  const token = [...unique.values()][0];
  requireCondition(typeof token.value === "string" && token.value.length > 0 && !/[\x00-\x20\x7f]/.test(token.value),
    "The application returned an empty or malformed CSRF token.");
  return { name: token.name, value: token.value };
}

export class CookieJar {
  constructor(origin, now = Date.now) {
    this.origin = new URL(origin);
    this.now = now;
    this.cookies = new Map();
  }

  absorb(headers, requestUrl) {
    const url = sameOriginUrl(requestUrl, this.origin);
    requireCondition(typeof headers.getSetCookie === "function", "Node 22+ Headers.getSetCookie is required.");
    for (const header of headers.getSetCookie()) {
      const parts = header.split(";");
      const firstEquals = parts[0].indexOf("=");
      if (firstEquals <= 0) continue;
      const name = parts[0].slice(0, firstEquals).trim();
      const value = parts[0].slice(firstEquals + 1).trim();
      if (!/^[!#$%&'*+\-.^_`|~0-9a-z]+$/i.test(name) || /[\x00-\x20\x7f;,]/.test(value)) continue;
      const attributes = new Map(parts.slice(1).map((part) => {
        const equals = part.indexOf("=");
        return equals < 0 ? [part.trim().toLowerCase(), ""]
          : [part.slice(0, equals).trim().toLowerCase(), part.slice(equals + 1).trim()];
      }));
      const domain = (attributes.get("domain") ?? url.hostname).replace(/^\./, "").toLowerCase();
      if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`)) continue;
      const defaultPath = url.pathname.slice(0, url.pathname.lastIndexOf("/")) || "/";
      const path = attributes.get("path")?.startsWith("/") ? attributes.get("path") : defaultPath;
      const secure = attributes.has("secure");
      if (name.startsWith("__Secure-") && !secure) continue;
      if (name.startsWith("__Host-") && (!secure || attributes.has("domain") || path !== "/")) continue;
      if (secure && url.protocol !== "https:") continue;
      let expires = attributes.has("expires") ? Date.parse(attributes.get("expires")) : Number.POSITIVE_INFINITY;
      if (Number.isNaN(expires)) expires = Number.POSITIVE_INFINITY;
      if (/^-?\d+$/.test(attributes.get("max-age") ?? "")) {
        expires = this.now() + Number(attributes.get("max-age")) * 1000;
      }
      const key = `${name}\0${domain}\0${path}`;
      if (expires <= this.now()) this.cookies.delete(key);
      else this.cookies.set(key, { name, value, path, secure, expires });
    }
  }

  header(requestUrl) {
    const url = sameOriginUrl(requestUrl, this.origin);
    const matching = [];
    for (const [key, cookie] of this.cookies) {
      if (cookie.expires <= this.now()) {
        this.cookies.delete(key);
        continue;
      }
      if (cookie.secure && url.protocol !== "https:") continue;
      const pathMatches = url.pathname === cookie.path ||
        (url.pathname.startsWith(cookie.path) && (cookie.path.endsWith("/") || url.pathname[cookie.path.length] === "/"));
      if (pathMatches) matching.push(cookie);
    }
    return matching.sort((left, right) => right.path.length - left.path.length)
      .map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  }
}

export class AppClient {
  constructor(baseUrl, { fetchImpl = fetch, timeoutMs = 20_000 } = {}) {
    this.base = validateBaseUrl(baseUrl);
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.jar = new CookieJar(this.base);
    this.authorization = null;
  }

  useBasic(username, password) {
    requireCondition(!username.includes(":"), "HTTP Basic usernames cannot contain a colon.");
    this.authorization = `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
  }

  async request(target, { method = "GET", body, headers = {}, anonymous = false } = {}) {
    const url = sameOriginUrl(target, this.base);
    const requestHeaders = new Headers({
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Cache-Control": "no-cache, no-store",
      Pragma: "no-cache",
      ...headers,
    });
    requireCondition(!requestHeaders.has("Authorization") && !requestHeaders.has("Cookie"),
      "Credentials must be managed by the origin-bound client.");
    if (!anonymous) {
      const cookie = this.jar.header(url);
      if (cookie) requestHeaders.set("Cookie", cookie);
      if (this.authorization) requestHeaders.set("Authorization", this.authorization);
    }
    if (method !== "GET" && method !== "HEAD") {
      requestHeaders.set("Origin", this.base.origin);
      requestHeaders.set("Referer", this.base.href);
    }
    let response;
    try {
      response = await this.fetch(url, {
        method, body, headers: requestHeaders, redirect: "manual",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new Error(`Application ${method} request failed or timed out.`);
    }
    if (response.url) sameOriginUrl(response.url, this.base);
    if (!anonymous) this.jar.absorb(response.headers, url);
    if (redirects.has(response.status)) {
      const location = response.headers.get("location");
      requireCondition(location, "Redirect response has no Location header.");
      sameOriginUrl(location, url);
    }
    return { response, url };
  }
}

export async function responseBytes(response, limit = maximumResponseBytes) {
  const chunks = [];
  let total = 0;
  if (!response.body) return Buffer.alloc(0);
  try {
    for await (const chunk of response.body) {
      total += chunk.length;
      requireCondition(total <= limit, "Application response exceeded the smoke-test size limit.");
      chunks.push(Buffer.from(chunk));
    }
  } catch (error) {
    if (error.message === "Application response exceeded the smoke-test size limit.") throw error;
    throw new Error("Application response could not be read completely.");
  }
  return Buffer.concat(chunks);
}

function expectStatus(response, expected, operation) {
  requireCondition(expected.includes(response.status), `${operation}: expected HTTP ${expected.join("/")}, received ${response.status}.`);
}

async function htmlResponse(result, operation) {
  expectStatus(result.response, [200], operation);
  requireCondition(/^text\/html(?:;|$)/i.test(result.response.headers.get("content-type") ?? ""),
    `${operation}: expected HTML, not an API error or proxy response.`);
  return (await responseBytes(result.response)).toString("utf8");
}

async function jsonResponse(result, operation) {
  expectStatus(result.response, [200], operation);
  requireCondition(/^application\/(?:[\w.+-]+\+)?json(?:;|$)/i.test(result.response.headers.get("content-type") ?? ""),
    `${operation}: expected JSON.`);
  try {
    return JSON.parse((await responseBytes(result.response)).toString("utf8"));
  } catch {
    throw new Error(`${operation}: malformed or incomplete JSON response.`);
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function createTinyPng(pixels = randomBytes(12)) {
  requireCondition(pixels.length === 12, "A 2x2 RGB PNG requires exactly 12 pixel bytes.");
  const chunk = (name, data) => {
    const kind = Buffer.from(name, "ascii");
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([kind, data])));
    return Buffer.concat([length, kind, data, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(2, 4);
  header[8] = 8;
  header[9] = 2;
  const scanlines = Buffer.concat([Buffer.from([0]), pixels.subarray(0, 6), Buffer.from([0]), pixels.subarray(6)]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0)),
  ]);
}

function validId(track, value) {
  const id = String(value ?? "");
  if (track === "dotnet") return /^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id));
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

function detailId(track, url) {
  const match = url.pathname.match(/^\/detail\/([^/]+)\/?$/i);
  const value = match?.[1] ?? (track === "dotnet" && /^\/detail\/?$/i.test(url.pathname) ? url.searchParams.get("id") : null);
  return validId(track, value) ? String(value) : null;
}

function galleryTarget(track, url) {
  return url.pathname === "/" || (track === "dotnet" && /^\/index\/?$/i.test(url.pathname));
}

function galleryEntries(track, html, base) {
  const entries = [];
  for (const anchor of anchors(html)) {
    if (!anchor.href) continue;
    const candidate = new URL(anchor.href, base);
    const id = detailId(track, candidate);
    if (!id) continue;
    const url = sameOriginUrl(candidate, base);
    entries.push({ id, url, name: anchor.text });
  }
  return entries;
}

function uploadForm(html) {
  const matches = forms(html).filter((form) => form.attributes.id === "upload-form" &&
    form.attributes.method?.toLowerCase() === "post" && form.inputs.some((input) => input.name === "files"));
  requireCondition(matches.length === 1, "Gallery does not contain the expected photo upload form.");
  return matches[0];
}

function hiddenFields(form) {
  const fields = new URLSearchParams();
  for (const input of form.inputs) {
    if (input.type?.toLowerCase() === "hidden" && input.name) fields.set(input.name, input.value ?? "");
  }
  return fields;
}

function redirectToGallery(result, track, operation) {
  expectStatus(result.response, [302, 303], operation);
  const target = sameOriginUrl(result.response.headers.get("location"), result.url);
  requireCondition(galleryTarget(track, target), `${operation}: expected a gallery redirect, not login or another page.`);
  return target;
}

async function authenticate(client, track, username, password) {
  if (track === "java") {
    // The pinned Java sample is HTTP Basic + stateless, not a form-login application.
    // Empty multipart data cannot create a photo even if authentication regresses.
    const challenge = await client.request("/upload", { method: "POST", body: new FormData(), anonymous: true });
    expectStatus(challenge.response, [401], "Anonymous Java upload authentication check");
    requireCondition(/^Basic(?:\s|$)/i.test(challenge.response.headers.get("www-authenticate") ?? ""),
      "Expected the upstream HTTP Basic authentication challenge.");
    await responseBytes(challenge.response);
    client.useBasic(username, password);
    uploadForm(await htmlResponse(await client.request("/"), "HTTP Basic authentication"));
    return "http-basic";
  }
  const login = await client.request("/Login");
  const html = await htmlResponse(login, "Login form");
  const matches = forms(html).filter((form) => form.attributes.method?.toLowerCase() === "post" &&
    form.inputs.some((input) => input.name === "Username") && form.inputs.some((input) => input.name === "Password"));
  requireCondition(matches.length === 1, "Expected exactly one upstream admin login form.");
  const form = matches[0];
  const csrf = parseCsrf(form.html);
  const target = sameOriginUrl(form.attributes.action || login.url, login.url);
  requireCondition(/^\/login\/?$/i.test(target.pathname), "Unexpected login form action.");
  const fields = hiddenFields(form);
  fields.set(csrf.name, csrf.value);
  fields.set("Username", username);
  fields.set("Password", password);
  fields.set("ReturnUrl", "/");
  const result = await client.request(target, { method: "POST", body: fields });
  const gallery = redirectToGallery(result, track, "Admin login");
  await responseBytes(result.response);
  uploadForm(await htmlResponse(await client.request(gallery), "Authenticated gallery"));
  return "cookie-and-csrf";
}

function cacheBust(url, base) {
  const target = sameOriginUrl(url, base);
  target.searchParams.set("_smoke", randomUUID());
  return target;
}

function ownedEntry(entries, owned) {
  const matches = entries.filter((entry) => entry.id === owned.id && entry.name === owned.name);
  requireCondition(matches.length >= 1, `Uploaded photo ${owned.name} is not listed by its returned ID and filename.`);
  return matches[0];
}

function ownedImage(html, owned, url) {
  const matches = tags(html, "img").filter((image) => image.alt === owned.name &&
    image.class?.split(/\s+/).includes("photo-detail-image") && image.src);
  requireCondition(matches.length === 1, `Detail page does not identify the owned photo ${owned.name}.`);
  return sameOriginUrl(matches[0].src, url);
}

function deleteForm(track, html, owned, url) {
  const matches = forms(html).filter((form) => {
    if (form.attributes.method?.toLowerCase() !== "post") return false;
    const target = sameOriginUrl(form.attributes.action || url, url);
    return track === "java" ? target.pathname === `/detail/${owned.id}/delete`
      : detailId(track, target) === owned.id && target.searchParams.get("handler")?.toLowerCase() === "delete";
  });
  requireCondition(matches.length === 1, "Cannot safely identify a delete form for this run's own photo.");
  const form = matches[0];
  return { target: sameOriginUrl(form.attributes.action || url, url), form, csrf: parseCsrf(form.html, { required: track === "dotnet" }) };
}

async function verifyDetail(client, track, owned) {
  const result = await client.request(owned.detailUrl);
  const html = await htmlResponse(result, "Uploaded photo detail");
  const imageUrl = ownedImage(html, owned, result.url);
  deleteForm(track, html, owned, result.url);
  const file = await client.request(cacheBust(imageUrl, client.base), { headers: { Accept: "image/png" } });
  expectStatus(file.response, [200], "Photo download");
  requireCondition(/^image\/png(?:;|$)/i.test(file.response.headers.get("content-type") ?? ""), "Downloaded photo is not PNG.");
  const bytes = await responseBytes(file.response);
  // Both pinned samples preserve the original bytes; a storage migration must do so too.
  requireCondition(bytes.equals(owned.bytes), "Downloaded image bytes differ from this run's generated upload.");
  owned.imageUrl = imageUrl;
  return { html, url: result.url };
}

async function followNavigation(client, track, from, expected, label) {
  const matches = anchors(from.html).filter((anchor) => anchor.text === label && anchor.href);
  requireCondition(matches.length === 1, `Expected the ${label} navigation link.`);
  const target = sameOriginUrl(matches[0].href, from.url);
  requireCondition(detailId(track, target) === expected.id,
    `${label} did not connect this run's adjacent photos. Avoid concurrent uploads during a smoke run.`);
  const result = await client.request(target);
  ownedImage(await htmlResponse(result, label), expected, result.url);
}

async function deleteOwned(client, track, owned, originals) {
  // Re-read identity immediately before the mutation; never delete an ID just because it appeared in a list.
  const detail = await client.request(owned.detailUrl);
  const html = await htmlResponse(detail, "Cleanup identity check");
  const imageUrl = ownedImage(html, owned, detail.url);
  const { target, form, csrf } = deleteForm(track, html, owned, detail.url);
  const fields = hiddenFields(form);
  if (csrf) fields.set(csrf.name, csrf.value);
  const deleted = await client.request(target, { method: "POST", body: fields });
  const destination = redirectToGallery(deleted, track, "Delete owned photo");
  await responseBytes(deleted.response);
  const listing = await htmlResponse(await client.request(cacheBust(destination, client.base)), "Gallery after deletion");
  uploadForm(listing);
  const remaining = galleryEntries(track, listing, client.base);
  requireCondition(!remaining.some((entry) => entry.id === owned.id || entry.name === owned.name),
    "Deleted photo is still present in the gallery.");
  const remainingIds = new Set(remaining.map((entry) => entry.id));
  requireCondition([...originals].every((id) => remainingIds.has(id)),
    "Pre-existing gallery entries disappeared during the smoke run.");
  const file = await client.request(cacheBust(imageUrl, client.base), { headers: { Accept: "image/png" } });
  expectStatus(file.response, [404, 410], "Deleted image must no longer be readable");
  await responseBytes(file.response);
  const missingDetail = await client.request(owned.detailUrl);
  if ([302, 303].includes(missingDetail.response.status)) {
    redirectToGallery(missingDetail, track, "Deleted detail");
  } else expectStatus(missingDetail.response, [404, 410], "Deleted detail must no longer be readable");
  await responseBytes(missingDetail.response);
  owned.deleted = true;
}

export async function runSmoke({
  track, url, healthOnly = false,
  username = process.env.SMOKE_ADMIN_USERNAME ?? "admin",
  password = process.env.SMOKE_ADMIN_PASSWORD,
  fetchImpl = fetch,
  uploadPauseMs = 1_100,
}) {
  requireCondition(["dotnet", "java"].includes(track), "--track must be dotnet or java.");
  if (!healthOnly) {
    requireCondition(typeof password === "string" && password.length > 0, "SMOKE_ADMIN_PASSWORD is required for a functional smoke test.");
    requireCondition(typeof username === "string" && username.length > 0 && !/[\x00-\x1f\x7f]/.test(username),
      "SMOKE_ADMIN_USERNAME must be a nonempty username.");
  }
  const client = new AppClient(url, { fetchImpl });
  const health = await jsonResponse(await client.request("/health", { anonymous: true }), "Database readiness");
  requireCondition(health?.status === "ok", "The real application database readiness check is not healthy.");
  if (healthOnly) {
    return { track, origin: client.base.origin, mode: "health-only", status: "ok", functionalSmoke: false };
  }

  const created = [];
  const originals = new Set();
  let failure;
  let authentication;
  try {
    const before = await htmlResponse(await client.request("/"), "Initial gallery");
    uploadForm(before);
    for (const entry of galleryEntries(track, before, client.base)) originals.add(entry.id);
    authentication = await authenticate(client, track, username, password);
    const runId = randomUUID();
    for (let index = 0; index < 2; index++) {
      if (index) await pause(uploadPauseMs);
      const bytes = createTinyPng();
      const name = `copilot-smoke-${runId}-${index + 1}.png`;
      const gallery = await htmlResponse(await client.request("/"), "Upload page");
      const form = uploadForm(gallery);
      const csrf = parseCsrf(form.html, { required: track === "dotnet" });
      const multipart = new FormData();
      multipart.append("files", new Blob([bytes], { type: "image/png" }), name);
      if (csrf) multipart.append(csrf.name, csrf.value);
      const result = await jsonResponse(await client.request(track === "dotnet" ? "/?handler=Upload" : "/upload",
        { method: "POST", body: multipart }), "Photo upload");
      requireCondition(result?.success === true && Array.isArray(result.uploadedPhotos) && result.uploadedPhotos.length === 1 &&
        Array.isArray(result.failedUploads) && result.failedUploads.length === 0, "Upload did not report exactly one successful photo.");
      const uploaded = result.uploadedPhotos[0];
      requireCondition(uploaded.originalFileName === name && validId(track, uploaded.id), "Upload returned a mismatched filename or invalid photo ID.");
      const id = String(uploaded.id);
      requireCondition(!originals.has(id) && !created.some((photo) => photo.id === id), "Upload returned an existing photo ID; refusing to claim or delete it.");
      const owned = {
        id, name, bytes, deleted: false,
        detailUrl: new URL(track === "dotnet" ? `/Detail/${id}` : `/detail/${id}`, client.base),
      };
      created.push(owned);
      requireCondition(uploaded.width === 2 && uploaded.height === 2 && uploaded.fileSize === bytes.length,
        "Uploaded photo metadata does not match the generated image.");
    }

    const listing = await htmlResponse(await client.request(cacheBust("/", client.base)), "Gallery with uploaded photos");
    uploadForm(listing);
    const entries = galleryEntries(track, listing, client.base);
    for (const owned of created) owned.detailUrl = ownedEntry(entries, owned).url;
    const older = await verifyDetail(client, track, created[0]);
    const newer = await verifyDetail(client, track, created[1]);
    await followNavigation(client, track, older, created[1], "Next Photo");
    await followNavigation(client, track, newer, created[0], "Previous Photo");
    const back = anchors(newer.html).find((anchor) => anchor.text === "Back to Gallery" && anchor.href);
    requireCondition(back, "Detail page has no Back to Gallery navigation.");
    const backUrl = sameOriginUrl(back.href, newer.url);
    requireCondition(galleryTarget(track, backUrl), "Back to Gallery points to an unexpected page.");
    const returned = galleryEntries(track, await htmlResponse(await client.request(backUrl), "Back to Gallery"), client.base);
    for (const owned of created) ownedEntry(returned, owned);
  } catch (error) {
    failure = error;
  }

  const cleanupFailures = [];
  for (const owned of [...created].reverse()) {
    try {
      await deleteOwned(client, track, owned, originals);
    } catch (error) {
      cleanupFailures.push(`${owned.name}: ${error.message}`);
    }
  }
  if (failure || cleanupFailures.length) {
    throw new Error([
      failure?.message,
      cleanupFailures.length ? `Cleanup could not be fully verified; inspect only these run-owned filenames: ${cleanupFailures.join("; ")}` : null,
    ].filter(Boolean).join(" "));
  }
  return {
    track, origin: client.base.origin, mode: "functional", status: "passed", functionalSmoke: true,
    authentication, checks: ["database-readiness", "authentication", "upload", "list", "download-bytes", "previous-next-navigation", "back-to-gallery", "delete"],
    photosCreated: created.length, photosDeleted: created.filter((photo) => photo.deleted).length,
  };
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log("node scripts/smoke-apps.mjs --track dotnet|java --url http://localhost:PORT [--health-only]");
    console.log("Functional tests require SMOKE_ADMIN_PASSWORD; SMOKE_ADMIN_USERNAME defaults to admin. Remote URLs require HTTPS.");
    return;
  }
  const result = await runSmoke(options);
  console.log(JSON.stringify(result, null, 2));
  if (result.mode === "health-only") console.log("Readiness only: the functional smoke test has NOT run.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`Smoke test failed: ${error.message}`);
    process.exitCode = 1;
  });
}
