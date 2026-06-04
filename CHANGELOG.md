# Changelog

All notable changes to `codex-plugin-doctor` are documented here.

This changelog groups the shipped work into product-level release blocks instead of repeating every low-level git diff in isolation.

## [1.11.0] - 2026-06-04

### Added

- added review bundle manifest path confinement checks so declared artifact paths cannot resolve outside the bundle directory
- added integrity path binding checks so digest entries must match the declared bundle file path
- added regression coverage for escaped manifest file paths and mismatched integrity paths

## [1.10.0] - 2026-06-03

### Added

- added stricter review bundle integrity manifest coverage checks for missing bundled files
- added review bundle verification failure checks for unexpected integrity manifest entries
- kept legacy review bundle verification backward-compatible when no integrity block is present

## [1.9.0] - 2026-06-01

### Added

- added SHA-256 file integrity digests to newly generated review bundle manifests
- added review bundle verification checks that detect tampered bundle files when manifest integrity metadata is present
- kept review bundle verification backward-compatible with older bundles that do not include integrity metadata

## [1.8.0] - 2026-05-31

### Added

- added GitHub Action inputs for signed review bundle artifact generation and verification
- added GitHub Action outputs for review bundle and verification artifact paths
- added `doctor review-bundle verify --output <path>` so CI can persist verification JSON files

## [1.7.0] - 2026-05-28

### Added

- added `doctor review-bundle diff --before <dir> --after <dir>` to compare review bundle handoffs
- added risk-increase detection for status, runtime policy, release readiness, attestation, release evidence, and runtime plan digest changes
- added `doctor.review.bundle.diff` to the public output contract

## [1.6.0] - 2026-05-27

### Added

- added `doctor review-bundle verify <bundle-dir> --target <path> --sign-key-env <name>` for offline review bundle verification
- added manifest, file presence, runtime plan, runtime policy, attestation, and release evidence checks to review bundle verification
- added `doctor.review.bundle.verification` to the public output contract

## [1.5.0] - 2026-05-26

### Added

- added `doctor review-bundle <path> --output <dir> --sign-key-env <name>` to write a signed review handoff directory
- added runtime plan, runtime policy, signed attestation, release evidence, manifest, and Markdown summary files to the review bundle
- added `doctor.review.bundle` to the public output contract

## [1.4.0] - 2026-05-24

### Added

- added `doctor runtime-policy <path>` to classify runtime execution as `allow`, `review`, `sandbox_recommended`, or `deny`
- added `doctor.runtime.policy` to the public output contract for automation-friendly runtime policy decisions
- added runtime policy actions that connect approval digests, Markdown runtime plans, sandbox recommendations, and deny-level security findings

## [1.3.0] - 2026-05-23

### Added

- added `doctor runtime-plan <path> --markdown` for review-ready runtime approval artifacts
- added Markdown output writing for runtime plans so approval digest, execution boundary, checklist, servers, probes, and risk reasons can be preserved with release evidence

## [1.2.0] - 2026-05-20

### Added

- added `doctor runtime-plan <path>` to generate a non-executing runtime approval plan with a stable digest
- added `--require-runtime-approval --runtime-approval-digest <digest>` gates for runtime checks before local MCP servers are started
- added signed release evidence `runtimeApproval` metadata so release artifacts record whether runtime execution was approved
- added `doctor.runtime.plan` to the public output contract

## [1.1.0] - 2026-05-19

### Added

- added `doctor release-evidence verify <evidence.json> --target <path> --sign-key-env <name>` for offline verification of shared release evidence bundles
- added `doctor release-evidence asset <path> --tag <tag> --output <evidence.json>` for GitHub Release evidence asset preparation and optional `--upload`
- added `doctor.release.evidence.verification` to the public output contract
- added `doctor.release.evidence.asset` to the public output contract

## [1.0.3] - 2026-05-16

### Added

- added `doctor release-evidence <path> --sign-key-env <name>` to produce one signed, machine-readable release evidence bundle
- added strict release gates for git commit, exact tag, and clean worktree checks, with explicit `--allow-dirty` and `--allow-untagged` overrides for local rehearsal
- added `doctor.release.evidence` to the public output contract

### Changed

- reused redaction logic for release evidence JSON so shared artifacts mask token-like values
- documented the release evidence workflow for stable 1.0 patch releases

## [1.0.2] - 2026-05-15

### Added

- added `doctor attest verify <attestation.json> --target <path> --sign-key-env <name>` for offline signed attestation verification
- added verification JSON/text reports with package fingerprint, report digest, signature checks, and explicit unsigned metadata fields
- added deterministic digest coverage across copied package roots for signed attestation payloads

### Changed

