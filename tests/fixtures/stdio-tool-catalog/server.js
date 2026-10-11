// Scripted stdio MCP server for doctor tools capture tests. The first argument selects the behavior.
import readline from "node:readline";

const mode = process.argv[2] ?? "modern";
const modernMeta = { resultType: "complete", ttlMs: 60000, cacheScope: "public" };
const lookup = {
  name: "lookup",
  description: "Look up an item by its identifier.",
  inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }
};
const search = {
  name: "search",
  description: "Search items.",
  inputSchema: { type: "object", properties: { query: { type: "string" } } }
};
let initialized = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function error(id, code, message, data) {
  send({ jsonrpc: "2.0", id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

const legacyModes = new Set(["legacy", "legacy-silent", "legacy-exit", "legacy-paged", "legacy-no-tools", "legacy-old-version", "legacy-future-version"]);

function discover(message) {
  if (legacyModes.has(mode)) {
    if (mode === "legacy-silent") return;
    if (mode === "legacy-exit") process.exit(1);
    error(message.id, -32601, "Method not found");
    return;
  }
  if (mode === "modern-unsupported-version") {
    error(message.id, -32022, "Unsupported protocol version", { supported: ["2027-01-01"], requested: "2026-07-28" });
    return;
  }
  if (mode === "modern-invalid-discover") {
    result(message.id, { supportedVersions: ["2026-07-28"] });
    return;
  }
  result(message.id, {
    ...modernMeta,
    supportedVersions: ["2026-07-28"],
    capabilities: mode === "modern-no-tools" ? {} : { tools: {} }
  });
}

function legacyInitialize(message) {
  initialized = true;
  const protocolVersion = mode === "legacy-old-version" ? "2025-06-18" : mode === "legacy-future-version" ? "2030-01-01" : "2025-11-25";
  result(message.id, {
    protocolVersion,
    capabilities: mode === "legacy-no-tools" ? {} : { tools: { listChanged: false } },
    serverInfo: { name: "scripted-legacy", version: "1.0.0" }
  });
  send({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "ready" } });
}

function toolsList(message) {
  const cursor = message.params?.cursor;
  const modern = !legacyModes.has(mode);
  const meta = modern ? modernMeta : {};
  if (modern && message.params?._meta?.["io.modelcontextprotocol/protocolVersion"] !== "2026-07-28") {
    error(message.id, -32022, "Unsupported protocol version", { supported: ["2026-07-28"], requested: "unknown" });
    return;
  }
  if (!modern && !initialized) {
    error(message.id, -32002, "Server not initialized");
    return;
  }
  if (mode === "modern-tools-list-missing") {
    error(message.id, -32601, "Method not found");
    return;
  }
  if (mode === "modern-invalid-page") {
    result(message.id, { tools: [lookup] });
    return;
  }
  if (mode === "modern-cursor-loop") {
    result(message.id, { ...meta, tools: [], nextCursor: "again" });
    return;
  }
  if (mode === "modern-hang-page" && cursor === "page-2") return;
  if (mode === "modern-paged" || mode === "legacy-paged" || mode === "modern-hang-page") {
    if (cursor === "page-2") {
      result(message.id, modern ? { ...meta, ttlMs: 1000, cacheScope: "private", tools: [search] } : { tools: [search] });
    } else {
      result(message.id, { ...meta, tools: [lookup], nextCursor: "page-2" });
    }
    return;
  }
  if (mode === "modern-stdout-noise") process.stdout.write("server ready\n");
  if (mode === "modern-large-line") {
    result(message.id, { ...meta, tools: [{ ...lookup, description: "x".repeat(1024 * 1024) }] });
    return;
  }
  result(message.id, { ...meta, tools: [lookup, search] });
}

if (mode === "exit-at-start") process.exit(3);
if (mode === "startup-noise") process.stdout.write("starting scripted server\n");

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "server/discover") discover(message);
  else if (message.method === "initialize") legacyInitialize(message);
  else if (message.method === "tools/list") toolsList(message);
  else if (message.id !== undefined) error(message.id, -32601, "Method not found");
});
if (mode === "ignore-stdin-close") {
  process.on("SIGTERM", () => undefined);
  setInterval(() => undefined, 1000);
} else {
  lines.on("close", () => process.exit(0));
}
