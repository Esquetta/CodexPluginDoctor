# Deterministic Finding Fingerprints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every emitted diagnostic finding a stable SHA-256 identity and expose it through all existing report formats.

**Architecture:** Add one focused fingerprint module that canonicalizes rule IDs and structured evidence relative to a package root. Enrich findings at completed analysis boundaries, then let existing JSON surfaces carry the additive field while text, Markdown, security, trust, generic MCP, and SARIF renderers expose it explicitly.

**Tech Stack:** TypeScript, Node.js `crypto` and `path`, Vitest, npm release scripts.

---

### Task 1: Fingerprint Core

**Files:**
- Create: `src/reporting/finding-fingerprint.ts`
- Modify: `src/domain/types.ts`
- Modify: `src/index.ts`
- Test: `tests/finding-fingerprint.test.ts`

- [ ] **Step 1: Write failing unit tests**

Cover stable key ordering, rule ID separation, evidence value separation, path separator normalization, package-root independence, rule-only findings, and immutable enrichment.

- [ ] **Step 2: Verify tests fail**

Run: `npx vitest run tests/finding-fingerprint.test.ts`

Expected: FAIL because the fingerprint module and public type do not exist.

- [ ] **Step 3: Implement the minimal fingerprint utility**

Use SHA-256 over a deterministic JSON payload containing fingerprint version `1`, rule ID, and canonical evidence. Sort evidence keys, normalize path-like evidence values to `/`, and replace package-root prefixes with package-relative paths.

- [ ] **Step 4: Verify focused tests pass**

Run: `npx vitest run tests/finding-fingerprint.test.ts`

Expected: PASS.

### Task 2: Finding Enrichment

**Files:**
- Modify: `src/core/validate-plugin.ts`
- Modify: `src/security/security-audit.ts`
- Modify: `src/security/trust-score.ts`
- Modify: `src/mcp/generic-mcp-doctor.ts`
- Test: `tests/check-command.test.ts`
- Test: `tests/security-command.test.ts`
- Test: `tests/trust-command.test.ts`
- Test: `tests/mcp-command.test.ts`

- [ ] **Step 1: Add failing integration assertions**

Assert that representative validation, security, trust, and generic MCP findings contain 64-character lowercase hexadecimal fingerprints.

- [ ] **Step 2: Verify integration tests fail**

Run: `npx vitest run tests/check-command.test.ts tests/security-command.test.ts tests/trust-command.test.ts tests/mcp-command.test.ts`

Expected: FAIL because completed findings are not enriched.

- [ ] **Step 3: Enrich findings at report assembly boundaries**

Apply the shared utility after validation/runtime merging and before completed security, trust, and generic MCP reports are returned. Do not change finding IDs, severities, messages, or schema versions.

- [ ] **Step 4: Verify integration tests pass**

Run the same focused integration command.

Expected: PASS.

### Task 3: Report Surfaces

**Files:**
- Modify: `src/reporting/render-text-report.ts`
- Modify: `src/reporting/render-markdown-report.ts`
- Modify: `src/reporting/render-sarif-report.ts`
- Modify: `src/security/security-audit.ts`
- Modify: `src/security/trust-score.ts`
- Modify: `src/mcp/generic-mcp-doctor.ts`
- Test: `tests/render-text-report.test.ts`
- Test: `tests/markdown-report.test.ts`
- Test: `tests/cli-command.test.ts`
- Test: `tests/security-command.test.ts`

- [ ] **Step 1: Add failing renderer assertions**

Assert `Fingerprint:` lines in human reports and `partialFingerprints["codexPluginDoctor/v1"]` in SARIF.

- [ ] **Step 2: Verify renderer tests fail**

Run: `npx vitest run tests/render-text-report.test.ts tests/markdown-report.test.ts tests/cli-command.test.ts tests/security-command.test.ts`

Expected: FAIL because renderers do not expose fingerprints.

- [ ] **Step 3: Implement report rendering**

Render fingerprints after suggested fixes and before evidence. Add the SARIF partial fingerprint without removing evidence properties.

- [ ] **Step 4: Verify renderer tests pass**

Run the same focused renderer command.

Expected: PASS.

- [ ] **Step 5: Commit the feature**

Commit source, tests, design, and plan as `feat: add deterministic finding fingerprints`.

### Task 4: Documentation and Release Metadata

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: active version references under `docs/`
- Create: `docs/engineering/v1.25.0-release-notes.md`

- [ ] **Step 1: Document the additive contract**

Explain fingerprint semantics, stability boundaries, report surfaces, and that findings without evidence use rule-level identity.

- [ ] **Step 2: Set version `1.25.0`**

Update npm metadata and active release documentation without changing historical release notes.

- [ ] **Step 3: Run release verification**

Run:

```powershell
npm test
npm run build
npm run release-check
git diff --check
```

Expected: all tests, build, dry-run package validation, and whitespace checks pass.

- [ ] **Step 4: Commit release metadata**

Commit as `chore: bump version to 1.25.0`.

### Task 5: Publish

**Files:** No source changes expected.

- [ ] **Step 1: Push commits**

Push `main` and verify the remote branch contains the feature and release commits.

- [ ] **Step 2: Wait for CI**

Run `gh run watch <run-id> --repo Esquetta/CodexPluginDoctor --exit-status`.

Expected: CI succeeds.

- [ ] **Step 3: Create GitHub Release**

Tag and publish `v1.25.0` using `docs/engineering/v1.25.0-release-notes.md`.

- [ ] **Step 4: Publish npm**

Run `npm publish --access public`. Complete browser or OTP authentication if npm requests it.

- [ ] **Step 5: Verify synchronization**

Run:

```powershell
npm view codex-plugin-doctor version dist-tags --json
npm run verify-release-sync
npm install -g codex-plugin-doctor@1.25.0
codex-plugin-doctor --version
```

Expected: npm `latest`, GitHub Release, package metadata, and global CLI all report `1.25.0`.
