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
5. Write JSON, Markdown, and optional SARIF artifacts.
6. Append the Markdown summary to `GITHUB_STEP_SUMMARY`.
7. Upload the report directory as a workflow artifact.
8. Let the CLI exit code determine whether the workflow should block the release.

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
node dist/cli.js check ./path/to/plugin --json --runtime --sandbox docker --output codex-plugin-doctor-runtime-report.json
```

Docker mode currently supports Node.js stdio MCP servers. It uses a read-only package mount and container filesystem, no network, an unprivileged user, dropped capabilities, bounded resources, and a limited writable `/tmp`. It fails closed and does not fall back to native execution.

### Release Readiness

```bash
codex-plugin-doctor release check ./path/to/plugin
codex-plugin-doctor release check ./path/to/plugin --json
```

Release readiness is static by default and checks validation, security, dependencies, compatibility, trust, and Node package release metadata. If `package.json` exists, its version must match the root package version in `package-lock.json`; when `CHANGELOG.md` exists, it must include a section for that version. Non-Node plugin packages without `package.json` skip the metadata check.

Runtime probing executes package-local MCP servers and must be enabled explicitly:

```bash
codex-plugin-doctor release check ./path/to/plugin --runtime
codex-plugin-doctor release check ./path/to/plugin --runtime --require-runtime-approval --runtime-approval-digest sha256:<approved-plan-digest>
codex-plugin-doctor doctor runtime-plan ./path/to/plugin --sandbox docker --json
codex-plugin-doctor release check ./path/to/plugin --runtime --sandbox docker --require-runtime-approval --runtime-approval-digest sha256:<approved-docker-plan-digest>
```

Generate the approval digest with the same sandbox backend used by the release check. The digest changes when the Docker image or execution boundary changes. Preserve the plan and signed release evidence as CI artifacts.

### SARIF Artifact

```bash
node dist/cli.js check ./path/to/plugin --sarif --output codex-plugin-doctor.sarif
```

### Policy Presets

```bash
node dist/cli.js check ./path/to/plugin --policy codex-publish
node dist/cli.js check ./path/to/plugin --policy mcp-strict
node dist/cli.js security ./path/to/plugin --policy security
```

### Check Profiles

```bash
node dist/cli.js check ./path/to/plugin --profile publish
```

### Gradual Adoption Baseline

```bash
node dist/cli.js baseline create ./path/to/plugin --output .codex-doctor-baseline.json
node dist/cli.js check ./path/to/plugin --baseline .codex-doctor-baseline.json
```

Commit and review the baseline. Baseline gating keeps existing fingerprinted findings visible while failing only on new active findings; regenerate it only when the accepted set intentionally changes.

## Rollout Advice

- Start with structural validation on every pull request.
- Enable runtime probing after command-based fixtures or local server behavior are stable.
- Require Docker mode for untrusted local Node.js stdio probes; keep native mode for explicitly trusted code.
- Keep warn-level heuristics visible in PR summaries even when they do not block merges.
- Preserve artifacts even on failed validations so maintainers can inspect JSON, Markdown, and SARIF evidence from the failing run.
- Review baseline changes like policy changes; do not regenerate the file automatically in CI.
- Use one stable package path in CI so report history stays comparable over time.

## Current Repository Behavior

The repository CI currently demonstrates the summary flow using fixture packages. Teams adopting the tool for real plugin bundles should replace the fixture path with the actual package path they want to gate.
