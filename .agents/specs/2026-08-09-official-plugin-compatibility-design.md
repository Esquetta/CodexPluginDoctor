# Official Plugin Compatibility Design

**Target release:** 1.58.0

**Date:** 2026-08-09

**Status:** Approved for implementation planning

## Summary

Version 1.58.0 will align Codex Plugin Doctor with the current official plugin packaging surfaces while preserving the additive compatibility guarantees of the 1.x line. The release will normalize all supported `.mcp.json` layouts, validate the expanded plugin manifest, inspect referenced app and lifecycle-hook definitions, and report failures through the existing finding and output systems.

All new validation is local, read-only, and static. The validator will not execute hooks, start apps, fetch URLs, authenticate, publish, or modify the target package.

## Goals

- Accept the current official `.mcp.json` layouts without rejecting valid packages.
- Preserve support for the existing camel-case `mcpServers` wrapper.
- Give static validation, compatibility checks, runtime planning, and runtime probing one normalized MCP server model.
- Validate optional manifest fields when they are present.
- Validate referenced `.app.json`, hook, and asset paths without executing package code.
- Reuse the existing security audit for hook command surfaces where its rules apply.
- Add findings without changing existing rule identifiers, default severities, report shapes, or exit-code semantics.
- Restore release-history consistency by documenting the shipped 1.56.0 and 1.57.0 changes before adding the 1.58.0 entry.

## Non-goals

- Executing lifecycle hooks or apps
- Automatically repairing manifests or component files
- Marketplace manifest validation
- Authenticated remote MCP probing
- User-defined runtime behavior scenarios
- Hosted reporting, data upload, or an Electron interface
- Breaking changes to existing public output contracts

## Architecture

The validation pipeline remains:

```text
plugin manifest
  -> referenced-path resolution
  -> package-root containment checks
  -> MCP, app, hook, and asset parsing
  -> normalized component models
  -> deterministic findings
  -> existing text, JSON, Markdown, and SARIF reporters
```

The implementation will add one shared MCP configuration normalizer. Existing callers that currently interpret `.mcp.json` independently will consume its normalized server map instead. App and hook parsing will remain focused validators in the existing validation layer; this release will not introduce a general plugin framework or executable extension mechanism.

## MCP Configuration Normalization

The normalizer will accept three layouts:

1. A direct top-level server map, as supported by the current official package format.
2. A top-level `mcp_servers` wrapper containing the server map.
3. The existing top-level `mcpServers` wrapper, retained for 1.x compatibility.

Each accepted layout produces the same internal `Record<string, McpServerConfig>` model. Downstream validation must not need to know which source layout was used.

### Shape rules

- The root must be a plain JSON object.
- The normalized server map must be non-empty.
- Every server name must map to a plain server configuration object.
- A file containing both wrapper keys, or a wrapper key plus direct server entries, is ambiguous and fails.
- An empty wrapper or direct map fails through the existing invalid-shape behavior.
- Invalid JSON continues to use the existing invalid-JSON behavior.
- Existing safe-path, command, environment, remote URL, runtime policy, and redaction checks apply after normalization.

The new ambiguity finding will use `plugin.mcp.ambiguous_shape`. Existing `plugin.mcp.invalid_json` and `plugin.mcp.invalid_shape` meanings remain compatible.

## Manifest Validation

The manifest model will recognize the current optional publication and component fields, including author, homepage, repository, license, keywords, apps, hooks, and interface metadata.

Absence of an optional field is not a failure. When a field is present:

- its JSON type and documented structure must be valid;
- URL-valued metadata must be syntactically valid HTTP or HTTPS URLs, with no network request;
- component and asset paths must begin with `./`;
- resolved local paths must remain inside the canonical plugin root;
- referenced files must exist and have the expected file type;
- absolute paths, traversal, and canonical or symlink escapes fail closed.

Manifest findings will use stable identifiers under `plugin.manifest.*`. Structural field failures use `plugin.manifest.invalid_field`; unsafe or invalid component paths use `plugin.manifest.invalid_path`.

## App Definition Validation

Each manifest-referenced `.app.json` file will be parsed without loading or executing its implementation.

Validation covers:

- safe, root-contained reference resolution;
- file existence and readable JSON;
- a plain-object root;
- documented field types;
- safe local asset and component references;
- syntactically valid external URLs where the schema permits them.

App findings use:

- `plugin.app.missing_file`
- `plugin.app.invalid_json`
- `plugin.app.invalid_shape`
- `plugin.app.invalid_path`

The validator will not fetch linked assets, render UI, or infer application behavior.

## Lifecycle Hook Validation

