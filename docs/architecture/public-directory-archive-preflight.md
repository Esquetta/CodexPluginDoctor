# Public Directory Archive Preflight

## Purpose

Codex Plugin Doctor validates a skills-only ZIP before the author uploads it to the OpenAI public-directory submission portal. The archive preflight checks the packaged artifact itself, not only the source directory that produced it.

The feature is offline, read-only, and non-executing. It never extracts archive entries to disk, starts an MCP server, invokes a system archive utility, sends a network request, authenticates to the portal, uploads a package, or claims that OpenAI will accept a submission.

The initial archive ruleset is based on the public OpenAI submission-error reference reviewed on 2026-08-23:

- <https://developers.openai.com/plugins/deploy/submission-errors>
- <https://developers.openai.com/plugins/build/plugins>

## Command Surface

```bash
codex-plugin-doctor doctor submission archive plugin.zip
codex-plugin-doctor doctor submission archive plugin.zip --json
codex-plugin-doctor doctor submission archive plugin.zip --markdown
codex-plugin-doctor doctor submission archive plugin.zip --output archive-report.json
codex-plugin-doctor doctor submission archive plugin.zip --require-ready
```

The command accepts an existing ZIP only. It does not create, normalize, repair, or rewrite an archive.

`doctor submission <directory>` remains unchanged. `doctor submission archive <zip>` reuses the same automatic listing, asset, and skill checks through a read-only package abstraction after the ZIP structure passes its safety gates.

## Target Boundary

The archive command models the skills-only ZIP upload flow.

The following archive contents produce portal-aligned confirmation warnings because they belong to the MCP-backed submission flow:

- a manifest `mcpServers` declaration
- a root `.mcp.json`
- a manifest `apps` declaration
- a root `.app.json`
- `interface.screenshots`

The report tells the author to use the portal's MCP-backed flow. The command does not validate an MCP-backed upload archive or make live MCP calls.

These findings use severity `warn`, retain the matching portal code, and keep `readiness: manual_review_required`. The archive adapter downgrades only these exact skills-only exclusion findings; the existing v1.59 directory-preflight behavior does not change.

Archive blockers are reserved for malformed or unsafe ZIP structures and deterministic invalid-package rules.

## Result Contract

The additive machine-readable surface is `doctor.submission.archive.json` with schema version `1.0.0`.

```json
{
  "schemaVersion": "1.0.0",
  "rulesetVersion": "openai-directory-archive-2026-08-23",
  "status": "pass",
  "readiness": "manual_review_required",
  "archive": {
    "fileName": "plugin.zip",
    "compressedBytes": 123456,
    "uncompressedBytes": 456789,
    "entryCount": 24,
    "rootLayout": "archive-root"
  },
  "summary": {
    "passed": 18,
    "warnings": 0,
    "blockers": 0,
    "manualChecks": 3
  },
  "archiveChecks": [],
  "submission": {},
  "findings": [],
  "coverage": [],
  "manualChecklist": []
}
```

`status` covers deterministic automatic checks only:

- `pass`: no automatic archive or nested submission blocker was found.
- `fail`: at least one automatic blocker was found.

`readiness` remains one of:

- `blocked`
- `manual_review_required`

The archive command never returns `accepted`, `approved`, or an automatic ready state.

### Exit Codes

- `0`: the command completed, including advisory reports that contain blockers.
- `1`: blockers exist and `--require-ready` was supplied.
- `2`: command usage is invalid.

Corrupt, truncated, encrypted, unsupported, or otherwise malformed ZIP input becomes a structured finding rather than an uncaught exception.

## Privacy And Evidence

Reports do not include the absolute ZIP path. The archive summary retains only a sanitized file name and numerical metadata.

Finding evidence is limited to safe scalar locators such as:

- `entryIndex`
- a safe package-relative entry path when the path itself passed text-safety checks
- `field`
- `count`
- `limit`
- compression method identifier

