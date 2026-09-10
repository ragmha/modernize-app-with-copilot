## Step 4: Remove cloud blockers and preserve data

Containers do not make local disks durable, and switching a connection string
does not translate Oracle SQL. This is the substantive cloud-migration step.

### Activity

1. Read the runtime configuration contract in [Azure setup](https://github.com/{{repository}}/blob/{{branch}}/docs/azure-setup.md) before implementing adapters.
2. In .NET, preserve SQL Server semantics for Azure SQL and replace the cloud photo-file implementation with Azure Blob Storage. Add `Azure.Storage.Blobs` and `Azure.Identity`; use `BlobServiceClient` and `DefaultAzureCredential`, not a storage account key. Preserve upload validation, authorization, and delete behavior.
3. In Java, replace Oracle JDBC with PostgreSQL. Translate `ROWNUM`, `NVL`, Oracle date/type expressions, pagination, and binary-storage semantics. Update Jakarta imports. Remove obsolete Oracle expressions from code comments as well as executable code so the mechanical check has an unambiguous result.
4. Do not use `ddl-auto=create` in Azure: a restart must not erase the album. Explain and test your schema/persistence strategy.
5. Add tests for upload, retrieval, ordering/navigation, deletion, and binary data round trips. Run against the real target database as well as any in-memory unit-test profile.
6. Preserve the existing UI routes and unauthenticated `/health` probes. Assess the actual security gaps: .NET permits public upload with CSRF protection and requires login for deletion; Java uses stateless Basic with CSRF disabled upstream. Harden write access appropriately through the approved plan, without weakening existing protections. If you change authentication, update its regression/smoke coverage deliberately.
7. Write `evidence/04-migration.md` with headings `.NET SQL and Blob`, `Java PostgreSQL`, `Persistence`, `Configuration`. Record test evidence and unresolved risks; no credentials.
8. Run `npm run lab -- test both`, `npm run checkpoint -- 4`, and the local functional smoke runner where services are running. Review and merge after CI.

### ASP.NET Core migration prompt

```text
Implement only the approved ASP.NET Core cloud-readiness changes in apps/dotnet.
Do not inspect or change apps/java. Read docs/azure-setup.md for the .NET
configuration contract. Preserve photo behavior and existing security, use the
injected Azure SQL connection, and replace cloud photo-file storage with Blob
Storage through managed identity. Add .NET regression tests for the changed
behavior and explain migration and rollback. Do not change shared infrastructure
or workflows without approval. Never provision resources or embed credentials.
```

### Java migration prompt

```text
Implement only the approved Java cloud-readiness changes in apps/java.
Do not inspect or change apps/dotnet. Read docs/azure-setup.md for the Java
configuration contract. Preserve photo behavior and existing security while
migrating the Oracle driver, SQL, schema, and binary storage to PostgreSQL.
Add versioned schema migrations and Java regression tests against PostgreSQL,
and explain rollback. Do not add Azure Blob Storage to this track or change
shared infrastructure or workflows without approval. Never provision resources
or embed credentials.
```

The structural grader is an early guard, not proof of durable storage.
Checkpoint 6 additionally requires successful functional smoke tests against
**both actual Azure deployments**. Inspect persisted data across restarts yourself.
