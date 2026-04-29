import { mkdtemp, readFile } from "node:fs/promises";
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

const codexHomeFixture = path.resolve("tests/fixtures/codex-home");

describe("runCli", () => {
  it("renders a compatibility matrix for a Codex plugin with MCP config", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["compat", "examples/codex-doctor-runtime", "--no-animations"],
      io
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Compatibility Matrix");
    expect(output).toContain("Codex: PASS");
    expect(output).toContain("Generic MCP: PASS");
    expect(output).toContain("Claude Desktop: SKIPPED");
    expect(output).toContain("Cursor: SKIPPED");
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
