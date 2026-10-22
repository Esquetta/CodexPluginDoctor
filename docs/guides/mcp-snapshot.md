# MCP Snapshot

`doctor mcp-snapshot` reads a server's tool, prompt, and resource template lists
in one run and can save each one for the matching file and diff commands. A
local stdio server is read in one session for all three lists, instead of one
session per [`doctor tools`](mcp-tool-catalog.md),
[`doctor prompts`](mcp-prompts.md), and
[`doctor resource-templates`](mcp-resource-templates.md) capture. No tool is
called, no prompt is retrieved, and no resource is read. `doctor mcp-snapshot-diff`
then compares two saved snapshots, all lists at once.

```bash
codex-plugin-doctor doctor mcp-snapshot ./my-plugin --server my-server --runtime --sandbox docker --save-dir ./mcp/baseline
# Later, from the changed server:
codex-plugin-doctor doctor mcp-snapshot ./my-plugin --server my-server --runtime --sandbox docker --save-dir ./mcp-current
codex-plugin-doctor doctor mcp-snapshot-diff --before ./mcp/baseline --after ./mcp-current --fail-on breaking
```

An HTTP server is captured with `doctor mcp-snapshot <url> --allow-network --save-dir <dir>`.

## Capture

The command takes the same options as the per-list captures, with `--save-dir`
in place of `--save-response`:
- An HTTP server needs `--allow-network`, and `--allow-local-network` for a
  loopback address. `--bearer-token-env <NAME>` sends a token from an
  environment variable. Each list is requested separately, as a stateless
  server expects.
- A local stdio server needs `--server <name>` and `--runtime`. Doctor starts it,
  reads every list it offers in one session, and stops it; an older server that
  exits on the discovery probe is restarted once for the `initialize` handshake,
  as with the per-list captures. It can run in the Docker sandbox with
  `--sandbox docker` (plus `--env <NAME>`) and require runtime approval.

Discovery, or the `initialize` handshake for older stdio servers, decides which
lists the server offers. A list whose capability (`tools`, `prompts`, or
`resources`) is not declared is `not-applicable`. Each offered list is read
with its usual findings, at most 5 pages, and at most 500 tools, prompts, or
templates. In a stdio session the total time limit (30 seconds, or 90 in the
Docker sandbox) and the response size limit cover all lists together, so a
large server can leave a later list `incomplete` that a single-list capture
would read.

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

A list that is not offered or not read completely is not written. The command
first removes an earlier `mcp-snapshot-manifest.json` and last writes a new one,
which records each list's status and the file this run saved for it, or `null`;
it holds no names or definitions. `mcp-snapshot-diff` reads only the lists the
manifest names, so a list file left from an earlier run is not compared, and a
run that could not write its manifest leaves none. The per-list diff commands
do not read the manifest, so give them a fresh directory. When no
list is written, or a list or the manifest cannot be written, the command exits
`2`. The list files hold the server's raw definitions, including URI templates
that can carry host names and paths; handle them like a committed baseline.

## Report

The text report shows each list's status, pages, and checked entries, then the
findings by list and position. `--json` prints `doctor.mcp-snapshot.json`
(scope `mcp-surface-snapshot`): `discovery`, the stdio `protocol` and
`execution` details, and under `lists` the `tools`, `prompts`, and
`resourceTemplates` entries, each with `status`, `catalog`, `enumeration`, and
`findings` in the shape of the matching single-list report. Coverage is stated
as `definitions: "shape-only"`, `execution: "not-tested"`, and
`fullConformance: "not-tested"`. `doctor contract --json` prints the schema.

## Comparison

`doctor mcp-snapshot-diff --before <dir> --after <dir>` compares two snapshot
directories offline, list by list, using each directory's manifest:

| Before | After | Outcome |
| --- | --- | --- |
| saved | saved | `compared` with `tools-diff`, `prompts-diff`, or `resource-templates-diff` |
| saved | not offered | `list-removed`, breaking |
| not offered | saved | `list-added`, compatible |
| not offered | not offered | `not-offered` |
| either side offered but not saved | | `not-compared`; the comparison is incomplete |

A list counts as not offered when its manifest status is `not-applicable`. A
missing or invalid manifest leaves every list `not-compared`, and a manifest
can only name the fixed file names above. A remote or device path is blocked.

The status is `blocked` or `incomplete` when any list could not be compared,
`warn` when a list was added or removed or a compared list changed or has input
warnings, and `pass` otherwise. `comparison.breaking` adds removed lists to the
breaking changes of each compared list, and `comparison.unclassified` adds up
their unclassified ones. The options and exit codes follow
[`doctor tools-diff`](offline-tool-diff.md): `--json` (`doctor.mcp-snapshot.diff.json`,
which embeds each compared list's own diff report) or `--markdown`,
`--fail-on any|breaking`, `--show-names`, and exit `2` for an incomplete or
blocked comparison. The text and Markdown reports show one row per list and add
the list's own section only when it has changes, input findings, or an
incomplete comparison. They report positions; names appear only with
`--show-names`, and URI templates and descriptions are never included.
Directories saved by 1.81.0 have no manifest, so capture the baseline again
with 1.82.0 or later before comparing.

## GitHub Action and init-ci

The GitHub Action runs a snapshot through `snapshot-url` or `snapshot-server`
and compares each saved list through the existing `tools-diff-*`,
`prompts-diff-*`, and `resource-templates-diff-*` inputs; see
[GitHub Action Usage](github-action.md#one-snapshot-for-every-list). It needs
CLI 1.81.0 or later in `version`.
`codex-plugin-doctor init-ci . --tools-diff-server <name> --prompts-baseline <path>`
or `--resource-templates-baseline <path>` writes a workflow whose capture job
uses one snapshot instead of one capture per compared list.
