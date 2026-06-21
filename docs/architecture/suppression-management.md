# Suppression Management

## Purpose

The suppression command family manages exact finding exceptions in `.codex-doctor.json` without requiring users to edit JSON manually.

It complements targeted suppression evaluation. It does not replace rule-level `ignoreRules`, create wildcard exceptions, or support permanent suppressions.

## Command Surface

```bash
codex-plugin-doctor suppress add <path>
codex-plugin-doctor suppress list <path>
codex-plugin-doctor suppress remove <path>
```

All commands accept `--config <path>` when the configuration file is outside the target package root. `add`, `list`, and `remove` accept `--json` for automation.

## Add

### Interactive Mode

```bash
codex-plugin-doctor suppress add .
```

Interactive add:

1. Runs the normal configured package check.
2. Lists active findings that have fingerprints.
3. Excludes `suppression.invalid` and `suppression.expired` governance findings.
4. Prompts for one finding number.
5. Prompts for a non-empty review reason.
6. Offers an expiration date 30 calendar days from the current local date.
7. Writes one suppression after confirmation.

The user may replace the proposed date with another real `YYYY-MM-DD` date. Empty input accepts the proposed date.

Interactive mode requires readable stdin. If no interactive input is available, the command fails and explains which flags are required.

### Flag Mode

```bash
codex-plugin-doctor suppress add . \
  --fingerprint <64-character-lowercase-sha256> \
  --reason "Accepted until the upstream package is fixed." \
  --expires-at 2026-07-21
```

Flag mode requires all three values. It validates the fingerprint, trimmed reason, and real expiration date before reading or writing the configuration.

An existing record with the same fingerprint blocks add, including a malformed or expired record. The command reports the existing record index so the user can remove or repair it instead of creating ambiguous duplicates.

## List

```bash
codex-plugin-doctor suppress list .
codex-plugin-doctor suppress list . --json
```

List reads suppression records without running plugin validation. Each record is reported with:

- zero-based configuration index
- fingerprint when present
- reason when present
- expiration date when present
- status: `active`, `expired`, or `invalid`
- invalid field when validation fails

An empty or missing config produces a successful empty result.

## Remove

### Interactive Mode

```bash
codex-plugin-doctor suppress remove .
```

Interactive remove lists all suppression records by configuration index, including invalid and expired records. The user selects one record and confirms deletion.

### Flag Mode

```bash
codex-plugin-doctor suppress remove . --fingerprint <sha256>
codex-plugin-doctor suppress remove . --index 2
```

`--index` removes exactly one array entry.

`--fingerprint` succeeds only when exactly one record matches. Zero matches return a not-found error. Multiple matches return an ambiguity error and require `--index`; the command never removes duplicate records in bulk.

## Configuration Preservation

Suppression management operates on the raw JSON object rather than the normalized validation config.

The writer:

- preserves `ignoreRules`, `failOnWarnings`, and unknown top-level fields
- preserves suppression record order
- creates `.codex-doctor.json` when add targets a missing config
- refuses to modify malformed JSON or a non-object root
- writes formatted JSON with a trailing newline
- writes a temporary file in the same directory and replaces the target only after the complete content is written
- removes the temporary file after a failed replacement when possible

The current config must remain intact when validation or replacement fails.

## JSON Results

Successful machine-readable responses use these command-specific shapes:

```json
{
  "command": "suppress.add",
  "configPath": "/package/.codex-doctor.json",
  "index": 0,
  "suppression": {
    "fingerprint": "<sha256>",
    "reason": "Accepted until the upstream package is fixed.",
    "expiresAt": "2026-07-21"
  }
}
```

```json
{
  "command": "suppress.list",
  "configPath": "/package/.codex-doctor.json",
  "suppressions": [
    {
      "index": 0,
      "status": "active",
      "fingerprint": "<sha256>",
      "reason": "Accepted until the upstream package is fixed.",
      "expiresAt": "2026-07-21"
    }
  ]
}
```

```json
{
  "command": "suppress.remove",
  "configPath": "/package/.codex-doctor.json",
  "index": 0,
  "suppression": {
    "fingerprint": "<sha256>",
    "reason": "Accepted until the upstream package is fixed.",
    "expiresAt": "2026-07-21"
  }
}
```

Errors keep the existing CLI convention: a concise stderr message and non-zero exit code. No partial success response is emitted.

## Module Boundaries

The implementation uses three focused layers:

1. A config-store module reads raw JSON, validates the root, and performs safe replacement.
2. A suppression-management module validates records and implements add, list, and remove transformations.
3. The CLI layer parses flags, handles prompts, renders results, and selects exit codes.

Suppression record validation is shared with the existing evaluator so management commands and package checks cannot disagree about fingerprint, reason, date, or expiration semantics.

## Verification

Unit tests cover:

- raw config preservation
- missing and malformed config behavior
- record validation and status classification
- duplicate detection
- exact-index removal
- ambiguous fingerprint removal
- failed replacement preserving the original file

CLI tests cover:

- interactive add with the 30-day default
- flag-based add
- list text and JSON output
- interactive remove
- index and fingerprint removal
- non-interactive missing flags
- governance findings excluded from add selection

Release verification includes the full test suite, TypeScript build, and a global CLI smoke test against a temporary plugin package.

## Scope Boundary

This version does not include:

- suppression renewal
- wildcard or rule-level suppression creation
- permanent suppression
- automatic suppression from CI output
- baseline files
- bulk removal
- editor integration
