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

import { inspectMcpResourceTemplateFile, loadMcpResourceTemplateFileSnapshot } from "../src/core/mcp-resource-template-file.js";

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-resource-template-file-"));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(resourceTemplates: unknown[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 3,
    result: {
      resultType: "complete",
      resourceTemplates,
      ttlMs: 300000,
      cacheScope: "public",
      ...extra
    }
  };
}

function template(name = "project-files", extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { uriTemplate: `file:///${name}/{path}`, name, ...extra };
}

async function writeJson(directory: string, value: unknown, name = "resource-templates.json"): Promise<string> {
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
      || !path.basename(canonicalDirectory).startsWith("mcp-resource-template-file-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("offline MCP resource template definition file inspection", () => {
  it("accepts a complete resources/templates/list JSON-RPC result without reporting template content", async () => {
    const directory = await fixtureDirectory();
    const value = envelope([{
      uriTemplate: "https://HOST_SECRET.example/PATH_SECRET/{VARIABLE_SECRET}",
      name: "NAME_SECRET",
      title: "TITLE_SECRET",
      description: "DESCRIPTION_SECRET",
      mimeType: "application/MIME_SECRET",
      icons: [{ src: "https://ICON_SECRET.example/icon.svg" }],
      annotations: { audience: ["ANNOTATION_SECRET"] },
      _meta: { key: "META_SECRET" }
    }]);
    const filePath = await writeJson(directory, value);

    const { report, templates } = await loadMcpResourceTemplateFileSnapshot(filePath);

    expect(report).toEqual({
      schemaVersion: 1,
      scope: "resource-template-definitions-file",
      status: "pass",
      source: { kind: "file", format: "mcp-resource-templates-list-response", bytesRead: Buffer.byteLength(JSON.stringify(value)) },
      inspection: { complete: true, templatesChecked: 1, hasNextCursor: false, reason: null },
      coverage: {
        definitions: "shape-only",
        discovery: "not-tested",
        serverCatalog: "not-tested",
        resourceRead: "not-tested",
        fullConformance: "not-tested"
      },
      findings: []
    });
    expect(templates).toEqual((value.result as { resourceTemplates: unknown[] }).resourceTemplates);
    assertRedacted(report, ["SECRET", filePath]);
  });

  it("accepts an initial UTF-8 BOM, zero templates, and a string id", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "bom.json");
    await writeFile(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify({ ...envelope(), id: "request-1" }))]));

    await expect(inspectMcpResourceTemplateFile(filePath)).resolves.toMatchObject({
      status: "pass",
      inspection: { complete: true, templatesChecked: 0, hasNextCursor: false, reason: null }
    });
  });

  it.each([
    ["a raw array", []],
    ["a result-only object", envelope().result],
    ["a prompts/list response", { jsonrpc: "2.0", id: 1, result: { resultType: "complete", prompts: [], ttlMs: 0, cacheScope: "public" } }],
    ["a resources/list response", { jsonrpc: "2.0", id: 1, result: { resultType: "complete", resources: [], ttlMs: 0, cacheScope: "public" } }],
    ["an error envelope", { jsonrpc: "2.0", id: 1, error: { code: -32602, message: "FILE_SECRET_SENTINEL" } }],
    ["both result and error", { ...envelope(), error: { code: -32602, message: "FILE_SECRET_SENTINEL" } }],
    ["a missing id", { jsonrpc: "2.0", result: envelope().result }],
    ["a null id", { ...envelope(), id: null }],
    ["an invalid JSON-RPC version", { ...envelope(), jsonrpc: "1.0" }],
    ["a non-complete result", envelope([], { resultType: "partial" })],
    ["missing cache metadata", { jsonrpc: "2.0", id: 1, result: { resultType: "complete", resourceTemplates: [] } }],
    ["a negative ttl", envelope([], { ttlMs: -1 })],
    ["a non-numeric ttl", envelope([], { ttlMs: "300000" })],
    ["an invalid cache scope", envelope([], { cacheScope: "shared" })],
    ["a non-array template list", envelope([], { resourceTemplates: { name: "FILE_SECRET_SENTINEL" } })],
    ["a non-string continuation cursor", envelope([], { nextCursor: 7 })]
  ])("keeps %s incomplete without exposing payload fields", async (_caseName, value) => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, value);

    const { report, templates } = await loadMcpResourceTemplateFileSnapshot(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, templatesChecked: 0, hasNextCursor: null, reason: "response-invalid" }
    });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.response.invalid"]);
    expect(report.findings[0].message).toContain("resources/templates/list");
    expect(templates).toBeNull();
    assertRedacted(report, ["FILE_SECRET_SENTINEL", filePath]);
  });

  it.each([
    ["an empty file", Buffer.alloc(0), "invalid-json", "plugin.resource_templates_file.json.invalid"],
    ["malformed JSON", Buffer.from('{"jsonrpc":'), "invalid-json", "plugin.resource_templates_file.json.invalid"],
    ["a second leading BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(envelope()))]), "invalid-json", "plugin.resource_templates_file.json.invalid"],
    ["invalid UTF-8", Buffer.from([0xc3, 0x28]), "invalid-utf8", "plugin.resource_templates_file.encoding.invalid"]
  ])("reports %s without returning source text", async (_caseName, content, reason, findingId) => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "untrusted-file-secret.json");
    await writeFile(filePath, content);

    const report = await inspectMcpResourceTemplateFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", source: { bytesRead: content.length }, inspection: { complete: false, reason } });
    expect(report.findings.map((finding) => [finding.id, finding.severity])).toEqual([[findingId, "fail"]]);
    assertRedacted(report, [filePath, "untrusted-file-secret"]);
  });

  it("classifies a missing file as incomplete and does not disclose its path", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "MISSING_PATH_SECRET.json");

    const report = await inspectMcpResourceTemplateFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", inspection: { complete: false, reason: "file-unavailable" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.file.unavailable"]);
    assertRedacted(report, [filePath, "MISSING_PATH_SECRET"]);
  });

  it.each([
    "https://URL_PATH_SECRET.example/resource-templates",
    "\\\\server\\share\\UNC_PATH_SECRET.json",
    "//server/share/UNC_PATH_SECRET.json",
    "\\\\?\\UNC\\server\\share\\DEVICE_PATH_SECRET.json",
    "\\\\.\\pipe\\DEVICE_PATH_SECRET",
    "file:/C:/SCHEME_PATH_SECRET.json"
  ])("blocks remote or device-shaped input before filesystem access: %s", async (filePath) => {
    filesystemSpies.lstat.mockClear();
    filesystemSpies.open.mockClear();

    const report = await inspectMcpResourceTemplateFile(filePath);

    expect(report).toMatchObject({ status: "blocked", source: { bytesRead: 0 }, inspection: { complete: false, reason: "offline-path-blocked" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.path.blocked"]);
    expect(filesystemSpies.lstat).not.toHaveBeenCalled();
    expect(filesystemSpies.open).not.toHaveBeenCalled();
    assertRedacted(report, [filePath, "URL_PATH_SECRET", "UNC_PATH_SECRET", "DEVICE_PATH_SECRET", "SCHEME_PATH_SECRET"]);
  });

  it("blocks a directory as a non-regular file", async () => {
    const directory = await fixtureDirectory();

    const report = await inspectMcpResourceTemplateFile(directory);

    expect(report).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "non-regular-file" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.file.not_regular"]);
  });

  it("blocks a final symbolic link before opening it", async () => {
    filesystemSpies.open.mockClear();
    filesystemSpies.lstat.mockResolvedValueOnce({ isSymbolicLink: () => true, isFile: () => false });

    const report = await inspectMcpResourceTemplateFile("LINK_PATH_SECRET.json");

    expect(report).toMatchObject({ status: "blocked", source: { bytesRead: 0 }, inspection: { complete: false, reason: "final-symlink" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.file.symlink"]);
    expect(filesystemSpies.open).not.toHaveBeenCalled();
    assertRedacted(report, ["LINK_PATH_SECRET"]);
  });

  it("blocks a real final symbolic link where the platform allows creating one", async (context) => {
    const directory = await fixtureDirectory();
    const target = await writeJson(directory, envelope([template()]), "target.json");
    const linkPath = path.join(directory, "LINK_PATH_SECRET.json");
    try {
      await symlink(target, linkPath, "file");
    } catch {
      context.skip("File symbolic links need extra privileges on this platform.");
    }

    const report = await inspectMcpResourceTemplateFile(linkPath);

    expect(report).toMatchObject({ status: "blocked", inspection: { complete: false, reason: "final-symlink" } });
    assertRedacted(report, [linkPath, target, "LINK_PATH_SECRET"]);
  });

  it("does not read a file larger than one MiB", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "large.json");
    await writeFile(filePath, Buffer.alloc(1024 * 1024 + 1, 0x20));

    const report = await inspectMcpResourceTemplateFile(filePath);

    expect(report).toMatchObject({ status: "incomplete", source: { bytesRead: 0 }, inspection: { complete: false, reason: "file-size-limit" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.file.too_large"]);
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

    const report = await inspectMcpResourceTemplateFile("same-length-change-fixture.json");

    expect(report).toMatchObject({ status: "incomplete", inspection: { complete: false, reason: "file-changed" } });
    expect(report.findings.map((finding) => finding.id)).toEqual(["plugin.resource_templates_file.file.changed"]);
    expect(handle.close).toHaveBeenCalledOnce();
  });

  it("validates supplied templates but marks a page with a continuation cursor incomplete", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([template("TEMPLATE_SECRET"), { name: "BROKEN_SECRET", uriTemplate: "file:///{UNCLOSED_SECRET" }], { nextCursor: "CURSOR_SECRET" }));

    const { report, templates } = await loadMcpResourceTemplateFileSnapshot(filePath);

    expect(report).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, templatesChecked: 2, hasNextCursor: true, reason: "more-pages-present" }
    });
    expect(report.findings.map((finding) => [finding.id, finding.location])).toEqual([
      ["plugin.catalog.resource_template.uri_template.invalid", { page: 1, templateIndex: 2 }]
    ]);
    expect(templates).toHaveLength(2);
    assertRedacted(report, ["CURSOR_SECRET", "TEMPLATE_SECRET", "BROKEN_SECRET", "UNCLOSED_SECRET"]);
  });

  it("treats an empty continuation cursor as present and opaque", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([], { nextCursor: "" }));

    await expect(inspectMcpResourceTemplateFile(filePath)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, templatesChecked: 0, hasNextCursor: true, reason: "more-pages-present" }
    });
  });

  it("enforces the five-hundred template and one-hundred finding bounds", async () => {
    const directory = await fixtureDirectory();
    const tooManyTemplates = await writeJson(directory, envelope(Array.from({ length: 501 }, (_, index) => template(`template-${index}`)), { nextCursor: "next" }), "too-many-templates.json");
    // Each unnamed entry yields exactly one finding and no duplicate-name warning.
    const tooManyFindings = await writeJson(directory, envelope(Array.from({ length: 101 }, () => ({ uriTemplate: "file:///{path}" }))), "too-many-findings.json");

    await expect(inspectMcpResourceTemplateFile(tooManyTemplates)).resolves.toMatchObject({
      status: "incomplete",
      inspection: { complete: false, templatesChecked: 500, hasNextCursor: true, reason: "template-limit" }
    });
    const findingReport = await inspectMcpResourceTemplateFile(tooManyFindings);
    expect(findingReport).toMatchObject({
      status: "incomplete",
      inspection: { complete: false, templatesChecked: 101, hasNextCursor: false, reason: "finding-limit" }
    });
    expect(findingReport.findings).toHaveLength(100);
  });

  it("completes exact template and finding limits when no additional entry exceeds them", async () => {
    const directory = await fixtureDirectory();
    const exactTemplates = await writeJson(directory, envelope(Array.from({ length: 500 }, (_, index) => template(`template-${index}`))), "exact-templates.json");
    const exactFindings = await writeJson(directory, envelope(Array.from({ length: 100 }, () => ({ uriTemplate: "file:///{path}" }))), "exact-findings.json");

    await expect(inspectMcpResourceTemplateFile(exactTemplates)).resolves.toMatchObject({
      status: "pass",
      inspection: { complete: true, templatesChecked: 500, reason: null }
    });
    const findingReport = await inspectMcpResourceTemplateFile(exactFindings);
    expect(findingReport).toMatchObject({ status: "fail", inspection: { complete: true, templatesChecked: 100, reason: null } });
    expect(findingReport.findings).toHaveLength(100);
  });

  it("warns about exact duplicate template names, including prototype-like names", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([template("__proto__"), template("__proto__"), template("Echo"), template("echo")]));

    const report = await inspectMcpResourceTemplateFile(filePath);

    expect(report).toMatchObject({ status: "warn", inspection: { complete: true, templatesChecked: 4 } });
    expect(report.findings.map((finding) => [finding.id, finding.severity, finding.location])).toEqual([
      ["plugin.catalog.resource_template.name.duplicate", "warn", { page: 1, templateIndex: 2, relatedTemplateIndex: 1 }]
    ]);
    assertRedacted(report, ["__proto__", "Echo"]);
  });

  it("fails invalid definition fields and locates them without values", async () => {
    const directory = await fixtureDirectory();
    const filePath = await writeJson(directory, envelope([
      template("ok"),
      { name: "NAME_SECRET", uriTemplate: "https://HOST_SECRET.example/{a b}", mimeType: 7 }
    ]));

    const report = await inspectMcpResourceTemplateFile(filePath);

    expect(report).toMatchObject({ status: "fail", inspection: { complete: true, templatesChecked: 2, reason: null } });
    expect(report.findings.map((finding) => [finding.id, finding.location])).toEqual([
      ["plugin.catalog.resource_template.uri_template.invalid", { page: 1, templateIndex: 2 }],
      ["plugin.catalog.resource_template.mime_type.invalid", { page: 1, templateIndex: 2 }]
    ]);
    assertRedacted(report, ["SECRET"]);
  });
});
