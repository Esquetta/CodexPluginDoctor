import { describe, expect, it, vi } from "vitest";

import { captureMcpToolCatalog, inspectMcpToolCatalog } from "../src/core/mcp-tool-catalog.js";
import { BoundedHttpError, type BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import { RemoteNetworkPolicyError } from "../src/core/remote-network-policy.js";

const requestedVersion = "2026-07-28";

function response(body: unknown): BoundedHttpResponse {
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(body))
  };
}

function discoveryResponse(capabilities: Record<string, unknown> = { tools: {} }): BoundedHttpResponse {
  return response({
    jsonrpc: "2.0", id: "discover-1", result: {
      resultType: "complete", supportedVersions: [requestedVersion], capabilities, ttlMs: 0, cacheScope: "public"
    }
  });
}

function toolsResponse(id: string, tools: unknown[] = [], nextCursor?: unknown): BoundedHttpResponse {
  return response({
    jsonrpc: "2.0", id, result: {
      resultType: "complete", tools, ttlMs: 0, cacheScope: "public", ...(nextCursor === undefined ? {} : { nextCursor })
    }
  });
}

function nextCursorResponse(id: string, tools: unknown[] = [], nextCursor?: unknown, statusCode = 200): BoundedHttpResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify({
      jsonrpc: "2.0", id, result: {
        resultType: "complete", tools, ttlMs: 0, cacheScope: "public", ...(nextCursor === undefined ? {} : { nextCursor })
      }
    }))
  };
}

function validTool(name = "echo"): Record<string, unknown> {
  return { name, inputSchema: { type: "object" } };
}

function assertRedacted(value: unknown): void {
  expect(JSON.stringify(value)).not.toContain("secret-sentinel");
}

function paddedResponse(body: unknown, bytes: number): BoundedHttpResponse {
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded) > bytes) throw new Error("test padding target is too small");
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(encoded.padEnd(bytes, " ")) };
}

