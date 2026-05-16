import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/run-cli.js";
import { renderDoctorReleaseEvidenceJson } from "../src/core/release-evidence.js";

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

describe("doctor release-evidence command", () => {
  it("renders a signed release evidence bundle as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged",
        "--max-total-ms",
        "5000"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.release.evidence");
    expect(output.status).toBe("pass");
    expect(output.releaseReady).toBe(true);
    expect(output.summary).toMatchObject({
      attestation: "pass",
      attestationVerification: "pass",
      corpus: "pass",
      performance: "pass",
      releaseGates: "pass",
      security: "pass",
      trust: "pass"
    });
    expect(output.attestation.signature.status).toBe("signed");
    expect(output.attestation.signature.keyHint).toBe("env:DOCTOR_SIGNING_KEY");
    expect(output.attestationVerification.status).toBe("pass");
    expect(output.attestationVerification.unsignedFields).toContain("targetPath");
    expect(output.corpus.summary.status).toBe("pass");
    expect(output.performance.status).toBe("pass");
    expect(output.releaseGates.status).toBe("pass");
    expect(output.security.score).toBeGreaterThanOrEqual(90);
    expect(output.trust.score).toBeGreaterThanOrEqual(90);
    expect(output.package.name).toBe("codex-doctor-runtime");
    expect(output.git).toEqual(
      expect.objectContaining({
        commit: expect.any(String),
        tag: expect.anything()
      })
    );
  });

  it("fails release readiness when a performance threshold is exceeded", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged",
        "--max-total-ms",
        "0"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.releaseReady).toBe(false);
    expect(output.summary.performance).toBe("fail");
    expect(output.performance.summary.thresholdFailures).toBeGreaterThan(0);
  });

  it("fails release readiness when strict git release gates are not satisfied", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--max-total-ms",
        "5000"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.releaseReady).toBe(false);
    expect(output.summary.releaseGates).toBe("fail");
    expect(output.releaseGates.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "git.worktree.clean",
          status: "fail"
        })
      ])
    );
  });

  it("requires a signing key environment variable", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "release-evidence", "examples/codex-doctor-runtime", "--json"],
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

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing signing key. Use --sign-key-env <name>.");
  });

  it("writes release evidence JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-evidence-")),
      "release-evidence.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "examples/codex-doctor-runtime",
        "--output",
        outputPath,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Doctor Release Evidence");
    expect(writtenReport.kind).toBe("doctor.release.evidence");
    expect(writtenReport.releaseReady).toBe(true);
  });

  it("rejects inline signing keys", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key",
        "SHOULD_NOT_LEAK"
      ],
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

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Use --sign-key-env for release evidence");
    expect(stderr.join("")).not.toContain("SHOULD_NOT_LEAK");
  });

  it("redacts sensitive strings when rendering JSON", () => {
    const rendered = renderDoctorReleaseEvidenceJson({
      kind: "doctor.release.evidence",
      schemaVersion: "1.0.0",
      targetPath: "C:/tmp/sk-SHOULD_NOT_LEAK123456",
      nested: {
        token: "ghp_SHOULD_NOT_LEAK123456"
      }
    } as never);

    expect(rendered).toContain("[REDACTED_SECRET]");
    expect(rendered).not.toContain("SHOULD_NOT_LEAK");
  });
});
