# Publish Decision Log

## Current Decision

As of `2026-05-12`, the project is public on GitHub and npm, with `codex-plugin-doctor@0.21.0` serving as the latest stable release and `codex-plugin-doctor@1.0.0-rc.1` serving as the first 1.0 release candidate.

The current publish decision is to ship `1.0.0-rc.1` with the npm `next` tag, not to move npm `latest` until the stable `1.0.0` release.

## Why

- the CLI now has the core validation, runtime, security, trust, compatibility, and CI reporting surfaces needed for a stable release
- `doctor contract` exposes the machine-readable contract and rule catalog freeze metadata for the 1.0 path
- GitHub Action artifacts, step summaries, and policy presets make the tool usable as a repository release gate
- the remaining work before 1.0 is evidence quality, docs accuracy, and smoke verification rather than new product scope

## What Is Already Ready

- clean build pipeline
- `npm run release-check`
- `npm run verify-release-sync`
- public npm package
- matching GitHub Releases and tags
- MIT license
- open-source contribution and security docs
- GitHub issue templates
- GitHub Sponsors funding config
- README as the primary landing page
- local validation and runtime probe surfaces
- security scorecard and trust score
- compatibility matrix and install-preview flows
- validation corpus
- npm preinstall package scan
- local attestation artifact
- GitHub Action JSON, Markdown, and SARIF artifacts
- output contract and stable-through-1.0 metadata

## What Was Confirmed For The Current Release Line

- repository visibility is public
- npm latest points to `codex-plugin-doctor@0.21.0`
- release-candidate sync can be verified with `npm run verify-release-sync -- --dist-tag next --prerelease`
- GitHub Actions runs on `main`
- public-facing docs identify the 1.0 readiness lane

## Next Publish Decision Point

Publish stable `1.0.0` only after the [v1.0 Readiness Checklist](v1.0-readiness-checklist.md) and release-candidate smoke checks pass without blocker feedback.

Do not add new feature work during RC prep unless the checklist exposes a release blocker.

## Stable Release Decision

Publish `1.0.0` only after:

- `1.0.0-rc.1` install smoke passes
- GitHub Action artifact smoke passes
- no contract corrections are needed
- no blocker user feedback appears during the RC window
- release notes explicitly state compatibility and known limitations
