# MCP 2025-11 Conformance

## Status

Approved design for the release following `v1.50.0`.

## Purpose

Codex Plugin Doctor currently validates the established MCP initialization, tools, resources, prompts, pagination, and selected tool-call surfaces. MCP `2025-11-25` adds protocol semantics that can make a server appear healthy while its declared capabilities remain internally inconsistent.

This feature adds version-aware, read-only conformance checks to the existing runtime validation flow. It detects declaration and schema defects without creating tasks, invoking model sampling, opening elicitation flows, or changing server state.

## Goals

- evaluate MCP rules against the protocol version negotiated during initialization
- preserve valid behavior for servers using older supported protocol versions
- validate MCP `2025-11-25` task declarations and tool-level task support
- validate the structural readiness of tool schemas for the negotiated schema dialect
- perform only explicitly safe, read-only runtime requests
- expose additive conformance results through existing text, Markdown, and JSON reports
- keep conformance rules independent from transport and process lifecycle code

## Non-Goals

- creating, polling, retrieving, or cancelling tasks
- invoking tools to test task execution
- accepting or rejecting elicitation requests
- handling URL-mode elicitation in a browser
- servicing `sampling/createMessage` requests
- validating remote HTTP authorization or OAuth discovery
- adding a new top-level CLI command
- requiring older servers to implement capabilities introduced after their negotiated version
- building a generic external rule-pack engine

## User Experience

The checks run automatically anywhere the existing runtime probe runs, including `check --runtime` and `mcp`. No new flag is required.

Existing report fields remain unchanged. A new additive `conformance` section records:

- negotiated protocol version
- selected conformance profile
- capability consistency status
- task declaration consistency status
- task list probe status
- schema dialect readiness status
- overall `pass`, `warn`, `fail`, or `skipped` status

Text and Markdown output show the same statuses in the runtime scorecard. JSON output keeps machine-readable detail but never includes task objects or task identifiers.

## Architecture

### Runtime Probe

`runtime-probe.ts` remains responsible for process lifecycle, JSON-RPC transport, timeouts, initialization, and safe request collection. It passes normalized protocol observations to the conformance evaluator:

- negotiated protocol version
- server capabilities from `initialize`
- tool definitions from `tools/list`
- the shape-only outcome of an optional `tasks/list` probe

The runtime probe does not contain version-specific policy beyond deciding whether a read-only method may be requested.

### Conformance Evaluator

A dedicated core module evaluates normalized observations and returns:

- conformance profile identity
- check statuses
- findings with stable IDs
- an aggregate conformance status

The evaluator is deterministic and has no process, network, filesystem, clock, or environment dependencies. Unit tests can therefore cover protocol-version and capability combinations without spawning an MCP server.

### Reporting

Existing runtime result and scorecard types gain additive conformance fields. Text, Markdown, JSON, runtime plan, and public output contract surfaces are updated together.

No existing finding ID, severity, default runtime behavior, or command invocation changes.

## Protocol Profiles

### Known Older Versions

For a known version before `2025-11-25`:

- run existing common MCP validation
- mark task-specific checks as `skipped`
- do not require Tasks, URL elicitation, sampling tools, or JSON Schema 2020-12 declarations introduced by later specifications
- do not send `tasks/list`

### MCP 2025-11-25

Apply common validation and the conformance rules defined below.

### Unknown Newer Versions

For a syntactically valid version newer than the latest profile known to the validator:

- apply the latest known safe common and `2025-11-25` structural checks
- emit a warning that the validator does not fully understand the negotiated version
- do not fail solely because the protocol version is newer
- do not probe methods unknown to the validator

Malformed or missing negotiated protocol versions remain protocol failures rather than unknown-version warnings.

## Conformance Rules

### Capability Shape

- `capabilities.tasks`, when present for `2025-11-25`, must be an object
- `tasks.list` and `tasks.cancel`, when present, must use the protocol capability object shape
- `tasks.requests`, when present, must contain recognized nested capability objects
- malformed capability values fail conformance
- unrecognized additive capability keys are preserved as forward-compatible and do not fail validation

### Tool Task Support

For each tool returned by `tools/list`:

- `execution`, when present, must be an object
- `execution.taskSupport`, when present, must be `required`, `optional`, or `forbidden`
- `required` or `optional` requires server capability `tasks.requests.tools.call`
- absent `taskSupport` is equivalent to `forbidden`
- a server may declare task request support without exposing a task-capable tool; this is valid

Malformed values fail. Capability mismatches fail because clients cannot safely determine the required invocation form.

### Safe Task List Probe

Send `tasks/list` only when all conditions hold:

- negotiated protocol version is `2025-11-25` or a newer unknown version using the latest safe profile
- the server explicitly declares `tasks.list`
- runtime probing is enabled

The probe validates only the JSON-RPC result envelope, task-list container shape, pagination cursor shape, and aggregate item count. It must not retain, render, log, or return task records or task IDs.

