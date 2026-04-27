# Publish Decision Log

## Current Decision

As of `2026-04-27`, the project remains in local-first validation mode.

## Why

- the validator is still rapidly expanding its runtime surface
- local testing and iteration are the immediate priority
- public npm publication should follow a short stabilization window
- GitHub repository visibility can move to public before npm publication

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
- final `v0.1.0` release notes draft

## What Must Be Confirmed Before Public Publish

- package naming strategy
- desired npm visibility and ownership
- whether `v0.1.0` should stay GitHub-only or also publish to npm
- whether the current private draft prerelease should be replaced by a final public release

## Next Publish Decision Point

Revisit public npm publish after the repository is public and the first GitHub-only `v0.1.0` release has been reviewed.
