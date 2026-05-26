# Public Release Checklist

## Purpose

This checklist records the public release state for `Codex Plugin Doctor` without requiring a separate website.

## Current Position

- Repository: public
- License: MIT
- Distribution preference: npm package plus GitHub repository and GitHub Releases
- npm latest: codex-plugin-doctor@1.5.0
- npm next: codex-plugin-doctor@1.0.0-rc.2
- GitHub Releases: matching `vX.Y.Z` releases are published for public versions
- Website: not required for the stable 1.0 release; the GitHub README remains the primary landing page
- Current release lane: `1.5.0` stable minor release verification

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

## 1.5.0 Minor Release Checklist

Use [v1.0 Readiness Checklist](../engineering/v1.0-readiness-checklist.md) for baseline 1.0 compatibility and [Versioning and Releases](../engineering/versioning-and-releases.md) as the stable patch release gate.

Before stable `1.5.0` publication:

- [ ] Confirm no stale RC-only release language remains in README or operations docs.
- [ ] Confirm `doctor corpus` passes locally.
- [ ] Confirm signed attestation smoke passes with `--sign-key-env`.
- [ ] Confirm signed attestation verification passes with `doctor attest verify`.
- [ ] Confirm `doctor release-evidence` passes with strict git release gates after tagging.
- [ ] Confirm `doctor release-evidence asset` uploads the signed evidence file to the GitHub Release.
- [ ] Confirm `doctor release-evidence verify` validates the uploaded evidence against an explicit target path.
- [ ] Confirm `doctor runtime-plan` generates a stable approval digest without starting MCP servers.
- [ ] Confirm runtime approval gates refuse mismatched digests before `--runtime` probes start.
- [ ] Confirm `doctor perf` threshold gates can fail and pass deterministically.
- [ ] Confirm `doctor mcp` stays static and does not execute local MCP servers.
- [ ] Confirm registry install smoke checks pass.
- [ ] Confirm GitHub Action artifact docs match `action.yml`.
- [ ] Confirm additive report fields do not break stable 1.0 consumers.

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
