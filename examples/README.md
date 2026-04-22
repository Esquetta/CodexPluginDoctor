# Examples

This folder contains manual example packs for local testing. Unlike `tests/fixtures`, these examples are meant for humans to run directly against the CLI.

## Example Packs

### `codex-doctor-starter`

Minimal valid Codex plugin package with one skill and no runtime MCP server.

Expected result:

- static validation passes
- no runtime probing needed

Command:

```bash
codex-plugin-doctor check examples/codex-doctor-starter
```

### `codex-doctor-runtime`

Valid Codex plugin package with:

- skill metadata
- `.mcp.json`
- mock MCP stdio server
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `resources/templates/list`
- `prompts/list`
- `prompts/get`

Expected result:

- static validation passes
- runtime validation passes
- runtime scorecard shows all supported runtime capabilities as `pass`

Command:

```bash
codex-plugin-doctor check examples/codex-doctor-runtime --json --runtime --verbose-runtime
```

### `codex-doctor-risky`

Intentionally flawed package for showing failure output.

Expected result:

- security finding for hard-coded secret

Command:

```bash
codex-plugin-doctor check examples/codex-doctor-risky --ascii
```

## Suggested Local Flow

```bash
npm install
npm run build
npm link
codex-plugin-doctor check examples/codex-doctor-starter
codex-plugin-doctor check examples/codex-doctor-runtime --json --runtime --verbose-runtime
codex-plugin-doctor check examples/codex-doctor-risky --ascii
```

