# Contributing

Codex Plugin Doctor is still pre-release. Contributions should keep the CLI reliable, deterministic, and easy to verify locally.

## Development Setup

```bash
npm install
npm test
npm run build
```

## Before Opening a PR

Run the release preparation command:

```bash
npm run prepare-release
```

This runs tests, builds the TypeScript output, and checks the npm package contents with a dry run.

## Contribution Guidelines

- Keep machine-readable output deterministic.
- Keep interactive terminal rendering on `stderr`.
- Add fixture coverage for new validator behavior.
- Prefer narrow rules with clear finding IDs over broad heuristics.
- Document real-world validation decisions under `validation-sessions/` when tuning heuristics.

## Commit Style

Use short conventional-style commit prefixes where practical:

- `feat:`
- `fix:`
- `docs:`
- `chore:`
- `test:`
