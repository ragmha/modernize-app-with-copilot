import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import { inflateSync } from "node:zlib";
import {
  AppClient, CookieJar, createTinyPng, decodeHtml, parseArguments,
  parseAttributes, parseCsrf, responseBytes, runSmoke, sameOriginUrl, validateBaseUrl,
} from "../scripts/smoke-apps.mjs";
import { safeRelativePath } from "../scripts/import-samples.mjs";

const origin = "http://localhost:5134";
const password = "smoke-fixture-only";

function response(url, status, body = "", headers = {}) {
  const result = new Response(body, { status, headers });
  Object.defineProperty(result, "url", { value: String(url) });
  return result;
}

function fixture(track, behavior = {}, baseUrl = origin) {
  const photos = new Map();
  const calls = [];
  const deleted = [];
  const created = [];
  const tokens = new Set();
  let tokenCounter = 0;
  let idCounter = 1;
  const idFor = (number) => track === "dotnet" ? String(number)
    : `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const existing = idFor(1);
  photos.set(existing, { id: existing, name: "pre-existing-photo.png", bytes: createTinyPng(), order: 1 });
  const detailPath = (id) => `${track === "dotnet" ? "/Detail" : "/detail"}/${id}`;
  const filePath = (id) => track === "dotnet" ? `/PhotoFile?id=${id}` : `/photo/${id}`;
  const deletePath = (id) => track === "dotnet" ? `/Detail/${id}?handler=Delete` : `/detail/${id}/delete`;
  const csrf = () => {
    const value = `csrf-${++tokenCounter}&opaque`;
    tokens.add(value);
    return `<input value="${value.replace("&", "&amp;")}" type='hidden' name=__RequestVerificationToken>`;
  };
  const gallery = () => `<html><body><h1>Photo Gallery</h1>
    <form id="upload-form" method=post enctype="multipart/form-data">
      ${track === "dotnet" ? csrf() : ""}<input type=file name=files>
    </form><div id="photo-gallery">${[...photos.values()].map((photo) =>
      `<a href="${detailPath(photo.id)}">${photo.name}</a>`).join("")}</div></body></html>`;
  const detail = (photo) => {
    const ordered = [...photos.values()].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((item) => item.id === photo.id);
    const previous = ordered[index - 1];
    const next = ordered[index + 1];
    return `<html><body><h1>${photo.name}</h1>
      <a href="/">Back to Gallery</a>
      <form action="${deletePath(photo.id).replace("&", "&amp;")}" method="post">
        ${track === "dotnet" ? csrf() : ""}<button>Delete</button>
      </form>
      <img class="img-fluid photo-detail-image" src="${filePath(photo.id)}" alt="${photo.name}">
      ${previous ? `<a href="${detailPath(behavior.brokenNavigation ? photo.id : previous.id)}">Previous Photo</a>` : ""}
      ${next ? `<a href="${detailPath(next.id)}"><svg></svg>Next Photo</a>` : ""}
    </body></html>`;
  };
  const basic = `Basic ${Buffer.from(`admin:${password}`).toString("base64")}`;
  const fetchImpl = async (target, options) => {
    const url = new URL(target);
    assert.equal(url.origin, baseUrl);
    assert.equal(options.redirect, "manual");
    const headers = new Headers(options.headers);
    const authenticated = track === "java" ? headers.get("authorization") === basic
      : (headers.get("cookie") ?? "").includes(".AspNetCore.Cookies=authenticated");
    calls.push({ url, method: options.method, headers, body: options.body });
    const html = (body, extraHeaders = {}) => response(url, 200, body, { "content-type": "text/html; charset=utf-8", ...extraHeaders });
    const json = (value, status = 200) => response(url, status, JSON.stringify(value), { "content-type": "application/json" });
    const redirect = (target = "/") => response(url, 302, "", { location: target });
    const unauthorized = () => response(url, 401, "", { "www-authenticate": 'Basic realm="Realm"' });
    const formToken = () => options.body?.get("__RequestVerificationToken");
    const validMutation = () => authenticated && (track === "java" || tokens.has(formToken()));

    if (url.pathname === "/health") {
      assert.equal(headers.get("authorization"), null);
      assert.equal(headers.get("cookie"), null);
      return json({ status: behavior.unhealthy ? "unhealthy" : "ok" }, behavior.unhealthy ? 503 : 200);
    }
    if (track === "java" && headers.has("authorization") && !authenticated) return unauthorized();
    if (track === "dotnet" && url.pathname === "/Login") {
      if (options.method === "GET") {
        return html(`<form method=post action="/Login">
          <input type=hidden name=__RequestVerificationToken value="login&amp;opaque">
          <input name=Username><input type=password name=Password>
          <input name=ReturnUrl type=hidden value="">
        </form>`, { "set-cookie": "antiforgery=cookie-required; Path=/; HttpOnly; SameSite=Lax" });
      }
      if (behavior.loginRedirect) return redirect(behavior.loginRedirect);
      assert.match(headers.get("cookie") ?? "", /antiforgery=cookie-required/);
      assert.equal(options.body.get("__RequestVerificationToken"), "login&opaque");
      assert.equal(options.body.get("Username"), "admin");
      assert.equal(options.body.get("ReturnUrl"), "/");
      if (options.body.get("Password") !== password || behavior.badLogin) return html("<h1>Invalid username or password.</h1>");
      return response(url, 302, "", {
        location: "/",
        "set-cookie": ".AspNetCore.Cookies=authenticated; Path=/; HttpOnly; SameSite=Lax",
      });
    }
    const isUpload = track === "dotnet" ? url.pathname === "/" && url.searchParams.get("handler") === "Upload" : url.pathname === "/upload";
    if (isUpload && options.method === "POST") {
      if (!authenticated) return unauthorized();
      assert.equal(headers.get("origin"), baseUrl);
      if (!validMutation()) return response(url, 400, "Missing valid CSRF token");
      if (behavior.uploadRedirect) return redirect(behavior.uploadRedirect);
      if (behavior.uploadFailure) return json({ success: false, uploadedPhotos: [], failedUploads: [{ error: "failed" }] });
      const file = options.body.get("files");
      assert.ok(file instanceof Blob);
      assert.equal(file.type, "image/png");
      const bytes = Buffer.from(await file.arrayBuffer());
      const id = behavior.reuseId ? existing : idFor(++idCounter);
      if (!behavior.reuseId) {
        const photo = { id, name: file.name, bytes, order: idCounter };
        photos.set(id, photo);
        created.push(photo);
      }
      return json({
        success: true, failedUploads: [],
        uploadedPhotos: [{ id: track === "dotnet" ? Number(id) : id, originalFileName: file.name,
          width: behavior.badMetadata ? 1 : 2, height: 2, fileSize: bytes.length }],
      });
    }
    if (options.method === "GET" && url.pathname === "/") return html(gallery());
    const detailMatch = url.pathname.match(/^\/detail\/([^/]+)(\/delete)?$/i);
    if (detailMatch) {
      const id = detailMatch[1];
      if (options.method === "POST") {
        assert.ok(created.some((photo) => photo.id === id), "The harness attempted to delete a photo it did not create.");
        assert.equal(url.pathname + url.search, deletePath(id));
        if (!validMutation()) return unauthorized();
        if (!behavior.deleteFailure) {
          photos.delete(id);
          deleted.push(id);
        }
        return redirect();
      }
      const photo = photos.get(id);
      return photo ? html(detail(photo)) : track === "java" ? redirect() : response(url, 404);
    }
    const fileId = track === "dotnet" && url.pathname === "/PhotoFile" ? url.searchParams.get("id")
      : url.pathname.match(/^\/photo\/([^/]+)$/)?.[1];
    if (fileId) {
      const photo = photos.get(fileId);
      if (!photo || behavior.missingImage) return response(url, 404);
      return response(url, 200, behavior.corruptImage ? Buffer.from("not-the-upload") : photo.bytes, { "content-type": "image/png" });
    }
    throw new Error(`Unexpected fixture route ${options.method} ${url.pathname}`);
  };
  return { fetchImpl, calls, photos, created, deleted, existing };
}

test("arguments select one track and distinguish health-only from functional work", () => {
  assert.deepEqual(parseArguments(["--track", "dotnet", "--url", origin]),
    { healthOnly: false, track: "dotnet", url: `${origin}/` });
  assert.equal(parseArguments(["--track", "java", "--url", "https://album.example", "--health-only"]).healthOnly, true);
  for (const args of [
    [], ["--track", "python", "--url", origin], ["--track"], ["--track", "java", "--url"],
    ["--track", "java", "--track", "dotnet", "--url", origin],
    ["--track", "java", "--url", origin, "--force"], ["--url", origin, "--track", "--health-only"],
  ]) assert.throws(() => parseArguments(args));
});

test("HTTP is loopback-only and URLs cannot smuggle credentials or paths", () => {
  for (const url of ["http://localhost:8080", "http://127.0.0.1:8080", "http://[::1]:8080", "https://album.example"]) {
    assert.ok(validateBaseUrl(url));
  }
  for (const url of [
    "http://album.example", "http://localhost.evil.example", "ftp://localhost",
    "https://user:password@album.example", "https://album.example/path",
    "https://album.example/?password=x", "https://album.example/#secret", "not a URL",
  ]) assert.throws(() => validateBaseUrl(url));
  assert.equal(sameOriginUrl("/Detail?id=1", origin).origin, origin);
  assert.throws(() => sameOriginUrl("//evil.example/path", origin), /cross-origin/);
  assert.throws(() => sameOriginUrl("https://localhost:5134/path", origin), /cross-origin/);
  assert.throws(() => sameOriginUrl("http://user@localhost:5134/path", origin), /credentials/);
});

test("CSRF parser handles input ordering, quoting, entities, and duplicate identical tokens", () => {
  const html = `<input value='abc&amp;123&#x2b;&#47;' data-note="a > b" TYPE=hidden NAME=__RequestVerificationToken />`;
  assert.deepEqual(parseCsrf(html), { name: "__RequestVerificationToken", value: "abc&123+/" });
  assert.deepEqual(parseCsrf(html + html), parseCsrf(html));
  assert.deepEqual(parseCsrf('<input name="_csrf" type="hidden" value="spring-token">'),
    { name: "_csrf", value: "spring-token" });
  assert.equal(decodeHtml("&quot;&#39;&lt;&gt;&#x1f4f7;"), "\"'<>📷");
  assert.equal(parseAttributes('<input name=files type=file>').name, "files");
});

test("CSRF parser rejects missing, ambiguous, empty, control-character, and duplicate attributes", () => {
  assert.throws(() => parseCsrf("<h1>Sign in</h1>"), /Expected a CSRF/);
  assert.equal(parseCsrf("<h1>HTTP Basic</h1>", { required: false }), null);
  assert.throws(() => parseCsrf('<input type=hidden name="_csrf" value="">'), /empty/);
  assert.throws(() => parseCsrf('<input type=hidden name="_csrf" value="a&#10;b">'), /malformed/);
  assert.throws(() => parseCsrf('<input type=hidden name="_csrf" value="one"><input type=hidden name="_csrf" value="two">'), /Ambiguous/);
  assert.throws(() => parseCsrf('<input type=hidden name="_csrf" value="one" value="two">'), /duplicate/);
  assert.throws(() => parseCsrf('<input type=text name="_csrf" value="not-hidden">'), /Expected/);
  assert.equal(parseCsrf(`<!-- <input name=_csrf type=hidden value=fake> -->
    <script>const x = '<input name=_csrf type=hidden value=fake>';</script>`, { required: false }), null);
});

test("cookie jar preserves separate Set-Cookie values, equals signs, and Expires commas", () => {
  const jar = new CookieJar("https://album.example", () => Date.UTC(2026, 0, 1));
  const headers = new Headers();
  headers.append("set-cookie", "auth=abc==; Path=/; HttpOnly; Secure; Expires=Wed, 01 Jan 2031 00:00:00 GMT");
  headers.append("set-cookie", "csrf=second; Path=/; SameSite=Strict");
  headers.append("set-cookie", "wrong=ignored; Domain=evil.example; Path=/");
  jar.absorb(headers, "https://album.example/Login");
  assert.equal(jar.header("https://album.example/"), "auth=abc==; csrf=second");
  assert.throws(() => jar.header("https://evil.example/"), /cross-origin/);
});

test("cookie jar respects path boundaries, longest-path ordering, and deletion precedence", () => {
  let now = 1_000;
  const jar = new CookieJar(origin, () => now);
  const headers = new Headers();
  headers.append("set-cookie", "session=root; Path=/");
  headers.append("set-cookie", "session=admin; Path=/admin; Max-Age=10");
  headers.append("set-cookie", "local=value");
  jar.absorb(headers, `${origin}/admin/login`);
  assert.equal(jar.header(`${origin}/admin/page`), "session=admin; local=value; session=root");
  assert.equal(jar.header(`${origin}/administrator`), "session=root");
  jar.absorb(new Headers({ "set-cookie": "session=delete; Path=/admin; Max-Age=0; Expires=Wed, 01 Jan 2031 00:00:00 GMT" }), `${origin}/admin`);
  assert.equal(jar.header(`${origin}/admin`), "local=value; session=root");
  jar.absorb(new Headers({ "set-cookie": "short=lived; Path=/; Max-Age=1" }), `${origin}/`);
  now += 2_000;
  assert.ok(!jar.header(`${origin}/`).includes("short="));
});

test("cookie jar enforces Secure and host-prefix constraints", () => {
  const httpJar = new CookieJar(origin);
  httpJar.absorb(new Headers({ "set-cookie": "auth=must-not-use; Secure; Path=/" }), origin);
  assert.equal(httpJar.header(origin), "");
  const secure = new CookieJar("https://album.example");
  const headers = new Headers();
  headers.append("set-cookie", "__Host-invalid=x; Secure; Domain=album.example; Path=/");
  headers.append("set-cookie", "__Secure-invalid=x; Path=/");
  headers.append("set-cookie", "__Host-valid=y; Secure; Path=/");
  secure.absorb(headers, "https://album.example/Login");
  assert.equal(secure.header("https://album.example/"), "__Host-valid=y");
});

test("origin-bound client never follows redirects or sends credentials to a second origin", async () => {
  const calls = [];
  const client = new AppClient(origin, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(url, 302, "", { location: "https://evil.example/collect" });
    },
  });
  client.useBasic("admin", password);
  await assert.rejects(client.request("/upload", { method: "POST", body: new FormData() }), /cross-origin/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, origin);
  assert.equal(calls[0].options.redirect, "manual");
  await assert.rejects(client.request("https://evil.example/"), /cross-origin/);
  assert.equal(calls.length, 1);
  await assert.rejects(client.request("/", { headers: { Cookie: "injected=x" } }), /origin-bound/);
  await assert.rejects(client.request("/", { headers: { Authorization: "injected" } }), /origin-bound/);
  assert.equal(calls.length, 1);
});

test("client reports network failures without echoing secret-bearing transport errors", async () => {
  const client = new AppClient(origin, { fetchImpl: async () => { throw new Error(`failed with ${password}`); } });
  await assert.rejects(client.request("/"), (error) => !error.message.includes(password) && /failed or timed out/.test(error.message));
  const missingLocation = new AppClient(origin, { fetchImpl: async (url) => response(url, 302) });
  await assert.rejects(missingLocation.request("/"), /no Location/);
});

test("response limits reject oversized data and generated PNG contains the intended pixels", async () => {
  await assert.rejects(responseBytes(new Response(Buffer.alloc(101)), 100), /size limit/);
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  const png = createTinyPng(pixels);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 2);
  assert.equal(png.readUInt32BE(20), 2);
  const imageDataSize = png.readUInt32BE(33);
  assert.equal(png.subarray(37, 41).toString("ascii"), "IDAT");
  const raw = inflateSync(png.subarray(41, 41 + imageDataSize));
  assert.deepEqual(raw, Buffer.concat([Buffer.from([0]), pixels.subarray(0, 6), Buffer.from([0]), pixels.subarray(6)]));
  assert.throws(() => createTinyPng(Buffer.alloc(3)), /12 pixel bytes/);
});

for (const track of ["dotnet", "java"]) {
  test(`${track}: native fetch carries real multipart, cookies, and redirects over loopback HTTP`, async (t) => {
    let app;
    const server = createServer(async (request, outgoing) => {
      try {
        const target = `http://127.0.0.1:${server.address().port}${request.url}`;
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const options = { method: request.method, headers: new Headers(request.headers), redirect: "manual" };
        if (request.method === "POST") {
          options.body = await new Request(target, {
            method: request.method, headers: options.headers, body: Buffer.concat(chunks),
          }).formData();
        }
        const result = await app.fetchImpl(target, options);
        outgoing.statusCode = result.status;
        for (const [key, value] of result.headers) {
          if (key !== "set-cookie") outgoing.setHeader(key, value);
        }
        if (result.headers.getSetCookie().length) outgoing.setHeader("set-cookie", result.headers.getSetCookie());
        outgoing.end(Buffer.from(await result.arrayBuffer()));
      } catch {
        outgoing.statusCode = 500;
        outgoing.end("Protocol fixture failed.");
      }
    });
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    t.after(() => new Promise((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    }));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    app = fixture(track, {}, baseUrl);
    const result = await runSmoke({ track, url: baseUrl, password, uploadPauseMs: 0 });
    assert.equal(result.functionalSmoke, true);
    assert.equal(result.photosDeleted, 2);
    assert.deepEqual([...app.photos.keys()], [app.existing]);
  });

  test(`${track}: real contract sequence authenticates, uploads, reads, navigates, and deletes only owned photos`, async () => {
    const app = fixture(track);
    const result = await runSmoke({ track, url: origin, password, fetchImpl: app.fetchImpl, uploadPauseMs: 0 });
    assert.equal(result.status, "passed");
    assert.equal(result.functionalSmoke, true);
    assert.equal(result.authentication, track === "dotnet" ? "cookie-and-csrf" : "http-basic");
    assert.equal(result.photosCreated, 2);
    assert.equal(result.photosDeleted, 2);
    assert.equal(app.photos.size, 1);
    assert.ok(app.photos.has(app.existing));
    assert.deepEqual([...app.deleted].sort(), app.created.map((photo) => photo.id).sort());
    assert.equal(new Set(app.created.map((photo) => photo.name)).size, 2);
    assert.ok(app.calls.some((call) => call.url.pathname === (track === "dotnet" ? "/PhotoFile" : `/photo/${app.created[0].id}`)));
  });

  test(`${track}: health-only makes no authentication or photo requests and is not functional smoke`, async () => {
    const app = fixture(track);
    const result = await runSmoke({ track, url: origin, healthOnly: true, fetchImpl: app.fetchImpl });
    assert.equal(result.functionalSmoke, false);
    assert.equal(result.mode, "health-only");
    assert.equal(app.calls.length, 1);
    assert.equal(app.calls[0].url.pathname, "/health");
  });

  test(`${track}: rejects readiness failure and missing credentials before creating data`, async () => {
    const app = fixture(track, { unhealthy: true });
    await assert.rejects(runSmoke({ track, url: origin, password: "", fetchImpl: app.fetchImpl }), /SMOKE_ADMIN_PASSWORD/);
    assert.equal(app.calls.length, 0);
    await assert.rejects(runSmoke({ track, url: origin, password, fetchImpl: app.fetchImpl }), /readiness.*503/);
    assert.equal(app.created.length, 0);
  });

  for (const [behavior, expected] of [
    ["uploadFailure", /exactly one successful/],
    ["reuseId", /existing photo ID/],
    ["badMetadata", /metadata/],
    ["corruptImage", /image bytes differ/],
    ["missingImage", /Photo download.*404/],
    ["brokenNavigation", /adjacent photos/],
    ["deleteFailure", /Cleanup could not be fully verified/],
  ]) {
    test(`${track}: ${behavior} cannot produce a passing functional result`, async () => {
      const app = fixture(track, { [behavior]: true });
      await assert.rejects(runSmoke({ track, url: origin, password, fetchImpl: app.fetchImpl, uploadPauseMs: 0 }), expected);
      assert.ok(app.photos.has(app.existing));
      assert.ok(!app.deleted.includes(app.existing));
      if (!["deleteFailure", "reuseId"].includes(behavior)) {
        assert.equal(app.photos.size, 1, "Even a failed smoke run must clean up identities it safely owns.");
      }
    });
  }
}

