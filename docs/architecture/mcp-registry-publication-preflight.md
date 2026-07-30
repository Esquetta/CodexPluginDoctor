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

The first release supports exactly one npm-backed Registry package declaration.
Multiple npm declarations fail preflight because one adjacent `package.json`
cannot prove ownership for multiple packages. Local Registry metadata containing
another package type or only a remote transport continues to receive the
existing readiness checks, but the package publication stage is reported as
skipped. This prevents the command from claiming evidence it did not collect.

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
3. Compare its package name, version, and `mcpName`, and require a syntactically
   valid `dist.integrity` value as published metadata evidence.
4. Query the fixed official MCP Registry for the exact server name and version.
5. If the exact version returns a valid not-found response, query the fixed
   `latest` endpoint for the same exact server name.
6. Classify the version as available for first publication only when both the
   exact version and latest record are valid not-found responses, as a new
   immutable version when latest returns the same server name, or as already
   published when the exact version returns matching metadata.

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
package must be publicly available before publication. The presence of
`dist.integrity` proves only that npm returned package integrity metadata; the
preflight does not download the tarball or independently verify its contents.

## Report Contract

`codex-plugin-doctor doctor contract --json` publishes this stable surface as
`doctor.registry.preflight.json`. The JSON report uses:

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
publisherPlan:
  executable: false
  steps: ordered non-executing steps with order, command, and purpose
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
completed successfully and the response shape is valid. An exact-version
not-found response is followed by a latest-version lookup so the command can
distinguish a new server from a new immutable version. Other request failures
produce `unknown`; they are not treated as proof that a name or version is
available.

## Verification Strategy

Tests must prove:

- offline preflight performs zero HTTP requests
- local npm name, `mcpName`, and version mismatches fail
- multiple npm declarations fail before network access
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
- claim that npm integrity metadata proves the downloaded artifact contents
- execute lifecycle scripts or MCP servers
- support private or user-configured registry hosts
- prove namespace ownership independently of the official publisher
- replace post-publication inspection
- add GitHub Action inputs in the first release
