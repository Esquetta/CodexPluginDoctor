# Public Release Checklist

## Purpose

This checklist prepares `Codex Plugin Doctor` for a GitHub-first public release without requiring a website or immediate npm publication.

## Current Position

- Repository: private
- License: MIT
- Distribution preference: GitHub repository and GitHub Releases first
- GitHub Release: `v0.1.0` published
- Legacy RC draft release: removed; `v0.1.0-rc.1` tag retained for history
- npm publish: deferred
- Website: not needed for `v0.1.0`

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

Decision: create a new final `v0.1.0` GitHub Release, remove the old RC draft release, retain the RC tag for history, and leave public npm publishing deferred.

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

Do not make the repository public from automation unless the maintainer explicitly asks for it in that turn.

Once public:

- confirm README badge renders
- confirm issue templates render
- confirm funding link appears
- confirm release notes are visible
- confirm no generated local artifacts are exposed

## Notes

The remaining absolute Windows path references are synthetic test snapshot paths under `tests/`; public-facing docs use placeholders such as `<repo>` and `<codex-home>`.