- kept verification secret handling env-only so HMAC keys do not need to be passed through shell arguments
- updated the public output contract with the attestation verification report surface

## [1.0.1] - 2026-05-14

### Added

- added HMAC-SHA256 local attestation signing with `doctor attest --sign-key-env` and secret-safe recompute hints
- added performance budget gates with `doctor perf --max-total-ms` and `--max-stage-ms stage=ms`
- added `doctor mcp <path>` as a doctor-family alias for the static generic MCP health report
- expanded the bundled validation corpus with a generic MCP package case

### Changed

- documented the post-1.0 additive release path, signed attestation behavior, MCP static-health boundary, and performance gate usage

## [1.0.0] - 2026-05-12

### Added

- promoted Codex Plugin Doctor to the stable `1.0.0` baseline after the `1.0.0-rc.2` release-candidate smoke path
- added stable 1.0 release notes covering compatibility, known limits, and validation evidence for npm and GitHub Release consumers

### Changed

- updated public README, GitHub Action examples, release checklists, and publish decision docs from the RC lane to the stable `1.0.0` lane

## [1.0.0-rc.2] - 2026-05-12

### Fixed

- fixed npm 11 argument handling for `prepare-rc` and release sync verification scripts so documented npm-run maintainer workflows work during the 1.0 release-candidate path

## [1.0.0-rc.1] - 2026-05-12

### Added

- added release sync verification support for npm prerelease dist-tags and GitHub prereleases so the `1.0.0-rc.1` path can be checked without moving npm `latest`

### Changed

- promoted the package version to the first `1.0.0` release candidate for smoke verification, contract validation, and registry install testing
- updated release documentation and GitHub Action examples for the `1.0.0-rc.1` candidate path

## [0.21.0] - 2026-05-11

### Added

- added a 1.0 readiness checklist covering release-candidate smoke commands, contract checks, GitHub Action smoke expectations, known limitations, and stable-release exit criteria

### Changed

- refreshed public release, versioning, and publish decision docs to reflect the current npm/GitHub release state and the `1.0.0-rc.1` path
- updated README status language from early-public wording to the 1.0 readiness track and linked the active readiness checklist

## [0.20.0] - 2026-05-10

### Added

- added GitHub Action report artifacts for JSON, Markdown, and optional SARIF outputs with configurable output directory and artifact name
- added GitHub Action step summary publishing and workflow outputs for report paths and validation status
- added GitHub Action `policy` and `profile` inputs so CI can apply release gates such as `codex-publish`, `mcp-strict`, and `security`

## [0.19.0] - 2026-05-09

### Added

- added `doctor corpus [--json|--output]` for a bundled real-world-style validation corpus that checks healthy runtime, risky security, and starter skill packages against expected outcomes

## [0.18.0] - 2026-05-09

### Added

- added `doctor contract [--json|--output]` for a machine-readable output contract with public JSON schema surfaces, stable-through-1.0 metadata, and a frozen rule catalog digest

## [0.17.0] - 2026-05-09

### Added

- added `doctor attest <path> [--json|--output]` for deterministic local attestation artifacts with package fingerprints, report digests, validation/security/compatibility/trust summaries, and unsigned verification metadata

## [0.16.0] - 2026-05-08

### Added

- added `doctor inspector <path> [--server <name>] [--json|--output]` to generate a safe MCP Inspector launch command from packaged `.mcp.json` server entries without starting the Inspector proxy automatically

## [0.15.0] - 2026-05-08

### Added

- added `doctor npm <package> [--json|--output]` for preinstall npm package scans against the publish tarball with package scripts disabled
- added static prompt-injection and secret-exfiltration text detection across packaged skill, prompt, resource, JSON, and markdown surfaces
- added `doctor diff --before <path> --after <path> [--json|--output]` for risk delta reports with new findings, resolved findings, and trust score changes

## [0.14.0] - 2026-05-07

### Added

- added shared package analysis so recommendations, trust, export bundles, and future diagnostics can reuse validation, security, compatibility, and trust signals without redundant work
- added `doctor perf <path> [--json|--output]` to profile validation, config, security, compatibility, trust, recommendations, and total analysis runtime
- added `audit --installed --cache`, `--cache-file <path>`, and `--changed` to reuse unchanged installed-plugin audit results and report only changed plugin fingerprints

## [0.13.0] - 2026-05-07

### Added

- added `doctor recommend <path> [--json|--output]` for prioritized validation, security, and compatibility action plans
- added `doctor trust <path> [--json|--output]` for local supply-chain and MCP security trust scoring
- added `doctor export --bundle <path> [--json|--output]` for redacted validation, security, compatibility, recommendation, and trust evidence bundles

## [0.12.0] - 2026-05-06

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
