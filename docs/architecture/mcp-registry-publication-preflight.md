# MCP Registry Publication Preflight

## Purpose

Publication Preflight determines whether an MCP server is ready for the official
Registry publication sequence before a maintainer invokes `mcp-publisher`.
It combines local metadata validation with optional, bounded checks against the
public npm and MCP registries.

The preflight is advisory and read-only. It does not authenticate, publish,
update, deprecate, or delete Registry records.

## Command

Run the offline checks:

```bash
codex-plugin-doctor registry preflight ./server.json
```

Add published-package and Registry version checks:

```bash
codex-plugin-doctor registry preflight . --allow-network
```

Require a fully publish-ready result in automation:

```bash
codex-plugin-doctor registry preflight . \
  --allow-network \
  --require-publish-ready \
  --json \
  --output registry-publication-preflight.json
```

`--allow-network` is explicit consent for the bounded public metadata requests
described below. It does not grant permission to execute package scripts, start
an MCP server, download a package tarball, or invoke the publisher.

## Scope

The first release supports npm-backed Registry package declarations. Local
Registry metadata containing another package type or only a remote transport
continues to receive the existing readiness checks, but the package publication
stage is reported as skipped. This prevents the command from claiming evidence
it did not collect.

The command accepts either a `server.json` path or a directory containing that
file. An adjacent `package.json` is used only for local npm ownership and version
checks.

## Data Flow

### Offline phase

1. Resolve `server.json` within the requested package root.
2. Run the existing Registry readiness validator.
3. Compare each npm declaration with the adjacent `package.json`.
4. Produce a deterministic, non-executing publisher plan.
5. Return a partial preflight report without making a network request.

The local checks require:

- `package.json#mcpName` to match `server.json#name`
- the local package version and exact Registry package version to match
- the npm package identifier to match `package.json#name`
- existing metadata, ownership, package integrity, transport, and secret checks
  to pass

### Network phase

When `--allow-network` is present, the command performs bounded metadata-only
requests:

1. Query the fixed public npm Registry for the declared package.
2. Select the exact version declared in `server.json`.
3. Compare its package name, version, `mcpName`, and `dist.integrity` metadata.
4. Query the fixed official MCP Registry for the exact server name and version.
5. Classify the version as available for first publication, available as a new
   immutable version, or already published.

The command does not accept alternate Registry base URLs in this release.
Restricting requests to fixed public hosts keeps the network boundary reviewable
and avoids turning a metadata check into an arbitrary URL fetcher.

## Version Availability

The Registry version result has these outcomes:

- `available-first-publication`: the server name is not present
- `available-new-version`: the server exists, but the requested version does not
- `already-published`: the exact immutable version already exists
- `unknown`: the network phase was not approved or reliable evidence was not
  available

`already-published` is blocking because Registry versions are immutable. A
maintainer must increment the version rather than attempting to overwrite it.

An unavailable npm package version is also blocking during the network phase.
The official Registry stores metadata rather than package artifacts, so an npm
package must be publicly available before publication.

## Report Contract

The JSON report uses:

```text
kind: mcp-registry-publication-preflight
schemaVersion: 1.0.0
status: pass | warn | fail
localReadiness: pass | warn | fail
packagePublication: pass | fail | skipped | unknown
registryVersionAvailability:
  available-first-publication |
  available-new-version |
  already-published |
  unknown
publisherPlan: ordered, non-executing steps
findings: stable identifiers, severity, and redacted messages
```

The publisher plan may name required commands and their ordering, but it must not
contain credentials, tokens, absolute local paths, shell interpolation, or a
claim that a command was executed.

Without `--allow-network`, a locally healthy report is `warn` because package
publication and Registry version availability remain unverified. With network
consent, all required npm evidence and version availability must pass for the
overall status to be `pass`.

`--require-publish-ready` returns a blocking exit when the overall status is not
`pass`. Without that flag, only a `fail` result is blocking.

## Network and Security Boundary

All requests use the shared bounded HTTP client and:

- target only `https://registry.npmjs.org` and
  `https://registry.modelcontextprotocol.io`
- percent-encode package and server identifiers
- use unauthenticated `GET` requests
- enforce response-size and timeout limits
- enforce DNS and connected-peer validation
- reject redirects and embedded credentials
- never follow package, tarball, repository, website, icon, or remote MCP URLs

Reports omit response bodies, local absolute paths, npm configuration, headers,
environment values, and authentication material. Error messages identify the
failed stage without retaining untrusted server text.

## Error Handling

Invalid local input returns a usage or validation error before network access.
Network denial, timeout, malformed JSON, oversized responses, and inconsistent
metadata produce stable findings rather than raw stack traces.

A Registry not-found response is evidence only when the bounded request
completed successfully and the response shape is valid. Other request failures
produce `unknown`; they are not treated as proof that a name or version is
available.

## Verification Strategy

Tests must prove:

- offline preflight performs zero HTTP requests
- local npm name, `mcpName`, and version mismatches fail
- missing network consent produces a partial warning, not false readiness
- an exact public npm version with matching metadata passes
- a missing or inconsistent npm version fails
- a missing Registry server is classified as first publication
- an existing server with a different version is classified as a new version
- an existing exact version is blocked as immutable
- malformed, redirected, oversized, or untrusted responses fail safely
- JSON and text reports contain no credentials, response bodies, or absolute
  local paths
- `--require-publish-ready` applies the documented exit-code contract

## Non-Goals

Publication Preflight does not:

- run `mcp-publisher login` or `mcp-publisher publish`
- handle Registry authentication or GitHub OIDC
- publish the npm package
- download or extract npm tarballs
- execute lifecycle scripts or MCP servers
- support private or user-configured registry hosts
- prove namespace ownership independently of the official publisher
- replace post-publication inspection
- add GitHub Action inputs in the first release
