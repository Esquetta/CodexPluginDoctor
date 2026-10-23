import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { saveMcpSnapshot, type McpSnapshot } from "../src/core/mcp-snapshot.js";
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
        expect.stringMatching(/^Saved a complete resources\/templates\/list response with 1 entries as mcp-resource-templates-current\.json \(\d+ bytes\)\.$/u),
        expect.stringMatching(/^Saved the snapshot manifest as mcp-snapshot-manifest\.json \(\d+ bytes\)\.$/u)
      ]);
      expect((await readdir(saveDir)).sort()).toEqual(["mcp-resource-templates-current.json", "mcp-snapshot-manifest.json", "mcp-tools-current.json"]);

      const none = snapshot("not-applicable");
      none.responses = { tools: null, prompts: null, resourceTemplates: null };
      const empty = capture();
      expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-dir", path.join(directory, "empty")], empty.io, { captureMcpSnapshotImpl: vi.fn().mockResolvedValue(none) })).toBe(2);
      expect(empty.stderr).toEqual(["No list was enumerated completely, so no list was saved.", expect.stringMatching(/^Saved the snapshot manifest as mcp-snapshot-manifest\.json/u)]);

      // A directory in place of one file blocks only that list, and the command still exits 2.
      const blockedDir = path.join(directory, "blocked");
      await mkdir(path.join(blockedDir, "mcp-tools-current.json"), { recursive: true });
      const blocked = capture();
      expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-dir", blockedDir], blocked.io, { captureMcpSnapshotImpl })).toBe(2);
      expect(blocked.stderr).toEqual([
        "mcp-tools-current.json was not saved because the existing target is not a regular file.",
        expect.stringMatching(/^Saved a complete resources\/templates\/list response with 1 entries as mcp-resource-templates-current\.json/u),
        expect.stringMatching(/^Saved the snapshot manifest as mcp-snapshot-manifest\.json/u)
      ]);

      // The manifest is checked like a list file, and a failed manifest write also exits 2.
      const noManifestDir = path.join(directory, "no-manifest");
      await mkdir(path.join(noManifestDir, "mcp-snapshot-manifest.json"), { recursive: true });
      const noManifest = capture();
      expect(await runCli(["doctor", "mcp-snapshot", "https://mcp.example/mcp", "--allow-network", "--save-dir", noManifestDir], noManifest.io, { captureMcpSnapshotImpl })).toBe(2);
      expect(noManifest.stderr.at(-1)).toBe("mcp-snapshot-manifest.json was not saved because the existing target is not a regular file.");
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
      expect((await readdir(directory)).sort()).toEqual(["mcp-resource-templates-current.json", "mcp-snapshot-manifest.json"]);
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

describe("doctor mcp-snapshot-diff", () => {
  // Saves a snapshot directory; a list given as items is saved, one given as a status is only recorded.
  async function snapshotDirectory(directory: string, lists: Record<"tools" | "prompts" | "resourceTemplates", unknown[] | string>): Promise<string> {
    const keys = Object.keys(lists) as Array<keyof typeof lists>;
    const report = { lists: Object.fromEntries(keys.map((key) => [key, { status: Array.isArray(lists[key]) ? "pass" : lists[key] }])) };
    const responses = Object.fromEntries(keys.map((key) => [key, Array.isArray(lists[key]) ? { items: lists[key], cache: { ttlMs: 0, cacheScope: "private" } } : null]));
    await saveMcpSnapshot(directory, { report, responses } as unknown as McpSnapshot);
    return directory;
  }
  const tool = { name: "lookup", inputSchema: { type: "object" } };
  const template = { name: "files", uriTemplate: "file:///{path}" };

  it("exits by status and by --fail-on breaking", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-diff-cli-"));
    try {
      const base = await snapshotDirectory(path.join(root, "base"), { tools: [tool], prompts: "not-applicable", resourceTemplates: "not-applicable" });
      const same = await snapshotDirectory(path.join(root, "same"), { tools: [tool], prompts: "not-applicable", resourceTemplates: "not-applicable" });
      const added = await snapshotDirectory(path.join(root, "added"), { tools: [tool], prompts: "not-applicable", resourceTemplates: [template] });
      const removed = await snapshotDirectory(path.join(root, "removed"), { tools: "not-applicable", prompts: "not-applicable", resourceTemplates: "not-applicable" });
      const unread = await snapshotDirectory(path.join(root, "unread"), { tools: "incomplete", prompts: "not-applicable", resourceTemplates: "not-applicable" });
      const diff = (after: string, ...flags: string[]) => runCli(["doctor", "mcp-snapshot-diff", "--before", base, "--after", after, ...flags], capture().io);

      expect(await diff(same)).toBe(0);
      expect(await diff(added)).toBe(1);
      expect(await diff(added, "--fail-on", "breaking")).toBe(0);
      expect(await diff(removed, "--fail-on", "breaking")).toBe(1);
      expect(await diff(unread)).toBe(2);

      const markdown = capture();
      expect(await runCli(["doctor", "mcp-snapshot-diff", "--before", base, "--after", added, "--markdown"], markdown.io)).toBe(1);
      expect(markdown.stdout.join("\n")).toContain("| Resource templates | **list-added** (compatible), definitions `pass` |");
      const json = capture();
      expect(await runCli(["doctor", "mcp-snapshot-diff", "--before", base, "--after", removed, "--json"], json.io)).toBe(1);
      expect(JSON.parse(json.stdout.join("\n"))).toMatchObject({ scope: "mcp-snapshot-diff", lists: { tools: { outcome: "list-removed" } } });

      // Tool names reach the report only with --show-names.
      const renamed = await snapshotDirectory(path.join(root, "renamed"), { tools: [{ ...tool, name: "search" }], prompts: "not-applicable", resourceTemplates: "not-applicable" });
      const hidden = capture();
      expect(await runCli(["doctor", "mcp-snapshot-diff", "--before", base, "--after", renamed, "--markdown"], hidden.io)).toBe(1);
      expect(hidden.stdout.join("\n")).not.toMatch(/lookup|search/u);
      const shown = capture();
      expect(await runCli(["doctor", "mcp-snapshot-diff", "--before", base, "--after", renamed, "--json", "--show-names"], shown.io)).toBe(1);
      expect(JSON.parse(shown.stdout.join("\n")).lists.tools.diff.changes.map((change: { name: string }) => change.name).sort()).toEqual(["lookup", "search"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects invalid arguments and documents the command in help", async () => {
    const invalid = capture();
    expect(await runCli(["doctor", "mcp-snapshot-diff", "--before", "a"], invalid.io)).toBe(2);
    expect(invalid.stderr.join("\n")).toContain("Invalid comparison arguments. Usage: codex-plugin-doctor doctor mcp-snapshot-diff");

    const help = capture();
    expect(await runCli(["doctor", "mcp-snapshot-diff", "--help"], help.io)).toBe(0);
    expect(help.stdout.join("\n")).toContain("a list the server stopped offering is breaking");
  });
});
