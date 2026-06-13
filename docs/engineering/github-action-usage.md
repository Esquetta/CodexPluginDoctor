# GitHub Action Usage

## Purpose

Use the Codex Plugin Doctor GitHub Action when a plugin repository should fail pull requests before broken packaging, unsafe MCP config, or runtime protocol issues reach users.

The action installs `codex-plugin-doctor` from npm, then runs the same CLI used locally.

## Recommended Workflow

```yaml
name: Validate Codex plugin

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Esquetta/CodexPluginDoctor@v1.19.0
        with:
          version: "1.19.0"
          path: .
          runtime: "true"
          policy: codex-publish
          corpus: "true"
          contract: "true"
          upload-artifact: "true"
          artifact-name: codex-plugin-doctor-reports
          output-dir: codex-plugin-doctor-reports
```

By default the action writes:

- `codex-plugin-doctor-summary.md`
- `codex-plugin-doctor-report.json`

The Markdown report is appended to the GitHub Actions step summary, and the output directory is uploaded as a workflow artifact. The action preserves the real validation exit code after report generation, so failed checks still fail the job after artifacts are available.

Set `corpus: "true"` to add `validation-corpus.json` and `contract: "true"` to add `output-contract.json` to the same artifact directory. These reports are useful when a release workflow needs bundled validation evidence and the current public JSON contract without adding separate CLI steps.

## SARIF Output

Use SARIF when repository security tooling should ingest validation findings.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
    path: .
    sarif: "true"
```

The action writes `codex-plugin-doctor.sarif` into `output-dir`. Uploading it to GitHub Code Scanning should be handled by the consuming workflow after the action runs.

## Artifact And Summary Controls

Use artifact and summary controls when the workflow needs custom retention or wants to disable generated report uploads.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
    path: .
    output-dir: doctor-ci-reports
    artifact-name: codex-plugin-doctor-reports
    upload-artifact: "true"
    step-summary: "true"
    json: "true"
    markdown: "true"
    sarif: "true"
    corpus: "true"
    contract: "true"
```

Set `upload-artifact: "false"` when a consuming workflow wants to upload files itself. Set `step-summary: "false"` when the Markdown report should only be retained as an artifact.

The action also exposes these workflow outputs for follow-up steps:

- `status`
- `report-dir`
- `summary-path`
- `json-path`
- `sarif-path`
- `validation-corpus-path`
- `output-contract-path`
- `review-bundle-path`
- `review-bundle-verification-path`

## Review Bundle Artifacts

Use review bundle artifacts when a pull request or release workflow should preserve signed runtime approval, runtime policy, attestation, and release evidence handoff files.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  env:
    CODEX_PLUGIN_DOCTOR_SIGNING_KEY: ${{ secrets.CODEX_PLUGIN_DOCTOR_SIGNING_KEY }}
  with:
    version: "1.19.0"
    path: .
    review-bundle: "true"
    review-bundle-verify: "true"
    signing-key-env: CODEX_PLUGIN_DOCTOR_SIGNING_KEY
    review-bundle-allow-untagged: "true"
```

The action writes the bundle under `output-dir/review-bundle` by default and includes it in the uploaded artifact directory. `review-bundle-verify: "true"` also writes `review-bundle-verification.json`.

`review-bundle-allow-untagged` defaults to `"true"` because pull request and branch workflows are usually not running on exact release tags. Set it to `"false"` in strict release jobs that should require tagged release evidence.

## Badge Artifacts

The CLI can produce badge output for release notes, README automation, or a static artifact served by the consuming repository.

```yaml
- name: Generate Doctor badge JSON
  run: codex-plugin-doctor check . --badge-json --output doctor-badge.json

- name: Generate Doctor badge Markdown
  run: codex-plugin-doctor check . --badge-markdown --output doctor-badge.md
```

`--badge-json` follows the Shields endpoint schema with `schemaVersion`, `label`, `message`, and `color`. `--badge-markdown` emits a static shields.io Markdown image link.

## History Artifacts

Use history output when a workflow should preserve validation trend data between runs.

```yaml
- name: Append Doctor history
  run: codex-plugin-doctor check . --history validation-history.jsonl

- name: Summarize Doctor history
  run: codex-plugin-doctor history validation-history.jsonl

- name: Fail on Doctor regression
  run: codex-plugin-doctor history validation-history.jsonl --fail-on-regression
```

The history file is newline-delimited JSON. Store it as an artifact, cache, or repository-managed file depending on the consuming workflow's retention model. Use `codex-plugin-doctor history validation-history.jsonl --json` when another CI step needs machine-readable latest, previous, delta, and regression fields.

The composite action can also append history directly:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
    path: .
    runtime: "true"
    history: validation-history.jsonl
```

## Check Profiles

Use profiles when a consuming workflow needs a named validation policy instead of custom flags.

```yaml
- name: Publish-grade Doctor check
  run: codex-plugin-doctor check . --profile publish --json --output doctor-report.json
```

`ci` keeps the default behavior, `strict` fails on warnings, and `publish` fails on warnings while enabling runtime probing by default.

The composite action can pass profiles directly:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
    path: .
    profile: publish
```

## CI Policy Presets

Use policy presets when a workflow should apply one of the opinionated release gates without adding a local `.codex-doctor.json`.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
    path: .
    policy: codex-publish
```

Supported policy values are `codex-publish`, `mcp-strict`, and `security`. The CLI validates unsupported values and fails the workflow with a clear error.

## Installed Plugin Cache Checks

Use installed-cache mode only in environments where Codex plugins are already available on the runner.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
    installed: "true"
    filter: github
    runtime: "false"
```

## Version Pinning

Pin both the action ref and npm package version for reproducible CI:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.19.0
  with:
    version: "1.19.0"
```

Use `version: "latest"` only when the consuming repository intentionally wants automatic CLI upgrades.
