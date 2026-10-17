# MCP Prompt Catalog and Diff

Doctor can record an MCP server's prompt list and compare two recordings, so a
change that breaks clients, such as a removed prompt or a newly required
argument, is caught before release. Prompts are listed, never retrieved:
`prompts/get` is not called and no prompt content is read.

```bash
codex-plugin-doctor doctor prompts https://mcp.example.com/mcp --allow-network --save-response ./mcp/prompts-baseline.json
codex-plugin-doctor doctor prompts ./my-plugin --server my-server --runtime --save-response ./prompts-current.json
codex-plugin-doctor doctor prompts-file ./prompts-current.json
codex-plugin-doctor doctor prompts-diff --before ./mcp/prompts-baseline.json --after ./prompts-current.json --fail-on breaking
```

## Capture

`doctor prompts` works like [`doctor tools`](mcp-tool-catalog.md) and shares its
options and limits:
- An HTTP server needs `--allow-network`, and `--allow-local-network` for a
  loopback or private address. `--bearer-token-env <NAME>` sends a token from
  an environment variable.
- A local stdio server from a package's MCP configuration needs `--server <name>`
  and `--runtime`. It can run in the Docker sandbox with `--sandbox docker`
  (plus `--env <NAME>`) and can require runtime approval.

Doctor discovers the server, checks that it declares the `prompts` capability,
and reads at most 5 `prompts/list` pages and 500 prompts. A server without the
capability is `not-applicable`. Legacy stdio servers that only support the
`initialize` handshake are read too; their saved list uses `ttlMs: 0` and
`cacheScope: "private"`.

`--save-response <path>` writes a complete enumeration as one `prompts/list`
response. Nothing is written when enumeration is incomplete (exit `2`).

| Status | Exit | Meaning |
| --- | --- | --- |
| `pass` | 0 | Enumeration completed with no findings. |
| `warn` | 1 | Enumeration completed with warnings, such as duplicate prompt names. |
| `fail` | 1 | Enumeration completed and prompt definition checks failed. |
| `unsupported` | 1 | Discovery could not establish the requested protocol version. |
| `not-applicable` | 1 | The server does not declare the `prompts` capability; no list request was made. |
| `incomplete` | 2 | Enumeration could not finish; the reason says why. |
| `blocked` | 2 | Consent or network policy prevented the capture. |

A server without prompts exits `1`, so a CI step that runs `doctor prompts`
against a server that may not offer prompts should check the status instead
of the exit code alone. Incomplete reasons are those of `doctor tools`, with
`prompt-limit` (more than 500 prompts) and `prompts-list-method-unsupported`
(the capability is declared but `prompts/list` is not implemented) in place of
their tool counterparts.

The JSON report (`doctor.prompts.json`, scope `prompt-catalog-structure`) states
coverage as `definitions: "shape-only"` and `promptRetrieval: "not-tested"`.
Each finding's location gives the page, the one-based prompt index and, where it
applies, the argument index.

## Offline inspection

`doctor prompts-file <path> [--json]` inspects one saved response without a
server. The file must be one UTF-8 JSON-RPC 2.0 response with `resultType:
"complete"`, a `prompts` array, finite nonnegative `ttlMs`, and `cacheScope` of
`public` or `private`; files over one MiB, symbolic links, and remote or device
paths are refused.

Each prompt needs a non-empty string `name`. `title` and `description` must be
strings when present. `arguments` must be an array of objects, each with a
unique non-empty string `name`, an optional boolean `required`, and optional
string `title` and `description`. Duplicate prompt names are a warning.
Findings use `plugin.catalog.prompt.*` ids for definitions and
`plugin.prompts_file.*` ids for the file itself. The inspection is incomplete
(exit `2`) with reason `prompt-limit` past 500 prompts, `finding-limit` past
100 findings, or `more-pages-present` when the saved response has a
`nextCursor`; otherwise `pass` exits `0` and `warn` or `fail` exit `1`.

## Comparison

`doctor prompts-diff --before <path> --after <path>` matches prompts by name and
arguments by name, and labels each change:

| Reason | Impact | Meaning |
| --- | --- | --- |
| `prompt-removed` | breaking | A prompt is no longer listed. |
| `prompt-argument-removed` | breaking | An argument clients may send is gone. |
| `prompt-required-argument-added` | breaking | A new argument has `required: true`; existing calls omit it. |
| `prompt-argument-now-required` | breaking | An optional argument became required. |
| `prompt-argument-fields-unclassified` | unclassified | An argument field other than `name`, `title`, `description`, or `required` changed. |
| `other-fields-unclassified` | unclassified | A prompt field other than `name`, `title`, `description`, or `arguments` changed, such as `icons` or `_meta`. |

An added prompt, a new optional argument, a required argument becoming
optional, reordered arguments, and title or description changes are
compatible. A breaking reason outranks an unclassified one. Labels are
heuristics from the listed definitions; they do not prove that clients keep
working.

Options and exit codes follow [`doctor tools-diff`](offline-tool-diff.md):
`--json` or `--markdown`, and `--fail-on any|breaking`. The comparison is
incomplete (exit `2`) when an input is blocked or incomplete, has a failing
finding, or lists two prompts with the same name.

## Privacy

Reports identify prompts by their one-based position in each file and never
include prompt names, argument names, descriptions, or other values.
`--show-names` adds the prompt `name` to each change and, for changed prompts,
`locations`: the argument behind each reason (`null` for prompt-level fields),
at most 100 per prompt; `reasons` always lists every reason.
Names are shown as escaped JSON strings, in code spans in Markdown. The flag
discloses the prompt surface, so keep it out of public output.

The contracts are `doctor.prompts.json`, `doctor.prompts.file.json`, and
`doctor.prompts.diff.json`; `doctor contract --json` prints them.
