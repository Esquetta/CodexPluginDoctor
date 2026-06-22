import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import packageJson from "../package.json" with { type: "json" };

import { runCheck } from "../src/index.js";
import { runCli } from "../src/run-cli.js";

function createIo(answers: string[] = []) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const prompts: string[] = [];

  return {
    stdout,
    stderr,
    prompts,
    io: {
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      },
      async readStdin(prompt: string) {
        prompts.push(prompt);
        return answers.shift() ?? "";
      }
    }
  };
}

async function createTempFilePath(filename: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-"));
  return path.join(directory, filename);
}

async function createSuppressCommandFixture(
  config?: unknown
): Promise<{ targetPath: string; configPath: string }> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-suppress-cli-"));
  const configPath = path.join(targetPath, "doctor-config.json");

  if (config !== undefined) {
    await writeFile(
      configPath,
      typeof config === "string" ? config : JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  return { targetPath, configPath };
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

async function createClineDirFixture(config?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-cline-"));
  const settingsDirectory = path.join(directory, "data", "settings");

  await mkdir(settingsDirectory, { recursive: true });

  if (config !== undefined) {
    await writeFile(
      path.join(settingsDirectory, "cline_mcp_settings.json"),
      typeof config === "string" ? config : JSON.stringify(config, null, 2),
      "utf8"
    );
  }

  return directory;
}

async function createWindsurfHomeFixture(config?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-windsurf-"));
  const settingsDirectory = path.join(directory, ".codeium", "windsurf");

  await mkdir(settingsDirectory, { recursive: true });

  if (config !== undefined) {
    await writeFile(
      path.join(settingsDirectory, "mcp_config.json"),
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

  it("renders every compatibility client when --all is explicit", async () => {
    const { io, stdout, stderr } = createIo();
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-compat-all-"));

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--all", "--scorecard"],
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
    expect(output).toContain("Codex:");
    expect(output).toContain("Generic MCP:");
    expect(output).toContain("Claude Desktop:");
    expect(output).toContain("Cursor:");
    expect(output).toContain("Cline:");
    expect(output).toContain("Windsurf:");
  });

  it("rejects --all when a single compatibility client is requested", async () => {
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--all", "--client", "cursor"],
      io
    );

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Use either --all or --client, not both.");
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

  it("runs the generic MCP doctor through the doctor mcp alias", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "mcp", "tests/fixtures/generic-mcp-only", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.mcp.healthcheck");
    expect(output.serverCount).toBe(1);
    expect(output.status).toBe("pass");
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
          env: { APPDATA: appData },
          platform: "win32"
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
          env: { APPDATA: directory },
          platform: "win32"
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
          env: { APPDATA: appData },
          platform: "win32"
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
          env: { APPDATA: appData },
          platform: "win32"
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
          env: { APPDATA: appData },
          platform: "win32"
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
      "--install-preview and --apply require --client claude-desktop, cursor, cline, or windsurf"
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

  it("detects an addable Cline MCP config on this machine", async () => {
    const clineDirectory = await createClineDirFixture({ mcpServers: {} });
    const configPath = path.join(clineDirectory, "data", "settings", "cline_mcp_settings.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cline"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { CLINE_DIR: clineDirectory }
        }
      }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Cline: PASS");
    expect(output).toContain("Cline MCP config is valid and this package can be added.");
    expect(output).toContain(configPath);
  });

  it("renders a Cline install preview without changing the local config", async () => {
    const clineDirectory = await createClineDirFixture({ mcpServers: {} });
    const configPath = path.join(clineDirectory, "data", "settings", "cline_mcp_settings.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "cline", "--install-preview"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { CLINE_DIR: clineDirectory }
        }
      }
    );
    const output = stdout.join("");
    const unchangedConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Cline Install Preview");
    expect(output).toContain(configPath);
    expect(output).toContain('"doctorRuntime"');
    expect(output).toContain("cline_mcp_settings.json");
    expect(unchangedConfig).toEqual({ mcpServers: {} });
  });

  it("detects an addable Windsurf MCP config on this machine", async () => {
    const homeDirectory = await createWindsurfHomeFixture({ mcpServers: {} });
    const configPath = path.join(homeDirectory, ".codeium", "windsurf", "mcp_config.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "windsurf"],
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
    expect(output).toContain("Windsurf: PASS");
    expect(output).toContain("Windsurf MCP config is valid and this package can be added.");
    expect(output).toContain(configPath);
  });

  it("renders a Windsurf install preview without changing the local config", async () => {
    const homeDirectory = await createWindsurfHomeFixture({ mcpServers: {} });
    const configPath = path.join(homeDirectory, ".codeium", "windsurf", "mcp_config.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--client", "windsurf", "--install-preview"],
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
    const unchangedConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Windsurf Install Preview");
    expect(output).toContain(configPath);
    expect(output).toContain('"doctorRuntime"');
    expect(output).toContain("mcp_config.json");
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
          env: { APPDATA: appData },
          platform: "win32"
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

  it("prints first-run guidance when no command is provided", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli([], io);
    const output = stderr.join("");

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(output).toContain("First run:");
    expect(output).toContain("codex-plugin-doctor doctor");
    expect(output).toContain("codex-plugin-doctor init my-plugin");
    expect(output).toContain("codex-plugin-doctor check . --runtime --explain");
  });

  it("renders a local doctor environment healthcheck", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHomeFixture, npm_config_prefix: "C:\\npm-global" },
        platform: "win32"
      }
    });
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Codex Plugin Doctor Environment");
    expect(output).toContain(`Version: ${packageJson.version}`);
    expect(output).toContain("Platform: win32");
    expect(output).toContain("Codex home: PASS");
    expect(output).toContain("npm global prefix: C:\\npm-global");
    expect(output).toContain("Recommended next commands");
    expect(output).toContain("codex-plugin-doctor list --installed");
    expect(output).toContain("codex-plugin-doctor check . --runtime --explain");
  });

  it("renders a local doctor environment healthcheck as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "--json"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHomeFixture, npm_config_prefix: "C:\\npm-global" },
        platform: "win32"
      }
    });
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toMatchObject({
      schemaVersion: "1.0.0",
      version: packageJson.version,
      platform: "win32",
      npmGlobalPrefix: "C:\\npm-global",
      codexHome: {
        status: "pass",
        path: codexHomeFixture
      },
      codexPluginCache: {
        status: "pass",
        path: path.join(codexHomeFixture, "plugins", "cache")
      }
    });
    expect(output.node).toMatch(/^v\d+\./);
  });

  it("checks whether the installed CLI version is behind npm latest", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "--update-check"], io, {
      resolveLatestVersion: async () => "99.0.0"
    });
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Codex Plugin Doctor Update Check");
    expect(output).toContain(`Installed: ${packageJson.version}`);
    expect(output).toContain("Latest: 99.0.0");
    expect(output).toContain("Status: UPDATE AVAILABLE");
    expect(output).toContain("npm install -g codex-plugin-doctor@latest");
  });

  it("renders local client install and config readiness", async () => {
    const appData = await createClaudeAppDataFixture({ mcpServers: {} });
    const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-clients-"));
    const clineDirectory = path.join(homeDirectory, ".cline");
    await mkdir(path.join(homeDirectory, ".cursor"), { recursive: true });
    await mkdir(path.join(homeDirectory, ".codeium", "windsurf"), { recursive: true });
    await mkdir(path.join(clineDirectory, "data", "settings"), { recursive: true });
    await writeFile(path.join(homeDirectory, ".cursor", "mcp.json"), "{\"mcpServers\":{}}", "utf8");
    await writeFile(
      path.join(homeDirectory, ".codeium", "windsurf", "mcp_config.json"),
      "{\"mcpServers\":{}}",
      "utf8"
    );
    await writeFile(
      path.join(clineDirectory, "data", "settings", "cline_mcp_settings.json"),
      "{\"mcpServers\":{}}",
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "clients"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          APPDATA: appData,
          CODEX_HOME: codexHomeFixture,
          CLINE_DIR: clineDirectory,
          USERPROFILE: homeDirectory
        },
        platform: "win32"
      }
    });
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Codex Plugin Doctor Clients");
    expect(output).toContain("Codex: PASS");
    expect(output).toContain("Claude Desktop: PASS");
    expect(output).toContain("Cursor: PASS");
    expect(output).toContain("Cline: PASS");
    expect(output).toContain("Windsurf: PASS");
    expect(output).toContain(path.join(homeDirectory, ".cursor", "mcp.json"));
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

  it("writes a structured JSON artifact for installed plugin checks", async () => {
    const outputPath = await createTempFilePath("installed-report.json");
    const { io, stdout } = createIo();

    const exitCode = await runCli(["check", "--installed", "--json", "--output", outputPath], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture
        }
      },
      runCheckImpl: async (targetPath) => ({
        targetPath,
        status: targetPath.includes("github") ? "warn" : "pass",
        exitCode: 0,
        findings: targetPath.includes("github")
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
      })
    });

    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));
    const stdoutReport = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(writtenReport.kind).toBe("doctor.installed.check");
    expect(writtenReport.summary.checked).toBe(2);
    expect(writtenReport.summary.status).toBe("warn");
    expect(writtenReport.plugins).toHaveLength(2);
    expect(writtenReport.plugins.map((item: { plugin: { name: string } }) => item.plugin.name)).toEqual([
      "browser-use",
      "github"
    ]);
    expect(writtenReport.plugins[1].report.findings[0].id).toBe("plugin.heuristic.description.too_long");
    expect(stdoutReport).toEqual(writtenReport);
  });

  it("writes a valid SARIF artifact for installed plugin checks", async () => {
    const outputPath = await createTempFilePath("installed-report.sarif");
    const { io, stdout } = createIo();

    const exitCode = await runCli(["check", "--installed", "--sarif", "--output", outputPath], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {
          CODEX_HOME: codexHomeFixture
        }
      },
      runCheckImpl: async (targetPath) => ({
        targetPath,
        status: targetPath.includes("github") ? "fail" : "pass",
        exitCode: targetPath.includes("github") ? 1 : 0,
        findings: targetPath.includes("github")
          ? [
              {
                id: "plugin.manifest.missing",
                severity: "fail",
                message: "Manifest missing.",
                impact: "Codex cannot load it.",
                suggestedFix: "Create the manifest."
              }
            ]
          : []
      })
    });

    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));
    const stdoutReport = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(writtenReport.version).toBe("2.1.0");
    expect(writtenReport.runs).toHaveLength(2);
    expect(writtenReport.runs[1].results[0].ruleId).toBe("plugin.manifest.missing");
    expect(stdoutReport).toEqual(writtenReport);
  });

  it("adds compatibility status to the installed plugin summary when requested", async () => {
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["check", "--installed", "--compat", "--all-summary", "--no-animations"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: {
            CODEX_HOME: codexHomeFixture
          }
        },
        runCheckImpl: async (targetPath) => ({
          targetPath,
          status: "pass",
          exitCode: 0,
          findings: []
        })
      }
    );

    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(output).toContain("Installed Plugin Summary");
    expect(output).toContain("Installed Compatibility Summary");
    expect(output).toContain("browser-use");
    expect(output).toContain("github");
    expect(output).toContain("Codex: PASS");
    expect(output).toContain("Generic MCP: SKIPPED");
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

  it("suppresses one exact fingerprint while keeping the same-rule sibling active", async () => {
    const targetPath = await mkdtemp(
      path.join(os.tmpdir(), "codex-plugin-doctor-suppression-")
    );

    await mkdir(path.join(targetPath, ".codex-plugin"), { recursive: true });
    await mkdir(path.join(targetPath, "skills", "alpha"), { recursive: true });
    await mkdir(path.join(targetPath, "skills", "beta"), { recursive: true });
    await writeFile(
      path.join(targetPath, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "suppression-fixture",
        version: "1.0.0",
        description: "Suppression fixture.",
        skills: "./skills"
      }),
      "utf8"
    );

    const initial = await runCheck(targetPath);
    const candidates = initial.findings.filter(
      (finding) => finding.id === "plugin.skill.skill_md.missing"
    );

    await writeFile(
      path.join(targetPath, ".codex-doctor.json"),
      JSON.stringify({
        suppressions: [
          {
            fingerprint: candidates[0].fingerprint,
            reason: "Accepted for the alpha fixture.",
            expiresAt: "2099-12-31"
          }
        ]
      }),
      "utf8"
    );

    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(
      ["check", targetPath, "--json", "--no-animations"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.findings).toHaveLength(1);
    expect(output.findings[0].fingerprint).toBe(candidates[1].fingerprint);
    expect(output.suppressedFindings).toEqual([
      expect.objectContaining({
        fingerprint: candidates[0].fingerprint,
        suppression: {
          reason: "Accepted for the alpha fixture.",
          expiresAt: "2099-12-31"
        }
      })
    ]);
    expect(output.suppressionSummary).toEqual({
      applied: 1,
      expired: 0,
      invalid: 0
    });
  });

  it("adds a suppression in JSON mode and preserves unknown top-level config fields", async () => {
    const existingFingerprint = "a".repeat(64);
    const addedFingerprint = "b".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture({
      unknownTopLevel: { keep: true },
      suppressions: [
        {
          fingerprint: existingFingerprint,
          reason: "Existing exception.",
          expiresAt: "2026-12-31",
          source: "existing"
        }
      ]
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "suppress",
        "add",
        targetPath,
        "--fingerprint",
        addedFingerprint,
        "--reason",
        "  Reviewed exception.  ",
        "--expires-at",
        "2026-09-15",
        "--config",
        configPath,
        "--json"
      ],
      io
    );
    const output = JSON.parse(stdout.join(""));
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toEqual({
      schemaVersion: "1.0.0",
      command: "suppress.add",
      configPath: path.resolve(configPath),
      index: 1,
      suppression: {
        fingerprint: addedFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-09-15"
      }
    });
    expect(writtenConfig).toEqual({
      unknownTopLevel: { keep: true },
      suppressions: [
        {
          fingerprint: existingFingerprint,
          reason: "Existing exception.",
          expiresAt: "2026-12-31",
          source: "existing"
        },
        {
          fingerprint: addedFingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-09-15"
        }
      ]
    });
  });

  it("adds a suppression in text mode", async () => {
    const addedFingerprint = "c".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "suppress",
        "add",
        targetPath,
        "--fingerprint",
        addedFingerprint,
        "--reason",
        "Reviewed in triage.",
        "--expires-at",
        "2026-10-01",
        "--config",
        configPath
      ],
      io
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toBe(
      [
        "Action: Added",
        `Config: ${path.resolve(configPath)}`,
        "Index: 0",
        "",
        `Fingerprint: ${addedFingerprint}`,
        "Reason: Reviewed in triage.",
        "Expires: 2026-10-01"
      ].join("\n")
    );
  });

  it("lists suppressions in text and JSON without writing the config", async () => {
    const activeFingerprint = "d".repeat(64);
    const originalConfig = JSON.stringify(
      {
        unknownTopLevel: { keep: true },
        suppressions: [
          {
            fingerprint: activeFingerprint,
            reason: "Reviewed exception.",
            expiresAt: "2026-12-31"
          },
          {
            reason: "Missing fingerprint.",
            expiresAt: "2026-09-15",
            secret: "sk_should_not_escape"
          }
        ]
      },
      null,
      2
    );
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);
    const { io, stdout, stderr } = createIo();

    const textExitCode = await runCli(
      ["suppress", "list", targetPath, "--config", configPath],
      io
    );
    const textOutput = stdout.join("");

    stdout.length = 0;
    stderr.length = 0;

    const jsonExitCode = await runCli(
      ["suppress", "list", targetPath, "--config", configPath, "--json"],
      io
    );
    const jsonOutput = JSON.parse(stdout.join(""));
    const finalConfig = await readFile(configPath, "utf8");

    expect(textExitCode).toBe(0);
    expect(jsonExitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(textOutput).toBe(
      [
        `Config: ${path.resolve(configPath)}`,
        "Total suppressions: 2",
        "",
        "Suppressions",
        "------------",
        `[0] ACTIVE ${activeFingerprint}`,
        "  Reason: Reviewed exception.",
        "  Expires: 2026-12-31",
        "[1] INVALID fingerprint"
      ].join("\n")
    );
    expect(jsonOutput).toEqual({
      schemaVersion: "1.0.0",
      command: "suppress.list",
      configPath: path.resolve(configPath),
      suppressions: [
        {
          index: 0,
          status: "active",
          fingerprint: activeFingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-12-31"
        },
        {
          index: 1,
          status: "invalid",
          invalidField: "fingerprint"
        }
      ]
    });
    expect(finalConfig).toBe(originalConfig);
  });

  it("removes a suppression by index in JSON mode", async () => {
    const firstFingerprint = "e".repeat(64);
    const removedFingerprint = "f".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture({
      suppressions: [
        {
          fingerprint: firstFingerprint,
          reason: "Keep this suppression.",
          expiresAt: "2026-12-31"
        },
        {
          fingerprint: removedFingerprint,
          reason: "Remove this suppression.",
          expiresAt: "2026-09-15"
        }
      ]
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "suppress",
        "remove",
        targetPath,
        "--index",
        "1",
        "--config",
        configPath,
        "--json"
      ],
      io
    );
    const output = JSON.parse(stdout.join(""));
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toEqual({
      schemaVersion: "1.0.0",
      command: "suppress.remove",
      configPath: path.resolve(configPath),
      index: 1,
      suppression: {
        fingerprint: removedFingerprint,
        reason: "Remove this suppression.",
        expiresAt: "2026-09-15"
      }
    });
    expect(writtenConfig).toEqual({
      suppressions: [
        {
          fingerprint: firstFingerprint,
          reason: "Keep this suppression.",
          expiresAt: "2026-12-31"
        }
      ]
    });
  });

  it("removes a suppression by fingerprint in text mode", async () => {
    const keptFingerprint = "1".repeat(64);
    const removedFingerprint = "2".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture({
      unknownTopLevel: "kept",
      suppressions: [
        {
          fingerprint: keptFingerprint,
          reason: "Keep this suppression.",
          expiresAt: "2026-12-31"
        },
        {
          fingerprint: removedFingerprint,
          reason: "Remove by fingerprint.",
          expiresAt: "2026-10-15"
        }
      ]
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "suppress",
        "remove",
        targetPath,
        "--fingerprint",
        removedFingerprint,
        "--config",
        configPath
      ],
      io
    );
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toBe(
      [
        "Action: Removed",
        `Config: ${path.resolve(configPath)}`,
        "Index: 1",
        "",
        `Fingerprint: ${removedFingerprint}`,
        "Reason: Remove by fingerprint.",
        "Expires: 2026-10-15"
      ].join("\n")
    );
    expect(writtenConfig).toEqual({
      unknownTopLevel: "kept",
      suppressions: [
        {
          fingerprint: keptFingerprint,
          reason: "Keep this suppression.",
          expiresAt: "2026-12-31"
        }
      ]
    });
  });

  it("adds a selected active finding interactively with the default local-calendar expiry", async () => {
    const firstFingerprint = "a".repeat(64);
    const selectedFingerprint = "b".repeat(64);
    const governanceFingerprint = "c".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture({
      unknownTopLevel: { keep: true }
    });
    const { io, stdout, stderr, prompts } = createIo([
      "2",
      "Accepted until upstream release.",
      "",
      "yes"
    ]);

    const exitCode = await runCli(
      ["suppress", "add", targetPath, "--config", configPath],
      io,
      {
        now: () => new Date(2026, 0, 31, 23, 45),
        runCheckImpl: async (checkedPath) => ({
          targetPath: checkedPath,
          status: "fail",
          exitCode: 1,
          findings: [
            {
              id: "plugin.first",
              severity: "warn",
              message: "First finding.",
              impact: "First impact.",
              suggestedFix: "Fix first.",
              fingerprint: firstFingerprint
            },
            {
              id: "plugin.second",
              severity: "fail",
              message: "Second finding.",
              impact: "Second impact.",
              suggestedFix: "Fix second.",
              fingerprint: selectedFingerprint
            },
            {
              id: "suppression.invalid",
              severity: "warn",
              message: "Governance finding.",
              impact: "Governance impact.",
              suggestedFix: "Fix governance.",
              fingerprint: governanceFingerprint
            }
          ]
        })
      }
    );
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));
    const output = stdout.join("\n");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(prompts).toEqual([
      "Select finding to suppress: ",
      "Reason: ",
      "Expiration date [2026-03-02]: ",
      "Type yes to confirm: "
    ]);
    expect(output).toContain(`[1] WARN plugin.first - First finding.\n    ${firstFingerprint}`);
    expect(output).toContain(`[2] FAIL plugin.second - Second finding.\n    ${selectedFingerprint}`);
    expect(output).not.toContain("suppression.invalid");
    expect(output).not.toContain(governanceFingerprint);
    expect(writtenConfig).toEqual({
      unknownTopLevel: { keep: true },
      suppressions: [
        {
          fingerprint: selectedFingerprint,
          reason: "Accepted until upstream release.",
          expiresAt: "2026-03-02"
        }
      ]
    });
  });

  it("accepts a custom expiry date for interactive suppression add", async () => {
    const fingerprint = "d".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture();
    const { io, stderr } = createIo([
      "1",
      "Temporary acceptance.",
      "2026-08-15",
      " YES "
    ]);

    const exitCode = await runCli(
      ["suppress", "add", targetPath, "--config", configPath],
      io,
      {
        now: () => new Date(2026, 5, 1),
        runCheckImpl: async (checkedPath) => ({
          targetPath: checkedPath,
          status: "warn",
          exitCode: 0,
          findings: [
            {
              id: "plugin.custom-expiry",
              severity: "warn",
              message: "Custom expiry finding.",
              impact: "Impact.",
              suggestedFix: "Fix.",
              fingerprint
            }
          ]
        })
      }
    );
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(writtenConfig.suppressions).toEqual([
      {
        fingerprint,
        reason: "Temporary acceptance.",
        expiresAt: "2026-08-15"
      }
    ]);
  });

  it.each([
    {
      name: "invalid selection",
      answers: ["2"],
      message: "Selection must be a number from 1 to 1."
    },
    {
      name: "blank reason",
      answers: ["1", "   "],
      message: "Suppression reason must not be blank."
    },
    {
      name: "invalid date",
      answers: ["1", "Reviewed.", "2026-02-30"],
      message: "Suppression record is invalid: expiresAt."
    }
  ])("rejects $name during interactive suppression add without writing", async ({
    answers,
    message
  }) => {
    const originalConfig = JSON.stringify({ preserve: true }, null, 2);
    const fingerprint = "e".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);
    const { io, stdout, stderr } = createIo(answers);
    const writeConfig = vi.fn();

    const exitCode = await runCli(
      ["suppress", "add", targetPath, "--config", configPath],
      io,
      {
        writeRawDoctorConfigImpl: writeConfig,
        runCheckImpl: async (checkedPath) => ({
          targetPath: checkedPath,
          status: "warn",
          exitCode: 0,
          findings: [
            {
              id: "plugin.invalid-input",
              severity: "warn",
              message: "Interactive finding.",
              impact: "Impact.",
              suggestedFix: "Fix.",
              fingerprint
            }
          ]
        })
      }
    );

    expect(exitCode).toBe(2);
    expect(stdout.join("")).toContain("plugin.invalid-input");
    expect(stderr.join("")).toContain(message);
    expect(writeConfig).not.toHaveBeenCalled();
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
  });

  it("runs interactive add against the explicitly configured check and reads raw config first", async () => {
    const suppressedFingerprint = "f".repeat(64);
    const activeFingerprint = "1".repeat(64);
    const malformedConfig = "{ invalid json";
    const malformedFixture = await createSuppressCommandFixture(malformedConfig);
    const malformedIo = createIo(["1", "Reason.", "", "yes"]);
    const malformedRunCheck = vi.fn();

    const malformedExitCode = await runCli(
      [
        "suppress",
        "add",
        malformedFixture.targetPath,
        "--config",
        malformedFixture.configPath
      ],
      malformedIo.io,
      { runCheckImpl: malformedRunCheck }
    );

    expect(malformedExitCode).toBe(1);
    expect(malformedRunCheck).not.toHaveBeenCalled();
    expect(malformedIo.prompts).toEqual([]);

    const { targetPath, configPath } = await createSuppressCommandFixture({
      suppressions: [
        {
          fingerprint: suppressedFingerprint,
          reason: "Already accepted.",
          expiresAt: "2099-12-31"
        }
      ]
    });
    const { io, stdout } = createIo(["1", "Accept active.", "", "yes"]);

    const exitCode = await runCli(
      ["suppress", "add", targetPath, "--config", configPath],
      io,
      {
        now: () => new Date(2026, 6, 1),
        runCheckImpl: async (checkedPath) => ({
          targetPath: checkedPath,
          status: "fail",
          exitCode: 1,
          findings: [
            {
              id: "plugin.suppressed",
              severity: "warn",
              message: "Already suppressed.",
              impact: "Impact.",
              suggestedFix: "Fix.",
              fingerprint: suppressedFingerprint
            },
            {
              id: "plugin.active",
              severity: "fail",
              message: "Still active.",
              impact: "Impact.",
              suggestedFix: "Fix.",
              fingerprint: activeFingerprint
            }
          ]
        })
      }
    );

    expect(exitCode).toBe(0);
    expect(stdout.join("")).not.toContain("plugin.suppressed");
    expect(stdout.join("")).toContain("plugin.active");
  });

  it("rejects a non-array suppression collection before interactive add prompts", async () => {
    const originalConfig = JSON.stringify({ suppressions: {} }, null, 2);
    const fingerprint = "6".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);
    const { io, stdout, stderr, prompts } = createIo([
      "1",
      "Reviewed.",
      "",
      "yes"
    ]);
    const runCheckImpl = vi.fn(async (checkedPath: string) => ({
      targetPath: checkedPath,
      status: "warn" as const,
      exitCode: 0 as const,
      findings: [
        {
          id: "plugin.invalid-config-order",
          severity: "warn" as const,
          message: "Candidate finding.",
          impact: "Impact.",
          suggestedFix: "Fix.",
          fingerprint
        }
      ]
    }));
    const writeConfig = vi.fn();

    const exitCode = await runCli(
      ["suppress", "add", targetPath, "--config", configPath],
      io,
      {
        runCheckImpl,
        writeRawDoctorConfigImpl: writeConfig
      }
    );

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      "Doctor config suppressions must be an array when present."
    ]);
    expect(prompts).toEqual([]);
    expect(runCheckImpl).not.toHaveBeenCalled();
    expect(writeConfig).not.toHaveBeenCalled();
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
  });

  it("removes the exact selected suppression index interactively across all statuses", async () => {
    const activeFingerprint = "2".repeat(64);
    const expiredFingerprint = "3".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture({
      preserve: true,
      suppressions: [
        {
          fingerprint: activeFingerprint,
          reason: "Active record.",
          expiresAt: "2026-12-31"
        },
        {
          fingerprint: expiredFingerprint,
          reason: "Expired record.",
          expiresAt: "2025-12-31"
        },
        {
          reason: "Invalid record.",
          expiresAt: "2026-12-31"
        }
      ]
    });
    const { io, stdout, stderr, prompts } = createIo(["2", "yes"]);

    const exitCode = await runCli(
      ["suppress", "remove", targetPath, "--config", configPath],
      io,
      { now: () => new Date(2026, 5, 1) }
    );
    const writtenConfig = JSON.parse(await readFile(configPath, "utf8"));
    const output = stdout.join("\n");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(prompts).toEqual([
      "Select suppression to remove: ",
      "Type yes to confirm: "
    ]);
    expect(output).toContain(`[1] ACTIVE config index 0 ${activeFingerprint}`);
    expect(output).toContain(`[2] EXPIRED config index 1 ${expiredFingerprint}`);
    expect(output).toContain("[3] INVALID config index 2 fingerprint");
    expect(output).toContain("Index: 1");
    expect(writtenConfig).toEqual({
      preserve: true,
      suppressions: [
        {
          fingerprint: activeFingerprint,
          reason: "Active record.",
          expiresAt: "2026-12-31"
        },
        {
          reason: "Invalid record.",
          expiresAt: "2026-12-31"
        }
      ]
    });
  });

  it.each([
    {
      action: "add",
      args: ["suppress", "add"],
      answers: ["1", "Reviewed.", "", "no"]
    },
    {
      action: "remove",
      args: ["suppress", "remove"],
      answers: ["1", "y"]
    }
  ])("cancels interactive suppression $action unless confirmation is exact yes", async ({
    action,
    args,
    answers
  }) => {
    const fingerprint = "4".repeat(64);
    const originalConfig = JSON.stringify({
      preserve: true,
      suppressions: action === "remove"
        ? [
            {
              fingerprint,
              reason: "Keep after cancellation.",
              expiresAt: "2099-12-31"
            }
          ]
        : []
    }, null, 2);
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);
    const { io, stdout, stderr } = createIo(answers);
    const writeConfig = vi.fn();

    const exitCode = await runCli(
      [...args, targetPath, "--config", configPath],
      io,
      {
        now: () => new Date(2026, 5, 1),
        writeRawDoctorConfigImpl: writeConfig,
        runCheckImpl: async (checkedPath) => ({
          targetPath: checkedPath,
          status: "warn",
          exitCode: 0,
          findings: [
            {
              id: "plugin.cancel",
              severity: "warn",
              message: "Cancellation candidate.",
              impact: "Impact.",
              suggestedFix: "Fix.",
              fingerprint
            }
          ]
        })
      }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain(`Suppression ${action} cancelled.`);
    expect(writeConfig).not.toHaveBeenCalled();
    expect(await readFile(configPath, "utf8")).toBe(originalConfig);
  });

  it("fails interactive add with no candidates and interactive remove with no suppressions", async () => {
    const { targetPath, configPath } = await createSuppressCommandFixture();

    for (const scenario of [
      {
        action: "add",
        runCheckImpl: async (checkedPath: string) => ({
          targetPath: checkedPath,
          status: "warn" as const,
          exitCode: 0 as const,
          findings: [
            {
              id: "suppression.expired",
              severity: "warn" as const,
              message: "Governance only.",
              impact: "Impact.",
              suggestedFix: "Fix.",
              fingerprint: "5".repeat(64)
            },
            {
              id: "plugin.no-fingerprint",
              severity: "warn" as const,
              message: "No fingerprint.",
              impact: "Impact.",
              suggestedFix: "Fix."
            }
          ]
        }),
        message: "No active fingerprinted findings are available to suppress."
      },
      {
        action: "remove",
        runCheckImpl: undefined,
        message: "No suppressions are available to remove."
      }
    ]) {
      const { io, stdout, stderr, prompts } = createIo();
      const writeConfig = vi.fn();
      const exitCode = await runCli(
        ["suppress", scenario.action, targetPath, "--config", configPath],
        io,
        {
          writeRawDoctorConfigImpl: writeConfig,
          ...(scenario.runCheckImpl ? { runCheckImpl: scenario.runCheckImpl } : {})
        }
      );

      expect(exitCode).toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain(scenario.message);
      expect(prompts).toEqual([]);
      expect(writeConfig).not.toHaveBeenCalled();
    }
  });

  it("rejects JSON and missing stdin support for interactive suppression modes", async () => {
    const { targetPath, configPath } = await createSuppressCommandFixture();

    for (const scenario of [
      {
        action: "add",
        extraArgs: ["--json"],
        message: "Interactive suppress add does not support --json."
      },
      {
        action: "remove",
        extraArgs: ["--json"],
        message: "Interactive suppress remove does not support --json."
      },
      {
        action: "add",
        extraArgs: [],
        message: "Interactive suppress add requires stdin input."
      },
      {
        action: "remove",
        extraArgs: [],
        message: "Interactive suppress remove requires stdin input."
      }
    ]) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const exitCode = await runCli(
        [
          "suppress",
          scenario.action,
          targetPath,
          "--config",
          configPath,
          ...scenario.extraArgs
        ],
        {
          writeStdout(message) {
            stdout.push(message);
          },
          writeStderr(message) {
            stderr.push(message);
          }
        }
      );

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain(scenario.message);
    }
  });

  it("rejects invalid suppress command shapes and flags with exit code 2", async () => {
    const { targetPath, configPath } = await createSuppressCommandFixture({
      suppressions: []
    });
    const fingerprint = "3".repeat(64);

    for (const scenario of [
      {
        args: ["suppress", "rename", targetPath],
        message: "Unknown suppress action: rename.",
        usage: "codex-plugin-doctor suppress add <path>"
      },
      {
        args: ["suppress", "list"],
        message: "Missing suppression target path.",
        usage: "codex-plugin-doctor suppress list <path>"
      },
      {
        args: ["suppress", "list", targetPath, "--config"],
        message: "Missing path after --config."
      },
      {
        args: ["suppress", "add", targetPath, "--fingerprint", fingerprint, "--reason", "why"],
        message: "suppress add requires --fingerprint, --reason, and --expires-at together."
      },
      {
        args: [
          "suppress",
          "remove",
          targetPath,
          "--index",
          "0",
          "--fingerprint",
          fingerprint
        ],
        message: "Use exactly one of --index or --fingerprint for suppress remove."
      },
      {
        args: ["suppress", "remove", targetPath, "--index", "-1"],
        message: "--index must be a non-negative integer."
      },
      {
        args: ["suppress", "list", targetPath, "--unexpected", "value", "--config", configPath],
        message: "Unknown suppress flag: --unexpected."
      }
    ]) {
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(scenario.args, io);

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain(scenario.message);

      if ("usage" in scenario) {
        expect(stderr.join("")).toContain(scenario.usage);
      }
    }
  });

  it("rejects oversized suppress remove indexes before config read or write", async () => {
    const originalConfig = JSON.stringify(
      {
        preserve: true,
        suppressions: [
          {
            fingerprint: "8".repeat(64),
            reason: "Keep this suppression.",
            expiresAt: "2026-12-31"
          }
        ]
      },
      null,
      2
    );
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);

    for (const indexValue of [
      "99999999999999999999999999999999999999999999999999",
      "9007199254740993"
    ]) {
      const { io, stdout, stderr } = createIo();
      const exitCode = await runCli(
        ["suppress", "remove", targetPath, "--index", indexValue, "--config", configPath],
        io
      );
      const finalConfig = await readFile(configPath, "utf8");

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain("--index must be a non-negative integer.");
      expect(finalConfig).toBe(originalConfig);
    }
  });

  it("rejects duplicate suppress flags before reading or writing config", async () => {
    const originalConfig = JSON.stringify(
      {
        preserve: true,
        suppressions: [
          {
            fingerprint: "9".repeat(64),
            reason: "Keep this suppression.",
            expiresAt: "2026-12-31"
          }
        ]
      },
      null,
      2
    );
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);

    for (const scenario of [
      {
        args: ["suppress", "list", targetPath, "--json", "--json", "--config", configPath],
        message: "Duplicate suppress flag: --json."
      },
      {
        args: [
          "suppress",
          "list",
          targetPath,
          "--config",
          configPath,
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --config."
      },
      {
        args: [
          "suppress",
          "add",
          targetPath,
          "--json",
          "--json",
          "--fingerprint",
          "6".repeat(64),
          "--reason",
          "Reviewed exception.",
          "--expires-at",
          "2026-10-01",
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --json."
      },
      {
        args: [
          "suppress",
          "add",
          targetPath,
          "--config",
          configPath,
          "--config",
          configPath,
          "--fingerprint",
          "6".repeat(64),
          "--reason",
          "Reviewed exception.",
          "--expires-at",
          "2026-10-01"
        ],
        message: "Duplicate suppress flag: --config."
      },
      {
        args: [
          "suppress",
          "add",
          targetPath,
          "--fingerprint",
          "6".repeat(64),
          "--fingerprint",
          "6".repeat(64),
          "--reason",
          "Reviewed exception.",
          "--expires-at",
          "2026-10-01",
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --fingerprint."
      },
      {
        args: [
          "suppress",
          "add",
          targetPath,
          "--fingerprint",
          "6".repeat(64),
          "--reason",
          "Reviewed exception.",
          "--reason",
          "Reviewed exception.",
          "--expires-at",
          "2026-10-01",
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --reason."
      },
      {
        args: [
          "suppress",
          "add",
          targetPath,
          "--fingerprint",
          "6".repeat(64),
          "--reason",
          "Reviewed exception.",
          "--expires-at",
          "2026-10-01",
          "--expires-at",
          "2026-10-01",
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --expires-at."
      },
      {
        args: [
          "suppress",
          "remove",
          targetPath,
          "--fingerprint",
          "9".repeat(64),
          "--fingerprint",
          "9".repeat(64),
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --fingerprint."
      },
      {
        args: [
          "suppress",
          "remove",
          targetPath,
          "--index",
          "0",
          "--index",
          "0",
          "--config",
          configPath
        ],
        message: "Duplicate suppress flag: --index."
      }
    ]) {
      const { io, stdout, stderr } = createIo();
      const exitCode = await runCli(scenario.args, io);
      const finalConfig = await readFile(configPath, "utf8");

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain(scenario.message);
      expect(finalConfig).toBe(originalConfig);
    }
  });

  it("returns exit code 1 and preserves malformed config bytes", async () => {
    const malformedConfig = "{\n  \"suppressions\": [\n";
    const { targetPath, configPath } = await createSuppressCommandFixture(malformedConfig);
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["suppress", "list", targetPath, "--config", configPath],
      io
    );
    const finalConfig = await readFile(configPath, "utf8");

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Unable to parse Doctor config at");
    expect(finalConfig).toBe(malformedConfig);
  });

  it("does not print success output when suppression mutation fails in the domain layer", async () => {
    const duplicateFingerprint = "4".repeat(64);
    const { targetPath, configPath } = await createSuppressCommandFixture({
      suppressions: [
        {
          fingerprint: duplicateFingerprint,
          reason: "Existing suppression.",
          expiresAt: "2026-12-31"
        }
      ]
    });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "suppress",
        "add",
        targetPath,
        "--fingerprint",
        duplicateFingerprint,
        "--reason",
        "Duplicate suppression.",
        "--expires-at",
        "2026-10-15",
        "--config",
        configPath
      ],
      io
    );

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Suppression fingerprint already exists at index 0.");
  });

  it("does not print success output when writing the config fails", async () => {
    const originalConfig = JSON.stringify(
      {
        preserve: true,
        suppressions: []
      },
      null,
      2
    );
    const { targetPath, configPath } = await createSuppressCommandFixture(originalConfig);
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "suppress",
        "add",
        targetPath,
        "--fingerprint",
        "5".repeat(64),
        "--reason",
        "Needs a write failure test.",
        "--expires-at",
        "2026-10-15",
        "--config",
        configPath
      ],
      io,
      {
        writeRawDoctorConfigImpl: async () => {
          throw new Error("write failed");
        }
      }
    );
    const finalConfig = await readFile(configPath, "utf8");

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("write failed");
    expect(finalConfig).toBe(originalConfig);
  });

  it("adds inline rule explanations to check output when requested", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/missing-manifest", "--explain", "--no-animations"],
      io
    );
    const output = stdout.join("");

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output).toContain("plugin.manifest.missing");
    expect(output).toContain("Why: Codex needs the plugin manifest as the package entry point.");
    expect(output).toContain("Fix detail: Run the doctor against a plugin package root");
    expect(output).toContain('Example: { "name": "my-plugin"');
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

  it("supports check profiles for stricter CI and publish gates", async () => {
    const { io, stdout, stderr } = createIo();

    const strictExitCode = await runCli(
      ["check", "tests/fixtures/heuristic-long-plugin-description", "--profile", "strict"],
      io
    );

    expect(strictExitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Status: FAIL");

    stdout.length = 0;
    stderr.length = 0;

    const publishExitCode = await runCli(
      [
        "check",
        "tests/fixtures/heuristic-long-plugin-description",
        "--profile",
        "publish",
        "--json"
      ],
      io
    );
    const report = JSON.parse(stdout.join(""));

    expect(publishExitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(report.summary.status).toBe("fail");
    expect(report.summary.runtimeProbeEnabled).toBe(true);
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

  it("initializes an MCP stdio template", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-init-stdio-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["init", targetPath, "--template", "mcp-stdio"], io);
    const manifest = JSON.parse(
      await readFile(path.join(targetPath, ".codex-plugin", "plugin.json"), "utf8")
    );
    const mcpConfig = JSON.parse(await readFile(path.join(targetPath, ".mcp.json"), "utf8"));
    const server = await readFile(path.join(targetPath, "mock-server.js"), "utf8");
    const serverConfig = mcpConfig.mcpServers[manifest.name];

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Template: mcp-stdio");
    expect(manifest.mcpServers).toBe(".mcp.json");
    expect(serverConfig.command).toBe("node");
    expect(serverConfig.args).toEqual(["./mock-server.js"]);
    expect(server).toContain("method === \"initialize\"");
  });

  it("initializes an MCP HTTP template", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-init-http-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["init", targetPath, "--template", "mcp-http"], io);
    const manifest = JSON.parse(
      await readFile(path.join(targetPath, ".codex-plugin", "plugin.json"), "utf8")
    );
    const mcpConfig = JSON.parse(await readFile(path.join(targetPath, ".mcp.json"), "utf8"));
    const serverConfig = mcpConfig.mcpServers[manifest.name];

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Template: mcp-http");
    expect(manifest.mcpServers).toBe(".mcp.json");
    expect(serverConfig.url).toBe("http://localhost:8787/mcp");
  });

  it("initializes a full runtime template that passes runtime validation", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-init-full-"));
    const { io, stdout, stderr } = createIo();

    const initExitCode = await runCli(["init", targetPath, "--template", "full-runtime"], io);

    expect(initExitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Template: full-runtime");

    stdout.length = 0;
    stderr.length = 0;

    const checkExitCode = await runCli(["check", targetPath, "--runtime", "--no-animations"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {}
      }
    });

    expect(checkExitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("prompts/get: pass");
  });

  it("rejects unknown init templates", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-init-unknown-"));
    const { io, stderr } = createIo();

    const exitCode = await runCli(["init", targetPath, "--template", "unknown"], io);

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Unknown init template: unknown");
  });

  it("initializes a GitHub Actions workflow for Codex Plugin Doctor", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-init-ci-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["init-ci", targetPath], io);
    const workflowPath = path.join(targetPath, ".github", "workflows", "codex-plugin-doctor.yml");
    const workflow = await readFile(workflowPath, "utf8");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Initialized Codex Plugin Doctor workflow");
    expect(stdout.join("")).toContain(workflowPath);
    expect(workflow).toContain("Esquetta/CodexPluginDoctor@v");
    expect(workflow).toContain("version:");
    expect(workflow).toContain("path: .");
    expect(workflow).toContain('runtime: "true"');
    expect(workflow).toContain("policy: codex-publish");
    expect(workflow).toContain('json: "true"');
    expect(workflow).toContain('markdown: "true"');
    expect(workflow).toContain('sarif: "true"');
    expect(workflow).toContain('upload-artifact: "true"');
    expect(workflow).toContain('step-summary: "true"');
    expect(workflow).toContain("artifact-name: codex-plugin-doctor-reports");
  });

  it("renders a dry-run fix plan without changing files", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-fix-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const manifestPath = path.join(manifestDirectory, "plugin.json");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "broken-plugin", skills: "skills" }, null, 2),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["fix", targetPath, "--dry-run"], io);
    const output = stdout.join("");
    const manifestAfter = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Fix Plan");
    expect(output).toContain("Mode: dry-run");
    expect(output).toContain("No files changed.");
    expect(output).toContain(".codex-plugin/plugin.json");
    expect(output).toContain("skills");
    expect(manifestAfter).toEqual({ name: "broken-plugin", skills: "skills" });
  });

  it("renders a dry-run fix plan as JSON", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-fix-json-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      path.join(manifestDirectory, "plugin.json"),
      JSON.stringify({ name: "broken-plugin", skills: "skills" }, null, 2),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["fix", targetPath, "--dry-run", "--json"], io);
    const report = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(report).toMatchObject({
      schemaVersion: "1.0.0",
      mode: "dry-run",
      targetPath,
      filesChanged: 0
    });
    expect(report.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "manifest.safe_defaults",
          operation: "update-json",
          relativePath: ".codex-plugin/plugin.json"
        }),
        expect.objectContaining({
          id: "skills.create_directory",
          operation: "mkdir",
          relativePath: "skills"
        })
      ])
    );
  });

  it("applies safe fixes only when backup is requested", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-apply-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const manifestPath = path.join(manifestDirectory, "plugin.json");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "broken-plugin", skills: "skills" }, null, 2),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const rejectedExitCode = await runCli(["fix", targetPath, "--apply"], io);
    expect(rejectedExitCode).toBe(2);
    expect(stderr.join("")).toContain("requires --backup");

    stdout.length = 0;
    stderr.length = 0;

    const exitCode = await runCli(["fix", targetPath, "--apply", "--backup"], io);
    const manifestAfter = JSON.parse(await readFile(manifestPath, "utf8"));
    const backupRootEntries = await readdir(path.join(targetPath, ".codex-doctor-backups"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Mode: apply");
    expect(stdout.join("")).toContain("Files changed: 2");
    expect(manifestAfter).toMatchObject({
      name: "broken-plugin",
      version: "0.1.0",
      description: "Codex plugin package."
    });
    expect(await readdir(path.join(targetPath, "skills"))).toEqual([]);
    expect(backupRootEntries).toHaveLength(1);
  });

  it("prompts before applying interactive fixes", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-interactive-fix-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const manifestPath = path.join(manifestDirectory, "plugin.json");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "interactive-plugin", skills: "skills" }, null, 2),
      "utf8"
    );
    const { stdout, stderr, io } = createIo();

    const exitCode = await runCli(
      ["fix", targetPath, "--interactive", "--backup"],
      {
        ...io,
        async readStdin() {
          return "yes\n";
        }
      }
    );
    const manifestAfter = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Mode: interactive");
    expect(stdout.join("")).toContain("Type yes to apply these fixes");
    expect(stdout.join("")).toContain("Mode: apply");
    expect(manifestAfter.version).toBe("0.1.0");
  });

  it("applies selected interactive fix numbers only", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-selective-fix-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const manifestPath = path.join(manifestDirectory, "plugin.json");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "selective-plugin", skills: "skills" }, null, 2),
      "utf8"
    );
    const { stdout, stderr, io } = createIo();

    const exitCode = await runCli(
      ["fix", targetPath, "--interactive", "--backup"],
      {
        ...io,
        async readStdin() {
          return "1\n";
        }
      }
    );
    const manifestAfter = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("or enter action numbers like 1,3");
    expect(stdout.join("")).toContain("Files changed: 1");
    expect(manifestAfter.version).toBe("0.1.0");
    await expect(readdir(path.join(targetPath, "skills"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("cancels interactive fixes unless yes is entered", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-cancel-fix-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const manifestPath = path.join(manifestDirectory, "plugin.json");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify({ name: "cancel-plugin", skills: "skills" }, null, 2),
      "utf8"
    );
    const { stdout, stderr, io } = createIo();

    const exitCode = await runCli(
      ["fix", targetPath, "--interactive", "--backup"],
      {
        ...io,
        async readStdin() {
          return "no\n";
        }
      }
    );
    const manifestAfter = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Fix cancelled. No files changed.");
    expect(manifestAfter).toEqual({ name: "cancel-plugin", skills: "skills" });
  });

  it("applies safe skill and MCP scaffolds", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-fix-v2-"));
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const skillsDirectory = path.join(targetPath, "skills");
    const emptySkillDirectory = path.join(skillsDirectory, "empty-skill");
    const partialSkillDirectory = path.join(skillsDirectory, "partial-skill");
    await mkdir(manifestDirectory, { recursive: true });
    await mkdir(emptySkillDirectory, { recursive: true });
    await mkdir(partialSkillDirectory, { recursive: true });
    await writeFile(
      path.join(manifestDirectory, "plugin.json"),
      JSON.stringify({
        name: "fix-v2-plugin",
        version: "0.1.0",
        description: "A plugin for fix v2 tests.",
        skills: "skills",
        mcpServers: ".mcp.json"
      }, null, 2),
      "utf8"
    );
    await writeFile(
      path.join(partialSkillDirectory, "SKILL.md"),
      "---\n---\n\nExisting body.\n",
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["fix", targetPath, "--apply", "--backup", "--json"], io);
    const report = JSON.parse(stdout.join(""));
    const emptySkill = await readFile(path.join(emptySkillDirectory, "SKILL.md"), "utf8");
    const partialSkill = await readFile(path.join(partialSkillDirectory, "SKILL.md"), "utf8");
    const mcpConfig = JSON.parse(await readFile(path.join(targetPath, ".mcp.json"), "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(report.filesChanged).toBe(3);
    expect(emptySkill).toContain("name: empty-skill");
    expect(emptySkill).toContain("description:");
    expect(partialSkill).toContain("name: partial-skill");
    expect(partialSkill).toContain("description:");
    expect(partialSkill).toContain("Existing body.");
    expect(mcpConfig).toEqual({ mcpServers: {} });
  });

  it("does not apply fixes outside the plugin root when mcp path traversal is detected", async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-fix-traversal-"));
    const targetPath = path.join(workspacePath, "plugin");
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const outsideMcpPath = path.join(workspacePath, "outside", ".mcp.json");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(
      path.join(manifestDirectory, "plugin.json"),
      JSON.stringify({
        name: "traversal-plugin",
        version: "0.1.0",
        description: "A plugin with a traversal mcp path.",
        mcpServers: "../outside/.mcp.json"
      }, null, 2),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["fix", targetPath, "--apply", "--backup"], io);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Files changed: 0");
    await expect(readFile(outsideMcpPath, "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("does not plan skill fixes from outside the plugin root", async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-fix-skill-traversal-"));
    const targetPath = path.join(workspacePath, "plugin");
    const manifestDirectory = path.join(targetPath, ".codex-plugin");
    const outsideSkillDirectory = path.join(workspacePath, "outside-skills", "external-skill");
    await mkdir(manifestDirectory, { recursive: true });
    await mkdir(outsideSkillDirectory, { recursive: true });
    await writeFile(
      path.join(manifestDirectory, "plugin.json"),
      JSON.stringify({
        name: "skill-traversal-plugin",
        version: "0.1.0",
        description: "A plugin with a traversal skills path.",
        skills: "../outside-skills"
      }, null, 2),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["fix", targetPath, "--dry-run"], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("No safe automatic fixes available.");
    expect(output).not.toContain("external-skill");
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
    expect(
      writtenReport.runs[0].results[0].partialFingerprints["codexPluginDoctor/v1"]
    ).toMatch(/^[a-f0-9]{64}$/);
    expect(writtenReport.runs[0].results[0].properties.evidence).toEqual(
      expect.objectContaining({
        serverName: "dangerServer",
        configPath: ".mcp.json",
        envKey: "OPENAI_API_KEY",
        envValue: "[REDACTED]"
      })
    );
  });

  it("renders Shields-compatible badge JSON for a passing package", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/valid-plugin-with-mcp", "--badge-json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toEqual({
      schemaVersion: 1,
      label: "doctor",
      message: "PASS",
      color: "brightgreen"
    });
  });

  it("renders badge markdown for a warning package", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["check", "tests/fixtures/heuristic-long-plugin-description", "--badge-markdown"],
      io
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toBe(
      "![Codex Plugin Doctor](https://img.shields.io/badge/doctor-WARN-yellow)"
    );
  });

  it("writes badge output to the requested path", async () => {
    const outputPath = await createTempFilePath("doctor-badge.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "tests/fixtures/security-hardcoded-secret",
        "--badge-json",
        "--output",
        outputPath
      ],
      io
    );
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toEqual(writtenReport);
    expect(writtenReport.message).toBe("FAIL");
    expect(writtenReport.color).toBe("red");
  });

  it("rejects badge output for installed plugin checks", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["check", "--installed", "--badge-json"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHomeFixture }
      }
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Badge output requires a single package target.");
  });

  it("appends check results to a validation history file", async () => {
    const historyPath = await createTempFilePath("history.jsonl");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "tests/fixtures/heuristic-long-plugin-description",
        "--history",
        historyPath
      ],
      io
    );
    const historyLines = (await readFile(historyPath, "utf8")).trim().split("\n");
    const entry = JSON.parse(historyLines[0]);

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Status: WARN");
    expect(historyLines).toHaveLength(1);
    expect(entry.schemaVersion).toBe("1.0.0");
    expect(entry.status).toBe("warn");
    expect(entry.findingCounts).toEqual({ fail: 0, warn: 1, total: 1 });
    expect(entry.runtimeProbeEnabled).toBe(false);
  });

  it("renders a validation history trend summary", async () => {
    const historyPath = await createTempFilePath("history.jsonl");
    const { io, stdout, stderr } = createIo();

    await runCli(
      [
        "check",
        "tests/fixtures/security-hardcoded-secret",
        "--history",
        historyPath
      ],
      io
    );
    await runCli(
      [
        "check",
        "tests/fixtures/valid-plugin-with-mcp",
        "--history",
        historyPath
      ],
      io
    );
    stdout.length = 0;
    stderr.length = 0;

    const exitCode = await runCli(["history", historyPath], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Validation History");
    expect(output).toContain("Runs: 2");
    expect(output).toContain("Latest: PASS");
    expect(output).toContain("Previous: FAIL");
    expect(output).toContain("Fail findings: -1");
    expect(output).toContain("Warn findings: 0");
  });

  it("renders validation history as JSON for automation consumers", async () => {
    const historyPath = await createTempFilePath("history.jsonl");
    const { io, stdout, stderr } = createIo();

    await runCli(
      [
        "check",
        "tests/fixtures/security-hardcoded-secret",
        "--history",
        historyPath
      ],
      io
    );
    await runCli(
      [
        "check",
        "tests/fixtures/valid-plugin-with-mcp",
        "--history",
        historyPath
      ],
      io
    );
    stdout.length = 0;
    stderr.length = 0;

    const exitCode = await runCli(["history", historyPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toMatchObject({
      schemaVersion: "1.0.0",
      runs: 2,
      regression: false,
      latest: {
        status: "pass",
        findingCounts: { fail: 0, warn: 0, total: 0 }
      },
      previous: {
        status: "fail",
        findingCounts: { fail: 1, warn: 0, total: 1 }
      },
      delta: {
        fail: -1,
        warn: 0,
        total: -1
      }
    });
  });

  it("renders git hook initialization as JSON for automation consumers", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-hooks-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["init-git-hooks", targetPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toMatchObject({
      schemaVersion: "1.0.0",
      kind: "doctor.git.hooks",
      rootPath: path.resolve(targetPath),
      preExisting: []
    });
    expect(output.hookPaths).toEqual([
      path.join(path.resolve(targetPath), ".git", "hooks", "pre-commit"),
      path.join(path.resolve(targetPath), ".git", "hooks", "pre-push")
    ]);
    expect(await readFile(output.hookPaths[0], "utf8")).toContain("Codex Plugin Doctor: running pre-commit validation");
  });

  it("fails history regression gates when the latest run is worse", async () => {
    const historyPath = await createTempFilePath("history.jsonl");
    const { io, stdout, stderr } = createIo();

    await runCli(
      [
        "check",
        "tests/fixtures/valid-plugin-with-mcp",
        "--history",
        historyPath
      ],
      io
    );
    await runCli(
      [
        "check",
        "tests/fixtures/security-hardcoded-secret",
        "--history",
        historyPath
      ],
      io
    );
    stdout.length = 0;
    stderr.length = 0;

    const exitCode = await runCli(["history", historyPath, "--fail-on-regression"], io);

    expect(exitCode).toBe(1);
    expect(stdout.join("")).toContain("Regression: YES");
    expect(stderr.join("")).toContain("Validation history regression detected.");
  });

  it("fails clearly when history has no readable runs", async () => {
    const historyPath = await createTempFilePath("empty-history.jsonl");
    await writeFile(historyPath, "", "utf8");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["history", historyPath], io);

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("No validation history entries found.");
  });

  it("rejects history output for installed plugin checks", async () => {
    const historyPath = await createTempFilePath("installed-history.jsonl");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["check", "--installed", "--history", historyPath], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: { CODEX_HOME: codexHomeFixture }
      }
    });

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("History output requires a single package target.");
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
