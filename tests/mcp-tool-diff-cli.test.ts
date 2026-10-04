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
    comparison: { complete, reason: complete ? null : "input-incomplete", added: complete ? 0 : null, removed: complete ? 0 : null, changed: complete ? 0 : null, unchanged: complete ? 1 : null },
    coverage: { comparison: "structural-only", schema: "root-shape-only", compatibility: "not-tested", serverCatalog: "not-tested", toolExecution: "not-tested" },
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
    [...pair, "--json", "--json"], [...pair, "--compatibility", "--compatibility"], [...pair, "extra"], [...pair, "--allow-network"],
    [...pair, "--runtime"], [...pair, "--output", "result.json"], [...pair, "--help"]
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

  it("accepts option order changes and emits JSON without rewriting the report", async () => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue(report());
    expect(await runCli(["doctor", "tools-diff", "--json", "--after", "new.json", "--before", "old.json"], c.io, { compareMcpToolFilesImpl })).toBe(0);
    expect(compareMcpToolFilesImpl).toHaveBeenCalledExactlyOnceWith("old.json", "new.json");
    expect(JSON.parse(c.stdout.join("\n"))).toEqual(report());
  });

  it("passes the compatibility option and maps breaking signals to exit 3", async () => {
    const c = capture();
    const result = report("breaking");
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue({
      ...result,
      comparison: { complete: true, reason: null, added: 0, removed: 1, changed: 1, unchanged: 0, breaking: 2 },
      coverage: { ...result.coverage, compatibility: "root-property-signals" },
      changes: [
        { kind: "removed", beforeToolIndex: 1, afterToolIndex: null, fields: [], signals: ["tool-removed"] },
        { kind: "changed", beforeToolIndex: 2, afterToolIndex: 1, fields: ["inputSchema"], signals: ["input-required-added", "input-property-removed"] }
      ]
    });
    expect(await runCli(["doctor", "tools-diff", "--compatibility", ...pair], c.io, { compareMcpToolFilesImpl })).toBe(3);
    expect(compareMcpToolFilesImpl).toHaveBeenCalledExactlyOnceWith("old.json", "new.json", { compatibility: true });
    const output = c.stdout.join("\n");
    expect(output).toContain("Status: breaking");
    expect(output).toContain("Breaking signals: 2");
    expect(output).toContain("Compatibility: root-property-signals");
    expect(output).toContain("REMOVED [before tool 1] | signals: tool-removed");
    expect(output).toContain("CHANGED [before tool 2 -> after tool 1]: inputSchema | signals: input-required-added, input-property-removed");
  });

  it("does not print a breaking line without the compatibility option", async () => {
    const c = capture();
    const compareMcpToolFilesImpl = vi.fn().mockResolvedValue(report("warn"));
    await runCli(["doctor", "tools-diff", ...pair], c.io, { compareMcpToolFilesImpl });
    expect(c.stdout.join("\n")).not.toContain("Breaking signals");
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
      changes: [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 2, fields: ["inputSchema", "other"] }]
    });
    expect(await runCli(["doctor", "tools-diff", ...pair], c.io, { compareMcpToolFilesImpl })).toBe(1);
    const output = c.stdout.join("\n");
    expect(output).toContain("Before");
    expect(output).toContain("plugin.catalog.schema.dialect.unsupported");
    expect(output).toContain("before tool 1");
    expect(output).toContain("after tool 2");
    expect(output).toContain("inputSchema, other");
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
        changes: { maxItems: 1000, items: { properties: { fields: { items: { enum: ["inputSchema", "outputSchema", "description", "title", "annotations", "other"] } } } } }
      }
    });
    const properties = entry?.schema.properties as Record<string, any>;
    expect(properties.status.enum).toContain("breaking");
    expect(properties.coverage.properties.compatibility.enum).toEqual(["not-tested", "root-property-signals"]);
    expect(properties.comparison.required).not.toContain("breaking");
    expect(properties.changes.items.required).not.toContain("signals");
    expect(properties.changes.items.properties.signals.items.enum).toContain("tool-removed");
  });

  it("gates actual saved files on breaking signals only when requested", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-diff-cli-"));
    try {
      const before = path.join(root, "PRIVATE_BEFORE.json");
      const after = path.join(root, "PRIVATE_AFTER.json");
      const envelope = (required: string[]) => ({ jsonrpc: "2.0", id: 0, result: {
        resultType: "complete", ttlMs: 0, cacheScope: "private",
        tools: [{ name: "PRIVATE_TOOL", inputSchema: { type: "object", properties: { PRIVATE_ARG: { type: "string" } }, required } }]
      } });
      await writeFile(before, JSON.stringify(envelope([])));
      await writeFile(after, JSON.stringify(envelope(["PRIVATE_ARG"])));
      const plain = capture();
      expect(await runCli(["doctor", "tools-diff", "--before", before, "--after", after, "--json"], plain.io)).toBe(1);
      const gated = capture();
      expect(await runCli(["doctor", "tools-diff", "--before", before, "--after", after, "--compatibility", "--json"], gated.io)).toBe(3);
      const output = gated.stdout.join("\n");
      expect(output).not.toContain("PRIVATE_");
      expect(JSON.parse(output)).toMatchObject({
        status: "breaking",
        comparison: { breaking: 1 },
        changes: [{ kind: "changed", fields: ["inputSchema"], signals: ["input-required-added"] }]
      });
    } finally {
      const resolved = await realpath(root);
      const relative = path.relative(await realpath(os.tmpdir()), resolved);
      if (path.isAbsolute(relative) || path.dirname(relative) !== "." || !path.basename(resolved).startsWith("doctor-diff-cli-")) throw new Error("Unexpected test cleanup target.");
      await rm(resolved, { recursive: true, force: true });
    }
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
      const output = c.stdout.join("\n");
      expect(output).not.toContain("PRIVATE_");
      const result = JSON.parse(output);
      expect(result.comparison.complete).toBe(!skipped);
      expect(result.comparison.changed).toBe(skipped ? null : 1);
      expect(result.changes).toEqual(skipped ? [] : [{ kind: "changed", beforeToolIndex: 1, afterToolIndex: 1, fields: ["description"] }]);
    } finally {
      const resolved = await realpath(root);
      const relative = path.relative(await realpath(os.tmpdir()), resolved);
      if (path.isAbsolute(relative) || path.dirname(relative) !== "." || !path.basename(resolved).startsWith("doctor-diff-cli-")) throw new Error("Unexpected test cleanup target.");
      await rm(resolved, { recursive: true, force: true });
    }
  });
});
