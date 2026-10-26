import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { saveMcpSnapshot, type McpServerSurface, type McpSnapshot, type McpSnapshotListKey } from "../src/core/mcp-snapshot.js";
import { acceptMcpSnapshot } from "../src/core/mcp-snapshot-accept.js";
import { compareMcpSnapshotDirectories } from "../src/core/mcp-snapshot-diff.js";
import type { CatalogStatus } from "../src/core/mcp-tool-catalog.js";
import { runCli } from "../src/run-cli.js";

const tools = [{ name: "lookup", inputSchema: { type: "object" } }];
const prompts = [{ name: "review" }];
const server: McpServerSurface = {
  era: "modern", versions: ["2026-07-28"], capabilities: ["prompts", "tools"], instructions: { sha256: "a".repeat(64), length: 12 }
};

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-accept-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

// A list given as items is saved with status pass; a list given as a status is recorded but not saved.
async function snapshotDirectory(name: string, lists: Record<McpSnapshotListKey, unknown[] | CatalogStatus>, surface: McpServerSurface = server): Promise<string> {
  const directory = path.join(root, name);
  const keys = Object.keys(lists) as McpSnapshotListKey[];
  const report = { server: surface, lists: Object.fromEntries(keys.map((key) => [key, { status: Array.isArray(lists[key]) ? "pass" : lists[key] }])) };
  const responses = Object.fromEntries(keys.map((key) => [key, Array.isArray(lists[key]) ? { items: lists[key], cache: { ttlMs: 0, cacheScope: "private" } } : null]));
  await saveMcpSnapshot(directory, { report, responses } as unknown as McpSnapshot);
  return directory;
}

const capture = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { writeStdout: (text: string) => { stdout.push(text); }, writeStderr: (text: string) => { stderr.push(text); } } };
};

describe("acceptMcpSnapshot", () => {
  it("copies the named lists and the manifest, removes stale list files, and leaves other files alone", async () => {
    const baseline = await snapshotDirectory("baseline", { tools, prompts, resourceTemplates: "not-applicable" });
    await writeFile(path.join(baseline, "README.md"), "kept");
    const snapshot = await snapshotDirectory("snapshot", { tools: [...tools, { name: "search", inputSchema: { type: "object" } }], prompts: "not-applicable", resourceTemplates: "not-applicable" });

    const result = await acceptMcpSnapshot(snapshot, baseline);

    expect(result).toEqual({
      kind: "accepted", lists: { tools: "copied", prompts: "not-offered", resourceTemplates: "not-offered" }, removed: ["mcp-prompts-current.json"], server: true
    });
    expect((await readdir(baseline)).sort()).toEqual(["README.md", "mcp-snapshot-manifest.json", "mcp-tools-current.json"]);
    expect(await readFile(path.join(baseline, "mcp-tools-current.json"), "utf8")).toBe(await readFile(path.join(snapshot, "mcp-tools-current.json"), "utf8"));
    expect(JSON.parse(await readFile(path.join(baseline, "mcp-snapshot-manifest.json"), "utf8"))).toEqual(
      JSON.parse(await readFile(path.join(snapshot, "mcp-snapshot-manifest.json"), "utf8"))
    );
    expect((await compareMcpSnapshotDirectories(baseline, snapshot)).status).toBe("pass");
  });

  it("creates a missing baseline directory and keeps a manifest that predates the server surface without one", async () => {
    const snapshot = await snapshotDirectory("snapshot", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    // A manifest written before 1.84.0 has no server key.
    const manifestPath = path.join(snapshot, "mcp-snapshot-manifest.json");
    const { server: _server, ...older } = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify(older));
    const baseline = path.join(root, "nested", "baseline");

    expect(await acceptMcpSnapshot(snapshot, baseline)).toMatchObject({ kind: "accepted", server: false });
    expect(JSON.parse(await readFile(path.join(baseline, "mcp-snapshot-manifest.json"), "utf8"))).not.toHaveProperty("server");
  });

  it.each([
    ["the same directory", async () => {
      const snapshot = await snapshotDirectory("snapshot", { tools, prompts, resourceTemplates: "not-applicable" });
      return [snapshot, snapshot];
    }, "The snapshot directory is already the baseline directory."],
    ["a snapshot without a manifest", async () => {
      await mkdir(path.join(root, "empty"));
      return [path.join(root, "empty"), path.join(root, "baseline")];
    }, "The snapshot directory has no valid mcp-snapshot-manifest.json (unavailable)."],
    ["a remote path", async () => ["https://example.test/snapshot", path.join(root, "baseline")], "The snapshot and baseline directories must be local paths."],
    ["a list that was offered but not saved", async () => [
      await snapshotDirectory("snapshot", { tools, prompts: "incomplete", resourceTemplates: "not-applicable" }), path.join(root, "baseline")
    ], "The prompt list was offered but not saved (status incomplete); take the snapshot again."],
    ["definitions that fail their file check", async () => [
      await snapshotDirectory("snapshot", { tools, prompts: [{ title: "No name" }], resourceTemplates: "not-applicable" }), path.join(root, "baseline")
    ], "The prompt list in the snapshot did not pass its file check (status fail)."]
  ] as const)("refuses %s", async (_case, setup, reason) => {
    const [snapshot, baseline] = await setup();

    expect(await acceptMcpSnapshot(snapshot, baseline)).toEqual({ kind: "refused", reason });
  });

  it("refuses before changing the baseline when a baseline target is not a regular file", async () => {
    const baseline = await snapshotDirectory("baseline", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    await mkdir(path.join(baseline, "mcp-prompts-current.json"));
    const manifestBefore = await readFile(path.join(baseline, "mcp-snapshot-manifest.json"), "utf8");
    const snapshot = await snapshotDirectory("snapshot", { tools, prompts, resourceTemplates: "not-applicable" });

    expect(await acceptMcpSnapshot(snapshot, baseline)).toEqual({ kind: "refused", reason: "mcp-prompts-current.json in the baseline directory is not a regular file." });
    expect(await readFile(path.join(baseline, "mcp-snapshot-manifest.json"), "utf8")).toBe(manifestBefore);
  });
});

describe("acceptMcpSnapshot links", () => {
  it("refuses a baseline list file that is a symbolic link", async (context) => {
    const baseline = path.join(root, "baseline");
    await mkdir(baseline);
    await writeFile(path.join(root, "elsewhere.json"), "outside");
    try {
      await symlink(path.join(root, "elsewhere.json"), path.join(baseline, "mcp-tools-current.json"));
    } catch {
      context.skip();
    }
    const snapshot = await snapshotDirectory("snapshot", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });

    expect(await acceptMcpSnapshot(snapshot, baseline)).toEqual({ kind: "refused", reason: "mcp-tools-current.json in the baseline directory is not a regular file." });
    expect(await readFile(path.join(root, "elsewhere.json"), "utf8")).toBe("outside");
  });
});

