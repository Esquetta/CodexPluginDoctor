import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

import { discoverMcpServer } from "../src/core/mcp-discovery.js";
import type { BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import type { RemoteLookup } from "../src/core/remote-network-policy.js";

const servers: Server[] = [];
const requestedVersion = "2026-07-28";

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

function completeResult(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: "discover-1",
    result: {
      resultType: "complete",
      supportedVersions: [requestedVersion],
      capabilities: {},
      ttlMs: 0,
      cacheScope: "public",
      ...overrides
    }
  });
}

function response(body: string, statusCode = 200, contentType = "application/json"): BoundedHttpResponse {
  return { statusCode, headers: { "content-type": contentType }, body: Buffer.from(body) };
}

function assertRedacted(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain("secret-sentinel");
}

async function startServer(handler: Parameters<typeof createServer>[0]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function localLookup(): RemoteLookup {
  return async () => [{ address: "127.0.0.1", family: 4 }];
}

describe("discoverMcpServer", () => {
  it("does not contact a server until network discovery is approved", async () => {
    const request = vi.fn();
    const result = await discoverMcpServer("https://secret-sentinel.example/mcp", { request });

    expect(result).toMatchObject({
      schemaVersion: 1, requestedVersion, scope: "discovery-only", status: "blocked", supportedVersions: [],
      coverage: { discovery: "skipped", runtime: "not-tested" }
    });
    expect(request).not.toHaveBeenCalled();
    assertRedacted(result);
  });

  it("blocks an unsafe endpoint before issuing a discovery request", async () => {
    const request = vi.fn();
    const result = await discoverMcpServer("https://safe.example/mcp?token=secret-sentinel", {
      allowNetwork: true, request
    });

    expect(result.status).toBe("blocked");
    expect(request).not.toHaveBeenCalled();
    assertRedacted(result);
  });

  it("sends one compliant discovery request and reports a supported complete result", async () => {
    const request = vi.fn(async () => response(completeResult({
      instructions: "secret-sentinel",
      _meta: { "io.modelcontextprotocol/serverInfo": { name: "secret-sentinel", version: "1.0.0" } }
    })));
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toEqual({
      schemaVersion: 1, requestedVersion, scope: "discovery-only", status: "discovered",
      supportedVersions: [requestedVersion], findings: [], coverage: { discovery: "pass", runtime: "not-tested" }
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("https://mcp.example/mcp", expect.objectContaining({
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream", "Content-Type": "application/json",
        "MCP-Protocol-Version": requestedVersion, "Mcp-Method": "server/discover"
      }
    }));
    const requestBody = JSON.parse(request.mock.calls[0][1].body as string);
    expect(requestBody).toMatchObject({
      jsonrpc: "2.0", id: "discover-1", method: "server/discover",
      params: { _meta: {
        "io.modelcontextprotocol/protocolVersion": requestedVersion,
        "io.modelcontextprotocol/clientCapabilities": {}
      } }
    });
    expect(requestBody.params._meta["io.modelcontextprotocol/clientInfo"].version).toMatch(/^\d+\.\d+\.\d+$/);
    assertRedacted(result);
  });

  it.each([
    ["a wrong response id", response(JSON.stringify({ jsonrpc: "2.0", id: "wrong-id", result: {} }))],
    ["malformed JSON", response("{")],
    ["a malformed complete result", response(completeResult({ supportedVersions: [], ttlMs: -1 }))],
    ["an invalid version", response(completeResult({ supportedVersions: ["not-a-date"] }))]
  ])("fails %s without exposing response data", async (_name, discoveryResponse) => {
    const result = await discoverMcpServer("https://mcp.example/mcp", {
      allowNetwork: true, request: async () => discoveryResponse
    });

    expect(result.status).toBe("failed");
    expect(result.coverage).toEqual({ discovery: "fail", runtime: "not-tested" });
    expect(result.findings).toHaveLength(1);
    assertRedacted(result);
  });

  it("reports a recognized unsupported protocol version without a fallback request", async () => {
    const request = vi.fn(async () => response(JSON.stringify({
      jsonrpc: "2.0", id: "discover-1",
      error: { code: -32022, message: "secret-sentinel", data: { supported: ["2025-11-25"], requested: requestedVersion } }
    }), 400));
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({
      status: "unsupported", supportedVersions: ["2025-11-25"],
      coverage: { discovery: "skipped", runtime: "not-tested" }, findings: [expect.objectContaining({ severity: "warn" })]
    });
    expect(request).toHaveBeenCalledTimes(1);
    assertRedacted(result);
  });

  it("reports an unknown discovery method as unsupported without a fallback request", async () => {
    const request = vi.fn(async () => response(JSON.stringify({
      jsonrpc: "2.0", id: "discover-1", error: { code: -32601, message: "secret-sentinel" }
    }), 404));
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result.status).toBe("unsupported");
    expect(result.supportedVersions).toEqual([]);
    expect(result.findings).toEqual([expect.objectContaining({ severity: "warn" })]);
    expect(request).toHaveBeenCalledTimes(1);
    assertRedacted(result);
  });

  it.each([401, 403])("reports HTTP %i authentication as unsupported without OAuth discovery", async (statusCode) => {
    const request = vi.fn(async () => response("secret-sentinel", statusCode));
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({
      status: "unsupported", coverage: { discovery: "skipped", runtime: "not-tested" },
      findings: [expect.objectContaining({ severity: "warn" })]
    });
    expect(request).toHaveBeenCalledTimes(1);
    assertRedacted(result);
  });


  it.each([
    ["a response containing both result and error", response(JSON.stringify({ jsonrpc: "2.0", id: "discover-1", result: {}, error: { code: -32601, message: "secret-sentinel" } }))],
    ["an invalid cache scope", response(completeResult({ cacheScope: "shared" }))],
    ["an invalid declared capability", response(completeResult({ capabilities: { tools: "secret-sentinel" } }))],
    ["a negative cache lifetime", response(completeResult({ ttlMs: -1 }))],
    ["an impossible date", response(completeResult({ supportedVersions: ["2026-02-29"] }))],
    ["duplicate versions", response(completeResult({ supportedVersions: [requestedVersion, requestedVersion] }))],
    ["too many versions", response(completeResult({ supportedVersions: Array.from({ length: 33 }, (_value, index) => new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)) }))],
    ["a mismatched unsupported-version request", response(JSON.stringify({ jsonrpc: "2.0", id: "discover-1", error: { code: -32022, message: "secret-sentinel", data: { supported: ["2025-11-25"], requested: "2025-11-25" } } }), 400)],
    ["an error without a JSON-RPC message", response(JSON.stringify({ jsonrpc: "2.0", id: "discover-1", error: { code: -32601 } }), 404)],
    ["malformed optional server identity metadata", response(completeResult({ _meta: { "io.modelcontextprotocol/serverInfo": { name: "secret-sentinel" } } }))],
    ["an unexpected server error", response('{"error":"secret-sentinel"}', 500)]
  ])("fails %s without exposing untrusted payload fields", async (_name, discoveryResponse) => {
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request: async () => discoveryResponse });

    expect(result.status).toBe("failed");
    expect(result.coverage).toEqual({ discovery: "fail", runtime: "not-tested" });
    assertRedacted(result);
  });

  it("accepts a legacy unknown-method JSON-RPC error without retrying", async () => {
    const request = vi.fn(async () => response(JSON.stringify({
      jsonrpc: "2.0", id: "discover-1", error: { code: -32601, message: "secret-sentinel" }
    })));
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result.status).toBe("unsupported");
    expect(request).toHaveBeenCalledTimes(1);
    assertRedacted(result);
  });

  it("blocks private DNS targets by default", async () => {
    const result = await discoverMcpServer("http://localhost:1/mcp", {
      allowNetwork: true,
      lookup: localLookup()
    });

    expect(result).toMatchObject({ status: "blocked", coverage: { discovery: "skipped", runtime: "not-tested" } });
  });

  it("maps bounded timeout, oversized response, and redirect failures without following up", async () => {
    const stalledPort = await startServer(() => undefined);
    const timeout = await discoverMcpServer(`http://localhost:${stalledPort}/mcp`, {
      allowNetwork: true, allowLocalNetwork: true, lookup: localLookup(), requestTimeoutMs: 20
    });
    expect(timeout).toMatchObject({ status: "failed", findings: [expect.objectContaining({ id: "plugin.discovery.transport.timeout" })] });

    const oversizedPort = await startServer((_request, serverResponse) => {
      serverResponse.writeHead(200, { "content-type": "application/json" });
      serverResponse.end("x".repeat(1_024 * 1_024 + 1));
    });
    const oversized = await discoverMcpServer(`http://localhost:${oversizedPort}/mcp`, {
      allowNetwork: true, allowLocalNetwork: true, lookup: localLookup()
    });
    expect(oversized.status).toBe("failed");

    const redirectPort = await startServer((_request, serverResponse) => {
      serverResponse.writeHead(302, { location: "https://secret-sentinel.example/mcp" });
      serverResponse.end();
    });
    const redirected = await discoverMcpServer(`http://localhost:${redirectPort}/mcp`, {
      allowNetwork: true, allowLocalNetwork: true, lookup: localLookup()
    });
    expect(redirected.status).toBe("failed");
    assertRedacted(redirected);
  });
  it("accepts the matching complete JSON-RPC response from a bounded SSE stream", async () => {
    const sse = [
      "event: message\n",
      'data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\n',
      `data: ${completeResult()}\n\n`
    ].join("");
    const request = vi.fn(async () => response(sse, 200, "text/event-stream"));
    const result = await discoverMcpServer("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result.status).toBe("discovered");
    expect(request.mock.calls[0][1].stopAfter(Buffer.from(sse))).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("uses the bounded HTTP path with protocol headers when local networking is explicitly allowed", async () => {
    const port = await startServer((request, serverResponse) => {
      expect(request.method).toBe("POST");
      expect(request.headers["mcp-protocol-version"]).toBe(requestedVersion);
      expect(request.headers["mcp-method"]).toBe("server/discover");
      expect(request.headers["mcp-name"]).toBeUndefined();
      serverResponse.writeHead(200, { "content-type": "application/json" });
      serverResponse.end(completeResult());
    });
    const result = await discoverMcpServer(`http://localhost:${port}/mcp`, {
      allowNetwork: true, allowLocalNetwork: true, lookup: localLookup()
    });

    expect(result.status).toBe("discovered");
  });
});
