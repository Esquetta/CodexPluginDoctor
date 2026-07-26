# Remote MCP Transport Reliability

## Purpose

Codex Plugin Doctor verifies whether an explicitly approved remote MCP endpoint
behaves safely and predictably across Streamable HTTP session and SSE lifecycle
boundaries. The probe is a bounded readiness check, not a general-purpose MCP
client or load test.

## Goals

- validate protocol-compliant GET behavior after initialization
- validate session propagation without exposing session identifiers
- observe bounded SSE event framing and resumability when evidence is available
- classify disconnects, timeouts, retry delays, and one session restart without
  retaining remote response content
- optionally terminate an initialized session after explicit user consent
- expose a stable, additive reliability scorecard and CI gate

## Non-Goals

- authenticated OAuth requests
- tool, resource, prompt, or task execution
- arbitrary custom request headers
- unbounded SSE subscriptions
- automatic retries beyond one evidence-driven resume attempt or one
  protocol-required session restart
- performance, availability, or load testing

## Consent Model

Remote probing continues to require `--runtime --allow-network`. Loopback
endpoints additionally require `--allow-local-network`.

The default reliability probe does not send a session termination request.
`--allow-session-lifecycle` explicitly permits one bounded `DELETE` request
after the probe completes and only when initialization returned a valid
`MCP-Session-Id`.

`--require-remote-reliability` is a result gate, not network consent, and
requires `--runtime --allow-network`. It fails unless every attempted remote
reliability scorecard passes. Local-only runs are unaffected.

## Probe Sequence

1. Perform the existing bounded `initialize` request.
2. Validate `MCP-Session-Id` as visible ASCII when present.
3. Send `notifications/initialized` with the negotiated protocol and session
   headers.
4. Send one bounded GET request with `Accept: text/event-stream`, the negotiated
   protocol version, and the session identifier when present.
5. Accept HTTP 405 as a protocol-compliant declaration that the endpoint does
   not offer a server-to-client SSE stream.
6. For HTTP 200, require `text/event-stream` and inspect only enough bytes to
   identify a complete SSE event or reach the configured bounds.
7. If a valid SSE `id` field is observed, make one bounded reconnect attempt
   using `Last-Event-ID`. Honor a valid server-provided SSE `retry` delay within
   the remaining probe deadline. Do not reconnect when no event identifier is
   observed.
8. If a GET carrying an issued session identifier returns HTTP 404, discard
   that identifier and make one bounded re-initialization attempt without it.
   Never restart a session more than once.
9. If lifecycle consent is enabled and a current session exists, send one bounded
   `DELETE` request with the protocol and session headers.

No step follows redirects. Every request reuses the existing DNS resolution,
peer matching, response-size, encoding, and timeout controls.
The complete probe has a fixed request-count ceiling; reconnect and session
restart paths cannot recurse.

## HTTP Classification

### GET

- `200` with `text/event-stream`: supported; continue bounded SSE inspection
- `405`: compliant but unsupported; no resumability attempt
- any other status: fail
- `200` with another media type: fail

An SSE connection that produces no complete event before the observation
deadline is inconclusive, not proof of malformed framing. A malformed complete
event, oversized response, unsafe peer change, or transport error fails the
relevant capability.

A valid SSE `retry` field is respected before reconnecting. If its delay exceeds
the remaining bounded probe deadline, resumability is inconclusive and no late
request is sent. Invalid retry fields are ignored according to SSE parsing
rules.

### Expired Session

HTTP 404 from a GET carrying an issued session identifier means the session
expired or was terminated. The probe discards the stale identifier and performs
one fresh initialize request without a session header. A successful restart
continues with the new session; a second session-expiry response fails restart
reliability. A DELETE 404 never restarts or retries and is a termination
failure.

### DELETE

- any `2xx`: termination passed
- `405`: compliant but unsupported
- any other status or transport failure: termination failed

DELETE classification is `skipped` when lifecycle consent is absent or no
session identifier was issued.

## Resumability

The probe attempts resumability only when the first bounded GET produces a
complete event with a non-empty valid `id` field. The exact event identifier is
held in memory only for the duration of the reconnect request and is sent as
`Last-Event-ID`.

A reconnect confirms request propagation and bounded transport behavior. It
does not claim delivery guarantees or replay correctness because the probe does
not retain or compare application payloads.

## Scorecard

The existing remote runtime scorecard gains an additive `reliability` object:

```json
{
  "getSse": "pass",
  "sessionPropagation": "pass",
  "resumability": "skipped",
  "disconnectSafety": "pass",
  "sessionRestart": "skipped",
  "termination": "skipped",
  "overall": "pass"
}
```

Capability fields use the existing `pass`, `warn`, `fail`, and `skipped`
statuses. `overall` is:

- `fail` when any attempted reliability check fails
- `warn` when no check fails but an attempted check is inconclusive
- `pass` when all applicable checks are compliant
- `skipped` when reliability probing does not run

Protocol-compliant unsupported behavior, such as GET or DELETE returning 405,
does not lower an otherwise passing score.

## Data Handling

The following values must never appear in text, Markdown, JSON, evidence,
transcript, error, or debug output:

- raw `MCP-Session-Id` values
- raw `Last-Event-ID` values
- raw SSE `retry` values
- SSE event data
- remote response bodies
- authorization metadata beyond existing redacted readiness classifications

Reports expose only classifications and stable finding identifiers. The probe
does not write remote values to disk.

## HTTP Client Changes

The bounded HTTP client may add only the capabilities required by this design:

- allow the `Last-Event-ID` request header
- preserve safe status and response-header metadata on a timeout after response
  headers arrive
- keep existing three-second and one-megabyte upper bounds

It must not add redirects, cookies, authorization headers, connection pooling,
or configurable unsafe headers.

## CLI And GitHub Action

The `check`, release-check, release-evidence, and GitHub Action paths that
already expose remote runtime probing receive consistent inputs:

- `--allow-session-lifecycle`
- `--require-remote-reliability`
- `allow-session-lifecycle`
- `require-remote-reliability`

Help output and public documentation must state that lifecycle consent can
change remote server state. Existing commands remain unchanged when both new
flags are absent.

## Findings

New findings use the `plugin.runtime.remote.reliability.*` namespace and must
provide actionable remediation without including remote values. At minimum,
tests cover invalid GET status, invalid SSE media type, malformed event framing,
resume failure, and termination failure.

## Verification

The implementation requires deterministic local HTTP fixtures for:

- GET returning 405
- valid SSE with no event identifier
- valid SSE with an event identifier and one resume request
- valid SSE retry delay and an over-deadline retry delay
- invalid SSE content type and malformed framing
- session propagation on initialized, GET, resume, and DELETE requests
- session expiry followed by one successful or failed re-initialization
- timeout and disconnect behavior
- DELETE disabled, successful, unsupported, and failed states
- output redaction across text, Markdown, JSON, and release evidence
- CLI validation and GitHub Action input forwarding
- `--require-remote-reliability` pass, warn, fail, and skipped outcomes

Completion requires focused tests, the full test suite, build, dependency audit,
package verification, and a clean consumer installation.
