# MVP Specification

## Product Scope

The MVP is a local CLI validator that inspects a Codex plugin package and produces a structured report with static checks, optional runtime checks, severity scoring, and remediation guidance.

## Primary Command

```bash
codex-plugin-doctor check .
codex-plugin-doctor check . --runtime
codex-plugin-doctor check . --json
codex-plugin-doctor check --config ~/.codex/config.toml
```

## Core Use Cases

### Plugin Author Validation

A plugin author runs the tool locally before release and gets a clear PASS/WARN/FAIL report.

### CI Gate

A GitHub Action fails a pull request if blocking issues exist.

### Support Reproduction

A support engineer runs the same validation against a customer-provided plugin bundle and gets a comparable machine-readable report.

## In-Scope Checks

### Package Structure

- `.codex-plugin/plugin.json` existence
- required manifest fields
- file reference integrity
- invalid relative paths

### Skill Checks

- `SKILL.md` presence where referenced
- missing support files
- description and trigger quality heuristics
- broken references to scripts, templates, assets, and examples

### MCP Configuration Checks

- malformed server definitions
- invalid `command`, `args`, `cwd`, and env references
- unsupported or suspicious execution patterns
- obviously hard-coded secrets

### Runtime Checks

- process start success
- timeout detection
- startup crash capture
- `tools/list` response validation
- tool count and response sanity

### Schema and Context Heuristics

- oversized descriptions
- bloated tool schemas
- expensive default exposure patterns
- suspicious prompt/resource verbosity

### Reporting

- terminal summary
- JSON output
- Markdown summary for CI

## Out of Scope

- desktop application
- full OAuth browser automation
- marketplace publishing
- cross-client compatibility certification
- hosted dashboards
- automatic fix application

## Example Report Shape

```text
Status: FAIL
Score: 61/100

FAIL  plugin.manifest.missing_field
FAIL  mcp.runtime.tools_list_timeout
WARN  skill.description.too_broad
WARN  schema.context_bloat
PASS  config.command_exists
PASS  config.cwd_exists
```

## Exit Code Policy

| Exit code | Meaning |
| --- | --- |
| 0 | No blocking issues |
| 1 | Blocking validation failures |
| 2 | Internal tool error |

## Acceptance Criteria

- The CLI can validate a local package path.
- The CLI can emit text and JSON reports.
- The runtime probe can start a supported stdio server and detect major failures.
- The report groups issues by severity and category.
- CI usage works without custom scripts.
- Documentation includes examples for local use and pull request integration.

