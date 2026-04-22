# Release Gating Workflow

## Purpose

Codex Plugin Doctor should act as a release gate for plugin packages before they are distributed to users or internal teams. The goal is to fail fast on structural and security issues, while still surfacing warn-level heuristics in a human-readable CI summary.

## Validation Modes

### Blocking Validation

Blocking validation should fail the pipeline when any `fail` finding is present.

Recommended for:

- release branches
- tagged builds
- pull requests that modify plugin packaging

### Advisory Validation

Advisory validation should publish `warn` findings in CI without failing the build.

Recommended for:

- day-to-day pull requests
- heuristic-only feedback
- early package authoring workflows

## Recommended CI Flow

1. Install dependencies.
2. Run tests.
3. Build the CLI.
4. Run `codex-plugin-doctor check` against the target package.
5. Write a Markdown summary to a file.
6. Append the summary to `GITHUB_STEP_SUMMARY`.
7. Let the CLI exit code determine whether the workflow should block the release.

## Example Commands

### JSON Artifact

```bash
node dist/cli.js check ./path/to/plugin --json --output codex-plugin-doctor-report.json
```

### Markdown Summary

```bash
node dist/cli.js check ./path/to/plugin --markdown --output codex-plugin-doctor-summary.md
```

### Runtime Probe

```bash
node dist/cli.js check ./path/to/plugin --json --runtime --output codex-plugin-doctor-runtime-report.json
```

## Rollout Advice

- Start with structural validation on every pull request.
- Enable runtime probing after command-based fixtures or local server behavior are stable.
- Keep warn-level heuristics visible in PR summaries even when they do not block merges.
- Use one stable package path in CI so report history stays comparable over time.

## Current Repository Behavior

The repository CI currently demonstrates the summary flow using fixture packages. Teams adopting the tool for real plugin bundles should replace the fixture path with the actual package path they want to gate.

