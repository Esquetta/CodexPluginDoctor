# Codex Plugin Doctor

[![CI](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml/badge.svg)](https://github.com/Esquetta/CodexPluginDoctor/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/codex-plugin-doctor.svg)](https://www.npmjs.com/package/codex-plugin-doctor)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Esquetta/CodexPluginDoctor)](https://github.com/Esquetta/CodexPluginDoctor/releases)

A CLI that checks Codex plugins, skills, and MCP servers before you ship them: the
package, its security, and, if you allow it, the running MCP server.

```bash
npx codex-plugin-doctor check path/to/plugin
```

Point it at a folder with `.codex-plugin/plugin.json`. A plugin with an API key in its
`.mcp.json` exits with status 1 and this report (recommended commands trimmed):

```text
Codex Plugin Doctor
===================
Status: FAIL
Target: /path/to/plugin
Summary: 1 fail, 0 warn, 1 total

Failures
--------
✖ plugin.security.hard_coded_secret
  Message: The MCP server `dangerServer` contains a hard-coded secret-like env value for `OPENAI_API_KEY`.
  Impact: Hard-coded credentials inside plugin bundles increase leakage risk and make secure rotation difficult.
  Suggested fix: Replace the literal value for `OPENAI_API_KEY` with an environment reference or injected secret outside the package.
  Fingerprint: 21da7c75027f0811929d49253412a0f20694d974f141d0421410c89ee29c8b72
  Evidence: serverName=dangerServer, configPath=.mcp.json, envKey=OPENAI_API_KEY, envValue=[REDACTED]
```

Add `--runtime` to also start the plugin's MCP servers and call them. That runs the
package's own code, so it is opt-in, and `--sandbox docker` isolates local Node.js stdio
servers. No plugin at hand? `npx codex-plugin-doctor check --installed` checks the ones
in your Codex plugin cache.

## What It Checks

- **Package:** `.codex-plugin/plugin.json`, skill wiring and `SKILL.md` metadata, `.mcp.json`
  structure, description quality, hard-coded secrets, and paths that escape the package.
- **Security** (`security .`): a scorecard for shell wrappers, encoded commands, remote content
  piped into a shell, and plain HTTP transports.
- **Running servers** (`--runtime`): the MCP handshake, then tools, resources, prompts, and
  pagination, with a scorecard and a conformance report.
- **Breaking changes:** [MCP snapshots](./docs/guides/mcp-snapshot.md) compare tools, prompts,
  and resource templates with a committed baseline, in a pull request comment and in release
  notes.
- **Other clients** (`compat . --all --scorecard`): whether the MCP config is valid and can be
  added to Claude Desktop, Cursor, Cline, and Windsurf on this machine.
- **Remote servers and publishing:** opt-in
  [Remote MCP Readiness](./docs/architecture/remote-mcp-readiness.md),
  [MCP Registry Readiness](./docs/architecture/mcp-registry-readiness.md), and an offline
  [public directory preflight](./docs/architecture/public-directory-submission-preflight.md).

See the [CLI Reference](./docs/guides/cli-reference.md) for more commands and examples,
`codex-plugin-doctor --help` for all of them, and `codex-plugin-doctor explain <finding-id>` for
what a rule means.

## Install

```bash
npm install -g codex-plugin-doctor
codex-plugin-doctor self-test
codex-plugin-doctor check .
codex-plugin-doctor check . --runtime
codex-plugin-doctor mcp path/to/mcp-package
```

## GitHub Action

```yaml
name: Validate Codex plugin

on:
  pull_request:

permissions:
  contents: read

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: Esquetta/CodexPluginDoctor@v1.92.0
        with:
          version: "1.92.0"
          path: .
          runtime: "true"
          policy: codex-publish
```

`runtime: "true"` runs the package's code, so this job keeps a read-only token.
`codex-plugin-doctor init-ci .` writes a workflow for you. See
[GitHub Action Usage](./docs/guides/github-action.md) for reports, pull request comments, and
inputs.

## Documentation

- [CLI Reference](./docs/guides/cli-reference.md)
- [GitHub Action Usage](./docs/guides/github-action.md)
- [MCP Snapshot](./docs/guides/mcp-snapshot.md)
- [Release Gating](./docs/guides/release-gating.md)
- [Rule Catalog](./docs/rules/catalog.md)
- [Official Plugin Components](./docs/architecture/official-plugin-components.md)
- [Real-World Validation](./docs/guides/real-world-validation.md)
- [Examples](./examples/README.md)
- [Changelog](./CHANGELOG.md)
- [All documentation](./docs/README.md)

## 1.0 Stability

The 1.0 line is the stable compatibility baseline for plugin authors and CI consumers.

- Public JSON schema surfaces and existing rule IDs/default severities are treated as stable through 1.0.
- Runtime probing remains opt-in because it executes package-local MCP servers.
- New features stay additive unless a major version says otherwise.

See the [documentation index](./docs/README.md) for architecture, usage, security, and contributor guides.

## Contributing

Contributions are welcome. Start with [Contributing](./CONTRIBUTING.md), the
[Security Policy](./SECURITY.md), the [Code of Conduct](./CODE_OF_CONDUCT.md), and the
[validation tuning issue template](./.github/ISSUE_TEMPLATE/validation_tuning.yml).
`npm run release-check` runs the release preflight; see
[Versioning and Releases](./docs/contributing/releasing.md).

## Support

If this tool saves you time, GitHub stars and sponsorship help signal that the project is worth continuing.

- Star the repository on GitHub.
- Use GitHub Sponsors through the repository funding link.
- Open validation tuning issues for false positives or false negatives.
