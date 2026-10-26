import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import { captureMcpSnapshot, captureStdioMcpSnapshot, saveMcpSnapshot, type McpSnapshot } from "../src/core/mcp-snapshot.js";
import { resolveMcpStdioServer } from "../src/core/mcp-stdio-tool-catalog.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";
import { DOCKER_RUNTIME_IMAGE } from "../src/core/runtime-sandbox.js";
import { renderMcpSnapshotReport } from "../src/reporting/render-mcp-snapshot-report.js";
import { violations } from "./helpers/json-schema-violations.js";

const snapshotSchema = buildDoctorOutputContract().schemas.find((schema) => schema.id === "doctor.mcp-snapshot.json")!.schema as Record<string, unknown>;
const fast = { startupMs: 3_000, requestMs: 3_000, shutdownMs: 1_000 };

function response(body: unknown): BoundedHttpResponse {
  return { statusCode: 200, headers: { "content-type": "application/json" }, body: Buffer.from(JSON.stringify(body)) };
}

// Answers discovery and each list by method, as a stateless HTTP server would.
function httpServer(capabilities: Record<string, unknown>, lists: Record<string, unknown[] | "error">, instructions?: string) {
  return vi.fn(async (_url: string, options: { body?: string }) => {
    const message = JSON.parse(options.body ?? "{}");
    if (message.method === "server/discover") {
      return response({
        jsonrpc: "2.0", id: message.id,
        result: { resultType: "complete", supportedVersions: ["2026-07-28"], capabilities, ttlMs: 0, cacheScope: "public", ...(instructions === undefined ? {} : { instructions }) }
      });
    }
    const key = { "tools/list": "tools", "prompts/list": "prompts", "resources/templates/list": "resourceTemplates" }[message.method as string] as string;
    const items = lists[key];
    if (items === "error" || items === undefined) return response({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    return response({ jsonrpc: "2.0", id: message.id, result: { resultType: "complete", [key]: items, ttlMs: 60_000, cacheScope: "public" } });
  });
}

const tool = { name: "lookup", inputSchema: { type: "object" } };
const prompt = { name: "review" };

describe("captureMcpSnapshot", () => {
  it("reads every list the server offers and leaves the others not-applicable", async () => {
    const request = httpServer({ tools: {}, prompts: {} }, { tools: [tool], prompts: [prompt] });

    const { report, responses } = await captureMcpSnapshot("https://mcp.example.com/mcp", { allowNetwork: true, request });

    expect(report).toMatchObject({
      schemaVersion: 1, scope: "mcp-surface-snapshot", status: "pass",
      lists: {
        tools: { status: "pass", catalog: { complete: true, checked: 1 } },
        prompts: { status: "pass", catalog: { complete: true, checked: 1 } },
        resourceTemplates: { status: "not-applicable", enumeration: "not-tested" }
      }
    });
    expect(report).not.toHaveProperty("transport");
    // Only capability names are kept, sorted; their values are not recorded.
    expect(report.server).toEqual({ era: "modern", versions: ["2026-07-28"], capabilities: ["prompts", "tools"], instructions: null });
    expect(violations(snapshotSchema, report)).toEqual([]);
    expect(responses).toEqual({
      tools: { items: [tool], cache: { ttlMs: 60_000, cacheScope: "public" } },
      prompts: { items: [prompt], cache: { ttlMs: 60_000, cacheScope: "public" } },
      resourceTemplates: null
    });
    const methods = request.mock.calls.map(([, options]) => JSON.parse(options.body).method);
    expect(methods.filter((method) => method !== "server/discover")).toEqual(["tools/list", "prompts/list"]);
  });

  it("is incomplete when any offered list cannot be read, and not-applicable when none is offered", async () => {
    const broken = await captureMcpSnapshot("https://mcp.example.com/mcp", {
      allowNetwork: true, request: httpServer({ tools: {}, prompts: {} }, { tools: [tool], prompts: "error" })
    });
    expect(broken.report.status).toBe("incomplete");
    expect(broken.report.lists.prompts).toMatchObject({ status: "incomplete", catalog: { reason: "prompts-list-method-unsupported" } });
    expect(broken.responses.tools).not.toBeNull();

    const empty = await captureMcpSnapshot("https://mcp.example.com/mcp", { allowNetwork: true, request: httpServer({ logging: {} }, {}) });
    expect(empty.report.status).toBe("not-applicable");
    expect(empty.report.server).toEqual({ era: "modern", versions: ["2026-07-28"], capabilities: ["logging"], instructions: null });
  });

  it("records a hash and the length of the instructions, never the text", async () => {
    const text = "Call lookup before search.";
    const { report } = await captureMcpSnapshot("https://mcp.example.com/mcp", { allowNetwork: true, request: httpServer({ tools: {} }, { tools: [tool] }, text) });

    expect(report.server?.instructions).toEqual({ sha256: createHash("sha256").update(text).digest("hex"), length: text.length });
    expect(violations(snapshotSchema, report)).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("lookup before");

    // A value that is not a string is no instructions.
    const numeric = await captureMcpSnapshot("https://mcp.example.com/mcp", {
      allowNetwork: true, request: httpServer({ tools: {} }, { tools: [tool] }, 42 as unknown as string)
    });
    expect(numeric.report.server?.instructions).toBeNull();
    expect(renderMcpSnapshotReport(numeric.report)).toContain("; no instructions");
    expect(renderMcpSnapshotReport(report)).toContain(`instructions sha256:${report.server?.instructions?.sha256.slice(0, 12)} (${text.length} characters)`);
  });

  it("bounds the recorded capability names and records no surface when discovery fails", async () => {
    const many = Object.fromEntries([...Array.from({ length: 70 }, (_, index) => [`cap-${String(index).padStart(2, "0")}`, {}]), ["x".repeat(129), {}]]);
    const bounded = await captureMcpSnapshot("https://mcp.example.com/mcp", { allowNetwork: true, request: httpServer(many, {}) });
    expect(bounded.report.server?.capabilities).toEqual(Array.from({ length: 64 }, (_, index) => `cap-${String(index).padStart(2, "0")}`));
    expect(violations(snapshotSchema, bounded.report)).toEqual([]);

    const failed = await captureMcpSnapshot("https://mcp.example.com/mcp", {
      allowNetwork: true, request: vi.fn(async () => ({ statusCode: 500, headers: {}, body: Buffer.from("") }))
    });
    expect(failed.report.server).toBeNull();
    expect(renderMcpSnapshotReport(failed.report)).toContain("Server surface: not established");
  });
});

describe("captureStdioMcpSnapshot", () => {
  it("starts a legacy server once and reads all three lists in that session", async () => {
    const resolved = await resolveMcpStdioServer(path.resolve("examples", "codex-doctor-runtime"), "doctorRuntime", "mcp-snapshot");
    if (!resolved.ok) throw new Error(resolved.message);
    const methods: string[] = [];
    let starts = 0;
    const spawnImpl = ((command: string, args: readonly string[], options: object) => {
      starts += 1;
      const child = spawn(command, args, options);
      const write = child.stdin!.write.bind(child.stdin!);
      child.stdin!.write = ((chunk: string, ...rest: never[]) => {
        methods.push(...String(chunk).split("\n").filter(Boolean).map((line) => JSON.parse(line).method as string));
        return write(chunk, ...rest);
      }) as typeof child.stdin.write;
      return child;
    }) as unknown as typeof spawn;

    // The example server never answers discovery, so a short wait reaches the legacy handshake sooner.
    const { report, responses } = await captureStdioMcpSnapshot(resolved.server, { timeouts: { ...fast, startupMs: 1_000 }, spawnImpl });

    expect(report).toMatchObject({
      transport: "stdio", status: "pass", protocol: { era: "legacy" },
      server: { era: "legacy", versions: ["2025-11-25"], capabilities: ["prompts", "resources", "tools"], instructions: null },
      lists: { tools: { status: "pass" }, prompts: { status: "pass" }, resourceTemplates: { status: "pass" } }
    });
    expect(violations(snapshotSchema, report)).toEqual([]);
    expect(starts).toBe(1);
    expect(methods.filter((method) => method.endsWith("/list"))).toEqual(["tools/list", "tools/list", "prompts/list", "prompts/list", "resources/templates/list", "resources/templates/list"]);
    expect(Object.values(responses).every((entry) => entry !== null)).toBe(true);
  });

  it("keeps reading the next list in the same session after one offered list fails", async () => {
    const resolved = await resolveMcpStdioServer(path.resolve("tests", "fixtures", "stdio-resource-template-catalog"), "modern-prompts-list-missing", "mcp-snapshot");
    if (!resolved.ok) throw new Error(resolved.message);
    let starts = 0;
    const spawnImpl = ((command: string, args: readonly string[], options: object) => {
      starts += 1;
      return spawn(command, args, options);
    }) as unknown as typeof spawn;

    const { report, responses } = await captureStdioMcpSnapshot(resolved.server, { timeouts: fast, spawnImpl });

    expect(report).toMatchObject({
      transport: "stdio", status: "incomplete", protocol: { era: "modern" },
      // Length counts code points, so the emoji counts once.
      server: {
        era: "modern", versions: ["2026-07-28"], capabilities: ["prompts", "resources", "tools"],
        instructions: { sha256: createHash("sha256").update("Prefer resource templates. 📁").digest("hex"), length: 28 }
      },
      lists: {
        tools: { status: "pass", catalog: { complete: true, checked: 1 } },
        prompts: { status: "incomplete", catalog: { complete: false, reason: "prompts-list-method-unsupported" } },
        resourceTemplates: { status: "pass", catalog: { complete: true, checked: 2 } }
      }
    });
    expect(violations(snapshotSchema, report)).toEqual([]);
    expect(starts).toBe(1);
    expect(responses.prompts).toBeNull();
    expect(responses.tools).not.toBeNull();
    expect(responses.resourceTemplates).not.toBeNull();
  });

  it("reports a failed Docker cleanup on every list of the session", async () => {
    const resolved = await resolveMcpStdioServer(path.resolve("tests", "fixtures", "stdio-resource-template-catalog"), "modern", "mcp-snapshot");
    if (!resolved.ok) throw new Error(resolved.message);
    // Stands in for the docker client by running the containerized command directly.
    const spawnImpl = ((_command: string, args: readonly string[], options: { cwd: string }) => {
      const image = args.indexOf(DOCKER_RUNTIME_IMAGE);
      return spawn(args[image + 1], args.slice(image + 2), { ...options, cwd: options.cwd });
    }) as unknown as typeof spawn;

    const { report } = await captureStdioMcpSnapshot(resolved.server, { sandbox: "docker", timeouts: fast, spawnImpl, removeContainerImpl: async () => false });

    expect(report.lists.resourceTemplates.status).toBe("fail");
    for (const list of Object.values(report.lists)) {
      expect(list.findings).toEqual([expect.objectContaining({
        id: "plugin.catalog.stdio.sandbox_cleanup_failed",
        message: "The Docker runtime container could not be removed after reading the MCP lists."
      })]);
    }
    expect(report.status).toBe("fail");
  });
});

describe("captureStdioMcpSnapshot server surface", () => {
  it("records only the legacy capabilities whose value is an object, and quotes them in the report", async () => {
    const resolved = await resolveMcpStdioServer(path.resolve("tests", "fixtures", "stdio-resource-template-catalog"), "legacy", "mcp-snapshot");
    if (!resolved.ok) throw new Error(resolved.message);

    const { report } = await captureStdioMcpSnapshot(resolved.server, { timeouts: fast });

    const instructions = "Ask before reading project files.";
    expect(report.server).toEqual({
      era: "legacy", versions: ["2025-11-25"], capabilities: ["resources"],
      instructions: { sha256: createHash("sha256").update(instructions).digest("hex"), length: instructions.length }
    });
    expect(JSON.stringify(report)).not.toContain(instructions);
    expect(renderMcpSnapshotReport({ ...report, server: { era: "legacy", versions: ["2025-11-25"], capabilities: ["bell\u0007"] } }))
      .toContain('Server surface: legacy; versions "2025-11-25"; capabilities "bell\\u0007"');
  });
});

describe("saveMcpSnapshot", () => {
  it("creates the directory and writes only complete lists under their usual names", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-save-"));
    try {
      const directory = path.join(root, "nested", "snapshot");
      const saved = await saveMcpSnapshot(directory, {
        report: { lists: { tools: { status: "warn" }, prompts: { status: "not-applicable" }, resourceTemplates: { status: "pass" } } },
        responses: {
          tools: { items: [tool], cache: { ttlMs: 0, cacheScope: "private" } },
          prompts: null,
          resourceTemplates: { items: [{ name: "files", uriTemplate: "file:///{path}" }], cache: { ttlMs: 0, cacheScope: "private" } }
        }
      } as unknown as McpSnapshot);
      expect(saved.lists.map(({ fileName, result }) => [fileName, result.kind])).toEqual([["mcp-tools-current.json", "saved"], ["mcp-resource-templates-current.json", "saved"]]);
      expect(saved.manifest.kind).toBe("saved");
      expect((await readdir(directory)).sort()).toEqual(["mcp-resource-templates-current.json", "mcp-snapshot-manifest.json", "mcp-tools-current.json"]);
      expect(JSON.parse(await readFile(path.join(directory, "mcp-resource-templates-current.json"), "utf8"))).toMatchObject({ id: "resource-templates-list" });
      expect(JSON.parse(await readFile(path.join(directory, "mcp-snapshot-manifest.json"), "utf8"))).toEqual({
        schemaVersion: 1, scope: "mcp-snapshot-manifest",
        lists: {
          tools: { status: "warn", file: "mcp-tools-current.json" },
          prompts: { status: "not-applicable", file: null },
          resourceTemplates: { status: "pass", file: "mcp-resource-templates-current.json" }
        }
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
