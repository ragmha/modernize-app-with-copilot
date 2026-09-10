## Step 6: Deploy both applications to Azure

**Azure deployment is required for both tracks.** Local builds, Bicep compilation,
one deployed app, or a successful homepage request do not complete this checkpoint.

### Activity

1. Read [Azure setup](https://github.com/{{repository}}/blob/{{branch}}/docs/azure-setup.md) in full.
   Use a dedicated disposable lab resource group and review estimated resource costs.
2. Have an administrator configure the scoped deployment identity and GitHub OIDC
   federation, then configure the protected `azure` environment, allowed default branch,
   required reviewer, variables, and secrets.
3. Run the OIDC subject discovery workflow and use its actual `sub` claim.
   New repositories may use immutable owner/repository IDs; do not copy a name-only subject.
4. Ensure checkpoints 1-5 are complete and **CI has passed on the exact current default-branch commit**.
5. Manually run **Deploy to Azure** on the default branch, explicitly acknowledge costs,
   and approve the environment deployment after reviewing its changes.
6. Wait for both applications to deploy and for both authenticated functional smoke
   tests to pass. The workflow must produce `azure-deployment-evidence`.
7. Open each HTTPS application from the permitted learner network. Exercise upload,
   retrieve, navigation, and deletion. Check persistence across a restart and inspect
   the target SQL/PostgreSQL/Blob resources.
8. Return to this issue. The coach verifies a successful current-commit deployment run
   and machine-generated evidence for both tracks. Comment `/check` if necessary.

Use only synthetic photos and an exercise-only administrator password.
Keep runtime credentials out of screenshots, logs, and committed evidence.

A rejected approval, missing quota, failed migration, failed smoke test, expired
artifact, or missing second track means the checkpoint is **not complete**.
Fix the cause and rerun; do not replace the evidence with a hand-written success file.

The authoring of this template does not provision or validate your Azure subscription.
Your approved learner run performs the real deployment.
