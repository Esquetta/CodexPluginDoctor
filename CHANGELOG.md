# Changelog

All notable changes to `codex-plugin-doctor` are documented here.

This changelog groups the shipped work into product-level release blocks instead of repeating every low-level git diff in isolation.

## Unreleased

### Added

- added `audit --installed [--security] [--compat]` for local ecosystem audits across installed Codex plugins
- added `--policy codex-publish|mcp-strict|security` for opinionated release, MCP, and security gates
- added `mcp <path> [--json|--output]` for generic MCP package diagnostics without requiring a Codex manifest

## [0.11.0] - 2026-05-06

### Added

- added `security <path> [--json|--scorecard]` for a focused MCP command-surface security scorecard
- added `npm run verify-release-sync` to confirm npm, git tags, GitHub Releases, and the latest release pointer after publishing
- added `doctor snapshot [--json|--output <path>]` for redacted local diagnostics bundles

### Changed

- updated GitHub Actions workflows to `actions/checkout@v5`, `actions/setup-node@v5`, and `actions/upload-artifact@v5`

## [0.10.1] - 2026-05-05

Patch release for safe-fix path hardening.

### Fixed

- prevented `fix --apply` and `fix --interactive` from creating or modifying files outside the plugin root when manifest paths contain traversal attempts

## [0.10.0] - 2026-05-05

Feature release for version awareness, local client readiness checks, installed plugin compatibility summaries, targeted starter templates, and selective safe fixes.

### Added

- added `doctor --update-check` to compare the installed CLI version with the npm latest version
- added `doctor clients` to report local Codex, Claude Desktop, Cursor, Cline, and Windsurf config readiness
- added `check --installed --compat --all-summary` for installed plugin validation plus cross-client compatibility summaries
- added `init [path] --template skill-only|mcp-stdio|mcp-http|full-runtime` for targeted plugin package scaffolds
- added selective `fix --interactive --backup` action numbers so users can apply only chosen safe fixes

## [0.9.0] - 2026-05-04

Feature release for clearer first-run guidance, all-client compatibility checks, inline explanations, interactive safe fixes, and release preflight automation.

### Added

- added explicit `compat <path> --all` for discoverable all-client compatibility and scorecard checks
- added `check <path> --explain` for inline rule explanations in text reports
- added first-run guidance to empty CLI usage and `doctor` text output
- added `npm run release-check` for release preflight automation before version tags and npm publish
- added `fix <path> --interactive --backup` for prompted safe-fix apply flows

## [0.8.0] - 2026-05-04

Feature release for machine-readable doctor/fix outputs, broader safe scaffolding, Windsurf compatibility, and CI bootstrap.

### Added

- added `fix <path> --dry-run --json` for automation-friendly safe fix plans
- added `doctor --json` for machine-readable local environment diagnostics
- added `compat --client windsurf` for Windsurf MCP config readiness checks
- added `compat --client windsurf --install-preview` for non-mutating Windsurf MCP config snippets
- added `init-ci [path]` to scaffold a pinned GitHub Actions validation workflow
- expanded safe fix scaffolding for missing `SKILL.md`, missing skill frontmatter, and missing `.mcp.json` defaults

## [0.7.0] - 2026-05-03

Feature release for safe fix automation, named validation profiles, environment diagnostics, and Cline compatibility.

### Added

- added `fix <path> --dry-run` for safe automatic fix planning without file changes
- added `fix <path> --apply --backup` for applying supported safe fixes with backups
- added `check --profile ci|strict|publish` for named CI and publish validation policies
- added `doctor` for local package, Node, npm, Codex home, and plugin cache diagnostics
- added `compat --client cline` for Cline MCP config detection
- added `compat --client cline --install-preview` for non-mutating Cline MCP config snippets

## [0.6.0] - 2026-05-02

Feature release for validation history, trend summaries, and CI regression gates.

### Added

- added `check --history <path>` JSONL snapshots and `history <path>` trend summaries for local validation history
- added `history --json` for automation-friendly validation history summaries
- added `history --fail-on-regression` so CI can fail when the latest validation run gets worse
- added a GitHub Action `history` input for writing validation history from consuming workflows

