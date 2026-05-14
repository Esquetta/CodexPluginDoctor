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
