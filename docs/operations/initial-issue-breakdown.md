# Initial Issue Breakdown

## Epic 1: Repository Foundation

### Issue 1.1

Set up Node.js and TypeScript project structure for the CLI.

### Issue 1.2

Add test harness with Vitest and fixture discovery utilities.

### Issue 1.3

Initialize repository standards: README, ignore rules, scripts, and build target.

## Epic 2: Minimal Validation Flow

### Issue 2.1

Implement package root discovery and required manifest lookup.

### Issue 2.2

Validate minimal `.codex-plugin/plugin.json` requirements.

### Issue 2.3

Validate skill directory references when the manifest declares `skills`.

### Issue 2.4

Produce a text summary with PASS/WARN/FAIL categories and exit code mapping.

## Epic 3: Developer Workflow

### Issue 3.1

Add `check` command to the CLI.

### Issue 3.2

Add JSON output for CI consumption.

### Issue 3.3

Create GitHub Action packaging after the CLI contract is stable.

## Epic 4: Next Validation Layers

### Issue 4.1

Add `.mcp.json` discovery and structural validation.

### Issue 4.2

Add runtime startup probing behind `--runtime`.

### Issue 4.3

Add schema and context-bloat heuristics.

### Issue 4.4

Add security checks for dangerous env usage and path traversal.

