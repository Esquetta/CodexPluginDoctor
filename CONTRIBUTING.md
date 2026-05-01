# Contributing to Codex Plugin Doctor

Thank you for helping improve Codex Plugin Doctor.

This project is a CLI-first validator for Codex plugin packages, skills, and MCP server bundles. Contributions should keep the tool deterministic, local-first, and safe by default.

## Development Setup

```bash
npm install
npm test
npm run build
```

For local CLI testing:

```bash
codex-plugin-doctor compat examples/codex-doctor-runtime --scorecard
node dist/cli.js check examples/codex-doctor-runtime --runtime --no-animations
node dist/cli.js compat examples/codex-doctor-runtime --scorecard
node dist/cli.js compat examples/codex-doctor-runtime --client claude-desktop --install-preview
node dist/cli.js compat examples/codex-doctor-runtime --client cursor --install-preview
```

## Contribution Guidelines

- Use fixture-based tests for new validation behavior.
- Keep install and apply flows non-mutating unless the command explicitly says it writes files.
- Prefer clear findings with stable IDs, impact, and suggested fixes.
- Do not add network calls to validation paths unless the command explicitly opts into them.
- Do not commit generated `dist/`, local npm tarballs, local config files, or secret-bearing fixtures.

## Pull Request Checklist

- Run `npm test`.
- Run `npm run build`.
- Add or update docs when user-facing behavior changes.
- Add release-note or changelog entries for shipped features.
- Include smoke command output for new CLI surfaces.

## Release Notes

Release notes live under `docs/engineering/`. Changelog entries live in `CHANGELOG.md`.

Publishing to npm is a human-gated step because the registry may require one-time password or browser authentication.
