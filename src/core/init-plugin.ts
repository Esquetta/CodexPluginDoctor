import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export const initPluginTemplates = [
  "skill-only",
  "mcp-stdio",
  "mcp-http",
  "full-runtime"
] as const;

export type InitPluginTemplate = (typeof initPluginTemplates)[number];

export interface InitPluginOptions {
  template?: InitPluginTemplate;
}

export interface InitPluginResult {
  rootPath: string;
  manifestPath: string;
  skillPath: string;
  template: InitPluginTemplate;
  mcpConfigPath?: string;
  serverPath?: string;
}

function toPackageName(inputPath: string): string {
  return path.basename(path.resolve(inputPath))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "codex-plugin";
}

export function isInitPluginTemplate(value: string): value is InitPluginTemplate {
  return initPluginTemplates.includes(value as InitPluginTemplate);
}

function buildSkillMarkdown(template: InitPluginTemplate): string {
  const description = template === "skill-only"
    ? "Use when verifying that this Codex plugin package loads correctly."
    : "Use when testing this Codex plugin package and its bundled MCP server.";

  return [
    "---",
    "name: hello",
    `description: ${description}`,
    "---",
    "",
    "# Hello",
    "",
    template === "skill-only"
      ? "This starter skill confirms the plugin package structure is valid."
      : "This starter skill confirms the plugin package and MCP server wiring are valid.",
    ""
  ].join("\n");
}

function buildStdioMcpConfig(packageName: string): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        [packageName]: {
          command: "node",
          args: ["./mock-server.js"]
        }
      }
    },
    null,
    2
  )}\n`;
}

function buildHttpMcpConfig(packageName: string): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        [packageName]: {
          url: "http://localhost:8787/mcp"
        }
      }
    },
    null,
    2
  )}\n`;
}

function buildFullRuntimeServer(): string {
  return [
    "const readline = require(\"node:readline\");",
    "",
    "const rl = readline.createInterface({",
    "  input: process.stdin,",
    "  crlfDelay: Infinity",
    "});",
    "",
    "function send(id, payload) {",
    "  process.stdout.write(`${JSON.stringify({ jsonrpc: \"2.0\", id, ...payload })}\\n`);",
    "}",
    "",
    "rl.on(\"line\", (line) => {",
    "  const message = JSON.parse(line);",
    "  const cursor = message.params && message.params.cursor;",
    "",
    "  if (message.method === \"initialize\") {",
    "    send(message.id, {",
    "      result: {",
    "        protocolVersion: \"2025-11-25\",",
    "        capabilities: { tools: {}, resources: {}, prompts: {} },",
    "        serverInfo: { name: \"codex-plugin-template\", version: \"0.1.0\" }",
    "      }",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"tools/list\") {",
    "    send(message.id, {",
    "      result: cursor === \"tools-page-2\"",
    "        ? { tools: [{ name: \"format_status\", description: \"Return a formatted health status.\", inputSchema: { type: \"object\", properties: {}, required: [] } }] }",
    "        : { tools: [{ name: \"ping\", description: \"Return a healthcheck response.\", inputSchema: { type: \"object\", properties: {}, required: [] } }], nextCursor: \"tools-page-2\" }",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"tools/call\") {",
    "    send(message.id, { result: { content: [{ type: \"text\", text: \"codex-plugin-template-ok\" }] } });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"resources/list\") {",
    "    send(message.id, {",
    "      result: cursor === \"resources-page-2\"",
    "        ? { resources: [{ name: \"workspace-license\", uri: \"file:///workspace/LICENSE\" }] }",
    "        : { resources: [{ name: \"workspace-readme\", uri: \"file:///workspace/README.md\" }], nextCursor: \"resources-page-2\" }",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"resources/read\") {",
    "    send(message.id, { result: { contents: [{ uri: \"file:///workspace/README.md\", text: \"# Workspace README\" }] } });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"resources/templates/list\") {",
    "    send(message.id, {",
    "      result: cursor === \"templates-page-2\"",
    "        ? { resourceTemplates: [{ name: \"log\", uriTemplate: \"file:///workspace/logs/{name}.log\" }] }",
    "        : { resourceTemplates: [{ name: \"doc\", uriTemplate: \"file:///workspace/docs/{name}.md\" }], nextCursor: \"templates-page-2\" }",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"prompts/list\") {",
    "    send(message.id, {",
    "      result: cursor === \"prompts-page-2\"",
    "        ? { prompts: [{ name: \"summary\", description: \"Summarize the current change.\" }] }",
    "        : { prompts: [{ name: \"code_review\", description: \"Review code for bugs.\", arguments: [{ name: \"diff\", required: true }] }], nextCursor: \"prompts-page-2\" }",
    "    });",
    "    return;",
    "  }",
    "",
    "  if (message.method === \"prompts/get\") {",
    "    if (!message.params || !message.params.arguments || message.params.arguments.diff !== \"codex-plugin-doctor-probe\") {",
    "      send(message.id, { error: { code: -32602, message: \"Missing required diff argument\" } });",
    "      return;",
    "    }",
    "",
    "    send(message.id, {",
    "      result: {",
    "        description: \"Prompt for code review\",",
    "        messages: [{ role: \"user\", content: { type: \"text\", text: \"Review this diff for bugs.\" } }]",
    "      }",
    "    });",
    "    return;",
    "  }",
    "",
    "  send(message.id, { error: { code: -32601, message: `Unsupported method: ${message.method}` } });",
    "});",
    ""
  ].join("\n");
}

export async function initPluginPackage(
  targetPath: string,
  options: InitPluginOptions = {}
): Promise<InitPluginResult> {
  const template = options.template ?? "skill-only";
  const rootPath = path.resolve(targetPath);
  const manifestDirectory = path.join(rootPath, ".codex-plugin");
  const skillsDirectory = path.join(rootPath, "skills", "hello");
  const manifestPath = path.join(manifestDirectory, "plugin.json");
  const skillPath = path.join(skillsDirectory, "SKILL.md");
  const mcpConfigPath = path.join(rootPath, ".mcp.json");
  const serverPath = path.join(rootPath, "mock-server.js");
  const packageName = toPackageName(rootPath);

  await mkdir(manifestDirectory, { recursive: true });
  await mkdir(skillsDirectory, { recursive: true });

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: packageName,
        version: "0.1.0",
        description: "A Codex plugin package scaffolded by Codex Plugin Doctor.",
        skills: "skills",
        ...(template === "skill-only" ? {} : { mcpServers: ".mcp.json" })
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(skillPath, buildSkillMarkdown(template), "utf8");

  if (template === "mcp-stdio" || template === "full-runtime") {
    await writeFile(mcpConfigPath, buildStdioMcpConfig(packageName), "utf8");
    await writeFile(serverPath, buildFullRuntimeServer(), "utf8");
  }

  if (template === "mcp-http") {
    await writeFile(mcpConfigPath, buildHttpMcpConfig(packageName), "utf8");
  }

  return {
    rootPath,
    manifestPath,
    skillPath,
    template,
    mcpConfigPath: template === "skill-only" ? undefined : mcpConfigPath,
    serverPath: template === "mcp-stdio" || template === "full-runtime"
      ? serverPath
      : undefined
  };
}
