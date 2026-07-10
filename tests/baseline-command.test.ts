import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { CheckResult } from "../src/domain/types.js";
import { runCli } from "../src/run-cli.js";

const existingFingerprint = "a".repeat(64);
const newFingerprint = "b".repeat(64);

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

function checkResult(fingerprints: string[]): CheckResult {
  return {
    targetPath: path.resolve("fixture-plugin"),
    status: "fail",
    exitCode: 1,
    findings: fingerprints.map((fingerprint, index) => ({
      id: `fixture.finding.${index + 1}`,
      severity: "fail" as const,
      message: `Finding ${index + 1}`,
      impact: "Blocks release.",
      suggestedFix: "Fix it.",
      fingerprint
    }))
  };
}

describe("baseline command", () => {
  it("creates a baseline from current fingerprinted findings", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-baseline-"));
    const outputPath = path.join(directory, "baseline.json");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["baseline", "create", ".", "--output", outputPath],
      io,
      { runCheckImpl: async () => checkResult([existingFingerprint]) }
    );
    const baseline = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Baseline created");
    expect(baseline).toMatchObject({
      schemaVersion: "1.0.0",
      findings: [
        {
          id: "fixture.finding.1",
          severity: "fail",
          fingerprint: existingFingerprint
        }
      ]
    });
  });

  it("deduplicates repeated fingerprints in a generated baseline", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-baseline-"));
    const outputPath = path.join(directory, "baseline.json");
    const { io } = createIo();

    await runCli(
      ["baseline", "create", ".", "--output", outputPath],
      io,
      { runCheckImpl: async () => checkResult([existingFingerprint, existingFingerprint]) }
    );
    const baseline = JSON.parse(await readFile(outputPath, "utf8"));

    expect(baseline.findings).toHaveLength(1);
  });

  it("gates only findings that are not in the baseline", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-baseline-"));
    const baselinePath = path.join(directory, "baseline.json");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        generatedAt: "2026-07-10T00:00:00.000Z",
        findings: [
          { id: "fixture.finding.1", severity: "fail", fingerprint: existingFingerprint }
        ]
      }),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["check", ".", "--baseline", baselinePath, "--json"],
      io,
      { runCheckImpl: async () => checkResult([existingFingerprint, newFingerprint]) }
    );
    const report = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(report.summary.baseline).toEqual({ matched: 1, new: 1, resolved: 0 });
    expect(report.findings.map((finding: { fingerprint: string }) => finding.fingerprint)).toEqual([
      newFingerprint
    ]);
    expect(report.baselinedFindings).toHaveLength(1);
  });

  it("passes when every current finding is baselined", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-baseline-"));
    const baselinePath = path.join(directory, "baseline.json");
    await writeFile(
      baselinePath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        generatedAt: "2026-07-10T00:00:00.000Z",
        findings: [
          { id: "fixture.finding.1", severity: "fail", fingerprint: existingFingerprint }
        ]
      }),
      "utf8"
    );
    const { io, stdout } = createIo();

    const exitCode = await runCli(
      ["check", ".", "--baseline", baselinePath, "--json"],
      io,
      { runCheckImpl: async () => checkResult([existingFingerprint]) }
    );
    const report = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(report.summary.status).toBe("pass");
    expect(report.summary.baseline).toEqual({ matched: 1, new: 0, resolved: 0 });
  });

  it("rejects malformed baseline files", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-baseline-"));
    const baselinePath = path.join(directory, "baseline.json");
    await writeFile(baselinePath, "{}", "utf8");
    const { io, stderr } = createIo();

    const exitCode = await runCli(
      ["check", ".", "--baseline", baselinePath],
      io,
      { runCheckImpl: async () => checkResult([existingFingerprint]) }
    );

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Invalid baseline file");
  });
});
