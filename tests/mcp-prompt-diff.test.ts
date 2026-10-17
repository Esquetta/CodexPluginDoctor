import { afterEach, describe, expect, it, vi } from "vitest";

const filesystemSpies = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  filesystemSpies.open.mockImplementation(actual.open);
  return { ...actual, open: filesystemSpies.open };
});

import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compareMcpPromptFiles } from "../src/core/mcp-prompt-diff.js";

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-prompt-diff-"));
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
      ttlMs: 0,
      cacheScope: "public",
      ...extra
    }
  };
}

function prompt(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { name, ...extra };
}

async function writeJson(directory: string, name: string, value: unknown): Promise<string> {
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
      || !path.basename(canonicalDirectory).startsWith("mcp-prompt-diff-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("offline MCP prompt definition comparison", () => {
  it("ignores response metadata, object key order, and prompt list order", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      prompt("alpha", { description: "same", arguments: [{ name: "a", required: true, description: "x" }] }),
      prompt("beta", { icons: [{ src: "a.svg", sizes: ["16x16"] }] })
    ], { ttlMs: 1, cacheScope: "private" }));
    const after = await writeJson(directory, "after.json", {
      jsonrpc: "2.0",
      id: "different-request-id",
      result: {
        resultType: "complete",
        prompts: [
          prompt("beta", { icons: [{ sizes: ["16x16"], src: "a.svg" }] }),
          { arguments: [{ description: "x", required: true, name: "a" }], description: "same", name: "alpha" }
        ],
        ttlMs: 999,
        cacheScope: "public"
      }
    });

    const report = await compareMcpPromptFiles(before, after);

    expect(report).toEqual({
      schemaVersion: 1,
      scope: "prompt-definitions-diff",
      status: "pass",
      before: expect.objectContaining({ scope: "prompt-definitions-file", status: "pass" }),
      after: expect.objectContaining({ scope: "prompt-definitions-file", status: "pass" }),
      comparison: { complete: true, reason: null, added: 0, removed: 0, changed: 0, unchanged: 2, breaking: 0, unclassified: 0 },
      coverage: {
        comparison: "structural-only",
        definitions: "shape-only",
        compatibility: "not-tested",
        serverCatalog: "not-tested",
        promptRetrieval: "not-tested",
        impactClassification: "heuristic"
      },
      changes: []
    });
  });

  it("reports deterministic numeric locators for removals, changes, and additions without names", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      prompt("REMOVED_SECRET"),
      prompt("CHANGED_SECRET", {
        title: "TITLE_BEFORE_SECRET", description: "VALUE_BEFORE_SECRET", icons: [{ src: "ICON_BEFORE_SECRET" }],
        arguments: [{ name: "ARGUMENT_SECRET", description: "ARGUMENT_BEFORE_SECRET" }]
      })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      prompt("CHANGED_SECRET", { title: "TITLE_AFTER_SECRET", description: "VALUE_AFTER_SECRET", icons: [{ src: "ICON_AFTER_SECRET" }], arguments: [] }),
      prompt("ADDED_SECRET", { arguments: [{ name: "NEW_ARGUMENT_SECRET", required: true }] })
    ]));

    const report = await compareMcpPromptFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 1, removed: 1, changed: 1, unchanged: 0, breaking: 2, unclassified: 0 },
      changes: [
        { kind: "removed", beforePromptIndex: 1, afterPromptIndex: null, fields: [], impact: "breaking", reasons: ["prompt-removed"] },
        {
          kind: "changed", beforePromptIndex: 2, afterPromptIndex: 1,
          fields: ["arguments", "description", "title", "other"],
          impact: "breaking",
          reasons: ["prompt-argument-removed", "other-fields-unclassified"]
        },
        { kind: "added", beforePromptIndex: null, afterPromptIndex: 2, fields: [], impact: "compatible", reasons: [] }
      ]
    });
    for (const change of report.changes) {
      expect(change).not.toHaveProperty("name");
      expect(change).not.toHaveProperty("locations");
    }
    assertRedacted(report, ["SECRET", "icons"]);
  });

  it("counts compatible, breaking, and unclassified changes", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      prompt("compatible", { arguments: [{ name: "a", required: true }] }),
      prompt("breaking", { arguments: [{ name: "a" }] }),
      prompt("unclassified", { _meta: { version: 1 } })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      prompt("compatible", { arguments: [{ name: "a" }, { name: "b", required: false }] }),
      prompt("breaking", { arguments: [{ name: "a", required: true }] }),
      prompt("unclassified", { _meta: { version: 2 } })
    ]));

    const report = await compareMcpPromptFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, changed: 3, breaking: 1, unclassified: 1 },
      changes: [
        { beforePromptIndex: 1, fields: ["arguments"], impact: "compatible", reasons: [] },
        { beforePromptIndex: 2, fields: ["arguments"], impact: "breaking", reasons: ["prompt-argument-now-required"] },
        { beforePromptIndex: 3, fields: ["other"], impact: "unclassified", reasons: ["other-fields-unclassified"] }
      ]
    });
  });

  it("adds prompt names and argument locations only when asked to show names", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      prompt("removed_prompt"),
      prompt("code_review", { icons: [], arguments: [{ name: "code", required: true }, { name: "style" }] })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      prompt("code_review", { icons: [{ src: "x" }], arguments: [{ name: "style", required: true }, { name: "language", required: true }] }),
      prompt("added_prompt")
    ]));

    const shown = await compareMcpPromptFiles(before, after, { showNames: true });
    expect(shown.changes).toEqual([
      { kind: "removed", name: "removed_prompt", beforePromptIndex: 1, afterPromptIndex: null, fields: [], impact: "breaking", reasons: ["prompt-removed"] },
      {
        kind: "changed", name: "code_review", beforePromptIndex: 2, afterPromptIndex: 1, fields: ["arguments", "other"], impact: "breaking",
        reasons: ["prompt-argument-removed", "prompt-required-argument-added", "prompt-argument-now-required", "other-fields-unclassified"],
        locations: [
          { reason: "prompt-argument-removed", argument: "code" },
          { reason: "prompt-argument-now-required", argument: "style" },
          { reason: "prompt-required-argument-added", argument: "language" },
          { reason: "other-fields-unclassified", argument: null }
        ]
      },
      { kind: "added", name: "added_prompt", beforePromptIndex: null, afterPromptIndex: 2, fields: [], impact: "compatible", reasons: [] }
    ]);

    const hidden = await compareMcpPromptFiles(before, after);
    expect(hidden.changes).toEqual(shown.changes.map(({ name: _name, locations: _locations, ...change }) => change));
    expect(JSON.stringify(hidden)).not.toMatch(/removed_prompt|added_prompt|code_review|"code"|style|language|locations/u);
  });

  it("treats a missing unknown field differently from explicit null", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([prompt("same", { extensionValue: null })]));
    const after = await writeJson(directory, "after.json", envelope([prompt("same")]));

    await expect(compareMcpPromptFiles(before, after)).resolves.toMatchObject({
      status: "warn",
      comparison: { complete: true, changed: 1, unchanged: 0 },
      changes: [{ kind: "changed", beforePromptIndex: 1, afterPromptIndex: 1, fields: ["other"], impact: "unclassified", reasons: ["other-fields-unclassified"] }]
    });
  });

  it("does not read either valid source more than once", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([prompt("before")]));
    const after = await writeJson(directory, "after.json", envelope([prompt("after")]));
    filesystemSpies.open.mockClear();

    await compareMcpPromptFiles(before, after);

    expect(filesystemSpies.open).toHaveBeenCalledTimes(2);
  });

  it("refuses ambiguous exact duplicate names including prototype-like names", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([prompt("__proto__")]));
    const after = await writeJson(directory, "after.json", envelope([prompt("__proto__"), prompt("__proto__", { description: "x" })]));

    const report = await compareMcpPromptFiles(before, after, { showNames: true });

    expect(report).toMatchObject({
      status: "incomplete",
      after: { status: "warn", inspection: { complete: true } },
      comparison: { complete: false, reason: "ambiguous-names", added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null },
      changes: []
    });
    assertRedacted(report, ["__proto__"]);
  });

  it("skips comparison for invalid definitions after retaining both complete reports", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([prompt("p", { arguments: [{ name: "ARG_SECRET" }, { name: "ARG_SECRET" }] })]));
    const after = await writeJson(directory, "after.json", envelope([prompt("p")]));

    const report = await compareMcpPromptFiles(before, after);

    expect(report).toMatchObject({
      status: "incomplete",
      before: { status: "fail", inspection: { complete: true }, findings: [{ id: "plugin.catalog.prompt.argument.name.duplicate" }] },
      after: { status: "pass" },
      comparison: { complete: false, reason: "invalid-definitions", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
    assertRedacted(report, ["ARG_SECRET"]);
  });

  it("gives blocked inputs precedence over incomplete inputs", async () => {
    const directory = await fixtureDirectory();
    const missing = path.join(directory, "MISSING_SECRET.json");

    const report = await compareMcpPromptFiles(missing, "https://BLOCKED_SECRET.example/prompts");

    expect(report).toMatchObject({
      status: "blocked",
      before: { status: "incomplete", inspection: { reason: "file-unavailable" } },
      after: { status: "blocked", inspection: { reason: "offline-path-blocked" } },
      comparison: { complete: false, reason: "input-blocked", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
    assertRedacted(report, ["BLOCKED_SECRET", "MISSING_SECRET", missing]);
  });

  it("skips incomplete paged and bounded inputs without exposing cursors or prompt data", async () => {
    const directory = await fixtureDirectory();
    const valid = await writeJson(directory, "valid.json", envelope([prompt("secret-prompt")]));
    const inputs = {
      "more-pages-present": await writeJson(directory, "cursor.json", envelope([prompt("secret-prompt")], { nextCursor: "CURSOR_SECRET" })),
      "prompt-limit": await writeJson(directory, "over-limit.json", envelope(Array.from({ length: 501 }, (_, index) => prompt(`prompt-${index}`)))),
      "finding-limit": await writeJson(directory, "finding-limit.json", envelope(Array.from({ length: 101 }, () => ({})))),
      "response-invalid": await writeJson(directory, "invalid.json", { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "ERROR_SECRET" } }),
      "file-size-limit": path.join(directory, "oversized.json")
    };
    await writeFile(inputs["file-size-limit"], Buffer.alloc(1024 * 1024 + 1));

    for (const [reason, input] of Object.entries(inputs)) {
      const report = await compareMcpPromptFiles(valid, input);
      expect(report).toMatchObject({
        status: "incomplete",
        before: { status: "pass" },
        after: { status: "incomplete", inspection: { reason } },
        comparison: { complete: false, reason: "input-incomplete", added: null },
        changes: []
      });
      assertRedacted(report, ["secret-prompt", "CURSOR_SECRET", "ERROR_SECRET"]);
    }
  });

  it("has a bounded one-thousand-record maximum from two complete five-hundred-prompt inputs", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope(Array.from({ length: 500 }, (_, index) => prompt(`before-${index}`))));
    const after = await writeJson(directory, "after.json", envelope(Array.from({ length: 500 }, (_, index) => prompt(`after-${index}`))));

    const report = await compareMcpPromptFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 500, removed: 500, changed: 0, unchanged: 0, breaking: 500, unclassified: 0 }
    });
    expect(report.changes).toHaveLength(1000);
    expect(report.changes[0]).toEqual({ kind: "removed", beforePromptIndex: 1, afterPromptIndex: null, fields: [], impact: "breaking", reasons: ["prompt-removed"] });
    expect(report.changes[999]).toEqual({ kind: "added", beforePromptIndex: null, afterPromptIndex: 500, fields: [], impact: "compatible", reasons: [] });
  });
});
