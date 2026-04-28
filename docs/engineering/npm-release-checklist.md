# NPM Release Checklist

## Purpose

Prepare Codex Plugin Doctor for a clean npm release without actually publishing from CI by default.

## Current Package Readiness

The package now includes:

- `main` and `types` entrypoints
- `exports` map for library consumers
- `bin` entrypoint for the CLI
- `prepublishOnly` validation guard
- repository, bugs, and homepage metadata
- `prepare-release` script for local release dry runs

## Release Steps

1. Run `npm test`.
2. Run `npm run build`.
3. Run `npm run prepare-release`.
4. Review the `npm pack --dry-run` file list.
5. Confirm MIT license for public distribution.
6. Confirm package version bump.
7. Publish with `npm publish --access public`.

## Pre-Publish Checks

- verify README is current
- verify `dist/` output is generated correctly
- verify CLI smoke checks on built files
- verify package name availability on npm if planning a public release

## Notes

The repository uses the MIT license. Public npm publication is still a separate maintainer decision.
