import { access, mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
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

async function startRemoteMcpServer(options: { invalidInitialize?: boolean; session?: boolean; incompleteSse?: boolean } = {}): Promise<{
  url: string;
  requests: string[];
  close(): Promise<void>;
}> {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      if (request.method === "GET") {
        requests.push("GET");
        if (options.incompleteSse) {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.end("id: bounded-event\\n");
          return;
        }
        response.writeHead(405);
        response.end();
        return;
      }

      if (request.method === "DELETE") {
        requests.push("DELETE");
        response.writeHead(204);
        response.end();
        return;
      }
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string };
      requests.push(message.method);

      if (message.method === "initialize") {
        if (options.invalidInitialize) {
          response.writeHead(500, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "initialize failed" }));
          return;
        }

        response.writeHead(200, {
          "content-type": "application/json",
          ...(options.session ? { "mcp-session-id": "session-for-test" } : {})
        });
        response.end(JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            serverInfo: { name: "local", version: "1.0.0" }
          }
        }));
        return;
      }

      response.writeHead(204);
      response.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP listening address.");
  }

  return {
    url: `http://localhost:${address.port}/mcp`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

describe("mcp command", () => {
  it("requires runtime and network approval flags before probing a local remote MCP server", async () => {
    const remote = await startRemoteMcpServer();
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: { local: { url: remote.url } }
    });

    try {
      const missingRuntime = createIo();
      const missingNetwork = createIo();
      const approved = createIo();

      expect(await runCli(["mcp", targetPath, "--allow-network"], missingRuntime.io)).toBe(2);
      expect(missingRuntime.stderr.join("")).toContain("--allow-network requires --runtime");

      expect(await runCli(["mcp", targetPath, "--runtime", "--allow-local-network"], missingNetwork.io)).toBe(2);
      expect(missingNetwork.stderr.join("")).toContain("--allow-local-network requires --allow-network");

      expect(await runCli([
        "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--json"
      ], approved.io)).toBe(0);
      expect(JSON.parse(approved.stdout.join(""))).toMatchObject({
        runtimeScorecard: {
          remote: {
            networkSafety: "pass",
            initialize: "pass",
            protocolHeaders: "pass",
            overall: "pass"
          }
        }
      });
      expect(remote.requests).toEqual(["initialize", "notifications/initialized", "GET"]);
    } finally {
      await remote.close();
    }
  });

  it("forwards runtime network approvals through the doctor mcp alias", async () => {
    const remote = await startRemoteMcpServer();
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: { local: { url: remote.url } }
    });
    const { io, stdout, stderr } = createIo();

    try {
      const exitCode = await runCli([
        "doctor", "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--json"
      ], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(JSON.parse(stdout.join(""))).toMatchObject({
        runtimeScorecard: { remote: { networkSafety: "pass", overall: "pass" } }
      });
      expect(remote.requests).toEqual(["initialize", "notifications/initialized", "GET"]);
    } finally {
      await remote.close();
    }
  });

  it("requires lifecycle consent before terminating a remote session", async () => {
    const remote = await startRemoteMcpServer({ session: true });
    const targetPath = await createStandaloneMcpPackage({ mcpServers: { local: { url: remote.url } } });
    const { io, stderr } = createIo();

    try {
      const exitCode = await runCli([
        "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--allow-session-lifecycle", "--json"
      ], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(remote.requests).toEqual(["initialize", "notifications/initialized", "GET", "DELETE"]);
    } finally {
      await remote.close();
    }
  });

  it("turns an inconclusive remote reliability scorecard into a blocking result only when requested", async () => {
    const remote = await startRemoteMcpServer({ incompleteSse: true });
    const targetPath = await createStandaloneMcpPackage({ mcpServers: { local: { url: remote.url } } });
    const withoutGate = createIo();
    const withGate = createIo();

    try {
      expect(await runCli([
        "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--json"
      ], withoutGate.io)).toBe(0);
      expect(await runCli([
        "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--require-remote-reliability", "--json"
      ], withGate.io)).toBe(1);
    } finally {
      await remote.close();
    }
  });

  it("blocks the strict gate when one of multiple remote reliability scorecards warns", async () => {
    const passing = await startRemoteMcpServer();
    const warning = await startRemoteMcpServer({ incompleteSse: true });
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        passing: { url: passing.url },
        warning: { url: warning.url }
      }
    });
    const { io, stdout, stderr } = createIo();

    try {
      const exitCode = await runCli([
        "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--require-remote-reliability", "--json"
      ], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);
      expect(output.runtimeScorecard.remote.reliability.overall).toBe("warn");
      expect(passing.requests).toEqual(["initialize", "notifications/initialized", "GET"]);
      expect(warning.requests).toEqual(["initialize", "notifications/initialized", "GET"]);
    } finally {
      await passing.close();
      await warning.close();
    }
  });

  it("preserves the worst remote status when a later remote server passes", async () => {
    const failing = await startRemoteMcpServer({ invalidInitialize: true });
    const passing = await startRemoteMcpServer();
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        failing: { url: failing.url },
        passing: { url: passing.url }
      }
    });
    const { io, stdout, stderr } = createIo();

    try {
      const exitCode = await runCli([
        "mcp", targetPath, "--runtime", "--allow-network", "--allow-local-network", "--json"
      ], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(1);
      expect(stderr).toEqual([]);
      expect(output.runtimeScorecard.remote).toMatchObject({
        initialize: "fail",
        overall: "fail"
      });
      expect(failing.requests).toEqual(["initialize"]);
      expect(passing.requests).toEqual(["initialize", "notifications/initialized", "GET"]);
    } finally {
      await failing.close();
      await passing.close();
    }
  });

  it("advertises doctor mcp and release evidence remote approval flags without dropping compat backups", async () => {
    const { io, stderr } = createIo();

    expect(await runCli([], io)).toBe(2);

    const usage = stderr.join("");
    expect(usage).toContain("doctor mcp <path> [--runtime [--allow-network [--allow-local-network]]]");
    expect(usage).toContain("release-evidence asset <path> --tag <tag> --output <evidence.json> --sign-key-env NAME [--runtime [--allow-network [--allow-local-network]]]");
    expect(usage).toContain("[--install-preview|--apply --backup]");
  });

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

  it("accepts an explicit localhost HTTP development transport", async () => {
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        local: { url: "http://LOCALHOST:3000/mcp" }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("pass");
    expect(output.security.status).toBe("pass");
  });

  it("fails conflicting remote transports without exposing URL credentials", async () => {
    const rawUrl = "https://user:secret@example.com/mcp?token=secret";
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        remote: { command: "node", url: rawUrl }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const serialized = stdout.join("");
    const output = JSON.parse(serialized);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.findings).toHaveLength(3);
    expect(output.findings.map((finding: { id: string }) => finding.id)).toEqual([
      "mcp.server.transport.conflict",
      "plugin.security.remote_mcp_url.credentials",
      "plugin.security.remote_mcp_url.query"
    ]);
    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain("secret");
  });

  it("reports remote URL security evidence from a manifest-configured MCP file", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-mcp-custom-config-"));
    const mcpConfigPath = path.join(targetPath, "config", "remote.json");
    const rawUrl = "https://example.com/mcp?token=secret";

    await mkdir(path.join(targetPath, ".codex-plugin"), { recursive: true });
    await mkdir(path.dirname(mcpConfigPath), { recursive: true });
    await writeFile(
      path.join(targetPath, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "custom-config",
        version: "1.0.0",
        description: "Custom MCP config fixture.",
        mcpServers: "./config/remote.json"
      }),
      "utf8"
    );
    await writeFile(
      mcpConfigPath,
      JSON.stringify({
        mcpServers: {
          remote: { url: rawUrl }
        }
      }),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const serialized = stdout.join("");
    const output = JSON.parse(serialized);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.security.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.security.remote_mcp_url.query",
          evidence: expect.objectContaining({
            configPath: "config/remote.json",
            serverName: "remote",
            url: "https://example.com/mcp"
          })
        })
      ])
    );
    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain("secret");
  });

  it("reports empty query and fragment delimiters without exposing the remote URL", async () => {
    const rawUrl = "https://example.com/mcp?#";
    const targetPath = await createStandaloneMcpPackage({
      mcpServers: {
        remote: { url: rawUrl }
      }
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["mcp", targetPath, "--json"], io);
    const serialized = stdout.join("");
    const output = JSON.parse(serialized);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.findings.map((finding: { id: string }) => finding.id)).toEqual(
      expect.arrayContaining([
        "plugin.security.remote_mcp_url.query",
        "plugin.security.remote_mcp_url.fragment"
      ])
    );
    expect(serialized).not.toContain(rawUrl);
  });

  it("runs explicit runtime conformance for a valid task-capable MCP config", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["mcp", "tests/fixtures/runtime-conformance-tasks-valid", "--runtime", "--json"],
      io
    );
    const serialized = stdout.join("");
    const output = JSON.parse(serialized);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.runtimeScorecard.conformance).toMatchObject({
      profile: "2025-11-25",
      tasksList: "pass",
      overall: "pass"
    });
    expect(output.runtimeExecution).toMatchObject({ backend: "native" });
    expect(serialized).not.toContain("private-task-id");
    expect(serialized).not.toContain("private task text");
    expect(serialized).not.toContain("private-task-cursor");
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
