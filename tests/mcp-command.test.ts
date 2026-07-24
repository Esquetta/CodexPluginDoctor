import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
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
  it("renders finding fingerprints in text output", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-mcp-missing-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath], io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toMatch(/Fingerprint: [a-f0-9]{64}/);
  });

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
    expect(output.runtimeScorecard).toBeUndefined();
    expect(output.compatibility.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "Codex", status: "skipped" }),
        expect.objectContaining({ client: "Generic MCP", status: "pass" })
      ])
    );
  });

  it("runs explicit runtime conformance for a valid task-capable MCP config", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["mcp", "tests/fixtures/runtime-conformance-tasks-valid", "--runtime", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.runtimeScorecard.conformance).toMatchObject({
      profile: "2025-11-25",
      tasksList: "pass",
      overall: "pass"
    });
    expect(output.runtimeExecution).toMatchObject({ backend: "native" });
  });

  it("fingerprints runtime conformance failures and makes them fail the MCP report", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["mcp", "tests/fixtures/runtime-conformance-tasks-invalid", "--runtime"],
      io
    );
    const output = stdout.join("");

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output).toContain("Status: FAIL");
    expect(output).toContain("Runtime conformance: FAIL");
    expect(output).toMatch(/mcp\.conformance\.tasks_list\.invalid[\s\S]*Fingerprint: [a-f0-9]{64}/);
  });

  it("preserves the worst runtime scorecard when a later server passes", async () => {
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        failing: {
          command: process.execPath,
          args: [path.resolve("tests/fixtures/runtime-conformance-tasks-invalid/mock-server.js")]
        },
        passing: {
          command: process.execPath,
          args: [path.resolve("tests/fixtures/runtime-conformance-tasks-valid/mock-server.js")]
        }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--runtime", "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.runtimeScorecard.conformance).toMatchObject({
      profile: "2025-11-25",
      tasksList: "fail",
      overall: "fail"
    });
  });

  const symlinkIt = process.platform === "win32" ? it.skip : it;

  symlinkIt("does not execute an MCP config reached through a symlink escape", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-mcp-root-"));
    const externalPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-mcp-external-"));
    const markerPath = path.join(externalPath, "runtime-started");
    const serverPath = path.join(externalPath, "server.js");
    const externalConfigPath = path.join(externalPath, ".mcp.json");

    await writeFile(
      serverPath,
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(markerPath)}, "started");\nprocess.stdin.resume();\n`,
      "utf8"
    );
    await writeFile(
      externalConfigPath,
      JSON.stringify({
        mcpServers: {
          external: {
            command: process.execPath,
            args: [serverPath]
          }
        }
      }),
      "utf8"
    );
    await symlink(externalConfigPath, path.join(targetPath, ".mcp.json"), "file");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--runtime", "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "mcp.config.path_outside_root" })
      ])
    );
    await expect(access(markerPath)).rejects.toThrow();
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
        expect.objectContaining({
          id: "plugin.security.encoded_command",
          severity: "fail",
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ])
    );
  });

  it("distinguishes repeated invalid server entries with config locators", async () => {
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        alpha: "invalid",
        beta: "invalid"
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));
    const findings = output.findings.filter(
      (finding: { id: string }) => finding.id === "mcp.server.invalid"
    );

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(findings.map((finding: { evidence: unknown }) => finding.evidence)).toEqual([
      {
        configPath: ".mcp.json",
        serverName: "alpha",
        field: "server"
      },
      {
        configPath: ".mcp.json",
        serverName: "beta",
        field: "server"
      }
    ]);
    expect(
      new Set(findings.map((finding: { fingerprint: string }) => finding.fingerprint)).size
    ).toBe(2);
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
        expect.objectContaining({
          id: "mcp.config.missing",
          severity: "fail",
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ])
    );
  });
});
