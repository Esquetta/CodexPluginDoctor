import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const filesystemSpies = vi.hoisted(() => ({ lstat: vi.fn(), open: vi.fn(), originalLstat: null as unknown }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  filesystemSpies.originalLstat = actual.lstat;
  filesystemSpies.lstat.mockImplementation(actual.lstat);
  filesystemSpies.open.mockImplementation(actual.open);
  return { ...actual, lstat: filesystemSpies.lstat, open: filesystemSpies.open };
});

import { inspectMcpToolFile } from "../src/core/mcp-tool-file.js";

const temporaryDirectories: string[] = [];
const fileSymlinkIt = process.platform === "win32" ? it.skip : it;

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-tool-file-"));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(tools: unknown[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 0,
    result: {
      resultType: "complete",
      tools,
      ttlMs: 0,
      cacheScope: "public",
      ...extra
    }
  };
}

function tool(name = "search_catalog"): Record<string, unknown> {
  return { name, inputSchema: {} };
}

async function writeJson(directory: string, value: unknown, name = "tools.json"): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

function assertRedacted(report: unknown, sentinels: string[]): void {
  const serialized = JSON.stringify(report);
  for (const sentinel of sentinels) expect(serialized).not.toContain(sentinel);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const [canonicalDirectory, canonicalTemporaryRoot] = await Promise.all([
      realpath(directory).catch(() => null),
      realpath(os.tmpdir()).catch(() => null)
    ]);
    if (canonicalDirectory === null
      || canonicalTemporaryRoot === null
      || path.dirname(canonicalDirectory) !== canonicalTemporaryRoot
      || !path.basename(canonicalDirectory).startsWith("mcp-tool-file-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("offline MCP tool definition file inspection", () => {
  it("accepts a terminal modern tools/list JSON-RPC result without reading beyond the file", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([tool()]));

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({
      schemaVersion: 1,
      scope: "tool-definitions-file",
      status: "pass",
      source: { kind: "file", format: "mcp-tools-list-response", bytesRead: expect.any(Number) },
      inspection: { complete: true, toolsChecked: 1, hasNextCursor: false, reason: null },
      coverage: {
        schema: "root-shape-only",
        discovery: "not-tested",
        serverCatalog: "not-tested",
        toolExecution: "not-tested",
        fullConformance: "not-tested",
        customHeaderAnnotations: "not-tested"
      },
      findings: []
    });
    expect(report.source.bytesRead).toBe(Buffer.byteLength(JSON.stringify(envelope([tool()]))));
  });

  it("accepts an initial UTF-8 BOM and zero tools", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "bom.json");
    await writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(envelope()))]));

    await expect(inspectMcpToolFile(filePath)).resolves.toMatchObject({
      status: "pass",
      inspection: { complete: true, toolsChecked: 0, hasNextCursor: false, reason: null }
    });
  });

  it("rejects a second leading UTF-8 BOM as invalid JSON", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "double-bom.json");
    await writeFile(filePath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(envelope()))
    ]));

    await expect(inspectMcpToolFile(filePath)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, reason: "invalid-json" }
    });
  });

  it.each([
    ["a raw array", []],
    ["a result-only object", envelope().result],
    ["an error envelope", { jsonrpc: "2.0", id: 0, error: { code: -32600, message: "FILE_SECRET_SENTINEL" } }],
    ["both result and error", { ...envelope(), error: { code: -32600, message: "FILE_SECRET_SENTINEL" } }],
    ["a null id", { ...envelope(), id: null }],
    ["an invalid JSON-RPC version", { ...envelope(), jsonrpc: "2.1" }],
    ["a non-complete result", envelope([], { resultType: "partial" })],
    ["invalid cache metadata", envelope([], { ttlMs: -1 })],
    ["an invalid cache scope", envelope([], { cacheScope: "shared" })],
    ["a non-array tool list", envelope([], { tools: {} })],
    ["a non-string continuation cursor", envelope([], { nextCursor: 7 })]
  ])("keeps an invalid %s incomplete without exposing payload fields", async (_caseName, value) => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, value);

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, toolsChecked: 0, hasNextCursor: null, reason: "response-invalid" }
    });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.tools_file.response.invalid");
    assertRedacted(report, ["FILE_SECRET_SENTINEL", filePath]);
  });

  it.each([
    ["an empty file", Buffer.alloc(0), "invalid-json", "plugin.tools_file.json.invalid"],
    ["malformed JSON", Buffer.from('{"jsonrpc":') , "invalid-json", "plugin.tools_file.json.invalid"],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28]), "invalid-utf8", "plugin.tools_file.encoding.invalid"]
  ])("reports %s without returning source text", async (_caseName, content, reason, findingId) => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "untrusted-file-secret.json");
    await writeFile(filePath, content);

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", inspection: { complete: false, reason } });
    expect(report.findings.map((finding) => finding.id)).toContain(findingId);
    assertRedacted(report, [filePath, "untrusted-file-secret"]);
  });

  it("classifies a missing file as incomplete and does not disclose its path", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "MISSING_PATH_SECRET.json");

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", inspection: { complete: false, reason: "file-unavailable" } });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.tools_file.file.unavailable");
    assertRedacted(report, [filePath, "MISSING_PATH_SECRET"]);
  });

  it.each([
    "https://URL_PATH_SECRET.example/tools",
    "\\\\server\\share\\UNC_PATH_SECRET.json",
    "\\\\server",
    "//server/share/UNC_PATH_SECRET.json",
    "//server",
    "/\\\\server",
    "\\\\?\\UNC\\server\\share\\DEVICE_PATH_SECRET.json",
    "\\\\.\\pipe\\DEVICE_PATH_SECRET",
    "https:SCHEME_PATH_SECRET.example/tools",
    "file:/C:/SCHEME_PATH_SECRET.json"
  ])("blocks remote or device-shaped input before filesystem access: %s", async (filePath) => {
    filesystemSpies.lstat.mockClear();
    filesystemSpies.open.mockClear();
    filesystemSpies.lstat.mockImplementationOnce(async () => {
      throw new Error("Filesystem access occurred.");
    });

    const report = await inspectMcpToolFile(filePath);
    const lstatCalls = filesystemSpies.lstat.mock.calls.length;
    const openCalls = filesystemSpies.open.mock.calls.length;
    filesystemSpies.lstat.mockReset();
    filesystemSpies.lstat.mockImplementation(filesystemSpies.originalLstat as never);

    expect(report).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "offline-path-blocked" } });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.tools_file.path.blocked");
    expect(lstatCalls).toBe(0);
    expect(openCalls).toBe(0);
    assertRedacted(report, [filePath, "URL_PATH_SECRET", "UNC_PATH_SECRET", "DEVICE_PATH_SECRET"]);
  });

  it("blocks directories and final symlinks before inspection", async () => {
    const directory = await fixtureDirectory();
    const directoryReport = await inspectMcpToolFile(directory);

    expect(directoryReport).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "non-regular-file" } });
    expect(directoryReport.findings.map((finding) => finding.id)).toContain("plugin.tools_file.file.not_regular");
  });

  fileSymlinkIt("blocks a final symbolic link without reporting its target", async () => {
    const directory = await fixtureDirectory();
    const target = await writeJson(directory, envelope(), "target.json");
    const linkPath = path.join(directory, "LINK_PATH_SECRET.json");
    await symlink(target, linkPath, "file");

    const report = await inspectMcpToolFile(linkPath);

    expect(report).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "final-symlink" } });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.tools_file.file.symlink");
    assertRedacted(report, [linkPath, target, "LINK_PATH_SECRET"]);
  });

  it("does not read a file larger than one MiB", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "large.json");
    await writeFile(filePath, Buffer.alloc(1024 * 1024 + 1, 0x20));

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      source: { bytesRead: 0 },
      inspection: { complete: false, reason: "file-size-limit" }
    });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.tools_file.file.too_large");
  });

  it("rejects a same-length file mutation observed after the bounded read", async () => {
    const content = Buffer.from(JSON.stringify(envelope()));
    const unchanged = {
      dev: 1,
      ino: 2,
      size: content.length,
      mtimeMs: 10,
      ctimeMs: 10,
      isFile: () => true,
      isSymbolicLink: () => false
    };
    const changed = { ...unchanged, mtimeMs: 11, ctimeMs: 11 };
    const handle = {
      stat: vi.fn().mockResolvedValueOnce(unchanged).mockResolvedValueOnce(changed),
      read: vi.fn().mockImplementationOnce(async (target: Buffer, offset: number, length: number) => {
        content.copy(target, offset, 0, Math.min(content.length, length));
        return { bytesRead: length, buffer: target };
      }).mockResolvedValueOnce({ bytesRead: 0, buffer: Buffer.alloc(1) }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    filesystemSpies.lstat.mockResolvedValueOnce(unchanged).mockResolvedValueOnce(unchanged).mockResolvedValueOnce(changed);
    filesystemSpies.open.mockResolvedValueOnce(handle);

    const report = await inspectMcpToolFile("same-length-change-fixture.json");

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, reason: "file-changed" }
    });
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("counts an extra byte discovered by the bounded growth probe", async () => {
    const content = Buffer.from(JSON.stringify(envelope()));
    const stable = {
      dev: 3,
      ino: 4,
      size: content.length,
      mtimeMs: 20,
      ctimeMs: 20,
      isFile: () => true,
      isSymbolicLink: () => false
    };
    const handle = {
      stat: vi.fn().mockResolvedValue(stable),
      read: vi.fn(async (target: Buffer, offset: number, length: number) => {
        if (length === 1) return { bytesRead: 1, buffer: target };
        content.copy(target, offset, 0, Math.min(content.length, length));
        return { bytesRead: length, buffer: target };
      }),
      close: vi.fn().mockResolvedValue(undefined)
    };
    filesystemSpies.lstat.mockResolvedValueOnce(stable).mockResolvedValueOnce(stable);
    filesystemSpies.open.mockResolvedValueOnce(handle);

    const report = await inspectMcpToolFile("growth-fixture.json");

    expect(report).toMatchObject({
      status: "incomplete",
      source: { bytesRead: content.length + 1 },
      inspection: { complete: false, reason: "file-changed" }
    });
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("validates supplied tools but marks a page with a continuation cursor incomplete", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([{ name: 4 }], { nextCursor: "CURSOR_SECRET" }));

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, toolsChecked: 1, hasNextCursor: true, reason: "more-pages-present" }
    });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.catalog.tool.name.invalid");
    assertRedacted(report, ["CURSOR_SECRET"]);
  });

  it("treats an empty continuation cursor as present and opaque", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([], { nextCursor: "" }));

    await expect(inspectMcpToolFile(filePath)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, toolsChecked: 0, hasNextCursor: true, reason: "more-pages-present" }
    });
  });

  it("enforces the five-hundred tool and one-hundred finding bounds", async () => {
    const directory = await fixtureDirectory();
    const tooManyTools = await writeJson(directory, envelope(Array.from({ length: 501 }, (_, index) => tool(`tool-${index}`))), "too-many-tools.json");
    const tooManyFindings = await writeJson(directory, envelope(Array.from({ length: 101 }, () => ({ inputSchema: {} }))), "too-many-findings.json");

    await expect(inspectMcpToolFile(tooManyTools)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, toolsChecked: 500, reason: "tool-limit" }
    });
    const findingReport = await inspectMcpToolFile(tooManyFindings);
    expect(findingReport).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, toolsChecked: 101, reason: "finding-limit" }
    });
    expect(findingReport.findings).toHaveLength(100);
  });

  it("completes exact tool and finding limits when no additional entry exceeds them", async () => {
    const directory = await fixtureDirectory();
    const exactTools = await writeJson(directory, envelope(Array.from({ length: 500 }, (_, index) => tool(`tool-${index}`))), "exact-tools.json");
    const exactFindings = await writeJson(directory, envelope(Array.from({ length: 100 }, () => ({ inputSchema: {} }))), "exact-findings.json");

    await expect(inspectMcpToolFile(exactTools)).resolves.toMatchObject({
      status: "pass",
      inspection: { complete: true, toolsChecked: 500, reason: null }
    });
    const findingReport = await inspectMcpToolFile(exactFindings);
    expect(findingReport).toMatchObject({
      status: "fail",
      inspection: { complete: true, toolsChecked: 100, reason: null }
    });
    expect(findingReport.findings).toHaveLength(100);
  });

  it("reports only exact duplicate names, including prototype-like names", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([tool("__proto__"), tool("__proto__"), tool("Echo"), tool("echo"), tool("admin.tools.list")]));

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({ status: "warn", inspection: { complete: true, toolsChecked: 5 } });
    expect(report.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "plugin.catalog.tool.name.duplicate",
        location: { page: 1, toolIndex: 2, relatedToolIndex: 1 }
      })
    ]));
    assertRedacted(report, ["__proto__"]);
  });

  it("preserves root-schema validation and warns for an unsupported dialect", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([{
      name: "tool",
      inputSchema: { $schema: "https://example.test/unsupported", type: "record" }
    }]));

    const report = await inspectMcpToolFile(filePath);

    expect(report).toMatchObject({ status: "warn", inspection: { complete: true, toolsChecked: 1 } });
    expect(report.findings.map((finding) => finding.id)).toContain("plugin.catalog.schema.dialect.unsupported");
  });
});
