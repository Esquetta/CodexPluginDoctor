import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveMcpSnapshot, type McpServerSurface, type McpSnapshot, type McpSnapshotListKey } from "../src/core/mcp-snapshot.js";
import { compareMcpSnapshotDirectories } from "../src/core/mcp-snapshot-diff.js";
import type { CatalogStatus } from "../src/core/mcp-tool-catalog.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";
import { renderMcpSnapshotDiffMarkdown } from "../src/reporting/render-mcp-snapshot-diff-markdown.js";
import { renderMcpSnapshotDiffReport } from "../src/reporting/render-mcp-snapshot-diff-report.js";
import { violations } from "./helpers/json-schema-violations.js";

const schemaOf = (id: string) => buildDoctorOutputContract().schemas.find((schema) => schema.id === id)!.schema as Record<string, unknown>;
const diffSchema = schemaOf("doctor.mcp-snapshot.diff.json");
const manifestSchema = schemaOf("doctor.mcp-snapshot.manifest.json");

const tools = [{ name: "lookup", inputSchema: { type: "object" } }, { name: "search", inputSchema: { type: "object" } }];
const prompts = [{ name: "review" }];
const templates = [{ name: "files", uriTemplate: "file:///{path}" }];

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-diff-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// A list given as items is saved with status pass; a list given as a status is recorded but not saved.
async function snapshotDirectory(
  name: string,
  lists: Record<McpSnapshotListKey, unknown[] | CatalogStatus>,
  server?: McpServerSurface | null
): Promise<string> {
  const directory = path.join(root, name);
  const keys = Object.keys(lists) as McpSnapshotListKey[];
  const report = { server, lists: Object.fromEntries(keys.map((key) => [key, { status: Array.isArray(lists[key]) ? "pass" : lists[key] }])) };
  const responses = Object.fromEntries(keys.map((key) => [key, Array.isArray(lists[key]) ? { items: lists[key], cache: { ttlMs: 0, cacheScope: "private" } } : null]));
  await saveMcpSnapshot(directory, { report, responses } as unknown as McpSnapshot);
  return directory;
}

