import { mkdtemp, writeFile, rm, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run-cli.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: {
    writeStdout: (text: string) => { stdout.push(text); },
    writeStderr: (text: string) => { stderr.push(text); }
  } };
}

function report(status = "pass") {
  const source = {
    schemaVersion: 1, scope: "tool-definitions-file", status: "pass",
    source: { kind: "file", format: "mcp-tools-list-response", bytesRead: 250 },
    inspection: { complete: true, toolsChecked: 1, hasNextCursor: false, reason: null },
    coverage: { schema: "root-shape-only", discovery: "not-tested", serverCatalog: "not-tested", toolExecution: "not-tested", fullConformance: "not-tested", customHeaderAnnotations: "not-tested" },
    findings: []
  };
  const complete = status === "pass" || status === "warn";
  return {
    schemaVersion: 1, scope: "tool-definitions-diff", status,
    before: source, after: source,
    comparison: { complete, reason: complete ? null : "input-incomplete", added: complete ? 0 : null, removed: complete ? 0 : null, changed: complete ? 0 : null, unchanged: complete ? 1 : null, breaking: complete ? 0 : null, unclassified: complete ? 0 : null },
    coverage: { comparison: "structural-only", schema: "root-shape-only", compatibility: "not-tested", serverCatalog: "not-tested", toolExecution: "not-tested", impactClassification: "heuristic" },
    changes: []
  };
}

const pair = ["--before", "old.json", "--after", "new.json"];

