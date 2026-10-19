import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/run-cli.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: {
    writeStdout: (text: string) => { stdout.push(text); },
    writeStderr: (text: string) => { stderr.push(text); }
  } };
}

function report(status = "pass") {
  const complete = ["pass", "warn", "fail"].includes(status);
  return {
    schemaVersion: 1, scope: "resource-template-catalog-structure", status,
    discovery: { schemaVersion: 1, requestedVersion: "2026-07-28", scope: "discovery-only", status: "discovered", supportedVersions: ["2026-07-28"], findings: [], coverage: { discovery: "pass", runtime: "not-tested" } },
    catalog: { complete, pagesRead: complete ? 1 : 0, templatesChecked: complete ? 1 : 0, reason: complete ? null : "authorization-required" },
    coverage: { discovery: "pass", catalogEnumeration: complete ? "complete" : "incomplete", definitions: "shape-only", resourceRead: "not-tested", fullConformance: "not-tested" },
    findings: []
  };
}

const fixtureRoot = path.resolve("tests", "fixtures", "stdio-resource-template-catalog");

describe("doctor resource-templates", () => {
  it("requires explicit network consent before capture", async () => {
    const c = capture();
    const captureMcpResourceTemplateCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "resource-templates", "https://mcp.example/mcp"], c.io, { captureMcpResourceTemplateCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toBe("doctor resource-templates requires explicit --allow-network consent.");
    expect(captureMcpResourceTemplateCatalogImpl).not.toHaveBeenCalled();
  });

  it.each([["pass", 0], ["warn", 1], ["not-applicable", 1], ["incomplete", 2]] as const)("returns %s as exit %i", async (status, exitCode) => {
    const c = capture();
    const captureMcpResourceTemplateCatalogImpl = vi.fn().mockResolvedValue({ report: report(status), templates: null, cache: null });
    expect(await runCli(["doctor", "resource-templates", "https://mcp.example/mcp", "--allow-network"], c.io, { captureMcpResourceTemplateCatalogImpl })).toBe(exitCode);
    expect(c.stdout.join("\n")).toContain("MCP Resource Template Catalog");
    expect(c.stdout.join("\n")).toContain("Resource read: not-tested");
  });

  it("saves a complete enumeration as a resources/templates/list response", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-resource-templates-cli-"));
    try {
      const savePath = path.join(directory, "templates.json");
      const c = capture();
      const template = { uriTemplate: "file:///{path}", name: "files" };
      const captureMcpResourceTemplateCatalogImpl = vi.fn().mockResolvedValue({ report: report(), templates: [template], cache: { ttlMs: 0, cacheScope: "private" } });
      expect(await runCli(["doctor", "resource-templates", "https://mcp.example/mcp", "--allow-network", "--save-response", savePath], c.io, { captureMcpResourceTemplateCatalogImpl })).toBe(0);
      expect(c.stderr.join("\n")).toMatch(/^Saved a complete resources\/templates\/list response with 1 resource templates \(\d+ bytes\)\.$/u);
      expect(JSON.parse(await readFile(savePath, "utf8"))).toEqual({
        jsonrpc: "2.0", id: "resource-templates-list",
        result: { resultType: "complete", resourceTemplates: [template], ttlMs: 0, cacheScope: "private" }
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not save an incomplete enumeration", async () => {
    const c = capture();
    const captureMcpResourceTemplateCatalogImpl = vi.fn().mockResolvedValue({ report: report("incomplete"), templates: null, cache: null });
    expect(await runCli(["doctor", "resource-templates", "https://mcp.example/mcp", "--allow-network", "--save-response", "templates.json"], c.io, { captureMcpResourceTemplateCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toBe("Resource template catalog response was not saved because enumeration did not complete.");
  });

  it("requires --runtime before starting a stdio server and captures one with consent", async () => {
    const c = capture();
    const captureStdioMcpResourceTemplateCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "resource-templates", fixtureRoot, "--server", "modern"], c.io, { captureStdioMcpResourceTemplateCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toBe("doctor resource-templates --server starts a local MCP server and requires explicit --runtime consent.");
    expect(captureStdioMcpResourceTemplateCatalogImpl).not.toHaveBeenCalled();

    const live = capture();
    expect(await runCli(["doctor", "resource-templates", fixtureRoot, "--server", "modern", "--runtime", "--json"], live.io)).toBe(0);
    expect(JSON.parse(live.stdout.join("\n"))).toMatchObject({ transport: "stdio", status: "pass", catalog: { templatesChecked: 2 } });
  });

  it("documents the command in help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "resource-templates", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("Resource template catalog structure only; no resource is read.");
  });
});
