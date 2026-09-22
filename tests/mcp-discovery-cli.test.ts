import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run-cli.js";
import type { McpDiscoveryReport } from "../src/core/mcp-discovery.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: {
    writeStdout: (text: string) => { stdout.push(text); },
    writeStderr: (text: string) => { stderr.push(text); }
  } };
}

function report(status: McpDiscoveryReport["status"] = "discovered"): McpDiscoveryReport {
  return {
    schemaVersion: 1,
    requestedVersion: "2026-07-28",
    scope: "discovery-only",
    status,
    supportedVersions: status === "discovered" ? ["2026-07-28"] : [],
    coverage: { discovery: status === "discovered" ? "pass" : "skipped", runtime: "not-tested" },
    findings: []
  };
}

describe("doctor discover", () => {
  it("requires explicit network consent before calling discovery", async () => {
    const c = capture();
    const discoverMcpServerImpl = vi.fn();
    expect(await runCli(["doctor", "discover", "https://mcp.example/mcp"], c.io, { discoverMcpServerImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("--allow-network");
    expect(discoverMcpServerImpl).not.toHaveBeenCalled();
  });

  it.each([
    [], ["--allow-network"],
    ["https://mcp.example", "--allow-network", "--allow-network"],
    ["https://mcp.example", "--allow-network", "--json", "--json"],
    ["https://mcp.example", "--allow-network", "--runtime"],
    ["https://mcp.example", "--allow-network", "--allow-network=true"],
    ["https://mcp.example", "--allow-network", "extra"],
    ["https://mcp.example", "--allow-local-network"],
    ["https://mcp.example", "--allow-network", "--output", "report.json"]
  ])("rejects malformed or unrelated arguments %j without network", async (...args: string[]) => {
    const c = capture();
    const discoverMcpServerImpl = vi.fn();
    expect(await runCli(["doctor", "discover", ...args], c.io, { discoverMcpServerImpl })).toBe(2);
    expect(c.stderr.length).toBeGreaterThan(0);
    expect(discoverMcpServerImpl).not.toHaveBeenCalled();
  });

  it("renders a standalone JSON report and forwards only discovery consent", async () => {
    const c = capture();
    const discoverMcpServerImpl = vi.fn().mockResolvedValue(report());
    expect(await runCli(["doctor", "discover", "http://localhost:3000/mcp", "--allow-network", "--allow-local-network", "--json"], c.io, { discoverMcpServerImpl })).toBe(0);
    expect(discoverMcpServerImpl).toHaveBeenCalledExactlyOnceWith("http://localhost:3000/mcp", { allowNetwork: true, allowLocalNetwork: true });
    expect(JSON.parse(c.stdout.join("\n"))).toEqual(report());
    expect(c.stderr).toEqual([]);
  });

  it.each([["discovered", 0], ["unsupported", 1], ["blocked", 2], ["failed", 2]] as const)(
    "reports %s with exit %i without claiming runtime validation", async (status, code) => {
      const c = capture();
      const discoverMcpServerImpl = vi.fn().mockResolvedValue(report(status));
      expect(await runCli(["doctor", "discover", "https://mcp.example/mcp", "--allow-network"], c.io, { discoverMcpServerImpl })).toBe(code);
      expect(c.stdout.join("\n")).toContain("discovery-only");
      expect(c.stdout.join("\n")).toContain("not-tested");
      expect(c.stdout.join("\n")).toContain(status);
      expect(c.stdout.join("\n")).not.toContain("https://mcp.example");
    }
  );

  it("shows discovery-specific help without making a request", async () => {
    const c = capture();
    expect(await runCli(["doctor", "discover", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("doctor discover <url>");
  });
  it("runs the real CLI discovery path against an explicitly approved local endpoint", async () => {
    const methods: unknown[] = [];
    const server = createServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        methods.push(JSON.parse(body).method);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ jsonrpc: "2.0", id: "discover-1", result: {
          resultType: "complete", supportedVersions: ["2026-07-28"],
          capabilities: {}, ttlMs: 0, cacheScope: "private"
        } }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const c = capture();
      const port = (server.address() as AddressInfo).port;
      expect(await runCli(["doctor", "discover", `http://localhost:${port}/mcp`, "--allow-network", "--allow-local-network", "--json"], c.io)).toBe(0);
      expect(JSON.parse(c.stdout.join("\n"))).toMatchObject({ status: "discovered", scope: "discovery-only", coverage: { runtime: "not-tested" } });
      expect(methods).toEqual(["server/discover"]);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