describe("inspectMcpToolCatalog", () => {
  it("makes zero requests without explicit network consent", async () => {
    const request = vi.fn();

    const result = await inspectMcpToolCatalog("https://secret-sentinel.example/mcp", { request });

    expect(result).toMatchObject({ status: "blocked", catalog: { reason: "network-blocked" }, coverage: { catalogEnumeration: "not-tested" } });
    expect(request).not.toHaveBeenCalled();
    assertRedacted(result);
  });

  it("inspects a complete one-page tool catalog after one discovery request", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(response({
        jsonrpc: "2.0", id: "discover-1", result: {
          resultType: "complete", supportedVersions: [requestedVersion], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "public"
        }
      }))
      .mockResolvedValueOnce(response({
        jsonrpc: "2.0", id: "tools-list-1", result: {
          resultType: "complete", tools: [{ name: "echo", inputSchema: { type: "object" } }], ttlMs: 0, cacheScope: "public"
        }
      }));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({
      schemaVersion: 1,
      scope: "tool-catalog-structure",
      status: "pass",
      catalog: { complete: true, pagesRead: 1, toolsChecked: 1, reason: null },
      coverage: {
        discovery: "pass", catalogEnumeration: "complete", schema: "root-shape-only",
        toolExecution: "not-tested", fullConformance: "not-tested", customHeaderAnnotations: "not-tested"
      },
      findings: []
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(request.mock.calls[1][1].body as string)).toMatchObject({
      jsonrpc: "2.0", id: "tools-list-1", method: "tools/list"
    });
  });

  it("enumerates continuation cursors opaquely across pages", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [validTool("first")], ""))
      .mockResolvedValueOnce(toolsResponse("tools-list-2", [validTool("second")]));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "pass", catalog: { complete: true, pagesRead: 2, toolsChecked: 2, reason: null } });
    expect(JSON.parse(request.mock.calls[2][1].body as string).params.cursor).toBe("");
  });

  it("uses the MCP nextCursor result field and sends it back as cursor", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(nextCursorResponse("tools-list-1", [validTool("first")], "opaque-next"))
      .mockResolvedValueOnce(nextCursorResponse("tools-list-2", [validTool("second")]));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "pass", catalog: { complete: true, pagesRead: 2, toolsChecked: 2 } });
    expect(JSON.parse(request.mock.calls[2][1].body as string).params.cursor).toBe("opaque-next");
  });

  it("does not enumerate when discovery did not advertise tools", async () => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse({ resources: {} }));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({
      status: "not-applicable", catalog: { complete: false, pagesRead: 0, toolsChecked: 0, reason: null },
      coverage: { discovery: "pass", catalogEnumeration: "not-tested" }
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("preserves unsupported discovery without attempting tools/list", async () => {
    const request = vi.fn().mockResolvedValue(response({
      jsonrpc: "2.0", id: "discover-1", error: { code: -32601, message: "secret-sentinel" }
    }));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "unsupported", catalog: { reason: "discovery-unsupported" } });
    expect(request).toHaveBeenCalledTimes(1);
    assertRedacted(result);
  });

  it("keeps malformed tool findings but stops on a malformed page", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [{ name: 7, inputSchema: null }], "next"))
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "wrong-id", result: { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "public" } }));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { complete: false, pagesRead: 1, toolsChecked: 1, reason: "response-invalid" } });
    expect(result.findings.map((item) => item.id)).toEqual(expect.arrayContaining([
      "plugin.catalog.tool.name.invalid", "plugin.catalog.schema.input.invalid", "plugin.catalog.response.invalid"
    ]));
  });

  it("reports an advertised tools capability without tools/list as incomplete", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "tools-list-1", error: { code: -32601, message: "secret-sentinel" } }));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { reason: "tools-list-method-unsupported" } });
    expect(result.findings.map((item) => item.id)).toContain("plugin.catalog.tools_list.method_unsupported");
    assertRedacted(result);
  });

  it("recognizes a matching tools/list unknown-method response on HTTP 404", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce({
        statusCode: 404,
        headers: { "content-type": "application/json" },
        body: Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: "tools-list-1", error: { code: -32601, message: "secret-sentinel" } }))
      });

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { reason: "tools-list-method-unsupported" } });
    expect(result.findings.map((item) => item.id)).toContain("plugin.catalog.tools_list.method_unsupported");
    assertRedacted(result);
  });

  it("rejects a non-200 response even when its result body appears valid", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(nextCursorResponse("tools-list-1", [validTool()], undefined, 500));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { complete: false, reason: "http-status-invalid" } });
    expect(result.findings.map((item) => item.id)).toContain("plugin.catalog.http_status.invalid");
  });

  it("rejects an unknown-method error with a mismatched JSON-RPC id", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "wrong-id", error: { code: -32601, message: "secret-sentinel" } }));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { reason: "response-invalid" } });
    expect(result.findings.map((item) => item.id)).toContain("plugin.catalog.response.invalid");
    assertRedacted(result);
  });

  it.each([
    ["a response with both result and error", { jsonrpc: "2.0", id: "tools-list-1", result: {}, error: { code: -32601, message: "secret-sentinel" } }],
    ["a malformed error", { jsonrpc: "2.0", id: "tools-list-1", error: { code: "-32601", message: "secret-sentinel" } }],
    ["a non-string nextCursor", { jsonrpc: "2.0", id: "tools-list-1", result: { resultType: "complete", tools: [], nextCursor: 7, ttlMs: 0, cacheScope: "public" } }]
  ])("rejects %s without leaking remote response text", async (_caseName, body) => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse()).mockResolvedValueOnce(response(body));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { reason: "response-invalid" } });
    expect(result.findings.map((item) => item.id)).toContain("plugin.catalog.response.invalid");
    assertRedacted(result);
  });

  it("detects a repeated cursor without making another list request", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [], "a"))
      .mockResolvedValueOnce(toolsResponse("tools-list-2", [], "a"));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 2, reason: "cursor-loop" } });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("detects a cursor cycle after distinct cursors", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [], "a"))
      .mockResolvedValueOnce(toolsResponse("tools-list-2", [], "b"))
      .mockResolvedValueOnce(toolsResponse("tools-list-3", [], "a"));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 3, reason: "cursor-loop" } });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("treats authorization at discovery and on a later page as incomplete", async () => {
    const discoveryAuth = await inspectMcpToolCatalog("https://mcp.example/mcp", {
      allowNetwork: true,
      request: vi.fn().mockResolvedValue({ statusCode: 401, headers: { "content-type": "application/json" }, body: Buffer.from("secret-sentinel") })
    });
    const pageAuthRequest = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [validTool()], "next"))
      .mockResolvedValueOnce({ statusCode: 403, headers: { "content-type": "application/json" }, body: Buffer.from("secret-sentinel") });
    const pageAuth = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request: pageAuthRequest });

    expect(discoveryAuth).toMatchObject({ status: "incomplete", catalog: { reason: "authorization-required" } });
    expect(pageAuth).toMatchObject({ status: "incomplete", catalog: { pagesRead: 1, reason: "authorization-required" } });
    assertRedacted([discoveryAuth, pageAuth]);
  });

  it("stops before a sixth tools/list page", async () => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse());
    for (let page = 1; page <= 5; page += 1) request.mockResolvedValueOnce(toolsResponse(`tools-list-${page}`, [], `cursor-${page}`));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 5, toolsChecked: 0, reason: "page-limit" } });
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("completes when the fifth tools/list page is final", async () => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse());
    for (let page = 1; page <= 5; page += 1) request.mockResolvedValueOnce(toolsResponse(`tools-list-${page}`, [], page < 5 ? `cursor-${page}` : undefined));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "pass", catalog: { complete: true, pagesRead: 5, toolsChecked: 0, reason: null } });
    expect(request).toHaveBeenCalledTimes(6);
  });

  it("stops after the 500th tool without claiming a complete catalog", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", Array.from({ length: 501 }, (_, index) => validTool(`tool-${index}`))));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 1, toolsChecked: 500, reason: "tool-limit" } });
  });

  it("accepts a complete page containing exactly 500 tools", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", Array.from({ length: 500 }, (_, index) => validTool(`tool-${index}`))));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "pass", catalog: { complete: true, pagesRead: 1, toolsChecked: 500, reason: null } });
  });

  it("keeps the first 100 findings when the finding budget is exhausted", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", Array.from({ length: 101 }, () => ({ inputSchema: {} }))));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { toolsChecked: 101, reason: "finding-limit" } });
    expect(result.findings).toHaveLength(100);
  });

  it("completes an inspected catalog with exactly 100 findings", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", Array.from({ length: 100 }, () => ({ inputSchema: {} }))));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "fail", catalog: { complete: true, toolsChecked: 100, reason: null } });
    expect(result.findings).toHaveLength(100);
  });

  it("does not hide the finding limit when a later cursor diagnostic would exceed it", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", Array.from({ length: 100 }, () => ({ inputSchema: {} })), "a"))
      .mockResolvedValueOnce(toolsResponse("tools-list-2", [], "a"));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 2, reason: "finding-limit" } });
    expect(result.findings).toHaveLength(100);
    expect(result.findings.map((item) => item.id)).not.toContain("plugin.catalog.cursor.loop");
  });

  it("checks exact duplicate names including prototype-like names without treating case variants as duplicates", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [validTool("__proto__"), validTool("__proto__"), validTool("Echo"), validTool("echo")]));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "warn", catalog: { complete: true, toolsChecked: 4 } });
    expect(result.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "plugin.catalog.tool.name.duplicate", location: { page: 1, toolIndex: 2, relatedToolIndex: 1 } })
    ]));
    expect(JSON.stringify(result)).not.toContain("__proto__");
  });

  it("counts response bytes across discovery and pages before issuing another request", async () => {
    const oneMiB = 1024 * 1024;
    const discovery = {
      jsonrpc: "2.0", id: "discover-1", result: {
        resultType: "complete", supportedVersions: [requestedVersion], capabilities: { tools: {} }, ttlMs: 0, cacheScope: "public"
      }
    };
    const page = (id: string, nextCursor: string) => ({
      jsonrpc: "2.0", id, result: { resultType: "complete", tools: [], nextCursor, ttlMs: 0, cacheScope: "public" }
    });
    const request = vi.fn()
      .mockResolvedValueOnce(paddedResponse(discovery, oneMiB))
      .mockResolvedValueOnce(paddedResponse(page("tools-list-1", "a"), oneMiB))
      .mockResolvedValueOnce(paddedResponse(page("tools-list-2", "b"), oneMiB))
      .mockResolvedValueOnce(paddedResponse(page("tools-list-3", "c"), oneMiB));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 3, reason: "total-response-byte-limit" } });
    expect(request).toHaveBeenCalledTimes(4);
  });

  it("enforces the one MiB response limit for a request implementation that does not", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(paddedResponse({
        jsonrpc: "2.0", id: "tools-list-1", result: { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "public" }
      }, 1024 * 1024 + 1));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 0, reason: "response-byte-limit" } });
    expect(request.mock.calls[1][1].maxResponseBytes).toBe(1024 * 1024);
  });

  it("does not round a sub-millisecond remaining deadline up to a request", async () => {
    let currentTime = 0;
    const request = vi.fn(async () => {
      currentTime = 14_999.5;
      return discoveryResponse();
    });

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request, now: () => currentTime });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 0, reason: "total-time-limit" } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not report an empty page as complete after its post-parse deadline expires", async () => {
    let currentTime = 0;
    const request = vi.fn(async () => {
      if (request.mock.calls.length === 2) currentTime = 15_000;
      return request.mock.calls.length === 1 ? discoveryResponse() : toolsResponse("tools-list-1", []);
    });

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request, now: () => currentTime });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 1, toolsChecked: 0, reason: "total-time-limit" } });
  });

  it("stops when the overall deadline expires during tool inspection", async () => {
    let currentTime = 0;
    const request = vi.fn(async () => {
      if (request.mock.calls.length === 2) currentTime = 15_000;
      return request.mock.calls.length === 1 ? discoveryResponse() : toolsResponse("tools-list-1", [validTool()]);
    });

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request, now: () => currentTime });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 1, toolsChecked: 1, reason: "total-time-limit" } });
  });

  it("selects only the matching JSON-RPC event from an SSE response", async () => {
    const matching = JSON.stringify({
      jsonrpc: "2.0", id: "tools-list-1", result: { resultType: "complete", tools: [validTool()], ttlMs: 0, cacheScope: "public" }
    });
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: { "content-type": "text/event-stream" },
        body: Buffer.from(`data: ${JSON.stringify({ jsonrpc: "2.0", id: "other", result: { secret: "secret-sentinel" } })}\n\ndata: ${matching}\n\n`)
      });

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "pass", catalog: { pagesRead: 1, toolsChecked: 1 } });
    assertRedacted(result);
  });

  it("stops as blocked when a later page is rejected by remote network policy", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockRejectedValueOnce(new RemoteNetworkPolicyError("REMOTE_TARGET_FORBIDDEN", "secret-sentinel"));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "blocked", catalog: { complete: false, pagesRead: 0, reason: "network-blocked" } });
    assertRedacted(result);
  });

  it("keeps a transport timeout incomplete without starting another request", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockRejectedValueOnce(new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "secret-sentinel"));

    const result = await inspectMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { pagesRead: 0, reason: "request-timeout" } });
    expect(request).toHaveBeenCalledTimes(2);
    assertRedacted(result);
  });
});

