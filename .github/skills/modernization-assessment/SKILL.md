---
name: modernization-assessment
description: Assess one selected PhotoAlbum track and prepare its human-reviewed modernization plan.
---

1. Identify the requested track: `apps/dotnet` for ASP.NET Core or `apps/java` for
   Java. Ask which track if it is unspecified. Read the current lesson and shared
   configuration documentation, but inspect application code only in that track.
2. Inventory the selected app's baseline and target versions, project files,
   runtime configuration, services, repositories, authentication, Dockerfile, and tests.
3. Trace a photo through upload, metadata persistence, binary storage, retrieval,
   navigation, and deletion. Identify SQL dialect and ephemeral-file assumptions.
4. Produce a risk/acceptance matrix covering behavior, authorization, secrets,
   persistence across restarts, migration rollback, and operational costs.
5. Distinguish confirmed source facts, executed results, and hypotheses.
6. Request human approval before edits or any cloud action. Never fabricate evidence.

Do not edit files or run commands during assessment. Do not inspect the other app
or produce a combined plan unless the learner explicitly requests a combined review.
Complete the other track in a separate pass; both remain required for the exercise.

Use the source contracts and `docs/azure-setup.md`. The .NET track targets
.NET 10/EF Core 10, Azure SQL, and Blob Storage. The Java track targets Java 25,
Spring Boot 4.0, and PostgreSQL; a connection-string change does not finish Oracle
migration. Local unit tests do not prove that both Azure applications work.