test(".NET login failure is not confused with a successful 200 login page", async () => {
  const app = fixture("dotnet", { badLogin: true });
  await assert.rejects(runSmoke({ track: "dotnet", url: origin, password, fetchImpl: app.fetchImpl }), /Admin login.*received 200/);
  assert.equal(app.created.length, 0);
});

test(".NET login redirects cannot exfiltrate credentials", async () => {
  const app = fixture("dotnet", { loginRedirect: "https://evil.example/collect" });
  await assert.rejects(runSmoke({ track: "dotnet", url: origin, password, fetchImpl: app.fetchImpl }), /cross-origin/);
  assert.equal(app.created.length, 0);
  assert.ok(app.calls.every((call) => call.url.origin === origin));
});

test("Java rejects wrong Basic credentials without mutating data", async () => {
  const app = fixture("java");
  await assert.rejects(runSmoke({ track: "java", url: origin, password: "wrong-fixture-value", fetchImpl: app.fetchImpl }), /authentication.*401/);
  assert.equal(app.created.length, 0);
});

test("HTTP-200 proxy pages and malformed JSON never count as readiness", async () => {
  await assert.rejects(runSmoke({ track: "dotnet", url: origin, password,
    fetchImpl: async (url) => response(url, 200, "<h1>Proxy ready</h1>", { "content-type": "text/html" }),
  }), /expected JSON/);
  await assert.rejects(runSmoke({ track: "dotnet", url: origin, password,
    fetchImpl: async (url) => response(url, 200, `not-json-${password}`, { "content-type": "application/json" }),
  }), (error) => /malformed/.test(error.message) && !error.message.includes(password));
});

test("sample import paths reject traversal, Windows drive/ADS paths, and instruction-style absolute paths", () => {
  assert.equal(safeRelativePath("PhotoAlbum/Program.cs"), "PhotoAlbum/Program.cs");
  for (const path of ["../Program.cs", "/absolute/file", "C:/file", "file:stream", "dir\\file", "a//b", "./file", "a/../b"]) {
    assert.throws(() => safeRelativePath(path), /Unsafe/);
  }
});
