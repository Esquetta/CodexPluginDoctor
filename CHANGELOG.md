# Changelog

All notable changes to `codex-plugin-doctor` are documented here.

This changelog groups the shipped work into product-level release blocks instead of repeating every low-level git diff in isolation.

## Unreleased

No unreleased changes yet.

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
