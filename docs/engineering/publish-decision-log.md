# Publish Decision Log

## Current Decision

As of `2026-04-28`, the project remains in GitHub-first release mode.

## Why

- the validator is still rapidly expanding its runtime surface
- local testing and GitHub Releases are the immediate distribution path
- public npm publication should follow a short stabilization window
- GitHub repository visibility is public before npm publication

## What Is Already Ready

- clean build pipeline
- pack dry run
- package metadata
- CLI entrypoint
- changelog
- release checklist
- MIT license
- open-source contribution and security docs
- GitHub issue templates
- GitHub Sponsors funding config
- final `v0.1.0` release notes
- final `v0.1.0` GitHub Release
- obsolete `v0.1.0-rc.1` draft release removed, with the RC tag retained for history
- public repository visibility
- clean public clone, install, build, and CLI smoke validation

## What Must Be Confirmed Before npm Publish

- desired npm visibility and ownership
- whether `v0.1.0` should stay GitHub-only or also publish to npm

## Next Publish Decision Point

Revisit public npm publish after the first GitHub-only `v0.1.0` release has been reviewed.
