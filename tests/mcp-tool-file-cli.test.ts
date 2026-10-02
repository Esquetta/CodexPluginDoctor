import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run-cli.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";

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
    schemaVersion: 1, scope: "tool-definitions-file", status,
    source: { kind: "file", format: "mcp-tools-list-response", bytesRead: 250 },
    inspection: { complete: ["pass", "warn", "fail"].includes(status), toolsChecked: 1, hasNextCursor: false, reason: status === "incomplete" ? "more-pages-present" : null },
    coverage: { schema: "root-shape-only", discovery: "not-tested", serverCatalog: "not-tested", toolExecution: "not-tested", fullConformance: "not-tested", customHeaderAnnotations: "not-tested" },
    findings: []
  };
}

describe("doctor tools-file", () => {
  it.each([
    [], ["--json"], ["tools.json", "extra"], ["tools.json", "--json", "--json"],
    ["tools.json", "--allow-network"], ["tools.json", "--allow-local-network"],
    ["tools.json", "--runtime"], ["tools.json", "--output", "out.json"],
    ["tools.json", "--max-tools", "1000"], ["tools.json", "--json=true"]
  ])("rejects unsupported arguments %j without inspecting a file", async (...args: string[]) => {
    const c = capture();
    const inspectMcpToolFileImpl = vi.fn();
    expect(await runCli(["doctor", "tools-file", ...args], c.io, { inspectMcpToolFileImpl })).toBe(2);
    expect(inspectMcpToolFileImpl).not.toHaveBeenCalled();
    expect(c.stderr.length).toBeGreaterThan(0);
  });
  it.each([["pass", 0], ["warn", 1], ["fail", 1], ["incomplete", 2], ["blocked", 2]] as const)(
    "returns %s as exit %i with file-only coverage", async (status, code) => {
      const c = capture();
      const inspectMcpToolFileImpl = vi.fn().mockResolvedValue(report(status));
      expect(await runCli(["doctor", "tools-file", "PRIVATE_FILE_SENTINEL.json"], c.io, { inspectMcpToolFileImpl })).toBe(code);
      const output = c.stdout.join("\n");
      expect(output).toContain(status);
      expect(output).toContain("tool-definitions-file");
      expect(output).toContain("root-shape-only");
      expect(output).toContain("Server catalog: not-tested");
      expect(output).not.toContain("PRIVATE_FILE_SENTINEL");
    }
  );
  it("emits the standalone JSON report", async () => {
    const c = capture();
    const inspectMcpToolFileImpl = vi.fn().mockResolvedValue(report());
    expect(await runCli(["doctor", "tools-file", "tools.json", "--json"], c.io, { inspectMcpToolFileImpl })).toBe(0);
    expect(inspectMcpToolFileImpl).toHaveBeenCalledExactlyOnceWith("tools.json");
    expect(JSON.parse(c.stdout.join("\n"))).toEqual(report());
  });
  it("shows file command help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "tools-file", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("doctor tools-file <path>");
  });
  it("registers a distinct file-only report schema", () => {
    const entry = buildDoctorOutputContract().schemas.find((schema) => schema.id === "doctor.tools.file.json");
    expect(entry).toBeDefined();
    expect(entry?.schema).toMatchObject({
      required: expect.arrayContaining(["scope", "source", "inspection", "coverage", "findings"]),
      properties: { schemaVersion: { const: 1 }, scope: { const: "tool-definitions-file" },
        coverage: { properties: { serverCatalog: { const: "not-tested" } } }, findings: { maxItems: 100 } }
    });
  });
  it.each([false, true])("inspects an actual saved response with continuation %s", async (continued) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-file-cli-"));
    const file = path.join(root, "PRIVATE_FILE_SENTINEL.json");
    try {
      await writeFile(file, JSON.stringify({ jsonrpc: "2.0", id: 0, result: {
        resultType: "complete", tools: [{ name: "private.tool", inputSchema: { type: "object", required: ["notDeclaredInProperties"] } }],
        ttlMs: 0, cacheScope: "private", ...(continued ? { nextCursor: "PRIVATE_CURSOR_SENTINEL" } : {})
      } }));
      const c = capture();
      expect(await runCli(["doctor", "tools-file", file, "--json"], c.io)).toBe(continued ? 2 : 0);
      const output = c.stdout.join("\n");
      const result = JSON.parse(output);
      expect(result.status).toBe(continued ? "incomplete" : "pass");
      expect(result.inspection.toolsChecked).toBe(1);
      expect(result.inspection.hasNextCursor).toBe(continued);
      expect(result.coverage.serverCatalog).toBe("not-tested");
      expect(output).not.toContain("PRIVATE_");
      expect(output).not.toContain("private.tool");
    } finally {
      const resolved = await realpath(root);
      const relative = path.relative(await realpath(os.tmpdir()), resolved);
      if (path.isAbsolute(relative) || path.dirname(relative) !== "." || !path.basename(resolved).startsWith("doctor-file-cli-")) {
        throw new Error("Unexpected test cleanup target.");
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });
});
