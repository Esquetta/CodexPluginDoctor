import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import { captureMcpResourceTemplateCatalog, captureStdioMcpResourceTemplateCatalog } from "../src/core/mcp-resource-template-catalog.js";
import { resolveMcpStdioServer } from "../src/core/mcp-stdio-tool-catalog.js";

function response(body: unknown): BoundedHttpResponse {
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) };
}

function discoveryResponse(capabilities: Record<string, unknown> = { resources: {} }): BoundedHttpResponse {
  return response({
    jsonrpc: "2.0", id: "discover-1", result: {
      resultType: "complete", supportedVersions: ["2026-07-28"], capabilities, ttlMs: 0, cacheScope: "public"
    }
  });
}

function templatesResponse(id: string, resourceTemplates: unknown[], extra: Record<string, unknown> = {}): BoundedHttpResponse {
  return response({ jsonrpc: "2.0", id, result: { resultType: "complete", resourceTemplates, ttlMs: 30_000, cacheScope: "public", ...extra } });
}

const files = { uriTemplate: "file:///{path}", name: "project-files" };
const network = { allowNetwork: true };

describe("captureMcpResourceTemplateCatalog", () => {
  it("enumerates paged resources/templates/list results and never reads a resource", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(templatesResponse("resource-templates-list-1", [files], { nextCursor: "next" }))
      .mockResolvedValueOnce(templatesResponse("resource-templates-list-2", [{ uriTemplate: "db://{table}", name: "rows" }], { ttlMs: 1_000, cacheScope: "private" }));

    const snapshot = await captureMcpResourceTemplateCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(snapshot.report).toEqual(expect.objectContaining({
      schemaVersion: 1,
      scope: "resource-template-catalog-structure",
      status: "pass",
      catalog: { complete: true, pagesRead: 2, templatesChecked: 2, reason: null },
      coverage: { discovery: "pass", catalogEnumeration: "complete", definitions: "shape-only", resourceRead: "not-tested", fullConformance: "not-tested" },
      findings: []
    }));
    expect(snapshot.templates).toEqual([files, { uriTemplate: "db://{table}", name: "rows" }]);
    expect(snapshot.cache).toEqual({ ttlMs: 1_000, cacheScope: "private" });
    const bodies = request.mock.calls.slice(1).map(([, options]) => JSON.parse(options.body));
    expect(bodies.map((body) => [body.method, body.params.cursor])).toEqual([["resources/templates/list", undefined], ["resources/templates/list", "next"]]);
    expect(request.mock.calls[1][1].headers["Mcp-Method"]).toBe("resources/templates/list");
  });

  it("reports definition findings with template locations", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(templatesResponse("resource-templates-list-1", [files, { uriTemplate: "file:///{path", name: "project-files" }]));

    const { report } = await captureMcpResourceTemplateCatalog("https://mcp.example.com/mcp", { ...network, request });

    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => [finding.id, finding.location])).toEqual([
      ["plugin.catalog.resource_template.uri_template.invalid", { page: 1, templateIndex: 2 }],
      ["plugin.catalog.resource_template.name.duplicate", { page: 1, templateIndex: 2, relatedTemplateIndex: 1 }]
    ]);
  });

  it("is not applicable to a server without the resources capability", async () => {
    const request = vi.fn().mockResolvedValueOnce(discoveryResponse({ tools: {}, prompts: {} }));

    expect(await captureMcpResourceTemplateCatalog("https://mcp.example.com/mcp", { ...network, request }))
      .toMatchObject({ report: { status: "not-applicable", catalog: { templatesChecked: 0 } }, templates: null, cache: null });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("words list findings for resource templates", async () => {
    const unsupported = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "resource-templates-list-1", error: { code: -32601, message: "Method not found" } }));
    const { report } = await captureMcpResourceTemplateCatalog("https://mcp.example.com/mcp", { ...network, request: unsupported });
    expect(report).toMatchObject({ status: "incomplete", catalog: { reason: "resource-templates-list-method-unsupported" } });
    expect(report.findings).toEqual([{
      id: "plugin.catalog.resource_templates_list.method_unsupported", severity: "warn",
      message: "The endpoint advertised resources but does not implement resources/templates/list.",
      impact: "Resource template definitions cannot be enumerated from the advertised capability.",
      suggestedFix: "Implement resources/templates/list for the advertised modern MCP resources capability."
    }]);

    const invalid = vi.fn()
      .mockResolvedValueOnce(discoveryResponse())
      .mockResolvedValueOnce(response({ jsonrpc: "2.0", id: "resource-templates-list-1", result: { resultType: "complete", resources: [], ttlMs: 0, cacheScope: "public" } }));
    expect((await captureMcpResourceTemplateCatalog("https://mcp.example.com/mcp", { ...network, request: invalid })).report.findings).toEqual([expect.objectContaining({
      id: "plugin.catalog.response.invalid",
      message: "The endpoint returned an invalid resources/templates/list response.",
      impact: "The resource template catalog cannot be safely enumerated from this response.",
      suggestedFix: "Return a matching JSON-RPC complete result with valid resourceTemplates and cache metadata."
    })]);
  });
});

describe("captureStdioMcpResourceTemplateCatalog", () => {
  const fixtureRoot = path.resolve("tests", "fixtures", "stdio-resource-template-catalog");
  const fast = { startupMs: 3_000, requestMs: 3_000, shutdownMs: 1_000 };

  async function capture(name: string) {
    const resolved = await resolveMcpStdioServer(fixtureRoot, name, "resource-templates");
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
    return { snapshot: await captureStdioMcpResourceTemplateCatalog(resolved.server, { timeouts: fast, spawnImpl }), methods };
  }

  it("reads modern and legacy stdio servers' resource template lists", async () => {
    const modern = await capture("modern");
    expect(modern.snapshot.report).toMatchObject({
      scope: "resource-template-catalog-structure", transport: "stdio", status: "pass",
      protocol: { era: "modern", version: "2026-07-28" }, catalog: { complete: true, pagesRead: 1, templatesChecked: 2, reason: null }
    });
    expect(modern.methods).toEqual(["server/discover", "resources/templates/list"]);
    expect(modern.snapshot.cache).toEqual({ ttlMs: 60_000, cacheScope: "public" });

    const legacy = await capture("legacy");
    expect(legacy.snapshot.report).toMatchObject({ status: "pass", protocol: { era: "legacy", version: "2025-11-25" }, catalog: { templatesChecked: 2 } });
    expect(legacy.methods).toEqual(["server/discover", "initialize", "notifications/initialized", "resources/templates/list"]);
    expect(legacy.snapshot.cache).toEqual({ ttlMs: 0, cacheScope: "private" });
  });

  it("is not applicable without the resources capability and reports a missing resources/templates/list", async () => {
    expect((await capture("modern-no-resources")).snapshot).toMatchObject({ report: { status: "not-applicable" }, templates: null });

    const missing = (await capture("modern-templates-list-missing")).snapshot.report;
    expect(missing).toMatchObject({ status: "incomplete", catalog: { reason: "resource-templates-list-method-unsupported" } });
    expect(missing.findings).toEqual([expect.objectContaining({
      message: "The MCP server advertised resources but does not implement resources/templates/list.",
      suggestedFix: "Implement resources/templates/list for the advertised MCP resources capability."
    })]);
  });
});
