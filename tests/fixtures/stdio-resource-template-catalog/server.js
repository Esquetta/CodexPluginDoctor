// Scripted stdio MCP server for doctor resource-templates and mcp-snapshot capture tests. The first argument selects the behavior.
import readline from "node:readline";

const mode = process.argv[2] ?? "modern";
const legacy = mode === "legacy";
const resourceTemplates = [
  { uriTemplate: "file:///{path}", name: "project-files", title: "Project Files", mimeType: "application/octet-stream" },
  { uriTemplate: "db://tables/{table}{?columns}", name: "table-rows" }
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function methodNotFound(id) {
  send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "server/discover") {
    if (legacy) return methodNotFound(message.id);
    return send({
      jsonrpc: "2.0", id: message.id, result: {
        resultType: "complete", ttlMs: 60000, cacheScope: "public", supportedVersions: ["2026-07-28"],
        capabilities: mode === "modern-no-resources" ? { tools: {} }
          : mode === "modern-prompts-list-missing" ? { tools: {}, prompts: {}, resources: {} } : { resources: {} }
      }
    });
  }
  if (message.method === "initialize" && legacy) {
    return send({
      jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: "2025-11-25", capabilities: { resources: { listChanged: false }, logging: true }, serverInfo: { name: "scripted-legacy", version: "1.0.0" },
        instructions: "Ask before reading project files."
      }
    });
  }
  if (message.method === "tools/list" && mode === "modern-prompts-list-missing") {
    return send({
      jsonrpc: "2.0", id: message.id,
      result: { resultType: "complete", tools: [{ name: "lookup", inputSchema: { type: "object" } }], ttlMs: 60000, cacheScope: "public" }
    });
  }
  if (message.method === "resources/templates/list" && mode !== "modern-templates-list-missing") {
    return send({
      jsonrpc: "2.0", id: message.id,
      result: legacy ? { resourceTemplates } : { resultType: "complete", resourceTemplates, ttlMs: 60000, cacheScope: "public" }
    });
  }
  methodNotFound(message.id);
});
lines.on("close", () => process.exit(0));
