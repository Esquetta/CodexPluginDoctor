# Public Release Checklist

## Purpose

This checklist records the public release state for `Codex Plugin Doctor` without requiring a separate website.

## Current Position

- Repository: public
- License: MIT
- Distribution preference: npm package plus GitHub repository and GitHub Releases
- GitHub Release: `v0.1.1` published
- Legacy RC draft release: removed; `v0.1.0-rc.1` tag retained for history
- npm publish: `codex-plugin-doctor@0.1.1`
- Website: not needed for `v0.1.x`

## Before Making The Repository Public

- [x] Add MIT license.
- [x] Add `CONTRIBUTING.md`.
- [x] Add `SECURITY.md`.
- [x] Add GitHub issue templates.
- [x] Add GitHub Sponsors funding config.
- [x] Polish README as the primary landing page.
- [x] Add final `v0.1.0` release notes.
- [x] Verify `npm run prepare-release`.
- [x] Confirm no private notes, secrets, or local-only paths are present in public-facing docs.
- [x] Confirm GitHub repo description and topics.
- [x] Decide whether to publish the existing draft prerelease or create a new final release.
- [x] Remove obsolete `v0.1.0-rc.1` draft prerelease after final release.
- [x] Make the repository public.
- [x] Verify public clone, install, build, and CLI smoke checks.
- [x] Publish `codex-plugin-doctor@0.1.1` to npm.
- [x] Verify npm registry install and CLI smoke checks.
- [x] Publish `v0.1.1` GitHub Release.

Decision: create a new final `v0.1.0` GitHub Release, remove the old RC draft release, retain the RC tag for history, and leave public npm publishing deferred.

Follow-up decision: publish `0.1.1` to npm after normalizing package `bin` metadata, then use npm install feedback to choose between `0.1.2` hardening and `0.2.0` capability work.

## GitHub Metadata

Recommended description:

```text
Local CLI validator for Codex plugin packages, skills, and MCP server bundles.
```

Recommended topics:

```text
cli, codex, developer-tooling, mcp, mcp-server, openai, plugin, skills, typescript, validation
```

## Final Release Steps

1. Run `npm run prepare-release`.
2. Run README smoke checks:

```bash
node dist/cli.js check examples/codex-doctor-runtime --runtime --no-animations
node dist/cli.js check examples/codex-doctor-risky --ascii --no-animations
```

3. Update `CHANGELOG.md` to the final release date.
4. Bump `package.json` to `0.1.0` if creating the final tag.
5. Commit the final release prep.
6. Tag `v0.1.0`.
7. Create a GitHub release using `docs/engineering/v0.1.0-final-release-notes.md`.
8. Leave npm publish deferred unless explicitly approved.

## Public Conversion Notes

Completed public conversion checks:

- public repository metadata verified
- public `git ls-remote` verified
- release asset download URL verified
- clean public clone verified
- `npm install` and `npm run build` verified from the clean clone
- runtime PASS and risky-fixture expected FAIL smoke checks verified from the clean clone

## NPM Publication Notes

- `npm view codex-plugin-doctor version` verified `0.1.1`.
- `npm install` from the registry created the CLI shim.
- registry-installed CLI runtime smoke returned PASS against `examples/codex-doctor-runtime`.

## Notes

The remaining absolute Windows path references are synthetic test snapshot paths under `tests/`; public-facing docs use placeholders such as `<repo>` and `<codex-home>`.