## [0.5.0] - 2026-05-02

Feature release for validation badge outputs and GitHub Action consumer guidance.

### Added

- added `check --badge-json` and `check --badge-markdown` for Shields-compatible validation badges
- added GitHub Action consumer documentation with pinned `v0.5.0` examples for runtime, SARIF, and installed-cache workflows
- added a `version` input to the composite action so consuming repositories can pin the npm CLI version independently from the action ref

## [0.4.0] - 2026-05-01

Feature release for safe MCP config apply and post-install self-test.

### Added

- added safe `compat --client claude-desktop --apply --backup` and `compat --client cursor --apply --backup` install flows with timestamped backups
- added `codex-plugin-doctor self-test` as a bundled post-install demo and runtime health check
- added BOM-tolerant JSON config parsing for local MCP config files written by Windows tooling
- included the bundled runtime example in the npm package so self-test works after global install

## [0.3.0] - 2026-04-30

Feature release for Cursor compatibility and scorecard reporting.

### Added

- added local Cursor compatibility detection for `compat --client cursor`
- added `compat --client cursor --install-preview` for non-mutating Cursor MCP config snippets
- added `compat --scorecard` for quick per-client compatibility scores

## [0.2.1] - 2026-04-30

Patch release for Claude Desktop local install readiness checks.

### Added

- added local Claude Desktop compatibility detection for `compat --client claude-desktop`
- added Claude Desktop MCP server name conflict warnings before adding a package
- added `compat --client claude-desktop --install-preview` for non-mutating Claude Desktop config snippets

## [0.2.0] - 2026-04-30

Feature release for cross-client compatibility checks and machine-readable compatibility reporting.

### Added

- added `codex-plugin-doctor compat <path>` as the first compatibility matrix command
- added initial Codex and Generic MCP compatibility adapters, with Claude Desktop and Cursor marked as planned skipped adapters
- added `compat --json --output <path>` for machine-readable compatibility reports
- added `compat --client <client>` filtering for focused client checks
- treated standalone `.mcp.json` packages as Generic MCP compatible without requiring a Codex plugin manifest

## [0.1.5] - 2026-04-29

Feature release for CI, policy configuration, rule explanations, SARIF reporting, and plugin scaffolding.

### Added

- added `codex-plugin-doctor explain <finding-id>` for focused rule explanations
- added a rule catalog document covering stable finding IDs, severity, and remediation intent
- added `check --installed --all-summary` for compact installed plugin validation summaries
- added `.codex-doctor.json` policy support for `ignoreRules` and `failOnWarnings`
- added SARIF output with `--sarif` for GitHub Code Scanning compatible reports
- added a composite GitHub Action entrypoint for repository CI validation
- added skill support asset integrity warnings for missing backticked `scripts/`, `templates/`, `assets/`, and `examples/` references
- added `codex-plugin-doctor init [path]` to scaffold a minimal Codex plugin package

## [0.1.4] - 2026-04-29

Patch release for installed Codex plugin discovery.

### Added

- added `--version` output for quick local/global CLI version checks
- added installed Codex plugin discovery with `list --installed`
- added `check --installed [filter]` so users can validate plugins from the local Codex plugin cache without knowing filesystem paths

## [0.1.3] - 2026-04-29

Patch release for smarter first-run failure messages.

### Changed

- improved the `plugin.manifest.missing` first-run guidance for users who accidentally run `check .` inside the Codex Plugin Doctor source repository
- added clearer missing-manifest guidance for normal Node projects that are not Codex plugin package roots

## [0.1.2] - 2026-04-29

Patch release for first-run npm onboarding clarity.

### Changed

- clarified that `codex-plugin-doctor check .` should be run from a Codex plugin package root, not from the Codex Plugin Doctor source repository
- updated npm quick start examples to use `path/to/plugin-package`
- documented the expected self-test command for this repository's bundled runtime example

## [0.1.1] - 2026-04-29

Patch release for the first public npm publication.

### Changed