Reports never retain unsafe raw entry names, decompressed file contents, raw manifests, prompts, descriptions, YAML, credentials, CRC payloads, or archive bytes. Text, JSON, Markdown, the GitHub Action manifest, and future signed consumers use the same redacted result model.

## Archive Reader Architecture

The ZIP is inspected without filesystem extraction.

### `submission-archive-reader.ts`

The archive reader owns ZIP-format parsing and bounded entry reads:

- locate and validate EOCD and optional ZIP64 records
- reject multi-disk archives
- stream central-directory entries lazily
- validate central-directory boundaries and offsets
- compare central and local header names, methods, flags, sizes, and CRC metadata
- automatically inspect stored and deflate entries
- permit well-formed 32-bit and ZIP64 data descriptors
- reject encrypted entries as unreadable
- report other well-formed compression methods as unavailable coverage rather than portal failures
- stream every regular stored or deflated entry once during the archive safety phase, validating emitted size and CRC while discarding content
- expose bounded lazy reads to nested validators only after the complete archive safety phase passes
- never retain unrequested decompressed content
- never create a file, directory, symlink, process, or network request

ZIP64 values are accepted only when they are well-formed, fit within JavaScript safe integers, and remain below the public submission limits. ZIP64 does not relax any archive budget.

### `submission-archive-preflight.ts`

The archive preflight owns portal-facing rules, plugin-root discovery, coverage accounting, report aggregation, and exit policy.

### `SubmissionPackageReader`

Directory and archive validators share a small read-only interface:

```ts
interface SubmissionPackageReader {
  list(directory: string): Promise<readonly SubmissionPackageEntry[]>;
  stat(packagePath: string): Promise<SubmissionPackageEntry | null>;
  read(packagePath: string, maxBytes: number): Promise<Uint8Array | null>;
}
```

The interface exposes normalized package-relative paths and bounded bytes. It cannot return an absolute host path or perform a write. Existing directory behavior remains compatible while listing, asset, and skill validators gain an archive-backed reader.

## Automatic Archive Rules

New stable identifiers use the `plugin.submission.archive.*` namespace. When the public reference provides a portal code, it is retained separately as `portalCode`.

### File And ZIP Limits

- input must be a regular `.zip` file
- archive must be non-empty and parseable
- compressed ZIP size must not exceed 100 MB
- entry count must not exceed 5,000
- one entry must not exceed 100 MiB uncompressed
- cumulative uncompressed size must not exceed 512 MiB
- encrypted entries are unreadable blockers; stored and deflated entries receive automatic content validation, while other well-formed methods receive unavailable coverage

Declared sizes are checked before decompression. Actual emitted bytes are counted during decompression, and the reader aborts before a declared or cumulative budget can be exceeded. A small compressed payload cannot expand past the configured limit.

The safety phase streams every regular entry that Doctor can decode, including entries that nested package validation will not request. An unused corrupt member or expansion bomb therefore cannot hide behind lazy package reads.

### Entry Paths And Types

An entry name must:

