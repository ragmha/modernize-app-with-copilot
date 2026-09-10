# Sample provenance and maintainer adaptations

This exercise vendors **allowlisted application files**, not complete upstream
repositories or their automation. Microsoft retains its copyright. The sample
code is provided under the MIT licenses at
[`apps/dotnet/LICENSE`](../apps/dotnet/LICENSE) and
[`apps/java/LICENSE`](../apps/java/LICENSE). This is an independently maintained
exercise using Microsoft samples; it is not a claim of Microsoft endorsement.

## Immutable inputs

The authoritative machine-readable record is
[`samples.lock.json`](../samples.lock.json). It records the full source commits,
archive SHA-256 digests, inclusion rules, upstream and adapted hashes for every
included file, and the reason for every adaptation.

| Track | Upstream | Pinned commit |
| --- | --- | --- |
| ASP.NET Core | [Azure-Samples/PhotoAlbum](https://github.com/Azure-Samples/PhotoAlbum) | `2fd6aff064d101cee630a25bbc0e42d14ce8599a` |
| Java | [Azure-Samples/PhotoAlbum-Java](https://github.com/Azure-Samples/PhotoAlbum-Java) | `0d5a4c47fa229c48bd99c625c69f80af5096a091` |

**Only** `PhotoAlbum/`, `PhotoAlbum.Tests/`, the solution, Dockerfile and LICENSE
are imported for .NET. **Only** `src/`, `pom.xml`, Dockerfile, LICENSE and the
reviewed `.env.example` are imported for Java. The source `.gitkeep` and library
license files are retained. Root upstream READMEs, `.github`, `.squad`, `.claude`,
`.specify`, agent instructions, setup scripts, deployment automation, and Oracle
initialization scripts are excluded. In particular, the Java repository's
XE-specific initialization scripts are not suitable for the lab's Oracle Free
`FREEPDB1` service and are not imported or executed.

No proprietary Microsoft modernization CLI code or binaries are distributed.
Upstream instructions and workflows are never executed by the import process.

### Dependency license notices

- **GitHub Agentic Workflows:** the compiled workflow uses the MIT-licensed
  gh-aw v0.86.2 tooling/templates. Its
  [GitHub copyright and license](licenses/gh-aw-LICENSE.txt) are retained from
  [the pinned source](https://github.com/github/gh-aw/blob/48e5fa3ff52294d91d97715017a9f8693a48387f/LICENSE).
- **ImageSharp 3.1.11:** this open-source exercise consumes ImageSharp under
  **Apache-2.0**, through the upstream eligibility condition for software licensed
  under an open-source or source-available license. For provenance, the exact
  upstream license-selection terms are retained in
  [`licenses/ImageSharp-3.1.11-LICENSE.txt`](licenses/ImageSharp-3.1.11-LICENSE.txt),
  downloaded from the [versioned upstream license](https://github.com/SixLabors/ImageSharp/blob/v3.1.11/LICENSE).
  Their SHA-256 is
  `fdb7f24db8a6838eba1477242d2457bf6db2f3682b7cb3a16824e9f2f07936c2`.
  **Do not assume the same eligibility for a proprietary derivative.** Review
  your own usage against those terms; other usage may require a commercial
  license. Neither the sample's MIT license nor this notice relicenses a
  dependency.
- The vendored .NET browser libraries retain their original notices:
  [Bootstrap](../apps/dotnet/PhotoAlbum/wwwroot/lib/bootstrap/LICENSE),
  [jQuery](../apps/dotnet/PhotoAlbum/wwwroot/lib/jquery/LICENSE.txt),
  [jQuery Validation](../apps/dotnet/PhotoAlbum/wwwroot/lib/jquery-validation/LICENSE.md),
  and [jQuery Unobtrusive Validation](../apps/dotnet/PhotoAlbum/wwwroot/lib/jquery-validation-unobtrusive/LICENSE.txt).
- Other NuGet/Maven dependencies are **restored, not vendored**, and retain their
  respective package licenses, including the Oracle JDBC driver. Java's upstream
  HTML references Bootstrap 5.3.0 on a public CDN; the HTTP smoke runner does not
  fetch that CDN or execute any page scripts.

## What changed, and what deliberately did not

The reproducible, data-only
[`baseline-adaptations.json`](baseline-adaptations.json) contains the reviewed
replacement/additional files. Its own SHA-256 is in the lock file. It is not a
script. `scripts/import-samples.mjs` validates both its preconditions and final
file hashes before writing a new snapshot.

Maintainer adaptations are limited to:

1. Add anonymous, uncached `GET /health` endpoints in the **application process**,
   with real database-connectivity checks and safe `200`/`503` JSON responses.
   .NET bypasses HTTPS redirection only for the internal health probe; Java
   explicitly permits the health route in its existing security configuration.
2. Explicitly retain .NET's HTTP container port `8080`. Java already uses `8080`.
   Add `.dockerignore` files so local credentials, uploads and build outputs do
   not become container context.
3. Change Java's two runtime profiles from destructive Hibernate `create` to
   `update`, so an ordinary baseline restart does not discard a learner's photos.
   This is **not** a production migration strategy; the H2 test profile retains
   `create-drop`.
4. Run `mvn --batch-mode --no-transfer-progress clean verify` in the Java Docker
   build instead of `-DskipTests`. The original context test selects H2 and needs
   no external Oracle service. Add three focused health-controller tests using
   the already-declared test dependencies.
5. Remove reusable password placeholders from Java's `.env.example` and explain
   the distinction between Oracle-container and application variables.

The .NET projects remain **`net9.0` / EF Core `9.0.9`** with ImageSharp `3.1.11`.
They are **ASP.NET Core Razor Pages, not .NET Framework**. The original SQL Server
provider, startup EF migrations, local-file persistence and business logic remain.
The Java project remains **Java 8 / Spring Boot `2.7.18`**, including `javax`
imports, Oracle dialect, `ROWNUM`, `NVL`, `TO_CHAR`, Oracle-shaped columns and
database `@Lob byte[]` persistence. No framework upgrade, PostgreSQL rewrite,
Azure SDK integration, managed-identity application code or cloud storage
migration has been supplied as a solved answer.

## Baseline runtime contracts

### ASP.NET Core

- Source launch profile: `http://localhost:5134`; container: HTTP `8080`.
- `ConnectionStrings__DefaultConnection`: SQL Server connection string. The
  unchanged source default uses Windows LocalDB, so Linux/Codespaces **must**
  supply the lab's external SQL Server connection.
- `Admin__Username`: defaults to `admin`. `Admin__Password`: required to log in;
  the application fails login closed if it is absent.
- `GET /Login` and form `POST /Login` use `Username`, `Password`, `ReturnUrl`,
  cookies and the hidden `__RequestVerificationToken` anti-forgery field.
- `POST /?handler=Upload` accepts multipart `files`; `GET /Detail/{id}` shows the
  photo; `GET /PhotoFile?id={id}` serves its bytes; the detail page's
  `POST ...?handler=Delete` form requires an authenticated admin and CSRF.
- **Inherited behavior:** the .NET upload handler is public (with anti-forgery);
  deletion requires login. This is a deliberately retained sample behavior,
  not a production security recommendation. Never upload personal or sensitive
  photos to the exercise.
- `FileUpload__UploadPath` defaults to `wwwroot/uploads`. SQL Server contains
  metadata; image bytes are on local disk. The learner must replace that disk
  dependency with Azure Blob Storage, accessed using managed identity, before
  cloud completion.

### Java

- HTTP `8080`; no Maven wrapper is included upstream.
- `SPRING_DATASOURCE_URL`: defaults to
  `jdbc:oracle:thin:@oracle-db:1521/FREEPDB1`. For a host-run app use the lab's
  published database address, typically `localhost:1521/FREEPDB1`.
- `SPRING_DATASOURCE_USERNAME`: defaults to `photoalbum`.
  `SPRING_DATASOURCE_PASSWORD`: required by the application.
- The Oracle container separately consumes `ORACLE_PASSWORD`, `APP_USER`, and
  `APP_USER_PASSWORD`. Set the application's datasource password to that
  generated `APP_USER_PASSWORD`; the application does not directly consume the
  Oracle-container variable names.
- `APP_ADMIN_USERNAME`: defaults to `admin`. `APP_ADMIN_PASSWORD`: required at
  startup through `app.admin.password`.
- **Actual upstream auth is stateless HTTP Basic, with CSRF disabled**, not a
  login page or a cookie-based session. `POST /upload` and
  `POST /detail/{id}/delete` require credentials. The read-only gallery, details,
  `/photo/{id}` and health endpoint are public.
- The gallery is `/`, detail is `/detail/{UUID}`, and bytes are `/photo/{UUID}`.
  Original PNG upload bytes live in Oracle BLOBs, not in a local uploads folder.
  PostgreSQL schema/query/BLOB compatibility remains learner work.

Both added health endpoints return `{"status":"ok"}` with HTTP `200` only when
their database connection is ready, or `{"status":"unhealthy"}` with HTTP `503`.
They send `Cache-Control: no-store` and never return connection strings, exception
details, or credentials. They are readiness checks, **not** evidence that all
application behavior works.

## Commands

From the repository root in the provisioned Codespace, the parent exercise's lab
commands supply local database services and generated credentials. Native test
commands (using the baseline SDK/JDK) are:

```sh
dotnet test apps/dotnet/PhotoAlbum.sln --configuration Release
mvn --batch-mode --no-transfer-progress -f apps/java/pom.xml verify
node --test tests/smoke-apps.test.mjs
```

After exporting the application/database variables above, native run commands
are:

```sh
dotnet run --project apps/dotnet/PhotoAlbum/PhotoAlbum.csproj --launch-profile http
mvn --batch-mode --no-transfer-progress -f apps/java/pom.xml spring-boot:run
```

Set `SMOKE_ADMIN_PASSWORD` to the matching track's generated admin password, and
optionally set `SMOKE_ADMIN_USERNAME` (default `admin`). Do not put passwords in
command-line arguments or URLs:

```sh
node scripts/smoke-apps.mjs --track dotnet --url http://localhost:5134
node scripts/smoke-apps.mjs --track java --url http://localhost:8080
# After the learner deploys their changed application:
node scripts/smoke-apps.mjs --track dotnet --url https://YOUR-DOTNET-APP
node scripts/smoke-apps.mjs --track java --url https://YOUR-JAVA-APP
```

The Node 22+ runner uses only built-ins. It authenticates with the actual native
contract, generates **two uniquely named tiny PNGs**, uploads both, verifies
returned metadata and gallery/detail views, downloads and compares exact bytes,
follows both previous/next and back-to-gallery navigation, and deletes only the
IDs it created after rechecking each filename. Deletion must remove gallery,
detail and image access. Pre-existing gallery IDs must remain. Cleanup is
attempted after failures; if cleanup cannot be verified, the error names only
this run's own files for inspection.

The runner never follows redirects automatically or fetches another origin.
Remote HTTP, embedded URL credentials and non-root base paths are rejected. The
modernized application must keep the UI routes and proxy image reads through its
own origin; redirects to Blob Storage are intentionally not followed. Both
baseline services preserve original PNG bytes, so the migrated storage should
also preserve those bytes. Avoid concurrent uploads/deletes during a smoke run:
the test creates an adjacent pair to verify both navigation directions and checks
that pre-existing records remain.

`--health-only` performs no login or photo operations and explicitly emits
`functionalSmoke: false`. **It must never satisfy the functional or Azure
completion checkpoints.** There is no Azure resource creation in these scripts.

## Maintainer re-import and verification

```sh
# Read-only: detect differences from the recorded exercise baseline.
node scripts/import-samples.mjs --verify

# Only in a checkout where the selected apps directory does not exist:
node scripts/import-samples.mjs --track dotnet
node scripts/import-samples.mjs --track java
```

An existing target directory always causes import to fail before downloading or
writing anything. There is **no force/reset mode**. Never delete a learner's
directory to make import run. To inspect pristine snapshots use a separate clean
checkout. `--verify` is a maintainer provenance check, not an exercise gate:
intentional learner modernization will change these source hashes.

For an intentional maintainer update, review the upstream commit/archive hashes,
inclusion list and adaptation reasons in `samples.lock.json`, then use
`--record` to regenerate the data-only adaptation bundle and file inventory from
the reviewed local files. `--record` refuses unlisted source modifications and
does not rewrite applications. Optional `--archive-dir` reads previously
downloaded, hash-checked `dotnet.tar.gz` and `java.tar.gz` inside the repository.
The importer verifies tar checksums and bounds, only extracts regular allowlisted
files, rejects unsafe paths and links, and does not execute archived content.

## Authoring validation limitations

- The focused Node tests validate both complete protocol sequences and failures,
  including cookies, CSRF, wrong credentials, malformed responses, origin
  isolation, upload integrity, navigation and own-photo cleanup.
- The seven upstream .NET service tests were executed successfully using the
  installed .NET 10 SDK/runtime with **runtime roll-forward only**. Project
  targets were not changed from `net9.0`; baseline .NET 9 validation belongs in
  Linux CI/Codespaces.
- Java/Maven were unavailable on the authoring host and Docker's daemon was not
  started. Java tests, Linux container builds, and real SQL Server/Oracle smoke
  runs therefore require the exercise CI/Codespace. Mocked Node protocol tests
  are not a claim that those real services were run here.
- No Azure resource was provisioned and no deployment was attempted.
