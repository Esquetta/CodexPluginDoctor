import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };

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

async function createTempFilePath(filename: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-"));
  return path.join(directory, filename);
}

async function createClaudeAppDataFixture(config?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-claude-"));
  const claudeDirectory = path.join(directory, "Claude");

  await mkdir(claudeDirectory, { recursive: true });

  if (config !== undefined) {
    await writeFile(
      path.join(claudeDirectory, "claude_desktop_config.json"),
      typeof config === "string" ? config : JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  return directory;
}

async function createCursorHomeFixture(config?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-cursor-"));
  const cursorDirectory = path.join(directory, ".cursor");

  await mkdir(cursorDirectory, { recursive: true });

  if (config !== undefined) {
    await writeFile(
      path.join(cursorDirectory, "mcp.json"),
      typeof config === "string" ? config : JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  return directory;
}

const codexHomeFixture = path.resolve("tests/fixtures/codex-home");

describe("runCli", () => {
  it("runs a bundled self-test against the doctor runtime sample", async () => {
    const { io, stdout, stderr } = createIo();
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-self-test-"));

    const exitCode = await runCli(["self-test", "--no-animations"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { APPDATA: directory, USERPROFILE: directory }
      }
    });
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Codex Plugin Doctor Self-Test");
    expect(output).toContain("Validation: PASS");
    expect(output).toContain("Runtime probes: enabled");
    expect(output).toContain("Compatibility Scorecard");
    expect(output).toContain("Codex: 100 (PASS)");
    expect(output).toContain("Generic MCP: 100 (PASS)");
  });

  it("renders a compatibility matrix for a Codex plugin with MCP config", async () => {
    const { io, stdout, stderr } = createIo();
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-no-claude-"));

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--no-animations"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: directory, USERPROFILE: directory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Compatibility Matrix");
    expect(output).toContain("Codex: PASS");
    expect(output).toContain("Generic MCP: PASS");
    expect(output).toContain("Claude Desktop: WARN");
    expect(output).toContain("Cursor: WARN");
  });

  it("returns a failing compatibility matrix when Codex validation fails", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "tests/fixtures/missing-manifest", "--no-animations"],
      io
    );

    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("Codex: FAIL");
  });

  it("treats standalone MCP packages as generic MCP compatible without requiring a Codex manifest", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "tests/fixtures/generic-mcp-only", "--no-animations"],
      io
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Codex: SKIPPED");
    expect(output).toContain("Generic MCP: PASS");
  });

  it("renders a machine-readable compatibility matrix when --json is requested", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "tests/fixtures/generic-mcp-only", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "Codex", status: "skipped" }),
        expect.objectContaining({ client: "Generic MCP", status: "pass" })
      ])
    );
  });

  it("writes the JSON compatibility matrix to the requested output path", async () => {
    const outputPath = await createTempFilePath("compatibility.json");
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--json", "--output", outputPath],
      io
    );
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout.join(""))).toEqual(writtenReport);
    expect(writtenReport.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ client: "Codex", status: "pass" }),
        expect.objectContaining({ client: "Generic MCP", status: "pass" })
      ])
    );
  });

  it("renders a compatibility scorecard when requested", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-scorecard-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--scorecard"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: directory, USERPROFILE: directory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Compatibility Scorecard");
    expect(output).toContain("Codex: 100");
    expect(output).toContain("Generic MCP: 100");
    expect(output).toContain("Claude Desktop: 70");
    expect(output).toContain("Cursor: 70");
  });

  it("renders a focused compatibility scorecard for one client", async () => {
    const homeDirectory = await createCursorHomeFixture({ mcpServers: {} });
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor", "--scorecard"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Compatibility Scorecard");
    expect(output).toContain("Cursor: 100");
    expect(output).not.toContain("Codex:");
    expect(output).not.toContain("Claude Desktop:");
  });

  it("filters compatibility output to a requested client", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "generic-mcp"],
      io
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).not.toContain("Codex:");
    expect(output).toContain("Generic MCP: PASS");
    expect(output).not.toContain("Claude Desktop:");
    expect(output).not.toContain("Cursor:");
  });

  it("detects an addable Claude Desktop config on this machine", async () => {
    const appData = await createClaudeAppDataFixture({ mcpServers: {} });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "claude-desktop"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: appData }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Claude Desktop: PASS");
    expect(output).toContain("Claude Desktop config is valid and this MCP package can be added.");
    expect(output).toContain(path.join(appData, "Claude", "claude_desktop_config.json"));
  });

  it("warns when Claude Desktop is not detected locally but the package is portable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-no-claude-"));
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "claude-desktop"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: directory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Claude Desktop: WARN");
    expect(output).toContain("Claude Desktop was not detected on this machine.");
  });

  it("fails Claude Desktop compatibility when the local config cannot be parsed safely", async () => {
    const appData = await createClaudeAppDataFixture("{ invalid json");
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "claude-desktop"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: appData }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(1);
    expect(output).toContain("Claude Desktop: FAIL");
    expect(output).toContain("Claude Desktop config is not valid JSON.");
  });

  it("warns when the Claude Desktop config already has a matching server name", async () => {
    const appData = await createClaudeAppDataFixture({
      mcpServers: {
        doctorRuntime: {
          command: "node",
          args: ["existing-server.js"]
        }
      }
    });
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "claude-desktop"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: appData }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Claude Desktop: WARN");
    expect(output).toContain("Claude Desktop already has MCP server names from this package.");
    expect(output).toContain("doctorRuntime");
  });

  it("renders a Claude Desktop install preview without changing the local config", async () => {
    const appData = await createClaudeAppDataFixture({ mcpServers: {} });
    const configPath = path.join(appData, "Claude", "claude_desktop_config.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "compat",
        "examples/codex-doctor-runtime",
        "--client",
        "claude-desktop",
        "--install-preview"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: appData }
        }
      }
    );
    const output = stdout.join("");
    const expectedServerPath = JSON.stringify(
      path.resolve("examples/codex-doctor-runtime/mock-server.js")
    ).slice(1, -1);
    const unchangedConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Claude Desktop Install Preview");
    expect(output).toContain(configPath);
    expect(output).toContain('"doctorRuntime"');
    expect(output).toContain('"command": "node"');
    expect(output).toContain(expectedServerPath);
    expect(unchangedConfig).toEqual({ mcpServers: {} });
  });

  it("rejects install preview without the Claude Desktop compatibility client", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--install-preview"],
      io
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain(
      "--install-preview and --apply require --client claude-desktop or --client cursor"
    );
  });

  it("detects an addable Cursor global MCP config on this machine", async () => {
    const homeDirectory = await createCursorHomeFixture({ mcpServers: {} });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Cursor: PASS");
    expect(output).toContain("Cursor global MCP config is valid and this package can be added.");
    expect(output).toContain(path.join(homeDirectory, ".cursor", "mcp.json"));
  });

  it("accepts a BOM-encoded Cursor MCP config", async () => {
    const homeDirectory = await createCursorHomeFixture("\uFEFF{\"mcpServers\":{}}");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Cursor: PASS");
  });

  it("warns when Cursor is not detected locally but the package is portable", async () => {
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-no-cursor-"));
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Cursor: WARN");
    expect(output).toContain("Cursor was not detected on this machine.");
  });

  it("fails Cursor compatibility when the local config cannot be parsed safely", async () => {
    const homeDirectory = await createCursorHomeFixture("{ invalid json");
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(1);
    expect(output).toContain("Cursor: FAIL");
    expect(output).toContain("Cursor MCP config is not valid JSON.");
  });

  it("warns when the Cursor config already has a matching server name", async () => {
    const homeDirectory = await createCursorHomeFixture({
      mcpServers: {
        doctorRuntime: {
          command: "node",
          args: ["existing-server.js"]
        }
      }
    });
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Cursor: WARN");
    expect(output).toContain("Cursor already has MCP server names from this package.");
    expect(output).toContain("doctorRuntime");
  });

  it("renders a Cursor install preview without changing the local config", async () => {
    const homeDirectory = await createCursorHomeFixture({ mcpServers: {} });
    const configPath = path.join(homeDirectory, ".cursor", "mcp.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor", "--install-preview"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");
    const expectedServerPath = JSON.stringify(
      path.resolve("examples/codex-doctor-runtime/mock-server.js")
    ).slice(1, -1);
    const unchangedConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Cursor Install Preview");
    expect(output).toContain(configPath);
    expect(output).toContain('"doctorRuntime"');
    expect(output).toContain('"command": "node"');
    expect(output).toContain(expectedServerPath);
    expect(unchangedConfig).toEqual({ mcpServers: {} });
  });

  it("applies a Cursor install with a backup when explicitly requested", async () => {
    const homeDirectory = await createCursorHomeFixture({ mcpServers: {} });
    const configPath = path.join(homeDirectory, ".cursor", "mcp.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "compat",
        "examples/codex-doctor-runtime",
        "--client",
        "cursor",
        "--apply",
        "--backup"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const output = stdout.join("");
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));
    const backups = (await readdir(path.dirname(configPath)))
      .filter((name) => name.startsWith("mcp.json.") && name.endsWith(".bak"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Applied Cursor MCP config");
    expect(output).toContain("Backup:");
    expect(writtenConfig.mcpServers.doctorRuntime.command).toBe("node");
    expect(writtenConfig.mcpServers.doctorRuntime.args[0]).toBe(
      path.resolve("examples/codex-doctor-runtime/mock-server.js")
    );
    expect(backups).toHaveLength(1);
  });

  it("applies a Claude Desktop install with a backup when explicitly requested", async () => {
    const appData = await createClaudeAppDataFixture({ mcpServers: {} });
    const configPath = path.join(appData, "Claude", "claude_desktop_config.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "compat",
        "examples/codex-doctor-runtime",
        "--client",
        "claude-desktop",
        "--apply",
        "--backup"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { APPDATA: appData }
        }
      }
    );
    const output = stdout.join("");
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Applied Claude Desktop MCP config");
    expect(writtenConfig.mcpServers.doctorRuntime.command).toBe("node");
  });

  it("rejects apply without an explicit backup flag", async () => {
    const homeDirectory = await createCursorHomeFixture({ mcpServers: {} });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cursor", "--apply"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("--apply requires --backup");
  });

  it("refuses to apply when server names would be overwritten", async () => {
    const homeDirectory = await createCursorHomeFixture({
      mcpServers: {
        doctorRuntime: {
          command: "node",
          args: ["existing-server.js"]
        }
      }
    });
    const configPath = path.join(homeDirectory, ".cursor", "mcp.json");
    const before = await readFile(configPath, "utf8");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "compat",
        "examples/codex-doctor-runtime",
        "--client",
        "cursor",
        "--apply",
        "--backup"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { USERPROFILE: homeDirectory }
        }
      }
    );
    const after = await readFile(configPath, "utf8");

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Refusing to overwrite existing MCP server names");
    expect(stderr.join("")).toContain("doctorRuntime");
    expect(after).toBe(before);
  });

  it("fails clearly for an unknown compatibility client", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", ".", "--client", "unknown-agent"],
      io
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Unknown compatibility client: unknown-agent");
  });

  it("explains a known finding id", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["explain", "plugin.manifest.missing"], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("plugin.manifest.missing");
    expect(output).toContain("Why it matters");
    expect(output).toContain(".codex-plugin/plugin.json");
    expect(output).toContain("docs/rules/catalog.md");
  });

  it("fails clearly when explaining an unknown finding id", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["explain", "plugin.unknown.rule"], io);

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Unknown finding id: plugin.unknown.rule");
  });

  it("prints the package version with --version", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["--version"], io);

    expect(exitCode).toBe(0);
    expect(stdout.join("").trim()).toBe(packageJson.version);
    expect(stderr).toEqual([]);
  });

  it("lists installed Codex plugins without requiring users to know plugin paths", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["list", "--installed"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture
        }
      }
    });

    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Installed Codex Plugins");
    expect(output).toContain("github");
    expect(output).toContain("browser-use");
    expect(output).toContain(path.join(codexHomeFixture, "plugins", "cache"));
  });

  it("checks installed Codex plugins selected by name", async () => {
    const { io, stdout } = createIo();
    const checkedTargets: string[] = [];

    const exitCode = await runCli(["check", "--installed", "github", "--no-animations"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture
        }
      },
      runCheckImpl: async (targetPath) => {
        checkedTargets.push(targetPath);

        return {
          targetPath,
          status: "pass",
          exitCode: 0,
          findings: []
        };
      }
    });

    expect(exitCode).toBe(0);
    expect(checkedTargets).toEqual([
      path.join(codexHomeFixture, "plugins", "cache", "openai-curated", "github", "6807e4de")
    ]);
    expect(stdout.join("")).toContain("Status: PASS");
  });

  it("renders a compact summary for all installed Codex plugin checks", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(["check", "--installed", "--all-summary", "--no-animations"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture
        }
      },
      runCheckImpl: async (targetPath) => {
        const isGithub = targetPath.includes("github");

        return {
          targetPath,
          status: isGithub ? "warn" : "pass",
          exitCode: 0,
          findings: isGithub
            ? [
                {
                  id: "plugin.heuristic.description.too_long",
                  severity: "warn",
                  message: "Description is long.",
                  impact: "Noisy matching.",
                  suggestedFix: "Shorten it."
                }
              ]
            : []
        };
      }
    });

    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Installed Plugin Summary");
    expect(output).toContain("Checked: 2");
    expect(output).toContain("Pass: 1");
    expect(output).toContain("Warn: 1");
    expect(output).toContain("Fail: 0");
    expect(output).toContain("github");
    expect(output).toContain("plugin.heuristic.description.too_long");
    expect(output).not.toContain("Codex Plugin Doctor\n===================");
  });

  it("honors ignoreRules from .codex-doctor.json", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/config-ignore-warning", "--no-animations"],
      io
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("")).toContain("Status: PASS");
    expect(stdout.join("")).toContain("No findings.");
    expect(stdout.join("")).not.toContain("plugin.heuristic.description.too_long");
  });

  it("turns warnings into a blocking result when failOnWarnings is enabled", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/config-fail-on-warnings", "--no-animations"],
      io
    );

    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("Status: FAIL");
    expect(stdout.join("")).toContain("plugin.heuristic.description.too_long");
  });

  it("initializes a minimal Codex plugin package", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-init-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["init", targetPath], io);
    const manifest = JSON.parse(
      await readFile(path.join(targetPath, ".codex-plugin", "plugin.json"), "utf8")
    );
    const skill = await readFile(
      path.join(targetPath, "skills", "hello", "SKILL.md"),
      "utf8"
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Initialized Codex plugin package");
    expect(manifest.name).toBe(path.basename(targetPath).toLowerCase());
    expect(manifest.skills).toBe("skills");
    expect(skill).toContain("name: hello");
  });

  it("writes the JSON report to the requested output path", async () => {
    const outputPath = await createTempFilePath("report.json");
    const { io } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/valid-plugin-with-mcp", "--json", "--output", outputPath],
      io
    );

    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(writtenReport.schemaVersion).toBe("1.0.0");
    expect(writtenReport.summary.runtimeProbeEnabled).toBe(false);
    expect(writtenReport.summary.findingCounts.total).toBe(0);
  });

  it("fails runtime probing when a configured stdio server exits early", async () => {
    const outputPath = await createTempFilePath("runtime-fail.json");
    const { io } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "tests/fixtures/runtime-crash",
        "--json",
        "--runtime",
        "--output",
        outputPath
      ],
      io
    );

    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(1);
    expect(writtenReport.summary.runtimeProbeEnabled).toBe(true);
    expect(writtenReport.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.exited_early",
          severity: "fail"
        })
      ])
    );
  });

  it("passes runtime probing when a configured stdio server stays alive through the startup window", async () => {
    const outputPath = await createTempFilePath("runtime-pass.json");
    const { io } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "tests/fixtures/runtime-valid",
        "--json",
        "--runtime",
        "--output",
        outputPath
      ],
      io
    );

    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(writtenReport.summary.runtimeProbeEnabled).toBe(true);
    expect(writtenReport.findings).toEqual([]);
  });

  it("writes a markdown summary when --markdown is requested", async () => {
    const outputPath = await createTempFilePath("report.md");
    const { io } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "tests/fixtures/heuristic-long-plugin-description",
        "--markdown",
        "--output",
        outputPath
      ],
      io
    );

    const writtenReport = await readFile(outputPath, "utf8");

    expect(exitCode).toBe(0);
    expect(writtenReport).toContain("# Codex Plugin Doctor Report");
    expect(writtenReport).toContain("plugin.heuristic.description.too_long");
  });

  it("writes a SARIF report when --sarif is requested", async () => {
    const outputPath = await createTempFilePath("report.sarif");
    const { io } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "tests/fixtures/security-hardcoded-secret",
        "--sarif",
        "--output",
        outputPath
      ],
      io
    );

    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(1);
    expect(writtenReport.version).toBe("2.1.0");
    expect(writtenReport.runs[0].tool.driver.name).toBe("Codex Plugin Doctor");
    expect(writtenReport.runs[0].results[0].ruleId).toBe("plugin.security.hard_coded_secret");
    expect(writtenReport.runs[0].results[0].level).toBe("error");
  });

  it("writes live status updates to stderr for interactive TTY text runs", async () => {
    vi.useFakeTimers();

    const { io, stdout, stderr } = createIo();

    const exitCodePromise = runCli(
      ["check", "tests/fixtures/valid-plugin-with-mcp"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: true,
          stderrIsTTY: true,
          env: {}
        },
        runCheckImpl: async () => {
          await new Promise((resolve) => setTimeout(resolve, 150));

          return {
            targetPath: path.resolve("tests/fixtures/valid-plugin-with-mcp"),
            status: "pass",
            exitCode: 0,
            findings: []
          };
        }
      }
    );

    await vi.advanceTimersByTimeAsync(250);
    const exitCode = await exitCodePromise;

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("Validating package");
    expect(stderr.join("")).toContain("Validation complete");
    expect(stdout.join("")).toContain("Status: PASS");

    vi.useRealTimers();
  });

  it("does not write live status to stderr when --no-animations is used", async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/valid-plugin-with-mcp", "--no-animations"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: true,
          stderrIsTTY: true,
          env: {}
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  it("keeps stderr clean for JSON output even when running in a TTY", async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/runtime-valid", "--json", "--runtime"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: true,
          stderrIsTTY: true,
          env: {}
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
  });

  it("writes a runtime transcript to stderr when --verbose-runtime is enabled", async () => {
    const { io, stderr, stdout } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/runtime-valid", "--json", "--runtime", "--verbose-runtime"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: true,
          stderrIsTTY: true,
          env: {}
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("-> initialize");
    expect(stderr.join("")).toContain("<- tools/list");
    expect(stderr.join("")).toContain("<- tools/call");
    expect(stderr.join("")).toContain("<- resources/list");
    expect(stderr.join("")).toContain("<- resources/read");
    expect(stderr.join("")).toContain("<- resources/templates/list");
    expect(stderr.join("")).toContain("<- prompts/list");
    expect(stderr.join("")).toContain("<- prompts/get");
    expect(() => JSON.parse(stdout.join(""))).not.toThrow();
  });

  it("redacts generated prompt argument values in verbose runtime transcripts", async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/runtime-valid", "--json", "--runtime", "--verbose-runtime"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: true,
          stderrIsTTY: true,
          env: {}
        }
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr.join("")).toContain("\"diff\":\"[REDACTED]\"");
    expect(stderr.join("")).not.toContain("codex-plugin-doctor-probe");
  });

  it("renders ASCII-safe output when --ascii is requested", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/security-hardcoded-secret", "--ascii"],
      io
    );

    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("x plugin.security.hard_coded_secret");
  });
});