- be valid supported text
- be non-empty and have no outer whitespace
- use `/`, never `\`
- be relative and contain no drive prefix
- contain no empty or `..` segment
- contain at most 20 segments including the file name

The archive rejects:

- exact duplicate paths
- a path that is both a file and directory
- a file path that contains child entries
- unsupported entry types, including symlinks and device entries

Doctor emits a warning when paths collide under `NFKC` followed by ECMAScript's locale-independent `toLowerCase()` for each segment. This is a reproducible local safety signal, not a claim that the portal uses the same algorithm. The portal's unspecified case and Unicode-normalization algorithm remains `coverage: unavailable` and is never marked automatically passed.

The public reference names a path-length limit without publishing its numeric value. The initial ruleset does not invent one. The report includes a `coverage: unavailable` item for that portal-side limit and never marks it automatically passed.

### ZIP Encoding And Entry Metadata

The reader follows these normative rules:

- when general-purpose flag bit 11 is set, central and local names must be valid UTF-8
- otherwise names are decoded as CP437; undecodable or unsupported text is rejected before it can enter evidence
- central and local raw name bytes must match exactly
- an Info-ZIP Unicode Path extra field does not override the raw-name comparison; when it would change the decoded path, portal filename-decoding parity is reported as unavailable
- general-purpose flag bit 3 requires a data descriptor after the payload
- a data-descriptor signature is optional; CRC and size widths are selected from the entry's ZIP64 state
- local CRC and size placeholders are allowed only when bit 3 is set and the descriptor supplies the authoritative values
- Unix external attributes classify symlinks and device entries by file-type bits; DOS attributes and a trailing `/` classify directories
- contradictory directory/type metadata is rejected
- each local interval runs from its local header through payload and optional descriptor
- local intervals must not overlap one another, the central directory, ZIP64 records, or EOCD; no overlap exception is permitted

Stored and deflate are Doctor's initial reader formats. Because the public reference does not enumerate the portal's supported compression methods, other methods produce unavailable coverage instead of a portal-equivalence failure.

### Central And Local Header Consistency

For each entry, the reader validates:

- local-header offset is within the archive
- central and local raw name bytes match exactly before decoding
- compression methods and relevant flags match
- sizes and CRC metadata are consistent, including data-descriptor cases
- header, payload, descriptor, ZIP64, central-directory, and EOCD ranges remain in bounds and local entry intervals never overlap
- decompressed output matches the expected CRC and size

### Plugin Root

The archive must contain exactly one plugin root:

- files may be at the archive root, or
- all plugin files may be inside one top-level directory

A top-level plugin directory cannot have siblings.

The root must contain one recognized manifest path:

- `.codex-plugin/plugin.json`
- `.agent-plugin/plugin.json`
- `.claude-plugin/plugin.json`

It must also contain at least one immediate `skills/<skill>/SKILL.md`.

For `.claude-plugin` input, the report records the portal's documented normalization behavior. `.agent-plugin` remains a recognized manifest path without a normalization claim. Doctor validates the published fields it can interpret but does not invent undocumented defaults or claim byte-for-byte portal parity.

## Nested Submission Validation

After archive structure and budgets pass, the archive-backed reader runs the existing automatic submission checks:

- package identity and semantic version
- public listing limits and supported text
- skills-only component exclusions
- required branding assets and bounded image validation
- `SKILL.md` identity and body checks
- optional `agents/openai.yaml` schema and contained asset references
- duplicate skill identity and aggregate skill budgets

Nested validation retains the v1.59 manual-review boundary. Identity verification, attestations, safety scans, and any portal judgment remain manual.

## Ruleset And Coverage Governance

The embedded ruleset is `openai-directory-archive-2026-08-23`.

It records:

- official source URLs
- review date
- numeric archive limits
- Doctor-supported compression and ZIP structures
- Doctor's local collision-warning algorithm
- automatic checks
- portal-only or insufficiently documented checks

The command does not download rule updates or scrape documentation. A ruleset update is a reviewed source change with tests and changelog coverage.

Coverage states are:

- `automatic`: Doctor performed the deterministic rule.
- `manual`: the item requires human or portal review.
- `unavailable`: the public source names the rule but does not define enough information for a faithful local implementation.

An unavailable rule never becomes an automatic pass.

The following portal warnings depend on submission history or undocumented normalization and therefore remain manual or unavailable:

- `plugin_name_mismatch`, which requires the previously published identity
- `plugin_version_unchanged`, which requires the previously published version
- `manifest_normalized`, whose exact normalized output is portal-owned
- `developer_name_defaulted`, which depends on the selected verified identity
- `.claude-plugin` normalization details beyond the published fields Doctor can interpret

## GitHub Action

Archive validation is disabled by default:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.60.0
  with:
    submission-archive: ./plugin.zip
    require-submission-ready: "true"
```