If the server does not declare `tasks.list`, the check is `skipped`. If it declares support but returns method-not-found, malformed output, or a timeout, the check fails with a method-specific finding.

No `tasks/get`, `tasks/result`, `tasks/cancel`, task-augmented request, sampling, or elicitation method is sent.

### Schema Dialect Readiness

For `2025-11-25`, JSON Schema 2020-12 is the default dialect for MCP embedded schemas. The evaluator performs structural checks rather than implementing a complete JSON Schema validator:

- tool `inputSchema` and `outputSchema`, when present, must be objects
- an explicit `$schema`, when present, must be a valid absolute URI string
- the known 2020-12 dialect URI is accepted
- malformed schema containers or invalid `$schema` values fail
- an omitted `$schema` is valid because the protocol defines the default dialect
- unsupported but syntactically valid explicit dialect URIs warn instead of failing

The feature does not attempt semantic evaluation of every JSON Schema keyword.

## Finding Semantics

Stable finding IDs use the `mcp.conformance` namespace. The initial catalog covers:

- unknown newer protocol version
- malformed Tasks capability
- invalid tool task support value
- task-support capability mismatch
- `tasks/list` timeout
- `tasks/list` invalid result
- invalid embedded schema dialect declaration

Findings caused by malformed data or declared-but-broken behavior are failures. Forward-compatibility uncertainty and valid but unsupported schema dialect declarations are warnings. Non-applicable checks are represented as skipped scorecard entries and do not emit findings.

## Data Flow

1. Start the configured MCP server using the existing approved runtime path.
2. Send `initialize` and validate the response using existing rules.
3. Select a conformance profile from the negotiated protocol version.
4. Run existing capability-directed tools, resources, and prompts probes.
5. Collect tool declarations without changing tool-call behavior.
6. If safely declared, send one bounded `tasks/list` request.
7. Immediately reduce the task response to shape status, count, and pagination status; discard payload records.
8. Evaluate all normalized observations in the conformance module.
9. Merge findings and conformance scorecard fields into the existing runtime result.
10. Render additive text, Markdown, JSON, and contract output.

## Security And Privacy

- active task, sampling, elicitation, and state-changing requests are prohibited
- `tasks/list` uses the existing runtime timeout and payload-size limits
- task IDs, status messages, metadata, result references, and authorization context are never retained in reports or transcripts
- verbose runtime transcripts represent `tasks/list` responses only as a redacted shape summary
- capability and schema validation does not fetch external `$schema` URIs
- unknown future methods are never invoked automatically
- Docker sandbox and runtime approval behavior remain unchanged

## Error Handling

- a missing or malformed negotiated version follows existing initialize failure behavior
- an older known version skips non-applicable checks
- an unknown newer version warns and uses the latest safe structural profile
- a declared method that times out or returns malformed data fails that method's conformance check
- failure of one conformance check does not prevent safe report generation or process cleanup
- process termination and sandbox cleanup continue through the existing runtime finalization path

## Compatibility

This is an additive minor-release feature:

- runtime probing remains opt-in
- command syntax remains unchanged
- existing JSON fields remain unchanged
- new JSON fields are additive and documented in `doctor contract`
- older compliant servers do not receive new requests
- servers without Tasks support do not receive task requests
- existing validation severities and finding IDs remain stable

## Testing

### Unit Tests

- profile selection for older, `2025-11-25`, and unknown newer versions
- valid and malformed Tasks capability structures
- all `taskSupport` values and capability combinations
- schema dialect omission, valid 2020-12 URI, malformed URI, and unsupported valid URI
- deterministic aggregate status and finding IDs

### Runtime Fixtures

- valid `2025-11-25` server without Tasks
- valid task-capable server with redacted `tasks/list`
- task capability mismatch
- invalid task support declaration
- malformed and timed-out `tasks/list`
- older server proving no task request is sent
- unknown newer server proving only known safe requests are sent

### Regression Tests

- text, Markdown, and JSON report snapshots
- output contract additions
- runtime plan method list
- transcript redaction with synthetic sensitive task fields
- assertion that no state-changing task, sampling, or elicitation method is sent
- complete existing test suite and release checks

## Acceptance Criteria

- existing valid runtime fixture remains passing
- older protocol fixtures receive no `tasks/list` request
- valid `2025-11-25` task declarations pass
- invalid capability and task-support combinations produce stable failures
- declared `tasks.list` is probed once and bounded by existing limits
- no task record or identifier appears in text, Markdown, JSON, SARIF, transcript, or artifact output
- unknown newer protocol versions warn without failing solely for being newer
- all existing public commands remain backward-compatible
- full tests, build, security self-scan, and release dry-run pass

## References

- [MCP 2025-11-25 changelog](https://modelcontextprotocol.io/specification/2025-11-25/changelog)
- [MCP Tasks](https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks)
- [MCP Elicitation](https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation)
