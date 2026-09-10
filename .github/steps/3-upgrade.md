## Step 3: Upgrade both frameworks without losing behavior

Keep changes small and compare behavior against the baseline. Updating a version
string is not enough: the code, tests, dependency families, and runtime images must agree.

### Activity

1. Create a framework-upgrade branch. Ask Copilot to implement your approved plan one track at a time.
2. For .NET, explicitly set **both** project files to `net10.0`, update their EF Core packages to compatible 10.x releases, and update both Docker stages to .NET 10.0.
3. For Java, use Java **25** and a patched Spring Boot **4.0.x** parent. Update `javax` APIs that moved to Jakarta, Spring Security configuration, test dependencies, and the Java Docker build/runtime images. Remove conflicting compiler source/target properties or align them with 25.
4. Add regression tests for behavior touched by the upgrade. Do not delete tests, weaken assertions, or disable security to obtain a green build.
5. Run `npm run lab -- test both` and `npm run checkpoint -- 3`. Review the difference between real tests and the structural checkpoint.
6. Open the PR, inspect generated changes, wait for CI including both container builds, and merge.

If using Modernize:

```bash
modernize upgrade ".NET 10" --source apps/dotnet
modernize upgrade "Upgrade to Java 25 and upgrade to Spring Boot 4.0" --source apps/java
```

Do not execute a mixed-language batch upgrade. If you instead execute a named
Modernize plan, review that plan first:

```bash
modernize plan execute --source apps/dotnet --plan-name dotnet-modernization
```

The application paths stay stable throughout the exercise so CI, deployment,
and smoke tests operate on the same code. This checkpoint intentionally expects
explicit versions in the existing project files; central package-management
refactoring is outside this exercise.
