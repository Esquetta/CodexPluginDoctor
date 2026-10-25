import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The accept command writes through saveLocalFile; this file makes the first list write fail.
vi.mock("../src/core/mcp-tool-response-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/mcp-tool-response-file.js")>();
  return {
    ...actual,
    saveLocalFile: vi.fn(async (filePath: string, content: string) =>
      (process.env.DOCTOR_TEST_FAIL_WRITES === "true" ? { kind: "write-failed" as const } : actual.saveLocalFile(filePath, content)))
  };
});

const { saveMcpSnapshot } = await import("../src/core/mcp-snapshot.js");
const { acceptMcpSnapshot } = await import("../src/core/mcp-snapshot-accept.js");
type McpSnapshot = import("../src/core/mcp-snapshot.js").McpSnapshot;

let root: string;
afterEach(async () => {
  delete process.env.DOCTOR_TEST_FAIL_WRITES;
  await rm(root, { recursive: true, force: true });
});

const snapshot = (prompts: boolean) => ({
  report: { server: null, lists: { tools: { status: "pass" }, prompts: { status: prompts ? "pass" : "not-applicable" }, resourceTemplates: { status: "not-applicable" } } },
  responses: {
    tools: { items: [{ name: "lookup", inputSchema: { type: "object" } }], cache: { ttlMs: 0, cacheScope: "private" } },
    prompts: prompts ? { items: [{ name: "review" }], cache: { ttlMs: 0, cacheScope: "private" } } : null,
    resourceTemplates: null
  }
}) as unknown as McpSnapshot;

describe("acceptMcpSnapshot write failures", () => {
  it("leaves the baseline without a manifest when a write fails partway", async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "doctor-snapshot-accept-failure-"));
    const baseline = path.join(root, "baseline");
    const source = path.join(root, "snapshot");
    await saveMcpSnapshot(baseline, snapshot(false));
    await saveMcpSnapshot(source, snapshot(true));

    process.env.DOCTOR_TEST_FAIL_WRITES = "true";
    const result = await acceptMcpSnapshot(source, baseline);

    expect(result).toEqual({ kind: "failed", reason: "mcp-tools-current.json was not written because it could not be written." });
    expect((await readdir(baseline)).sort()).toEqual(["mcp-tools-current.json"]);
  });
});