describe("compareMcpSnapshotDirectories", () => {
  it("passes when every list is unchanged and writes a manifest that matches its schema", async () => {
    const before = await snapshotDirectory("before", { tools, prompts, resourceTemplates: templates });
    const after = await snapshotDirectory("after", { tools, prompts, resourceTemplates: templates });

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report).toMatchObject({
      scope: "mcp-snapshot-diff", status: "pass", manifests: { before: "valid", after: "valid" },
      comparison: { complete: true, reason: null, breaking: 0, unclassified: 0 },
      lists: { tools: { outcome: "compared", before: "saved", after: "saved" }, prompts: { outcome: "compared" }, resourceTemplates: { outcome: "compared" } }
    });
    expect(violations(diffSchema, report)).toEqual([]);
    expect(violations(manifestSchema, JSON.parse(await readFile(path.join(before, "mcp-snapshot-manifest.json"), "utf8")))).toEqual([]);
  });

  it("counts a removed list as breaking and an added list as compatible", async () => {
    const before = await snapshotDirectory("before", { tools, prompts, resourceTemplates: "not-applicable" });
    const after = await snapshotDirectory("after", { tools: tools.slice(0, 1), prompts: "not-applicable", resourceTemplates: templates });

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report).toMatchObject({
      status: "warn",
      comparison: { complete: true, breaking: 2 },
      lists: {
        tools: { outcome: "compared", diff: { comparison: { removed: 1, breaking: 1 } } },
        prompts: { outcome: "list-removed", impact: "breaking", before: "saved", after: "not-offered", diff: null },
        resourceTemplates: { outcome: "list-added", impact: "compatible", before: "not-offered", after: "saved", diff: null, inspection: { status: "pass" } }
      }
    });
    expect(violations(diffSchema, report)).toEqual([]);
    const text = renderMcpSnapshotDiffReport(report);
    expect(text).toContain("Prompts: list-removed (breaking)");
    const markdown = renderMcpSnapshotDiffMarkdown(report);
    expect(markdown).toContain("| Prompts | **list-removed** (breaking) | - | - | - | - | 1 | - |");
    // The tool list changed, so its own section follows one heading level down; names stay out of both reports.
    expect(markdown).toContain("### MCP Tool Definition Diff");
    for (const rendered of [text, markdown]) {
      for (const value of ["search", "review", "file:///{path}"]) expect(rendered).not.toContain(value);
    }
  });

  it("reports a list neither side offers as not-offered without failing", async () => {
    const before = await snapshotDirectory("before", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const after = await snapshotDirectory("after", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report.status).toBe("pass");
    expect(report.lists.prompts).toEqual({ outcome: "not-offered", impact: null, before: "not-offered", after: "not-offered", diff: null, inspection: null });
  });

  it("is incomplete when an offered list was not saved, and ignores files the manifest does not name", async () => {
    const before = await snapshotDirectory("before", { tools, prompts, resourceTemplates: templates });
    const after = await snapshotDirectory("after", { tools, prompts: "incomplete", resourceTemplates: "not-applicable" });
    // A stale prompt file from an earlier run must not be compared as the live list.
    await writeFile(path.join(after, "mcp-prompts-current.json"), await readFile(path.join(before, "mcp-prompts-current.json")));

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report).toMatchObject({
      status: "incomplete",
      comparison: { complete: false, reason: "list-not-saved", breaking: null, unclassified: null },
      lists: {
        prompts: { outcome: "not-compared", before: "saved", after: "not-saved", diff: null },
        resourceTemplates: { outcome: "list-removed" }
      }
    });
    expect(violations(diffSchema, report)).toEqual([]);
  });

  it("checks a newly offered list on its own and reports its findings without names", async () => {
    const before = await snapshotDirectory("before", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    // Two prompts with the same name are a warning; a prompt without a name makes the list fail.
    const warned = await snapshotDirectory("warned", { tools, prompts: [{ name: "review" }, { name: "review" }], resourceTemplates: "not-applicable" });
    const failed = await snapshotDirectory("failed", { tools, prompts: [{ title: "No name" }], resourceTemplates: "not-applicable" });

    const warning = await compareMcpSnapshotDirectories(before, warned);
    expect(warning).toMatchObject({ status: "warn", comparison: { complete: true }, lists: { prompts: { outcome: "list-added", inspection: { status: "warn" } } } });
    expect(warning.lists.prompts.inspection?.findings.length).toBeGreaterThan(0);
    expect(violations(diffSchema, warning)).toEqual([]);
    const markdown = renderMcpSnapshotDiffMarkdown(warning);
    expect(markdown).toContain("| Prompts | **list-added** (compatible), definitions `warn` |");
    expect(markdown).toContain("### Added Prompts List");
    expect(markdown).not.toContain("review");
    expect(renderMcpSnapshotDiffReport(warning)).toContain("Added prompts list:");

    const failure = await compareMcpSnapshotDirectories(before, failed);
    expect(failure).toMatchObject({ status: "incomplete", comparison: { complete: false, reason: "list-incomplete" }, lists: { prompts: { inspection: { status: "fail" } } } });
    expect(violations(diffSchema, failure)).toEqual([]);
  });

  it("is blocked when a newly offered list file is a symbolic link", async (context) => {
    const before = await snapshotDirectory("before", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const after = await snapshotDirectory("after", { tools, prompts, resourceTemplates: "not-applicable" });
    const target = path.join(root, "elsewhere-prompts.json");
    await writeFile(target, await readFile(path.join(after, "mcp-prompts-current.json")));
    await rm(path.join(after, "mcp-prompts-current.json"));
    try {
      await symlink(target, path.join(after, "mcp-prompts-current.json"));
    } catch {
      context.skip();
    }

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report).toMatchObject({ status: "blocked", comparison: { reason: "input-blocked" }, lists: { prompts: { outcome: "list-added", inspection: { status: "blocked" } } } });
    expect(violations(diffSchema, report)).toEqual([]);
  });

  it("is incomplete when a compared list file cannot be read", async () => {
    const before = await snapshotDirectory("before", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const after = await snapshotDirectory("after", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    await writeFile(path.join(after, "mcp-tools-current.json"), "not json");

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report).toMatchObject({ status: "incomplete", comparison: { reason: "list-incomplete" }, lists: { tools: { outcome: "compared", diff: { status: "incomplete" } } } });
    expect(violations(diffSchema, report)).toEqual([]);
    expect(renderMcpSnapshotDiffMarkdown(report)).toContain("### MCP Tool Definition Diff");
  });

  it.each([
    ["missing", null, "unavailable"],
    ["not a snapshot manifest", JSON.stringify({ schemaVersion: 1, scope: "other" }), "invalid"],
    ["pointing at another file", JSON.stringify({
      schemaVersion: 1, scope: "mcp-snapshot-manifest",
      lists: { tools: { status: "pass", file: "../tools.json" }, prompts: { status: "not-applicable", file: null }, resourceTemplates: { status: "not-applicable", file: null } }
    }), "invalid"]
  ])("compares nothing when the after manifest is %s", async (_case, content, state) => {
    const before = await snapshotDirectory("before", { tools, prompts, resourceTemplates: templates });
    const after = await snapshotDirectory("after", { tools, prompts, resourceTemplates: templates });
    await rm(path.join(after, "mcp-snapshot-manifest.json"));
    if (content !== null) await writeFile(path.join(after, "mcp-snapshot-manifest.json"), content);

    const report = await compareMcpSnapshotDirectories(before, after);
    const reversed = await compareMcpSnapshotDirectories(after, before);

    expect(reversed.manifests).toEqual({ before: state, after: "valid" });
    expect(reversed.comparison.reason).toBe("manifest-unavailable");
    expect(report).toMatchObject({
      status: "incomplete", manifests: { before: "valid", after: state },
      comparison: { complete: false, reason: "manifest-unavailable" },
      lists: { tools: { outcome: "not-compared", before: null, after: null, diff: null } }
    });
    expect(violations(diffSchema, report)).toEqual([]);
    expect(renderMcpSnapshotDiffMarkdown(report)).toContain(`After manifest: \`${state}\``);
  });

  it("blocks remote and device paths before reading anything", async () => {
    const after = await snapshotDirectory("after", { tools, prompts, resourceTemplates: templates });

    const report = await compareMcpSnapshotDirectories("https://example.test/snapshot", after);

    expect(report).toMatchObject({ status: "blocked", manifests: { before: "blocked" }, comparison: { reason: "input-blocked" } });
    expect(violations(diffSchema, report)).toEqual([]);
    expect(renderMcpSnapshotDiffReport(report)).toContain("Tools: not-compared (manifest not read)");
  });

  it("is blocked when a compared list file is a symbolic link", async (context) => {
    const before = await snapshotDirectory("before", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const after = await snapshotDirectory("after", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const target = path.join(root, "elsewhere.json");
    await writeFile(target, await readFile(path.join(after, "mcp-tools-current.json")));
    await rm(path.join(after, "mcp-tools-current.json"));
    try {
      await symlink(target, path.join(after, "mcp-tools-current.json"));
    } catch {
      context.skip();
    }

    const report = await compareMcpSnapshotDirectories(before, after);

    expect(report).toMatchObject({ status: "blocked", comparison: { reason: "input-blocked" }, lists: { tools: { diff: { status: "blocked" } } } });
    expect(violations(diffSchema, report)).toEqual([]);
  });

  it("never names a list file that a later run did not save", async () => {
    const directory = await snapshotDirectory("snapshot", { tools, prompts, resourceTemplates: "not-applicable" });
    // The tool list is too large to save this time, so the earlier tool file stays on disk.
    const saved = await saveMcpSnapshot(directory, {
      report: { lists: { tools: { status: "pass" }, prompts: { status: "incomplete" }, resourceTemplates: { status: "not-applicable" } } },
      responses: {
        tools: { items: [{ name: "x".repeat(1024 * 1024), inputSchema: { type: "object" } }], cache: { ttlMs: 0, cacheScope: "private" } },
        prompts: null,
        resourceTemplates: null
      }
    } as unknown as McpSnapshot);

    expect(saved.lists.map(({ result }) => result.kind)).toEqual(["too-large"]);
    expect(saved.manifest.kind).toBe("saved");
    expect(JSON.parse(await readFile(path.join(directory, "mcp-tools-current.json"), "utf8")).result.tools).toEqual(tools);
    expect(JSON.parse(await readFile(path.join(directory, "mcp-snapshot-manifest.json"), "utf8")).lists).toEqual({
      tools: { status: "pass", file: null }, prompts: { status: "incomplete", file: null }, resourceTemplates: { status: "not-applicable", file: null }
    });
    const baseline = await snapshotDirectory("baseline", { tools, prompts, resourceTemplates: "not-applicable" });
    expect((await compareMcpSnapshotDirectories(baseline, directory)).lists.tools).toMatchObject({ outcome: "not-compared", after: "not-saved" });
  });

  it("removes an earlier manifest before saving the lists", async (context) => {
    const directory = await snapshotDirectory("snapshot", { tools, prompts, resourceTemplates: templates });
    const target = path.join(root, "earlier-manifest.json");
    await writeFile(target, await readFile(path.join(directory, "mcp-snapshot-manifest.json")));
    await rm(path.join(directory, "mcp-snapshot-manifest.json"));
    try {
      await symlink(target, path.join(directory, "mcp-snapshot-manifest.json"));
    } catch {
      context.skip();
    }

    // The writer refuses to replace a link, so the new manifest is saved only because the earlier one was removed first.
    const saved = await saveMcpSnapshot(directory, {
      report: { lists: { tools: { status: "pass" }, prompts: { status: "not-applicable" }, resourceTemplates: { status: "not-applicable" } } },
      responses: { tools: { items: tools, cache: { ttlMs: 0, cacheScope: "private" } }, prompts: null, resourceTemplates: null }
    } as unknown as McpSnapshot);

    expect(saved.manifest.kind).toBe("saved");
    expect(JSON.parse(await readFile(path.join(directory, "mcp-snapshot-manifest.json"), "utf8")).lists.prompts.file).toBeNull();
    expect(JSON.parse(await readFile(target, "utf8")).lists.prompts.file).toBe("mcp-prompts-current.json");
  });

  describe("server surface", () => {
    const onlyTools = { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" } as const;
    const modern = (versions: string[], capabilities: string[]): McpServerSurface => ({ era: "modern", versions, capabilities });

    it("labels a dropped protocol version or capability as breaking and leaves list capabilities to the list rows", async () => {
      const before = await snapshotDirectory("before", onlyTools, modern(["2025-11-25", "2026-07-28"], ["logging", "prompts", "tools"]));
      const after = await snapshotDirectory("after", onlyTools, modern(["2026-07-28"], ["completions", "tools"]));

      const report = await compareMcpSnapshotDirectories(before, after);

      expect(report).toMatchObject({ status: "warn", comparison: { complete: true, breaking: 2, unclassified: 0 } });
      expect(report.server).toMatchObject({ outcome: "compared" });
      expect(report.server.changes).toEqual([
        { kind: "protocol-version-removed", value: "2025-11-25", impact: "breaking" },
        { kind: "capability-removed", value: "logging", impact: "breaking" },
        { kind: "capability-added", value: "completions", impact: "compatible" }
      ]);
      expect(violations(diffSchema, report)).toEqual([]);
      const markdown = renderMcpSnapshotDiffMarkdown(report);
      expect(markdown).toContain("| Server surface | compared | 1 | 2 | 0 | 1 | 2 | 0 |");
      expect(markdown).toContain("| protocol-version-removed | `\"2025-11-25\"` | **breaking** |");
      expect(renderMcpSnapshotDiffReport(report)).toContain("  capability-removed \"logging\" (breaking)");
    });

    it.each([
      ["modern", "legacy", "breaking"],
      ["legacy", "modern", "unclassified"]
    ] as const)("labels a %s to %s change as %s", async (from, to, impact) => {
      const before = await snapshotDirectory("before", onlyTools, { era: from, versions: ["2026-07-28"], capabilities: ["tools"] });
      const after = await snapshotDirectory("after", onlyTools, { era: to, versions: ["2026-07-28"], capabilities: ["tools"] });

      const report = await compareMcpSnapshotDirectories(before, after);

      expect(report.server.changes).toEqual([{ kind: "era-changed", value: `${from} -> ${to}`, impact }]);
      expect(report.comparison).toMatchObject({ breaking: impact === "breaking" ? 1 : 0, unclassified: impact === "unclassified" ? 1 : 0 });
    });

    it.each([
      ["2025-06-18", "2025-11-25", { kind: "protocol-version-added", value: "2025-11-25", impact: "compatible" }],
      ["2025-11-25", "2025-06-18", { kind: "protocol-version-removed", value: "2025-11-25", impact: "breaking" }]
    ] as const)("judges a legacy negotiated version %s -> %s by direction", async (from, to, change) => {
      const before = await snapshotDirectory("before", onlyTools, { era: "legacy", versions: [from], capabilities: ["tools"] });
      const after = await snapshotDirectory("after", onlyTools, { era: "legacy", versions: [to], capabilities: ["tools"] });

      expect((await compareMcpSnapshotDirectories(before, after)).server.changes).toEqual([change]);
    });

    it("reports a surface the snapshot did not establish as not-recorded", async () => {
      const before = await snapshotDirectory("before", onlyTools, null);
      const after = await snapshotDirectory("after", onlyTools, modern(["2026-07-28"], ["tools"]));

      const report = await compareMcpSnapshotDirectories(before, after);

      expect(JSON.parse(await readFile(path.join(before, "mcp-snapshot-manifest.json"), "utf8")).server).toBeNull();
      expect(report).toMatchObject({ status: "pass", server: { outcome: "not-recorded" } });
    });

    it("leaves the server surface out when a manifest predates it, without failing the comparison", async () => {
      const before = await snapshotDirectory("before", onlyTools);
      const after = await snapshotDirectory("after", onlyTools, modern(["2026-07-28"], ["tools"]));

      const report = await compareMcpSnapshotDirectories(before, after);

      expect(report).toMatchObject({ status: "pass", comparison: { complete: true, breaking: 0 } });
      expect(report.server).toEqual({ outcome: "not-recorded", before: null, after: modern(["2026-07-28"], ["tools"]), changes: [] });
      expect(renderMcpSnapshotDiffMarkdown(report)).toContain("| Server surface | not-recorded | - | - | - | - | - | - |");
      expect(violations(diffSchema, report)).toEqual([]);
    });

    it("treats a malformed server surface as an invalid manifest", async () => {
      const before = await snapshotDirectory("before", onlyTools, modern(["2026-07-28"], ["tools"]));
      const after = await snapshotDirectory("after", onlyTools, modern(["2026-07-28"], ["tools"]));
      const manifestPath = path.join(after, "mcp-snapshot-manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
      const malformed = { ...manifest, server: { era: "modern", versions: ["2026-07-28", "2026-07-28"], capabilities: [] } };
      await writeFile(manifestPath, JSON.stringify(malformed));

      const report = await compareMcpSnapshotDirectories(before, after);

      expect(report).toMatchObject({ status: "incomplete", manifests: { after: "invalid" }, comparison: { reason: "manifest-unavailable" } });
      // The written manifest matches the contract, and the duplicate version the reader rejects breaks it too.
      expect(violations(manifestSchema, manifest)).toEqual([]);
      expect(violations(manifestSchema, malformed)).not.toEqual([]);
    });
  });

  it("adds names to compared lists only with showNames", async () => {
    const before = await snapshotDirectory("before", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const after = await snapshotDirectory("after", { tools: tools.slice(0, 1), prompts: "not-applicable", resourceTemplates: "not-applicable" });

    expect((await compareMcpSnapshotDirectories(before, after)).lists.tools.diff?.changes[0]).not.toHaveProperty("name");
    expect((await compareMcpSnapshotDirectories(before, after, { showNames: true })).lists.tools.diff?.changes[0]).toMatchObject({ name: "search" });
  });
});
