export type RuleCategory = "package" | "skill" | "mcp" | "runtime" | "security";
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
    defaultSeverity: "warn",
    summary: "An MCP server uses a plain HTTP URL.",
    why: "Plain HTTP can expose MCP traffic and does not verify endpoint identity on non-local networks.",
    fix: "Use HTTPS for remote MCP servers; reserve HTTP for explicit localhost development endpoints.",
    example: '{ "url": "https://example.com/mcp" }'
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
  }
];

export function findRuleDefinition(id: string): RuleDefinition | null {
  return ruleCatalog.find((rule) => rule.id === id) ?? null;
}