describe("captureMcpToolCatalog", () => {
  function cachedToolsResponse(id: string, tools: unknown[], ttlMs: number, cacheScope: string, nextCursor?: string): BoundedHttpResponse {
    return response({
      jsonrpc: "2.0", id, result: { resultType: "complete", tools, ttlMs, cacheScope, ...(nextCursor === undefined ? {} : { nextCursor }) }
    });
  }

  it("returns every enumerated tool in order with the most conservative cache metadata", async () => {
    const malformed = { name: 7 };
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(cachedToolsResponse("tools-list-1", [validTool("first"), malformed], 60_000, "public", "next"))
      .mockResolvedValueOnce(cachedToolsResponse("tools-list-2", [validTool("second")], 5_000, "private"));

    const snapshot = await captureMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(snapshot.report).toMatchObject({ status: "fail", catalog: { complete: true, pagesRead: 2, toolsChecked: 3 } });
    expect(snapshot.tools).toEqual([validTool("first"), malformed, validTool("second")]);
    expect(snapshot.cache).toEqual({ ttlMs: 5_000, cacheScope: "private" });
  });

  it("keeps a public scope only when every page is public", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(cachedToolsResponse("tools-list-1", [], 10, "public", "next"))
      .mockResolvedValueOnce(cachedToolsResponse("tools-list-2", [], 20, "public"));

    const snapshot = await captureMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(snapshot).toMatchObject({ tools: [], cache: { ttlMs: 10, cacheScope: "public" } });
  });

  it("returns no tools when enumeration does not complete", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [validTool("first")], "next"))
      .mockResolvedValueOnce({ statusCode: 401, headers: {}, body: Buffer.from("") });

    const snapshot = await captureMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(snapshot.report).toMatchObject({ status: "incomplete", catalog: { reason: "authorization-required" } });
    expect(snapshot).toMatchObject({ tools: null, cache: null });
  });

  it("returns no tools when the server does not advertise tools", async () => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse({}));

    const snapshot = await captureMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request });

    expect(snapshot).toMatchObject({ report: { status: "not-applicable" }, tools: null, cache: null });
  });
});