describe("doctor tools-diff", () => {
  it.each([
    [], ["--json"], ["--before", "old.json"], ["--after", "new.json"],
    ["--before", "--after", "new.json"], ["--before", "old.json", "--after"],
    ["--before", "", "--after", "new.json"], ["old.json", "new.json"],
    [...pair, "--before", "another.json"], [...pair, "--after", "another.json"],
    [...pair, "--json", "--json"], [...pair, "extra"], [...pair, "--allow-network"],
    [...pair, "--runtime"], [...pair, "--output", "result.json"], [...pair, "--help"],
    [...pair, "--fail-on"], [...pair, "--fail-on", "warn"], [...pair, "--fail-on", "--json"],
    [...pair, "--fail-on", "any", "--fail-on", "breaking"]
  ])("rejects unsupported arguments %j before comparison", async (...args: string[]) => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn();
    expect(await runCli(["doctor", "tools-diff", ...args], c.io, { compareMcpToolFilesImpl })).toBe(2);
    expect(compareMcpToolFilesImpl).not.toHaveBeenCalled();
    expect(c.stderr.join("\n")).toContain("doctor tools-diff --before <path> --after <path>");
  });

  it.each([["pass", 0], ["warn", 1], ["incomplete", 2], ["blocked", 2]] as const)(
    "maps %s to exit %i and renders comparison limits", async (status, code) => {
      const c = capture();
      const compareMcpToolFilesImpl = vi.fn().mockResolvedValue(report(status));
      expect(await runCli(["doctor", "tools-diff", "--before", "PRIVATE_BEFORE", "--after", "PRIVATE_AFTER"], c.io, { compareMcpToolFilesImpl })).toBe(code);
      const output = c.stdout.join("\n");
      expect(output).toContain(status);
      expect(output).toContain("structural-only");
      expect(output).toContain("Compatibility: not-tested");
      expect(output).not.toContain("PRIVATE_");
      if (status === "incomplete" || status === "blocked") expect(output).toContain("not compared");
    }
  );

  it.each([
    ["pass", 0, 0, undefined, 0],
    ["warn", 0, 0, undefined, 1],
    ["warn", 0, 0, "any", 1],
    ["warn", 0, 0, "breaking", 0],
    ["warn", 1, 0, "breaking", 1],
    ["warn", 0, 1, "breaking", 1],
    ["incomplete", null, null, "breaking", 2],
    ["blocked", null, null, "breaking", 2]
  ] as const)("maps %s with %s breaking and %s unclassified under --fail-on %s to exit %i", async (status, breaking, unclassified, failOn, code) => {
    const c = capture();
    const result = report(status);
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue({ ...result, comparison: { ...result.comparison, breaking, unclassified } });
    const args = ["doctor", "tools-diff", ...pair, ...(failOn ? ["--fail-on", failOn] : [])];
    expect(await runCli(args, c.io, { compareMcpToolFilesImpl })).toBe(code);
    expect(c.stdout.join("\n")).toContain("Impact classification: heuristic");
  });

  it("accepts option order changes and emits JSON without rewriting the report", async () => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue(report());
    expect(await runCli(["doctor", "tools-diff", "--json", "--after", "new.json", "--before", "old.json"], c.io, { compareMcpToolFilesImpl })).toBe(0);
    expect(compareMcpToolFilesImpl).toHaveBeenCalledExactlyOnceWith("old.json", "new.json");
    expect(JSON.parse(c.stdout.join("\n"))).toEqual(report());
  });

  it("shows help without reading either input", async () => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn();
    expect(await runCli(["doctor", "tools-diff", "--help"], c.io, { compareMcpToolFilesImpl })).toBe(0);
    expect(c.stdout.join("\n")).toContain("doctor tools-diff --before <path> --after <path>");
    expect(compareMcpToolFilesImpl).not.toHaveBeenCalled();
  });

  it("labels the side of retained findings and locates structural changes", async () => {
    const c = capture();
    const result = report("warn");
    const finding = { id: "plugin.catalog.schema.dialect.unsupported", severity: "warn", message: "Unsupported schema dialect.", impact: "Limited coverage.", suggestedFix: "Review the schema.", location: { page: 1, toolIndex: 1 } };
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue({
      ...result, before: { ...result.before, findings: [finding] },
      changes: [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 2, fields: ["inputSchema", "other"], impact: "unclassified", reasons: ["other-fields-unclassified"] }]
    });
    expect(await runCli(["doctor", "tools-diff", ...pair], c.io, { compareMcpToolFilesImpl })).toBe(1);
    const output = c.stdout.join("\n");
    expect(output).toContain("Before");
    expect(output).toContain("plugin.catalog.schema.dialect.unsupported");
    expect(output).toContain("before tool 1");
    expect(output).toContain("after tool 2");
    expect(output).toContain("inputSchema, other");
    expect(output).toContain("Impact: unclassified (other-fields-unclassified)");
  });

  it("registers bounded standalone diff and embedded input schemas", () => {
    const schemas = buildDoctorOutputContract().schemas;
    const entry = schemas.find((schema) => schema.id === "doctor.tools.diff.json");
    const file = schemas.find((schema) => schema.id === "doctor.tools.file.json");
    expect(entry?.schema).toMatchObject({
      required: expect.arrayContaining(["scope", "status", "before", "after", "comparison", "coverage", "changes"]),
      properties: {
        schemaVersion: { const: 1 }, scope: { const: "tool-definitions-diff" },
        before: { properties: file?.schema.properties },
        after: { properties: file?.schema.properties },
        changes: { maxItems: 1000, items: { required: expect.arrayContaining(["impact", "reasons"]), properties: {
          fields: { items: { enum: ["inputSchema", "outputSchema", "description", "title", "annotations", "other"] } },
          impact: { enum: ["breaking", "compatible", "unclassified"] },
          reasons: { items: { enum: expect.arrayContaining(["tool-removed", "input-required-added", "other-fields-unclassified"]) } }
        } } }
      }
    });
  });

  it.each(["changed", "continued", "invalid", "duplicate"] as const)("handles actual saved files with %s input", async (scenario) => {
    const skipped = scenario !== "changed";
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-diff-cli-"));
    try {
      const before = path.join(root, "PRIVATE_BEFORE.json");
      const after = path.join(root, "PRIVATE_AFTER.json");
      const envelope = (description: string, more: boolean) => ({ jsonrpc: "2.0", id: 0, result: {
        resultType: "complete", ttlMs: 0, cacheScope: "private", ...(more ? { nextCursor: "PRIVATE_CURSOR" } : {}),
        tools: [{ name: "PRIVATE_TOOL", inputSchema: { type: "object" }, description }]
      } });
      await writeFile(before, JSON.stringify(envelope("PRIVATE_OLD", false)));
      const afterEnvelope = envelope("PRIVATE_NEW", scenario === "continued");
      if (scenario === "invalid") afterEnvelope.result.tools[0].inputSchema.type = "invalid-type";
      if (scenario === "duplicate") afterEnvelope.result.tools.push(afterEnvelope.result.tools[0]);
      await writeFile(after, JSON.stringify(afterEnvelope));
      const c = capture();
      expect(await runCli(["doctor", "tools-diff", "--before", before, "--after", after, "--json"], c.io)).toBe(skipped ? 2 : 1);
      if (!skipped) expect(await runCli(["doctor", "tools-diff", "--before", before, "--after", after, "--fail-on", "breaking"], capture().io)).toBe(0);
      const output = c.stdout.join("\n");
      expect(output).not.toContain("PRIVATE_");
      const result = JSON.parse(output);
      expect(result.comparison.complete).toBe(!skipped);
      expect(result.comparison.changed).toBe(skipped ? null : 1);
      expect(result.changes).toEqual(skipped ? [] : [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["description"], impact: "compatible", reasons: [] }]);
    } finally {
      const resolved = await realpath(root);
      const relative = path.relative(await realpath(os.tmpdir()), resolved);
      if (path.isAbsolute(relative) || path.dirname(relative) !== "." || !path.basename(resolved).startsWith("doctor-diff-cli-")) throw new Error("Unexpected test cleanup target.");
      await rm(resolved, { recursive: true, force: true });
    }
  });
});

