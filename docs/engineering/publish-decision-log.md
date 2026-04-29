# Publish Decision Log

## Current Decision

As of `2026-04-29`, the project is moving from GitHub-first release mode to public npm distribution.

## Why

- the validator is still rapidly expanding its runtime surface
- local testing and GitHub Releases are the immediate distribution path
- `v0.1.0` validated the GitHub-first release surface
- `0.1.1` carries the npm `bin` metadata normalization needed for safe registry publication

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
- npm package name availability
- npm authenticated maintainer session

## What Must Be Confirmed Before npm Publish

- final `0.1.1` release validation
- post-publish install smoke from the npm registry

## Next Publish Decision Point

After `0.1.1` is published, use npm install telemetry/issues and validation feedback to decide whether the next release should be `0.1.2` patch hardening or a larger `0.2.0` capability release.
