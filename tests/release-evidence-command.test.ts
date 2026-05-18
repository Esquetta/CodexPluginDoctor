import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
    expect(output.evidenceSignature).toEqual(
      expect.objectContaining({
        status: "signed",
        algorithm: "hmac-sha256",
        keyHint: "env:DOCTOR_SIGNING_KEY"
      })
    );
    expect(output.security.score).toBeGreaterThanOrEqual(90);
    expect(output.trust.score).toBeGreaterThanOrEqual(90);
    expect(output.package.name).toBe("codex-doctor-runtime");
    expect(output.git).toEqual(
      expect.objectContaining({
        commit: expect.any(String)
      })
    );
    expect(typeof output.git.tag === "string" || output.git.tag === null).toBe(true);
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
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-gates-"));
    await cp("examples/codex-doctor-runtime", targetPath, { recursive: true });
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        targetPath,
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
          id: "git.commit.present",
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

  it("verifies a release evidence bundle against its target package", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-evidence-verify-")),
      "release-evidence.json"
    );
    const createEvidence = createIo();

    await runCli(
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
      createEvidence.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "verify",
        outputPath,
        "--json",
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
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
    expect(output.kind).toBe("doctor.release.evidence.verification");
    expect(output.status).toBe("pass");
    expect(output.summary.attestation).toBe("pass");
    expect(output.summary.evidenceSignature).toBe("pass");
    expect(output.summary.releaseReady).toBe("pass");
    expect(output.summary.releaseGates).toBe("pass");
  });

  it("fails release evidence verification with the wrong signing key", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-evidence-wrong-key-")),
      "release-evidence.json"
    );
    const createEvidence = createIo();

    await runCli(
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
      createEvidence.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "verify",
        outputPath,
        "--json",
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
      ],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "wrong-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.summary.attestation).toBe("fail");
    expect(JSON.stringify(output)).not.toContain("wrong-secret");
    const signatureChecks = output.attestation.checks.filter((check: { id: string }) =>
      check.id.startsWith("attestation.signature.")
    );
    expect(JSON.stringify(signatureChecks)).not.toContain("expected");
    expect(JSON.stringify(signatureChecks)).not.toContain("actual");
  });

  it("fails release evidence verification for invalid artifacts", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-evidence-invalid-")),
      "release-evidence.json"
    );
    await writeFile(outputPath, JSON.stringify({ kind: "not.release.evidence" }), "utf8");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "verify",
        outputPath,
        "--json",
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
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
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "release_evidence.artifact.invalid",
          status: "fail"
        })
      ])
    );
  });

  it("requires an explicit target path for release evidence verification", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-evidence-target-")),
      "release-evidence.json"
    );
    await writeFile(outputPath, JSON.stringify({ kind: "doctor.release.evidence" }), "utf8");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "verify",
        outputPath,
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
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

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing target path. Use --target <path>.");
  });

  it("fails release evidence verification when top-level release metadata is tampered", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-evidence-tampered-")),
      "release-evidence.json"
    );
    const createEvidence = createIo();

    await runCli(
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
      createEvidence.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "release-secret" },
          platform: "win32"
        }
      }
    );
    const artifact = JSON.parse(await readFile(outputPath, "utf8"));
    artifact.releaseGates.checks[0].message = "tampered release gate text";
    await writeFile(outputPath, JSON.stringify(artifact), "utf8");
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "release-evidence",
        "verify",
        outputPath,
        "--json",
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
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
    expect(output.summary.evidenceSignature).toBe("fail");
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "release_evidence.signature",
          status: "fail"
        })
      ])
    );
  });
});
