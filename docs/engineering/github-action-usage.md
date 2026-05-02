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
      - uses: Esquetta/CodexPluginDoctor@v0.4.0
        with:
          version: "0.4.0"
          path: .
          runtime: "true"
```

## SARIF Output

Use SARIF when repository security tooling should ingest validation findings.

```yaml
- uses: Esquetta/CodexPluginDoctor@v0.4.0
  with:
    version: "0.4.0"
    path: .
    sarif: "true"
```

The action writes `codex-plugin-doctor.sarif`. Uploading it to GitHub Code Scanning should be handled by the consuming workflow after the action runs.

## Installed Plugin Cache Checks

Use installed-cache mode only in environments where Codex plugins are already available on the runner.

```yaml
- uses: Esquetta/CodexPluginDoctor@v0.4.0
  with:
    version: "0.4.0"
    installed: "true"
    filter: github
    runtime: "false"
```

## Version Pinning

Pin both the action ref and npm package version for reproducible CI:

```yaml
- uses: Esquetta/CodexPluginDoctor@v0.4.0
  with:
    version: "0.4.0"
```

Use `version: "latest"` only when the consuming repository intentionally wants automatic CLI upgrades.
