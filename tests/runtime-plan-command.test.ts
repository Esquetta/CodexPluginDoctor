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

describe("doctor runtime-plan command", () => {
  it("renders a non-executing runtime plan as JSON", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.schemaVersion).toBe("1.0.0");
    expect(output.kind).toBe("doctor.runtime.plan");
    expect(output.runtimeExecution).toBe("not_started");
    expect(output.digest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(output.summary.executableServerCount).toBe(1);
    expect(output.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "doctorRuntime",
          transport: "stdio",
          command: "node",
          probeMethods: expect.arrayContaining([
            "initialize",
            "tools/list",
            "tools/call:safe-only"
          ])
        })
      ])
    );
  });

  it("keeps the approval digest stable across repeated runs", async () => {
    const first = createIo();
    const second = createIo();

    await runCli(["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--json"], first.io);
    await runCli(["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--json"], second.io);

    const firstOutput = JSON.parse(first.stdout.join(""));
    const secondOutput = JSON.parse(second.stdout.join(""));

    expect(secondOutput.digest).toBe(firstOutput.digest);
  });

  it("writes the runtime plan JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-runtime-plan-")),
      "runtime-plan.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--output", outputPath],
      io
    );
    const writtenPlan = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("Doctor Runtime Plan");
    expect(writtenPlan.kind).toBe("doctor.runtime.plan");
  });

  it("renders a review-ready runtime plan artifact as Markdown", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-runtime-plan-md-")),
      "runtime-plan.md"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "runtime-plan",
        "examples/codex-doctor-runtime",
        "--markdown",
        "--output",
        outputPath
      ],
      io
    );
    const writtenPlan = await readFile(outputPath, "utf8");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("# Doctor Runtime Review Plan");
    expect(stdout.join("")).toContain("## Review Checklist");
    expect(stdout.join("")).toContain("Approval digest: `sha256:");
    expect(writtenPlan).toContain("| Risk | Name | Transport | Command or URL | Cwd |");
    expect(writtenPlan).toContain("doctorRuntime");
  });

  it("rejects conflicting runtime plan output formats", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--json", "--markdown"],
      io
    );

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Use either --json or --markdown, not both.");
  });

  it("gates runtime checks behind an approved runtime plan digest", async () => {
    const planIo = createIo();
    await runCli(["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--json"], planIo.io);
    const plan = JSON.parse(planIo.stdout.join(""));
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "examples/codex-doctor-runtime",
        "--runtime",
        "--require-runtime-approval",
        "--runtime-approval-digest",
        plan.digest,
        "--json"
      ],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.summary.runtimeProbeEnabled).toBe(true);
    expect(output.summary.status).toBe("pass");
  });

  it("refuses runtime checks when the approval digest does not match", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "check",
        "examples/codex-doctor-runtime",
        "--runtime",
        "--require-runtime-approval",
        "--runtime-approval-digest",
        "sha256:0000000000000000000000000000000000000000000000000000000000000000"
      ],
      io
    );

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Runtime approval digest does not match");
    expect(stderr.join("")).toContain("Current runtime plan digest:");
  });

  it("requires a target path for runtime-plan", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "runtime-plan", "--json"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing target path for runtime plan.");
  });
});
