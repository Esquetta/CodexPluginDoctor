import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
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

describe("doctor attest command", () => {
  it("renders a JSON attestation for a validated package", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--json"],
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
    expect(output.kind).toBe("doctor.attestation");
    expect(output.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(output.subject).toMatchObject({
      name: "codex-doctor-runtime",
      version: "1.0.0"
    });
    expect(output.packageFingerprint).toMatchObject({
      algorithm: "sha256",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    expect(output.packageFingerprint.files.total).toBeGreaterThan(0);
    expect(output.reportDigest).toMatchObject({
      algorithm: "sha256",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    expect(output.summary.validation.status).toBe("pass");
    expect(output.summary.security.score).toEqual(expect.any(Number));
    expect(output.verification.recomputeCommand).toContain("codex-plugin-doctor doctor attest");
    expect(output.signature.status).toBe("unsigned");
  });

  it("signs a local attestation with an explicit HMAC key", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--json", "--sign-key", "test-secret"],
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
    expect(output.signature).toMatchObject({
      status: "signed",
      algorithm: "hmac-sha256",
      keyHint: "inline",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    expect(output.signature).not.toHaveProperty("key");
    expect(output.verification.recomputeCommand).toContain("--sign-key-env");
  });

  it("signs a local attestation from an environment variable", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--json", "--sign-key-env", "DOCTOR_SIGNING_KEY"],
      io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "env-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.signature.status).toBe("signed");
    expect(output.signature.keyHint).toBe("env:DOCTOR_SIGNING_KEY");
  });

  it("requires an environment value when --sign-key-env is used", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--json", "--sign-key-env", "MISSING_KEY"],
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
    expect(stderr.join("")).toContain("Environment variable MISSING_KEY is not set.");
  });

  it("verifies a signed attestation with the matching environment key", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-attest-verify-")),
      "attestation.json"
    );
    const signing = createIo();
    const verification = createIo();

    await runCli(
      [
        "doctor",
        "attest",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--output",
        outputPath
      ],
      signing.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "env-secret" },
          platform: "win32"
        }
      }
    );

    const exitCode = await runCli(
      [
        "doctor",
        "attest",
        "verify",
        outputPath,
        "--target",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
      ],
      verification.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "env-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(verification.stdout.join(""));

    expect(exitCode).toBe(0);
    expect(verification.stderr).toEqual([]);
    expect(output.kind).toBe("doctor.attestation.verification");
    expect(output.status).toBe("pass");
    expect(output.summary).toMatchObject({
      packageFingerprint: "pass",
      reportDigest: "pass",
      signature: "pass"
    });
  });

  it("fails verification when the signing key does not match", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-attest-wrong-key-")),
      "attestation.json"
    );
    const signing = createIo();
    const verification = createIo();

    await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--json", "--sign-key", "right-secret", "--output", outputPath],
      signing.io
    );

    const exitCode = await runCli(
      [
        "doctor",
        "attest",
        "verify",
        outputPath,
        "--target",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
      ],
      verification.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "wrong-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(verification.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(output.status).toBe("fail");
    expect(output.summary.signature).toBe("fail");
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "attestation.signature.mismatch",
          status: "fail"
        })
      ])
    );
  });

  it("fails verification when the attestation report digest is tampered", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-attest-tamper-")),
      "attestation.json"
    );
    const signing = createIo();
    const verification = createIo();

    await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--json", "--sign-key", "test-secret", "--output", outputPath],
      signing.io
    );
    const attestation = JSON.parse(await readFile(outputPath, "utf8"));
    attestation.reportDigest.digest = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
    await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");

    const exitCode = await runCli(
      [
        "doctor",
        "attest",
        "verify",
        outputPath,
        "--target",
        "examples/codex-doctor-runtime",
        "--json",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
      ],
      verification.io,
      {
        terminalContext: {
          stdoutIsTTY: false,
          stderrIsTTY: false,
          env: { DOCTOR_SIGNING_KEY: "test-secret" },
          platform: "win32"
        }
      }
    );
    const output = JSON.parse(verification.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(output.status).toBe("fail");
    expect(output.summary.reportDigest).toBe("fail");
    expect(output.summary.signature).toBe("fail");
  });

  it("rejects inline signing keys for verification", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "attest",
        "verify",
        "attestation.json",
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key",
        "inline-secret"
      ],
      io
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Use --sign-key-env for verification; inline verification keys are not supported.");
  });

  it("requires an environment value when verify uses --sign-key-env", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "attest",
        "verify",
        "attestation.json",
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "MISSING_KEY"
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
    expect(stderr.join("")).toContain("Environment variable MISSING_KEY is not set.");
  });

  it("keeps signed digest stable when the same package is copied to another directory", async () => {
    const first = createIo();
    const second = createIo();
    const copiedRoot = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-attest-copy-")),
      "runtime-copy"
    );
    const args = ["doctor", "attest", "examples/codex-doctor-runtime", "--json", "--sign-key", "test-secret"];

    await cp("examples/codex-doctor-runtime", copiedRoot, { recursive: true });
    await runCli(args, first.io);
    await runCli(["doctor", "attest", copiedRoot, "--json", "--sign-key", "test-secret"], second.io);

    const firstOutput = JSON.parse(first.stdout.join(""));
    const secondOutput = JSON.parse(second.stdout.join(""));

    expect(secondOutput.packageFingerprint.digest).toBe(firstOutput.packageFingerprint.digest);
    expect(secondOutput.reportDigest.digest).toBe(firstOutput.reportDigest.digest);
    expect(secondOutput.signature.digest).toBe(firstOutput.signature.digest);
  });

  it("keeps package and report digests stable across repeated runs", async () => {
    const first = createIo();
    const second = createIo();
    const args = ["doctor", "attest", "examples/codex-doctor-runtime", "--json"];

    await runCli(args, first.io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {},
        platform: "win32"
      }
    });
    await runCli(args, second.io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {},
        platform: "win32"
      }
    });

    const firstOutput = JSON.parse(first.stdout.join(""));
    const secondOutput = JSON.parse(second.stdout.join(""));

    expect(secondOutput.packageFingerprint.digest).toBe(firstOutput.packageFingerprint.digest);
    expect(secondOutput.reportDigest.digest).toBe(firstOutput.reportDigest.digest);
  });

  it("writes attestation JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-attest-")),
      "attestation.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--output", outputPath],
      io
    );
    const writtenAttestation = JSON.parse(await readFile(outputPath, "utf8"));
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Attestation");
    expect(output).toContain(`Output: ${outputPath}`);
    expect(writtenAttestation.kind).toBe("doctor.attestation");
    expect(writtenAttestation.subject.name).toBe("codex-doctor-runtime");
  });

  it("requires a path after --output", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "attest", "examples/codex-doctor-runtime", "--output"],
      io
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing path after --output.");
  });
});
