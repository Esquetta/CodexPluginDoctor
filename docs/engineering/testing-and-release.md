# Testing and Release

## Quality Philosophy

This product only earns trust if its own validation behavior is stable, reproducible, and well-tested. Testing is therefore part of the product, not just the engineering process behind it.

## Test Pyramid

### Unit Tests

- manifest parsing
- path normalization
- rule evaluation logic
- severity and score calculations

### Fixture-Based Integration Tests

- valid plugin package
- missing manifest fields
- broken skill references
- malformed MCP config
- context-bloated tool schemas

### Runtime Probe Tests

- successful stdio startup
- startup timeout
- server crash on boot
- invalid `tools/list` response

## Golden Fixtures

Maintain a curated set of package fixtures under source control with:

- expected findings
- expected score bands
- expected exit codes

This protects report stability as rules evolve.

## CI Expectations

Every change should run:

- lint
- typecheck
- unit tests
- fixture integration tests
- selected runtime probe tests

## Release Process

1. Merge into the release branch.
2. Run the full validation suite.
3. Build distributable CLI artifacts.
4. Publish package version.
5. Publish release notes with rule changes and breaking behavior.
6. Run the release sync gate for the lane: `npm run verify-release-sync` for stable releases, or `npm run verify-release-sync -- --dist-tag next --prerelease` for release candidates.

## Versioning Policy

Use semantic versioning.

- patch: bug fixes and non-breaking rule improvements
- minor: new rules and new output fields
- major: output contract changes or rule semantics that may break CI assumptions

## Documentation Standards

- every rule has a documented identifier
- every CLI flag has at least one example
- every release notes document highlights new blocking rules
