# Versioning and Releases

## Current Recommendation

Use semantic versioning with conservative minor releases while the validator surface is still expanding quickly.

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
2. Bump `package.json` version.
3. Run `npm run prepare-release`.
4. Create git tag `vX.Y.Z`.
5. Create a GitHub release using `.github/release-template.md`.
6. Publish only after license and package visibility decisions are confirmed.

## Current Publish Position

The project is technically ready for npm release dry runs. GitHub-first public release is preferred before npm publication.

Confirmed:

- license is MIT
- package name remains `codex-plugin-doctor`
- release communication has final `v0.1.0` notes
- `v0.1.0` is published as the current GitHub Release
- obsolete `v0.1.0-rc.1` draft release has been removed; the tag remains for history
- repository visibility is public

Still manual:

- deciding whether to publish `v0.1.0` to npm

## Release Notes Guidance

Each release should call out:

- new validation surfaces
- new CLI flags
- new report fields
- changed runtime behavior
- any new warning or failure IDs that may affect CI users
