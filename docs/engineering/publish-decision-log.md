# Publish Decision Log

## Current Decision

As of `2026-05-12`, the project is public on GitHub and npm, with `codex-plugin-doctor@1.0.0` serving as the stable 1.0 release target and `codex-plugin-doctor@1.0.0-rc.2` retained as the final release candidate under the npm `next` tag.

The current publish decision is to promote the validated release-candidate line to stable `1.0.0` and move npm `latest` after the stable release gates pass.

## Why

- the CLI now has the core validation, runtime, security, trust, compatibility, and CI reporting surfaces needed for a stable release
- `doctor contract` exposes the machine-readable contract and rule catalog freeze metadata for the 1.0 path
- GitHub Action artifacts, step summaries, and policy presets make the tool usable as a repository release gate
- the remaining 1.0 release work is evidence quality, docs accuracy, and smoke verification rather than new product scope

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
- npm latest is the stable publication target for `codex-plugin-doctor@1.0.0`
- release sync is verified with `npm run verify-release-sync` after stable publication
- GitHub Actions runs on `main`
- public-facing docs identify the 1.0 stable compatibility baseline

## Next Publish Decision Point

Publish stable `1.0.0` after the [v1.0 Readiness Checklist](v1.0-readiness-checklist.md), release-check, GitHub Actions, registry install smoke, and release sync gates pass.

Do not add new feature work during stable release prep unless the checklist exposes a release blocker.

## Stable Release Decision

Publish `1.0.0` after:

- `1.0.0-rc.2` install smoke passes
- GitHub Action artifact smoke passes
- no contract corrections are needed
- release notes explicitly state compatibility and known limitations
