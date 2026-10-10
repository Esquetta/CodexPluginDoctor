# MCP Discovery

`doctor discover` sends one bounded `server/discover` request to an explicitly
selected HTTP endpoint using the MCP `2026-07-28` discovery contract. It is a
separate diagnostic; it does not change the existing runtime probe.

```bash
codex-plugin-doctor doctor discover https://mcp.example.com/mcp --allow-network
codex-plugin-doctor doctor discover https://mcp.example.com/mcp --allow-network --json
codex-plugin-doctor doctor discover http://localhost:3000/mcp --allow-network --allow-local-network
codex-plugin-doctor doctor discover --help
```

## Consent and bounds

`--allow-network` is mandatory. Loopback access additionally
requires `--allow-local-network`. Other private and reserved addresses remain blocked. Public endpoints must use HTTPS; HTTP is allowed
only for `localhost`. Credentials, query parameters, fragments, and IP-literal
URLs are rejected. Existing DNS resolution and peer-address checks apply.

There is one POST request, bounded to three seconds and 1 MiB of response data.
JSON and SSE response envelopes are supported. No redirect, retry, version
fallback, `initialize`, tool invocation, OAuth discovery, or session deletion is
performed. Local stdio processes are not started. Do not use the existing runtime,
sandbox, or session-lifecycle flags with this command.

## Bearer token authentication

```bash
MCP_TOKEN=... codex-plugin-doctor doctor discover https://mcp.example.com/mcp --allow-network --bearer-token-env MCP_TOKEN
```

`--bearer-token-env <NAME>` reads an existing bearer token from the named
environment variable and sends it as `Authorization: Bearer`. The token itself is
never accepted as an argument, printed, or included in reports. It is sent only
over HTTPS, or to a loopback endpoint approved with `--allow-local-network`;
otherwise the request is not made and the result is `blocked` with
`plugin.discovery.credentials.insecure_transport`. An invalid variable name, an
unset or empty variable, or a value that is not a valid bearer token (RFC 6750
syntax, at most 4096 characters) exits `2` before any request. A `401` or `403`
response is reported as `plugin.discovery.authorization.required` without a token
and `plugin.discovery.authorization.rejected` with one. OAuth flows, token refresh,
and other authentication schemes are not supported.

## What the result means

| Status | Exit code | Meaning |
| --- | --- | --- |
| `discovered` | 0 | A discovery response passed the implemented structural checks and advertises the requested version. |
| `unsupported` | 1 | Discovery or the requested protocol is unsupported, or authentication is required before it can be assessed. Consult the finding. |
| `blocked` | 2 | Consent, URL, or network policy prevented discovery. |
| `failed` | 2 | The bounded request failed or the response could not be validated. |

Invalid CLI arguments also return 2 before issuing a request. A method-not-found
response does not establish whether a server is legacy or broken; this diagnostic
makes no follow-up request. Authentication-required responses likewise do not
establish protocol support. Timeouts are transport failures, not proof that a
server violates MCP.

The standalone JSON report contains `schemaVersion: 1`, `requestedVersion`,
`scope: "discovery-only"`, `status`, `supportedVersions`, `findings`, and `coverage`.
`coverage.discovery` is `pass`, `fail`, or `skipped`; `coverage.runtime` is always
`not-tested`. Capture JSON from stdout when a file is needed. The command does not
accept `--output` or other package-check report formats.

Advertised versions are self-reported. A discovered result does **not** establish
full MCP conformance, tool execution, authorization correctness, or compatibility
with Codex or another client. The existing `check --runtime` retains its
2025-11-25 baseline; this command does not upgrade that baseline.

Reports deliberately exclude URLs, server identity, instructions, capability
payloads, and raw remote error text. Only validated protocol-version strings and
locally authored findings are returned.

## References

- [MCP discovery contract](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)
- [Versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)
