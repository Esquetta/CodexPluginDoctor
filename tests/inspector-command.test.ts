import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/run-cli.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      }
    }
  };
}

async function createInspectorPackage(config: unknown): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-inspector-layout-"));

  await mkdir(path.join(targetPath, ".codex-plugin"));
  await writeFile(
    path.join(targetPath, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "inspector-layout",
      version: "1.0.0",
      description: "Inspector MCP layout fixture.",
      mcpServers: ".mcp.json"
    }),
    "utf8"
  );
  await writeFile(path.join(targetPath, ".mcp.json"), JSON.stringify(config), "utf8");

  return targetPath;
}

describe("doctor inspector command", () => {
  it.each([
    { layout: "direct", config: { layoutServer: { command: "node", args: ["server.mjs"] } } },
    { layout: "snake case", config: { mcp_servers: { layoutServer: { command: "node", args: ["server.mjs"] } } } },
    { layout: "legacy camel case", config: { mcpServers: { layoutServer: { command: "node", args: ["server.mjs"] } } } }
  ])("builds an Inspector command for a $layout package-source server", async ({ config }) => {
    const targetPath = await createInspectorPackage(config);
    const { io, stdout } = createIo();

    const exitCode = await runCli(["doctor", "inspector", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(output.status).toBe("pass");
    expect(output.serverName).toBe("layoutServer");
  });

  it("does not build an Inspector command for an ambiguous MCP source layout", async () => {
    const targetPath = await createInspectorPackage({
      mcpServers: { layoutServer: { command: "node", args: ["server.mjs"] } },
      mcp_servers: { layoutServer: { command: "node", args: ["server.mjs"] } }
    });
    const { io, stdout } = createIo();

    const exitCode = await runCli(["doctor", "inspector", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(output.status).toBe("fail");
    expect(output.command).toBeNull();
  });

  it("builds an MCP Inspector command for a packaged MCP server", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "inspector", "tests/fixtures/valid-plugin-with-mcp", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.inspector");
    expect(output.status).toBe("pass");
    expect(output.serverName).toBe("context7");
    expect(output.command.executable).toBe("npx");
    expect(output.command.args).toEqual([
      "-y",
      "@modelcontextprotocol/inspector",
      "--config",
      expect.stringContaining(".mcp.json"),
      "--server",
      "context7"
    ]);
  });
});
