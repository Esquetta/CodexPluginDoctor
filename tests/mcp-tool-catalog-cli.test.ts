import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
  const complete = ["pass", "warn", "fail"].includes(status);
  return {
    schemaVersion: 1, scope: "tool-catalog-structure", status,
    discovery: { schemaVersion: 1, requestedVersion: "2026-07-28", scope: "discovery-only", status: "discovered", supportedVersions: ["2026-07-28"], findings: [], coverage: { discovery: "pass", runtime: "not-tested" } },
    catalog: { complete, pagesRead: complete ? 1 : 0, toolsChecked: 0, reason: complete ? null : "auth-required" },
    coverage: { discovery: "pass", catalogEnumeration: complete ? "complete" : "incomplete", schema: "root-shape-only", toolExecution: "not-tested", fullConformance: "not-tested", customHeaderAnnotations: "not-tested" },
    findings: []
  };
}

describe("doctor tools", () => {
  it("requires explicit consent before catalog inspection", async () => {
    const c = capture();
    const inspectMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", "https://mcp.example/mcp"], c.io, { inspectMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("--allow-network");
    expect(inspectMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([
    [], ["--allow-network"],
    ["https://mcp.example", "--allow-network", "--allow-network"],
    ["https://mcp.example", "--allow-network", "--allow-local-network", "--allow-local-network"],
    ["https://mcp.example", "--allow-network", "--json", "--json"],
    ["https://mcp.example", "--allow-network", "--runtime"],
    ["https://mcp.example", "--allow-network=true"],
    ["https://mcp.example", "--allow-network", "--output", "file.json"],
    ["https://mcp.example", "--allow-network", "--max-pages", "20"],
    ["https://mcp.example", "--allow-local-network"],
    ["https://mcp.example", "--allow-network", "extra"]
  ])("rejects malformed arguments %j before inspection", async (...args: string[]) => {
    const c = capture();
    const inspectMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", ...args], c.io, { inspectMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.length).toBeGreaterThan(0);
    expect(inspectMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([["pass", 0], ["warn", 1], ["fail", 1], ["unsupported", 1], ["not-applicable", 1], ["incomplete", 2], ["blocked", 2]] as const)(
    "returns %s as exit %i with explicit coverage", async (status, exitCode) => {
      const c = capture();
      const inspectMcpToolCatalogImpl = vi.fn().mockResolvedValue(report(status));
      expect(await runCli(["doctor", "tools", "https://mcp.example/mcp", "--allow-network"], c.io, { inspectMcpToolCatalogImpl })).toBe(exitCode);
      const text = c.stdout.join("\n");
      expect(text).toContain(status);
      expect(text).toContain("tool-catalog-structure");
      expect(text).toContain("root-shape-only");
      expect(text).toContain("not-tested");
      if (status === "incomplete") expect(text).toContain("auth-required");
      expect(text).not.toContain("https://mcp.example");
    }
  );

  it("renders numeric finding locations and fixed schema slots", async () => {
    const c = capture();
    const result = { ...report("fail"), findings: [{
      id: "plugin.catalog.schema.input.invalid", severity: "fail", message: "Invalid input schema.",
      impact: "Cannot inspect input schema.", suggestedFix: "Provide an object.",
      location: { page: 2, toolIndex: 5, schema: "inputSchema", relatedToolIndex: 1 }
    }] };
    const inspectMcpToolCatalogImpl = vi.fn().mockResolvedValue(result);
    expect(await runCli(["doctor", "tools", "https://mcp.example/mcp", "--allow-network"], c.io, { inspectMcpToolCatalogImpl })).toBe(1);
    expect(c.stdout.join("\n")).toContain("[page 2, tool 5, inputSchema, related tool 1]");
    expect(c.stdout.join("\n")).toContain("Provide an object.");
  });
  it("emits JSON and forwards only explicit consent", async () => {
    const c = capture();
    const inspectMcpToolCatalogImpl = vi.fn().mockResolvedValue(report());
    expect(await runCli(["doctor", "tools", "http://localhost:3000/mcp", "--allow-network", "--allow-local-network", "--json"], c.io, { inspectMcpToolCatalogImpl })).toBe(0);
    expect(inspectMcpToolCatalogImpl).toHaveBeenCalledExactlyOnceWith("http://localhost:3000/mcp", { allowNetwork: true, allowLocalNetwork: true });
    expect(JSON.parse(c.stdout.join("\n"))).toEqual(report());
  });

  it("offers command help without network consent", async () => {
    const c = capture();
    expect(await runCli(["doctor", "tools", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("doctor tools <url>");
  });

  it("registers the standalone catalog report without claiming full conformance", () => {
    const schema = buildDoctorOutputContract().schemas.find((entry) => entry.id === "doctor.tools.json");
    expect(schema).toBeDefined();
    expect(schema?.command).toBe("codex-plugin-doctor doctor tools <url> --allow-network --json");
    expect(schema?.schema).toMatchObject({
      required: expect.arrayContaining(["schemaVersion", "scope", "status", "discovery", "catalog", "coverage", "findings"]),
      properties: {
        schemaVersion: { const: 1 }, scope: { const: "tool-catalog-structure" },
        coverage: { properties: { toolExecution: { const: "not-tested" }, schema: { const: "root-shape-only" } } },
        catalog: { required: expect.arrayContaining(["complete", "pagesRead", "toolsChecked", "reason"]) },
        findings: { maxItems: 100 }
      }
    });
  });
  it.each([[false, "warn", 1], [true, "incomplete", 2]] as const)(
    "inspects real HTTP pages with second-page authentication %s", async (requireAuth, status, exitCode) => {
      const requests: Array<{ method: string; params: { cursor?: string }; url?: string }> = [];
      const cursor = "https://secret-sentinel.example/next?token=secret-sentinel";
      const server = createServer((request, response) => {
        let body = "";
        request.setEncoding("utf8");
        request.on("data", (chunk) => { body += chunk; });
        request.on("end", () => {
          const rpc = JSON.parse(body);
          requests.push({ method: rpc.method, params: rpc.params, url: request.url });
          if (requireAuth && requests.length === 3) {
            response.writeHead(401, { "content-type": "application/json" });
            response.end('{"message":"secret-sentinel"}');
            return;
          }
          response.writeHead(200, { "content-type": "application/json" });
          const result = rpc.method === "server/discover"
            ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } }
            : { tools: [{ name: "secret-sentinel", inputSchema: requireAuth ? null : {} }], ...(requests.length === 2 ? { nextCursor: cursor } : {}) };
          response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { resultType: "complete", ttlMs: 0, cacheScope: "private", ...result } }));
        });
      });
      await new Promise<void>((resolve) => server.listen(0, resolve));
      try {
        const c = capture();
        const port = (server.address() as AddressInfo).port;
        expect(await runCli(["doctor", "tools", `http://localhost:${port}/secret-sentinel`, "--allow-network", "--allow-local-network", "--json"], c.io)).toBe(exitCode);
        const output = JSON.parse(c.stdout.join("\n"));
        expect(output.status).toBe(status);
        expect(output.catalog.complete).toBe(!requireAuth);
        expect(output.coverage.toolExecution).toBe("not-tested");
        expect(output.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: requireAuth ? "fail" : "warn" })]));
        expect(c.stdout.join("\n")).not.toContain("secret-sentinel");
        expect(requests.map((entry) => entry.method)).toEqual(["server/discover", "tools/list", "tools/list"]);
        expect(requests[2].params.cursor).toBe(cursor);
        expect(requests.every((entry) => entry.url === "/secret-sentinel")).toBe(true);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  );
});

describe("doctor tools --save-response", () => {
  const url = "https://mcp.example/mcp";
  const tools = [{ name: "echo", inputSchema: { type: "object" } }];

  async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
    const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-tools-save-"));
    try {
      await run(directory);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }

  it.each([
    [url, "--allow-network", "--save-response"],
    [url, "--allow-network", "--save-response", "--json"],
    [url, "--allow-network", "--save-response", "a.json", "--save-response", "b.json"],
    [url, "--save-response", "a.json"]
  ])("rejects %j before capture", async (...args: string[]) => {
    const c = capture();
    const captureMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", ...args], c.io, { captureMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.length).toBeGreaterThan(0);
    expect(captureMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each(["https://example.test/tools.json", "\\\\server\\share\\tools.json"])("rejects the non-local save path %s before any request", async (savePath) => {
    const c = capture();
    const captureMcpToolCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "tools", url, "--allow-network", "--save-response", savePath], c.io, { captureMcpToolCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("local file path");
    expect(captureMcpToolCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([["pass", 0], ["fail", 1]] as const)("saves a complete %s catalog and keeps the report exit code %i", async (status, exitCode) => {
    await withDirectory(async (directory) => {
      const c = capture();
      const savePath = path.join(directory, "tools.json");
      const captureMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(status), tools, cache: { ttlMs: 0, cacheScope: "public" } });

      expect(await runCli(["doctor", "tools", url, "--save-response", savePath, "--allow-network", "--json"], c.io, { captureMcpToolCatalogImpl })).toBe(exitCode);

      expect(captureMcpToolCatalogImpl).toHaveBeenCalledExactlyOnceWith(url, { allowNetwork: true, allowLocalNetwork: false });
      expect(JSON.parse(c.stdout.join("\n"))).toEqual(report(status));
      expect(c.stderr.join("\n")).toContain("Saved a complete tools/list response with 1 tools");
      expect(c.stderr.join("\n")).not.toContain(directory);
      expect(JSON.parse(await readFile(savePath, "utf8")).result.tools).toEqual(tools);
    });
  });

  it.each(["incomplete", "blocked", "unsupported", "not-applicable"])("writes nothing and exits 2 for a %s catalog", async (status) => {
    await withDirectory(async (directory) => {
      const c = capture();
      const captureMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(status), tools: null, cache: null });

      const savePath = path.join(directory, "tools.json");
      await writeFile(savePath, "previous baseline", "utf8");

      expect(await runCli(["doctor", "tools", url, "--allow-network", "--save-response", savePath], c.io, { captureMcpToolCatalogImpl })).toBe(2);

      expect(c.stderr.join("\n")).toContain("not saved because enumeration did not complete");
      expect(await readdir(directory)).toEqual(["tools.json"]);
      expect(await readFile(savePath, "utf8")).toBe("previous baseline");
    });
  });

  it("exits 2 when the save target is not a regular file", async () => {
    await withDirectory(async (directory) => {
      const c = capture();
      const captureMcpToolCatalogImpl = vi.fn().mockResolvedValue({ report: report(), tools, cache: { ttlMs: 0, cacheScope: "public" } });

      expect(await runCli(["doctor", "tools", url, "--allow-network", "--save-response", directory], c.io, { captureMcpToolCatalogImpl })).toBe(2);

      expect(c.stderr.join("\n")).toContain("not a regular file");
    });
  });

  it("saves a real paginated catalog that tools-file accepts", async () => {
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const rpc = JSON.parse(body);
        const result = rpc.method === "server/discover"
          ? { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } }
          : rpc.params.cursor === undefined
            ? { tools: [tools[0]], nextCursor: "page-2" }
            : { tools: [{ name: "second", inputSchema: { type: "object" } }] };
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result: { resultType: "complete", ttlMs: 0, cacheScope: "public", ...result } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      await withDirectory(async (directory) => {
        const savePath = path.join(directory, "tools.json");
        const port = (server.address() as AddressInfo).port;
        expect(await runCli(["doctor", "tools", `http://localhost:${port}/mcp`, "--allow-network", "--allow-local-network", "--save-response", savePath], capture().io)).toBe(0);

        const c = capture();
        expect(await runCli(["doctor", "tools-file", savePath, "--json"], c.io)).toBe(0);
        expect(JSON.parse(c.stdout.join("\n"))).toMatchObject({ status: "pass", inspection: { complete: true, toolsChecked: 2 } });
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("documents the option in command help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "tools", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("--save-response <path>");
  });
});
