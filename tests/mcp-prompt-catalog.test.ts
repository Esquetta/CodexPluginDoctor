import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import { captureMcpPromptCatalog, captureStdioMcpPromptCatalog } from "../src/core/mcp-prompt-catalog.js";
import { resolveMcpStdioServer } from "../src/core/mcp-stdio-tool-catalog.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";
import { violations } from "./helpers/json-schema-violations.js";

const catalogSchema = buildDoctorOutputContract().schemas.find((schema) => schema.id === "doctor.prompts.json")!.schema as Record<string, unknown>;

function response(body: unknown): BoundedHttpResponse {
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) };
}

function discoveryResponse(capabilities: Record<string, unknown> = { prompts: {} }): BoundedHttpResponse {
  return response({
    jsonrpc: "2.0", id: "discover-1", result: {
      resultType: "complete", supportedVersions: ["2026-07-28"], capabilities, ttlMs: 0, cacheScope: "public"
    }
  });
}

function promptsResponse(id: string, prompts: unknown[], extra: Record<string, unknown> = {}): BoundedHttpResponse {
  return response({ jsonrpc: "2.0", id, result: { resultType: "complete", prompts, ttlMs: 30_000, cacheScope: "public", ...extra } });
}

const review = { name: "code_review", arguments: [{ name: "code", required: true }] };
const network = { allowNetwork: true };

describe("captureMcpPromptCatalog", () => {
  it("enumerates paged prompts/list results and never retrieves a prompt", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(promptsResponse("prompts-list-1", [review], { nextCursor: "next" }))
      .mockResolvedValueOnce(promptsResponse("prompts-list-2", [{ name: "summarize" }], { ttlMs: 1_000, cacheScope: "private" }));

    const snapshot = await captureMcpPromptCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(snapshot.report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      scope: "prompt-catalog-structure",
      status: "pass",
      catalog: { complete: true, pagesRead: 2, promptsChecked: 2, reason: null },
      coverage: { discovery: "pass", catalogEnumeration: "complete", definitions: "shape-only", promptRetrieval: "not-tested", fullConformance: "not-tested" },
      findings: []
    }));
    expect(snapshot.report).not.toHaveProperty("transport");
    expect(snapshot.prompts).toEqual([review, { name: "summarize" }]);
    expect(snapshot.cache).toEqual({ ttlMs: 1_000, cacheScope: "private" });
    const bodies = request.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body));
    expect(bodies.map((body) => [body.method, body.params.cursor])).toEqual([["prompts/list", undefined], ["prompts/list", "next"]]);
    expect(request.mock.calls[1][1].headers["Mcp-Method"]).toBe("prompts/list");
  });

  it("reports definition findings with prompt locations", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(promptsResponse("prompts-list-1", [review, { name: "code_review", arguments: [{ name: "a" }, { name: "a" }] }]));

    const { report, prompts } = await captureMcpPromptCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(report.status).toBe("fail");
    expect(violations(catalogSchema, report)).toEqual([]);
    expect(report.findings.map((finding) => [finding.id, finding.location])).toEqual([
      ["plugin.catalog.prompt.argument.name.duplicate", { page: 1, promptIndex: 2, argumentIndex: 2, relatedArgumentIndex: 1 }],
      ["plugin.catalog.prompt.name.duplicate", { page: 1, promptIndex: 2, relatedPromptIndex: 1 }]
    ]);
    expect(prompts).toHaveLength(2);
  });

  it("is not applicable to a server without the prompts capability", async () => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse({ tools: {} }));

    const snapshot = await captureMcpPromptCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(snapshot).toMatchObject({ report: { status: "not-applicable", catalog: { promptsChecked: 0 } }, prompts: null, cache: null });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("words list findings for prompts", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "prompts-list-1", error: { code: -32601, message: "Method not found" } }));

    const { report } = await captureMcpPromptCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(report).toMatchObject({ status: "incomplete", catalog: { reason: "prompts-list-method-unsupported" } });
    expect(report.findings).toEqual([expect.objectContaining({
      id: "plugin.catalog.prompts_list.method_unsupported",
      message: "The endpoint advertised prompts but does not implement prompts/list.",
      suggestedFix: "Implement prompts/list for the advertised modern MCP prompts capability."
    })]);
  });

  it("rejects a page without a prompts array", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "prompts-list-1", result: { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "public" } }));

    const { report } = await captureMcpPromptCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(report.findings).toEqual([expect.objectContaining({
      id: "plugin.catalog.response.invalid",
      message: "The endpoint returned an invalid prompts/list response.",
      suggestedFix: "Return a matching JSON-RPC complete result with valid prompts and cache metadata."
    })]);
  });
});

