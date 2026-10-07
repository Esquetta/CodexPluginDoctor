# Offline MCP Tool Definitions

`doctor tools-file` checks tool definitions from one saved MCP 2026-07-28
JSON-RPC `tools/list` response. It does not send requests or invoke tools.

```bash
codex-plugin-doctor doctor tools-file ./tools-list.json
codex-plugin-doctor doctor tools-file ./tools-list.json --json
codex-plugin-doctor doctor contract --json
```

## Input

Export the original response from your MCP client as UTF-8 JSON, or record it
from an HTTP server with `doctor tools <url> --allow-network --save-response <path>`.
The sanitized report produced by `doctor tools` is not a tool-definition input file.

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "resultType": "complete",
    "tools": [
      {
        "name": "lookup",
        "description": "Look up an item by its identifier.",
        "inputSchema": {
          "type": "object",
          "properties": { "id": { "type": "string" } },
          "required": ["id"]
        }
      }
    ],
    "ttlMs": 0,
    "cacheScope": "private"
  }
}
```

The envelope requires `jsonrpc: "2.0"`, a string or finite numeric `id`, and a
`result` without `error`. The result requires `resultType: "complete"`, a `tools`
array, finite nonnegative `ttlMs`, and `cacheScope` of `public` or `private`.
An optional `nextCursor` must be a string. Its presence, including an empty
string, marks the inspection incomplete after checking the supplied entries.
The command never follows a cursor. Older result formats are unsupported.

Use a regular file on local storage. Explicit URLs, UNC paths, Windows device
paths, final symbolic links, and non-regular files are blocked. Parent path
components and mapped or mounted filesystems retain their operating-system
semantics; this command does not certify that a filesystem is physically local.
Unreadable files, detected changes, invalid UTF-8, invalid JSON, or unsupported
response shapes produce incomplete reports. One leading UTF-8 BOM is accepted.

## Limits and coverage

- File size: at most 1 MiB; a bounded overflow probe may read one additional byte.
- Tools checked: at most 500.
- Findings: at most 100; truncation marks the inspection incomplete.
- Schemas: root shape checks only, reusing the live catalog validator.
- Duplicate tool names: checked within the supplied array.

`inspection.complete` describes inspection of the supplied response. Even when
no `nextCursor` is present, it does not prove a complete server inventory. No
request-ID correlation, provenance, freshness, discovery, tool execution, full
JSON Schema validation, full MCP conformance, or custom-header annotation check
is performed. Schema references are not fetched.

Reports omit file paths, names, schema content, cursors, and raw errors. Findings
use numeric page/tool locators; page is always `1` for this single-file input.
Definition findings reuse `plugin.catalog.*`; file findings use
`plugin.tools_file.*`. JSON uses schema version `1` and scope
`tool-definitions-file`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Supplied-response inspection completed without findings (`pass`). |
| `1` | Completed with warnings or failures (`warn` or `fail`). |
| `2` | Incomplete, blocked, or invalid command arguments. |

Only the path and optional `--json` flag are accepted. Network, authentication,
runtime, and execution flags are not supported. Existing live MCP commands keep
their current behavior.
