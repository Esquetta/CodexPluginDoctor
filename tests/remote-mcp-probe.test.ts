import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { probeRemoteMcpServer } from "../src/core/remote-mcp-probe.js";
import type { RemoteLookup } from "../src/core/remote-network-policy.js";

const servers: Server[] = [];
const openResponses: ServerResponse[] = [];

afterEach(async () => {
  openResponses.splice(0).forEach((response) => response.destroy());
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function startServer(handler: Parameters<typeof createServer>[0]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function localLookup(): RemoteLookup {
  return async () => [{ address: "127.0.0.1", family: 4 }];
}

function options(port: number) {
  return {
    allowNetwork: true,
    allowLocalNetwork: true,
    lookup: localLookup(),
    requestTimeoutMs: 100,
    url: `http://localhost:${port}/mcp`
  };
}

function initializedResponse(id: number) {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: "2025-11-25",
      capabilities: {},
      serverInfo: { name: "test", version: "1.0.0" }
    }
  });
}

function assertPrivate(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of [
    "session-secret-sentinel",
    "query-secret-sentinel",
    "credential-secret-sentinel",
    "challenge-secret-sentinel"
  ]) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe("probeRemoteMcpServer", () => {
  it("initializes with bounded JSON and sends initialized to the same endpoint", async () => {
    const requests: Array<{ method: string; headers: Record<string, string | string[] | undefined>; body: string }> = [];
    const port = await startServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method ?? "", headers: request.headers, body });
        const message = JSON.parse(body) as { id?: number; method: string };
        if (message.method === "initialize") {
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "mcp-session-id": "session-secret-sentinel"
          });
          response.end(initializedResponse(message.id ?? 1));
          return;
        }
        response.writeHead(202);
        response.end();
      });
    });

    const result = await probeRemoteMcpServer("remote", options(port).url, options(port));

    expect(result.findings).toEqual([]);
    expect(result.scorecard).toEqual({
      transport: "pass",
      networkSafety: "pass",
      initialize: "pass",
      contentType: "pass",
      session: "present-valid",
      protocolHeaders: "pass",
      authorization: "skipped",
      overall: "pass"
    });
    expect(requests).toHaveLength(2);
    expect(requests.map((request) => request.method)).toEqual(["POST", "POST"]);
    expect(requests.map((request) => JSON.parse(request.body).method)).toEqual([
      "initialize",
      "notifications/initialized"
    ]);
    expect(requests[0]?.headers.accept).toBe("application/json, text/event-stream");
    expect(requests[0]?.headers["content-type"]).toBe("application/json");
    expect(requests[0]?.headers.authorization).toBeUndefined();
    expect(requests[0]?.headers.cookie).toBeUndefined();
    expect(requests[1]?.headers["mcp-protocol-version"]).toBe("2025-11-25");
    expect(requests[1]?.headers["mcp-session-id"]).toBe("session-secret-sentinel");
    assertPrivate(result);
  });

  it("uses the first complete SSE event without waiting for the stream to close", async () => {
    const port = await startServer((request, response) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        const message = JSON.parse(body) as { id?: number; method: string };
        if (message.method === "initialize") {
          response.writeHead(200, { "content-type": "text/event-stream" });
          response.write(`event: message\ndata: ${initializedResponse(message.id ?? 1)}\n\n`);
          openResponses.push(response);
          return;
        }
        response.writeHead(202);
        response.end();
      });
    });

    const result = await probeRemoteMcpServer("remote", options(port).url, options(port));

    expect(result.findings).toEqual([]);
    expect(result.scorecard.initialize).toBe("pass");
    expect(result.scorecard.contentType).toBe("pass");
  });

  it("fails without network approval before issuing a request", async () => {
    let requested = false;

    const result = await probeRemoteMcpServer("remote", "https://mcp.example/mcp", {
      request: async () => {
        requested = true;
        throw new Error("must not run");
      }
    });

    expect(requested).toBe(false);
    expect(result.scorecard.networkSafety).toBe("fail");
    expect(result.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.network_not_approved", severity: "fail" })
    ]);
  });

  it.each([
    ["an invalid content type", "text/plain", initializedResponse(1), "plugin.runtime.remote.content_type.invalid"],
    ["malformed JSON-RPC", "application/json", "{", "plugin.runtime.remote.initialize.invalid"]
  ])("fails %s deterministically", async (_name, contentType, body, findingId) => {
    const port = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": contentType });
      response.end(body);
    });

    const result = await probeRemoteMcpServer("remote", options(port).url, options(port));

    expect(result.findings).toEqual([
      expect.objectContaining({ id: findingId, severity: "fail" })
    ]);
  });

  it("fails a stalled or oversized bounded response", async () => {
    const stalledPort = await startServer(() => undefined);
    const stalled = await probeRemoteMcpServer("stalled", options(stalledPort).url, options(stalledPort));
    expect(stalled.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.transport.timeout", severity: "fail" })
    ]);

    const oversizedPort = await startServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("x".repeat(1_024 * 1_024 + 1));
    });
    const oversized = await probeRemoteMcpServer("oversized", options(oversizedPort).url, options(oversizedPort));
    expect(oversized.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.transport.response_too_large", severity: "fail" })
    ]);
  });

  it("records authorization as not ready without retaining challenge values", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(401, {
        "content-type": "application/json",
        "www-authenticate": 'Bearer realm="challenge-secret-sentinel"'
      });
      response.end();
    });

    const result = await probeRemoteMcpServer("remote", options(port).url, options(port));

    expect(result.scorecard.authorization).toBe("warn");
    expect(result.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.authorization.not_ready", severity: "warn" })
    ]);
    assertPrivate(result);
  });

  it("fails an unexpected HTTP status without exposing response details", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(500, { "content-type": "application/json" });
      response.end('{"error":"credential-secret-sentinel"}');
    });

    const result = await probeRemoteMcpServer("remote", options(port).url, options(port));

    expect(result.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.http_status.invalid", severity: "fail" })
    ]);
    assertPrivate(result);
  });

  it.each([
    "https://credential-secret-sentinel@safe.example/mcp",
    "https://safe.example/mcp?token=query-secret-sentinel"
  ])("rejects unsafe URLs without retaining their sensitive component", async (url) => {
    const result = await probeRemoteMcpServer("remote", url, { allowNetwork: true });

    expect(result.scorecard.networkSafety).toBe("fail");
    assertPrivate(result);
  });

  it("rejects an invalid session header without retaining it", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "application/json",
        "mcp-session-id": "invalid session-secret-sentinel"
      });
      response.end(initializedResponse(1));
    });

    const result = await probeRemoteMcpServer("remote", options(port).url, options(port));

    expect(result.scorecard.session).toBe("present-invalid");
    expect(result.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.session.invalid", severity: "fail" })
    ]);
    assertPrivate(result);
  });
});
