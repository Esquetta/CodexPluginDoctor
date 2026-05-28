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

describe("doctor contract command", () => {
  it("renders the machine-readable output contract", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "contract", "--json"], io);
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.output.contract");
    expect(output.contract).toMatchObject({
      frozenSince: "0.18.0",
      stability: "stable-through-1.0"
    });
    expect(output.ruleCatalog).toMatchObject({
      status: "frozen",
      frozenSince: "0.18.0",
      digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/)
    });
    expect(output.ruleCatalog.ruleCount).toBeGreaterThan(20);
    expect(output.ruleCatalog.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.security.prompt_injection_text",
          category: "security",
          defaultSeverity: "fail"
        }),
        expect.objectContaining({
          id: "plugin.runtime.initialize.timeout",
          category: "runtime",
          defaultSeverity: "fail"
        })
      ])
    );
    expect(output.schemas).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "doctor.check.json",
          command: "codex-plugin-doctor check <path> --json"
        }),
        expect.objectContaining({
          id: "doctor.installed.check.json",
          command: "codex-plugin-doctor check --installed --json"
        }),
        expect.objectContaining({
          id: "doctor.security.json",
          command: "codex-plugin-doctor security <path> --json"
        }),
        expect.objectContaining({
          id: "doctor.attestation.json",
          command: "codex-plugin-doctor doctor attest <path> --json"
        }),
        expect.objectContaining({
          id: "doctor.attestation.verification.json",
          command: "codex-plugin-doctor doctor attest verify <attestation.json> --target <path> --json",
          outputKind: "doctor.attestation.verification"
        }),
        expect.objectContaining({
          id: "doctor.release.evidence.json",
          command: "codex-plugin-doctor doctor release-evidence <path> --json",
          outputKind: "doctor.release.evidence"
        }),
        expect.objectContaining({
          id: "doctor.release.evidence.verification.json",
          command: "codex-plugin-doctor doctor release-evidence verify <evidence.json> --target <path> --json",
          outputKind: "doctor.release.evidence.verification"
        }),
        expect.objectContaining({
          id: "doctor.release.evidence.asset.json",
          command: "codex-plugin-doctor doctor release-evidence asset <path> --tag <tag> --output <evidence.json> --json",
          outputKind: "doctor.release.evidence.asset"
        }),
        expect.objectContaining({
          id: "doctor.runtime.plan.json",
          command: "codex-plugin-doctor doctor runtime-plan <path> --json",
          outputKind: "doctor.runtime.plan"
        }),
        expect.objectContaining({
          id: "doctor.runtime.policy.json",
          command: "codex-plugin-doctor doctor runtime-policy <path> --json",
          outputKind: "doctor.runtime.policy"
        }),
        expect.objectContaining({
          id: "doctor.review.bundle.json",
          command: "codex-plugin-doctor doctor review-bundle <path> --json",
          outputKind: "doctor.review.bundle"
        }),
        expect.objectContaining({
          id: "doctor.review.bundle.verification.json",
          command: "codex-plugin-doctor doctor review-bundle verify <bundle-dir> --target <path> --json",
          outputKind: "doctor.review.bundle.verification"
        }),
        expect.objectContaining({
          id: "doctor.review.bundle.diff.json",
          command: "codex-plugin-doctor doctor review-bundle diff --before <dir> --after <dir> --json",
          outputKind: "doctor.review.bundle.diff"
        })
      ])
    );

    for (const surface of output.schemas) {
      expect(surface.schema).toMatchObject({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "object"
      });
      expect(surface.schema.required).toContain("schemaVersion");
    }
  });

  it("keeps the rule catalog digest deterministic", async () => {
    const first = createIo();
    const second = createIo();

    await runCli(["doctor", "contract", "--json"], first.io);
    await runCli(["doctor", "contract", "--json"], second.io);

    const firstOutput = JSON.parse(first.stdout.join(""));
    const secondOutput = JSON.parse(second.stdout.join(""));

    expect(secondOutput.ruleCatalog.digest).toBe(firstOutput.ruleCatalog.digest);
  });

  it("renders a compact text summary", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "contract"], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Output Contract");
    expect(output).toContain("Rule catalog: frozen");
    expect(output).toContain("Schemas:");
    expect(output).toContain("doctor.check.json");
  });

  it("writes contract JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-contract-")),
      "contract.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "contract", "--output", outputPath], io);
    const writtenContract = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain(`Output: ${outputPath}`);
    expect(writtenContract.kind).toBe("doctor.output.contract");
    expect(writtenContract.schemas.length).toBeGreaterThan(10);
  });

  it("requires a path after --output", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "contract", "--output"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing path after --output.");
  });
});
