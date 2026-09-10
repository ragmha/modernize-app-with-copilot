## Finished: both applications are running in Azure

You established a baseline, set boundaries for AI assistance, assessed two real
applications, upgraded both technology stacks, migrated their cloud dependencies,
prepared a bounded agentic review, and deployed and functionally exercised both
applications in Azure.

The final result is tied to the default-branch commit and deployment run recorded
in this issue. Keep the approved PRs and nonsecret reports as the audit trail.

### Clean up deliberately

Follow [Azure cleanup](https://github.com/{{repository}}/blob/{{branch}}/docs/azure-setup.md)
when you no longer need the lab. Review the exact resource-group name before
approving deletion. Cleanup destroys the lab's databases and photos.

Stop or delete your Codespace when finished. Stopping an app or scaling Container
Apps to zero does **not** stop database, registry, log, storage, or Codespaces charges.

This remains a learning sample, not a production readiness certification.
Review identity design, data protection, backups, dependency support, operations,
and security requirements before adapting the result for a real workload.
