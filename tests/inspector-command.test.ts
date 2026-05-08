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

describe("doctor inspector command", () => {
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
