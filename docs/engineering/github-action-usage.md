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
      - uses: actions/checkout@v4
      - uses: Esquetta/CodexPluginDoctor@v0.7.0
        with:
          version: "0.7.0"
          path: .
          runtime: "true"
```

## SARIF Output

Use SARIF when repository security tooling should ingest validation findings.

```yaml
- uses: Esquetta/CodexPluginDoctor@v0.7.0
  with:
    version: "0.7.0"
    path: .
    sarif: "true"
```

The action writes `codex-plugin-doctor.sarif`. Uploading it to GitHub Code Scanning should be handled by the consuming workflow after the action runs.

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
- uses: Esquetta/CodexPluginDoctor@v0.7.0
  with:
    version: "0.7.0"
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

## Installed Plugin Cache Checks

Use installed-cache mode only in environments where Codex plugins are already available on the runner.

```yaml
- uses: Esquetta/CodexPluginDoctor@v0.7.0
  with:
    version: "0.7.0"
    installed: "true"
    filter: github
    runtime: "false"
```

## Version Pinning

Pin both the action ref and npm package version for reproducible CI:

```yaml
- uses: Esquetta/CodexPluginDoctor@v0.7.0
  with:
    version: "0.7.0"
```

Use `version: "latest"` only when the consuming repository intentionally wants automatic CLI upgrades.
