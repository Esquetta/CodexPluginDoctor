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
            name: "generated-tool-server",
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
              name: "summarize_diff",
              description: "Summarize a diff safely for review.",
              inputSchema: {
                type: "object",
                properties: {
                  diff: { type: "string" },
                  retries: { type: "integer" },
                  includeContext: { type: "boolean" },
                  mode: { type: "string", enum: ["quick", "full"] }
                },
                required: ["diff", "retries", "includeContext", "mode"]
              }
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "tools/call") {
    const args = message.params?.arguments;
    const isValid =
      typeof args?.diff === "string" &&
      typeof args?.retries === "number" &&
      typeof args?.includeContext === "boolean" &&
      args?.mode === "quick";

    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: isValid
          ? {
              content: [
                {
                  type: "text",
                  text: "summary-ok"
                }
              ]
            }
          : {
              content: "invalid"
            }
      })}\n`
    );
  }
});

