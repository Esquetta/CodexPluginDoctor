import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import type { McpSnapshot } from "../src/core/mcp-snapshot.js";
import { runCli } from "../src/run-cli.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: {
    writeStdout: (text: string) => { stdout.push(text); },
    writeStderr: (text: string) => { stderr.push(text); }
  } };
}

const discovery = { schemaVersion: 1, requestedVersion: "2026-07-28", scope: "discovery-only", status: "discovered", supportedVersions: ["2026-07-28"], findings: [], coverage: { discovery: "pass", runtime: "not-tested" } };
const listOf = (status: string, checked = 1) => ({
  status, catalog: { complete: status === "pass", pagesRead: status === "pass" ? 1 : 0, checked: status === "pass" ? checked : 0, reason: null },
  enumeration: status === "pass" ? "complete" : "not-tested", findings: []
});

function snapshot(status = "pass"): McpSnapshot {
  return {
    report: {
      schemaVersion: 1, scope: "mcp-surface-snapshot", status, discovery,
      lists: { tools: listOf("pass"), prompts: listOf("not-applicable"), resourceTemplates: listOf("pass", 2) },
      coverage: { discovery: "pass", definitions: "shape-only", execution: "not-tested", fullConformance: "not-tested" }
    },
    responses: {
      tools: { items: [{ name: "lookup", inputSchema: { type: "object" } }], cache: { ttlMs: 0, cacheScope: "private" } },
      prompts: null,
      resourceTemplates: { items: [{ name: "files", uriTemplate: "file:///{path}" }], cache: { ttlMs: 0, cacheScope: "private" } }
    }
  } as unknown as McpSnapshot;
}

describe("doctor mcp-snapshot", () => {
  it("requires network consent and rejects --save-response", async () => {
    const captureMcpSnapshotImpl = vi.fn();
    const missing = capture();
    expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp"], missing.io, { captureMcpSnapshotImpl })).toBe(2);
    expect(missing.stderr.join("\n")).toBe("doctor mcp-snapshot requires explicit --allow-network consent.");

    const wrongFlag = capture();
    expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-response", "x.json"], wrongFlag.io, { captureMcpSnapshotImpl })).toBe(2);
    expect(wrongFlag.stderr.join("\n")).toContain("Invalid or duplicate snapshot arguments.");
    expect(captureMcpSnapshotImpl).not.toHaveBeenCalled();
  });

  it("saves each complete list under its usual name and skips the rest", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-cli-"));
    try {
      const saveDir = path.join(directory, "out");
      const c = capture();
      const captureMcpSnapshotImpl = vi.fn().mockResolvedValue(snapshot());
      expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-dir", saveDir], c.io, { captureMcpSnapshotImpl })).toBe(0);
      expect(c.stdout.join("\n")).toContain("Prompts: not-applicable");
      expect(c.stderr).toEqual([
        expect.stringMatching(/^Saved a complete tools\/list response with 1 entries as mcp-tools-current\.json \(\d+ bytes\)\.$/u),
        expect.stringMatching(/^Saved a complete resources\/templates\/list response with 1 entries as mcp-resource-templates-current\.json \(\d+ bytes\)\.$/u)
      ]);
      expect((await readdir(saveDir)).sort()).toEqual(["mcp-resource-templates-current.json", "mcp-tools-current.json"]);

      const none = snapshot("not-applicable");
      none.responses = { tools: null, prompts: null, resourceTemplates: null };
      const empty = capture();
      expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-dir", path.join(directory, "empty")], empty.io, { captureMcpSnapshotImpl: vi.fn().mockResolvedValue(none) })).toBe(2);
      expect(empty.stderr).toEqual(["No list was enumerated completely, so nothing was saved."]);

      // A directory in place of one file blocks only that list, and the command still exits 2.
      const blockedDir = path.join(directory, "blocked");
      await mkdir(path.join(blockedDir, "mcp-tools-current.json"), { recursive: true });
      const blocked = capture();
      expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-dir", blockedDir], blocked.io, { captureMcpSnapshotImpl })).toBe(2);
      expect(blocked.stderr).toEqual([
        "mcp-tools-current.json was not saved because the existing target is not a regular file.",
        expect.stringMatching(/^Saved a complete resources\/templates\/list response with 1 entries as mcp-resource-templates-current\.json/u)
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([["pass", 0], ["warn", 1], ["not-applicable", 1], ["incomplete", 2]] as const)("returns %s as exit %i", async (status, exitCode) => {
    const captureMcpSnapshotImpl = vi.fn().mockResolvedValue(snapshot(status));
    expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--json"], capture().io, { captureMcpSnapshotImpl })).toBe(exitCode);
  });

  it("starts a stdio server only with --runtime and saves only the lists it offers", async () => {
    const fixture = path.resolve("tests", "fixtures", "stdio-resource-template-catalog");
    const refused = capture();
    expect(await runCli(["doctor", "mcp-snapshot", fixture, "--server", "modern"], refused.io)).toBe(2);
    expect(refused.stderr.join("\n")).toBe("doctor mcp-snapshot --server starts a local MCP server and requires explicit --runtime consent.");

    const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-cli-"));
    try {
      const live = capture();
      expect(await runCli(["doctor", "mcp-snapshot", fixture, "--server", "modern", "--runtime", "--json", "--save-dir", directory], live.io)).toBe(0);
      expect(JSON.parse(live.stdout.join("\n"))).toMatchObject({
        transport: "stdio", status: "pass",
        lists: { tools: { status: "not-applicable" }, prompts: { status: "not-applicable" }, resourceTemplates: { status: "pass" } }
      });
      expect(await readdir(directory)).toEqual(["mcp-resource-templates-current.json"]);
      expect(await runCli(["doctor", "resource-templates-file", path.join(directory, "mcp-resource-templates-current.json")], capture().io)).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("documents the command in help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "mcp-snapshot", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("--save-dir writes each complete list as mcp-tools-current.json");
  });
});
