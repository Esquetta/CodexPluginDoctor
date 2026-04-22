import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

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

describe("runCli", () => {
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
