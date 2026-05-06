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

async function createHttpMcpPlugin(): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-policy-"));

  await mkdir(path.join(targetPath, ".codex-plugin"), { recursive: true });
  await writeFile(
    path.join(targetPath, ".codex-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "http-mcp-policy-fixture",
        version: "1.0.0",
        description: "HTTP MCP fixture.",
        mcpServers: ".mcp.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.join(targetPath, ".mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          remote: {
            url: "http://example.com/mcp"
          }
        }
      },
      null,
      2
    ),
    "utf8"
  );

  return targetPath;
}

describe("policy packs", () => {
  it("applies codex-publish policy to fail check warnings", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/heuristic-long-plugin-description", "--policy", "codex-publish", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.summary.status).toBe("fail");
    expect(output.summary.runtimeProbeEnabled).toBe(true);
    expect(output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugin.heuristic.description.too_long" })
      ])
    );
  });

  it("applies security policy to fail security warnings", async () => {
    const targetPath = await createHttpMcpPlugin();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["security", targetPath, "--policy", "security", "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugin.security.insecure_http_url", severity: "warn" })
      ])
    );
  });

  it("rejects unknown policy packs", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["check", "tests/fixtures/valid-plugin", "--policy", "unknown"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Unknown policy");
  });
});