describe("doctor tools-diff --markdown", () => {
  it("renders a sanitized Markdown table with the same exit code", async () => {
    const c = capture();
    const changed = {
      ...report("warn"),
      comparison: { complete: true, reason: null, added: 0, removed: 1, changed: 1, unchanged: 0, breaking: 2, unclassified: 0 },
      changes: [
        { kind: "removed", beforeToolIndex: 2, afterToolIndex: null, fields: [], impact: "breaking", reasons: ["tool-removed"] },
        { kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["inputSchema"], impact: "breaking", reasons: ["input-constraint-tightened"] }
      ]
    };
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue(changed);

    expect(await runCli(["doctor", "tools-diff", "--before", "PRIVATE_BEFORE", "--after", "PRIVATE_AFTER", "--markdown", "--fail-on", "breaking"], c.io, { compareMcpToolFilesImpl })).toBe(1);

    const output = c.stdout.join("\n");
    expect(output).toContain("## MCP Tool Definition Diff");
    expect(output).toContain("| 0 | 1 | 1 | 0 | 2 | 0 |");
    expect(output).toContain("| removed | 2 | - | - | **breaking** | `tool-removed` |");
    expect(output).toContain("| changed | 1 | 1 | `inputSchema` | **breaking** | `input-constraint-tightened` |");
    expect(output).not.toContain("PRIVATE_");
  });

  it("marks counts as not compared for an incomplete comparison", async () => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue(report("incomplete"));
    expect(await runCli(["doctor", "tools-diff", ...pair, "--markdown"], c.io, { compareMcpToolFilesImpl })).toBe(2);
    expect(c.stdout.join("\n")).toContain("**Reason:** `input-incomplete`");
    expect(c.stdout.join("\n")).toContain("| not compared |");
  });

  it.each([[["--markdown", "--json"]], [["--json", "--markdown"]], [["--markdown", "--markdown"]]])("rejects %j", async (flags) => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn();
    expect(await runCli(["doctor", "tools-diff", ...pair, ...flags], c.io, { compareMcpToolFilesImpl })).toBe(2);
    expect(compareMcpToolFilesImpl).not.toHaveBeenCalled();
  });
});
