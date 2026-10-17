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

import { inspectMcpPromptFile, loadMcpPromptFileSnapshot } from "../src/core/mcp-prompt-file.js";

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-prompt-file-"));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(prompts: unknown[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      resultType: "complete",
      prompts,
      ttlMs: 600000,
      cacheScope: "public",
      ...extra
    }
  };
}

function prompt(name = "code_review", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, ...extra };
}

async function writeJson(directory: string, value: unknown, name = "prompts.json"): Promise<string> {
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
      || !path.basename(canonicalDirectory).startsWith("mcp-prompt-file-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("offline MCP prompt definition file inspection", () => {
  it("accepts a complete prompts/list JSON-RPC result without reporting prompt content", async () => {
    const directory = await fixtureDirectory();
    const value = envelope([prompt("PROMPT_NAME_SECRET", {
      title: "TITLE_SECRET",
      description: "DESCRIPTION_SECRET",
      arguments: [{ name: "ARGUMENT_SECRET", description: "ARGUMENT_DESCRIPTION_SECRET", required: true }],
      icons: [{ src: "https://ICON_SECRET.example/icon.svg" }]
    })]);
    const filePath = await writeJson(directory, value);

    const { report, prompts } = await loadMcpPromptFileSnapshot(filePath);

    expect(report).toEqual({
      schemaVersion: 1,
      scope: "prompt-definitions-file",
      status: "pass",
      source: { kind: "file", format: "mcp-prompts-list-response", bytesRead: Buffer.byteLength(JSON.stringify(value)) },
      inspection: { complete: true, promptsChecked: 1, hasNextCursor: false, reason: null },
      coverage: {
        definitions: "shape-only",
        discovery: "not-tested",
        serverCatalog: "not-tested",
        promptRetrieval: "not-tested",
        fullConformance: "not-tested"
      },
      findings: []
    });
    expect(prompts).toEqual((value.result as { prompts: unknown[] }).prompts);
    assertRedacted(report, ["SECRET", filePath]);
  });

  it("accepts an initial UTF-8 BOM, zero prompts, and a string id", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "bom.json");
    await writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ ...envelope(), id: "request-1" }))]));

    await expect(inspectMcpPromptFile(filePath)).resolves.toMatchObject({
      status: "pass",
      inspection: { complete: true, promptsChecked: 0, hasNextCursor: false, reason: null }
    });
  });

  it.each([
    ["a raw array", []],
    ["a result-only object", envelope().result],
    ["a tools/list response", { jsonrpc: "2.0", id: 1, result: { resultType: "complete", tools: [], ttlMs: 0, cacheScope: "public" } }],
    ["an error envelope", { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "FILE_SECRET_SENTINEL" } }],
    ["both result and error", { ...envelope(), error: { code: -32602, message: "FILE_SECRET_SENTINEL" } }],
    ["a missing id", { jsonrpc: "2.0", result: envelope().result }],
    ["a null id", { ...envelope(), id: null }],
    ["an invalid JSON-RPC version", { ...envelope(), jsonrpc: "1.0" }],
    ["a non-complete result", envelope([], { resultType: "partial" })],
    ["missing cache metadata", { jsonrpc: "2.0", id: 1, result: { resultType: "complete", prompts: [] } }],
    ["a negative ttl", envelope([], { ttlMs: -1 })],
    ["a non-numeric ttl", envelope([], { ttlMs: "600000" })],
    ["an invalid cache scope", envelope([], { cacheScope: "shared" })],
    ["a non-array prompt list", envelope([], { prompts: { name: "FILE_SECRET_SENTINEL" } })],
    ["a non-string continuation cursor", envelope([], { nextCursor: 7 })]
  ])("keeps %s incomplete without exposing payload fields", async (_caseName, value) => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, value);

    const { report, prompts } = await loadMcpPromptFileSnapshot(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, promptsChecked: 0, hasNextCursor: null, reason: "response-invalid" }
    });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.response.invalid"]);
    expect(report.findings[0].message).toContain("prompts/list");
    expect(prompts).toBeNull();
    assertRedacted(report, ["FILE_SECRET_SENTINEL", filePath]);
  });

  it.each([
    ["an empty file", Buffer.alloc(0), "invalid-json", "plugin.prompts_file.json.invalid"],
    ["malformed JSON", Buffer.from('{"jsonrpc":'), "invalid-json", "plugin.prompts_file.json.invalid"],
    ["a second leading BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(envelope()))]), "invalid-json", "plugin.prompts_file.json.invalid"],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28]), "invalid-utf8", "plugin.prompts_file.encoding.invalid"]
  ])("reports %s without returning source text", async (_caseName, content, reason, findingId) => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "untrusted-file-secret.json");
    await writeFile(filePath, content);

    const report = await inspectMcpPromptFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", source: { bytesRead: content.length }, inspection: { complete: false, reason } });
    expect(report.findings.map((finding) => [finding.id, finding.severity])).toEqual([[findingId, "fail"]]);
    assertRedacted(report, [filePath, "untrusted-file-secret"]);
  });

  it("classifies a missing file as incomplete and does not disclose its path", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "MISSING_PATH_SECRET.json");

    const report = await inspectMcpPromptFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", inspection: { complete: false, reason: "file-unavailable" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.file.unavailable"]);
    assertRedacted(report, [filePath, "MISSING_PATH_SECRET"]);
  });

  it.each([
    "https://URL_PATH_SECRET.example/prompts",
    "\\\\server\\share\\UNC_PATH_SECRET.json",
    "//server/share/UNC_PATH_SECRET.json",
    "\\\\?\\UNC\\server\\share\\DEVICE_PATH_SECRET.json",
    "\\\\.\\pipe\\DEVICE_PATH_SECRET",
    "file:/C:/SCHEME_PATH_SECRET.json"
  ])("blocks remote or device-shaped input before filesystem access: %s", async (filePath) => {
    filesystemSpies.lstat.mockClear();
    filesystemSpies.open.mockClear();

    const report = await inspectMcpPromptFile(filePath);

    expect(report).toMatchObject({ status: "blocked", source: { bytesRead: 0 }, inspection: { complete: false, reason: "offline-path-blocked" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.path.blocked"]);
    expect(filesystemSpies.lstat).not.toHaveBeenCalled();
    expect(filesystemSpies.open).not.toHaveBeenCalled();
    assertRedacted(report, [filePath, "URL_PATH_SECRET", "UNC_PATH_SECRET", "DEVICE_PATH_SECRET", "SCHEME_PATH_SECRET"]);
  });

  it("blocks a directory as a non-regular file", async () => {
    const directory = await fixtureDirectory();

    const report = await inspectMcpPromptFile(directory);

    expect(report).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "non-regular-file" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.file.not_regular"]);
  });

  it("blocks a final symbolic link before opening it", async () => {
    filesystemSpies.open.mockClear();
    filesystemSpies.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, isFile: () => false });

    const report = await inspectMcpPromptFile("LINK_PATH_SECRET.json");

    expect(report).toMatchObject({ status: "blocked", source: { bytesRead: 0 }, inspection: { complete: false, reason: "final-symlink" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.file.symlink"]);
    expect(filesystemSpies.open).not.toHaveBeenCalled();
    assertRedacted(report, ["LINK_PATH_SECRET"]);
  });

  it("blocks a real final symbolic link where the platform allows creating one", async (context) => {
    const directory = await fixtureDirectory();
    const target = await writeJson(directory, envelope([prompt()]), "target.json");
    const linkPath = path.join(directory, "LINK_PATH_SECRET.json");
    try {
      await symlink(target, linkPath, "file");
    } catch {
      context.skip("File symbolic links need extra privileges on this platform.");
    }

    const report = await inspectMcpPromptFile(linkPath);

    expect(report).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "final-symlink" } });
    assertRedacted(report, [linkPath, target, "LINK_PATH_SECRET"]);
  });

  it("does not read a file larger than one MiB", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "large.json");
    await writeFile(filePath, Buffer.alloc(1024 * 1024 + 1, 0x20));

    const report = await inspectMcpPromptFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", source: { bytesRead: 0 }, inspection: { complete: false, reason: "file-size-limit" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.file.too_large"]);
  });

  it("rejects a file that changes during the bounded read", async () => {
    const content = Buffer.from(JSON.stringify(envelope()));
    const unchanged = { dev: 1, ino: 2, size: content.length, mtimeMs: 10, ctimeMs: 10, isFile: () => true, isSymbolicLink: () => false };
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

    const report = await inspectMcpPromptFile("same-length-change-fixture.json");

    expect(report).toMatchObject({ status: "incomplete", inspection: { complete: false, reason: "file-changed" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.prompts_file.file.changed"]);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("validates supplied prompts but marks a page with a continuation cursor incomplete", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([prompt("PROMPT_SECRET"), { name: 4 }], { nextCursor: "CURSOR_SECRET" }));

    const { report, prompts } = await loadMcpPromptFileSnapshot(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, promptsChecked: 2, hasNextCursor: true, reason: "more-pages-present" }
    });
    expect(report.findings.map((finding) => [finding.id, finding.location])).toEqual([["plugin.catalog.prompt.name.invalid", { page: 1, promptIndex: 2 }]]);
    expect(prompts).toHaveLength(2);
    assertRedacted(report, ["CURSOR_SECRET", "PROMPT_SECRET"]);
  });

  it("treats an empty continuation cursor as present and opaque", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([], { nextCursor: "" }));

    await expect(inspectMcpPromptFile(filePath)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, promptsChecked: 0, hasNextCursor: true, reason: "more-pages-present" }
    });
  });

  it("enforces the five-hundred prompt and one-hundred finding bounds", async () => {
    const directory = await fixtureDirectory();
    const tooManyPrompts = await writeJson(directory, envelope(Array.from({ length: 501 }, (_, index) => prompt(`prompt-${index}`)), { nextCursor: "next" }), "too-many-prompts.json");
    const tooManyFindings = await writeJson(directory, envelope(Array.from({ length: 101 }, () => ({}))), "too-many-findings.json");

    await expect(inspectMcpPromptFile(tooManyPrompts)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, promptsChecked: 500, hasNextCursor: true, reason: "prompt-limit" }
    });
    const findingReport = await inspectMcpPromptFile(tooManyFindings);
    expect(findingReport).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, promptsChecked: 101, hasNextCursor: false, reason: "finding-limit" }
    });
    expect(findingReport.findings).toHaveLength(100);
  });

  it("completes exact prompt and finding limits when no additional entry exceeds them", async () => {
    const directory = await fixtureDirectory();
    const exactPrompts = await writeJson(directory, envelope(Array.from({ length: 500 }, (_, index) => prompt(`prompt-${index}`))), "exact-prompts.json");
    const exactFindings = await writeJson(directory, envelope(Array.from({ length: 100 }, () => ({}))), "exact-findings.json");

    await expect(inspectMcpPromptFile(exactPrompts)).resolves.toMatchObject({
      status: "pass",
      inspection: { complete: true, promptsChecked: 500, reason: null }
    });
    const findingReport = await inspectMcpPromptFile(exactFindings);
    expect(findingReport).toMatchObject({ status: "fail", inspection: { complete: true, promptsChecked: 100, reason: null } });
    expect(findingReport.findings).toHaveLength(100);
  });

  it("warns about exact duplicate prompt names, including prototype-like names", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([prompt("__proto__"), prompt("__proto__"), prompt("Echo"), prompt("echo")]));

    const report = await inspectMcpPromptFile(filePath);

    expect(report).toMatchObject({ status: "warn", inspection: { complete: true, promptsChecked: 4 } });
    expect(report.findings.map((finding) => [finding.id, finding.severity, finding.location])).toEqual([
      ["plugin.catalog.prompt.name.duplicate", "warn", { page: 1, promptIndex: 2, relatedPromptIndex: 1 }]
    ]);
    assertRedacted(report, ["__proto__", "Echo"]);
  });

  it("fails a duplicate argument name and locates it without naming it", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([prompt("p", { arguments: [{ name: "ARG_SECRET" }, { name: "ARG_SECRET", required: true }] })]));

    const report = await inspectMcpPromptFile(filePath);

    expect(report).toMatchObject({ status: "fail", inspection: { complete: true, promptsChecked: 1, reason: null } });
    expect(report.findings.map((finding) => [finding.id, finding.location])).toEqual([
      ["plugin.catalog.prompt.argument.name.duplicate", { page: 1, promptIndex: 1, argumentIndex: 2, relatedArgumentIndex: 1 }]
    ]);
    assertRedacted(report, ["ARG_SECRET"]);
  });
});
