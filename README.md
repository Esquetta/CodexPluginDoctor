# Codex Plugin Doctor

[![CI](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml)

Codex Plugin Doctor is a local CLI validator for Codex plugin packages, skills, and MCP server bundles.

It catches packaging, metadata, security, and runtime protocol problems before a plugin reaches users, teammates, or release workflows.

## Status

Codex Plugin Doctor is an early public CLI release.

- Primary surface: GitHub repository and npm package
- Distribution today: `npm install -g`, local source install, `npm link`, `npm pack`, GitHub Releases
- Public npm package: `codex-plugin-doctor`
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

Global install from npm:

```bash
npm install -g codex-plugin-doctor
codex-plugin-doctor --version
codex-plugin-doctor check path/to/plugin-package
```

Run `codex-plugin-doctor check .` from the root of a Codex plugin package that contains `.codex-plugin/plugin.json`. The Codex Plugin Doctor source repository is not itself a plugin package.

If you already have Codex installed locally and do not know plugin paths, discover the installed plugin cache:

```bash
codex-plugin-doctor list --installed
codex-plugin-doctor check --installed
codex-plugin-doctor check --installed --all-summary
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
codex-plugin-doctor init my-plugin
codex-plugin-doctor compat .
codex-plugin-doctor compat . --client codex
codex-plugin-doctor compat . --client generic-mcp
codex-plugin-doctor compat . --json
codex-plugin-doctor compat . --json --output compatibility.json
codex-plugin-doctor check .
codex-plugin-doctor check . --json
codex-plugin-doctor check . --json --output report.json
codex-plugin-doctor check . --markdown --output report.md
codex-plugin-doctor check . --sarif --output results.sarif
codex-plugin-doctor check . --ascii
codex-plugin-doctor check . --no-animations
codex-plugin-doctor check . --runtime
codex-plugin-doctor check . --config .codex-doctor.json
codex-plugin-doctor check . --json --runtime --verbose-runtime
```

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
      - uses: actions/checkout@v4
      - uses: Esquetta/CodexPluginDoctor@v0.1.4
        with:
          path: .
          runtime: "false"
```

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
```

This runs tests, builds the TypeScript output, and performs `npm pack --dry-run`.

Related docs:

- [Changelog](./CHANGELOG.md)
- [NPM Release Checklist](./docs/engineering/npm-release-checklist.md)
- [Release Candidate Workflow](./docs/engineering/release-candidate-workflow.md)
- [v0.1.0 Release Notes](./docs/engineering/v0.1.0-final-release-notes.md)

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
