import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/run-cli.js";
import { buildPackageFingerprint } from "../src/core/attestation.js";
import { validatePlugin } from "../src/core/validate-plugin.js";

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

async function createExternalManifest(options: { digestDrift?: boolean } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-command-"));
  const targetPath = path.join(root, "snapshot");
  await cp(path.resolve("tests", "fixtures", "external-corpus", "broken"), targetPath, {
    recursive: true
  });
  const [fingerprint, result] = await Promise.all([
    buildPackageFingerprint(targetPath),
    validatePlugin(targetPath)
  ]);
  const manifestPath = path.join(root, "corpus.json");
  await writeFile(manifestPath, JSON.stringify({
    schemaVersion: "1.0.0",
    targets: [{
      id: "broken-01",
      profile: "broken",
      sourceType: "derived-fixture",
      disclosure: "anonymized",
      path: "snapshot",
      mode: "codex-plugin",
      contentDigest: options.digestDrift ? `sha256:${"0".repeat(64)}` : fingerprint.digest,
      expectedStatus: result.status,
      reviews: result.findings.map((finding) => ({
        findingId: finding.id,
        fingerprint: finding.fingerprint,
        classification: "true_positive"
      }))
    }]
  }), "utf8");
  return { manifestPath, root };
}

describe("doctor corpus command", () => {
  it("runs the bundled validation corpus as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "corpus", "--json"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {},
        platform: "win32"
      }
    });
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.validation.corpus");
    expect(output.summary).toMatchObject({
      status: "pass",
      caseCount: 4,
      passedExpectations: 4,
      failedExpectations: 0
    });
    expect(output.cases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "bundled-runtime-healthy",
          profile: "healthy-runtime",
          sourceType: "bundled-example",
          runtimeEnabled: true,
          expectationMatched: true,
          expected: expect.objectContaining({ validationStatus: "pass" }),
          actual: expect.objectContaining({
            validationStatus: "pass",
            findingIds: []
          })
        }),
        expect.objectContaining({
          id: "bundled-risky-security",
          profile: "risky-security",
          expectationMatched: true,
          expected: expect.objectContaining({
            validationStatus: "fail",
            findingIds: ["plugin.security.hard_coded_secret"]
          }),
          actual: expect.objectContaining({
            validationStatus: "fail",
            findingIds: expect.arrayContaining(["plugin.security.hard_coded_secret"])
          })
        }),
        expect.objectContaining({
          id: "bundled-starter-skill",
          profile: "skill-only",
          expectationMatched: true,
          expected: expect.objectContaining({ validationStatus: "pass" })
        }),
        expect.objectContaining({
          id: "bundled-generic-mcp",
          profile: "generic-mcp",
          sourceType: "bundled-example",
          runtimeEnabled: false,
          expectationMatched: true,
          expected: expect.objectContaining({ validationStatus: "pass" }),
          actual: expect.objectContaining({
            validationStatus: "pass",
            compatibilityFailedClients: []
          })
        })
      ])
    );
  });

  it("renders a compact text summary", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "corpus"], io, {
      terminalContext: {
        stdoutIsTTY: false,
        stderrIsTTY: false,
        env: {},
        platform: "win32"
      }
    });
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Validation Corpus");
    expect(output).toContain("Status: PASS");
    expect(output).toContain("bundled-runtime-healthy: PASS");
    expect(output).toContain("bundled-risky-security: PASS");
    expect(output).toContain("bundled-generic-mcp: PASS");
  });

  it("writes corpus JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-corpus-")),
      "corpus.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "corpus", "--output", outputPath], io);
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain(`Output: ${outputPath}`);
    expect(writtenReport.kind).toBe("doctor.validation.corpus");
    expect(writtenReport.summary.failedExpectations).toBe(0);
  });

  it("requires a path after --output", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "corpus", "--output"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing path after --output.");
  });

  it("runs an external manifest without exposing local paths", async () => {
    const { manifestPath, root } = await createExternalManifest();
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["doctor", "corpus", "--manifest", manifestPath, "--json"], io);
    const output = JSON.parse(stdout.join(""));
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toMatchObject({
      kind: "doctor.validation.corpus",
      corpusType: "external",
      summary: { status: "pass" }
    });
    expect(JSON.stringify(output)).not.toContain(root);
  });

  it("writes external corpus JSON to an output path", async () => {
    const { manifestPath, root } = await createExternalManifest();
    const outputPath = path.join(root, "report.json");
    const { io, stderr } = createIo();
    const exitCode = await runCli([
      "doctor", "corpus", "--manifest", manifestPath, "--output", outputPath
    ], io);
    const output = JSON.parse(await readFile(outputPath, "utf8"));
    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.corpusType).toBe("external");
  });

  it("returns exit 1 for an external expectation mismatch", async () => {
    const { manifestPath } = await createExternalManifest({ digestDrift: true });
    const { io, stderr } = createIo();
    expect(await runCli(["doctor", "corpus", "--manifest", manifestPath, "--json"], io)).toBe(1);
    expect(stderr).toEqual([]);
  });

  it("returns exit 2 for an invalid external manifest", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-corpus-invalid-"));
    const manifestPath = path.join(root, "corpus.json");
    await writeFile(manifestPath, "{}", "utf8");
    const { io, stdout, stderr } = createIo();
    expect(await runCli(["doctor", "corpus", "--manifest", manifestPath], io)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("schemaVersion");
  });

  it("requires a path after --manifest", async () => {
    const { io, stdout, stderr } = createIo();
    expect(await runCli(["doctor", "corpus", "--manifest", "--json"], io)).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing path after --manifest.");
  });
});
