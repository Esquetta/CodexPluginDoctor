# MCP Snapshot

`doctor mcp-snapshot` reads a server's tool, prompt, and resource template lists
in one run and can save each one for the matching file and diff commands. A
local stdio server starts once for all three lists, instead of once per
[`doctor tools`](mcp-tool-catalog.md), [`doctor prompts`](mcp-prompts.md), and
[`doctor resource-templates`](mcp-resource-templates.md) capture. No tool is
called, no prompt is retrieved, and no resource is read.

```bash
codex-plugin-doctor doctor mcp-snapshot https://mcp.example.com/mcp --allow-network --save-dir ./mcp-current
codex-plugin-doctor doctor mcp-snapshot ./my-plugin --server my-server --runtime --sandbox docker --save-dir ./mcp-current
codex-plugin-doctor doctor tools-diff --before ./mcp/tools-baseline.json --after ./mcp-current/mcp-tools-current.json --fail-on breaking
```

## Capture

The command takes the same options as the per-list captures:
- An HTTP server needs `--allow-network`, and `--allow-local-network` for a
  loopback address. `--bearer-token-env <NAME>` sends a token from an
  environment variable. Each list is requested separately, as a stateless
  server expects.
- A local stdio server needs `--server <name>` and `--runtime`. Doctor starts it
  once, reads every list it offers in that session, and stops it. It can run in
  the Docker sandbox with `--sandbox docker` (plus `--env <NAME>`) and require
  runtime approval.

Discovery, or the `initialize` handshake for older stdio servers, decides which
lists the server offers. A list whose capability (`tools`, `prompts`, or
`resources`) is not declared is `not-applicable`. Each offered list is read
under its usual limits and findings: at most 5 pages, and 500 tools, prompts,
or templates.

The overall status is the most serious list status, in this order: `blocked`,
`incomplete`, `unsupported`, `fail`, `warn`, `pass`, `not-applicable`. The exit
status follows it: `0` for `pass`, `2` for `incomplete` or `blocked`, and `1`
otherwise. A server that offers no list at all is `not-applicable` and exits
`1`.

## Saving

`--save-dir <dir>` creates the directory if needed and writes each complete list
as one response file:

| List | File | Inspect and compare with |
| --- | --- | --- |
| Tools | `mcp-tools-current.json` | `tools-file`, `tools-diff` |
| Prompts | `mcp-prompts-current.json` | `prompts-file`, `prompts-diff` |
| Resource templates | `mcp-resource-templates-current.json` | `resource-templates-file`, `resource-templates-diff` |

A list that is not offered or not read completely is not written. A file left
from an earlier run is not removed, so save into a fresh directory when the
files feed a comparison. When no list is written, or a file cannot be written,
the command exits `2`. The files hold the server's raw
definitions, including URI templates that can carry host names and paths;
handle them like a committed baseline.

## Report

The text report shows each list's status, pages, and checked entries, then the
findings by list and position. `--json` prints `doctor.mcp-snapshot.json`
(scope `mcp-surface-snapshot`): `discovery`, the stdio `protocol` and
`execution` details, and under `lists` the `tools`, `prompts`, and
`resourceTemplates` entries, each with `status`, `catalog`, `enumeration`, and
`findings` in the shape of the matching single-list report. Coverage is stated
as `definitions: "shape-only"`, `execution: "not-tested"`, and
`fullConformance: "not-tested"`. `doctor contract --json` prints the schema.

## GitHub Action and init-ci

The GitHub Action runs a snapshot through `snapshot-url` or `snapshot-server`
and compares each saved list through the existing `tools-diff-*`,
`prompts-diff-*`, and `resource-templates-diff-*` inputs; see
[GitHub Action Usage](github-action.md#one-snapshot-for-every-list). It needs
CLI 1.81.0 or later in `version`.
`codex-plugin-doctor init-ci . --tools-diff-server <name> --prompts-baseline <path>`
or `--resource-templates-baseline <path>` writes a workflow whose capture job
uses one snapshot for all compared lists.
