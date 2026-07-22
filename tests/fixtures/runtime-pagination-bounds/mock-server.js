import readline from "node:readline";

const mode = process.argv[2];
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function respond(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`);
}

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    respond(message.id, {
      protocolVersion: "2025-11-25",
      capabilities: mode === "shared" ? { tools: {} } : { tasks: { list: {} } },
      serverInfo: { name: `${mode}-pagination-server`, version: "1.0.0" }
    });
    return;
  }

  if (mode === "shared" && message.method === "tools/list") {
    respond(message.id, {
      tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }],
      nextCursor: "repeated-cursor"
    });
    return;
  }

  if (mode === "tasks" && message.method === "tasks/list") {
    const page = Number(String(message.params?.cursor ?? "page-0").slice(5)) + 1;
    respond(message.id, { tasks: [], nextCursor: `page-${page}` });
  }
});
