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
| `input-property-type-narrowed` | breaking | An input property's or array item's `type` no longer admits every previous type (`integer` is covered by `number`), or an `anyOf` alternative was dropped, such as `null` from an optional value. |
| `input-property-enum-narrowed` | breaking | An input property's or array item's `enum` or `const` dropped values or was introduced (`const` counts as a one-value `enum`). |
| `input-constraint-tightened` | breaking | A `minimum`, `exclusiveMinimum`, `minLength`, or `minItems` rose, a `maximum`, `exclusiveMaximum`, `maxLength`, or `maxItems` fell, an inclusive bound became exclusive, an integer `multipleOf` changed to a value that does not divide the old one (`6` to `3` is compatible, `2` to `4` is not), or such a bound, a `multipleOf`, `uniqueItems: true`, a `pattern`, a `format`, or an array `items` schema was introduced. |
| `input-additional-properties-closed` | breaking | `additionalProperties` became `false`. |
| `output-schema-removed` | breaking | A previously declared `outputSchema` was removed. |
| `output-type-widened` | breaking | The root `outputSchema` may now have a type it could not have before. |
| `output-property-removed` | breaking | A declared output property was removed. |
| `output-guarantee-removed` | breaking | An output property is no longer required. |
| `output-property-type-widened` | breaking | An output property may now have a type it could not have before, or an `anyOf` alternative was added, such as `null`. |
| `output-property-enum-widened` | breaking | An output property's or array item's `enum` or `const` gained values or was removed. |
| `output-constraint-loosened` | breaking | An output bound, `multipleOf`, `uniqueItems: true`, `pattern`, `format`, or array `items` schema was relaxed or removed. |
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
root. Below that limit, any change is unclassified. Composition wrappers (see
below) keep the level of the schema they wrap; more than 16 of them along one
path are unclassified. `minimum` and `exclusiveMinimum` (and `maximum` and
`exclusiveMaximum`) are combined into one effective bound per side, the tighter one
winning and the exclusive form winning a tie, so adding a looser second bound
changes nothing. A draft-04 boolean `exclusiveMinimum` or `exclusiveMaximum` makes
the `minimum` or `maximum` beside it exclusive; one without that keyword is
unclassified. A changed bound that is not a
finite number, a changed `multipleOf` that is not a positive number, a changed fractional `multipleOf` (validators test those
with floating-point division, which can reject `0.3` under `multipleOf: 0.1`), and
a changed `uniqueItems` that is not a boolean are unclassified. A `oneOf` other
than a discriminated union (see below), `not`, `allOf` with more than one subschema, `anyOf` or `allOf` beside other validating
keywords (see below for the forms that are compared), references that cannot be
resolved (see below), a changed `pattern` or `format` value, tuple-form `items`,
an `enum` or `const` at the root, `items` or `additionalProperties` changes beside
`unevaluatedItems` or `unevaluatedProperties`, and changes that introduce or
modify a schema-valued `additionalProperties` (in outputs, any
`additionalProperties` change) are reported as unclassified rather than guessed. At the root, bounds, `multipleOf`,
`uniqueItems`, `items`, `pattern`, and `format` are also unclassified. A `pattern` or `format` is compared only by
presence, because one regular expression or format cannot be checked against
another: introducing one on an input (or removing one from an output) is a
constraint change, removing one from an input (or introducing one on an output)
is `compatible`, and changing its value is unclassified.

Three composition forms are compared. A schema that is only a one-element `allOf`
with documentation keywords beside it means the same as its subschema, which
covers the `allOf: [{ "$ref": ... }]` wrapper older Pydantic emits. A schema that
is only `anyOf` with documentation keywords beside it is compared alternative by
alternative. So is a discriminated union: a schema that is only `oneOf` and
`discriminator` with documentation keywords, as Pydantic emits for a
discriminated union of models, when every alternative resolves to an object
schema that requires `discriminator.propertyName` and fixes it to one `const` (or
one-value `enum`) that no other alternative uses. Such alternatives cannot both
match one value, so the `oneOf` accepts exactly what an `anyOf` would; their
alternatives also pair by that value. `discriminator.mapping` is not compared,
because JSON Schema validators ignore it. When the discriminator property name
differs, alternatives pair by identity, `$ref`, or `type` only. A union whose
alternatives are not shown to exclude each other stays unclassified, and so does
one whose discriminator property holds a `$ref` beside its `const`, or one under a
draft-04 or draft-03 `$schema`. A union that appears whole as one alternative of
the other side, such as a union made nullable, is compared as that alternative. The
`anyOf` form covers `anyOf: [{ "$ref": ... }, { "type": "null" }]` for
optional models; a schema without `anyOf` counts as an `anyOf` with itself as the
only alternative, so making a value, including a `$ref` to a model, nullable or
no longer nullable is compared too. A `$ref` compared with an `anyOf` keeps its
reference when an alternative refers to the same definition and is otherwise
compared through its target, so it can pair with an inline alternative by `type`.
Identical alternatives match first, then, between two discriminated unions with
the same discriminator property, alternatives with the same discriminator value,
then alternatives with the same `$ref`
or the same `type` when exactly one alternative on each side has it, then the
single alternative left on each side. Matched
alternatives are compared with the reasons above. An input alternative that was
dropped is `input-property-type-narrowed` (`input-type-narrowed` at the root) and
an added one is `compatible`; for outputs, an added alternative is
`output-property-type-widened` and a dropped one is `compatible`. When
alternatives are left without a match on both sides and they are not one on
each side, or either side has more than 32 alternatives, the change is
unclassified. A dropped input alternative is
reported even when another alternative still accepts the same values.

Same-document references are followed. A `$ref` whose value is a JSON Pointer
fragment such as `#/$defs/Item`, `#/definitions/Item`, or `#/properties/a` is
resolved within the same `inputSchema` or `outputSchema`, so a change inside a
referenced definition is classified with the reasons above. Recursive definitions
are compared once per pair of references, and a definition shared by many
properties is compared once per depth. A schema that is unchanged but reaches a
changed definition is compared again rather than skipped, so an unchanged
reference that cannot be resolved is unclassified whenever the tool's schema
changes elsewhere. A reference is unclassified when its target is missing, when
it is an anchor (`#Item`), when it sits beside keywords other than documentation
keywords, when a chain of references is longer than eight, or when the schema
declares a nested `$id` (or draft-04 `id`), or when its target contains a
`$dynamicRef`, `$recursiveRef`, URI reference, or `$id` (or draft-04 `id`) other
than the root's own. Remote references are never fetched: an unchanged remote
`$ref` is treated as unchanged, and a changed one is unclassified.

A `$defs` or `definitions` entry that no reference reaches does not affect the
result only when every reference in both schemas is a same-document `$ref`
fragment. When either schema uses `$dynamicRef`, `$recursiveRef`, a URI
reference (including one that names the schema's own `$id`), or a nested `$id`
(or draft-04 `id`), definitions are compared as written and any change in them is unclassified. A
schema whose comparison needs more than 10,000 steps is unclassified.

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
