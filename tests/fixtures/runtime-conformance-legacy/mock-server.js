import readline from "node:readline";

const forbiddenMethods = new Set([
  "tasks/list",
  "tasks/get",
  "tasks/result",
  "tasks/cancel",
  "sampling/createMessage",
  "elicitation/create"
]);

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (forbiddenMethods.has(message.method)) {
    throw new Error(`Unexpected method: ${message.method}`);
  }

  if (message.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          serverInfo: {
            name: "legacy-conformance-server",
            version: "1.0.0"
          }
        }
      })}\n`
    );
  }
});