describe("doctor mcp-snapshot-accept", () => {
  it("reports what it copied and exits 0, and exits 2 with the reason when it refuses", async () => {
    const snapshot = await snapshotDirectory("snapshot", { tools, prompts: "not-applicable", resourceTemplates: "not-applicable" });
    const baseline = path.join(root, "baseline");
    const accepted = capture();
    expect(await runCli(["doctor", "mcp-snapshot-accept", "--snapshot", snapshot, "--baseline", baseline], accepted.io)).toBe(0);
    expect(accepted.stdout.join("\n")).toBe([
      `Accepted the MCP snapshot as the baseline in ${baseline}.`,
      "Tools: copied", "Prompts: not offered", "Resource templates: not offered", "Server surface: recorded"
    ].join("\n"));

    const refused = capture();
    expect(await runCli(["doctor", "mcp-snapshot-accept", "--snapshot", baseline, "--baseline", baseline], refused.io)).toBe(2);
    expect(refused.stderr).toEqual(["The snapshot directory is already the baseline directory."]);
  });

  it.each([
    [["--snapshot", "a"]],
    [["--snapshot", "a", "--baseline", "b", "--snapshot", "c"]],
    [["--snapshot", "a", "--baseline", "--json"]],
    [["--source", "a", "--baseline", "b"]]
  ])("rejects %j", async (args) => {
    const c = capture();
    expect(await runCli(["doctor", "mcp-snapshot-accept", ...args], c.io)).toBe(2);
    expect(c.stderr.join("\n")).toContain("Invalid snapshot accept arguments. Usage: codex-plugin-doctor doctor mcp-snapshot-accept");
  });

  it("documents the command in help", async () => {
    const c = capture();
    expect(await runCli(["doctor", "mcp-snapshot-accept", "--help"], c.io)).toBe(0);
    expect(c.stdout.join("\n")).toContain("writes the manifest last; no other file is read or written");
  });
});
