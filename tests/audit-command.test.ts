import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { CheckResult } from "../src/domain/types.js";
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

async function createInstalledPlugin(
  codexHome: string,
  relativePath: string,
  manifest: Record<string, unknown>,
  mcpConfig?: unknown
): Promise<string> {
  const rootPath = path.join(codexHome, "plugins", "cache", relativePath);

  await mkdir(path.join(rootPath, ".codex-plugin"), { recursive: true });
  await writeFile(
    path.join(rootPath, ".codex-plugin", "plugin.json"),
    JSON.stringify(manifest, null, 2),
    "utf8"
  );

  if (mcpConfig !== undefined) {
    await writeFile(
      path.join(rootPath, ".mcp.json"),
      JSON.stringify(mcpConfig, null, 2),
      "utf8"
    );
  }

  return rootPath;
}

async function createCodexHomeFixture(): Promise<string> {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-audit-home-"));

  await createInstalledPlugin(
    codexHome,
    "vendor/safe/1.0.0",
    {
      name: "safe",
      version: "1.0.0",
      description: "Safe installed plugin fixture."
    }
  );
  await createInstalledPlugin(
    codexHome,
    "vendor/risky/1.0.0",
    {
      name: "risky",
      version: "1.0.0",
      description: "Risky installed plugin fixture.",
      mcpServers: ".mcp.json"
    },
    {
      mcpServers: {
        danger: {
          command: "powershell",
          args: ["-EncodedCommand", "SQBFAFgA"],
          env: {
            OPENAI_API_KEY: "sk-test-hardcoded-secret-123456"
          }
        }
      }
    }
  );

  return codexHome;
}

describe("audit command", () => {
  it("audits installed plugins with security and compatibility details", async () => {
    const codexHome = await createCodexHomeFixture();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["audit", "--installed", "--security", "--compat", "--json"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHome },
        platform: "win32"
      }
    });
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.summary.totalPlugins).toBe(2);
    expect(output.summary.fail).toBe(1);
    expect(output.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          plugin: expect.objectContaining({ name: "safe" }),
          status: "pass"
        }),
        expect.objectContaining({
          plugin: expect.objectContaining({ name: "risky" }),
          status: "fail",
          security: expect.objectContaining({ status: "fail" }),
          compatibility: expect.objectContaining({
            results: expect.arrayContaining([
              expect.objectContaining({ client: "Codex", status: "fail" })
            ])
          })
        })
      ])
    );
    expect(output.priorityActions[0]).toContain("risky");
  });

  it("writes audit JSON to an output path", async () => {
    const codexHome = await createCodexHomeFixture();
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-audit-output-")),
      "audit.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["audit", "--installed", "--security", "--json", "--output", outputPath], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHome },
        platform: "win32"
      }
    });
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toEqual(writtenReport);
    expect(writtenReport.summary.totalPlugins).toBe(2);
  });

  it("reuses cached audit results and supports changed-only output", async () => {
    const codexHome = await createCodexHomeFixture();
    const cachePath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-audit-cache-")),
      "audit-cache.json"
    );
    const buildOptions = (validatePlugin: (targetPath: string) => Promise<CheckResult>) => ({
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHome },
        platform: "win32" as const
      },
      runCheckImpl: validatePlugin
    });
    let validateCalls = 0;
    const validatePlugin = async (targetPath: string): Promise<CheckResult> => {
      validateCalls += 1;

      return {
        targetPath,
        status: "pass",
        exitCode: 0,
        findings: []
      };
    };
    const first = createIo();

    expect(await runCli(
      ["audit", "--installed", "--json", "--cache", "--cache-file", cachePath],
      first.io,
      buildOptions(validatePlugin)
    )).toBe(0);
    expect(validateCalls).toBe(2);

    validateCalls = 0;
    const second = createIo();

    expect(await runCli(
      ["audit", "--installed", "--json", "--cache", "--cache-file", cachePath],
      second.io,
      buildOptions(validatePlugin)
    )).toBe(0);

    const secondOutput = JSON.parse(second.stdout.join(""));

    expect(validateCalls).toBe(0);
    expect(secondOutput.summary.cached).toBe(2);
    expect(secondOutput.plugins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cached: true })
      ])
    );

    const changedOnly = createIo();

    expect(await runCli(
      ["audit", "--installed", "--json", "--cache", "--changed", "--cache-file", cachePath],
      changedOnly.io,
      buildOptions(validatePlugin)
    )).toBe(0);

    const changedOutput = JSON.parse(changedOnly.stdout.join(""));

    expect(changedOnly.stderr).toEqual([]);
    expect(changedOutput.summary.totalPlugins).toBe(0);
    expect(changedOutput.summary.skippedUnchanged).toBe(2);
  });

  it("requires --installed for ecosystem audits", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["audit"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Usage: codex-plugin-doctor audit --installed");
  });

  it("renders dependency audit JSON for automation consumers", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-audit-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["audit", "deps", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toMatchObject({
      schemaVersion: "1.0.0",
      targetPath: path.resolve(targetPath),
      status: "pass",
      totalVulnerabilities: 0,
      vulnerabilities: [],
      audit: null
    });
  });
});
