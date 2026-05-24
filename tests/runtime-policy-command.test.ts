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

describe("doctor runtime-policy command", () => {
  it("recommends review for a clean local stdio runtime server", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "runtime-policy", "examples/codex-doctor-runtime", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output.kind).toBe("doctor.runtime.policy");
    expect(output.runtimeExecution).toBe("not_started");
    expect(output.planDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(output.recommendation.decision).toBe("review");
    expect(output.servers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "doctorRuntime",
          decision: "review",
          reasons: expect.arrayContaining(["runtime.executes_local_command"])
        })
      ])
    );
  });

  it("denies runtime execution for high-confidence unsafe security findings", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "runtime-policy", "examples/codex-doctor-risky", "--json"],
      io
    );
    const output = JSON.parse(stdout.join(""));

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(output.status).toBe("fail");
    expect(output.recommendation.decision).toBe("deny");
    expect(output.recommendation.actions.join("\n")).toContain("Do not start runtime probes");
  });

  it("writes runtime policy JSON to an output path", async () => {
    const outputPath = path.join(
      await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-runtime-policy-")),
      "runtime-policy.json"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      [
        "doctor",
        "runtime-policy",
        "examples/codex-doctor-runtime",
        "--json",
        "--output",
        outputPath
      ],
      io
    );
    const writtenReport = JSON.parse(await readFile(outputPath, "utf8"));

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).toContain("\"kind\": \"doctor.runtime.policy\"");
    expect(writtenReport.kind).toBe("doctor.runtime.policy");
  });

  it("renders a text runtime policy advisor report", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(
      ["doctor", "runtime-policy", "examples/codex-doctor-runtime"],
      io
    );
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Doctor Runtime Policy");
    expect(output).toContain("Decision: REVIEW");
    expect(output).toContain("Plan digest: sha256:");
  });

  it("requires a target path for runtime-policy", async () => {
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "runtime-policy", "--json"], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain("Missing target path for runtime policy.");
  });
});
