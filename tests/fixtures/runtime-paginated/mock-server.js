import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity
});

rl.on("line", (line) => {
  const message = JSON.parse(line);
  const cursor = message.params?.cursor;

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
            name: "paginated-runtime-server",
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
        result:
          cursor === "tools-page-2"
            ? {
                tools: [
                  {
                    name: "ping_two",
                    description: "Second page tool.",
                    inputSchema: {
                      type: "object",
                      properties: {},
                      required: []
                    }
                  }
                ]
              }
            : {
                tools: [
                  {
                    name: "ping_one",
                    description: "First page tool.",
                    inputSchema: {
                      type: "object",
                      properties: {},
                      required: []
                    }
                  }
                ],
                nextCursor: "tools-page-2"
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
    return;
  }

  if (message.method === "resources/list") {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        result:
          cursor === "resources-page-2"
            ? {
                resources: [
                  {
                    name: "workspace-license",
                    uri: "file:///workspace/LICENSE"
                  }
                ]
              }
            : {
                resources: [
                  {
                    name: "workspace-readme",
                    uri: "file:///workspace/README.md"
                  }
                ],
                nextCursor: "resources-page-2"
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
              text: "# Workspace README"
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
        result:
          cursor === "templates-page-2"
            ? {
                resourceTemplates: [
                  {
                    name: "log",
                    uriTemplate: "file:///workspace/logs/{name}.log"
                  }
                ]
              }
            : {
                resourceTemplates: [
                  {
                    name: "doc",
                    uriTemplate: "file:///workspace/docs/{name}.md"
                  }
                ],
                nextCursor: "templates-page-2"
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
        result:
          cursor === "prompts-page-2"
            ? {
                prompts: [
                  {
                    name: "summary",
                    description: "Summarize the change."
                  }
                ]
              }
            : {
                prompts: [
                  {
                    name: "code_review",
                    description: "Review code for bugs.",
                    arguments: [
                      {
                        name: "diff",
                        required: true
                      }
                    ]
                  }
                ],
                nextCursor: "prompts-page-2"
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
                text: "Review this diff."
              }
            }
          ]
        }
      })}\n`
    );
  }
});