describe("captureMcpToolCatalog bearer tokens", () => {
  it("sends the bearer token with discovery and every tools/list page without reporting it", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(toolsResponse("tools-list-1", [validTool("first")], "next"))
      .mockResolvedValueOnce(toolsResponse("tools-list-2", [validTool("second")]));

    const snapshot = await captureMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request, bearerToken: "secret-sentinel" });

    expect(snapshot.report).toMatchObject({ status: "pass", catalog: { complete: true, pagesRead: 2 } });
    expect(request.mock.calls.map((call) => call[1].bearerToken)).toEqual(["secret-sentinel", "secret-sentinel", "secret-sentinel"]);
    assertRedacted(snapshot.report);
  });

  it("treats a rejected token as incomplete authorization", async () => {
    const request = vi.fn().mockResolvedValueOnce({ statusCode: 401, headers: {}, body: Buffer.from("") });

    const snapshot = await captureMcpToolCatalog("https://mcp.example/mcp", { allowNetwork: true, request, bearerToken: "secret-sentinel" });

    expect(snapshot).toMatchObject({ report: { status: "incomplete", catalog: { reason: "authorization-required" } }, tools: null });
    expect(snapshot.report.discovery.findings[0].id).toBe("plugin.discovery.authorization.rejected");
  });
});

describe("bearer token transport labels", () => {
  const insecure = () => new BoundedHttpError("REMOTE_HTTP_INSECURE_CREDENTIALS", "Remote HTTP bearer tokens require HTTPS or an approved loopback target.");

  it("reports a token refused at discovery as blocked for insecure transport", async () => {
    const request = vi.fn().mockRejectedValueOnce(insecure());

    const result = await inspectMcpToolCatalog("http://localhost:3000/mcp", { allowNetwork: true, allowLocalNetwork: true, bearerToken: "token", request });

    expect(result).toMatchObject({ status: "blocked", catalog: { reason: "credentials-insecure-transport" } });
  });

  it("reports a token refused on a later page as incomplete for insecure transport", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockRejectedValueOnce(insecure());

    const result = await inspectMcpToolCatalog("http://localhost:3000/mcp", { allowNetwork: true, allowLocalNetwork: true, bearerToken: "token", request });

    expect(result).toMatchObject({ status: "incomplete", catalog: { complete: false, reason: "credentials-insecure-transport" } });
  });
});
