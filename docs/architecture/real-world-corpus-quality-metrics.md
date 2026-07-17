# Real-World Corpus Quality Metrics

## Status

Shipped in `v1.48.0` as an additive quality-measurement layer over the external corpus workflow introduced in `v1.47.0`.

## Purpose

Codex Plugin Doctor needs measured evidence that its findings are correct on realistic packages before it adds automated fixes or broadens runtime support. This feature converts reviewed external corpus results into deterministic precision, recall, and false-positive measurements that can gate a release without publishing third-party source code or private review material.

## Goals

- measure validator precision and recall from exact finding fingerprints
- make false positives, false negatives, and incomplete reviews explicit
- support deterministic local and CI quality gates
- bind every target to a stable content digest and optional public source revision
- keep reports free of local paths, source contents, and private reviewer notes
- preserve the existing `doctor corpus` command and report contract

## Non-Goals

- downloading or cloning corpus targets
- redistributing third-party repositories in this repository or npm package
- running package install scripts or MCP servers
- claiming population-wide accuracy from a small curated corpus
- treating an unreviewed or unclear finding as correct
- changing existing finding IDs, severities, or `doctor corpus` exit behavior

## Command Surface

```text
codex-plugin-doctor doctor corpus metrics --manifest <corpus.json>
  [--json | --markdown]
  [--output <path>]
  [--min-precision <0..1>]
  [--min-recall <0..1>]
  [--max-false-positive-rate <0..1>]
```

Thresholds are optional and may also be declared in the metrics manifest. A CLI threshold overrides the corresponding manifest threshold. Values outside the inclusive `0..1` range, conflicting output modes, and missing option values are usage errors.

`doctor corpus metrics` is intentionally separate from `doctor corpus --manifest`. The existing command remains an exact expectation gate. The metrics command allows reviewed false positives to be measured instead of making their mere presence an invalid corpus run.

## Metrics Manifest

The metrics command accepts a strict, versioned manifest dedicated to quality measurement. Each target contains:

- a public-safe target ID
- a `healthy`, `broken`, or `edge-case` profile
- a `public-package`, `local-snapshot`, or `derived-fixture` source type
- a relative snapshot path
- package analysis mode
- expected content digest
- optional Git source provenance containing an HTTPS repository URL and immutable revision
- expected findings identified by finding ID and fingerprint
- a required human classification for every manifest review entry

Allowed classifications are:

- `true_positive`: the validator should emit this finding
- `false_positive`: the validator emits this finding but should not
- `unclear`: the review is unresolved and cannot contribute to a quality score

Source URLs must use `https`; Git source revisions must contain exactly 40 or 64 lowercase hexadecimal characters, so branch and tag names are rejected. Source metadata is provenance only. The command never fetches it and never trusts it instead of the local snapshot digest. Any emitted finding without a matching manifest review entry is reported as `unreviewed` and makes the measurement incomplete.

Unknown fields, absolute paths, duplicate target IDs, duplicate finding keys, malformed digests, path traversal, and unsupported schema versions are rejected. Snapshot paths resolve relative to the manifest and must remain beneath the manifest directory.

## Classification Model

Metrics are calculated from exact `(findingId, fingerprint)` keys:

- true positive (`TP`): a `true_positive` expectation is emitted
- false negative (`FN`): a `true_positive` expectation is not emitted
- false positive (`FP`): a `false_positive` finding is emitted
- resolved false positive: a `false_positive` review is no longer emitted; it is reported as resolved but is not included in a denominator
- unreviewed: an emitted finding has no matching review
- unclear: an emitted or expected finding is marked `unclear`

The command does not invent a true-negative count because the set of all possible non-findings is not enumerable. Consequently, `falsePositiveRate` is explicitly defined as the reviewed emitted-finding false-positive share, not the statistical population false-positive rate:

```text
precision = TP / (TP + FP)
recall = TP / (TP + FN)
falsePositiveRate = FP / (TP + FP)
```

When a denominator is zero, the corresponding metric is `null`, not `0` or `1`. A threshold cannot pass against a `null` metric.

