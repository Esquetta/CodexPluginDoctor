import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { buildDoctorOutputContract } from "../src/core/output-contract.js";
import { buildDoctorRuntimePlan } from "../src/core/runtime-plan.js";
import { runCli } from "../src/run-cli.js";

const fixtureRoot = path.join("tests", "fixtures", "stdio-tool-catalog");
const mcpJsonRoot = path.join("tests", "fixtures", "stdio-tool-catalog-mcp-json");

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: {
    writeStdout: (text: string) => { stdout.push(text); },
    writeStderr: (text: string) => { stderr.push(text); }
  } };
}

function report(status = "pass") {
  return {
    schemaVersion: 1, scope: "tool-catalog-structure", transport: "stdio", status,
    protocol: { era: "legacy", version: "2025-11-25" },
    execution: { backend: "native", image: null, network: "host", packageMount: "host" },
    discovery: { schemaVersion: 1, requestedVersion: "2026-07-28", scope: "discovery-only", status: "unsupported", supportedVersions: [], findings: [], coverage: { discovery: "skipped", runtime: "not-tested" } },
    catalog: { complete: true, pagesRead: 1, toolsChecked: 1, reason: null },
    coverage: { discovery: "skipped", catalogEnumeration: "complete", schema: "root-shape-only", toolExecution: "not-tested", fullConformance: "not-tested", customHeaderAnnotations: "not-tested" },
    findings: []
  };
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-tools-stdio-"));
  try {
    await run(directory);
  } finally {
    const resolved = await realpath(directory);
    if (path.dirname(resolved) !== await realpath(os.tmpdir()) || !path.basename(resolved).startsWith("doctor-tools-stdio-")) {
      throw new Error("Unexpected test cleanup target.");
    }
    await rm(resolved, { recursive: true, force: true });
  }
}

