import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  captureStdioMcpToolCatalog,
  resolveMcpStdioServer,
  type McpStdioServer,
  type McpStdioToolCatalogOptions
} from "../src/core/mcp-stdio-tool-catalog.js";
import { DOCKER_RUNTIME_IMAGE } from "../src/core/runtime-sandbox.js";

const fixtureRoot = path.resolve("tests", "fixtures", "stdio-tool-catalog");
const fast = { startupMs: 3_000, requestMs: 3_000, shutdownMs: 1_000 };

async function server(name: string, root = fixtureRoot): Promise<McpStdioServer> {
  const resolved = await resolveMcpStdioServer(root, name);
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.server;
}

// Wraps spawn to record each line the client writes and every started process.
function recordingSpawn() {
  const lines: string[] = [];
  const children: ChildProcess[] = [];
  const spawnImpl = ((command: string, args: readonly string[], options: object) => {
    const child = spawn(command, args, options);
    children.push(child);
    const write = child.stdin!.write.bind(child.stdin!);
    child.stdin!.write = ((chunk: string, ...rest: never[]) => {
      lines.push(...String(chunk).split("\n").filter(Boolean));
      return write(chunk, ...rest);
    }) as typeof child.stdin.write;
    return child;
  }) as unknown as typeof spawn;
  return { lines, children, spawnImpl, methods: () => lines.map((line) => JSON.parse(line).method as string) };
}

async function capture(name: string, options: McpStdioToolCatalogOptions = {}) {
  return captureStdioMcpToolCatalog(await server(name), { timeouts: fast, ...options });
}

describe("resolveMcpStdioServer", () => {
  it("reads the manifest mcpServers file before .mcp.json and keeps the cwd inside the package", async () => {
    const resolved = await resolveMcpStdioServer(fixtureRoot, "modern");
    expect(resolved).toMatchObject({ ok: true, server: { command: "node", args: ["./server.js", "modern"], source: "manifest" } });
    if (resolved.ok) expect(resolved.server.cwd).toBe(resolved.server.packageRoot);
  });

  it("falls back to .mcp.json for packages without a plugin manifest", async () => {
    const resolved = await resolveMcpStdioServer(path.resolve("tests", "fixtures", "stdio-tool-catalog-mcp-json"), "legacy");
    expect(resolved).toMatchObject({ ok: true, server: { source: "mcp-json" } });
  });

  it.each(["{ not json", "[]"])("does not fall back to .mcp.json when the plugin manifest is %s", async (manifest) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-stdio-manifest-"));
    try {
      await mkdir(path.join(directory, ".codex-plugin"));
      await writeFile(path.join(directory, ".codex-plugin", "plugin.json"), manifest);
      await writeFile(path.join(directory, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: "node", args: ["server.js"] } } }));
      expect(await resolveMcpStdioServer(directory, "local")).toEqual({
        ok: false, message: "The plugin manifest could not be read as a JSON object."
      });
    } finally {
      const resolved = await realpath(directory);
      if (path.dirname(resolved) !== await realpath(os.tmpdir()) || !path.basename(resolved).startsWith("doctor-stdio-manifest-")) {
        throw new Error("Unexpected test cleanup target.");
      }
      await rm(resolved, { recursive: true, force: true });
    }
  });

  it.each([
    ["absent", fixtureRoot, "not in the package configuration"],
    ["remote", fixtureRoot, "uses HTTP"],
    ["outside-cwd", fixtureRoot, "inside the package root"],
    ["modern", path.resolve("tests", "fixtures", "valid-plugin"), "configuration"],
    ["modern", path.resolve("tests", "fixtures", "does-not-exist"), "not found"]
  ])("rejects the server %s in %s", async (name, root, message) => {
    const resolved = await resolveMcpStdioServer(root, name);
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) expect(resolved.message).toContain(message);
  });
});

