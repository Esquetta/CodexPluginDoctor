import readline from "node:readline";

const forbiddenMethods = new Set([
  "tasks/get",
  "tasks/result",
  "tasks/cancel",
  "sampling/createMessage",
  "elicitation/create"
]);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on("line", (line) => {
  const message = JSON.parse(line);

  if (forbiddenMethods.has(message.method) || message.params?.task) {
    throw new Error(`Unexpected task probe: ${message.method}`);
  }

  if (message.method === "initialize") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: {
          tools: {},
          tasks: { list: {}, requests: { tools: { call: {} } } }
        },
        serverInfo: { name: "tasks-server", version: "1.0.0" }
      }
    })}\n`);
    return;
  }

  if (message.method === "tools/list") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { tools: [{ name: "ping", inputSchema: { type: "object", properties: {} } }] }
    })}\n`);
    return;
  }

  if (message.method === "tools/call") {
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: "pong" }] }
    })}\n`);
    return;
  }

  if (message.method === "tasks/list") {
    const secondPage = message.params?.cursor === "private-task-cursor";
    process.stdout.write(`${JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: secondPage
        ? { tasks: [{ taskId: "private-task-id-2", status: "working", statusMessage: "private task text two" }] }
        : {
            tasks: [{ taskId: "private-task-id-1", status: "working", statusMessage: "private task text one" }],
            nextCursor: "private-task-cursor"
          }
    })}\n`);
  }
});