describe("doctor tools <path> --server", () => {
  it("requires explicit --runtime consent before starting a server", async () => {
    const c = capture();
    const captureStdioMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern"], c.io, { captureStdioMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("--runtime");
    expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([
    [fixtureRoot, "--server"],
    [fixtureRoot, "--server", "--runtime"],
    [fixtureRoot, "--server", "a", "--server", "b", "--runtime"],
    [fixtureRoot, "--server", "modern", "--runtime", "--runtime"],
    [fixtureRoot, "--server", "modern", "--runtime", "--allow-network"],
    [fixtureRoot, "--server", "modern", "--runtime", "--allow-local-network"],
    [fixtureRoot, "--server", "modern", "--runtime", "--bearer-token-env", "MCP_TOKEN"],
    [fixtureRoot, "--server", "modern", "--runtime", "--sandbox", "podman"],
    [fixtureRoot, "--server", "modern", "--runtime", "--sandbox"],
    [fixtureRoot, "--server", "modern", "--runtime", "--save-response"],
    [fixtureRoot, "--server", "modern", "--runtime", "--runtime-approval-digest", "sha256:abc"],
    [fixtureRoot, "--server", "modern", "--runtime", "extra"],
    ["https://mcp.example/mcp", "--server", "modern", "--runtime"],
    [fixtureRoot, "--server", "modern", "--runtime", "--save-response", "https://example.test/tools.json"]
  ])("rejects %j before starting a server", async (...args: string[]) => {
    const c = capture();
    const captureStdioMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", ...args], c.io, { captureStdioMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.length).toBeGreaterThan(0);
    expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["absent", "not in the package configuration"],
    ["remote", "uses HTTP"],
    ["outside-cwd", "inside the package root"]
  ])("reports the unusable server %s on stderr", async (name, message) => {
    const c = capture();
    const captureStdioMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", fixtureRoot, "--server", name, "--runtime"], c.io, { captureStdioMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain(message);
    expect(c.stderr.join("\n")).not.toContain(name);
    expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([["pass", 0], ["warn", 1], ["fail", 1], ["unsupported", 1], ["not-applicable", 1], ["incomplete", 2], ["blocked", 2]] as const)(
    "returns %s as exit %i", async (status, exitCode) => {
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(status), tools: null, cache: null });
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--json"], c.io, { captureStdioMcpToolCatalogImpl })).toBe(exitCode);
      expect(JSON.parse(c.stdout.join("\n"))).toEqual(report(status));
      expect(captureStdioMcpToolCatalogImpl).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ command: "node", args: ["./server.js", "modern"], source: "manifest" }),
        {}
      );
    }
  );

  it("forwards the Docker sandbox", async () => {
    const captureStdioMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(), tools: null, cache: null });
    expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--sandbox", "docker"], capture().io, { captureStdioMcpToolCatalogImpl })).toBe(0);
    expect(captureStdioMcpToolCatalogImpl).toHaveBeenCalledExactlyOnceWith(expect.anything(), { sandbox: "docker" });
  });

  describe("Docker environment forwarding", () => {
    const context = (env: Record<string, string | undefined>) => ({ terminalContext: { stdoutIsTTY: false, stderrIsTTY: false, env } });
    const docker = [fixtureRoot, "--server", "modern", "--runtime", "--sandbox", "docker"];

    it("forwards only the variable names to the Docker capture", async () => {
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(), tools: null, cache: null });
      expect(await runCli(["doctor", "tools", ...docker, "--env", "API_KEY", "--env", "REGION"], c.io, {
        captureStdioMcpToolCatalogImpl, ...context({ API_KEY: "secret-sentinel", REGION: "eu" })
      })).toBe(0);
      expect(captureStdioMcpToolCatalogImpl).toHaveBeenCalledExactlyOnceWith(expect.anything(), { sandbox: "docker", environment: ["API_KEY", "REGION"] });
      expect([...c.stdout, ...c.stderr].join("\n")).not.toContain("secret-sentinel");
    });

    it.each([
      [[fixtureRoot, "--server", "modern", "--runtime", "--env", "API_KEY"], { API_KEY: "x" }, "--env requires --sandbox docker; native servers already inherit Doctor's environment."],
      [[...docker, "--env", "bad-name"], { "bad-name": "x" }, "--env requires an environment variable name."],
      [[...docker, "--env", "API_KEY", "--env", "API_KEY"], { API_KEY: "x" }, "Invalid or duplicate tool catalog arguments."],
      [[...docker, "--env"], {}, "Invalid or duplicate tool catalog arguments."],
      [[...docker, "--env", "API_KEY"], {}, "Environment variable is not set: API_KEY"],
      [[...docker, "--env", "API_KEY"], { API_KEY: "" }, "Environment variable is not set: API_KEY"]
    ])("rejects %j before starting a server", async (args, env, message) => {
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn();
      expect(await runCli(["doctor", "tools", ...args], c.io, { captureStdioMcpToolCatalogImpl, ...context(env) })).toBe(2);
      expect(c.stderr.join("\n")).toContain(message);
      expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
    });

    it("rejects more than 32 forwarded variables", async () => {
      const names = Array.from({ length: 33 }, (_, index) => `VAR_${index}`);
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn();
      expect(await runCli(["doctor", "tools", ...docker, ...names.flatMap((name) => ["--env", name])], c.io, {
        captureStdioMcpToolCatalogImpl, ...context(Object.fromEntries(names.map((name) => [name, "x"])))
      })).toBe(2);
      expect(c.stderr.join("\n")).toContain("At most 32 --env variables can be forwarded.");
      expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
    });
  });

  it("renders the transport, protocol, and execution backend as text", async () => {
    const c = capture();
    const captureStdioMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(), tools: null, cache: null });
    expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime"], c.io, { captureStdioMcpToolCatalogImpl })).toBe(0);
    const text = c.stdout.join("\n");
    expect(text).toContain("Transport: stdio");
    expect(text).toContain("Protocol: legacy (2025-11-25)");
    expect(text).toContain("Execution: native");
  });

  describe("runtime approval", () => {
    it("prints the current plan digest when approval is required but missing", async () => {
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn();
      const plan = await buildDoctorRuntimePlan(fixtureRoot);
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--require-runtime-approval"], c.io, { captureStdioMcpToolCatalogImpl })).toBe(1);
      expect(c.stderr.join("\n")).toContain(`Current runtime plan digest: ${plan.digest}`);
      expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
    });

    it("rejects a digest that does not match the current plan", async () => {
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn();
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--require-runtime-approval", "--runtime-approval-digest", `sha256:${"0".repeat(64)}`], c.io, { captureStdioMcpToolCatalogImpl })).toBe(1);
      expect(c.stderr.join("\n")).toContain("does not match");
      expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
    });

    it("starts the server when the digest matches the plan for the same sandbox", async () => {
      const captureStdioMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(), tools: null, cache: null });
      const native = await buildDoctorRuntimePlan(fixtureRoot);
      const docker = await buildDoctorRuntimePlan(fixtureRoot, undefined, { sandbox: "docker" });
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--sandbox", "docker", "--require-runtime-approval", "--runtime-approval-digest", native.digest], capture().io, { captureStdioMcpToolCatalogImpl })).toBe(1);
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--sandbox", "docker", "--require-runtime-approval", "--runtime-approval-digest", docker.digest], capture().io, { captureStdioMcpToolCatalogImpl })).toBe(0);
      expect(captureStdioMcpToolCatalogImpl).toHaveBeenCalledOnce();
    });

    it("refuses approval for servers outside the plugin manifest configuration", async () => {
      const c = capture();
      const captureStdioMcpToolCatalogImpl = vi.fn();
      expect(await runCli(["doctor", "tools", mcpJsonRoot, "--server", "legacy", "--runtime", "--require-runtime-approval"], c.io, { captureStdioMcpToolCatalogImpl })).toBe(2);
      expect(c.stderr.join("\n")).toContain(".mcp.json");
      expect(captureStdioMcpToolCatalogImpl).not.toHaveBeenCalled();
    });
  });

  it("captures real modern and legacy servers into baselines that tools-file and tools-diff accept", async () => {
    await withDirectory(async (directory) => {
      const modernPath = path.join(directory, "modern.json");
      const legacyPath = path.join(directory, "legacy.json");

      const modern = capture();
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "modern", "--runtime", "--json", "--save-response", modernPath], modern.io)).toBe(0);
      expect(JSON.parse(modern.stdout.join("\n"))).toMatchObject({
        transport: "stdio", status: "pass", protocol: { era: "modern", version: "2026-07-28" }, catalog: { complete: true, toolsChecked: 2 }
      });
      expect(modern.stderr).toEqual([expect.stringContaining("Saved a complete tools/list response with 2 tools")]);

      const legacy = capture();
      expect(await runCli(["doctor", "tools", mcpJsonRoot, "--server", "legacy", "--runtime", "--json", "--save-response", legacyPath], legacy.io)).toBe(0);
      expect(JSON.parse(legacy.stdout.join("\n"))).toMatchObject({ protocol: { era: "legacy", version: "2025-11-25" } });
      expect(JSON.parse(await readFile(legacyPath, "utf8")).result).toMatchObject({ resultType: "complete", ttlMs: 0, cacheScope: "private" });

      for (const output of [modern, legacy]) {
        const text = [...output.stdout, ...output.stderr].join("\n");
        for (const sentinel of ["lookup", "server.js", directory]) expect(text).not.toContain(sentinel);
      }

      const file = capture();
      expect(await runCli(["doctor", "tools-file", legacyPath, "--json"], file.io)).toBe(0);
      expect(JSON.parse(file.stdout.join("\n"))).toMatchObject({ status: "pass", inspection: { complete: true, toolsChecked: 2 } });

      const diff = capture();
      expect(await runCli(["doctor", "tools-diff", "--before", legacyPath, "--after", modernPath, "--json", "--fail-on", "breaking"], diff.io)).toBe(0);
      expect(JSON.parse(diff.stdout.join("\n")).comparison).toMatchObject({ added: 0, removed: 0, changed: 0, unchanged: 2 });
    });
  });

  it("writes nothing when a real capture is incomplete", async () => {
    await withDirectory(async (directory) => {
      const c = capture();
      const savePath = path.join(directory, "tools.json");
      expect(await runCli(["doctor", "tools", fixtureRoot, "--server", "startup-noise", "--runtime", "--save-response", savePath], c.io)).toBe(2);
      expect(c.stderr.join("\n")).toContain("not saved because enumeration did not complete");
      await expect(readFile(savePath, "utf8")).rejects.toThrow();
    });
  });

  it("documents stdio capture in command help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "tools", "--help"], c.io)).toBe(0);
    const text = c.stdout.join("\n");
    expect(text).toContain("doctor tools <path> --server <name> --runtime");
    expect(text).toContain("doctor tools <url>");
  });

  it("describes the stdio-only report fields in the output contract", () => {
    const schema = buildDoctorOutputContract().schemas.find((entry) => entry.id === "doctor.tools.json");
    expect(schema?.schema).toMatchObject({
      properties: {
        transport: { const: "stdio" },
        protocol: { properties: { era: { enum: ["modern", "legacy", null] } } },
        execution: { properties: { backend: { enum: ["native", "docker"] } } }
      }
    });
    expect((schema?.schema as { required: string[] }).required).not.toContain("transport");
  });
});
