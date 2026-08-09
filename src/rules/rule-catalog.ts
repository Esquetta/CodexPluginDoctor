export type RuleCategory =
  | "package"
  | "skill"
  | "mcp"
  | "runtime"
  | "security"
  | "configuration";
export type RuleSeverity = "fail" | "warn";

export interface RuleDefinition {
  id: string;
  category: RuleCategory;
  defaultSeverity: RuleSeverity;
  summary: string;
  why: string;
  fix: string;
  example: string;
}

export const ruleCatalog: RuleDefinition[] = [
  {
    id: "suppression.invalid",
    category: "configuration",
    defaultSeverity: "warn",
    summary: "A targeted suppression record is invalid.",
    why: "Invalid suppression records are not applied and can create false confidence about accepted findings.",
    fix: "Fix or remove the invalid suppression record in `.codex-doctor.json`.",
    example: '{ "fingerprint": "<64 lowercase hex characters>", "reason": "Reviewed exception.", "expiresAt": "2026-07-31" }'
  },
  {
    id: "suppression.expired",
    category: "configuration",
    defaultSeverity: "warn",
    summary: "A targeted suppression has expired.",
    why: "Expired risk acceptance must be reviewed again before the finding can be suppressed.",
    fix: "Remove the expired record or replace it with a newly reviewed expiration date.",
    example: '{ "fingerprint": "<fingerprint>", "reason": "Reviewed again.", "expiresAt": "2026-08-31" }'
  },
  {
    id: "plugin.manifest.missing",
    category: "package",
    defaultSeverity: "fail",
    summary: "The target directory is missing `.codex-plugin/plugin.json`.",
    why: "Codex needs the plugin manifest as the package entry point. Without it, the directory cannot be treated as a plugin package.",
    fix: "Run the doctor against a plugin package root, or create `.codex-plugin/plugin.json` with at least `name`, `version`, and `description`.",
    example: '{ "name": "my-plugin", "version": "0.1.0", "description": "Adds focused Codex workflow helpers." }'
  },
  {
    id: "plugin.manifest.name.missing",
    category: "package",
    defaultSeverity: "fail",
    summary: "The plugin manifest is missing a stable `name` field.",
    why: "Codex and release tooling need a stable package name for display, matching, and diagnostics.",
    fix: "Add a kebab-case `name` field to `.codex-plugin/plugin.json`.",
    example: '{ "name": "github-workflow-doctor" }'
  },
  {
    id: "plugin.manifest.version.missing",
    category: "package",
    defaultSeverity: "fail",
    summary: "The plugin manifest is missing a `version` field.",
    why: "Compatibility checks and release workflows cannot reason about package changes without a version.",
    fix: "Add a semantic `version` field to `.codex-plugin/plugin.json`.",
    example: '{ "version": "0.1.0" }'
  },
  {
    id: "plugin.manifest.description.missing",
    category: "package",
    defaultSeverity: "fail",
    summary: "The plugin manifest is missing a `description` field.",
    why: "Plugin surfaces and reviewers need concise package metadata to understand what the plugin does.",
    fix: "Add a short, specific `description` field to `.codex-plugin/plugin.json`.",
    example: '{ "description": "Validates GitHub PR automation workflows before release." }'
  },
  {
    id: "plugin.heuristic.description.too_long",
    category: "package",
    defaultSeverity: "warn",
    summary: "The plugin manifest description is likely too verbose.",
    why: "Verbose package metadata increases context cost and can dilute plugin discovery quality.",
    fix: "Shorten the manifest description to a precise one- or two-sentence summary.",
    example: "Good: `Audits Codex plugin packages before publishing.`"
  },
  {
    id: "plugin.skills.path.missing",
    category: "skill",
    defaultSeverity: "fail",
    summary: "The manifest points to a missing skills directory.",
    why: "Codex cannot load packaged skills when the manifest references a directory that does not exist.",
    fix: "Create the referenced skills directory or update the `skills` path in `.codex-plugin/plugin.json`.",
    example: '{ "skills": "skills" }'
  },
  {
    id: "plugin.skill.skill_md.missing",
    category: "skill",
    defaultSeverity: "fail",
    summary: "A skill directory does not contain `SKILL.md`.",
    why: "`SKILL.md` is the required entry point for Codex to load skill instructions and metadata.",
    fix: "Add `SKILL.md` with frontmatter containing at least `name` and `description`.",
    example: "---\nname: repo-auditor\ndescription: Use when auditing repository health.\n---"
  },
  {
    id: "plugin.skill.name.missing",
    category: "skill",
    defaultSeverity: "fail",
    summary: "A skill `SKILL.md` file is missing `name` frontmatter.",
    why: "Codex needs a stable skill name for matching, display, and diagnostics.",
    fix: "Add a `name` field to the skill frontmatter.",
    example: "---\nname: release-checker\n---"
  },
  {
    id: "plugin.skill.description.missing",
    category: "skill",
    defaultSeverity: "fail",
    summary: "A skill `SKILL.md` file is missing `description` frontmatter.",
    why: "Skill descriptions drive discovery and implicit matching, so missing descriptions make skills harder to use.",
    fix: "Add a scoped `description` field that says when the skill should be used.",
    example: "---\ndescription: Use when preparing an npm release with verification gates.\n---"
  },
  {
    id: "plugin.heuristic.skill_description.too_long",
    category: "skill",
    defaultSeverity: "warn",
    summary: "A skill description is likely too verbose.",
    why: "Long, vague descriptions increase context cost and reduce skill matching precision.",
    fix: "Shorten the description while keeping concrete triggers, inputs, and output expectations.",
    example: "Good: `Use when creating GitHub Actions release workflows for Node CLIs.`"
  },
  {
    id: "plugin.skill.asset_reference.missing",
    category: "skill",
    defaultSeverity: "warn",
    summary: "A skill references a missing local support asset.",
    why: "Skills that point to missing scripts, templates, assets, or examples can fail when an agent follows the instructions.",
    fix: "Create the referenced support file or update the backticked reference in `SKILL.md`.",
    example: "If `SKILL.md` says `scripts/setup.ps1`, make sure that file exists inside the skill directory."
  },
  {
    id: "plugin.mcp.path.missing",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The manifest points to a missing `.mcp.json` file.",
    why: "Codex cannot load bundled MCP server definitions if the referenced config file does not exist.",
    fix: "Create the referenced `.mcp.json` file or update the `mcpServers` path in the manifest.",
    example: '{ "mcpServers": ".mcp.json" }'
  },
  {
    id: "plugin.mcp.invalid_json",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The referenced `.mcp.json` file is not valid JSON.",
    why: "Codex must parse MCP configuration before it can start bundled servers.",
    fix: "Fix the JSON syntax in the referenced `.mcp.json` file.",
    example: '{ "mcpServers": { "doctor": { "command": "node", "args": ["server.js"] } } }'
  },
  {
    id: "plugin.mcp.invalid_shape",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The `.mcp.json` file does not expose a valid `mcpServers` object.",
    why: "Codex expects MCP configuration to be object-shaped with named server entries.",
    fix: "Define a non-empty top-level `mcpServers` object.",
    example: '{ "mcpServers": { "doctor": { "command": "node", "args": ["server.js"] } } }'
  },
  {
    id: "plugin.mcp.ambiguous_shape",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The `.mcp.json` file uses an ambiguous MCP config layout.",
    why: "Codex cannot safely choose between multiple wrapper layouts when they appear in one configuration file.",
    fix: "Use exactly one supported layout: a direct server map, `mcp_servers`, or `mcpServers`.",
    example: '{ "weather": { "command": "node", "args": ["server.js"] } }'
  },
  {
    id: "plugin.mcp.server.invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "An MCP server entry is not an object.",
    why: "Codex cannot interpret server settings unless each server is represented as an object.",
    fix: "Change the server entry to an object with transport options.",
    example: '{ "mcpServers": { "doctor": { "command": "node" } } }'
  },
  {
    id: "plugin.mcp.server.transport.missing",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "An MCP server entry is missing both `command` and `url`.",
    why: "Codex needs either a stdio command or a streamable HTTP URL to connect to a server.",
    fix: "Add `command` for stdio servers or `url` for remote servers.",
    example: '{ "command": "node", "args": ["server.js"] }'
  },
  {
    id: "mcp.server.transport.conflict",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "An MCP server defines both command and URL transports.",
    why: "Clients cannot select a transport deterministically when a server defines both process and remote connection settings.",
    fix: "Keep either command for stdio or url for remote MCP, but not both.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.mcp.server.transport.conflict",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A bundled MCP server defines both command and URL transports.",
    why: "Codex cannot select a transport deterministically when a bundled server defines both process and remote connection settings.",
    fix: "Keep either command for stdio or url for remote MCP, but not both.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.path_traversal",
    category: "security",
    defaultSeverity: "fail",
    summary: "A manifest path escapes the plugin package root.",
    why: "Paths outside the package root can expose unintended files and make package review unreliable.",
    fix: "Keep manifest paths such as `skills` and `mcpServers` inside the plugin root.",
    example: '{ "skills": "skills", "mcpServers": ".mcp.json" }'
  },
  {
    id: "plugin.security.hard_coded_secret",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server config contains a hard-coded secret-like env value.",
    why: "Bundled credentials can leak through source control, npm packages, logs, or support bundles.",
    fix: "Replace literal secrets with environment references or externally injected secrets.",
    example: '{ "env": { "OPENAI_API_KEY": "${OPENAI_API_KEY}" } }'
  },
  {
    id: "plugin.security.audit_unavailable",
    category: "security",
    defaultSeverity: "fail",
    summary: "The security audit could not inspect the package surface.",
    why: "A missing manifest or unreadable MCP configuration prevents the tool from evaluating package-local execution risks.",
    fix: "Run against a valid Codex plugin root and fix `.mcp.json` syntax or shape errors before auditing.",
    example: "codex-plugin-doctor security examples/codex-doctor-runtime"
  },
  {
    id: "plugin.security.command_shell_wrapper",
    category: "security",
    defaultSeverity: "warn",
    summary: "An MCP server starts through a shell wrapper.",
    why: "Shell wrappers can hide quoting, pipes, aliases, and platform-specific execution behavior from reviewers.",
    fix: "Launch the concrete executable directly with explicit args.",
    example: '{ "command": "node", "args": ["server.js"] }'
  },
  {
    id: "plugin.security.encoded_command",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server uses an encoded shell command.",
    why: "Encoded payloads hide the executed script and make supply-chain review unreliable.",
    fix: "Replace encoded command payloads with a checked-in script or direct executable plus readable args.",
    example: '{ "command": "node", "args": ["scripts/server.js"] }'
  },
  {
    id: "plugin.security.remote_pipe_install",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server pipes remote content into a shell.",
    why: "Download-and-execute startup patterns can run unreviewed remote code as soon as a client starts the server.",
    fix: "Pin dependencies through a package manager or check in a reviewed setup script.",
    example: '{ "command": "npx", "args": ["-y", "@scope/server"] }'
  },
  {
    id: "plugin.security.path_traversal_risk",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server passes a package-external path to a path-like runtime argument.",
    why: "Runtime file arguments outside the plugin root can load code or configuration that was not included in the reviewed package.",
    fix: "Keep runtime file arguments inside the plugin package root, or package the referenced file with the plugin.",
    example: '{ "command": "node", "args": ["server.js", "--config", "config/server.json"] }'
  },
  {
    id: "plugin.security.dangerous_env_usage",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server sets an environment variable that can alter code loading.",
    why: "Variables such as NODE_OPTIONS, NODE_PATH, PYTHONPATH, LD_PRELOAD, or DYLD_INSERT_LIBRARIES can inject imports, preload native libraries, or load modules outside the reviewed package.",
    fix: "Remove code-loading environment overrides, or keep referenced modules and preload files inside the reviewed plugin package.",
    example: '{ "env": { "OPENAI_API_KEY": "${OPENAI_API_KEY}" } }'
  },
  {
    id: "plugin.security.cwd_outside_root",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server sets `cwd` outside the plugin root.",
    why: "External working directories make startup depend on local files that are not part of the reviewed package.",
    fix: "Keep `cwd` inside the plugin root or remove it.",
    example: '{ "cwd": "." }'
  },
  {
    id: "plugin.security.insecure_http_url",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server uses a plain HTTP URL.",
    why: "Plain HTTP can expose MCP traffic and does not verify endpoint identity on non-local networks.",
    fix: "Use HTTPS for remote MCP servers; reserve HTTP for explicit localhost development endpoints.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.remote_mcp_url.invalid",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server URL is not an absolute HTTP or HTTPS URL.",
    why: "Clients cannot reliably connect to malformed or relative remote MCP endpoints.",
    fix: "Use an absolute HTTPS URL, or an explicit localhost HTTP development URL.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.remote_mcp_url.unsupported_scheme",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server URL uses an unsupported scheme.",
    why: "Remote MCP transport supports only HTTP and HTTPS endpoints.",
    fix: "Use an HTTPS URL, or an explicit localhost HTTP development URL.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.remote_mcp_url.credentials",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server URL embeds credentials.",
    why: "URL credentials can leak through configuration, logs, reports, and package artifacts.",
    fix: "Remove URL credentials and configure authentication outside the endpoint URL.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.remote_mcp_url.query",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server URL contains a query string.",
    why: "Query strings can carry secrets and make endpoint configuration ambiguous.",
    fix: "Remove the query string from the MCP endpoint URL.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.remote_mcp_url.fragment",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server URL contains a fragment.",
    why: "Fragments are not sent to servers and can hide misleading endpoint configuration.",
    fix: "Remove the fragment from the MCP endpoint URL.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.remote_mcp_url.ip_literal",
    category: "security",
    defaultSeverity: "fail",
    summary: "An MCP server URL uses a numeric IP literal.",
    why: "Numeric IP endpoints bypass hostname-based endpoint review and are not an accepted remote MCP shape.",
    fix: "Use a reviewed hostname; use localhost only for local development.",
    example: '{ "url": "https://example.com/mcp" }'
  },
  {
    id: "plugin.security.mcp_binds_all_interfaces",
    category: "security",
    defaultSeverity: "warn",
    summary: "An MCP server listens on `0.0.0.0` instead of `localhost`.",
    why: "Servers that bind to all interfaces can accept connections from external hosts, which is rarely intended for local MCP development.",
    fix: "Use `127.0.0.1` or `localhost` in server URLs and transport configuration unless external access is explicitly required.",
    example: '{ "url": "http://127.0.0.1:3000/mcp" }'
  },
  {
    id: "plugin.skill.external_http_reference",
    category: "skill",
    defaultSeverity: "warn",
    summary: "A packaged skill text references an external HTTP/HTTPS URL.",
    why: "External URLs in skill instructions can lead to link rot, phishing risk, or unauthorized telemetry when an agent follows them.",
    fix: "Replace the external URL with a local reference, or document the link only in the plugin README where reviewers can see it.",
    example: "Replace `https://example.com/docs` with a local `docs/setup.md` reference."
  },
  {
    id: "plugin.security.prompt_injection_text",
    category: "security",
    defaultSeverity: "fail",
    summary: "Packaged text contains prompt-injection or secret-exfiltration instructions.",
    why: "Poisoned tool, prompt, resource, or skill text can instruct an agent to ignore higher-priority instructions or leak secrets when loaded into context.",
    fix: "Remove hidden override or exfiltration instructions and keep descriptions scoped to legitimate behavior.",
    example: "Keep SKILL.md, prompt, resource, and tool descriptions direct and user-facing."
  },
  {
    id: "mcp.conformance.protocol.unknown_newer",
    category: "mcp",
    defaultSeverity: "warn",
    summary: "The server advertises a newer MCP protocol version.",
    why: "The validator applies the 2025-11-25 structural baseline, which may not cover newer protocol requirements.",
    fix: "Confirm the server's newer protocol changes remain compatible with the 2025-11-25 MCP contract.",
    example: '{ "protocolVersion": "2026-01-01" }'
  },
  {
    id: "mcp.conformance.tasks.capability_invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A Tasks capability declaration is malformed.",
    why: "Codex cannot safely determine whether the server supports task-aware tool calls.",
    fix: "Return an object for the affected Tasks capability field, or omit the capability until it is implemented.",
    example: '{ "capabilities": { "tasks": { "requests": { "tools": { "call": {} } } } } }'
  },
  {
    id: "mcp.conformance.tasks.task_support_invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A tool declares invalid task support.",
    why: "Codex cannot safely interpret the tool's task support contract.",
    fix: "Set execution.taskSupport to required, optional, or forbidden.",
    example: '{ "execution": { "taskSupport": "optional" } }'
  },
  {
    id: "mcp.conformance.tasks.capability_mismatch",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A tool's task support does not match server capability.",
    why: "Codex may attempt task-aware tool calls that the server did not advertise as supported.",
    fix: "Advertise capabilities.tasks.requests.tools.call as an object, or set execution.taskSupport to forbidden.",
    example: '{ "capabilities": { "tasks": { "requests": { "tools": { "call": {} } } } }, "execution": { "taskSupport": "required" } }'
  },
  {
    id: "mcp.conformance.tasks_list.timeout",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The server did not complete tasks/list in time.",
    why: "Codex cannot rely on task discovery when tasks/list cannot complete with a valid response.",
    fix: "Reduce tasks/list latency and verify pagination completes.",
    example: "Return a valid tasks/list response before the configured runtime timeout."
  },
  {
    id: "mcp.conformance.tasks_list.invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The server returned an invalid tasks/list response.",
    why: "Codex cannot rely on task discovery when tasks/list cannot complete with a valid response.",
    fix: "Return a valid tasks/list response with well-formed task items and pagination.",
    example: '{ "tasks": [] }'
  },
  {
    id: "mcp.conformance.schema.dialect_invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A tool schema declares an invalid dialect.",
    why: "Codex cannot reliably select a schema dialect for this tool.",
    fix: "Omit $schema or provide an absolute URI in the affected tool schema.",
    example: '{ "inputSchema": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }'
  },
  {
    id: "mcp.conformance.schema.dialect_unsupported",
    category: "mcp",
    defaultSeverity: "warn",
    summary: "A tool schema uses a non-canonical dialect.",
    why: "The schema may be valid, but its dialect is outside the validator's latest compatibility baseline.",
    fix: "Use https://json-schema.org/draft/2020-12/schema or omit $schema.",
    example: '{ "inputSchema": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }'
  },
  {
    id: "plugin.runtime.exited_early",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "An MCP server exited before the startup probe completed.",
    why: "A server that exits immediately is unlikely to remain available during normal Codex use.",
    fix: "Run the configured command manually, inspect stderr, and fix startup exceptions or missing dependencies.",
    example: "node server.js"
  },
  {
    id: "plugin.runtime.initialize.timeout",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "An MCP server did not answer `initialize` in time.",
    why: "Codex cannot negotiate capabilities with a server that does not complete initialization.",
    fix: "Ensure the server reads JSON-RPC from stdin, writes responses to stdout, and avoids slow startup work.",
    example: "Respond to the `initialize` request before starting expensive background tasks."
  },
  {
    id: "plugin.runtime.protocol.invalid_message",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "An MCP server wrote invalid JSON-RPC data to stdout.",
    why: "MCP stdio transport requires newline-delimited JSON-RPC messages on stdout.",
    fix: "Send logs to stderr and reserve stdout for JSON-RPC protocol messages only.",
    example: "Use `console.error` for diagnostics in Node stdio servers."
  },
  {
    id: "plugin.runtime.remote.network_not_approved",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "Remote MCP probing was not explicitly approved.",
    why: "Remote initialization creates outbound network traffic.",
    fix: "Review the plan, then use --runtime --allow-network; add --allow-local-network only for localhost HTTP.",
    example: "codex-plugin-doctor mcp . --runtime --allow-network"
  },
  {
    id: "plugin.runtime.remote.url.invalid",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "A remote MCP endpoint URL is unsafe or unsupported.",
    why: "Credentials, queries, fragments, IP literals, and unsupported schemes bypass the remote probe boundary.",
    fix: "Use an absolute HTTPS URL without credentials, query parameters, fragments, or IP literals.",
    example: "https://mcp.example/mcp"
  },
  {
    id: "plugin.runtime.remote.transport.timeout",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP initialize request timed out.",
    why: "A bounded probe cannot safely negotiate an unavailable endpoint.",
    fix: "Make the endpoint reachable and complete initialize within the configured timeout.",
    example: "Return a valid initialize response promptly."
  },
  {
    id: "plugin.runtime.remote.transport.response_too_large",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP response exceeded the bounded probe limit.",
    why: "Unbounded remote responses can exhaust local resources.",
    fix: "Return a compact initialize response and keep discovery metadata bounded.",
    example: "Return only the MCP initialize result."
  },
  {
    id: "plugin.runtime.remote.transport.failed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP transport request failed.",
    why: "Protocol negotiation cannot proceed without a safe bounded connection.",
    fix: "Verify endpoint reachability, TLS, and remote network policy eligibility.",
    example: "Use a public HTTPS endpoint or explicitly approved localhost HTTP."
  },
  {
    id: "plugin.runtime.remote.http_status.invalid",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP initialize response used an unexpected HTTP status.",
    why: "Streamable HTTP initialization requires a successful response before negotiation.",
    fix: "Return HTTP 200 for initialize or publish valid OAuth discovery metadata for protected endpoints.",
    example: "HTTP/1.1 200 OK"
  },
  {
    id: "plugin.runtime.remote.content_type.invalid",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP initialize response used an unsupported content type.",
    why: "The probe can only validate JSON or Server-Sent Events protocol responses.",
    fix: "Return application/json or text/event-stream with a JSON-RPC response.",
    example: "Content-Type: application/json"
  },
  {
    id: "plugin.runtime.remote.session.invalid",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP session header is invalid.",
    why: "An invalid session identifier cannot be safely replayed on the initialized notification.",
    fix: "Return MCP-Session-Id only as visible ASCII characters.",
    example: "MCP-Session-Id: session-123"
  },
  {
    id: "plugin.runtime.remote.initialize.invalid",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP initialize JSON-RPC result is invalid.",
    why: "Invalid negotiation results leave capabilities and protocol version unknown.",
    fix: "Return a JSON-RPC 2.0 initialize result for protocol version 2025-11-25.",
    example: '{ "jsonrpc": "2.0", "id": 1, "result": { "protocolVersion": "2025-11-25" } }'
  },
  {
    id: "plugin.runtime.remote.initialized.failed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP server did not acknowledge notifications/initialized.",
    why: "The session may not be ready for subsequent protocol traffic.",
    fix: "Accept a successful initialized notification at the configured MCP endpoint.",
    example: "Return HTTP 204 to notifications/initialized."
  },
  {
    id: "plugin.runtime.remote.authorization.metadata.invalid",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "Remote OAuth discovery metadata is invalid.",
    why: "Protected MCP endpoints cannot be assessed safely without valid authorization metadata.",
    fix: "Publish valid HTTPS protected-resource and authorization-server metadata.",
    example: "https://mcp.example/.well-known/oauth-protected-resource"
  },
  {
    id: "plugin.runtime.remote.authorization.metadata.unavailable",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "Remote OAuth discovery metadata is unavailable.",
    why: "Authorization readiness cannot be confirmed without bounded metadata responses.",
    fix: "Make protected-resource and authorization-server metadata available over HTTPS.",
    example: "Return application/json discovery metadata."
  },
  {
    id: "plugin.runtime.remote.reliability.get.status",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP endpoint rejected the SSE transport request.",
    why: "Clients cannot rely on server-to-client streaming when an accepted SSE request does not return the expected status.",
    fix: "Return HTTP 200 with a valid SSE response, or HTTP 405 when GET streaming is not supported.",
    example: "HTTP/1.1 405 Method Not Allowed"
  },
  {
    id: "plugin.runtime.remote.reliability.get.content_type",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP endpoint returned a non-SSE media type for GET streaming.",
    why: "Clients cannot interpret a successful streaming response unless it is declared as Server-Sent Events.",
    fix: "Return Content-Type: text/event-stream for accepted GET streaming requests.",
    example: "Content-Type: text/event-stream"
  },
  {
    id: "plugin.runtime.remote.reliability.get.inconclusive",
    category: "runtime",
    defaultSeverity: "warn",
    summary: "The remote MCP GET streaming check was inconclusive.",
    why: "A bounded probe could not observe a complete SSE event, so streaming reliability remains uncertain.",
    fix: "Emit complete SSE event frames promptly when server-to-client streaming is supported.",
    example: "id: event-1\n\ndata: {}\n\n"
  },
  {
    id: "plugin.runtime.remote.reliability.get.failed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP GET streaming request could not be completed.",
    why: "Clients cannot rely on server-to-client streaming when a bounded transport request fails.",
    fix: "Keep the Streamable HTTP transport reachable within the configured request bounds.",
    example: "Complete the GET request before the runtime timeout."
  },
  {
    id: "plugin.runtime.remote.reliability.get.malformed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP endpoint emitted malformed SSE framing.",
    why: "Malformed event framing prevents clients from safely processing stream progress or reconnecting.",
    fix: "Return complete SSE events with valid id and retry fields.",
    example: "id: event-1\n\nevent: message\n\ndata: {}\n\n"
  },
  {
    id: "plugin.runtime.remote.reliability.resume.status",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP endpoint rejected the SSE resume request.",
    why: "Clients cannot resume a dropped stream when the reconnect response has an unexpected status.",
    fix: "Return HTTP 200 for an accepted Last-Event-ID reconnect request.",
    example: "HTTP/1.1 200 OK"
  },
  {
    id: "plugin.runtime.remote.reliability.resume.content_type",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP endpoint returned a non-SSE media type for a resume request.",
    why: "Clients cannot process a resumed stream unless it is declared as Server-Sent Events.",
    fix: "Return Content-Type: text/event-stream after accepting a Last-Event-ID reconnect request.",
    example: "Content-Type: text/event-stream"
  },
  {
    id: "plugin.runtime.remote.reliability.resume.inconclusive",
    category: "runtime",
    defaultSeverity: "warn",
    summary: "The remote MCP SSE resume check was inconclusive.",
    why: "A bounded probe could not confirm a complete resumed event, so reconnect reliability remains uncertain.",
    fix: "Emit complete SSE event frames after accepting a reconnect.",
    example: "Return one complete SSE event after a Last-Event-ID request."
  },
  {
    id: "plugin.runtime.remote.reliability.resume.failed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP SSE resume request could not be completed.",
    why: "Clients cannot recover from a dropped stream when a bounded reconnect fails.",
    fix: "Accept one bounded SSE reconnect using Last-Event-ID.",
    example: "Honor the Last-Event-ID header on one reconnect."
  },
  {
    id: "plugin.runtime.remote.reliability.resume.malformed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP endpoint emitted malformed SSE framing after reconnecting.",
    why: "Malformed resumed events prevent clients from safely continuing stream processing.",
    fix: "Return complete SSE events with valid id and retry fields after reconnecting.",
    example: "Return a complete event frame after reconnecting."
  },
  {
    id: "plugin.runtime.remote.reliability.session_restart.failed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP session could not be restarted.",
    why: "Clients cannot recover from an expired MCP session when a fresh initialization sequence fails.",
    fix: "Accept a fresh initialize sequence after an expired MCP session.",
    example: "Return a valid initialize response after HTTP 404 for a session-bound request."
  },
  {
    id: "plugin.runtime.remote.reliability.termination.failed",
    category: "runtime",
    defaultSeverity: "fail",
    summary: "The remote MCP session could not be terminated.",
    why: "A server that advertises session lifecycle support must safely handle the approved termination request.",
    fix: "Return a successful response or HTTP 405 for a bounded MCP session DELETE request.",
    example: "HTTP/1.1 204 No Content"
  }
];

export function findRuleDefinition(id: string): RuleDefinition | null {
  return ruleCatalog.find((rule) => rule.id === id) ?? null;
}