The Action emits separate JSON and Markdown archive reports under the existing report directory, exposes their paths as outputs, includes them in the Action artifact manifest, and appends the Markdown result to the step summary.

`require-submission-ready` requires exactly one selected mode: directory `submission: "true"` or a non-empty `submission-archive`. It forwards `--require-ready` to that selected mode. Selecting both modes, or strict readiness with neither mode, records usage status `2` and produces no submission report. Existing Action defaults remain unchanged.

## Dependency Gate

The implementation may use one pure-JavaScript ZIP reader in lazy-entry mode. Before selection, the candidate and its complete production dependency closure must pass:

- no native binary
- no lifecycle or install script
- no more than five newly introduced production packages in the closure
- no more than 2 MiB total unpacked installed size for that closure
- zero production audit findings from `npm audit --omit=dev --audit-level=low`
- zero listed lifecycle scripts from `npm install-scripts ls`
- no more than 100 KiB increase in the Doctor publish tarball reported by `npm pack --dry-run --json`
- support for lazy entries, stored/deflate data, CRC validation, data descriptors, and ZIP64 metadata
- deterministic malformed-input behavior under the required budgets

The adapter remains responsible for Doctor's portal policy, central/local consistency checks, privacy, and resource budgets. A library does not replace those checks.

A compatible dependency is a release prerequisite; the feature is not shipped without one. There is no fallback to `unzip`, PowerShell, shell wrappers, native extraction, or write-to-temp behavior.

## Verification Contract

Implementation is complete only when tests cover:

- valid archive-root and single-top-level-directory packages
- stored and deflated entries
- valid ZIP64 values within all portal limits
- empty, truncated, encrypted, and multi-disk archives, plus unavailable coverage for well-formed unsupported compression
- central/local name, method, flag, CRC, size, and offset mismatch
- valid and missing data descriptors
- an unused corrupt or expansion-bomb entry that nested validation never requests
- overlapping or out-of-range headers and payloads
- path traversal, absolute paths, drive prefixes, backslashes, empty segments, deep paths, and unsafe text
- exact duplicates and file/directory conflicts, plus warning and unavailable-coverage behavior for case/Unicode-normalization collisions
- entry-count, archive-size, member-size, and total-uncompressed limits
- a compressed payload that exceeds its declared or permitted output budget
- CRC mismatch
- ambiguous root, sibling root, missing manifest, and missing skill
- `.codex-plugin`, `.agent-plugin`, and `.claude-plugin` manifest handling
- skills-only exclusions for MCP, app, and screenshot content
- parity between archive-backed and directory-backed submission checks
- text, JSON, Markdown, output contract, completion, exit codes, and output-file equality
- disabled Action behavior, each single selected mode with strict gating, both modes together, and strict gating with neither mode
- no filesystem extraction, process execution, or network request
- no absolute path, unsafe entry name, file content, credential, or decompressed-byte disclosure
- randomized malformed byte inputs that terminate without uncaught exceptions or hangs
- Windows and POSIX path semantics

Release verification includes the complete existing suite, the archive corpus, TypeScript build, dependency audit and install-script checks, source self-scan, package-size inspection, npm pack, fresh install, and release check.

## Baseline Portability Prerequisite

The first implementation task fixes one existing Windows-only test portability defect: `tests/action-metadata.test.ts` compares a multiline Action block with LF-only text while a fresh Windows checkout can contain CRLF. The test will normalize line endings at its assertion boundary without changing `action.yml` or product behavior. The baseline suite must pass before archive feature code begins.

## Out Of Scope

- creating, normalizing, repairing, or rewriting ZIP files
- extracting ZIP entries to disk
- MCP-backed archive submission
- portal login, upload, domain verification, OAuth, or credentials
- live MCP execution
- SARIF for archive findings
- customizable archive limits or heuristic quality scoring
- undocumented portal-limit guesses
- directory-acceptance prediction or guarantee