describe("captureStdioMcpToolCatalog", () => {
  it("reads a modern server with server/discover and per-request metadata, never calling a tool", async () => {
    const recorder = recordingSpawn();
    const snapshot = await capture("modern-paged", { spawnImpl: recorder.spawnImpl });

    expect(snapshot.report).toMatchObject({
      transport: "stdio",
      status: "pass",
      protocol: { era: "modern", version: "2026-07-28" },
      execution: { backend: "native", network: "host" },
      discovery: { status: "discovered", supportedVersions: ["2026-07-28"] },
      catalog: { complete: true, pagesRead: 2, toolsChecked: 2, reason: null },
      coverage: { discovery: "pass", catalogEnumeration: "complete", toolExecution: "not-tested" }
    });
    expect(snapshot.tools).toEqual([
      expect.objectContaining({ name: "lookup" }),
      expect.objectContaining({ name: "search" })
    ]);
    expect(snapshot.cache).toEqual({ ttlMs: 1_000, cacheScope: "private" });
    expect(recorder.methods()).toEqual(["server/discover", "tools/list", "tools/list"]);
    const pageTwo = JSON.parse(recorder.lines[2]);
    expect(pageTwo.params).toMatchObject({ cursor: "page-2", _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } });
    expect(recorder.children.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  });

  it("falls back to the legacy initialize handshake when discovery returns a non-modern error", async () => {
    const recorder = recordingSpawn();
    const snapshot = await capture("legacy-paged", { spawnImpl: recorder.spawnImpl });

    expect(snapshot.report).toMatchObject({
      status: "pass",
      protocol: { era: "legacy", version: "2025-11-25" },
      discovery: { status: "unsupported", findings: [expect.objectContaining({ id: "plugin.discovery.method.unsupported", severity: "warn" })] },
      catalog: { complete: true, pagesRead: 2, toolsChecked: 2 },
      coverage: { discovery: "skipped", catalogEnumeration: "complete" }
    });
    expect(snapshot.cache).toEqual({ ttlMs: 0, cacheScope: "private" });
    expect(recorder.methods()).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list", "tools/list"]);
    expect(JSON.parse(recorder.lines[1]).params).toMatchObject({ protocolVersion: "2025-11-25", capabilities: {} });
    expect(JSON.parse(recorder.lines[3]).params).toBeUndefined();
  });

  it("treats a silent discovery probe as a legacy server", async () => {
    const snapshot = await capture("legacy-silent", { timeouts: { ...fast, startupMs: 300 } });
    expect(snapshot.report).toMatchObject({
      status: "pass",
      protocol: { era: "legacy", version: "2025-11-25" },
      discovery: { status: "unsupported", findings: [expect.objectContaining({ id: "plugin.discovery.stdio.no_response" })] }
    });
  });

  it("restarts a legacy server that exits on the discovery probe", async () => {
    const recorder = recordingSpawn();
    const snapshot = await capture("legacy-exit", { spawnImpl: recorder.spawnImpl });
    expect(snapshot.report).toMatchObject({ status: "pass", protocol: { era: "legacy" }, catalog: { complete: true } });
    expect(recorder.children).toHaveLength(2);
    expect(recorder.methods()).toEqual(["server/discover", "initialize", "notifications/initialized", "tools/list"]);
  });

  it("reports a server that keeps exiting without claiming a protocol era", async () => {
    const recorder = recordingSpawn();
    const snapshot = await capture("exit-at-start", { spawnImpl: recorder.spawnImpl });
    expect(snapshot.report).toMatchObject({
      status: "incomplete",
      protocol: { era: null, version: null },
      catalog: { complete: false, reason: "server-exited" }
    });
    expect(snapshot.tools).toBeNull();
    expect(recorder.children).toHaveLength(2);
  });

  it("records an older negotiated legacy version", async () => {
    expect((await capture("legacy-old-version")).report.protocol).toEqual({ era: "legacy", version: "2025-06-18" });
  });

  it("stops on a legacy version it does not know", async () => {
    const { report, tools } = await capture("legacy-future-version");
    expect(report).toMatchObject({ status: "unsupported", protocol: { era: "legacy", version: null }, catalog: { reason: "protocol-version-unsupported" } });
    expect(report.findings.map((item) => item.id)).toEqual(["plugin.catalog.initialize.version_unsupported"]);
    expect(tools).toBeNull();
  });

  it.each(["modern-no-tools", "legacy-no-tools"])("returns not-applicable for %s without listing tools", async (name) => {
    const recorder = recordingSpawn();
    const { report } = await capture(name, { spawnImpl: recorder.spawnImpl });
    expect(report).toMatchObject({ status: "not-applicable", catalog: { complete: false, pagesRead: 0 }, coverage: { catalogEnumeration: "not-tested" } });
    expect(recorder.methods()).not.toContain("tools/list");
  });

  it("does not fall back when a modern server rejects the requested version", async () => {
    const recorder = recordingSpawn();
    const { report } = await capture("modern-unsupported-version", { spawnImpl: recorder.spawnImpl });
    expect(report).toMatchObject({
      status: "unsupported",
      protocol: { era: "modern", version: null },
      discovery: { status: "unsupported", supportedVersions: ["2027-01-01"], findings: [expect.objectContaining({ id: "plugin.discovery.protocol_version.unsupported" })] },
      catalog: { reason: "discovery-unsupported" }
    });
    expect(recorder.methods()).toEqual(["server/discover"]);
  });

  it.each([
    ["modern-invalid-discover", "discovery-failed", [], ["plugin.discovery.result.invalid"]],
    ["modern-tools-list-missing", "tools-list-method-unsupported", ["plugin.catalog.tools_list.method_unsupported"], []],
    ["modern-invalid-page", "response-invalid", ["plugin.catalog.response.invalid"], []],
    ["modern-cursor-loop", "cursor-loop", ["plugin.catalog.cursor.loop"], []],
    ["modern-stdout-noise", "stdout-invalid", ["plugin.catalog.stdio.output.invalid"], []],
    ["modern-trailing-noise", "stdout-invalid", ["plugin.catalog.stdio.output.invalid"], []],
    ["startup-noise", "stdout-invalid", [], ["plugin.discovery.stdio.output.invalid"]],
    ["modern-large-line", "response-byte-limit", [], []],
    ["missing-command", "startup-failed", [], ["plugin.discovery.stdio.startup_failed"]]
  ])("reports %s as incomplete with reason %s", async (name, reason, findingIds, discoveryIds) => {
    const snapshot = await capture(name);
    expect(snapshot.report.status).toBe("incomplete");
    expect(snapshot.report.catalog).toMatchObject({ complete: false, reason });
    expect(snapshot.report.findings.map((item) => item.id)).toEqual(findingIds);
    expect(snapshot.report.discovery.findings.map((item) => item.id)).toEqual(discoveryIds);
    expect(snapshot.tools).toBeNull();
    expect(snapshot.cache).toBeNull();
  });

  it("reports a missing command without execution evidence", async () => {
    expect((await capture("missing-command")).report.execution).toBeNull();
  });

  it("reports a launch that spawn rejects synchronously without echoing it", async () => {
    const sentinel = "secret-arg";
    const snapshot = await captureStdioMcpToolCatalog(
      { ...(await server("modern")), args: [`${sentinel}\u0000`] },
      { timeouts: fast }
    );
    expect(snapshot.report).toMatchObject({
      status: "incomplete",
      execution: null,
      catalog: { complete: false, reason: "startup-failed" },
      discovery: { findings: [expect.objectContaining({ id: "plugin.discovery.stdio.startup_failed" })] }
    });
    expect(JSON.stringify(snapshot.report)).not.toContain(sentinel);
  });

  it("keeps earlier findings when a later page times out", async () => {
    const { report } = await capture("modern-hang-page", { timeouts: { ...fast, requestMs: 300 } });
    expect(report).toMatchObject({ status: "incomplete", catalog: { pagesRead: 1, toolsChecked: 1, reason: "request-timeout" } });
  });

  it("stops at the total time limit", async () => {
    const { report } = await capture("legacy-silent", { timeouts: { ...fast, startupMs: 5_000, totalMs: 300 } });
    expect(report).toMatchObject({
      status: "incomplete",
      discovery: { status: "failed", findings: [expect.objectContaining({ id: "plugin.discovery.transport.timeout" })] },
      catalog: { reason: "total-time-limit" }
    });
  });

  it("terminates a server that ignores stdin closing and SIGTERM", async () => {
    const recorder = recordingSpawn();
    const { report } = await capture("ignore-stdin-close", { spawnImpl: recorder.spawnImpl, timeouts: { ...fast, shutdownMs: 200 } });
    expect(report.status).toBe("pass");
    expect(recorder.children[0].exitCode !== null || recorder.children[0].signalCode !== null).toBe(true);
  });

  it("excludes tool names, descriptions, commands, and paths from the report", async () => {
    const { report } = await capture("modern");
    const text = JSON.stringify(report);
    for (const sentinel of ["lookup", "Look up", "server.js", "node", fixtureRoot]) {
      expect(text).not.toContain(sentinel);
    }
  });

  it("blocks sandboxed runs the Docker backend cannot isolate without starting anything", async () => {
    const spawnImpl = vi.fn();
    const snapshot = await capture("missing-command", { sandbox: "docker", spawnImpl: spawnImpl as unknown as typeof spawn });
    expect(snapshot.report).toMatchObject({
      status: "blocked",
      execution: null,
      discovery: { status: "blocked", findings: [expect.objectContaining({ id: "plugin.discovery.sandbox.unsupported" })] },
      catalog: { reason: "sandbox-unsupported" }
    });
    expect(spawnImpl).not.toHaveBeenCalled();
  });

  it.each([[true, "pass"], [false, "fail"]] as const)("runs Node.js servers through Docker and removes containers (removed: %s)", async (removed, status) => {
    const launches: string[][] = [];
    // Stands in for the docker client by running the containerized command directly.
    const spawnImpl = ((command: string, args: readonly string[], options: { cwd: string }) => {
      launches.push([command, ...args]);
      const image = args.indexOf(DOCKER_RUNTIME_IMAGE);
      return spawn(args[image + 1], args.slice(image + 2), { ...options, cwd: options.cwd });
    }) as unknown as typeof spawn;
    const removeContainerImpl = vi.fn().mockResolvedValue(removed);
    const snapshot = await capture("modern", { sandbox: "docker", spawnImpl, removeContainerImpl });

    expect(launches[0].slice(0, 2)).toEqual(["docker", "run"]);
    expect(launches[0]).toEqual(expect.arrayContaining(["--network", "none", "--read-only"]));
    expect(snapshot.report).toMatchObject({ status, execution: { backend: "docker", network: "none", packageMount: "read_only" }, catalog: { complete: true } });
    expect(removeContainerImpl).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/^codex-doctor-/));
    expect(snapshot.report.findings.map((item) => item.id)).toEqual(removed ? [] : ["plugin.catalog.stdio.sandbox_cleanup_failed"]);
    expect(snapshot.tools).toHaveLength(2);
  });
});
