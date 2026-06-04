# Codex Plugin Doctor

[![CI](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-plugin-doctor.svg)](https://www.npmjs.com/package/codex-plugin-doctor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Esquetta/CodexPluginDoctor)](https://github.com/Esquetta/CodexPluginDoctor/releases)

Codex Plugin Doctor is a local CLI validator for Codex plugin packages, skills, and MCP server bundles.

It catches packaging, metadata, security, and runtime protocol problems before a plugin reaches users, teammates, or release workflows.

## Status

Codex Plugin Doctor is a public stable CLI for local and CI validation.

- Primary surface: GitHub repository and npm package
- Distribution today: `npm install -g`, local source install, `npm link`, `npm pack`, GitHub Releases
- Public npm package: `codex-plugin-doctor`
- License: [MIT](./LICENSE)

## 1.0 Stability

The 1.0 line is the stable compatibility baseline for plugin authors and CI consumers.

- Public JSON schema surfaces and existing rule IDs/default severities are treated as stable through 1.0.
- Runtime probing remains opt-in because it executes package-local MCP servers.
- The project remains Codex-first; broader MCP Doctor positioning stays a post-1.0 expansion path.
- Post-1.0 feature work should stay additive unless a documented major-version decision is made.

See [v1.0 Readiness Checklist](./docs/engineering/v1.0-readiness-checklist.md) for the stable release evidence and smoke plan.

## Why This Exists

Codex plugin packages can fail in several places:

- the package manifest is missing or points outside the package root
- skills exist but do not expose valid `SKILL.md` metadata
- `.mcp.json` is malformed or references unsafe secrets
- an MCP server starts but does not complete the protocol handshake
- tools, resources, or prompts list successfully but fail deeper runtime checks
- verbose metadata creates noisy matching and unnecessary context cost

This tool gives plugin authors a repeatable preflight check before distribution.

## What It Checks

Static validation:

- required `.codex-plugin/plugin.json`
- manifest fields: `name`, `version`, `description`
- skill directory wiring
- `SKILL.md` presence and frontmatter fields
- YAML single-line and block-scalar skill descriptions
- `.mcp.json` structure
- path traversal risks
- hard-coded secret-like env values
- description quality heuristics tuned against real plugin packages

Security scorecard with `security`:

- shell wrapper command warnings for MCP servers
- encoded shell command failures
- remote content piped into shell failures
- MCP server `cwd` paths that escape the package root
- plain HTTP remote transport warnings

Runtime MCP validation with `--runtime`:

- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `resources/templates/list`
- `prompts/list`
- `prompts/get`
- paginated list responses
- runtime capability scorecard
- redacted verbose transcript with `--verbose-runtime`
- optional runtime approval gating with a precomputed `doctor runtime-plan` digest

Output formats:

- human text output
- JSON reports
- Markdown reports
- Shields-compatible badge JSON and static badge Markdown
- validation history JSONL and trend summaries
- deterministic local attestation artifacts
- output contract and rule catalog freeze metadata
- bundled validation corpus reports
- `--output` file writing
- CI summary and artifact generation

## Quick Start

Global install from npm:

```bash
npm install -g codex-plugin-doctor
codex-plugin-doctor --version
codex-plugin-doctor self-test
codex-plugin-doctor check path/to/plugin-package
```

Run `codex-plugin-doctor check .` from the root of a Codex plugin package that contains `.codex-plugin/plugin.json`. The Codex Plugin Doctor source repository is not itself a plugin package.

If you already have Codex installed locally and do not know plugin paths, discover the installed plugin cache:

```bash
codex-plugin-doctor list --installed
codex-plugin-doctor check --installed
codex-plugin-doctor check --installed --all-summary
codex-plugin-doctor check --installed --compat --all-summary
codex-plugin-doctor audit --installed --security --compat
codex-plugin-doctor audit --installed --security --compat --policy security
codex-plugin-doctor mcp path/to/mcp-package
codex-plugin-doctor check --installed github
codex-plugin-doctor explain plugin.manifest.missing
```

Run from source:

```bash
npm install
npm run build
node dist/cli.js check examples/codex-doctor-runtime --runtime
```

For local global usage:

```bash
npm link
codex-plugin-doctor check examples/codex-doctor-runtime --runtime
```

Generate validation artifacts locally:

```bash
npm run generate-validation-artifacts -- --target examples/codex-doctor-runtime --runtime-target examples/codex-doctor-runtime --out-dir validation-artifacts-local
```

## Example Output

Passing runtime package:

```text
Codex Plugin Doctor
===================
Status: PASS
Target: <repo>\examples\codex-doctor-runtime
Summary: 0 fail, 0 warn, 0 total

Runtime Scorecard
----------------
initialize: pass
tools/list: pass
tools/call: pass
resources/list: pass
resources/read: pass
resources/templates/list: pass
prompts/list: pass
prompts/get: pass

No findings.
```

Risky package:

```text
Codex Plugin Doctor
===================
Status: FAIL
Target: <repo>\examples\codex-doctor-risky
Summary: 1 fail, 0 warn, 1 total

Failures
--------
x plugin.security.hard_coded_secret
  Message: The MCP server `dangerServer` contains a hard-coded secret-like env value for `OPENAI_API_KEY`.
  Impact: Hard-coded credentials inside plugin bundles increase leakage risk and make secure rotation difficult.
  Suggested fix: Replace the literal value for `OPENAI_API_KEY` with an environment reference or injected secret outside the package.
```

## Useful Commands

Run these from a Codex plugin package root:

```bash
codex-plugin-doctor --version
codex-plugin-doctor self-test
codex-plugin-doctor doctor
codex-plugin-doctor doctor contract
codex-plugin-doctor doctor contract --json --output output-contract.json
codex-plugin-doctor doctor corpus
codex-plugin-doctor doctor corpus --json --output validation-corpus.json
codex-plugin-doctor doctor npm <published-plugin-package>
codex-plugin-doctor doctor npm <published-plugin-package> --json --output npm-preinstall.json
codex-plugin-doctor doctor attest .
codex-plugin-doctor doctor attest . --json --output attestation.json
codex-plugin-doctor doctor attest . --json --sign-key-env CODEX_PLUGIN_DOCTOR_SIGNING_KEY --output attestation.json
codex-plugin-doctor doctor attest verify attestation.json --target . --sign-key-env CODEX_PLUGIN_DOCTOR_SIGNING_KEY
codex-plugin-doctor doctor attest verify attestation.json --target . --json --sign-key-env CODEX_PLUGIN_DOCTOR_SIGNING_KEY
codex-plugin-doctor doctor inspector .
codex-plugin-doctor doctor inspector . --server context7 --json --output inspector-command.json
codex-plugin-doctor doctor diff --before ./old-plugin --after ./new-plugin
codex-plugin-doctor doctor diff --before ./old-plugin --after ./new-plugin --json --output risk-diff.json
codex-plugin-doctor doctor recommend .
codex-plugin-doctor doctor recommend . --json --output recommendations.json
codex-plugin-doctor doctor trust .
codex-plugin-doctor doctor trust . --json --output trust-score.json
codex-plugin-doctor doctor perf .
codex-plugin-doctor doctor perf . --json --output perf.json
codex-plugin-doctor doctor perf . --max-total-ms 2500 --max-stage-ms validation=500
codex-plugin-doctor doctor runtime-plan .
codex-plugin-doctor doctor runtime-plan . --json --output runtime-plan.json
codex-plugin-doctor doctor runtime-plan . --markdown --output runtime-plan.md
codex-plugin-doctor doctor runtime-policy .
codex-plugin-doctor doctor runtime-policy . --json --output runtime-policy.json
codex-plugin-doctor doctor review-bundle . --output review-bundle --sign-key-env CODEX_PLUGIN_DOCTOR_SIGNING_KEY
codex-plugin-doctor doctor review-bundle verify review-bundle --target . --sign-key-env CODEX_PLUGIN_DOCTOR_SIGNING_KEY
codex-plugin-doctor doctor review-bundle diff --before old-review-bundle --after review-bundle
codex-plugin-doctor doctor mcp .
codex-plugin-doctor doctor mcp . --json --output mcp-healthcheck.json
codex-plugin-doctor doctor export --bundle .
codex-plugin-doctor doctor export --bundle . --output doctor-bundle.json
codex-plugin-doctor doctor snapshot
codex-plugin-doctor doctor snapshot --json
codex-plugin-doctor doctor snapshot --output doctor-snapshot.json
codex-plugin-doctor doctor clients
codex-plugin-doctor doctor --update-check
codex-plugin-doctor audit --installed
codex-plugin-doctor audit --installed --security --compat
codex-plugin-doctor audit --installed --security --compat --json --output local-audit.json
codex-plugin-doctor audit --installed --security --compat --cache
codex-plugin-doctor audit --installed --changed --cache
codex-plugin-doctor mcp .
codex-plugin-doctor mcp . --json
codex-plugin-doctor mcp . --json --output mcp-doctor.json
codex-plugin-doctor init my-plugin
codex-plugin-doctor init my-mcp --template mcp-stdio
codex-plugin-doctor init remote-mcp --template mcp-http
codex-plugin-doctor init runtime-demo --template full-runtime
codex-plugin-doctor security .
codex-plugin-doctor security . --scorecard
codex-plugin-doctor security . --json
codex-plugin-doctor security . --policy security
codex-plugin-doctor compat .
codex-plugin-doctor compat . --all --scorecard
codex-plugin-doctor compat . --client codex
codex-plugin-doctor compat . --client generic-mcp
codex-plugin-doctor compat . --client claude-desktop
codex-plugin-doctor compat . --client claude-desktop --install-preview
codex-plugin-doctor compat . --client claude-desktop --apply --backup
codex-plugin-doctor compat . --client cursor
codex-plugin-doctor compat . --client cursor --install-preview
codex-plugin-doctor compat . --client cursor --apply --backup
codex-plugin-doctor compat . --client cline
codex-plugin-doctor compat . --client cline --install-preview
codex-plugin-doctor compat . --scorecard
codex-plugin-doctor compat . --json
codex-plugin-doctor compat . --json --output compatibility.json
codex-plugin-doctor check .
codex-plugin-doctor check . --profile ci
codex-plugin-doctor check . --profile strict
codex-plugin-doctor check . --profile publish
codex-plugin-doctor check . --policy codex-publish
codex-plugin-doctor check . --policy mcp-strict
codex-plugin-doctor check . --policy security
codex-plugin-doctor check . --json
codex-plugin-doctor check . --explain
codex-plugin-doctor check . --json --output report.json
codex-plugin-doctor check . --markdown --output report.md
codex-plugin-doctor check . --badge-json --output doctor-badge.json
codex-plugin-doctor check . --badge-markdown
codex-plugin-doctor check . --sarif --output results.sarif
codex-plugin-doctor check . --ascii
codex-plugin-doctor check . --no-animations
codex-plugin-doctor check . --runtime
codex-plugin-doctor check . --runtime --require-runtime-approval --runtime-approval-digest sha256:<approved-plan-digest>
codex-plugin-doctor check . --config .codex-doctor.json
codex-plugin-doctor check . --history validation-history.jsonl
codex-plugin-doctor history validation-history.jsonl
codex-plugin-doctor history validation-history.jsonl --json
codex-plugin-doctor history validation-history.jsonl --fail-on-regression
codex-plugin-doctor fix . --dry-run
codex-plugin-doctor fix . --interactive --backup
codex-plugin-doctor fix . --apply --backup
codex-plugin-doctor check . --json --runtime --verbose-runtime
```

`self-test` runs the bundled runtime-complete sample through static validation, runtime MCP probes, and the compatibility scorecard. It is the fastest post-install check after `npm install -g codex-plugin-doctor`.

`doctor` checks the local environment, including package version, platform, Node version, npm global prefix, Codex home, and Codex plugin cache visibility. The text output also includes recommended next commands for self-test, installed plugin discovery, runtime checks, compatibility scoring, and CI setup. `doctor contract` publishes the machine-readable output contract, including public JSON schema surfaces, stable-through-1.0 compatibility metadata, and a frozen rule catalog digest. Add `--json` for automation or `--output output-contract.json` to write the contract to disk. `doctor corpus` runs the bundled validation corpus against healthy runtime, risky security, starter skill, and generic MCP packages, then reports whether each case matched its expected outcome. Add `--json` for automation or `--output validation-corpus.json` to write the corpus report to disk. `doctor npm <package>` runs a preinstall scan by packing the npm package with scripts disabled, extracting the publish tarball, and running validation, security, trust, and recommendation checks against the shipped contents. Use a published Codex plugin package as the target; scanning `codex-plugin-doctor` itself intentionally reports a missing plugin manifest because this CLI package is not a plugin package. Add `--json` for automation or `--output npm-preinstall.json` to write the report to disk. `doctor attest <path>` creates a local attestation with stable package/report digests, validation/security/compatibility/trust summary, and verification metadata. Add `--sign-key-env NAME` to attach a local HMAC-SHA256 signature without printing the secret, or `--json --output attestation.json` to write the artifact to disk. `doctor attest verify <attestation.json> --target <path> --sign-key-env NAME` recomputes the package fingerprint, report digest, and HMAC signature offline; verification intentionally treats `generatedAt`, `targetPath`, `verification`, and `signature.keyHint` as unsigned display metadata. `doctor runtime-plan <path>` creates a non-executing runtime plan that lists MCP server commands, safe probe methods, risk reasons, and a stable approval digest before any local server is started. Add `--markdown --output runtime-plan.md` to preserve a review-ready approval artifact with the execution boundary, checklist, servers, probes, and risk reasons. `doctor runtime-policy <path>` evaluates the same runtime plan and security signals, then recommends `allow`, `review`, `sandbox_recommended`, or `deny` before local MCP execution starts. `doctor review-bundle <path> --output <dir> --sign-key-env NAME` writes a signed review directory with runtime plan, runtime policy, attestation, release evidence, manifest, Markdown summary files, and SHA-256 file integrity digests. `doctor review-bundle verify <bundle-dir> --target <path> --sign-key-env NAME` verifies the bundle manifest, expected files, manifest integrity digests, runtime artifacts, signed attestation, and signed release evidence offline before a reviewer trusts the handoff. `doctor review-bundle diff --before <dir> --after <dir>` compares two review bundles and flags risk-increasing changes in status, runtime policy, release readiness, signatures, release evidence, and runtime plan digest. `check --runtime --require-runtime-approval --runtime-approval-digest <digest>` refuses to run runtime probes unless the current plan digest matches the approved digest. `doctor release-evidence <path> --sign-key-env NAME` creates one redacted release bundle with signed attestation, offline verification, corpus, performance, security, trust, package metadata, git release gates, and runtime approval status. Strict release evidence requires a clean tagged worktree; use `--allow-dirty` or `--allow-untagged` only for local rehearsal. `doctor release-evidence verify <evidence.json> --target <path> --sign-key-env NAME` verifies a shared release evidence artifact offline against an explicit package path; the artifact target path is treated as display metadata, not trusted input. `doctor release-evidence asset <path> --tag <tag> --output <evidence.json> --sign-key-env NAME` writes a signed release evidence file and prints the `gh release upload` command; add `--upload` to run the upload through GitHub CLI with `--clobber`. `doctor inspector <path>` builds a safe MCP Inspector launch command from a packaged `.mcp.json` file without starting the Inspector proxy automatically. Use `--server <name>` when the package contains multiple MCP server entries. `doctor diff --before <path> --after <path>` compares two package roots and reports new findings, resolved findings, trust score delta, and whether risk increased. `doctor recommend <path>` turns validation, security, and compatibility signals into a prioritized action plan with blocker, high, medium, and info actions. Add `--json` for automation or `--output recommendations.json` to write the report to disk. `doctor trust <path>` creates a local trust score from package lifecycle scripts, dependency specs, and MCP security findings. Use it before release when you want supply-chain risks summarized as one score. `doctor perf <path>` profiles the shared package analysis pipeline and reports per-stage durations for validation, config, security, compatibility, trust, recommendations, and total runtime. Add `--max-total-ms <ms>` or repeatable `--max-stage-ms stage=ms` to fail CI when a budget is exceeded. `doctor mcp <path>` exposes the generic MCP static health report under the doctor command family without starting local MCP servers. `doctor export --bundle <path>` creates a redacted operator handoff bundle that includes validation JSON, security scorecard data, compatibility matrix, recommendations, and trust score in one file. `doctor snapshot` creates a redacted diagnostics bundle with environment health, client config readiness, installed plugin metadata, and next commands. Add `--json` for machine-readable output or `--output doctor-snapshot.json` to write the bundle to disk. `doctor clients` reports local Codex, Claude Desktop, Cursor, Cline, and Windsurf config readiness. `doctor --update-check` compares the installed CLI version with the latest npm version and prints the upgrade command when a newer release is available.

`audit --installed` runs a local ecosystem audit against every discovered Codex plugin in the installed plugin cache. Add `--security` to include security scorecards, `--compat` to include the all-client compatibility matrix, and `--json --output local-audit.json` when you want a shareable machine-readable report. Add `--cache` to reuse unchanged plugin results between runs; add `--changed` to only report plugins whose fingerprint changed since the last cached audit. Use `--cache-file path/to/audit-cache.json` when CI or scripted runs need an explicit cache location.

`--policy codex-publish|mcp-strict|security` applies opinionated gates without requiring a local `.codex-doctor.json`. `codex-publish` fails warnings and enables runtime probes for release checks, `mcp-strict` does the same for MCP-heavy packages, and `security` fails warning-level security findings so advisory risks can block a local audit or CI gate.

`mcp <path>` diagnoses generic MCP packages that may not have a Codex plugin manifest. It looks for `.mcp.json` or a manifest `mcpServers` reference, validates the top-level `mcpServers` object and server transports, adds MCP command-surface security findings, and includes the all-client compatibility matrix in the same report.

`init [path] --template ...` creates targeted starter packages. `skill-only` is the default minimal skill package, `mcp-stdio` adds a local stdio MCP config and mock server, `mcp-http` scaffolds a streamable HTTP MCP config, and `full-runtime` generates a stdio sample that passes the runtime protocol probes.

`security <path>` renders a focused package security scorecard. It reuses the existing package security findings, then adds deeper MCP command-surface checks for shell wrappers, encoded shell payloads, remote pipe-to-shell startup patterns, `cwd` values outside the plugin root, and plain HTTP URLs. Use `--json` for automation or `--scorecard` for a compact status view.

`compat --client claude-desktop` checks whether the MCP package can be added to the local Claude Desktop setup. On Windows it looks for `%APPDATA%\Claude\claude_desktop_config.json`; on macOS it looks for `~/Library/Application Support/Claude/claude_desktop_config.json`. A valid existing config returns `PASS`, a missing Claude Desktop install returns `WARN`, and a malformed local config returns `FAIL` so you do not add new servers into a broken config file. If the package server name already exists in Claude Desktop, the command returns `WARN` with the duplicate server name. Add `--install-preview` to print the JSON snippet that should be merged into `claude_desktop_config.json`; it does not modify files. Use `--apply --backup` only when you want the CLI to create a timestamped backup and merge the server config. Apply mode refuses to overwrite duplicate server names.

`compat --client cursor` checks whether the MCP package can be added to Cursor. It prefers a project-level `.cursor/mcp.json` when one already exists in the target package, then falls back to the global `~/.cursor/mcp.json` path. A valid existing config returns `PASS`, a missing Cursor config returns `WARN`, malformed JSON returns `FAIL`, and duplicate MCP server names return `WARN`. Add `--install-preview` to print the JSON snippet that should be merged into Cursor's `mcp.json`; it does not modify files. Use `--apply --backup` only when you want the CLI to create a timestamped backup and merge the server config. Apply mode refuses to overwrite duplicate server names.

`compat --client cline` checks whether the MCP package can be added to Cline. It uses `CLINE_DIR/data/settings/cline_mcp_settings.json` when `CLINE_DIR` is set, otherwise `~/.cline/data/settings/cline_mcp_settings.json`. Add `--install-preview` to print the JSON snippet that should be merged into `cline_mcp_settings.json`.

`compat --all` makes the all-client matrix explicit when you want Codex, Generic MCP, Claude Desktop, Cursor, Cline, and Windsurf in one run. `compat --scorecard` turns the compatibility matrix into a compact score summary. `PASS` maps to `100`, `WARN` maps to `70`, and `FAIL` or `SKIPPED` maps to `0`.

`check --installed --compat --all-summary` validates every discovered Codex plugin from the local plugin cache and appends a compact compatibility summary for Codex, Generic MCP, Claude Desktop, Cursor, Cline, and Windsurf. This is the fastest repo-free audit when a user does not know individual plugin paths.

`check --profile ci|strict|publish` applies named validation policies. `ci` keeps default behavior, `strict` fails on warnings, and `publish` fails on warnings while enabling runtime probing by default.

`check --explain` adds inline rule catalog context to text reports, including why a finding matters, a more detailed fix path, and a compact example.

`check --badge-json` emits Shields endpoint-compatible JSON such as `{"schemaVersion":1,"label":"doctor","message":"PASS","color":"brightgreen"}`. `check --badge-markdown` emits a static shields.io Markdown badge for README or release notes. Badge output is intentionally limited to single package checks, not `check --installed`.

`check --history <path>` appends a compact JSONL validation snapshot after a single package check. `history <path>` reads the JSONL file and compares the latest run to the previous run, including status, finding-count deltas, and whether the latest run regressed. Add `history --json` for automation output or `history --fail-on-regression` when CI should fail after a worse latest run.

`fix --dry-run` renders safe automatic fix plans without changing files. `fix --interactive --backup` shows the same numbered plan, then applies everything after `yes` or only selected action numbers such as `1,3`. `fix --apply --backup` applies supported safe fixes, such as manifest defaults and missing skills directories, after creating backups.

Optional local policy file:

```json
{
  "ignoreRules": ["plugin.heuristic.description.too_long"],
  "failOnWarnings": true
}
```

Run these when you want Codex Plugin Doctor to find plugins from the local Codex installation:

```bash
codex-plugin-doctor list --installed
codex-plugin-doctor check --installed
codex-plugin-doctor check --installed --all-summary
codex-plugin-doctor check --installed --compat --all-summary
codex-plugin-doctor check --installed github
codex-plugin-doctor check --installed github --runtime --no-animations
codex-plugin-doctor explain plugin.security.hard_coded_secret
```

## GitHub Action

```yaml
name: Validate Codex plugin

on:
  pull_request:

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Esquetta/CodexPluginDoctor@v1.11.0
        with:
          version: "1.11.0"
          path: .
          runtime: "true"
          policy: codex-publish
          upload-artifact: "true"
          artifact-name: codex-plugin-doctor-reports
          review-bundle: "true"
          review-bundle-verify: "true"
```

The action writes `codex-plugin-doctor-summary.md`, `codex-plugin-doctor-report.json`, optional `codex-plugin-doctor.sarif`, and optional signed `review-bundle/` files to `codex-plugin-doctor-reports`, appends the Markdown report to the GitHub Actions step summary, uploads the report directory as an artifact, and then returns the real validation exit code. Review bundle generation requires a signing key environment variable such as `CODEX_PLUGIN_DOCTOR_SIGNING_KEY`. For runtime probing, SARIF output, review bundle artifacts, installed plugin cache checks, CI policy presets, and pinned release examples, see [GitHub Action Usage](./docs/engineering/github-action-usage.md).

To self-test this repository after cloning it:

```bash
codex-plugin-doctor check examples/codex-doctor-runtime --runtime --no-animations
```

## Repository Layout

```text
docs/                 Product, engineering, security, and release docs
examples/             Manual plugin packs for local CLI testing
src/                  CLI, validation logic, runtime probing, reports
tests/                Fixture-based regression tests
validation-sessions/  Real-world validation waves and tuning notes
```

## Validation Evidence

The validator is tuned against local fixtures and real marketplace-style plugin packages. See:

- [Real-World Validation Workflow](./docs/engineering/real-world-validation-workflow.md)
- [Validation Sessions](./validation-sessions/README.md)
- [Examples](./examples/README.md)
- [Rule Catalog](./docs/rules/catalog.md)

Recent validation waves covered:

- curated Codex plugin cache packages
- marketplace-style plugin snapshots
- YAML block-scalar skill metadata
- media and visual workflow metadata

## Release Readiness

Release preparation is reproducible from the repository:

```bash
npm run prepare-release
npm run release-check
```

`prepare-release` runs tests, builds the TypeScript output, and performs `npm pack --dry-run`. `release-check` adds release preflight checks for a clean git tree, existing npm versions, existing version tags, tests, build, and pack dry-run.

Related docs:

- [Changelog](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
- [Code of Conduct](./CODE_OF_CONDUCT.md)
- [NPM Release Checklist](./docs/engineering/npm-release-checklist.md)
- [Release Candidate Workflow](./docs/engineering/release-candidate-workflow.md)
- [v1.0 Readiness Checklist](./docs/engineering/v1.0-readiness-checklist.md)

## Contributing

Contributions are welcome once the repository is public. Start with:

- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)
- [Validation tuning issue template](./.github/ISSUE_TEMPLATE/validation_tuning.yml)

## Support

If this tool saves you time, GitHub stars and sponsorship help signal that the project is worth continuing.

- Star the repository on GitHub.
- Use GitHub Sponsors through the repository funding link.
- Open validation tuning issues for false positives or false negatives.

## Product Direction

Codex Plugin Doctor starts as a Codex-specific validator and can grow into a broader MCP Doctor over time.

The immediate goal is not a marketplace, dashboard, or hosted website. The immediate goal is a trustworthy local preflight check for Codex-compatible plugin bundles.
