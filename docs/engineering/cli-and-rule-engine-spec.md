# CLI and Rule Engine Specification

## CLI Commands

### `check`

Validate a package path or config path.

```bash
codex-plugin-doctor check .
codex-plugin-doctor check . --runtime
codex-plugin-doctor check . --json --output report.json
codex-plugin-doctor check --config ~/.codex/config.toml
```

### `explain`

Show a detailed explanation for a specific finding identifier.

```bash
codex-plugin-doctor explain plugin.manifest.missing_field
```

### `rules`

List supported validation rules and severities.

```bash
codex-plugin-doctor rules
```

## CLI Flags

| Flag | Purpose |
| --- | --- |
| `--runtime` | enable runtime probe checks |
| `--json` | emit machine-readable JSON |
| `--markdown` | emit Markdown summary |
| `--output <path>` | write report to file |
| `--config <path>` | validate from explicit config path |
| `--timeout <ms>` | override runtime probe timeout |
| `--strict` | fail on warnings as well as failures |

## Rule Categories

### Structure

- missing manifest fields
- invalid paths
- missing referenced files

### Skills

- missing `SKILL.md`
- low-quality descriptions
- broken asset and script references

### Configuration

- invalid command definition
- missing env vars
- suspicious hard-coded secrets

### Runtime

- startup crash
- timeout
- tool discovery failure
- malformed tool metadata

### Efficiency

- context bloat
- verbose schemas
- overexposed tool surfaces

### Security

- secret leakage risk
- dangerous command patterns
- unsafe working directory patterns

## Finding Schema

```json
{
  "id": "mcp.runtime.tools_list_timeout",
  "severity": "fail",
  "category": "runtime",
  "title": "Tool discovery timed out",
  "message": "The MCP server started but did not return tools within the configured timeout.",
  "impact": "Users may see the package install successfully but no usable tools will appear.",
  "evidence": {
    "timeoutMs": 8000,
    "stderrPreview": "Starting server..."
  },
  "recommendedFix": "Reduce startup cost or raise the default readiness timeout."
}
```

## Severity Model

- `pass`: no issue detected
- `warn`: issue is non-blocking but likely harmful
- `fail`: issue should block release

## Scoring Model

Base score starts at `100`.

- subtract `20` per fail
- subtract `7` per warn
- cap minimum score at `0`

The score is a prioritization aid, not a compliance claim.

## Report Design Rules

- keep titles short and specific
- explain user impact in plain language
- do not hide evidence
- recommend the next concrete fix