- normalized the package `bin` path to `dist/cli.js` so npm preserves the global `codex-plugin-doctor` executable during publish
- updated README installation guidance for npm users

### Distribution

- published as a public npm package under `codex-plugin-doctor`
- kept GitHub Releases as the canonical source release surface

## [0.1.0] - 2026-04-28

First open-source-ready local release. This version is tagged as `v0.1.0` and distributed through GitHub Releases; public npm publishing remains deferred.

### Added Since `0.1.0-rc.1`

- MIT license and open-source repository documents
- GitHub issue templates for bugs, feature requests, and validation tuning
- GitHub Sponsors funding configuration
- stronger README positioning for GitHub-first distribution
- real-world validation sessions for curated cache, marketplace snapshots, YAML block scalar metadata, and media/visual metadata
- YAML block scalar parsing for `SKILL.md` frontmatter descriptions
- expanded description heuristics for concrete product, enterprise workflow, database, media, visual design, and platform terms
- regression fixtures for marketplace-style skill metadata false positives and block-scalar false negatives

### Release Focus

- reliable local validation before distribution
- reproducible release checks through `npm run prepare-release`
- GitHub-first open-source readiness without requiring a hosted website

## [0.1.0-rc.1] - 2026-04-23

First release candidate for the local Codex plugin validation workflow and deep MCP runtime validation stack.

### Foundation and Repository Setup

Grouped commits:

- `b7bd7e8` `chore: initialize Codex Plugin Doctor`
- `1c1dc58` `chore: add repository README and CI workflow`

Highlights:

- initialized the TypeScript/Node CLI repository
- added the first Vitest-based test harness
- added baseline GitHub Actions CI
- established repository documentation and packaging structure

### Static Validation and Reporting

Grouped commits:

- `cbeb1dd` `feat: validate MCP config and skill metadata`
- `91a4a19` `feat: add JSON reporting and runtime startup probes`
- `ba37891` `feat: add security heuristics and CI summaries`

Highlights:

- validates `.codex-plugin/plugin.json`
- validates skill directories and `SKILL.md` frontmatter
- validates `.mcp.json` structure
- emits text, JSON, and Markdown reports
- supports file output
- detects path traversal and hard-coded secret-like env values
- adds warn-level heuristics for verbose descriptions
- adds CI summary publishing and artifact-ready reports

### CLI Presentation and Operator UX

Grouped commits:

- `f2c1644` `docs: add CLI presentation roadmap`
- `f10d6ae` `feat: add TTY-aware CLI status rendering`
- `27df6d2` `feat: add ASCII fallback and branded CLI presentation`

Highlights:

- introduced TTY-aware status rendering
- kept machine-readable output clean while rendering live status to `stderr`
- added branded braille spinner support
- added `--ascii`
- added `--no-animations`
- improved human-facing terminal summaries
- added presentation tests and CI-safe output guarantees

### Runtime MCP Validation

Grouped commits:

- `97e4af8` `feat: probe MCP initialize and tools list`
- `bc08ac2` `feat: probe MCP tool calls`
- `d3854cd` `feat: probe MCP resources and prompts`
- `d3ca9c7` `feat: probe MCP resources/read and prompts/get`
- `50b7f57` `feat: add runtime capability scorecard and pagination`

Highlights:

- performs real stdio MCP handshake via `initialize`
- sends `notifications/initialized`
- validates `tools/list`
- validates `tools/call`
- validates `resources/list`
- validates `resources/read`
- validates `resources/templates/list`
- validates `prompts/list`
- validates `prompts/get`
- supports pagination across list operations
- emits runtime capability scorecards
- supports `--verbose-runtime` with redacted transcripts

### Local Testing and Release Prep

Grouped commits:

- `a7394f4` `docs: refresh runtime validation scope`
- `6933c5c` `docs: add local example plugin packs`

Highlights:

- refreshed README to match actual runtime validation depth
- added local example plugin packs for manual testing
- added npm release checklist
- added clean build and release dry-run workflow
- verified `npm pack --dry-run` packaging output

## Notes

This project is optimized for local testing, iterative hardening, GitHub Releases, and npm distribution. The repository uses the MIT license.
