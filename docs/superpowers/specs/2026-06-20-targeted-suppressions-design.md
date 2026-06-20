# Targeted Finding Suppressions Design

## Goal

Allow teams to suppress one specific finding instance by deterministic fingerprint while requiring an explicit reason and expiration date.

This replaces broad rule-level exceptions for temporary, reviewed risk acceptance without removing the existing `ignoreRules` compatibility path.

## Scope

Version `1.27.0` will add inline targeted suppressions to `.codex-doctor.json`.

It will not add:

- suppression creation commands
- automatic expiration renewal
- remote policy services
- baseline files
- `--new-findings-only`
- wildcard or partial fingerprint matching

## Configuration

The config accepts an optional `suppressions` array:

```json
{
  "suppressions": [
    {
      "fingerprint": "21da7c75027f0811929d49253412a0f20694d974f141d0421410c89ee29c8b72",
      "reason": "Accepted until upstream issue #123 is resolved.",
      "expiresAt": "2026-07-31"
    }
  ]
}
```

Each suppression record requires:

- `fingerprint`: exactly 64 lowercase hexadecimal characters
- `reason`: a non-empty string after trimming
- `expiresAt`: a real calendar date in exact `YYYY-MM-DD` format

Unknown fields are ignored for forward compatibility.

## Date Semantics

Expiration is evaluated as a UTC calendar date.

A suppression remains active through its declared date. For example, `expiresAt: "2026-07-31"` is active until `2026-07-31T23:59:59.999Z` and becomes expired at `2026-08-01T00:00:00.000Z`.

The evaluator will accept an injected current time for deterministic tests. Production commands use the current system time.

## Matching

Suppression matching is exact and case-sensitive against `Finding.fingerprint`.

For duplicate records targeting the same fingerprint:

1. invalid records are ignored
2. expired records are reported
3. the first active valid record suppresses the finding
4. later active records for the same fingerprint have no additional effect

A valid suppression whose fingerprint does not match any finding is retained in config but does not create a warning. Stale unmatched records can be addressed by a future maintenance command rather than making every validation noisy.

## Active Suppressions

When an active suppression matches a finding:

- the finding is removed from active `findings`
- the finding is added to `suppressedFindings`
- original ID, severity, message, impact, suggested fix, evidence, and fingerprint are preserved
- suppression `reason` and `expiresAt` are attached
- status, counts, and exit code are recalculated from active findings only

Suppressing the last active failure can therefore change the result from `fail` to `warn` or `pass`.

## Expired Suppressions

An expired suppression does not suppress its finding.

The original finding remains active and a warning is added:

- ID: `suppression.expired`
- severity: `warn`
- evidence: suppression index, fingerprint, and expiration date

The warning does not expose the reason text. The suggested fix tells the user to remove the record or replace it with a newly reviewed expiration date.

The original finding still determines whether the command fails.

## Invalid Suppressions

An invalid record is not applied and produces:

- ID: `suppression.invalid`
- severity: `warn`
- evidence: suppression index and invalid field name

The warning does not echo malformed values or reason text.

One invalid record emits one warning. Validation checks fields in this order:

1. record shape
2. fingerprint
3. reason
4. expiresAt

The first detected error determines the warning field.

## Configuration Read Failures

Existing behavior currently treats missing and malformed config files identically. This release will preserve that behavior to avoid expanding scope: an unreadable or malformed `.codex-doctor.json` falls back to default configuration.

Strict config-file diagnostics can be added separately later.

## Result Contract

`CheckResult` gains:

```ts
suppressedFindings?: SuppressedFinding[];
suppressionSummary?: {
  applied: number;
  expired: number;
  invalid: number;
};
```

`SuppressedFinding` contains the original finding plus:

```ts
suppression: {
  reason: string;
  expiresAt: string;
};
```

These fields are optional and additive. Existing report schema versions remain unchanged.

## Report Surfaces

### Text

Text output adds:

- suppression counts in the summary when suppression data exists
- a `Suppressed Findings` section after active failures and warnings
- fingerprint, reason, and expiration date for each suppressed finding

### Markdown

Markdown output adds suppression counts to the summary table and a separate `## Suppressed Findings` section.

### JSON

JSON output includes `suppressedFindings` and `suppressionSummary` when suppression processing produced data.

### SARIF

Only active findings appear under `runs[].results`.

Suppression metadata appears under:

```json
{
  "runs": [
    {
      "properties": {
        "suppressionSummary": {},
        "suppressedFindings": []
      }
    }
  ]
}
```

This prevents suppressed findings from appearing as active security results while retaining audit evidence.

### Derived Reports

Package analysis, export bundles, attestations, release evidence, watch output, installed-plugin reports, and history entries will naturally consume the post-suppression active findings unless they explicitly preserve `suppressedFindings`.

For `1.27.0`, the core JSON, text, Markdown, and SARIF check surfaces are required to preserve suppression details. Broader artifact propagation will be tested and included where existing report composition already copies the full check result without additional architecture.

## Rule Catalog

Add stable definitions for:

- `suppression.invalid`
- `suppression.expired`

These warnings are configuration governance findings, not plugin package defects.

They are not themselves eligible for targeted suppression during the same evaluation pass. This avoids recursive suppression behavior.

## Interaction with Existing Configuration

Processing order:

1. load `.codex-doctor.json`
2. apply `ignoreRules`
3. validate suppression records
4. apply active fingerprint suppressions
5. add invalid and expired suppression warnings
6. apply `failOnWarnings`
7. calculate final status and exit code

`ignoreRules` remains backward compatible. Documentation will recommend fingerprint suppressions for temporary instance-level exceptions and reserve `ignoreRules` for deliberate package-wide policy.

## Security and Privacy

- reasons are shown only for successfully applied suppressions
- malformed reason values are never echoed
- warning evidence contains bounded index, fingerprint, date, or field identifiers
- no suppression can modify finding severity or content
- exact fingerprint matching prevents wildcard hiding of unrelated findings
- expiration is mandatory to prevent permanent silent exceptions

## Testing

Tests will cover:

- active suppression moves one exact finding to `suppressedFindings`
- another finding with the same rule ID remains active
- status and exit code are recalculated
- suppression is active throughout its expiration date
- suppression expires at the next UTC day
- invalid fingerprint, reason, date format, and impossible dates
- duplicate records use the first active valid record
- expired and invalid records produce non-recursive warnings
- unmatched valid records remain silent
- `ignoreRules` runs before suppression matching
- `failOnWarnings` applies after suppression warnings
- text, Markdown, JSON, and SARIF output
- existing configs without `suppressions` remain unchanged

## Release Plan

Use separate commits for:

1. design and implementation plan
2. suppression config parsing and evaluation
3. report and SARIF surfaces
4. documentation and `1.27.0` release metadata

The release requires full tests, build, strict release check, GitHub Actions, GitHub Release `v1.27.0`, npm publish, release-sync verification, global installation, and a published CLI smoke test.
