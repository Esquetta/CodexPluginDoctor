// Scripted stdio MCP server for doctor prompts capture tests. The first argument selects the behavior.
import readline from "node:readline";

const mode = process.argv[2] ?? "modern";
const legacy = mode === "legacy";
const prompts = [
  { name: "code_review", title: "Request Code Review", arguments: [{ name: "code", description: "The code to review", required: true }] },
  { name: "summarize" }
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
        capabilities: mode === "modern-no-prompts" ? { tools: {} } : { prompts: {} }
      }
    });
  }
  if (message.method === "initialize" && legacy) {
    return send({
      jsonrpc: "2.0", id: message.id, result: {
        protocolVersion: "2025-11-25", capabilities: { prompts: { listChanged: false } }, serverInfo: { name: "scripted-legacy", version: "1.0.0" }
      }
    });
  }
  if (message.method === "prompts/list" && mode !== "modern-prompts-list-missing") {
    return send({
      jsonrpc: "2.0", id: message.id,
      result: legacy ? { prompts } : { resultType: "complete", prompts, ttlMs: 60000, cacheScope: "public" }
    });
  }
  methodNotFound(message.id);
});
lines.on("close", () => process.exit(0));
