# Deterministic Finding Fingerprints Design

## Goal

Add a stable identity to each diagnostic finding so the same underlying issue can be tracked across repeated runs, machines, report formats, and future baseline or suppression workflows.

## Scope

Version `1.25.0` will add an optional `fingerprint` field to findings and expose it through existing report surfaces. This release will not add suppression files, baselines, or automatic remediation.

## Fingerprint Contract

The fingerprint will be a lowercase SHA-256 hex digest generated from:

1. a fixed fingerprint format version
2. the finding rule ID
3. canonical structured evidence

Severity, message, impact, and suggested-fix text will not participate. Editorial wording changes must not change the identity of the underlying issue.

Evidence canonicalization will:

- sort object keys lexicographically
- preserve string, number, boolean, and null value types
- normalize path separators to `/`
- convert paths under the analyzed package root to package-relative paths
- retain the existing `[REDACTED]` marker without reading or hashing hidden secret values

Findings without evidence will still receive a deterministic rule-level fingerprint. Multiple indistinguishable instances of the same rule may share that fingerprint until the rule provides structured evidence.

## Architecture

A focused reporting utility will own canonicalization, hashing, and immutable enrichment of findings. Validation, security, trust, and MCP report assembly boundaries will enrich findings once the package root is known.

The public `Finding` type will gain an optional `fingerprint` property. Keeping it optional preserves source compatibility for API consumers that construct findings themselves.

## Output Surfaces

- JSON-based reports will include `finding.fingerprint`.
- Text and Markdown reports will render a compact `Fingerprint:` line.
- SARIF results will use `partialFingerprints["codexPluginDoctor/v1"]` and retain structured evidence in result properties.
- Existing schema versions remain `1.0.0` because the field is additive and optional.

## Testing

Focused tests will prove:

- evidence key order does not affect the digest
- Windows and POSIX path separators produce the same digest
- different package roots produce the same digest for the same package-relative evidence
- different rule IDs or identity-bearing evidence produce different digests
- secret-like evidence remains redacted
- text, Markdown, JSON, security, and SARIF outputs expose the fingerprint

The full test suite, build, release check, packed tarball smoke path, CI, GitHub Release, npm registry state, and release-sync verification must pass before completion is reported.

## Release Plan

Use separate commits for the feature and `1.25.0` release metadata. Push both, wait for CI, create GitHub Release `v1.25.0`, publish npm, and verify `latest` resolves to `1.25.0`.
