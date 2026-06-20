# Targeted Finding Suppressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fingerprint-targeted, reasoned, expiring finding suppressions to `.codex-doctor.json`.

**Architecture:** Parse suppression records as unknown config data, validate and apply them in a deterministic pure evaluator, then recalculate check status in `applyDoctorConfig`. Extend existing check report renderers with optional suppression details without changing existing schema versions or active finding semantics.

**Tech Stack:** TypeScript, Node.js, Vitest, npm release tooling.

---

### Task 1: Suppression Types and Evaluation

**Files:**
- Modify: `src/domain/types.ts`
- Modify: `src/core/doctor-config.ts`
- Modify: `src/index.ts`
- Test: `tests/doctor-config.test.ts`

- [ ] **Step 1: Write failing evaluator tests**

Cover:

```ts
const result = applyDoctorConfig(checkResult, config, {
  now: new Date("2026-07-31T23:59:59.999Z")
});

expect(result.findings).toEqual([]);
expect(result.suppressedFindings?.[0].suppression).toEqual({
  reason: "Accepted risk.",
  expiresAt: "2026-07-31"
});
expect(result.suppressionSummary).toEqual({
  applied: 1,
  expired: 0,
  invalid: 0
});
```

Also test next-day expiration, exact fingerprint matching, first active duplicate, unmatched silence, invalid record field order, `ignoreRules` before suppression, and `failOnWarnings` after governance warnings.

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
npx vitest run tests/doctor-config.test.ts
```

Expected: FAIL because suppression types and evaluation are absent.

- [ ] **Step 3: Add additive result types**

Add:

```ts
export interface FindingSuppression {
  reason: string;
  expiresAt: string;
}

export interface SuppressedFinding extends Finding {
  suppression: FindingSuppression;
}

export interface SuppressionSummary {
  applied: number;
  expired: number;
  invalid: number;
}
```

Extend `CheckResult` with optional `suppressedFindings` and `suppressionSummary`.

- [ ] **Step 4: Parse and evaluate suppression records**

Extend `DoctorConfig` with `suppressions: unknown[]`. Validate exact lowercase SHA-256 fingerprints, trimmed reasons, and real UTC dates. Generate bounded `suppression.invalid` and `suppression.expired` findings and fingerprint them relative to the target root.

- [ ] **Step 5: Recalculate final result**

Apply `ignoreRules`, suppression evaluation, governance warnings, and `failOnWarnings` in the specified order. Do not allow governance warnings to be suppressed during the same pass.

- [ ] **Step 6: Verify and commit**

Run focused tests and commit:

```powershell
git add src/domain/types.ts src/core/doctor-config.ts src/index.ts tests/doctor-config.test.ts
git commit -m "feat: add targeted suppression evaluation"
```

### Task 2: Rule Catalog and Report Surfaces

**Files:**
- Modify: `src/rules/rule-catalog.ts`
- Modify: `src/reporting/render-json-report.ts`
- Modify: `src/reporting/render-text-report.ts`
- Modify: `src/reporting/render-markdown-report.ts`
- Modify: `src/reporting/render-sarif-report.ts`
- Test: `tests/json-report.test.ts`
- Test: `tests/render-text-report.test.ts`
- Test: `tests/markdown-report.test.ts`
- Test: `tests/cli-command.test.ts`
- Test: `tests/contract-command.test.ts`

- [ ] **Step 1: Add failing report assertions**

Assert:

- JSON includes `suppressedFindings` and `suppressionSummary`
- text includes suppression counts and `Suppressed Findings`
- Markdown includes summary rows and suppressed section
- SARIF active results exclude suppressed findings
- SARIF run properties preserve suppression metadata
- output contract remains schema version `1.0.0`

- [ ] **Step 2: Verify tests fail**

Run:

```powershell
npx vitest run tests/json-report.test.ts tests/render-text-report.test.ts tests/markdown-report.test.ts tests/cli-command.test.ts tests/contract-command.test.ts
```

- [ ] **Step 3: Add governance rule definitions**

Add `suppression.invalid` and `suppression.expired` with warning severity. Expand `RuleCategory` with `configuration` so governance findings are not mislabeled as package defects.

- [ ] **Step 4: Render suppression metadata**

Keep active findings unchanged. Add optional suppression summaries and full applied suppression audit details to JSON, text, Markdown, and SARIF run properties.

- [ ] **Step 5: Verify and commit**

Run focused tests and commit:

```powershell
git add src/rules/rule-catalog.ts src/reporting tests
git commit -m "feat: report targeted suppressions"
```

### Task 3: CLI Integration and Compatibility

**Files:**
- Modify: `tests/cli-command.test.ts`
- Modify: `tests/package-analysis.test.ts`
- Modify: `tests/attestation-command.test.ts`
- Modify: `tests/export-bundle-command.test.ts`
- Modify: production files only if existing composition drops suppression metadata

- [ ] **Step 1: Add end-to-end config fixtures in temporary directories**

Run the real CLI against two same-rule findings and dynamically write one fingerprint into `.codex-doctor.json`. Verify only that instance is suppressed.

- [ ] **Step 2: Test expired and invalid CLI behavior**

Assert original findings remain active, governance warnings are present, invalid reason values are not echoed, and `failOnWarnings` blocks governance warnings.

- [ ] **Step 3: Verify derived artifacts**

Confirm package analysis, attestation, and export bundle preserve active findings and include suppression details where they already copy the full validation report. Make only minimal production changes required by failed tests.

- [ ] **Step 4: Run focused integration tests and commit**

```powershell
npx vitest run tests/cli-command.test.ts tests/package-analysis.test.ts tests/attestation-command.test.ts tests/export-bundle-command.test.ts
git add src tests
git commit -m "test: cover targeted suppression workflows"
```

### Task 4: Documentation and Release

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: active version references under `docs/`
- Create: `docs/engineering/v1.27.0-release-notes.md`

- [ ] **Step 1: Run full feature verification**

```powershell
npm test
npm run build
git diff --check
```

- [ ] **Step 2: Document configuration**

Document exact matching, mandatory reason/expiration, UTC end-of-day behavior, active/expired/invalid outcomes, and continued `ignoreRules` support.

- [ ] **Step 3: Set version `1.27.0`**

Update package metadata and active release pins only.

- [ ] **Step 4: Run rehearsal and strict release gates**

Run `npm run release-check -- --allow-dirty`, commit as `chore: bump version to 1.27.0`, then run clean `npm run release-check`.

- [ ] **Step 5: Push, publish, and verify**

Push `main`, wait for CI, create GitHub Release `v1.27.0`, publish npm, run `verify-release-sync`, install globally, and smoke-test one suppressed instance plus one remaining active same-rule instance.
