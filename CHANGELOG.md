# Changelog

All notable changes to `codex-plugin-doctor` are documented here.

This changelog groups the shipped work into product-level release blocks instead of repeating every low-level git diff in isolation.

## [0.1.0] - 2026-04-22

Initial local validation release for Codex plugin packages and MCP-backed runtime validation.

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

This project is currently optimized for local testing and iterative hardening rather than public package publication. The package metadata and release-prep flow are in place, but public npm release decisions such as license and publish policy remain intentionally deferred.
