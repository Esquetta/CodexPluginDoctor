# Codex Plugin Doctor

[![CI](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml)

Codex Plugin Doctor is a local CLI validator for Codex plugin packages, skills, and MCP server bundles.

It catches packaging, metadata, security, and runtime protocol problems before a plugin reaches users, teammates, or release workflows.

## Status

Codex Plugin Doctor is currently pre-release and local-first.

- Primary surface: GitHub repository
- Distribution today: local source install, `npm link`, `npm pack`, GitHub Releases
- Public npm publish: prepared, but not yet required
- License: [MIT](./LICENSE)

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

Output formats:

- human text output
- JSON reports
- Markdown reports
- `--output` file writing
- CI summary and artifact generation

## Quick Start

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
Target: D:\Workstation\CodexPluginDoctor\examples\codex-doctor-runtime
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
Target: D:\Workstation\CodexPluginDoctor\examples\codex-doctor-risky
Summary: 1 fail, 0 warn, 1 total

Failures
--------
x plugin.security.hard_coded_secret
  Message: The MCP server `dangerServer` contains a hard-coded secret-like env value for `OPENAI_API_KEY`.
  Impact: Hard-coded credentials inside plugin bundles increase leakage risk and make secure rotation difficult.
  Suggested fix: Replace the literal value for `OPENAI_API_KEY` with an environment reference or injected secret outside the package.
```

## Useful Commands

```bash
codex-plugin-doctor check .
codex-plugin-doctor check . --json
codex-plugin-doctor check . --json --output report.json
codex-plugin-doctor check . --markdown --output report.md
codex-plugin-doctor check . --ascii
codex-plugin-doctor check . --no-animations
codex-plugin-doctor check . --runtime
codex-plugin-doctor check . --json --runtime --verbose-runtime
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

Recent validation waves covered:

- curated Codex plugin cache packages
- marketplace-style plugin snapshots
- YAML block-scalar skill metadata
- media and visual workflow metadata

## Release Readiness

Release preparation is reproducible from the repository:

```bash
npm run prepare-release
```

This runs tests, builds the TypeScript output, and performs `npm pack --dry-run`.

Related docs:

- [Changelog](./CHANGELOG.md)
- [NPM Release Checklist](./docs/engineering/npm-release-checklist.md)
- [Release Candidate Workflow](./docs/engineering/release-candidate-workflow.md)
- [v0.1.0 Final Release Notes Draft](./docs/engineering/v0.1.0-final-release-notes.md)

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
