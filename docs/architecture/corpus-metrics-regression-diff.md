# Corpus Metrics Regression Diff

## Status

Shipped in `v1.49.0` as an additive comparison layer over the corpus quality metrics shipped in `v1.48.0`.

## Purpose

A metrics threshold can pass while quality still moves in the wrong direction. Maintainers need a deterministic way to compare two reviewed corpus runs and block a release when precision or recall decreases, or when the reviewed emitted-finding false-positive share increases.

## Command Surface

```text
codex-plugin-doctor doctor corpus metrics diff
  --before <metrics.json>
  --after <metrics.json>
  [--fail-on-regression]
  [--json | --markdown]
  [--output <path>]
```

The command reads existing metrics reports. It does not load corpus snapshots, execute package code, or rerun analysis.

## Comparability

Metrics reports include a `corpusDigest` derived from public-safe target metadata, expected content digests, and reviewed finding keys and classifications. The digest binds the report to the evaluated corpus without publishing snapshot paths, source content, review notes, or raw manifest data.

Reports are comparable only when:

- both reports use the supported metrics schema and output kind
- both evaluations are complete
- both reports have a valid and identical `corpusDigest`
- aggregate and target counts are internally consistent

An invalid, incomplete, or non-comparable pair returns exit `2`. Reports produced before `corpusDigest` was introduced must be regenerated before comparison.

## Regression Rules

The comparison recomputes metrics from integer TP, FP, and FN counts instead of subtracting rounded serialized values.

A regression exists when any of the following is true:

- precision decreases
- recall decreases
- reviewed emitted-finding false-positive share increases

When either side of a metric has a zero denominator, that metric is not comparable and is reported as `null`. It does not independently create a regression.

Without `--fail-on-regression`, a comparable report returns exit `0` and records whether regression occurred. With the flag, a regression returns exit `1`.

## Output Contract

JSON uses `kind: "doctor.validation.corpus.metrics.diff"`. The report contains aggregate before/after values, exact deltas, count deltas, and sanitized per-target changes. It excludes input paths, local paths, source contents, evidence, and reviewer notes.

## Success Criteria

- maintainers can detect quality drift between releases without custom scripts
- corpus composition changes cannot masquerade as validator regressions or improvements
- CI can block any comparable quality regression with one explicit flag
- comparison output remains safe to publish as a CI artifact
- existing corpus metrics behavior remains unchanged when diff is not used
