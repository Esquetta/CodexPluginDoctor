# Publish Decision Log

## Current Decision

As of `2026-05-11`, the project is public on GitHub and npm, with `codex-plugin-doctor@0.21.0` serving as the 1.0 readiness cleanup release.

The next publish decision is `1.0.0-rc.1`, not another feature-heavy `0.x` release.

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
- post-publish sync can be verified with `npm run verify-release-sync`
- GitHub Actions runs on `main`
- public-facing docs identify the 1.0 readiness lane

## Next Publish Decision Point

Publish `1.0.0-rc.1` with the npm `next` tag after the [v1.0 Readiness Checklist](v1.0-readiness-checklist.md) passes.

Do not add new feature work during RC prep unless the checklist exposes a release blocker.

## Stable Release Decision

Publish `1.0.0` only after:

- `1.0.0-rc.1` install smoke passes
- GitHub Action artifact smoke passes
- no contract corrections are needed
- no blocker user feedback appears during the RC window
- release notes explicitly state compatibility and known limitations
