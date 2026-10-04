import { afterEach, describe, expect, it, vi } from "vitest";

const filesystemSpies = vi.hoisted(() => ({ open: vi.fn(), originalOpen: null as unknown }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  filesystemSpies.originalOpen = actual.open;
  filesystemSpies.open.mockImplementation(actual.open);
  return { ...actual, open: filesystemSpies.open };
});

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compareMcpToolFiles } from "../src/core/mcp-tool-diff.js";

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-tool-diff-"));
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

function tool(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, inputSchema: {}, ...extra };
}

async function writeJson(directory: string, name: string, value: unknown): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify(value), "utf8");
  return filePath;
}

async function writeRawJson(directory: string, name: string, value: string): Promise<string> {
  const filePath = path.join(directory, name);
  await writeFile(filePath, value, "utf8");
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
      || !path.basename(canonicalDirectory).startsWith("mcp-tool-diff-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("offline MCP tool definition comparison", () => {
  it("ignores response metadata, object key order, and tool list order", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      tool("alpha", { description: "same", inputSchema: { type: "object", properties: { b: { type: "string" }, a: { type: "number" } } } }),
      tool("beta", { annotations: { readOnlyHint: true } })
    ], { ttlMs: 1, cacheScope: "private" }));
    const after = await writeJson(directory, "after.json", {
      jsonrpc: "2.0",
      id: "different-request-id",
      result: {
        resultType: "complete",
        tools: [
          tool("beta", { annotations: { readOnlyHint: true } }),
          tool("alpha", { description: "same", inputSchema: { properties: { a: { type: "number" }, b: { type: "string" } }, type: "object" } })
        ],
        ttlMs: 999,
        cacheScope: "public"
      }
    });

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      schemaVersion: 1,
      scope: "tool-definitions-diff",
      status: "pass",
      comparison: { complete: true, reason: null, added: 0, removed: 0, changed: 0, unchanged: 2 },
      coverage: { comparison: "structural-only", schema: "root-shape-only", compatibility: "not-tested", serverCatalog: "not-tested", toolExecution: "not-tested" },
      changes: []
    });
  });

  it("reports deterministic numeric locators for removals changes and additions", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      tool("REMOVED_SECRET"),
      tool("CHANGED_SECRET", { inputSchema: { type: "object" }, outputSchema: { type: "string" }, description: "VALUE_BEFORE_SECRET", title: "TITLE_BEFORE_SECRET", annotations: { destructiveHint: false }, vendorField: "VALUE_BEFORE_SECRET" })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      tool("CHANGED_SECRET", { inputSchema: { type: "array" }, outputSchema: { type: "number" }, description: "VALUE_AFTER_SECRET", title: "TITLE_AFTER_SECRET", annotations: { destructiveHint: true }, vendorField: "VALUE_AFTER_SECRET" }),
      tool("ADDED_SECRET")
    ]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 1, removed: 1, changed: 1, unchanged: 0, breaking: 2, unclassified: 0 },
      coverage: { impactClassification: "heuristic" },
      changes: [
        { kind: "removed", beforeToolIndex: 1, afterToolIndex: null, fields: [], impact: "breaking", reasons: ["tool-removed"] },
        {
          kind: "changed", beforeToolIndex: 2, afterToolIndex: 1,
          fields: ["inputSchema", "outputSchema", "description", "title", "annotations", "other"],
          impact: "breaking",
          reasons: ["input-type-narrowed", "output-type-widened", "annotation-safety-reduced", "other-fields-unclassified"]
        },
        { kind: "added", beforeToolIndex: null, afterToolIndex: 2, fields: [], impact: "compatible", reasons: [] }
      ]
    });
    assertRedacted(report, ["REMOVED_SECRET", "CHANGED_SECRET", "ADDED_SECRET", "VALUE_BEFORE_SECRET", "VALUE_AFTER_SECRET", "vendorField"]);
  });

  it("counts compatible, breaking, and unclassified changes without exposing property names", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      tool("compatible", { inputSchema: { type: "object", properties: { KEEP_SECRET: { type: "string" } } } }),
      tool("breaking", { inputSchema: { type: "object", properties: { OPTIONAL_SECRET: { type: "string" } } } }),
      tool("unclassified", { inputSchema: { type: "object", properties: { LIMIT_SECRET: { type: "string", maxLength: 9 } } } })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      tool("compatible", { inputSchema: { type: "object", properties: { KEEP_SECRET: { type: "string" }, NEW_SECRET: { type: "number" } } } }),
      tool("breaking", { inputSchema: { type: "object", properties: { OPTIONAL_SECRET: { type: "string" } }, required: ["OPTIONAL_SECRET"] } }),
      tool("unclassified", { inputSchema: { type: "object", properties: { LIMIT_SECRET: { type: "string", maxLength: 3 } } } })
    ]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, changed: 3, breaking: 1, unclassified: 1 },
      changes: [
        { beforeToolIndex: 1, impact: "compatible", reasons: [] },
        { beforeToolIndex: 2, impact: "breaking", reasons: ["input-required-added"] },
        { beforeToolIndex: 3, impact: "unclassified", reasons: ["input-schema-unclassified"] }
      ]
    });
    assertRedacted(report, ["KEEP_SECRET", "NEW_SECRET", "OPTIONAL_SECRET", "LIMIT_SECRET"]);
  });

  it("treats missing fields null primitive changes arrays and deeply nested schema content structurally", async () => {
    const directory = await fixtureDirectory();
    const nestedBefore: Record<string, unknown> = {};
    const nestedAfter: Record<string, unknown> = {};
    let beforeCursor = nestedBefore;
    let afterCursor = nestedAfter;
    for (let index = 0; index < 2000; index += 1) {
      beforeCursor.next = {};
      afterCursor.next = {};
      beforeCursor = beforeCursor.next as Record<string, unknown>;
      afterCursor = afterCursor.next as Record<string, unknown>;
    }
    beforeCursor.value = "before";
    afterCursor.value = "after";
    const before = await writeJson(directory, "before.json", envelope([
      tool("shape", { annotations: [1, 2], vendor: false, vendorNull: null, inputSchema: nestedBefore })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      tool("shape", { annotations: [2, 1], vendor: true, inputSchema: nestedAfter })
    ]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 0, removed: 0, changed: 1, unchanged: 0 },
      changes: [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["inputSchema", "annotations", "other"] }]
    });
  });

  it("retains completed source warnings while still comparing valid definitions", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([tool("name with spaces")]));
    const after = await writeJson(directory, "after.json", envelope([tool("name with spaces", { description: "changed" })]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      before: { status: "warn", inspection: { complete: true } },
      after: { status: "warn", inspection: { complete: true } },
      comparison: { complete: true, reason: null, changed: 1 },
      changes: [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["description"] }]
    });
  });

  it("returns warn with a complete comparison when retained warnings have no differences", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([tool("name with spaces")]));
    const after = await writeJson(directory, "after.json", envelope([tool("name with spaces")]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      before: { status: "warn" },
      after: { status: "warn" },
      comparison: { complete: true, reason: null, added: 0, removed: 0, changed: 0, unchanged: 1 },
      changes: []
    });
  });

  it("does not read either valid source more than once", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([tool("before")]));
    const after = await writeJson(directory, "after.json", envelope([tool("after")]));
    filesystemSpies.open.mockClear();

    await compareMcpToolFiles(before, after);

    expect(filesystemSpies.open).toHaveBeenCalledTimes(2);
  });

  it("treats a missing unknown field differently from explicit null", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([tool("same", { extensionValue: null })]));
    const after = await writeJson(directory, "after.json", envelope([tool("same")]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 0, removed: 0, changed: 1, unchanged: 0 },
      changes: [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["other"] }]
    });
  });

  it("compares more than ten thousand nested JSON levels without recursive traversal", async () => {
    const directory = await fixtureDirectory();
    const depth = 12_000;
    const beforeSchema = `${"{\"next\":".repeat(depth)}\"before\"${"}".repeat(depth)}`;
    const afterSchema = `${"{\"next\":".repeat(depth)}\"after\"${"}".repeat(depth)}`;
    const before = await writeRawJson(directory, "before.json", `{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"resultType\":\"complete\",\"tools\":[{\"name\":\"deep\",\"inputSchema\":${beforeSchema}}],\"ttlMs\":0,\"cacheScope\":\"public\"}}`);
    const after = await writeRawJson(directory, "after.json", `{\"jsonrpc\":\"2.0\",\"id\":0,\"result\":{\"resultType\":\"complete\",\"tools\":[{\"name\":\"deep\",\"inputSchema\":${afterSchema}}],\"ttlMs\":0,\"cacheScope\":\"public\"}}`);

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, changed: 1 },
      changes: [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["inputSchema"] }]
    });
  });

  it("refuses ambiguous exact duplicate names including prototype-like names", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([tool("__proto__"), tool("__proto__")]));
    const after = await writeJson(directory, "after.json", envelope([tool("__proto__")]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "incomplete",
      comparison: { complete: false, reason: "ambiguous-names", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
    assertRedacted(report, ["__proto__"]);
  });

  it("skips comparison for invalid definitions after retaining both complete reports", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([{ name: "invalid", inputSchema: null }]));
    const after = await writeJson(directory, "after.json", envelope([tool("valid")]));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "incomplete",
      before: { status: "fail", inspection: { complete: true } },
      comparison: { complete: false, reason: "invalid-definitions", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
  });

  it("gives blocked inputs precedence over incomplete inputs", async () => {
    const directory = await fixtureDirectory();
    const missing = path.join(directory, "MISSING_SECRET.json");

    const report = await compareMcpToolFiles("https://BLOCKED_SECRET.example/tools", missing);

    expect(report).toMatchObject({
      status: "blocked",
      comparison: { complete: false, reason: "input-blocked", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
    assertRedacted(report, ["BLOCKED_SECRET", "MISSING_SECRET", missing]);
  });

  it("skips incomplete paged and bounded inputs without exposing cursors or tool data", async () => {
    const directory = await fixtureDirectory();
    const cursorBefore = await writeJson(directory, "cursor-before.json", envelope([tool("secret-tool")], { nextCursor: "" }));
    const validAfter = await writeJson(directory, "after.json", envelope([tool("secret-tool")]));
    const overLimit = await writeJson(directory, "over-limit.json", envelope(Array.from({ length: 501 }, (_, index) => tool(`tool-${index}`))));
    const findingLimit = await writeJson(directory, "finding-limit.json", envelope(Array.from({ length: 101 }, () => ({ inputSchema: {} }))));
    const malformed = await writeRawJson(directory, "malformed.json", "{\"jsonrpc\":");
    const oversized = path.join(directory, "oversized.json");
    await writeFile(oversized, Buffer.alloc(1024 * 1024 + 1));

    const cursorReport = await compareMcpToolFiles(cursorBefore, validAfter);
    const limitReport = await compareMcpToolFiles(overLimit, validAfter);
    const findingReport = await compareMcpToolFiles(findingLimit, validAfter);
    const malformedReport = await compareMcpToolFiles(malformed, validAfter);
    const oversizedReport = await compareMcpToolFiles(oversized, validAfter);

    expect(cursorReport).toMatchObject({ status: "incomplete", comparison: { complete: false, reason: "input-incomplete" }, changes: [] });
    expect(limitReport).toMatchObject({ status: "incomplete", before: { inspection: { reason: "tool-limit" } }, comparison: { complete: false, reason: "input-incomplete" }, changes: [] });
    expect(findingReport).toMatchObject({ status: "incomplete", before: { inspection: { reason: "finding-limit" } }, comparison: { complete: false, reason: "input-incomplete" }, changes: [] });
    expect(malformedReport).toMatchObject({ status: "incomplete", before: { inspection: { reason: "invalid-json" } }, comparison: { complete: false, reason: "input-incomplete" }, changes: [] });
    expect(oversizedReport).toMatchObject({ status: "incomplete", before: { inspection: { reason: "file-size-limit" } }, comparison: { complete: false, reason: "input-incomplete" }, changes: [] });
    assertRedacted(cursorReport, ["secret-tool"]);
  });

  it("has a bounded one-thousand-record maximum from two complete five-hundred-tool inputs", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope(Array.from({ length: 500 }, (_, index) => tool(`before-${index}`))));
    const after = await writeJson(directory, "after.json", envelope(Array.from({ length: 500 }, (_, index) => tool(`after-${index}`))));

    const report = await compareMcpToolFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 500, removed: 500, changed: 0, unchanged: 0 }
    });
    expect(report.changes).toHaveLength(1000);
    expect(report.changes[0]).toEqual({ kind: "removed", beforeToolIndex: 1, afterToolIndex: null, fields: [], impact: "breaking", reasons: ["tool-removed"] });
    expect(report.changes[999]).toEqual({ kind: "added", beforeToolIndex: null, afterToolIndex: 500, fields: [], impact: "compatible", reasons: [] });
  });
});
