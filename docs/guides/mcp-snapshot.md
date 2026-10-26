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
which records each list's status and the file this run saved for it, or `null`,
and the server surface: the protocol era (`modern` or `legacy`), the supported
protocol versions (discovery's `supportedVersions`, or the version `initialize`
negotiated), the top-level capability names, without their values, and, from
1.86.0, a SHA-256 hash of the server's `instructions` and their length in
characters (Unicode code points), never the text itself. It holds no tool, prompt, or template names or definitions. `mcp-snapshot-diff` reads only the lists the
manifest names, so a list file left from an earlier run is not compared, and a
run that could not write its manifest leaves none. The per-list diff commands
do not read the manifest, so give them a fresh directory. When no
list is written, or a list or the manifest cannot be written, the command exits
`2`. The list files hold the server's raw definitions, including URI templates
that can carry host names and paths; handle them like a committed baseline.

## Report

The text report shows the server surface, each list's status, pages, and
checked entries, then the findings by list and position. `--json` prints
`doctor.mcp-snapshot.json` (scope `mcp-surface-snapshot`): `discovery`, the
stdio `protocol` and `execution` details, `server` (the era, versions,
capability names, and instructions hash, or `null` when not established), and
under `lists` the `tools`, `prompts`, and
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
| not offered | saved | `list-added`, compatible; its definitions are checked like `tools-file`, `prompts-file`, or `resource-templates-file` |
| not offered | not offered | `not-offered` |
| either side offered but not saved | | `not-compared`; the comparison is incomplete |

The server surface is compared too. A removed protocol version or capability is
breaking, an added one is compatible, a `modern` server that falls back to
`legacy` is breaking, and the reverse is unclassified. Instructions that were
added, removed, or changed are unclassified, because they steer how agents use
the server and need a person to read them. The text and Markdown reports show a
12-character hash prefix and the length; the JSON reports and the manifest hold
the full hash. A surface recorded before 1.86.0 has no instructions, so
instructions are not compared against it; capture the baseline again to compare
them. The `tools`, `prompts`,
and `resources` capabilities are left to the list rows above. When either
manifest has no server surface, such as one written before 1.84.0, it is
`not-recorded` and does not affect the result; capture the baseline again to
compare it. A legacy surface holds only the version `initialize` negotiated, so
between two legacy snapshots a newer version is compatible and an older one is
breaking. At most 32 versions and 64 capability names of at most 128 characters
are recorded. Protocol versions and capability names appear in the reports as
quoted values, because they define the contract clients rely on.

A list counts as not offered when its manifest status is `not-applicable`. A
newly offered list whose definitions fail or cannot be read completely leaves
the comparison incomplete, and its findings are listed without names. A
missing or invalid manifest leaves every list `not-compared`, and a manifest
can only name the fixed file names above. A remote or device path is blocked.

The status is `blocked` or `incomplete` when any list could not be compared,
`warn` when a list was added or removed, a compared list changed or has input
warnings, or the server surface changed, and `pass` otherwise.
`comparison.breaking` adds removed lists and breaking server surface changes to
the breaking changes of each compared list, and `comparison.unclassified` adds
up the unclassified ones of both. The options and exit codes follow
[`doctor tools-diff`](offline-tool-diff.md): `--json` (`doctor.mcp-snapshot.diff.json`,
which embeds each compared list's own diff report) or `--markdown`,
`--fail-on any|breaking`, `--show-names`, and exit `2` for an incomplete or
blocked comparison. The text and Markdown reports show one row per list and add
the list's own section only when it has changes, input findings, or an
incomplete comparison. They report positions; tool, prompt, and template names
appear only with `--show-names`, and URI templates and descriptions are never
included.
Directories saved by 1.81.0 have no manifest, so capture the baseline again
with 1.82.0 or later before comparing.

## Accepting a change

When a comparison shows an intended change, make the new snapshot the baseline:

```bash
codex-plugin-doctor doctor mcp-snapshot-accept --snapshot ./mcp-current --baseline ./mcp/baseline
```

`doctor mcp-snapshot-accept` reads the snapshot's manifest and copies the list
files it names into the baseline directory, which it creates when missing, then
writes the manifest last. Each copied list must pass its file check, and a list
that was offered but not saved is refused, so a baseline never records a list
that could not be read. Baseline list files that the manifest does not name are
removed; no other file in the directory is read or written. Every check runs
before the baseline changes, and the earlier baseline manifest is removed before
the first write, so a write that fails partway leaves no manifest to compare
against. The command exits `0` when it accepted the snapshot and `2` when it
refused it or a write failed. Review and commit the baseline like any other
change.

## GitHub Action and init-ci

The GitHub Action runs a snapshot through `snapshot-url` or `snapshot-server`
(CLI 1.81.0 or later) and compares it either list by list through the
`tools-diff-*`, `prompts-diff-*`, and `resource-templates-diff-*` inputs, or in
one report and one pull request comment through `snapshot-diff-before-dir` (CLI
1.82.0 or later); see [GitHub Action Usage](github-action.md#snapshot-comparison).
`codex-plugin-doctor init-ci . --tools-diff-server <name> --snapshot-baseline-dir <dir>`
writes a workflow that compares the server's snapshot with a committed snapshot
directory and posts one comment, and that opens a pull request with an updated
baseline when it is run by hand; with `--prompts-baseline` or
`--resource-templates-baseline` instead, the capture job still uses one snapshot
and the compare job compares each list on its own.
