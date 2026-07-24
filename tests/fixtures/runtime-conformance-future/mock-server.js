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
          protocolVersion: "2026-01-01",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "future-conformance-server",
            version: "1.0.0"
          }
        }
      })}\n`
    );
    return;
  }

  if (message.method === "tools/list") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          tools: [
            {
              name: "ping",
              inputSchema: {
                type: "object",
                properties: {},
                required: []
              },
              outputSchema: {
                type: "object",
                properties: {}
              },
              execution: {
                taskSupport: "forbidden"
              }
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "tools/call") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          content: [
            {
              type: "text",
              text: "pong"
            }
          ]
        }
      })}\n`
    );
  }
});
