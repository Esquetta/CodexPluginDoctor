# Offline MCP Tool Diff

`doctor tools-diff` compares two saved MCP 2026-07-28 `tools/list` responses.
It reports changes in the supplied tool definitions without connecting to a
server, executing tools, or fetching schema references.

```bash
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json --json
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json --fail-on breaking
codex-plugin-doctor doctor tools-diff --before ./tools-old.json --after ./tools-new.json --markdown
codex-plugin-doctor doctor contract --json
```

`--markdown` renders the same report as Markdown tables for pull request comments
and job summaries: counts, one row per change with tool positions, changed fields,
impact, and reason codes, and any input findings. It omits names and values like
the other formats.

Both inputs use the [offline tool-definition input format](offline-tool-definitions.md):
one original UTF-8 JSON-RPC response per file, with modern complete-result cache
metadata. Reports previously produced by Doctor are not input files; responses
saved with `doctor tools --save-response` are.

## Baseline workflow

Record the tool list once, commit it, and compare a fresh capture on every change:

```bash
codex-plugin-doctor doctor tools https://mcp.example.com/mcp --allow-network --save-response ./mcp/tools-baseline.json
codex-plugin-doctor doctor tools https://mcp.example.com/mcp --allow-network --save-response ./tools-current.json
codex-plugin-doctor doctor tools-diff --before ./mcp/tools-baseline.json --after ./tools-current.json --fail-on breaking
```

With `--save-response`, exit `2` means nothing was written; treat it as a failed
check rather than diffing a file left over from an earlier run. Exit `1` means the
file was saved but the catalog has warnings or failures. Update the baseline deliberately when a change is
accepted. The GitHub Action can run the capture and comparison steps; see
[GitHub Action Usage](github-action.md#mcp-server-repositories).

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

## Change impact

Each change record also carries an `impact` of `breaking`, `compatible`, or
`unclassified`, and a list of fixed `reasons`. Impact is judged from the point of
view of an existing caller: inputs it already sends must still be accepted, and
outputs it already reads must keep their shape.

| Reason | Impact | Trigger |
| --- | --- | --- |
| `tool-removed` | breaking | A tool name no longer appears. |
| `input-type-narrowed` | breaking | The root `inputSchema` type no longer admits every previously admitted type. |
| `input-required-added` | breaking | A property became required. |
| `input-property-removed` | breaking | A declared input property was removed. |
| `input-property-type-narrowed` | breaking | An input property's or array item's `type` no longer admits every previous type (`integer` is covered by `number`). |
| `input-property-enum-narrowed` | breaking | An input property's or array item's `enum` dropped values or was introduced. |
| `input-constraint-tightened` | breaking | A `minimum`, `minLength`, or `minItems` rose, a `maximum`, `maxLength`, or `maxItems` fell, or such a bound or an array `items` schema was introduced. |
| `input-additional-properties-closed` | breaking | `additionalProperties` became `false`. |
| `output-schema-removed` | breaking | A previously declared `outputSchema` was removed. |
| `output-type-widened` | breaking | The root `outputSchema` may now have a type it could not have before. |
| `output-property-removed` | breaking | A declared output property was removed. |
| `output-guarantee-removed` | breaking | An output property is no longer required. |
| `output-property-type-widened` | breaking | An output property may now have a type it could not have before. |
| `output-property-enum-widened` | breaking | An output property's or array item's `enum` gained values or was removed. |
| `output-constraint-loosened` | breaking | An output bound or array `items` schema was relaxed or removed. |
| `annotation-safety-reduced` | breaking | A `readOnlyHint`, `destructiveHint`, `idempotentHint`, or `openWorldHint` moved to the less safe value, using MCP defaults for absent hints. |
| `input-schema-unclassified` | unclassified | An `inputSchema` change outside the checks above. |
| `output-schema-unclassified` | unclassified | An `outputSchema` change outside the checks above. |
| `other-fields-unclassified` | unclassified | An extension or metadata field changed. |

Additions, `description` or `title` changes, new optional input properties,
relaxed requirements, widened input types, new output properties or guarantees,
and documentation-only schema keywords (`title`, `description`, `examples`,
`default`, `deprecated`, `$comment`) are `compatible`. A change is `breaking`
when it has any breaking reason, `unclassified` when it only has unclassified
reasons, and `compatible` when it has none.

Classification is a heuristic. The property, requirement, type, and
`additionalProperties` reasons apply at every level: to the root schema, to
nested object `properties`, and to array `items`, up to eight levels below the
root. Below that limit, any change is unclassified. A bound that is not a finite
number is unclassified. Composition keywords (`anyOf`, `oneOf`, `allOf`, `not`),
references, `pattern`, `format`, `const`, exclusive bounds, tuple-form `items`,
an `enum` at the root, `items` or `additionalProperties` changes beside
`unevaluatedItems` or `unevaluatedProperties`, and changes that introduce or
modify a schema-valued `additionalProperties` (in outputs, any
`additionalProperties` change) are reported as unclassified rather than guessed. At the root, bounds and `items` are also
unclassified.

A new property is `compatible` at the root and in nested objects that already
declared properties. In any object, including the root, whose extra keys may be
governed by an `additionalProperties` schema or by any other keyword the checks
above do not classify (for example `patternProperties`, `dependentRequired`,
`const`, composition keywords, or references), a new property is unclassified in
both directions. Definition containers and identifiers (`$defs`, `definitions`,
`$id`, `$anchor`, `$dynamicAnchor`) do not count. A new property in a nested
input object that declared no properties and did not close `additionalProperties`
is also unclassified, because callers may already send that key with other
values. In any input object, including the root, declaring a key that was already
required is unclassified. A new output property is otherwise `compatible`, even
when `additionalProperties` is `false`; consumers that validate results strictly
against the old schema can still reject it.
`comparison.breaking` and `comparison.unclassified` count records by impact, and
`coverage.impactClassification` is `heuristic`.

A `compatible` label is not proof of compatibility, and an unchanged report does
not prove compatible behavior. Input validation findings still check root schema
shapes only; server inventory, provenance, freshness, execution, and
compatibility are not established.

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
`changed`, and `unchanged` tool counts, plus `breaking` and `unclassified` change
counts. Coverage is explicitly `structural-only`.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Complete comparison with no changes or input warnings (`pass`). |
| `1` | Complete comparison with changes or input warnings (`warn`). |
| `2` | Comparison incomplete, input blocked, or arguments invalid. |

`--fail-on breaking` changes only the exit code of a complete comparison: it
exits `1` when any change is `breaking` or `unclassified`, and `0` otherwise,
including when the only changes are compatible or an input has warnings. Use it
to gate CI on changes that can affect existing callers. `--fail-on any` is the
default behavior above. The report content and `status` are the same in both
modes, and incomplete or blocked comparisons still exit `2`.

`--before` and `--after` each require one path and may appear in either order.
Optional `--json` or `--markdown` (not both) and `--fail-on any|breaking` may each appear once. Duplicate options, extra positional arguments,
network/execution options, and output-file options are rejected before reading
inputs. Prefix a filename beginning with a dash with `./`.
