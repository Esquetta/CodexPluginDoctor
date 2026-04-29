# NPM Release Checklist

## Purpose

Prepare Codex Plugin Doctor for clean npm releases without publishing from CI by default.

## Current Package Readiness

The package now includes:

- `main` and `types` entrypoints
- `exports` map for library consumers
- `bin` entrypoint for the CLI
- `prepublishOnly` validation guard
- repository, bugs, and homepage metadata
- `prepare-release` script for local release dry runs
- normalized `bin` entrypoint for npm publication

## Release Steps

1. Run `npm test`.
2. Run `npm run build`.
3. Run `npm run prepare-release`.
4. Review the `npm pack --dry-run` file list.
5. Confirm MIT license for public distribution.
6. Confirm package version bump.
7. Publish with `npm publish --access public`.
8. Verify `npm view codex-plugin-doctor version`.
9. Verify a global-style install from npm.

## Pre-Publish Checks

- verify README is current
- verify `dist/` output is generated correctly
- verify CLI smoke checks on built files
- verify package name availability on npm for first publication
- verify `npm publish --dry-run --access public` has no package metadata corrections

## Notes

The repository uses the MIT license. First npm publication is targeted for `0.1.1` because `v0.1.0` was already published on GitHub before the npm `bin` metadata normalization.
