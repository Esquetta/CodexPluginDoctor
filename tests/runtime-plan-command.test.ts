import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

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
  it("redacts remote URLs and records the remote approval boundary", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-runtime-plan-remote-"));
    const rawUrl = "https://user:credential-secret@example.com/mcp?query-secret=1#fragment-secret";

    await (await import("node:fs/promises")).mkdir(path.join(targetPath, ".codex-plugin"));
    await (await import("node:fs/promises")).writeFile(
      path.join(targetPath, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "remote-plan", version: "1.0.0", description: "Remote plan test.", mcpServers: ".mcp.json" }),
      "utf8"
    );
    await (await import("node:fs/promises")).writeFile(
      path.join(targetPath, ".mcp.json"),
      JSON.stringify({ mcpServers: { remote: { url: rawUrl } } }),
      "utf8"
    );
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "runtime-plan", targetPath, "--json"], io);
    const serialized = stdout.join("");
    const output = JSON.parse(serialized);
    const markdown = createIo();
    const policy = createIo();

    await runCli(["doctor", "runtime-plan", targetPath, "--markdown"], markdown.io);
    await runCli(["doctor", "runtime-policy", targetPath, "--json"], policy.io);

    expect(exitCode).toBe(1);
    expect(stderr).toEqual([]);
    expect(serialized).not.toContain("credential-secret");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("fragment-secret");
    for (const privateValue of ["credential-secret", "query-secret", "fragment-secret"]) {
      expect(markdown.stdout.join("")).not.toContain(privateValue);
      expect(policy.stdout.join("")).not.toContain(privateValue);
    }
    expect(output.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "remote",
        url: "https://example.com/mcp",
        networkClass: "public_https",
        probeMethods: [
          "POST initialize",
          "POST notifications/initialized",
          "GET OAuth protected-resource metadata (401 only)",
          "GET OAuth authorization-server metadata (401 only)"
        ],
        approvalRequirements: expect.arrayContaining(["--runtime", "--allow-network"])
      })
    ]));
  });

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
            "tasks/list:declared-2025-11-only",
            "tools/call:safe-only"
          ])
        })
      ])
    );
    expect(output.servers[0].probeMethods).toEqual([
      "initialize",
      "tools/list",
      "tools/call:safe-only",
      "tasks/list:declared-2025-11-only",
      "resources/list",
      "resources/read:first-resource-only",
      "resources/templates/list",
      "prompts/list",
      "prompts/get:first-prompt-only"
    ]);
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

  it("binds the selected sandbox execution to the approval digest", async () => {
    const native = createIo();
    const docker = createIo();

    await runCli(
      ["doctor", "runtime-plan", "examples/codex-doctor-runtime", "--json"],
      native.io
    );
    await runCli(
      [
        "doctor",
        "runtime-plan",
        "examples/codex-doctor-runtime",
        "--sandbox",
        "docker",
        "--json"
      ],
      docker.io
    );

    const nativePlan = JSON.parse(native.stdout.join(""));
    const dockerPlan = JSON.parse(docker.stdout.join(""));

    expect(dockerPlan.digest).not.toBe(nativePlan.digest);
    expect(nativePlan.execution).toEqual({
      backend: "native",
      image: null,
      network: "host",
      packageMount: "host"
    });
    expect(dockerPlan.execution).toEqual({
      backend: "docker",
      image: expect.stringMatching(/@sha256:[a-f0-9]{64}$/),
      network: "none",
      packageMount: "read_only"
    });
  });

  it.each([{ sandboxValue: [] }, { sandboxValue: ["native"] }])(
    "rejects a missing or unknown runtime-plan sandbox value",
    async ({ sandboxValue }) => {
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(
        [
          "doctor",
          "runtime-plan",
          "examples/codex-doctor-runtime",
          "--sandbox",
          ...sandboxValue
        ],
        io
      );

      expect(exitCode).toBe(2);
      expect(stdout).toEqual([]);
      expect(stderr.join("")).toContain("Expected --sandbox docker");
    }
  );

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
    expect(stdout.join("")).toContain("- This plan is non-executing.");
    expect(stdout.join("")).toContain("- Probe methods explicitly exclude task create, get, result, and cancel operations, plus sampling and elicitation requests.");
    expect(writtenPlan).toContain("| Risk | Name | Transport | Command or URL | Cwd |");
    expect(writtenPlan).toContain("doctorRuntime");
    expect(writtenPlan).toContain("- tasks/list:declared-2025-11-only");
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

  it("uses the Docker-bound digest for runtime check approval", async () => {
    const planIo = createIo();
    await runCli(
      [
        "doctor",
        "runtime-plan",
        "examples/codex-doctor-runtime",
        "--sandbox",
        "docker",
        "--json"
      ],
      planIo.io
    );
    const plan = JSON.parse(planIo.stdout.join(""));
    const { io, stderr } = createIo();
    const runCheckImpl = vi.fn(async (targetPath: string) => ({
      targetPath,
      status: "pass" as const,
      exitCode: 0 as const,
      findings: [],
      runtimeExecution: plan.execution
    }));

    const exitCode = await runCli(
      [
        "check",
        "examples/codex-doctor-runtime",
        "--runtime",
        "--sandbox",
        "docker",
        "--require-runtime-approval",
        "--runtime-approval-digest",
        plan.digest,
        "--json"
      ],
      io,
      { runCheckImpl }
    );

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(runCheckImpl).toHaveBeenCalledWith(expect.any(String), {
      runtime: true,
      runtimeSandbox: "docker"
    });
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
