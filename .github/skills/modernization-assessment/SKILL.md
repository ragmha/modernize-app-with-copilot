---
name: modernization-assessment
description: Assess the two PhotoAlbum applications and prepare a human-reviewed modernization plan.
---

1. Read the current exercise lesson, project files, runtime configuration, services,
   repositories, authentication, Dockerfiles, and existing tests.
2. Inventory baseline and target versions separately for .NET and Java.
3. Trace a photo through upload, metadata persistence, binary storage, retrieval,
   navigation, and deletion. Identify SQL dialect and ephemeral-file assumptions.
4. Produce a risk/acceptance matrix covering behavior, authorization, secrets,
   persistence across restarts, migration rollback, and operational costs.
5. Distinguish confirmed source facts, executed results, and hypotheses.
6. Request human approval before edits or any cloud action. Never fabricate evidence.

Use the real source contracts and `docs/azure-setup.md`. The .NET sample is already
ASP.NET Core. A connection-string change does not finish Oracle migration.
Local unit tests do not prove that both Azure applications work.
