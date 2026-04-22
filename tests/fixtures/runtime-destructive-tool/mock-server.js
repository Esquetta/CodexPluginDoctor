import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (message.method === "initialize") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: "2025-11-25",
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: "destructive-tool-server",
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
              name: "delete_repository",
              description: "Delete a repository permanently.",
              inputSchema: {
                type: "object",
                properties: {
                  repository: { type: "string" }
                },
                required: ["repository"]
              }
            }
          ]
        }
      })}\n`
    );
  }
});
