# Remote MCP Readiness

## Purpose

Codex Plugin Doctor can make bounded, read-only checks against a remote MCP endpoint. This is an opt-in readiness check, not a general remote MCP client.

## Explicit Consent

Remote requests require `--runtime --allow-network`. `--allow-local-network` is a second opt-in for loopback endpoints only (`localhost`, `127.0.0.0/8`, or `::1`). Private, link-local, multicast, unspecified, reserved, and NAT64 ranges remain blocked.

```bash
codex-plugin-doctor check ./plugin --runtime --allow-network
codex-plugin-doctor check ./plugin --runtime --allow-network --allow-local-network
```

The same consent is available in the GitHub Action through `allow-network: "true"` and, only when needed, `allow-local-network: "true"`. Keep both inputs false for ordinary static validation.

## Read-Only Scope

The probe uses bounded HTTP requests for MCP initialization and only follows the OAuth metadata-discovery path advertised by an unauthenticated challenge. It never sends credentials or tokens, and reporting redacts sensitive values, response bodies, session identifiers, SSE event identifiers, SSE retry values, and authorization metadata.

## Transport Reliability

The optional reliability scorecard runs only within the same `--runtime --allow-network` consent boundary; loopback endpoints still need `--allow-local-network`. It makes one bounded GET request after initialization. A `200` response must use `text/event-stream`; a `405` response is compliant when server-to-client SSE is unsupported. The probe can make at most one SSE resume and one session restart, and it retains no raw response body or SSE data. It is a bounded readiness check, not a claim of live remote interoperability, replay correctness, delivery guarantees, or load capacity.

`--allow-session-lifecycle` is false by default. It is state-changing and permits one bounded `DELETE` only after initialization supplies a valid `MCP-Session-Id`. `--require-remote-reliability` is a strict result gate: the command requires a passing reliability scorecard, but the flag grants no network or loopback consent. See [Remote MCP Transport Reliability](remote-mcp-transport-reliability.md) for the protocol sequence and classifications.

## SSRF Controls

Before connecting, the CLI requires an absolute HTTP or HTTPS URL without credentials, query strings, fragments, or numeric IP literals. It resolves hostnames and rejects non-public targets. The local-network exception permits loopback only; private, link-local, multicast, unspecified, reserved, cloud-metadata, and NAT64 destinations remain blocked. Requests have fixed size and time limits and do not follow redirects.

These checks reduce SSRF exposure but cannot account for every network topology. In particular, arbitrary network-specific NAT64 Pref64 mappings can change an address's effective route. Apply runner or host egress controls as the final boundary.

## Out Of Scope

- authenticated OAuth
- custom headers
- remote tool/resource/prompt/task calls
- redirects

Use a dedicated MCP client with its own authorization and network policy when any of these capabilities are required.
