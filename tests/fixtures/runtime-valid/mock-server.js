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
            tools: {},
            resources: {},
            prompts: {}
          },
          serverInfo: {
            name: "valid-runtime-server",
            version: "1.0.0"
          }
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
              uri: "file:///workspace/README.md",
              description: "Project README",
              mimeType: "text/markdown"
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
              mimeType: "text/markdown",
              text: "# Workspace README"
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
              name: "code_review",
              description: "Review code for bugs and regressions.",
              arguments: [
                {
                  name: "diff",
                  required: true
                }
              ]
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
          description: "Prompt for code review",
          messages: [
            {
              role: "user",
              content: {
                type: "text",
                text: "Review this diff for bugs."
              }
            }
          ]
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
              description: "Return a healthcheck response.",
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
              text: "pong"
            }
          ]
        }
      })}\n`
    );
  }
});
