# Official Plugin Components

Codex Plugin Doctor statically validates the supported package configuration surfaces. It reads local package files only: it does not execute hooks or apps, start MCP servers, fetch URLs, authenticate, publish, or change package or client configuration.

## MCP package configuration

Package `.mcp.json` files can use one of these layouts:

1. A direct top-level server map.
2. An `mcp_servers` wrapper containing the server map.
3. The legacy `mcpServers` wrapper.

Use exactly one non-empty layout. A file that combines wrapper keys, or a wrapper with direct server entries, is ambiguous and fails validation rather than being guessed. Invalid JSON and invalid server-map shapes remain failures.

Doctor normalizes accepted package input before validation and compatibility checks. Destination client configs and install previews remain camel-case `mcpServers`; this package-input compatibility does not change client configuration shapes.

## Optional metadata and apps

Optional metadata is checked only when present. This includes author, homepage, repository, license, keywords, interface values, and local asset paths. URL metadata must be syntactically valid HTTP or HTTPS; Doctor does not make network requests. Local component and asset paths must start with `./` and remain inside the package after path and canonical-path resolution.

An `apps` reference must point to an existing, readable JSON file within the package. The internal `.app.json` schema is not published, so Doctor validates only the reference path, regular-file presence, and JSON syntax. A parseable JSON value is accepted; Doctor does not infer fields, load assets, render an app, or infer app behavior.

## Lifecycle hooks

When the manifest does not define `hooks`, Doctor discovers `hooks/hooks.json` only if that default file exists. A manifest hook source takes precedence over that optional default. Hook files and referenced paths are validated statically and must remain inside the package.

Supported events are `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `SessionStart`, `SubagentStart`, and `SessionEnd`. Other events fail validation. Prompt and agent handlers are reported as unsupported because this host skips them; `async: true` is also reported because asynchronous hooks are unsupported. Matchers on `Stop` and `UserPromptSubmit` are accepted but reported as ignored.

Command handlers receive static security checks where applicable. No hook process is spawned during validation, compatibility checks, runtime planning, runtime probing, or report generation.

## Reports

Text, Markdown, JSON, and SARIF reports preserve their existing schemas and exit behavior. Finding evidence uses package-relative paths and field names; reports do not retain absolute host paths, command content, secrets, or remote response bodies.
