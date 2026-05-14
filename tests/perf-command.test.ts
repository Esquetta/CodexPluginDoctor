import { mkdtemp, readFile } from "node:fs/promises";
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

describe("doctor perf command", () => {
  it("renders package analysis timing as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "perf", "tests/fixtures/valid-plugin", "--json"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: {},
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.perf");
    expect(output.exitCode).toBe(0);
    expect(output.summary.stageCount).toBeGreaterThanOrEqual(6);
    expect(output.stages.map((stage: { name: string }) => stage.name)).toEqual(
      expect.arrayContaining([
        "validation",
        "doctorConfig",
        "security",
        "compatibility",
        "trust",
        "recommendations",
        "total"
      ])
    );

    for (const stage of output.stages) {
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("writes performance JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-perf-")),
      "perf.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "perf", "tests/fixtures/valid-plugin", "--json", "--output", outputPath],
      io
    );
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toEqual(writtenReport);
    expect(writtenReport.kind).toBe("doctor.perf");
  });

  it("fails when a total duration threshold is exceeded", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "perf", "tests/fixtures/valid-plugin", "--json", "--max-total-ms", "0"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.exitCode).toBe(1);
    expect(output.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "total",
          limitMs: 0,
          status: "fail"
        })
      ])
    );
  });

  it("fails when a stage duration threshold is exceeded", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "perf", "tests/fixtures/valid-plugin", "--json", "--max-stage-ms", "validation=0"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.thresholds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stage: "validation",
          limitMs: 0,
          status: "fail"
        })
      ])
    );
  });
});
