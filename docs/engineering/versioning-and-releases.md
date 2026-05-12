# Versioning and Releases

## Current Recommendation

Use semantic versioning with conservative minor releases until the first stable `1.0.0` release is published.

The `0.21.x` line is the 1.0 readiness lane. It should focus on documentation accuracy, compatibility statements, release-candidate smoke checks, and packaging confidence rather than new feature expansion.

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
- npm latest: `codex-plugin-doctor@0.21.0`
- npm next: `codex-plugin-doctor@1.0.0-rc.1`
- GitHub Release flow uses matching `vX.Y.Z` tags
- post-publish release sync is verified with `npm run verify-release-sync`
- public JSON schema surfaces and existing rule IDs/default severities are stable through `1.0.0`

Current release target:

- `0.21.0` is the readiness cleanup release.
- `1.0.0-rc.1` is the active release-candidate package version.
- `1.0.0` should follow only after the RC smoke checklist passes without blocker changes.

## 1.0 Compatibility Position

The `doctor contract` command is the source of truth for machine-readable output surfaces and the frozen rule catalog digest.

For 1.0:

- Do not rename or remove existing finding IDs.
- Do not change existing default severities without treating it as a breaking decision.
- Do not change JSON report semantics without a schema or major-version decision.
- Keep runtime probing opt-in.
- Keep `check`, `security`, `compat`, `audit`, `mcp`, and `doctor` command families backward-compatible.

## Release Candidate Rules

Use `1.0.0-rc.1` when:

- `npm run release-check` passes.
- GitHub Actions passes on `main`.
- registry install smoke checks pass from a fresh global install.
- `doctor corpus` passes.
- `doctor npm codex-plugin-doctor` passes against the published package.
- GitHub Action artifact examples remain valid.
- npm `next` points to the release candidate and npm `latest` remains on the current stable line.

No new feature work should enter the release-candidate path unless it fixes a blocker discovered by the checklist.

## Release Notes Guidance

Each release should call out:

- new validation surfaces
- new CLI flags
- new report fields
- changed runtime behavior
- any new warning or failure IDs that may affect CI users
- compatibility or contract statements that matter for 1.0 users
