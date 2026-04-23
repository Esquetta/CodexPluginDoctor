# Codex Plugin Doctor

Codex Plugin Doctor is a CLI-first validator for Codex plugins, skills, and MCP package surfaces.

It helps plugin authors and engineering teams catch packaging, configuration, and structural issues before a broken plugin reaches users or internal rollout workflows.

## Status

The repository currently contains:

- a documented product foundation in [`docs/`](./docs/README.md)
- an initial TypeScript CLI scaffold
- fixture-based tests for plugin discovery and manifest validation
- a minimal `check` command with text and JSON output

## Current Validation Scope

The first working slice validates:

- required `.codex-plugin/plugin.json` presence
- required manifest fields: `name`, `version`, `description`
- referenced `skills` directory existence when declared
- `SKILL.md` presence and required frontmatter fields for declared skills
- optional `.mcp.json` discovery and structural validation
- opt-in runtime probing for command-based MCP servers with real MCP `initialize`, `tools/list`, and `tools/call` validation
- capability-gated `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, and `prompts/get` runtime validation
- safe schema-based `tools/call` argument generation with destructive-tool skipping
- security checks for path traversal and hard-coded secret-like env values
- warn-level heuristics for overly verbose plugin and skill descriptions
- markdown summaries for CI-friendly report publishing
- TTY-aware live status rendering for human text runs, with machine outputs kept clean
- `--ascii` fallback rendering for terminal-safe text output
- `--no-animations` for quiet human runs
- `--verbose-runtime` for stderr protocol transcript output
- runtime capability scorecard in reports
- paginated MCP list probing
- redacted transcript output for generated prompt arguments, token-like strings, sensitive query parameters, and long payloads
- deterministic PASS/FAIL reporting with CLI exit codes

## Planned Commands

```bash
codex-plugin-doctor check .
codex-plugin-doctor check . --json
codex-plugin-doctor check . --json --output report.json
codex-plugin-doctor check . --markdown --output report.md
codex-plugin-doctor check . --ascii
codex-plugin-doctor check . --no-animations
codex-plugin-doctor check . --json --runtime --verbose-runtime
codex-plugin-doctor check . --runtime
```

## Quick Start

### Install dependencies

```bash
npm install
```

### Run tests

```bash
npm test
```

### Build the CLI

```bash
npm run build
```

### Run against a local fixture

```bash
npm run dev -- check tests/fixtures/valid-plugin
npm run dev -- check tests/fixtures/missing-manifest --json
node dist/cli.js check tests/fixtures/security-hardcoded-secret --ascii
node dist/cli.js check tests/fixtures/valid-plugin-with-mcp --no-animations
node dist/cli.js check tests/fixtures/runtime-valid --json --runtime --verbose-runtime
node dist/cli.js check tests/fixtures/runtime-paginated --json --runtime --verbose-runtime
node dist/cli.js check tests/fixtures/runtime-valid --json --runtime --output report.json
```

## Repository Layout

```text
docs/      Product, brand, security, operations, and engineering documentation
examples/  Manual sample plugin packs for local CLI testing
src/       CLI entrypoint, validation logic, domain types, and reporting
tests/     Fixture-based tests and sample plugin bundles
```

## Documentation Highlights

- [Vision and Strategy](./docs/product/vision-and-strategy.md)
- [MVP Specification](./docs/product/mvp-spec.md)
- [Technical Architecture](./docs/engineering/technical-architecture.md)
- [Security Architecture](./docs/security/security-architecture.md)
- [Initial Implementation Plan](./docs/engineering/initial-implementation-plan.md)
- [Initial Issue Breakdown](./docs/operations/initial-issue-breakdown.md)
- [Release Gating Workflow](./docs/engineering/release-gating-workflow.md)
- [Runtime Tools List Probe Plan](./docs/engineering/runtime-tools-list-implementation-plan.md)
- [NPM Release Checklist](./docs/engineering/npm-release-checklist.md)
- [Examples](./examples/README.md)

## Near-Term Roadmap

The next implementation slices are:

1. Add deeper schema and context-bloat heuristics.
2. Expand security rules beyond path and env checks.
3. Add richer MCP transport validation beyond `tools/call`, including more protocol error paths.
4. Introduce package-path configuration in CI examples.
5. Add GitHub Action artifact publishing and richer summary formatting.

## Product Direction

The product starts as a Codex-specific validator and is designed to grow into a broader `MCP Doctor` platform over time. The immediate goal is not to build a marketplace or a dashboard. The immediate goal is to provide reliable preflight validation for Codex-compatible package bundles.