describe("captureStdioMcpPromptCatalog", () => {
  const fixtureRoot = path.resolve("tests", "fixtures", "stdio-prompt-catalog");
  const fast = { startupMs: 3_000, requestMs: 3_000, shutdownMs: 1_000 };

  async function capture(name: string) {
    const resolved = await resolveMcpStdioServer(fixtureRoot, name, "prompts");
    if (!resolved.ok) throw new Error(resolved.message);
    const methods: string[] = [];
    const spawnImpl = ((command: string, args: readonly string[], options: object) => {
      const child = spawn(command, args, options);
      const write = child.stdin!.write.bind(child.stdin!);
      child.stdin!.write = ((chunk: string, ...rest: never[]) => {
        methods.push(...String(chunk).split("\n").filter(Boolean).map((line) => JSON.parse(line).method as string));
        return write(chunk, ...rest);
      }) as typeof child.stdin.write;
      return child;
    }) as unknown as typeof spawn;
    return { snapshot: await captureStdioMcpPromptCatalog(resolved.server, { timeouts: fast, spawnImpl }), methods };
  }

  it("reads a modern stdio server's prompt list", async () => {
    const { snapshot, methods } = await capture("modern");

    expect(snapshot.report).toMatchObject({
      scope: "prompt-catalog-structure",
      transport: "stdio",
      status: "pass",
      protocol: { era: "modern", version: "2026-07-28" },
      execution: { backend: "native" },
      catalog: { complete: true, pagesRead: 1, promptsChecked: 2, reason: null }
    });
    expect(snapshot.prompts?.map((prompt) => (prompt as { name: string }).name)).toEqual(["code_review", "summarize"]);
    expect(snapshot.cache).toEqual({ ttlMs: 60_000, cacheScope: "public" });
    expect(methods).toEqual(["server/discover", "prompts/list"]);
    expect(violations(catalogSchema, snapshot.report)).toEqual([]);
  });

  it("reads a legacy stdio server's prompt list with conservative cache metadata", async () => {
    const { snapshot, methods } = await capture("legacy");

    expect(snapshot.report).toMatchObject({ status: "pass", protocol: { era: "legacy", version: "2025-11-25" }, catalog: { complete: true, promptsChecked: 2 } });
    expect(snapshot.cache).toEqual({ ttlMs: 0, cacheScope: "private" });
    expect(methods).toEqual(["server/discover", "initialize", "notifications/initialized", "prompts/list"]);
  });

  it("is not applicable without the prompts capability and reports a missing prompts/list", async () => {
    expect((await capture("modern-no-prompts")).snapshot).toMatchObject({ report: { status: "not-applicable" }, prompts: null });

    const missing = (await capture("modern-prompts-list-missing")).snapshot.report;
    expect(missing).toMatchObject({ status: "incomplete", catalog: { reason: "prompts-list-method-unsupported" } });
    expect(missing.findings).toEqual([expect.objectContaining({
      message: "The MCP server advertised prompts but does not implement prompts/list.",
      suggestedFix: "Implement prompts/list for the advertised MCP prompts capability."
    })]);
  });
});
