# Instance-Specific Finding Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich repeatable findings with safe locator evidence so deterministic fingerprints distinguish individual package instances.

**Architecture:** Keep the existing optional `Finding.evidence` contract and add evidence directly at rule call sites where stable context already exists. Preserve package-relative paths, pass explicit runtime context into payload-size collectors, and retain dependency section names during trust analysis.

**Tech Stack:** TypeScript, Node.js, Vitest, npm release tooling.

---

### Task 1: Validation and Generic MCP Evidence

**Files:**
- Modify: `src/core/validate-plugin.ts`
- Modify: `src/mcp/generic-mcp-doctor.ts`
- Test: `tests/check-command.test.ts`
- Test: `tests/mcp-command.test.ts`

- [ ] **Step 1: Add failing evidence assertions**

Add assertions for representative repeated rules:

```ts
expect(skillFinding.evidence).toEqual({
  skillName: "broken-skill",
  skillPath: "skills/broken-skill/SKILL.md",
  field: "name"
});

expect(serverFinding.evidence).toEqual({
  configPath: ".mcp.json",
  serverName: "broken",
  field: "transport"
});
```

Also create two skill or server instances with the same rule and assert their fingerprints differ.

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
npx vitest run tests/check-command.test.ts tests/mcp-command.test.ts
```

Expected: FAIL because locator evidence is absent.

- [ ] **Step 3: Add validation evidence**

Supply package-relative evidence to existing `buildFailure` and `buildWarning` calls:

```ts
{
  manifestPath: relativePackagePath(rootPath, discoveredPackage.manifestPath),
  field: "description"
}
```

Skill rules use `skillName`, `skillPath`, `field`, and optional asset locators. MCP rules use `configPath`, `serverName`, and `field`.

- [ ] **Step 4: Add generic MCP evidence**

Extend its local `buildFinding` helper to accept optional `FindingEvidence`, then add `.mcp.json`, server, and field locators. Do not add raw config objects.

- [ ] **Step 5: Verify and commit**

Run the focused tests and commit:

```powershell
git add src/core/validate-plugin.ts src/mcp/generic-mcp-doctor.ts tests/check-command.test.ts tests/mcp-command.test.ts
git commit -m "feat: add validation finding locators"
```

### Task 2: Runtime Evidence

**Files:**
- Modify: `src/core/runtime-probe.ts`
- Test: `tests/runtime-protocol.test.ts`
- Test: `tests/json-runtime-scorecard.test.ts`

- [ ] **Step 1: Add failing runtime evidence assertions**

Assert timeout/invalid findings contain:

```ts
{
  serverName: "runtimeServer",
  method: "tools/list"
}
```

Assert selected instance findings add `toolName`, `resourceUri`, or `promptName`. For an oversized response assert numeric `contentLength` and verify the payload text is absent.

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
npx vitest run tests/runtime-protocol.test.ts tests/json-runtime-scorecard.test.ts
```

Expected: FAIL on missing runtime evidence.

- [ ] **Step 3: Extend runtime finding builders**

Add optional `FindingEvidence` parameters to runtime `buildFailure` and `buildWarning`. Every finding created inside `probeCommandServer` receives `serverName` and a stable `method`.

- [ ] **Step 4: Pass explicit oversized-content context**

Change collectors to accept bounded context:

```ts
collectOversizedToolCallWarnings(message, {
  serverName,
  method: "tools/call",
  toolName: callableTool.tool.name
});
```

Compute only maximum observed content length; never preserve response content.

- [ ] **Step 5: Verify and commit**

Run the focused tests and commit:

```powershell
git add src/core/runtime-probe.ts tests/runtime-protocol.test.ts tests/json-runtime-scorecard.test.ts
git commit -m "feat: add runtime finding locators"
```

### Task 3: Trust and Remaining Security Evidence

**Files:**
- Modify: `src/security/trust-score.ts`
- Modify: `src/security/security-audit.ts`
- Test: `tests/trust-command.test.ts`
- Test: `tests/security-command.test.ts`

- [ ] **Step 1: Add failing trust assertions**

Create multiple scripts and dependencies producing the same rule. Assert evidence includes:

```ts
{
  packageJsonPath: "package.json",
  dependencyName: "example",
  dependencySection: "devDependencies",
  versionSpec: "*"
}
```

Assert fingerprints differ by script, dependency, and dependency section.

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
npx vitest run tests/trust-command.test.ts tests/security-command.test.ts
```

Expected: FAIL on missing locator evidence.

- [ ] **Step 3: Preserve dependency section identity**

Replace the flattened dependency array with named entries:

```ts
[
  ["dependencies", packageJson.dependencies],
  ["devDependencies", packageJson.devDependencies],
  ["optionalDependencies", packageJson.optionalDependencies],
  ["peerDependencies", packageJson.peerDependencies]
]
```

Add script and dependency locators to findings.

- [ ] **Step 4: Complete safe security locators**

Add only expected manifest/config paths for audit-unavailable findings. Keep existing prompt-injection file evidence and redacted secret evidence unchanged.

- [ ] **Step 5: Verify and commit**

Run the focused tests and commit:

```powershell
git add src/security/trust-score.ts src/security/security-audit.ts tests/trust-command.test.ts tests/security-command.test.ts
git commit -m "feat: add trust finding locators"
```

### Task 4: Regression and Release Metadata

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: active release references under `docs/`
- Create: `docs/engineering/v1.26.0-release-notes.md`

- [ ] **Step 1: Run feature regression**

Run:

```powershell
npm test
npm run build
git diff --check
```

Expected: all tests and build pass.

- [ ] **Step 2: Document the evidence contract**

Document instance locator categories, safety exclusions, unchanged fingerprint algorithm, and additive schema compatibility.

- [ ] **Step 3: Set version `1.26.0`**

Update package metadata and only active version pins. Preserve historical release notes.

- [ ] **Step 4: Run release rehearsal and strict gate**

Run `npm run release-check -- --allow-dirty`, commit release metadata as `chore: bump version to 1.26.0`, then run clean `npm run release-check`.

### Task 5: Publish and Verify

**Files:** No source edits expected.

- [ ] **Step 1: Push and wait for CI**

Push `main`, locate the matching run, and execute:

```powershell
gh run watch <run-id> --repo Esquetta/CodexPluginDoctor --exit-status
```

- [ ] **Step 2: Create GitHub Release**

Push tag `v1.26.0` and create the release from `docs/engineering/v1.26.0-release-notes.md`.

- [ ] **Step 3: Publish npm**

Run `npm publish --access public`, complete browser authentication if requested, and wait for the command to return success.

- [ ] **Step 4: Verify synchronization and smoke**

Run:

```powershell
npm view codex-plugin-doctor@1.26.0 version dist-tags --json
npm run verify-release-sync
npm install -g codex-plugin-doctor@1.26.0
codex-plugin-doctor --version
```

Create or reuse a fixture with two same-rule instances and verify both published-CLI fingerprints are valid and distinct.
