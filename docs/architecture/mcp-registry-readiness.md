# MCP Registry Readiness

## Purpose

The Registry Doctor validates whether MCP `server.json` metadata is structurally consistent, safe to consume, and useful for installation before publication. It also supports a bounded read-only lookup of an exact server name in the official MCP Registry.

This is a metadata readiness check. A passing Registry record does not prove that the referenced code or remote server is trustworthy, available, or safe to execute.

## Commands

Validate a local file or a directory containing `server.json`:

```bash
codex-plugin-doctor registry check ./server.json
codex-plugin-doctor registry check . --json
codex-plugin-doctor registry check . --require-registry-readiness
```

Inspect the latest published record for an exact server name:

```bash
codex-plugin-doctor registry inspect io.github.example/weather --allow-network
```

`registry check` never uses the network. `registry inspect` fails before making a request unless `--allow-network` is explicit.

## Scorecard

The report keeps these dimensions separate:

- metadata: required schema, name, description, and exact version shape
- ownership: local npm `mcpName` and GitHub namespace/repository consistency
- package integrity: exact versions, MCPB SHA-256, transport shape, and embedded secret checks
- transport readiness: declared package and remote transport validity
- client installability: whether a safe Codex configuration preview can be derived

The official Registry permits metadata-only records without `packages` or `remotes`. Those records remain valid but receive a warning because no installation channel can be derived. The default command exits successfully for warning-only reports; `--require-registry-readiness` turns any non-pass result into a blocking exit.

## Installation Preview

The JSON report may contain a `codexPreview` for:

- an exact-version npm package using `stdio`
- a fixed HTTPS remote URL without template variables

The preview is informational. The command never edits Codex configuration, downloads packages, starts a process, or contacts an advertised remote endpoint.

## Network Boundary

Registry inspection:

- sends one unauthenticated `GET` to the fixed official Registry host
- percent-encodes the exact server name
- uses the versioned `/v0.1` latest-version endpoint
- applies the shared timeout, response-size, DNS, peer, redirect, and SSRF controls
- does not follow package, icon, repository, website, or remote MCP URLs
- does not authenticate, publish, update, deprecate, or delete Registry data

The Registry is currently a preview service. Historical active records may reference an older official schema; they are reported as warnings rather than treated as malformed. New local publication metadata should use the current official schema.

## Security Findings

The readiness report fails on:

- URL-embedded credentials
- literal secret values in secret-like inputs
- mismatched `io.github` namespace and GitHub repository owner
- mismatched local npm `mcpName` or package version
- range or `latest` package versions
- MCPB packages without a valid lowercase SHA-256 digest
- invalid package or remote transport declarations

Variable templates such as `Bearer {api_key}` are not treated as literal embedded secrets.

## Non-Goals

Registry Doctor does not:

- prove namespace ownership independently of Registry publication
- download or inspect package artifacts
- validate an MCPB file against its declared hash
- execute generated installation commands
- probe advertised MCP endpoints
- claim that a listed server is secure or endorsed
- publish metadata to the Registry
