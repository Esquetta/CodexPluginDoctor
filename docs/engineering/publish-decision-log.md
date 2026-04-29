# Publish Decision Log

## Current Decision

As of `2026-04-29`, the project is public on GitHub and npm.

## Why

- the validator is still rapidly expanding its runtime surface
- local testing, GitHub Releases, and npm are the immediate distribution paths
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
- `codex-plugin-doctor@0.1.1` published on npm
- `v0.1.1` GitHub Release
- post-publish registry install smoke validation

## What Was Confirmed For npm Publish

- final `0.1.1` release validation passed
- post-publish install smoke from the npm registry passed
- npm `latest` points to `0.1.1`

## Next Publish Decision Point

After `0.1.1` is published, use npm install telemetry/issues and validation feedback to decide whether the next release should be `0.1.2` patch hardening or a larger `0.2.0` capability release.