Unreviewed and unclear findings do not enter the formulas. Their presence makes the measurement incomplete and returns exit code `2`, preventing a favorable score from hiding missing human review.

## Processing Flow

```text
CLI options
  -> strict manifest validation
  -> relative path containment and content digest verification
  -> existing static package analysis
  -> exact fingerprint reconciliation
  -> per-target and aggregate confusion counts
  -> metric calculation
  -> threshold evaluation
  -> redacted text, Markdown, or JSON report
```

Targets are analyzed sequentially by default for deterministic output and bounded resource use. The feature reuses the existing package analysis pipeline and stable fingerprint implementation rather than introducing a second validator.

## Output Contract

The JSON report uses a new additive contract:

```json
{
  "schemaVersion": "1.0.0",
  "kind": "doctor.validation.corpus.metrics",
  "generatedAt": "2026-07-17T00:00:00.000Z",
  "summary": {
    "status": "pass",
    "targetCount": 3,
    "truePositives": 12,
    "falsePositives": 1,
    "falseNegatives": 2,
    "unreviewed": 0,
    "unclear": 0,
    "precision": 0.923077,
    "recall": 0.857143,
    "falsePositiveRate": 0.076923
  },
  "thresholds": {
    "minPrecision": 0.9,
    "minRecall": 0.85,
    "maxFalsePositiveRate": 0.1
  },
  "targets": []
}
```

Metric values are rounded to six decimal places in serialized output. Gate evaluation uses the unrounded values. Target output includes only public-safe IDs, profile/source type, digest status, aggregate counts, metrics, and fingerprint-based review outcomes. It excludes resolved paths, usernames, source contents, raw evidence, and private notes.

Text and Markdown output show the aggregate scorecard first, failed thresholds second, and per-target details last. Output order follows manifest target order; finding outcomes sort by finding ID and fingerprint.

## Exit Codes

- exit `0`: evaluation is complete and every configured threshold passes
- exit `1`: evaluation is complete but at least one configured threshold fails
- exit `2`: usage, manifest, path, digest, analysis, or review completeness is invalid

Without thresholds, a complete measurement returns `0` regardless of metric values. This keeps measurement distinct from policy. CI and release workflows should configure explicit thresholds.

## Security and Privacy

- evaluation remains static and offline
- package lifecycle scripts are never executed
- target paths must remain beneath the manifest directory
- content digests detect snapshot drift
- reports do not expose local paths, source files, raw evidence, or reviewer notes
- public source provenance is optional and cannot trigger network access
- third-party source snapshots remain outside the public repository
- independently authored minimal fixtures may be committed only for confirmed regressions

## Compatibility

- `doctor corpus` and `doctor corpus --manifest` retain their current behavior
- the new command has its own `kind` and JSON schema
- existing external corpus manifests are not silently reinterpreted as metrics manifests
- the package analysis and fingerprint algorithms remain shared
- new output contracts are additive and do not change stable existing schemas

## Verification

### Unit Tests

- manifest schema, threshold precedence, and numeric range validation
- exact fingerprint reconciliation for TP, FP, FN, resolved, unclear, and unreviewed outcomes
- metric formulas, zero denominators, rounding, and unrounded gate comparisons
- deterministic ordering and report redaction
- exit codes `0`, `1`, and `2`

### Integration Tests

- a healthy, broken, and edge-case external-style snapshot set
- identical results for equivalent snapshots under different host paths
- digest drift and traversal rejection
- JSON, Markdown, text, and file output
- backward-compatibility coverage for the existing bundled and manifest corpus commands

### Release Gates

`v1.48.0` requires targeted metrics tests, the full test suite, build, package dry run, `npm run release-check`, dependency audit, GitHub Actions success, a fresh npm install smoke test, GitHub Release publication, npm publication, and release-sync verification.

## Success Criteria

- maintainers can quantify reviewed validator accuracy without custom scripts
- incomplete human review cannot produce a passing quality gate
- CI can block a release on explicit precision, recall, or false-positive thresholds
- equivalent corpus snapshots produce stable results across machines
- public reports and repository contents do not redistribute or expose corpus source material
- existing corpus users experience no behavioral or contract regression
