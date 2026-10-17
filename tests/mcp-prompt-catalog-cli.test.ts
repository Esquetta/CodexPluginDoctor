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
    schemaVersion: 1, scope: "prompt-catalog-structure", status,
    discovery: { schemaVersion: 1, requestedVersion: "2026-07-28", scope: "discovery-only", status: "discovered", supportedVersions: ["2026-07-28"], findings: [], coverage: { discovery: "pass", runtime: "not-tested" } },
    catalog: { complete, pagesRead: complete ? 1 : 0, promptsChecked: complete ? 1 : 0, reason: complete ? null : "authorization-required" },
    coverage: { discovery: "pass", catalogEnumeration: complete ? "complete" : "incomplete", definitions: "shape-only", promptRetrieval: "not-tested", fullConformance: "not-tested" },
    findings: []
  };
}

const fixtureRoot = path.resolve("tests", "fixtures", "stdio-prompt-catalog");

describe("doctor prompts", () => {
  it("requires explicit network consent and rejects duplicate options before capture", async () => {
    for (const args of [["https://mcp.example/mcp"], ["https://mcp.example/mcp", "--allow-network", "--json", "--json"]]) {
      const c = capture();
      const captureMcpPromptCatalogImpl = vi.fn();
      expect(await runCli(["doctor", "prompts", ...args], c.io, { captureMcpPromptCatalogImpl })).toBe(2);
      expect(captureMcpPromptCatalogImpl).not.toHaveBeenCalled();
      expect(c.stderr.join("\n")).toMatch(/doctor prompts requires explicit --allow-network consent|Invalid or duplicate prompt catalog arguments/u);
    }
  });

  it.each([["pass", 0], ["warn", 1], ["not-applicable", 1], ["incomplete", 2]] as const)("returns %s as exit %i", async (status, exitCode) => {
    const c = capture();
    const captureMcpPromptCatalogImpl = vi.fn().mockResolvedValue({ report: report(status), prompts: null, cache: null });
    expect(await runCli(["doctor", "prompts", "https://mcp.example/mcp", "--allow-network"], c.io, { captureMcpPromptCatalogImpl })).toBe(exitCode);
    expect(captureMcpPromptCatalogImpl).toHaveBeenCalledWith("https://mcp.example/mcp", { allowNetwork: true, allowLocalNetwork: false });
    expect(c.stdout.join("\n")).toContain("MCP Prompt Catalog");
    expect(c.stdout.join("\n")).toContain("Prompt retrieval: not-tested");
  });

  it("saves a complete enumeration as a prompts/list response", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-prompts-cli-"));
    try {
      const savePath = path.join(directory, "prompts.json");
      const c = capture();
      const captureMcpPromptCatalogImpl = vi.fn().mockResolvedValue({ report: report(), prompts: [{ name: "review" }], cache: { ttlMs: 0, cacheScope: "private" } });
      expect(await runCli(["doctor", "prompts", "https://mcp.example/mcp", "--allow-network", "--json", "--save-response", savePath], c.io, { captureMcpPromptCatalogImpl })).toBe(0);
      expect(JSON.parse(c.stdout.join("\n"))).toMatchObject({ scope: "prompt-catalog-structure" });
      expect(c.stderr.join("\n")).toMatch(/^Saved a complete prompts\/list response with 1 prompts \(\d+ bytes\)\.$/u);
      expect(JSON.parse(await readFile(savePath, "utf8"))).toMatchObject({ id: "prompts-list", result: { prompts: [{ name: "review" }] } });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not save an incomplete enumeration", async () => {
    const c = capture();
    const captureMcpPromptCatalogImpl = vi.fn().mockResolvedValue({ report: report("incomplete"), prompts: null, cache: null });
    expect(await runCli(["doctor", "prompts", "https://mcp.example/mcp", "--allow-network", "--save-response", "prompts.json"], c.io, { captureMcpPromptCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toBe("Prompt catalog response was not saved because enumeration did not complete.");
  });

  it("requires --runtime before starting a stdio server and names doctor prompts for HTTP servers", async () => {
    const c = capture();
    const captureStdioMcpPromptCatalogImpl = vi.fn();
    expect(await runCli(["doctor", "prompts", fixtureRoot, "--server", "modern"], c.io, { captureStdioMcpPromptCatalogImpl })).toBe(2);
    expect(c.stderr.join("\n")).toBe("doctor prompts --server starts a local MCP server and requires explicit --runtime consent.");

    const remote = capture();
    expect(await runCli(["doctor", "prompts", path.resolve("tests", "fixtures", "stdio-tool-catalog"), "--server", "remote", "--runtime"], remote.io, { captureStdioMcpPromptCatalogImpl })).toBe(2);
    expect(remote.stderr.join("\n")).toBe("The named MCP server uses HTTP. Run doctor prompts <url> --allow-network for HTTP servers.");
    expect(captureStdioMcpPromptCatalogImpl).not.toHaveBeenCalled();
  });

  it("captures a real stdio server's prompts", async () => {
    const c = capture();
    expect(await runCli(["doctor", "prompts", fixtureRoot, "--server", "modern", "--runtime", "--json"], c.io)).toBe(0);
    expect(JSON.parse(c.stdout.join("\n"))).toMatchObject({ transport: "stdio", status: "pass", catalog: { promptsChecked: 2 } });
  });

  it("documents the command in help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "prompts", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("Prompt catalog structure only; prompts are not retrieved.");
    expect(c.stdout.join("\n")).toContain("doctor prompts-file and prompts-diff");
  });
});
