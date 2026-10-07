import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { compareMcpToolFiles } from "../src/core/mcp-tool-diff.js";
import { inspectMcpToolFile } from "../src/core/mcp-tool-file.js";
import { saveMcpToolsListResponse } from "../src/core/mcp-tool-response-file.js";

const temporaryDirectories: string[] = [];
const cache = { ttlMs: 0, cacheScope: "public" as const };

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-tool-response-file-"));
  temporaryDirectories.push(directory);
  return directory;
}

function tool(name: string, inputSchema: Record<string, unknown> = { type: "object" }): Record<string, unknown> {
  return { name, inputSchema };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("saveMcpToolsListResponse", () => {
  it("writes a response that tools-file inspects as complete", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "tools.json");

    expect(await saveMcpToolsListResponse(filePath, [tool("first"), tool("second")], { ttlMs: 500, cacheScope: "private" }))
      .toMatchObject({ kind: "saved", tools: 2 });

    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      jsonrpc: "2.0", id: "tools-list",
      result: { resultType: "complete", tools: [tool("first"), tool("second")], ttlMs: 500, cacheScope: "private" }
    });
    expect(await inspectMcpToolFile(filePath)).toMatchObject({ status: "pass", inspection: { complete: true, toolsChecked: 2 } });
  });

  it("produces baselines that tools-diff compares and classifies", async () => {
    const directory = await fixtureDirectory();
    const before = path.join(directory, "before.json");
    const after = path.join(directory, "after.json");
    await saveMcpToolsListResponse(before, [tool("kept"), tool("removed")], cache);
    await saveMcpToolsListResponse(after, [tool("kept")], cache);

    const report = await compareMcpToolFiles(before, after);

    expect(report.comparison).toMatchObject({ complete: true, removed: 1, unchanged: 1, breaking: 1 });
  });

  it("replaces an existing regular file without leaving temporary files", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "tools.json");
    await writeFile(filePath, "stale", "utf8");

    expect(await saveMcpToolsListResponse(filePath, [tool("fresh")], cache)).toMatchObject({ kind: "saved" });

    expect(await readFile(filePath, "utf8")).toContain("fresh");
    expect(await readdir(directory)).toEqual(["tools.json"]);
  });

  it("keeps the permissions of a replaced file", async (context) => {
    if (process.platform === "win32") context.skip();
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "tools.json");
    await writeFile(filePath, "stale", "utf8");
    await chmod(filePath, 0o600);

    expect(await saveMcpToolsListResponse(filePath, [tool("fresh")], cache)).toMatchObject({ kind: "saved" });

    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });

  it("refuses a directory target", async () => {
    const directory = await fixtureDirectory();
    const target = path.join(directory, "tools.json");
    await mkdir(target);

    expect(await saveMcpToolsListResponse(target, [], cache)).toEqual({ kind: "not-regular" });
  });

  it("refuses a final symbolic link without changing its target", async (context) => {
    const directory = await fixtureDirectory();
    const target = path.join(directory, "target.json");
    const link = path.join(directory, "tools.json");
    await writeFile(target, "original", "utf8");
    try {
      await symlink(target, link, "file");
    } catch {
      context.skip();
    }

    expect(await saveMcpToolsListResponse(link, [tool("fresh")], cache)).toEqual({ kind: "not-regular" });
    expect(await readFile(target, "utf8")).toBe("original");
  });

  it.each(["https://example.test/tools.json", "file:///tmp/tools.json", "\\\\server\\share\\tools.json", "//server/share/tools.json"])(
    "refuses the non-local path %s", async (filePath) => {
      expect(await saveMcpToolsListResponse(filePath, [], cache)).toEqual({ kind: "path-blocked" });
    }
  );

  it("refuses a response larger than the tools-file limit without writing", async () => {
    const directory = await fixtureDirectory();
    const filePath = path.join(directory, "tools.json");

    expect(await saveMcpToolsListResponse(filePath, [tool("large", { type: "object", description: "x".repeat(1024 * 1024) })], cache))
      .toEqual({ kind: "too-large" });
    expect(await readdir(directory)).toEqual([]);
  });

  it("reports a missing parent directory as a write failure", async () => {
    const directory = await fixtureDirectory();

    expect(await saveMcpToolsListResponse(path.join(directory, "missing", "tools.json"), [], cache)).toEqual({ kind: "write-failed" });
    expect(await readdir(directory)).toEqual([]);
  });
});
