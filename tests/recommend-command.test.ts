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

describe("doctor recommend command", () => {
  it("renders prioritized blocker actions as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "recommend", "tests/fixtures/security-hardcoded-secret", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.status).toBe("fail");
    expect(output.summary.actionCounts.blocker).toBeGreaterThan(0);
    expect(output.actions[0]).toMatchObject({
      priority: "blocker",
      category: "security",
      findingId: "plugin.security.hard_coded_secret"
    });
    expect(output.actions[0].nextCommand).toContain("codex-plugin-doctor security");
  });

  it("renders text recommendations for a healthy package", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "recommend", "tests/fixtures/valid-plugin"], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Recommendations");
    expect(output).toContain("No blocker actions.");
    expect(output).toContain("codex-plugin-doctor check");
  });

  it("writes recommendation JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-recommend-")),
      "recommendations.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "recommend", "tests/fixtures/security-hardcoded-secret", "--json", "--output", outputPath],
      io
    );
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(JSON.parse(stdout.join(""))).toEqual(writtenReport);
    expect(writtenReport.actions[0].findingId).toBe("plugin.security.hard_coded_secret");
  });
});
