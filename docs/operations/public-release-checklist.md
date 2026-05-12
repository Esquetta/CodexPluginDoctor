# Public Release Checklist

## Purpose

This checklist records the public release state for `Codex Plugin Doctor` without requiring a separate website.

## Current Position

- Repository: public
- License: MIT
- Distribution preference: npm package plus GitHub repository and GitHub Releases
- npm latest: codex-plugin-doctor@1.0.0
- npm next: codex-plugin-doctor@1.0.0-rc.2
- GitHub Releases: matching `vX.Y.Z` releases are published for public versions
- Website: not required for the stable 1.0 release; the GitHub README remains the primary landing page
- Current release lane: `1.0.0` stable release verification

## Completed Public Baseline

- [x] Add MIT license.
- [x] Add `CONTRIBUTING.md`.
- [x] Add `SECURITY.md`.
- [x] Add GitHub issue templates.
- [x] Add GitHub Sponsors funding config.
- [x] Polish README as the primary landing page.
- [x] Make the repository public.
- [x] Publish to npm.
- [x] Publish matching GitHub Releases.
- [x] Verify public npm install and CLI smoke checks.
- [x] Add GitHub Action workflow integration.
- [x] Add machine-readable JSON, Markdown, and SARIF report artifacts.
- [x] Add output contract and rule catalog freeze metadata.
- [x] Add validation corpus and package preinstall scan surfaces.

## 1.0 Readiness Checklist

Use [v1.0 Readiness Checklist](../engineering/v1.0-readiness-checklist.md) as the stable release gate.

Before stable `1.0.0` publication:

- [ ] Confirm no stale pre-public or RC-only release language remains in README or operations docs.
- [ ] Confirm `doctor contract --json` exposes the expected stable-through-1.0 contract.
- [ ] Confirm `doctor corpus` passes locally.
- [ ] Confirm registry install smoke checks pass.
- [ ] Confirm GitHub Action artifact docs match `action.yml`.
- [ ] Confirm no new feature work is bundled into stable 1.0 unless it fixes a blocker.

## GitHub Metadata

Recommended description:

```text
Local CLI validator for Codex plugin packages, skills, and MCP server bundles.
```

Recommended topics:

```text
cli, codex, developer-tooling, mcp, mcp-server, openai, plugin, skills, typescript, validation
```

## Release Steps

1. Run `npm run release-check`.
2. Run smoke checks:

```bash
codex-plugin-doctor self-test
codex-plugin-doctor doctor corpus
codex-plugin-doctor check examples/codex-doctor-runtime --runtime --no-animations
```

Run the package scanner against a real published Codex plugin package when one is available. If using `codex-plugin-doctor` itself as a smoke target, expect a non-plugin `plugin.manifest.missing` failure because the CLI package is not a plugin package.

3. Update `CHANGELOG.md`.
4. Bump `package.json` and `package-lock.json`.
5. Commit and push.
6. Verify GitHub Actions on `main`.
7. Tag `vX.Y.Z`.
8. Create the GitHub Release.
9. Publish to npm with `npm publish --access public` for stable releases or `npm publish --access public --tag next` for release candidates.
10. Run `npm run verify-release-sync` for stable releases or `npm run verify-release-sync -- --dist-tag next --prerelease` for release candidates.

## Public Conversion Notes

Completed public conversion checks:

- public repository metadata verified
- public `git ls-remote` verified
- release asset download URL verified
- clean public clone verified
- registry install and CLI shim verified
- runtime PASS and risky-fixture expected FAIL smoke checks verified

## Notes

The remaining absolute Windows path references are synthetic test snapshot paths under `tests/`; public-facing docs use placeholders such as `<repo>` and `<codex-home>`.
