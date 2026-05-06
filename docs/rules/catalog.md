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

## MCP Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.mcp.path.missing` | fail | Manifest references a missing `.mcp.json` file. |
| `plugin.mcp.invalid_json` | fail | MCP config is not valid JSON. |
| `plugin.mcp.invalid_shape` | fail | MCP config does not contain a valid `mcpServers` object. |
| `plugin.mcp.server.invalid` | fail | MCP server entry is not an object. |
| `plugin.mcp.server.transport.missing` | fail | MCP server entry is missing both `command` and `url`. |

## Security Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.security.path_traversal` | fail | Manifest path escapes the plugin package root. |
| `plugin.security.hard_coded_secret` | fail | MCP server env config contains a literal secret-like value. |
| `plugin.security.audit_unavailable` | fail | Security audit cannot inspect the package or MCP config surface. |
| `plugin.security.command_shell_wrapper` | warn | MCP server starts through a shell wrapper such as `powershell`, `cmd`, `bash`, or `sh`. |
| `plugin.security.encoded_command` | fail | MCP server uses an encoded shell command payload. |
| `plugin.security.remote_pipe_install` | fail | MCP server appears to pipe remote content into a shell. |
| `plugin.security.cwd_outside_root` | fail | MCP server `cwd` resolves outside the plugin package root. |
| `plugin.security.insecure_http_url` | warn | MCP server uses a plain HTTP URL. |

## Runtime Rules

| Rule ID | Severity | Meaning |
| --- | --- | --- |
| `plugin.runtime.exited_early` | fail | MCP server exited before startup probing completed. |
| `plugin.runtime.initialize.timeout` | fail | MCP server did not answer `initialize` in time. |
| `plugin.runtime.protocol.invalid_message` | fail | MCP server wrote invalid protocol data to stdout. |

Runtime probing can emit additional method-specific timeout and invalid-shape IDs for `tools/list`, `tools/call`, `resources/list`, `resources/read`, `resources/templates/list`, `prompts/list`, and `prompts/get`. These follow the same remediation pattern: verify the server responds to the MCP method with a valid JSON-RPC result before packaging it.
