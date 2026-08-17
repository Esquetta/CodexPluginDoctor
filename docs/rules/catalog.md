# Rule Catalog

This catalog documents stable Codex Plugin Doctor finding IDs.

Use the CLI for a focused explanation:

```bash
codex-plugin-doctor explain plugin.manifest.missing
```

## Package Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.manifest.missing` | fail | Target is not a Codex plugin package root because `.codex-plugin/plugin.json` is missing. |
| `plugin.manifest.name.missing` | fail | Plugin manifest is missing `name`. |
| `plugin.manifest.version.missing` | fail | Plugin manifest is missing `version`. |
| `plugin.manifest.description.missing` | fail | Plugin manifest is missing `description`. |
| `plugin.manifest.invalid_field` | fail | A plugin manifest optional field is invalid. |
| `plugin.manifest.invalid_path` | fail | A plugin manifest path is not a safe package-relative path. |
| `plugin.app.missing_file` | fail | Manifest points to a missing `.app.json` file. |
| `plugin.app.invalid_json` | fail | Referenced `.app.json` file is not valid JSON. |
| `plugin.app.invalid_path` | fail | A plugin app path is not a safe package-relative path. |
| `plugin.hook.missing_file` | fail | Plugin lifecycle hook source file is missing. |
| `plugin.hook.invalid_json` | fail | Plugin lifecycle hook source is not valid JSON. |
| `plugin.hook.invalid_shape` | fail | Plugin lifecycle hook configuration has an invalid shape. |
| `plugin.hook.invalid_path` | fail | Plugin lifecycle hook source is not a safe package-relative path. |
| `plugin.hook.unsupported_event` | fail | Plugin lifecycle hook event is not supported. |
| `plugin.hook.unsupported_handler` | warn | Plugin lifecycle hook uses a handler type the host skips. |
| `plugin.hook.async_unsupported` | warn | Plugin lifecycle hook requests unsupported asynchronous execution. |
| `plugin.hook.matcher_ignored` | warn | Plugin lifecycle hook matcher is ignored for this event. |
| `plugin.heuristic.description.too_long` | warn | Plugin description is likely too verbose. |

## Skill Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.skills.path.missing` | fail | Manifest references a missing skills directory. |
| `plugin.skill.skill_md.missing` | fail | A skill directory is missing `SKILL.md`. |
| `plugin.skill.name.missing` | fail | Skill frontmatter is missing `name`. |
| `plugin.skill.description.missing` | fail | Skill frontmatter is missing `description`. |
| `plugin.heuristic.skill_description.too_long` | warn | Skill description is likely too verbose. |
| `plugin.skill.asset_reference.missing` | warn | Skill references a missing local support asset such as `scripts/...`, `templates/...`, `assets/...`, or `examples/...`. |

## Public Directory Submission Preflight Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.submission.package.invalid` | fail | Plugin manifest is missing or invalid for submission preflight. |
| `plugin.submission.package.too_large` | fail | Plugin manifest exceeds the submission preflight size limit. |
| `plugin.submission.package.name` | fail | Plugin package name is invalid for the listing. |
| `plugin.submission.package.version` | fail | Plugin version is not valid semantic versioning. |
| `plugin.submission.interface.required` | fail | Listing interface metadata is required. |
| `plugin.submission.interface.display_name` | fail | Listing display name is missing or invalid. |
| `plugin.submission.interface.short_description` | fail | Listing short description is missing or invalid. |
| `plugin.submission.interface.long_description` | fail | Listing long description is missing or invalid. |
| `plugin.submission.interface.developer_name` | fail | Listing developer name is missing or invalid. |
| `plugin.submission.interface.category` | fail | Listing category is missing or unsupported. |
| `plugin.submission.interface.capabilities` | fail | Listing capabilities are not a valid bounded list. |
| `plugin.submission.interface.capability` | fail | A listing capability is invalid. |
| `plugin.submission.interface.default_prompt` | fail | Listing starter prompts are invalid or duplicated. |
| `plugin.submission.interface.url` | fail | A required listing URL is invalid. |
| `plugin.submission.interface.unknown_field` | warn | Listing metadata includes an unsupported field. |
| `plugin.submission.component.app` | fail | App declaration must reference a contained parseable root file. |
| `plugin.submission.component.excluded` | fail | A component is not allowed for this submission target type. |
| `plugin.submission.app.invalid_path` | fail | App declaration resolves outside the package. |
| `plugin.submission.asset.required` | fail | A required branding asset is missing. |
| `plugin.submission.asset.invalid_path` | fail | Branding asset path is invalid. |
| `plugin.submission.asset.missing` | fail | Branding asset cannot be found or read. |
| `plugin.submission.asset.unsupported_format` | fail | Branding asset format or file type is unsupported. |
| `plugin.submission.asset.too_large` | fail | Branding asset exceeds the size limit. |
| `plugin.submission.asset.unsafe_svg` | fail | SVG branding asset is unsafe or invalid. |
| `plugin.submission.asset.decode_failed` | fail | Branding asset cannot be decoded safely. |
| `plugin.submission.asset.extension_mismatch` | fail | Branding asset extension does not match its content. |
| `plugin.submission.asset.dimensions` | fail | Branding asset dimensions are outside the allowed range. |
| `plugin.submission.asset.not_square` | fail | Branding asset must be square. |
| `plugin.submission.skill.required` | fail | Skills-only submission requires a valid skill. |
| `plugin.submission.skill.invalid_manifest` | fail | Skills declaration must use the root skills directory. |
| `plugin.submission.skill.invalid_path` | fail | Skill path is not safely contained in the package. |
| `plugin.submission.skill.invalid_file` | fail | Skill entrypoint is not a valid contained file. |
| `plugin.submission.skill.invalid_yaml` | fail | Skill frontmatter YAML is invalid or unsafe. |
| `plugin.submission.skill.invalid_shape` | fail | Skill frontmatter has an unsupported shape. |
| `plugin.submission.skill.identity` | fail | Skill identity metadata is invalid or duplicated. |
| `plugin.submission.skill.too_many` | fail | Skills directory exceeds the bounded submission preflight entry or skill limit. |
| `plugin.submission.skill.budget_exceeded` | fail | Skill metadata exceeds the aggregate submission preflight size limit. |
| `plugin.submission.skill.agent.invalid_path` | fail | Optional agent metadata path is invalid. |
| `plugin.submission.skill.agent.invalid_file` | fail | Optional agent metadata is not a valid contained file. |
| `plugin.submission.skill.agent.invalid_yaml` | fail | Optional agent metadata YAML is invalid or unsafe. |
| `plugin.submission.skill.agent.invalid_shape` | fail | Optional agent metadata has an unsupported shape. |

