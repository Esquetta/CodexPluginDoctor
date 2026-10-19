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

import { compareMcpResourceTemplateFiles } from "../src/core/mcp-resource-template-diff.js";

const temporaryDirectories: string[] = [];

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-resource-template-diff-"));
  temporaryDirectories.push(directory);
  return directory;
}

function envelope(resourceTemplates: unknown[] = [], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id: 1,
    result: {
      resultType: "complete",
      resourceTemplates,
      ttlMs: 0,
      cacheScope: "public",
      ...extra
    }
  };
}

function template(name: string, uriTemplate = `file:///${name}/{path}`, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { uriTemplate, name, ...extra };
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
      || !path.basename(canonicalDirectory).startsWith("mcp-resource-template-diff-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("offline MCP resource template definition comparison", () => {
  it("ignores response metadata, object key order, and template list order", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      template("alpha", "file:///{path}", { description: "same", mimeType: "text/plain" }),
      template("beta", "db://{table}", { icons: [{ src: "a.svg", sizes: ["16x16"] }] })
    ], { ttlMs: 1, cacheScope: "private" }));
    const after = await writeJson(directory, "after.json", {
      jsonrpc: "2.0",
      id: "different-request-id",
      result: {
        resultType: "complete",
        resourceTemplates: [
          template("beta", "db://{table}", { icons: [{ sizes: ["16x16"], src: "a.svg" }] }),
          { mimeType: "text/plain", description: "same", name: "alpha", uriTemplate: "file:///{path}" }
        ],
        ttlMs: 999,
        cacheScope: "public"
      }
    });

    const report = await compareMcpResourceTemplateFiles(before, after);

    expect(report).toEqual({
      schemaVersion: 1,
      scope: "resource-template-definitions-diff",
      status: "pass",
      before: expect.objectContaining({ scope: "resource-template-definitions-file", status: "pass" }),
      after: expect.objectContaining({ scope: "resource-template-definitions-file", status: "pass" }),
      comparison: { complete: true, reason: null, added: 0, removed: 0, changed: 0, unchanged: 2, breaking: 0, unclassified: 0 },
      coverage: {
        comparison: "structural-only",
        definitions: "shape-only",
        compatibility: "not-tested",
        serverCatalog: "not-tested",
        resourceRead: "not-tested",
        impactClassification: "heuristic"
      },
      changes: []
    });
  });

  it("reports deterministic numeric locators for removals, changes, and additions without names, templates, or variables", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      template("REMOVED_SECRET", "https://REMOVED_HOST_SECRET.example/{REMOVED_VARIABLE_SECRET}"),
      template("CHANGED_SECRET", "https://BEFORE_HOST_SECRET.example/{GONE_VARIABLE_SECRET}", {
        title: "TITLE_BEFORE_SECRET", description: "VALUE_BEFORE_SECRET", mimeType: "text/MIME_BEFORE_SECRET", icons: [{ src: "ICON_BEFORE_SECRET" }]
      })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      template("CHANGED_SECRET", "https://AFTER_HOST_SECRET.example/{NEW_VARIABLE_SECRET}", {
        title: "TITLE_AFTER_SECRET", description: "VALUE_AFTER_SECRET", mimeType: "text/MIME_AFTER_SECRET", icons: [{ src: "ICON_AFTER_SECRET" }]
      }),
      template("ADDED_SECRET", "https://ADDED_HOST_SECRET.example/{ADDED_VARIABLE_SECRET}")
    ]));

    const report = await compareMcpResourceTemplateFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 1, removed: 1, changed: 1, unchanged: 0, breaking: 2, unclassified: 0 },
      changes: [
        { kind: "removed", beforeTemplateIndex: 1, afterTemplateIndex: null, fields: [], impact: "breaking", reasons: ["resource-template-removed"] },
        {
          kind: "changed", beforeTemplateIndex: 2, afterTemplateIndex: 1,
          fields: ["uriTemplate", "mimeType", "description", "title", "other"],
          impact: "breaking",
          reasons: [
            "resource-template-uri-changed",
            "resource-template-variable-removed",
            "resource-template-variable-added",
            "resource-template-mime-type-changed",
            "other-fields-unclassified"
          ]
        },
        { kind: "added", beforeTemplateIndex: null, afterTemplateIndex: 2, fields: [], impact: "compatible", reasons: [] }
      ]
    });
    for (const change of report.changes) {
      expect(change).not.toHaveProperty("name");
      expect(change).not.toHaveProperty("locations");
    }
    assertRedacted(report, ["SECRET", "https://", "icons"]);
  });

  it("counts compatible, breaking, and unclassified changes", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      template("compatible", "file:///{path}", { title: "Files" }),
      template("breaking", "file:///{path}"),
      template("unclassified", "file:///{path}", { mimeType: "text/plain" })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      template("compatible", "file:///{path}", { title: "Project files", description: "All files" }),
      template("breaking", "file:///{+path}"),
      template("unclassified", "file:///{path}", { mimeType: "text/markdown" })
    ]));

    const report = await compareMcpResourceTemplateFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, changed: 3, breaking: 1, unclassified: 1 },
      changes: [
        { beforeTemplateIndex: 1, fields: ["description", "title"], impact: "compatible", reasons: [] },
        { beforeTemplateIndex: 2, fields: ["uriTemplate"], impact: "breaking", reasons: ["resource-template-uri-changed"] },
        { beforeTemplateIndex: 3, fields: ["mimeType"], impact: "unclassified", reasons: ["resource-template-mime-type-changed"] }
      ]
    });
  });

  it("adds template names and variable locations only when asked to show names, and never URI templates", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([
      template("removed_template", "https://REMOVED_HOST_SECRET.example/{id}"),
      template("project_files", "https://PROJECT_HOST_SECRET.example/{owner}/{repo}", { icons: [] })
    ]));
    const after = await writeJson(directory, "after.json", envelope([
      template("project_files", "https://PROJECT_HOST_SECRET.example/{owner}/{repository}{?ref}", { icons: [{ src: "x" }] }),
      template("added_template", "https://ADDED_HOST_SECRET.example/{id}")
    ]));

    const shown = await compareMcpResourceTemplateFiles(before, after, { showNames: true });
    expect(shown.changes).toEqual([
      { kind: "removed", name: "removed_template", beforeTemplateIndex: 1, afterTemplateIndex: null, fields: [], impact: "breaking", reasons: ["resource-template-removed"] },
      {
        kind: "changed", name: "project_files", beforeTemplateIndex: 2, afterTemplateIndex: 1, fields: ["uriTemplate", "other"], impact: "breaking",
        reasons: ["resource-template-uri-changed", "resource-template-variable-removed", "resource-template-variable-added", "other-fields-unclassified"],
        locations: [
          { reason: "resource-template-variable-removed", variable: "repo" },
          { reason: "resource-template-variable-added", variable: "repository" },
          { reason: "resource-template-variable-added", variable: "ref" },
          { reason: "resource-template-uri-changed", variable: null },
          { reason: "other-fields-unclassified", variable: null }
        ]
      },
      { kind: "added", name: "added_template", beforeTemplateIndex: null, afterTemplateIndex: 2, fields: [], impact: "compatible", reasons: [] }
    ]);
    assertRedacted(shown, ["HOST_SECRET", "https://", "{owner}", "{?ref}"]);

    const hidden = await compareMcpResourceTemplateFiles(before, after);
    expect(hidden.changes).toEqual(shown.changes.map(({ name: _name, locations: _locations, ...change }) => change));
    expect(JSON.stringify(hidden)).not.toMatch(/removed_template|added_template|project_files|"owner"|"repo"|repository|"ref"|locations|HOST_SECRET/u);
  });

  it("treats a missing unknown field differently from explicit null", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([template("same", undefined, { extensionValue: null })]));
    const after = await writeJson(directory, "after.json", envelope([template("same")]));

    await expect(compareMcpResourceTemplateFiles(before, after)).resolves.toMatchObject({
      status: "warn",
      comparison: { complete: true, changed: 1, unchanged: 0 },
      changes: [{ kind: "changed", beforeTemplateIndex: 1, afterTemplateIndex: 1, fields: ["other"], impact: "unclassified", reasons: ["other-fields-unclassified"] }]
    });
  });

  it("does not read either valid source more than once", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([template("before")]));
    const after = await writeJson(directory, "after.json", envelope([template("after")]));
    filesystemSpies.open.mockClear();

    await compareMcpResourceTemplateFiles(before, after);

    expect(filesystemSpies.open).toHaveBeenCalledTimes(2);
  });

  it("refuses ambiguous exact duplicate names including prototype-like names", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([template("__proto__")]));
    const after = await writeJson(directory, "after.json", envelope([template("__proto__"), template("__proto__", "file:///other/{path}")]));

    const report = await compareMcpResourceTemplateFiles(before, after, { showNames: true });

    expect(report).toMatchObject({
      status: "incomplete",
      after: { status: "warn", inspection: { complete: true } },
      comparison: { complete: false, reason: "ambiguous-names", added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null },
      changes: []
    });
    assertRedacted(report, ["__proto__", "file:///"]);
  });

  it("skips comparison for invalid definitions after retaining both complete reports", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope([template("t", "https://HOST_SECRET.example/{UNCLOSED_SECRET")]));
    const after = await writeJson(directory, "after.json", envelope([template("t")]));

    const report = await compareMcpResourceTemplateFiles(before, after);

    expect(report).toMatchObject({
      status: "incomplete",
      before: { status: "fail", inspection: { complete: true }, findings: [{ id: "plugin.catalog.resource_template.uri_template.invalid" }] },
      after: { status: "pass" },
      comparison: { complete: false, reason: "invalid-definitions", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
    assertRedacted(report, ["SECRET"]);
  });

  it("gives blocked inputs precedence over incomplete inputs", async () => {
    const directory = await fixtureDirectory();
    const missing = path.join(directory, "MISSING_SECRET.json");

    const report = await compareMcpResourceTemplateFiles(missing, "https://BLOCKED_SECRET.example/resource-templates");

    expect(report).toMatchObject({
      status: "blocked",
      before: { status: "incomplete", inspection: { reason: "file-unavailable" } },
      after: { status: "blocked", inspection: { reason: "offline-path-blocked" } },
      comparison: { complete: false, reason: "input-blocked", added: null, removed: null, changed: null, unchanged: null },
      changes: []
    });
    assertRedacted(report, ["BLOCKED_SECRET", "MISSING_SECRET", missing]);
  });

  it("skips incomplete paged and bounded inputs without exposing cursors or template data", async () => {
    const directory = await fixtureDirectory();
    const valid = await writeJson(directory, "valid.json", envelope([template("secret-template")]));
    const inputs = {
      "more-pages-present": await writeJson(directory, "cursor.json", envelope([template("secret-template")], { nextCursor: "CURSOR_SECRET" })),
      "template-limit": await writeJson(directory, "over-limit.json", envelope(Array.from({ length: 501 }, (_, index) => template(`template-${index}`)))),
      "finding-limit": await writeJson(directory, "finding-limit.json", envelope(Array.from({ length: 101 }, () => ({ uriTemplate: "file:///{path}" })))),
      "response-invalid": await writeJson(directory, "invalid.json", { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "ERROR_SECRET" } }),
      "file-size-limit": path.join(directory, "oversized.json")
    };
    await writeFile(inputs["file-size-limit"], Buffer.alloc(1024 * 1024 + 1));

    for (const [reason, input] of Object.entries(inputs)) {
      const report = await compareMcpResourceTemplateFiles(valid, input);
      expect(report).toMatchObject({
        status: "incomplete",
        before: { status: "pass" },
        after: { status: "incomplete", inspection: { reason } },
        comparison: { complete: false, reason: "input-incomplete", added: null },
        changes: []
      });
      assertRedacted(report, ["secret-template", "CURSOR_SECRET", "ERROR_SECRET", "file:///"]);
    }
  });

  it("has a bounded one-thousand-record maximum from two complete five-hundred-template inputs", async () => {
    const directory = await fixtureDirectory();
    const before = await writeJson(directory, "before.json", envelope(Array.from({ length: 500 }, (_, index) => template(`before-${index}`))));
    const after = await writeJson(directory, "after.json", envelope(Array.from({ length: 500 }, (_, index) => template(`after-${index}`))));

    const report = await compareMcpResourceTemplateFiles(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, reason: null, added: 500, removed: 500, changed: 0, unchanged: 0, breaking: 500, unclassified: 0 }
    });
    expect(report.changes).toHaveLength(1000);
    expect(report.changes[0]).toEqual({ kind: "removed", beforeTemplateIndex: 1, afterTemplateIndex: null, fields: [], impact: "breaking", reasons: ["resource-template-removed"] });
    expect(report.changes[999]).toEqual({ kind: "added", beforeTemplateIndex: null, afterTemplateIndex: 500, fields: [], impact: "compatible", reasons: [] });
  });
});
