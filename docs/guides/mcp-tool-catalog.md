# HTTP MCP Tool Catalog

`doctor tools` inspects tool definitions advertised by an HTTP MCP server using
protocol `2026-07-28`. It makes a discovery request followed by bounded `tools/list`
requests. It never invokes a tool.

```bash
codex-plugin-doctor doctor tools https://mcp.example.com/mcp --allow-network
codex-plugin-doctor doctor tools https://mcp.example.com/mcp --allow-network --json
codex-plugin-doctor doctor tools http://localhost:3000/mcp --allow-network --allow-local-network
codex-plugin-doctor doctor tools --help
```

The existing `doctor discover` command retains its single-request discovery-only
contract. Existing `check --runtime` remains on its previous protocol baseline.
This new command does not assert full MCP conformance or client compatibility.

## Consent and request boundaries

Network access requires `--allow-network`. Only loopback access can additionally
be enabled with `--allow-local-network`; other private/reserved addresses remain
blocked. Public endpoints must use HTTPS; HTTP is accepted only for `localhost`.
Credentials, query parameters, fragments, and IP-literal URLs are rejected.
Existing DNS and peer-address validation runs for every request.

The command sends only `server/discover` and `tools/list` to the same input URL.
Cursors are opaque request values, never destinations. It does not authenticate,
fetch OAuth metadata, resolve schema references, follow redirects, retry, fall
back to an older protocol, initialize a session, subscribe, or start stdio servers.

Fixed inspection budgets are product limits, not MCP requirements:

| Budget | Limit |
| --- | --- |
| Requests | One discovery and five catalog pages |
| Inspected tool entries | 500 |
| Per-request timeout | 3 seconds, reduced to remaining total time |
| Whole-operation time | 15 seconds |
| Response body | 1 MiB per request; 4 MiB combined, including discovery and SSE framing |
| Findings | 100 |

These limits cannot be increased with CLI flags in this version. Repeated cursors,
resource limits, a failed later page, or authorization requirements yield an
incomplete result. Earlier findings are retained. A page with no tools but a next
cursor is followed within the limits; an empty final catalog is valid.

## What is checked

- Discovery must succeed for the requested version and advertise tools capability.
- Each page must have a matching JSON-RPC response and a complete tools-list result,
  including correctly shaped cache metadata and an optional string cursor.
- Tool entries must contain a string name and an object inputSchema. outputSchema,
  when present, must be an object; optional title/description values must be strings.
- Recommended tool-name length/characters and exact case-sensitive duplicate names
  generate warnings. Duplicate checks span all inspected pages.
- Schema checks inspect the root container and recognized root keywords only:
  `$schema`, `properties`, `required`, `type`, and `additionalProperties`.

An unspecified schema dialect defaults to JSON Schema 2020-12. Unsupported
dialects produce a warning and their keyword checks are skipped. A required
property does not have to appear in `properties`. Composition, references,
unknown annotations and nested boolean schemas are not rejected merely because
this checker does not evaluate their semantics.

Nested schema correctness, reference resolution, input/output instance validation,
and `x-mcp-header` validation are outside coverage. Tool annotations do not grant
permission to invoke tools. Validating this bounded structure does not establish
that a tool is safe, works correctly, or will be usable by a particular client.

## Results and exit codes

| Status | Exit | Meaning |
| --- | --- | --- |
| `pass` | 0 | Enumeration completed with no findings under the stated checks. |
| `warn` | 1 | Enumeration completed with recommendation or dialect warnings. |
| `fail` | 1 | Enumeration completed and required tool structure checks failed. |
| `unsupported` | 1 | Discovery could not establish the requested protocol/method. |
| `not-applicable` | 1 | Discovery succeeded without a tools capability. No list request was made. |
| `incomplete` | 2 | Enumeration or inspection could not finish; consult the reason and retained findings. |
| `blocked` | 2 | Consent or URL/network policy prevented inspection. |

Invalid CLI arguments return 2 on stderr before networking. Incomplete inspection
takes precedence over previously detected tool failures. A malformed tool can be
reported while inspecting later entries; a malformed page prevents reliable
continuation. A timeout is not proof of a protocol violation.

## JSON contract and privacy

`doctor contract --json` includes `doctor.tools.json`, describing the standalone
report with numeric `schemaVersion: 1` and `scope: "tool-catalog-structure"`.
Capture JSON from stdout; there is no `--output` option.

The report includes sanitized discovery evidence, status, catalog completion,
pages read, tools checked, a reason, findings and explicit coverage. Tool counts
are inspected counts, not a guaranteed server-wide inventory or atomic snapshot.

Coverage always reports schema `root-shape-only`, tool execution `not-tested`,
full conformance `not-tested`, and custom header annotations `not-tested`.
`catalog.complete` is false if any enumeration or inspection budget prevents
completion. A successfully discovered server is not automatically a valid catalog.

New findings use `plugin.catalog.*`. Locators identify a one-based page and global
one-based tool index, optionally the fixed input/output schema slot or another
tool index for duplicates. Reports exclude remote names, descriptions, schema
payloads, cursors, endpoint URLs, server identity, and raw errors. Match the
numeric locators against your own server's response when investigating a finding.

## References

- [MCP tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)
- [MCP pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination)
- [Discovery-only command](mcp-discovery.md)