Hook definitions may come from the documented default hook file, manifest-referenced hook files, or supported inline manifest definitions. All forms normalize into a static hook definition model before rule evaluation.

Validation covers:

- supported event and definition shapes;
- safe, root-contained file and script references;
- referenced script existence;
- documented `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` placeholders;
- malformed, absolute, traversal, or out-of-root paths;
- static command and environment inspection using applicable existing security heuristics.

The presence of a hook is not itself a warning. Unsafe command patterns, encoded shell commands, remote-content-to-shell patterns, and secret-like literal environment values retain the severity of the corresponding existing security rule.

Hook-specific findings use:

- `plugin.hook.missing_file`
- `plugin.hook.invalid_json`
- `plugin.hook.invalid_shape`
- `plugin.hook.invalid_path`
- `plugin.hook.unsupported_event`

No hook process is spawned during validation, runtime planning, runtime probing, release checking, or report generation.

## Findings, Evidence, and Output Compatibility

New findings flow through the existing finding model and reporters.

- Broken JSON, invalid required structure, missing referenced files, traversal, canonical-root escapes, and dangerous hook command patterns are failures.
- Advisory metadata quality issues are warnings only when the official contract describes the field as recommended rather than required.
- Evidence contains package-relative paths and field names only.
- Raw file contents, secret values, remote response bodies, and absolute host paths are not retained.
- Existing JSON schemas remain valid through additive rule identifiers and optional evidence fields.
- Existing text, Markdown, JSON, and SARIF status and exit-code behavior does not change.

## Data Flow and Failure Behavior

1. Resolve and parse the plugin manifest.
2. Resolve every referenced path against the canonical plugin root.
3. Reject unsafe paths before reading the referenced target.
4. Parse MCP, app, and hook files with bounded local reads.
5. Normalize supported source shapes.
6. Run component-specific structural rules and applicable existing security rules.
7. Stop runtime execution when static validation contains a failure, matching current fail-closed behavior.
8. Render normalized findings through the selected existing output format.

Independent component failures are accumulated when safe to do so. A malformed or unsafe reference prevents only that referenced component from being read; it does not suppress findings from other independently readable components.

## Testing Strategy

### MCP normalization

- Direct map, `mcp_servers`, and legacy `mcpServers` fixtures produce equivalent normalized models.
- Both wrapper keys fail as ambiguous.
- A wrapper plus direct entries fails as ambiguous.
- Empty maps, non-object roots, non-object server definitions, and invalid JSON fail deterministically.
- Existing MCP fixtures and public output snapshots remain compatible.

### Manifest, app, and hook validation

- Valid optional manifest fields pass.
- Missing optional fields remain neutral.
- Wrong field types and invalid URLs produce the expected findings.
- Valid app and hook references pass on Windows and POSIX path semantics.
- Missing files, malformed JSON, absolute paths, traversal, and canonical or symlink escapes fail.
- Valid placeholders pass; malformed or unsafe path expansion fails.
- Hook security fixtures cover shell wrappers, encoded commands, remote-content-to-shell behavior, and secret-like environment literals.
- Tests prove that hook and app processes are never spawned.

### Integration and release verification

- Static check, compatibility matrix, runtime plan, runtime probe, release check, and GitHub Action paths consume the same normalized MCP model.
- Text, JSON, Markdown, SARIF, rule catalog, and output-contract tests cover the new findings.
- Targeted tests pass before the full test suite.
- `npm test`, `npm run build`, `npm run release-check`, and `npm pack --dry-run` pass.
- The working tree contains only intentional changes; the pre-existing user modification to `package-lock.json` is excluded from this work.

## Delivery Sequence

1. Add the shared MCP normalizer and migrate existing readers.
2. Add expanded manifest field and path validation.
3. Add `.app.json` static validation.
4. Add hook normalization and static security validation.
5. Extend rule catalog, reporters, output contracts, fixtures, and documentation.
6. Restore the missing 1.56.0 and 1.57.0 changelog entries and add the 1.58.0 release entry when implementation is complete.
7. Run targeted, full, build, release, and package verification gates.

Each step must leave existing tests passing and must not broaden runtime execution or network authority.

## Acceptance Criteria

- All three `.mcp.json` layouts are accepted and normalized consistently.
- Legacy valid packages retain their current result.
- Ambiguous configuration never receives a guessed interpretation.
- Current official manifest, app, and hook structures receive deterministic static validation.
- Unsafe references are rejected before file reads or process execution.
- Hooks and apps are never executed.
- Findings expose no secrets, raw component contents, or absolute host paths.
- Existing 1.x public contracts remain backward compatible.
- The missing changelog history is restored from actual shipped commits.
- All targeted and repository-level verification gates pass.
