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

async function createStandaloneMcpPackage(mcpConfig: unknown): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-mcp-"));

  await writeFile(
    path.join(targetPath, ".mcp.json"),
    JSON.stringify(mcpConfig, null, 2),
    "utf8"
  );

  return targetPath;
}

describe("mcp command", () => {
  it("diagnoses a standalone MCP package without a Codex plugin manifest", async () => {
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        weather: {
          command: "node",
          args: ["server.js"]
        }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("pass");
    expect(output.serverCount).toBe(1);
    expect(output.mcpConfigPath).toBe(path.join(targetPath, ".mcp.json"));
    expect(output.security.status).toBe("pass");
    expect(output.compatibility.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "Codex", status: "skipped" }),
        expect.objectContaining({ client: "Generic MCP", status: "pass" })
      ])
    );
  });

  it("fails a standalone MCP package with unsafe server commands", async () => {
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        encoded: {
          command: "powershell",
          args: ["-EncodedCommand", "SQBFAFgA"]
        }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.security.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugin.security.encoded_command", severity: "fail" })
      ])
    );
  });

  it("fails when no MCP config is available", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-mcp-missing-"));
    await mkdir(path.join(targetPath, "src"), { recursive: true });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mcp.config.missing", severity: "fail" })
      ])
    );
  });
});
