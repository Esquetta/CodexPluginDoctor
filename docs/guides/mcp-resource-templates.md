# MCP Resource Template Catalog and Diff

Resource templates are the stable part of an MCP server's resources: each one
is an [RFC 6570](https://datatracker.ietf.org/doc/html/rfc6570) URI template
that clients expand into resource URIs. Doctor can record a server's template
list and compare two recordings, so a change that breaks clients, such as a
removed template or a changed URI template, is caught before release. The list
is read with `resources/templates/list`; no resource is read. The plain
`resources/list` is not covered, because its entries usually follow the
server's data rather than its API.

```bash
codex-plugin-doctor doctor resource-templates https://mcp.example.com/mcp --allow-network --save-response ./mcp/resource-templates-baseline.json
codex-plugin-doctor doctor resource-templates ./my-plugin --server my-server --runtime --save-response ./resource-templates-current.json
codex-plugin-doctor doctor resource-templates-file ./resource-templates-current.json
codex-plugin-doctor doctor resource-templates-diff --before ./mcp/resource-templates-baseline.json --after ./resource-templates-current.json --fail-on breaking
```

## Capture

`doctor resource-templates` works like [`doctor prompts`](mcp-prompts.md) and
[`doctor tools`](mcp-tool-catalog.md), with the same options, limits, and exit
statuses:
- An HTTP server needs `--allow-network`, and `--allow-local-network` for a
  loopback address; private and reserved ranges stay blocked.
  `--bearer-token-env <NAME>` sends a token from an environment variable.
- A local stdio server from a package's MCP configuration needs
  `--server <name>` and `--runtime`, and can run in the Docker sandbox with
  `--sandbox docker` (plus `--env <NAME>`) and require runtime approval.

The server must declare the `resources` capability; otherwise the status is
`not-applicable`. Doctor reads at most 5 pages and 500 templates. A server that
declares the capability without implementing `resources/templates/list` is
`incomplete` with reason `resource-templates-list-method-unsupported`, and more
than 500 templates gives reason `template-limit`. Legacy stdio servers are read
through `initialize`, and their saved list uses `ttlMs: 0` and
`cacheScope: "private"`.

`--save-response <path>` writes a complete enumeration as one
`resources/templates/list` response; when nothing was enumerated completely,
nothing is written and the command exits `2`. The JSON report
(`doctor.resource-templates.json`, scope `resource-template-catalog-structure`)
states coverage as `definitions: "shape-only"` and `resourceRead: "not-tested"`.

## Offline inspection

`doctor resource-templates-file <path> [--json]` inspects one saved response
under the same file rules as [`prompts-file`](mcp-prompts.md#offline-inspection):
one UTF-8 JSON-RPC 2.0 response with `resultType: "complete"`, a
`resourceTemplates` array, and valid cache metadata, at most one MiB, not a
symbolic link or a remote or device path.

Each template needs a non-empty string `name` and a `uriTemplate` that parses
as an RFC 6570 URI template: literal text, and expressions such as `{path}`,
`{+path}`, `{/id}`, or `{?fields,page}` with variable names made of letters,
digits, `_`, percent-encoded octets, and single dots, and an optional `:1` to
`:9999` prefix or `*` explode modifier. Literal text may not contain ASCII spaces,
controls, quotes, `<`, `>`, `\`, `^`, `|`, or a backtick, and a `%` must start a
percent-encoded octet. `title`, `description`, and `mimeType`
must be strings when present. Duplicate names are a warning. Findings use
`plugin.catalog.resource_template.*` ids for definitions and
`plugin.resource_templates_file.*` ids for the file itself.

## Comparison

`doctor resource-templates-diff --before <path> --after <path>` matches
templates by `name` and labels each change:

| Reason | Impact | Meaning |
| --- | --- | --- |
| `resource-template-removed` | breaking | A template is no longer listed. |
| `resource-template-uri-changed` | breaking | The URI template's literal text or expression operators changed, or, with the same set of variables, its variables were reordered or given other modifiers, so URIs built from it change. |
| `resource-template-variable-removed` | breaking | A variable clients fill in is gone. |
| `resource-template-variable-added` | breaking | A new variable that existing clients do not fill in. |
| `resource-template-mime-type-changed` | unclassified | `mimeType` was added, removed, or changed. |
| `other-fields-unclassified` | unclassified | Another field changed, such as `icons`, `annotations`, or `_meta`. |

An added template and title or description changes are compatible. A breaking
reason outranks an unclassified one, and labels are heuristics from the listed
definitions, not proof that clients keep working. Options and exit codes follow
[`doctor tools-diff`](offline-tool-diff.md): `--json` or `--markdown`,
`--fail-on any|breaking`, and an incomplete comparison (exit `2`) for blocked,
incomplete, or failing inputs or two templates with the same name.

## Privacy

Reports identify templates by their one-based position in each file and never
include names, URI templates, variables, descriptions, or other values. URI
templates can carry host names and paths, so they stay out of every report.
`--show-names` adds the template `name` to each change and, for changed
templates, `locations`: the variable behind each reason (`null` for
template-level reasons), at most 100 per template. Names and variables are
shown as escaped JSON strings, in code spans in Markdown; keep the flag out of
public output.

The contracts are `doctor.resource-templates.json`,
`doctor.resource-templates.file.json`, and `doctor.resource-templates.diff.json`;
`doctor contract --json` prints them.

## GitHub Action and init-ci

The GitHub Action runs the capture and comparison through `resource-templates-*`
inputs, such as `resource-templates-capture-server`,
`resource-templates-diff-before`, and `resource-templates-diff-comment`, with the
same rules as the tool inputs; see
[GitHub Action Usage](github-action.md#resource-template-lists). The comparison
gets its own pull request comment and needs CLI 1.79.0 or later in `version`.
`codex-plugin-doctor init-ci . --tools-diff-server <name>
--resource-templates-baseline mcp/resource-templates-baseline.json` adds the
server's template capture and comparison to the generated workflow.
