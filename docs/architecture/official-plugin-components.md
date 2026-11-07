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

Optional metadata is checked only when present. This includes author, homepage, repository, license, keywords, interface values, and local asset paths. URL metadata must be syntactically valid HTTP or HTTPS; Doctor does not make network requests. Local component and asset paths must start with `./` and remain inside the package after path and canonical-path resolution. `skills` can be one path or a list of paths, and each listed directory is checked once; `interface.defaultPrompt` can be one string or a list of strings. Codex collapses whitespace in each default prompt, ignores one that is empty or longer than 128 characters, and uses the first three that remain, so Doctor warns about each prompt it ignores. A missing or blank `name`, `version`, or `description`, or a `null` `version` or `description`, is a warning, since Codex loads the plugin and names it after its folder when `name` is blank; a policy still fails on these warnings. Any other non-string value in these fields fails, because Codex then does not load the manifest. An inline `mcpServers` object is not yet supported and fails as an invalid field.

An `apps` reference must point to an existing, readable JSON file within the package. The internal `.app.json` schema is not published, so Doctor validates only the reference path, regular-file presence, and JSON syntax. A parseable JSON value is accepted; Doctor does not infer fields, load assets, render an app, or infer app behavior.

## Lifecycle hooks

When the manifest does not define `hooks`, Doctor discovers `hooks/hooks.json` only if that default file exists. A manifest hook source takes precedence over that optional default. Hook files and referenced paths are validated statically and must remain inside the package.

Supported events are `PreModelRequest`, `PostModelRequest`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`, `SessionStart`, `SubagentStart`, `SessionEnd`, and `Interrupt`, as in Codex 0.164.0 and later. Other events fail validation. A hook configuration may have only `description` and `hooks` at the top level, because Codex skips every hook in a configuration with any other key. Codex shortens a `SessionEnd` or `Interrupt` timeout over 3 seconds to 3 seconds, so Doctor warns about it.

Handlers are `command` or `mcp_tool`. An `mcp_tool` handler needs non-empty `server` and `tool` strings; `input` is an optional object without `null` values, and `timeout` and `statusMessage` follow the command handler rules. Prompt and agent handlers, and `mcp_tool` handlers on `SessionEnd`, are reported as unsupported because this host skips them. `async: true` is accepted on command handlers and reported on `SessionEnd`, which runs hooks synchronously, and on other handler types, which have no `async` field. Matchers on `PreModelRequest`, `PostModelRequest`, `UserPromptSubmit`, `Stop`, and `Interrupt` are accepted but reported as ignored, as is `additionalContextLimit` on a command handler for any event other than `PreToolUse`, `PostToolUse`, `SessionStart`, `UserPromptSubmit`, and `SubagentStart`, the events that can add context.

Command handlers receive static security checks where applicable. No hook process is spawned during validation, compatibility checks, runtime planning, runtime probing, or report generation.

## Reports

Text, Markdown, JSON, and SARIF reports preserve their existing schemas and exit behavior. Finding evidence uses package-relative paths and field names; reports do not retain absolute host paths, command content, secrets, or remote response bodies.
