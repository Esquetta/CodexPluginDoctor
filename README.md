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
- opt-in runtime startup probing for command-based MCP servers
- deterministic PASS/FAIL reporting with CLI exit codes

## Planned Commands

```bash
codex-plugin-doctor check .
codex-plugin-doctor check . --json
codex-plugin-doctor check . --json --output report.json
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
node dist/cli.js check tests/fixtures/runtime-valid --json --runtime --output report.json
```

## Repository Layout

```text
docs/      Product, brand, security, operations, and engineering documentation
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

## Near-Term Roadmap

The next implementation slices are:

1. Add `.mcp.json` discovery and structural validation.
2. Add runtime startup probing behind `--runtime`.
3. Add JSON report hardening for CI consumption.
4. Add GitHub Action support for release gating.
5. Add security checks for risky env usage and path traversal.

## Product Direction

The product starts as a Codex-specific validator and is designed to grow into a broader `MCP Doctor` platform over time. The immediate goal is not to build a marketplace or a dashboard. The immediate goal is to provide reliable preflight validation for Codex-compatible package bundles.
