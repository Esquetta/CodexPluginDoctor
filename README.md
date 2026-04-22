# Codex Plugin Doctor

Codex Plugin Doctor is a CLI-first validator for Codex plugins, skills, and MCP package surfaces.

## Current Scope

This repository currently contains:

- product and engineering documentation in [`docs/`](D:\Workstation\CodexPluginDoctor\docs\README.md)
- an initial TypeScript CLI scaffold
- fixture-based tests for package discovery and manifest validation

## Near-Term Goal

Ship a local command that validates a plugin bundle before release and produces a deterministic PASS/WARN/FAIL report.

## Planned Commands

```bash
codex-plugin-doctor check .
codex-plugin-doctor check . --json
codex-plugin-doctor check . --runtime
```

