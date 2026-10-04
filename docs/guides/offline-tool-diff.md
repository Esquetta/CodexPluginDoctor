# Offline MCP Tool Diff

`doctor tools-diff` compares two saved MCP 2026-07-28 `tools/list` responses.
It reports changes in the supplied tool definitions without connecting to a
server, executing tools, or fetching schema references.

```bash
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json --json
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json --compatibility
codex-plugin-doctor doctor contract --json
```

Both inputs use the [offline tool-definition input format](offline-tool-definitions.md):
one original UTF-8 JSON-RPC response per file, with modern complete-result cache
metadata. Reports previously produced by Doctor are not input files.

## Matching and changes

Tools match by exact, case-sensitive name. Reordering the tools array does not
count as a change. A renamed tool appears as one removal and one addition.
Locations are one-based indices into the respective input arrays.

Each change has a fixed kind (`added`, `removed`, or `changed`), before/after tool
indices where applicable, and a list of changed field categories:

- `inputSchema`
- `outputSchema`
- `description`
- `title`
- `annotations`
- `other`: any remaining definition fields, including extensions and metadata

Added and removed records have no changed-field list entries. Changed records
can include multiple categories. Records for removed and changed tools follow
before-file order; additions follow after-file order.

Comparison is structural. JSON object key order and whitespace do not matter;
array order does. This means reordering `required` or `enum` may produce a schema
change even where the schema's meaning is unchanged. Missing fields differ from
explicit `null` values. Response IDs, cache metadata, and other envelope metadata
are excluded; metadata inside a tool definition is included.

A changed schema is not automatically incompatible. An unchanged report does
not prove compatible behavior. Schema checks remain limited to root shapes;
server inventory, provenance, freshness, execution, and compatibility are not
established.

## Compatibility signals

`--compatibility` adds heuristic breaking-change signals to a complete
comparison. Every change record gains a `signals` list, `comparison.breaking`
counts the records with at least one signal, and `coverage.compatibility`
becomes `root-property-signals`. Added tools never carry signals. Without the
flag the report is unchanged.

| Signal | Raised when |
| --- | --- |
| `tool-removed` | A tool in the before file has no exact-name match after. |
| `input-required-added` | The root input `required` list gains a name. |
| `input-property-removed` | A root input property disappears. |
| `input-property-type-narrowed` | A root input property's `type` stops accepting a previously accepted type. |
| `input-property-enum-narrowed` | A root input property's `enum` drops a member, or gains an `enum` where it had none. |
| `input-additional-properties-closed` | Root input `additionalProperties` becomes `false`. |
| `output-schema-removed` | A tool stops declaring `outputSchema`. |
| `output-required-removed` | The root output `required` list loses a name. |
| `output-property-removed` | A root output property disappears. |
| `output-property-type-widened` | A root output property's `type` may now produce a type it did not before. |
| `output-property-enum-widened` | A root output property's `enum` gains a member, or is dropped. |

Inputs break when the accepted set shrinks; outputs break when the produced set
grows. A missing `type` or `enum` means any value, and `integer` is treated as
a subset of `number`. Enum members compare by JSON value, ignoring object key
order. A `type` or `enum` keyword that is present but unreadable produces no
signal. Only root-level properties are examined: nested schemas, `$ref`,
composition keywords, formats, and numeric or string bounds are not.

Signals are evidence for review, not proof. A record without signals can still
break clients, and a signalled change may be harmless for a given client.

Use the flag as a CI gate: a complete comparison with any signal has status
`breaking` and exit code `3`. Property names, enum values, and schema content
are never included; use the tool indices to find them in your files.

## Incomplete or ambiguous inputs

Both inputs retain their validation reports. The command skips comparison if an
input is blocked, unavailable, incomplete, or contains a failing definition
finding. Duplicate names also prevent comparison because matching is ambiguous.
A `nextCursor` property, including an empty string, makes that input incomplete.
The command never follows it.

When comparison is skipped, `comparison.complete` is `false`, the reason is
explicit, all four change counters are `null`, and `changes` is empty. Those
values must not be interpreted as zero changes. Other completed-input warnings
are retained and cause a warning result even when no differences are found.

Each input inherits `tools-file` limits and path controls: at most 1 MiB, 500 tools,
and 100 findings; at most one extra byte is read to detect file growth. A complete
comparison produces at most 1,000 change records. Explicit URL, UNC, and device
paths are blocked before filesystem access. Parent components and mapped or
mounted filesystems retain operating-system semantics; use regular local files.

## Output and privacy

Reports omit raw paths, tool names, values, schema text, custom field names, and
cursors. Use before/after tool indices to locate entries in your original files.
`other` identifies an extension-field change without exposing its key or value.
Input findings are labeled by side in text output and stored under `before` and
`after` in JSON.

The standalone contract is `doctor.tools.diff.json`, with numeric `schemaVersion: 1`
and scope `tool-definitions-diff`. `comparison` reports `added`, `removed`,
`changed`, and `unchanged` tool counts, plus `breaking` when `--compatibility`
is set (`null` when comparison is skipped). Coverage is explicitly `structural-only`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Complete comparison with no changes or input warnings (`pass`). |
| `1` | Complete comparison with changes or input warnings (`warn`). |
| `2` | Comparison incomplete, input blocked, or arguments invalid. |
| `3` | With `--compatibility`, complete comparison with at least one signal (`breaking`). |

`--before` and `--after` each require one path and may appear in either order.
Optional `--json` and `--compatibility` may each appear once. Duplicate options, extra positional arguments,
network/execution options, and output-file options are rejected before reading
inputs. Prefix a filename beginning with a dash with `./`.
