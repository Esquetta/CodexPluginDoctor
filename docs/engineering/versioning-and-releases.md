# Versioning and Releases

## Current Recommendation

Use semantic versioning from the stable `1.0.0` baseline.

The `1.x` line should focus on additive validation surfaces, clearer evidence, and compatibility-preserving report improvements. Breaking report or rule semantics should wait for a documented major-version decision.

## Versioning Rules

### Patch

Use a patch release when:

- fixing false positives or false negatives
- improving transcripts without changing contract shape
- correcting docs or packaging behavior

### Minor

Use a minor release when:

- adding new validation capability
- adding new report fields in backward-compatible ways
- expanding runtime probe coverage
- adding new CLI flags without breaking old ones

### Major

Use a major release when:

- changing report contract semantics
- renaming or removing stable finding IDs
- changing default runtime behavior in a breaking way
- changing CLI invocation patterns incompatibly

## Release Flow

1. Update `CHANGELOG.md`.
2. Bump `package.json` and `package-lock.json`.
3. Run `npm run release-check`.
4. Push `main` and verify GitHub Actions.
5. Create git tag `vX.Y.Z`.
6. Create a GitHub Release using `.github/release-template.md`.
7. Run `npm publish --access public` for stable releases or `npm publish --access public --tag next` for release candidates.
8. Run `npm run verify-release-sync` after stable publication, or `npm run verify-release-sync -- --dist-tag next --prerelease` after release-candidate publication.

## Current Publish Position

The project is publicly distributed through npm and GitHub Releases.

Confirmed:

- license is MIT
- repository visibility is public
- package name remains `codex-plugin-doctor`
- npm latest: `codex-plugin-doctor@1.0.2`
- npm next: `codex-plugin-doctor@1.0.0-rc.2`
- GitHub Release flow uses matching `vX.Y.Z` tags
- post-publish release sync is verified with `npm run verify-release-sync`
- public JSON schema surfaces and existing rule IDs/default severities are stable through `1.0.0`

Current release target:

- `1.0.2` is the stable package version.
- `1.0.0-rc.2` remains the final release-candidate package under the npm `next` tag.
- Post-1.0 releases should stay additive unless the public contract requires a major-version decision.

## 1.0 Compatibility Position

The `doctor contract` command is the source of truth for machine-readable output surfaces and the frozen rule catalog digest.

For 1.0:

- Do not rename or remove existing finding IDs.
- Do not change existing default severities without treating it as a breaking decision.
- Do not change JSON report semantics without a schema or major-version decision.
- Keep runtime probing opt-in.
- Keep `check`, `security`, `compat`, `audit`, `mcp`, and `doctor` command families backward-compatible.

## Stable Release Rules

Use the stable release path when:

- `npm run release-check` passes.
- GitHub Actions passes on `main`.
- registry install smoke checks pass from a fresh global install.
- `doctor corpus` passes.
- `doctor npm codex-plugin-doctor@latest` returns the expected non-plugin package report without crashing or producing malformed JSON.
- GitHub Action artifact examples remain valid.
- npm `latest` points to the stable release.

No new feature work should enter a stable release prep path unless it fixes a blocker discovered by the checklist.

## Release Notes Guidance

Each release should call out:

- new validation surfaces
- new CLI flags
- new report fields
- changed runtime behavior
- any new warning or failure IDs that may affect CI users
- compatibility or contract statements that matter for 1.0 users