## MCP Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.mcp.path.missing` | fail | Manifest references a missing `.mcp.json` file. |
| `plugin.mcp.invalid_json` | fail | MCP config is not valid JSON. |
| `plugin.mcp.invalid_shape` | fail | MCP config does not contain one non-empty direct map, `mcp_servers`, or legacy `mcpServers` wrapper. |
| `plugin.mcp.ambiguous_shape` | fail | MCP config mixes multiple supported layout forms. |
| `plugin.mcp.server.invalid` | fail | MCP server entry is not an object. |
| `plugin.mcp.server.transport.missing` | fail | MCP server entry is missing both `command` and `url`. |
| `mcp.server.transport.conflict` | fail | An MCP server defines both command and URL transports. |
| `plugin.mcp.server.transport.conflict` | fail | A bundled MCP server defines both command and URL transports. |

## Security Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.security.path_traversal` | fail | Manifest path escapes the plugin package root. |
| `plugin.security.hard_coded_secret` | fail | MCP server env config contains a literal secret-like value. |
| `plugin.security.audit_unavailable` | fail | Security audit cannot inspect the package or MCP config surface. |
| `plugin.security.command_shell_wrapper` | warn | MCP server starts through a shell wrapper such as `powershell`, `cmd`, `bash`, or `sh`. |
| `plugin.security.encoded_command` | fail | MCP server uses an encoded shell command payload. |
| `plugin.security.remote_pipe_install` | fail | MCP server appears to pipe remote content into a shell. |
| `plugin.security.path_traversal_risk` | fail | MCP server passes a package-external path to a path-like runtime argument. |
| `plugin.security.dangerous_env_usage` | fail | MCP server sets an environment variable that can alter code loading. |
| `plugin.security.cwd_outside_root` | fail | MCP server `cwd` resolves outside the plugin package root. |
| `plugin.security.insecure_http_url` | fail | MCP server uses a plain HTTP URL. |
| `plugin.security.remote_mcp_url.invalid` | fail | An MCP server URL is not an absolute HTTP or HTTPS URL. |
| `plugin.security.remote_mcp_url.unsupported_scheme` | fail | An MCP server URL uses an unsupported scheme. |
| `plugin.security.remote_mcp_url.credentials` | fail | An MCP server URL embeds credentials. |
| `plugin.security.remote_mcp_url.query` | fail | An MCP server URL contains a query string. |
| `plugin.security.remote_mcp_url.fragment` | fail | An MCP server URL contains a fragment. |
| `plugin.security.remote_mcp_url.ip_literal` | fail | An MCP server URL uses a numeric IP literal. |
| `plugin.security.prompt_injection_text` | fail | Packaged text contains prompt-injection or secret-exfiltration instructions. |

## Runtime Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.runtime.exited_early` | fail | MCP server exited before startup probing completed. |
| `plugin.runtime.initialize.timeout` | fail | MCP server did not answer `initialize` in time. |
| `plugin.runtime.protocol.invalid_message` | fail | MCP server wrote invalid protocol data to stdout. |

Runtime probing can emit additional method-specific timeout and invalid-shape IDs for `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, and `prompts/get`. These follow the same remediation pattern: verify the server responds to the MCP method with a valid JSON-RPC result before packaging it.
