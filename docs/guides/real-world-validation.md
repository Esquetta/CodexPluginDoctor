# Real-World Validation Workflow

## Purpose

Codex Plugin Doctor is feature-rich enough that the next meaningful quality step is not more synthetic fixtures. It is disciplined evaluation against real or realistic plugin packages.

The external corpus command turns that review into a deterministic, offline gate:

```bash
codex-plugin-doctor doctor corpus --manifest ../private-corpus/corpus.json
codex-plugin-doctor doctor corpus --manifest ../private-corpus/corpus.json --json --output corpus-report.json
```

It performs static validation only. It does not download packages, install dependencies, or start MCP servers. Snapshot paths are relative to the manifest, so private corpora can remain outside the repository.

## Manifest

```json
{
  "schemaVersion": "1.0.0",
  "targets": [
    {
      "id": "healthy-01",
      "profile": "healthy",
      "sourceType": "local-snapshot",
      "disclosure": "anonymized",
      "path": "packages/healthy-01",
      "mode": "codex-plugin",
      "contentDigest": "sha256:<64 lowercase hex characters>",
      "expectedStatus": "pass",
      "reviews": []
    }
  ]
}
```

Allowed profiles are `healthy`, `broken`, and `edge-case`. Allowed source types are `public-package`, `local-snapshot`, and `derived-fixture`. Modes are `codex-plugin` and `generic-mcp`. Every target must use `disclosure: "anonymized"`; absolute paths, unknown fields, runtime options, malformed digests, and duplicate IDs or review keys are rejected.

Finding reviews use exact `findingId` plus the 64-character finding `fingerprint` and one classification: `true_positive`, `false_positive`, or `unclear`. A case passes only when the content digest and expected status match, every expected true positive is present, disputed findings are absent, and no actual finding remains unreviewed.

Reports contain sanitized IDs, classifications, statuses, and digests. They do not contain resolved snapshot or manifest paths.

## Quality Metrics

Use the dedicated metrics command when the goal is to measure reviewed finding accuracy rather than require every disputed finding to disappear:

```bash
codex-plugin-doctor doctor corpus metrics --manifest ../private-corpus/metrics.json
codex-plugin-doctor doctor corpus metrics --manifest ../private-corpus/metrics.json \
  --json --output metrics.json \
  --min-precision 0.90 \
  --min-recall 0.85 \
  --max-false-positive-rate 0.10
```

The metrics manifest is a separate strict contract. Target paths must remain beneath its directory. Optional source provenance uses an HTTPS repository URL and an immutable 40- or 64-character lowercase hexadecimal Git revision; Doctor records this metadata but never fetches it. Third-party snapshots stay outside the public repository.

Metrics use exact finding ID and fingerprint pairs:

```text
precision = TP / (TP + FP)
recall = TP / (TP + FN)
falsePositiveRate = FP / (TP + FP)
```

`falsePositiveRate` is the false-positive share among reviewed emitted findings, not a population-wide statistical rate. A zero denominator produces `null`. Unreviewed or unclear findings, digest drift, malformed manifests, and invalid paths return exit `2`; complete measurements below an explicit threshold return exit `1`; complete measurements that satisfy configured thresholds return exit `0`.

JSON reports use `kind: "doctor.validation.corpus.metrics"` and omit resolved paths, usernames, source contents, raw evidence, and reviewer notes. Text and Markdown renderers present the aggregate scorecard, threshold failures, and sanitized per-target summaries.

## Regression Comparison

Preserve the JSON report from a trusted baseline run, then compare it with the next run:

```bash
codex-plugin-doctor doctor corpus metrics --manifest ../private-corpus/metrics.json \
  --json --output metrics-before.json
codex-plugin-doctor doctor corpus metrics --manifest ../private-corpus/metrics.json \
  --json --output metrics-after.json
codex-plugin-doctor doctor corpus metrics diff \
  --before metrics-before.json \
  --after metrics-after.json \
  --fail-on-regression \
  --markdown --output metrics-diff.md
```

Each metrics report contains a `corpusDigest` derived from public-safe target metadata, expected content digests, and review classifications. Diff requires identical digests so a changed corpus cannot be mistaken for a validator improvement or regression. Reports created before this field was introduced must be regenerated.

The diff recalculates precision, recall, and false-positive share from integer counts rather than subtracting rounded display values. With `--fail-on-regression`, precision or recall decreases and false-positive share increases return exit `1`. Invalid, incomplete, oversized, internally inconsistent, or non-comparable reports return exit `2`. The comparison is offline and omits input paths and private corpus material.

This workflow defines how to:

- select external-like plugin packages
- run repeatable validation passes
- classify findings
- identify false positives and false negatives
- turn results into rule tuning work

## Core Goal

Move from `lab-clean correctness` to `field-tested confidence`.

## Evaluation Principles

- test packages that look like actual user packages, not just minimal fixtures
- prefer a small number of high-quality evaluation targets over a large noisy set
- separate structural failures from validator mistakes
- capture evidence for every tuning decision
- avoid changing rules based on one ambiguous package

## Recommended Package Mix

Run each validation cycle against at least three targets:

1. `Healthy package`
   A package you expect to pass with no findings or only acceptable warnings.

2. `Broken but realistic package`
   A package with real packaging or runtime mistakes, not artificially trivial failures.

3. `Edge-case package`
   A package that is technically valid but unusual enough to pressure-test heuristics and runtime probing.

## Validation Sequence

### 1. Static Pass

Run:

```bash
codex-plugin-doctor check <target>
```

Capture:

- status
- finding IDs
- whether each finding is clearly correct

### 2. Runtime Pass

Run:

```bash
codex-plugin-doctor check <target> --json --runtime --verbose-runtime
```

Capture:

- runtime scorecard
- protocol transcript
- whether runtime findings reflect actual server behavior

### 3. Human Review

For each finding, classify it as:

- `true_positive`
- `false_positive`
- `unclear`
- record a missing expected finding as a failed corpus expectation

### 4. Tuning Output

Turn the session into:

- one summary document
- a list of tuning tasks
- any needed fixture additions for regressions

## Decision Rules

### Fix Immediately

- repeatable false positives on valid packages
- repeatable false negatives on clearly broken packages
- transcript output that hides important debugging evidence
- destructive probe behavior that feels unsafe

### Wait for More Evidence

- one-off edge cases
- subjective heuristic disagreements
- packages that violate spec in ambiguous ways

## Evidence Format

Every evaluation should capture:

- package name or anonymized label
- source type: `public-package`, `local-snapshot`, or `derived-fixture`
- commands run
- output summary
- finding review table
- tuning recommendation

## Success Criteria

This workflow is successful when:

- valid packages stop producing surprising false alarms
- broken packages fail for the right reasons
- runtime scorecards align with actual protocol behavior
- tuning decisions are documented rather than ad hoc

## Relationship to Release Decisions

A public release should not be driven only by passing fixture tests. It should be supported by at least one full validation wave against real-world-like packages using this workflow.

