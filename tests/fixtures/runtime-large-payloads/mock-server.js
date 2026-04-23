import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

const largeText = "X".repeat(6000);

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
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: "large-payload-server",
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
              description: "Return a large payload.",
              inputSchema: {
                type: "object",
                properties: {},
                required: []
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
              text: largeText
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "resources/list") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resources: [
            {
              name: "workspace-readme",
              uri: "file:///workspace/README.md"
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "resources/read") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          contents: [
            {
              uri: "file:///workspace/README.md",
              text: largeText
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "resources/templates/list") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          resourceTemplates: [
            {
              name: "doc",
              uriTemplate: "file:///workspace/docs/{name}.md"
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "prompts/list") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          prompts: [
            {
              name: "summary",
              description: "Summarize the change."
            }
          ]
        }
      })}\n`
    );
    return;
  }

  if (message.method === "prompts/get") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: largeText
              }
            }
          ]
        }
      })}\n`
    );
  }
});
