import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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

const terminalContext = {
  stdoutIsTTY: false,
  stderrIsTTY: false,
  env: { DOCTOR_SIGNING_KEY: "review-secret" },
  platform: "win32" as const
};

describe("doctor review-bundle command", () => {
  it("writes a signed review bundle directory", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged",
        "--json"
      ],
      io,
      { terminalContext }
    );
    const manifest = JSON.parse(stdout.join(""));
    const summary = await readFile(path.join(outputDirectory, "summary.md"), "utf8");
    const runtimePolicy = JSON.parse(await readFile(path.join(outputDirectory, "runtime-policy.json"), "utf8"));
    const releaseEvidence = JSON.parse(await readFile(path.join(outputDirectory, "release-evidence.json"), "utf8"));
    const attestation = JSON.parse(await readFile(path.join(outputDirectory, "attestation.json"), "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(manifest.kind).toBe("doctor.review.bundle");
    expect(manifest.files).toMatchObject({
      summary: "summary.md",
      runtimePlanJson: "runtime-plan.json",
      runtimePlanMarkdown: "runtime-plan.md",
      runtimePolicyJson: "runtime-policy.json",
      runtimePolicyText: "runtime-policy.txt",
      attestationJson: "attestation.json",
      releaseEvidenceJson: "release-evidence.json"
    });
    expect(manifest.integrity).toMatchObject({
      algorithm: "sha256",
      files: {
        summary: {
          path: "summary.md",
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
        },
        releaseEvidenceJson: {
          path: "release-evidence.json",
          digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
        }
      }
    });
    expect(summary).toContain("# Codex Plugin Doctor Review Bundle");
    expect(runtimePolicy.kind).toBe("doctor.runtime.policy");
    expect(releaseEvidence.kind).toBe("doctor.release.evidence");
    expect(releaseEvidence.evidenceSignature.status).toBe("signed");
    expect(attestation.kind).toBe("doctor.attestation");
    expect(attestation.signature.status).toBe("signed");
  });

  it("renders text output for review bundles", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-text-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      io,
      { terminalContext }
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Review Bundle");
    expect(output).toContain("runtime-plan.md");
    expect(output).toContain("release-evidence.json");
  });

  it("verifies a signed review bundle directory", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-verify-"));
    const createBundle = createIo();
    const verifyBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      createBundle.io,
      { terminalContext }
    );

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "verify",
        outputDirectory,
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--json"
      ],
      verifyBundle.io,
      { terminalContext }
    );
    const output = JSON.parse(verifyBundle.stdout.join(""));

    expect(exitCode).toBe(0);
    expect(verifyBundle.stderr).toEqual([]);
    expect(output.kind).toBe("doctor.review.bundle.verification");
    expect(output.status).toBe("pass");
    expect(output.summary).toMatchObject({
      manifest: "pass",
      files: "pass",
      runtimePlan: "pass",
      runtimePolicy: "pass",
      attestation: "pass",
      releaseEvidence: "pass"
    });
  });

  it("writes review bundle verification JSON to an output path", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-verify-output-"));
    const reportPath = path.join(outputDirectory, "verification.json");
    const createBundle = createIo();
    const verifyBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      createBundle.io,
      { terminalContext }
    );

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "verify",
        outputDirectory,
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--json",
        "--output",
        reportPath
      ],
      verifyBundle.io,
      { terminalContext }
    );
    const writtenReport = JSON.parse(await readFile(reportPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(verifyBundle.stderr).toEqual([]);
    expect(writtenReport.kind).toBe("doctor.review.bundle.verification");
    expect(writtenReport.status).toBe("pass");
  });

  it("fails review bundle verification when signed evidence is tampered", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-tampered-"));
    const createBundle = createIo();
    const verifyBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      createBundle.io,
      { terminalContext }
    );

    const evidencePath = path.join(outputDirectory, "release-evidence.json");
    const evidence = JSON.parse(await readFile(evidencePath, "utf8"));

    evidence.releaseReady = false;
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), "utf8");

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "verify",
        outputDirectory,
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--json"
      ],
      verifyBundle.io,
      { terminalContext }
    );
    const output = JSON.parse(verifyBundle.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(verifyBundle.stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.summary.releaseEvidence).toBe("fail");
  });

  it("fails review bundle verification when a bundled file digest is tampered", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-digest-tampered-"));
    const createBundle = createIo();
    const verifyBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      createBundle.io,
      { terminalContext }
    );

    await writeFile(path.join(outputDirectory, "summary.md"), "# Tampered review summary\n", "utf8");

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "verify",
        outputDirectory,
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--json"
      ],
      verifyBundle.io,
      { terminalContext }
    );
    const output = JSON.parse(verifyBundle.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(verifyBundle.stderr).toEqual([]);
    expect(output.summary.files).toBe("fail");
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review_bundle.integrity.summary",
          status: "fail"
        })
      ])
    );
  });

  it("fails review bundle verification when a manifest integrity entry is missing", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-integrity-missing-"));
    const createBundle = createIo();
    const verifyBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      createBundle.io,
      { terminalContext }
    );

    const manifestPath = path.join(outputDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.integrity.files.summary;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "verify",
        outputDirectory,
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--json"
      ],
      verifyBundle.io,
      { terminalContext }
    );
    const output = JSON.parse(verifyBundle.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(verifyBundle.stderr).toEqual([]);
    expect(output.summary.files).toBe("fail");
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review_bundle.integrity.summary",
          status: "fail"
        })
      ])
    );
  });

  it("fails review bundle verification when a manifest integrity entry is unexpected", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-integrity-unexpected-"));
    const createBundle = createIo();
    const verifyBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      createBundle.io,
      { terminalContext }
    );

    const manifestPath = path.join(outputDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.integrity.files.unexpected = {
      path: "unexpected.txt",
      digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      bytes: 0
    };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "verify",
        outputDirectory,
        "--target",
        "examples/codex-doctor-runtime",
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--json"
      ],
      verifyBundle.io,
      { terminalContext }
    );
    const output = JSON.parse(verifyBundle.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(verifyBundle.stderr).toEqual([]);
    expect(output.summary.files).toBe("fail");
    expect(output.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "review_bundle.integrity.unexpected",
          status: "fail"
        })
      ])
    );
  });

  it("diffs two review bundle directories", async () => {
    const beforeDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-before-"));
    const afterDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-after-"));
    const beforeBundle = createIo();
    const afterBundle = createIo();
    const diffBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        beforeDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      beforeBundle.io,
      { terminalContext }
    );
    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        afterDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      afterBundle.io,
      { terminalContext }
    );

    const manifestPath = path.join(afterDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    manifest.summary.releaseReady = false;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "diff",
        "--before",
        beforeDirectory,
        "--after",
        afterDirectory,
        "--json"
      ],
      diffBundle.io,
      { terminalContext }
    );
    const output = JSON.parse(diffBundle.stdout.join(""));

    expect(exitCode).toBe(1);
    expect(diffBundle.stderr).toEqual([]);
    expect(output.kind).toBe("doctor.review.bundle.diff");
    expect(output.summary.releaseReadyChanged).toBe(true);
    expect(output.summary.riskIncreased).toBe(true);
    expect(output.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "releaseReady",
          severity: "fail"
        })
      ])
    );
  });

  it("renders text output for review bundle diffs", async () => {
    const beforeDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-diff-before-"));
    const afterDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-diff-after-"));
    const beforeBundle = createIo();
    const afterBundle = createIo();
    const diffBundle = createIo();

    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        beforeDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      beforeBundle.io,
      { terminalContext }
    );
    await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        afterDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY",
        "--allow-dirty",
        "--allow-untagged"
      ],
      afterBundle.io,
      { terminalContext }
    );

    const exitCode = await runCli(
      ["doctor", "review-bundle", "diff", "--before", beforeDirectory, "--after", afterDirectory],
      diffBundle.io,
      { terminalContext }
    );
    const output = diffBundle.stdout.join("");

    expect(exitCode).toBe(0);
    expect(diffBundle.stderr).toEqual([]);
    expect(output).toContain("Doctor Review Bundle Diff");
    expect(output).toContain("No changes.");
  });

  it("requires an output directory", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "review-bundle", "examples/codex-doctor-runtime", "--sign-key-env", "DOCTOR_SIGNING_KEY"],
      io,
      { terminalContext }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing output directory. Use --output <dir>.");
  });

  it("requires a signing key environment variable", async () => {
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-review-bundle-missing-key-"));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "review-bundle",
        "examples/codex-doctor-runtime",
        "--output",
        outputDirectory,
        "--sign-key-env",
        "DOCTOR_SIGNING_KEY"
      ],
      io,
      {
        terminalContext: {
          ...terminalContext,
          env: {}
        }
      }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Signing key environment variable is not set");
  });

  it("requires a target path when verifying review bundles", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "review-bundle", "verify", "review-bundle", "--sign-key-env", "DOCTOR_SIGNING_KEY"],
      io,
      { terminalContext }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing target path. Use --target <path>.");
  });

  it("requires before and after directories when diffing review bundles", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "review-bundle", "diff", "--before", "before-bundle"],
      io,
      { terminalContext }
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing after bundle directory. Use --after <dir>.");
  });
});
